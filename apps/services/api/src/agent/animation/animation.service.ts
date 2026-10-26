import fs from 'node:fs'
import path from 'node:path'

import { ANIMATION_LOOKS, animationLook } from '@reelmakeeasy/common/animation/looks'
import { Logger } from '@reelmakeeasy/common/logger'
import { motionReelTrack, motionReelTracks } from '@reelmakeeasy/common/motion-reel/music'
import {
  MOTION_MUSIC_ENGINE_INFO,
  MOTION_MUSIC_ENGINES,
} from '@reelmakeeasy/common/motion-reel/reel-config'
import { presetPath, presetUrl } from '@reelmakeeasy/common/storage/presets'
import { generateForcedAlignment } from '@reelmakeeasy/common/asr/elevenlabs'
import {
  KOKORO_VOICE_PREFIX,
  kokoroTextToSpeech,
  qwen3DesignVoiceSample,
} from '@reelmakeeasy/common/tts/fal-tts'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import {
  type AgentAnimationOptions,
  type AgentAnimationSetup,
  type AgentAnimationSetupView,
  type AgentSession,
  isAnimationMode,
} from '@shared/types/api/agent'

import { resolveAttachment } from '../agent-attachments'
import { animationKickoff } from '../agent-brief'
import type { ReelMusicSource } from '../motion-reel/motion-project'
import { ensureMotionReelRuntime } from '../motion-reel/motion-runtime'
import type { ToolCallResult } from '../tools/agent-tools'

import {
  ANIMATION_DIR,
  prepareAnimationProject,
  readAnimationJson,
  writeAnimationJson,
} from './animation-project'
import { AnimationSetupError, parseAnimationSetup, voiceReadiness } from './animation-setup'
import { parseVoiceArgs, recordVoices, VoiceArgsError, type VoiceDeps } from './animation-voice'

const logger = new Logger('AnimationService')

/** Why the 2D look can't be picked: its characters need designed voices. */
export const NO_DESIGNED_VOICES = 'Needs Qwen3 voices on this computer or a fal key.'

/** A narrator's voice when designed voices can't be made here: a calm, clear Kokoro preset. */
const NARRATOR_PRESET = 'kokoro-am_michael'

/** The app's own voices and aligner: Qwen3 voice design for a description, Kokoro for a preset id
 *  (each on this computer first, else fal), timed by the app's forced aligner. */
const APP_VOICES: VoiceDeps = {
  align: async (file, text) =>
    (await generateForcedAlignment(file, text)).words.map((w) => ({
      end: w.end,
      start: w.start,
      text: w.text,
    })),
  speak: async ({ text, voice }) => {
    const result = voice.startsWith(KOKORO_VOICE_PREFIX)
      ? await kokoroTextToSpeech({ text, voiceId: voice })
      : await qwen3DesignVoiceSample({ description: voice, languageCode: 'en', sampleText: text })
    return { audio: result.audioBuffer, ranOn: result.ranOn }
  },
}

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

  private readonly voice: VoiceDeps

  constructor(
    protected readonly sessions: AnimationSessions,
    deps: { voice?: VoiceDeps } = {},
  ) {
    this.voice = deps.voice ?? APP_VOICES
  }

  /** Claude called one of the animation tools. */
  async callTool(id: string, tool: string, args: unknown): Promise<ToolCallResult> {
    if (this.busy.has(id) || this.preparing.has(id))
      return { success: false, text: 'A render or setup is already running; wait for it.' }
    const session = this.sessions.getSession(id)
    if (!isAnimationMode(session.mode) || !session.animation)
      return {
        success: false,
        text:
          session.mode === 'animation_free'
            ? 'Set the animation up first: call animation_setup.'
            : 'This chat has no animation set up.',
      }
    const projectDir = path.join(this.sessions.workingDir(id), ANIMATION_DIR)
    this.busy.add(id)
    try {
      if (tool === 'animation_voice') return await this.recordVoice(session.animation, projectDir, args)
      return { success: false, text: `Unknown tool ${tool}.` }
    } catch (error) {
      if (error instanceof VoiceArgsError || error instanceof AnimationSetupError)
        return { success: false, text: error.message }
      return { success: false, text: `It failed:\n${ensureError(error).message.slice(-3000)}` }
    } finally {
      this.busy.delete(id)
    }
  }

  /** animation_voice: records the lines with the voices this computer (or fal) can make. */
  private async recordVoice(
    setup: AgentAnimationSetupView,
    projectDir: string,
    args: unknown,
  ): Promise<ToolCallResult> {
    const parsed = parseVoiceArgs(args)
    const ready = await voiceReadiness()
    const look = animationLook(setup.lookId)
    let lines = parsed.lines
    let note = ''
    const designed = lines.some((l) => !l.voice.startsWith(KOKORO_VOICE_PREFIX))
    if (designed && !ready.designed) {
      if (look?.cast === 'duo' || !ready.preset)
        return {
          success: false,
          text: 'No designed voices here: install Qwen3 voices (run setup again) or add a fal key.',
        }
      lines = lines.map((l) =>
        l.voice.startsWith(KOKORO_VOICE_PREFIX) ? l : { ...l, voice: NARRATOR_PRESET },
      )
      note = ` Designed voices can't be made here, so the narrator uses a preset voice (${NARRATOR_PRESET}).`
    }
    const usesDesigned = lines.some((l) => !l.voice.startsWith(KOKORO_VOICE_PREFIX))
    const usesPreset = lines.some((l) => l.voice.startsWith(KOKORO_VOICE_PREFIX))
    const paid =
      (usesDesigned && ready.designed === 'fal') || (usesPreset && ready.preset === 'fal')
    if (paid && !parsed.confirmPaid) {
      const chars = lines.reduce((n, l) => n + l.text.length, 0)
      return {
        success: false,
        text: `These voices would run on fal, paid (about ${chars} characters, a few takes may be needed): this computer doesn't have the voices installed. Tell the user in one line, then call animation_voice again with the same lines and confirmPaid: true.`,
      }
    }
    const spec = readAnimationJson(projectDir)
    const recorded = await recordVoices({
      deps: this.voice,
      fps: spec.fps,
      lines,
      pauseMs: parsed.pauseMs,
      projectDir,
    })
    writeAnimationJson(projectDir, { ...spec, voiceFile: 'voice.wav' })
    const who = [...new Set(recorded.lines.map((l) => l.who))].join(', ')
    const long =
      recorded.totalSec > setup.lengthSec + 3
        ? ` That is longer than the ${setup.lengthSec} s asked for: shorten or cut lines, then record again.`
        : ''
    return {
      success: true,
      text: [
        `Recorded ${recorded.lines.length} lines (${who}): ${recorded.totalSec} s in all, saved as public/voice.wav, with each line's start, end, words and loudness in public/voice/lines.json.${long}${note}`,
        recorded.ranOnFal ? 'Some takes ran on fal (paid).' : '',
        ...recorded.warnings,
        'Time the scenes to the lines with lineStart(i), lineEnd(i) and wordAt(i, w) from src/clock.ts; record again only when the script changes.',
      ]
        .filter(Boolean)
        .join('\n'),
    }
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
