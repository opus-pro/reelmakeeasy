import fs from 'node:fs'

import { ANIMATION_LOOKS, animationLook } from '@reelmakeeasy/common/animation/looks'
import { Logger } from '@reelmakeeasy/common/logger'
import { motionReelTrack, motionReelTracks } from '@reelmakeeasy/common/motion-reel/music'
import {
  MOTION_MUSIC_ENGINE_INFO,
  MOTION_MUSIC_ENGINES,
} from '@reelmakeeasy/common/motion-reel/reel-config'
import { presetPath, presetUrl } from '@reelmakeeasy/common/storage/presets'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import type {
  AgentAnimationOptions,
  AgentAnimationSetup,
  AgentAnimationSetupView,
  AgentSession,
} from '@shared/types/api/agent'

import { resolveAttachment } from '../agent-attachments'
import { animationKickoff } from '../agent-brief'
import type { ReelMusicSource } from '../motion-reel/motion-project'
import { ensureMotionReelRuntime } from '../motion-reel/motion-runtime'
import type { ToolCallResult } from '../tools/agent-tools'

import { prepareAnimationProject } from './animation-project'
import { AnimationSetupError, parseAnimationSetup, voiceReadiness } from './animation-setup'

const logger = new Logger('AnimationService')

/** Why the 2D look can't be picked: its characters need designed voices. */
export const NO_DESIGNED_VOICES = 'Needs Qwen3 voices on this computer or a fal key.'

/** What the Claude Animation service needs from the session service. */
export interface AnimationSessions {
  attachmentsDir(id: string): string
  emitAutonomousEvent(
    id: string,
    event:
      | {
          itemId: string
          posterUrl?: string
          report?: string
          type: 'motion_video'
          videoUrl: string
        }
      | { type: 'animation_setup_request' },
  ): void
  emitImage(id: string, file: string): void
  emitMessage(id: string, text: string): void
  emitNotice(id: string, text: string): void
  getSession(id: string): AgentSession
  setFlowWorking(id: string, working: boolean): void
  startAnimation(id: string, setup: AgentAnimationSetupView, prompt: string): void
  updateAnimation(id: string, setup: AgentAnimationSetupView): void
  workingDir(id: string): string
}

/** The setup was already sent (or is being set up): the card is answered once. */
export class AnimationSetupTakenError extends Error {
  constructor() {
    super('This animation is already set up.')
  }
}

/**
 * Claude Animation chats: the setup card (`setup`), which readies the animation's Remotion project
 * and then starts Claude; an Advanced chat's `animation_setup`, the same from Claude; and the tools
 * Claude records, looks and renders with. Everything that touches the network (installing
 * Remotion, the voices, the music) happens here, on the server; Claude only has its sandboxed shell
 * inside the chat's folder.
 */
export class AnimationService {
  protected readonly busy = new Set<string>()
  protected readonly preparing = new Set<string>()

  constructor(protected readonly sessions: AnimationSessions) {}

  /** Claude called one of the animation tools. */
  async callTool(id: string, tool: string, _args: unknown): Promise<ToolCallResult> {
    if (this.busy.has(id) || this.preparing.has(id))
      return { success: false, text: 'A render or setup is already running; wait for it.' }
    return { success: false, text: `Unknown tool ${tool}.` }
  }

  /** What the setup card offers. */
  async options(): Promise<AgentAnimationOptions> {
    const voices = await voiceReadiness()
    return {
      composers: MOTION_MUSIC_ENGINES.map((id) => ({ id, ...MOTION_MUSIC_ENGINE_INFO[id] })),
      looks: ANIMATION_LOOKS.map((look) => ({
        defaultLengthSec: look.lengths[0] as number,
        defaultTrackId: look.defaultTrackId,
        description: look.description,
        ...(look.cast === 'duo' && !voices.designed ? { disabledReason: NO_DESIGNED_VOICES } : {}),
        id: look.id,
        label: look.label,
        lengths: [...look.lengths],
        previewUrl: previewUrl(look.id),
      })),
      tracks: motionReelTracks().map((track) => ({
        bpm: track.bpm,
        id: track.id,
        previewUrl: presetUrl(track.file),
        styles: track.styles,
        title: track.title,
      })),
    }
  }

  /**
   * Takes the setup card: checks it (`AnimationSetupError`), then readies the project in the
   * background (installing Remotion the first time) and starts Claude. A failure is said in the
   * chat and the card opens again.
   */
  setup(id: string, body: unknown): void {
    const session = this.sessions.getSession(id)
    if (session.mode !== 'animation')
      throw new AnimationSetupError('This chat is not a Claude Animation.')
    if (session.animation || this.preparing.has(id)) throw new AnimationSetupTakenError()
    const setup = parseAnimationSetup(body)
    const music = this.musicFor(id, setup)
    this.preparing.add(id)
    void this.prepare(id, setup, music).finally(() => this.preparing.delete(id))
  }

  /** The music the card picked, as a file on this computer (null: none, or Claude makes it). */
  protected musicFor(id: string, setup: AgentAnimationSetup): null | ReelMusicSource {
    if (setup.music.source === 'none' || setup.music.source === 'agent') return null
    if (setup.music.source === 'library') {
      const track = motionReelTrack(setup.music.id)
      if (!track) throw new AnimationSetupError("That music isn't available.")
      return { bpm: track.bpm, file: presetPath(track.file), title: track.title }
    }
    const found = resolveAttachment(this.sessions.attachmentsDir(id), setup.music.id)
    if (!found || (found.kind !== 'audio' && found.kind !== 'video'))
      throw new AnimationSetupError('Upload the music again: that file is gone or is not audio.')
    return { file: found.path, title: found.name }
  }

  private async prepare(
    id: string,
    setup: AgentAnimationSetup,
    music: null | ReelMusicSource,
  ): Promise<void> {
    this.sessions.setFlowWorking(id, true)
    try {
      const view = await this.ready(id, setup, music)
      this.sessions.setFlowWorking(id, false)
      this.sessions.startAnimation(id, view, animationKickoff(view))
    } catch (error) {
      logger.warn(`Claude Animation setup for ${id} failed: ${ensureError(error).message}`)
      this.sessions.setFlowWorking(id, false)
      this.sessions.emitNotice(
        id,
        `Couldn't set up the animation: ${ensureError(error).message.split('\n')[0]?.slice(0, 300)}`,
      )
      this.sessions.emitAutonomousEvent(id, { type: 'animation_setup_request' })
    }
  }

  /** Readies the project in the chat's folder (installing Remotion the first time): what the
   *  setup card and an Advanced chat's animation_setup both do. */
  protected async ready(
    id: string,
    setup: AgentAnimationSetup,
    music: null | ReelMusicSource,
  ): Promise<AgentAnimationSetupView> {
    await ensureMotionReelRuntime((line) => this.sessions.emitMessage(id, line))
    await prepareAnimationProject({ music, setup, workspace: this.sessions.workingDir(id) })
    return {
      ...setup,
      lookLabel: animationLook(setup.lookId)?.label ?? setup.lookId,
      musicTitle: music?.title ?? null,
    }
  }
}

/** A look's preview clip in the presets, when there is one. */
function previewUrl(lookId: string): null | string {
  const key = `animation/looks/${lookId}.mp4`
  try {
    return fs.existsSync(presetPath(key)) ? presetUrl(key) : null
  } catch {
    return null
  }
}
