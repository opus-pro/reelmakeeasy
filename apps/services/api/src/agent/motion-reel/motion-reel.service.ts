import fs from 'node:fs'
import path from 'node:path'

import { Logger } from '@reelmakeeasy/common/logger'
import {
  defaultTrackFor,
  motionReelTrack,
  motionReelTracks,
} from '@reelmakeeasy/common/motion-reel/music'
import {
  DEFAULT_MOTION_REEL_LENGTH,
  DEFAULT_MOTION_REEL_RATIO,
  MOTION_REEL_LENGTHS,
  MOTION_REEL_RATIOS,
  type MotionReelSetup,
} from '@reelmakeeasy/common/motion-reel/reel-config'
import { MOTION_REEL_STYLES, motionReelStyle } from '@reelmakeeasy/common/motion-reel/styles'
import { storeUri } from '@reelmakeeasy/common/storage/address'
import { presetPath, presetUrl } from '@reelmakeeasy/common/storage/presets'
import { uploadToStore } from '@reelmakeeasy/common/storage/stored-files'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import type {
  AgentMotionOptions,
  AgentMotionSetupView,
  AgentSession,
} from '@shared/types/api/agent'

import { resolveAttachment } from '../agent-attachments'
import { motionReelKickoff } from '../agent-brief'
import type { ToolCallResult } from '../tools/agent-tools'

import { prepareReelProject, REEL_DIR, type ReelMusicSource } from './motion-project'
import { readReference, REFERENCE_DIR } from './motion-reference'
import {
  frameOfBeat,
  MAX_STILLS,
  readReelJson,
  renderReel,
  renderStills,
  typeCheck,
} from './motion-render'
import { ensureMotionReelRuntime } from './motion-runtime'
import { MotionSetupError, parseMotionSetup, parseStillBeats } from './motion-setup'

const logger = new Logger('MotionReelService')

/** Where rendered reels are stored (served at /api/files/agent-motion/...). */
const STORE_FOLDER = 'agent-motion'

/** What the Motion Reel service needs from the session service. */
export interface MotionReelSessions {
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
      | { type: 'motion_setup_request' },
  ): void
  emitImage(id: string, file: string): void
  emitMessage(id: string, text: string): void
  emitNotice(id: string, text: string): void
  getSession(id: string): AgentSession
  setFlowWorking(id: string, working: boolean): void
  startMotionReel(id: string, setup: AgentMotionSetupView, prompt: string): void
  workingDir(id: string): string
}

/** The setup was already sent (or is being set up): the card is answered once. */
export class MotionSetupTakenError extends Error {
  constructor() {
    super('This Motion Reel is already set up.')
  }
}

/**
 * Motion Reel chats: the setup card (`setup`), which readies the reel's Remotion project and then
 * starts the agent, and the two tools the agent renders with (`motion_still`, `motion_render`).
 * Everything that touches the network (installing Remotion, reading a reference) happens here, on
 * the server; the agent only has its sandboxed shell inside the chat's folder.
 */
export class MotionReelService {
  private readonly busy = new Set<string>()
  private readonly preparing = new Set<string>()
  private renders = 0

  constructor(private readonly sessions: MotionReelSessions) {}

  /** The agent called motion_still or motion_render. */
  async callTool(id: string, tool: string, args: unknown): Promise<ToolCallResult> {
    if (this.busy.has(id))
      return { success: false, text: 'A render is already running; wait for it.' }
    const session = this.sessions.getSession(id)
    if (session.mode !== 'motion' || !session.motionReel)
      return { success: false, text: 'This chat has no Motion Reel set up.' }
    const projectDir = path.join(this.sessions.workingDir(id), REEL_DIR)
    this.busy.add(id)
    try {
      const errors = await typeCheck(projectDir)
      if (errors)
        return { success: false, text: `The reel doesn't type-check; fix these first:\n${errors}` }
      if (tool === 'motion_still') return await this.stills(id, projectDir, args)
      if (tool === 'motion_render') return await this.render(id, projectDir)
      return { success: false, text: `Unknown tool ${tool}.` }
    } catch (error) {
      if (error instanceof MotionSetupError) return { success: false, text: error.message }
      return {
        success: false,
        text: `The render failed:\n${ensureError(error).message.slice(-3000)}`,
      }
    } finally {
      this.busy.delete(id)
    }
  }

  /** What the setup card offers. */
  options(): AgentMotionOptions {
    return {
      defaultLengthSec: DEFAULT_MOTION_REEL_LENGTH,
      defaultRatio: DEFAULT_MOTION_REEL_RATIO,
      lengths: [...MOTION_REEL_LENGTHS],
      ratios: [...MOTION_REEL_RATIOS],
      styles: MOTION_REEL_STYLES.map((style) => ({
        defaultTrackId: defaultTrackFor(style.id)?.id ?? null,
        description: style.description,
        id: style.id,
        label: style.label,
        palette: [...style.palette],
        ratios: [...style.ratios],
        thumbnailUrl: thumbnailUrl(style.id),
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
   * Takes the setup card: checks it (`MotionSetupError`), then readies the project in the
   * background (installing Remotion the first time) and starts the agent. A failure is said in
   * the chat and the card opens again.
   */
  setup(id: string, body: unknown): void {
    const session = this.sessions.getSession(id)
    if (session.mode !== 'motion') throw new MotionSetupError('This chat is not a Motion Reel.')
    if (session.motionReel || this.preparing.has(id)) throw new MotionSetupTakenError()
    const setup = parseMotionSetup(body)
    const music = this.musicFor(id, setup)
    this.preparing.add(id)
    void this.prepare(id, session, setup, music).finally(() => this.preparing.delete(id))
  }

  private musicFor(id: string, setup: MotionReelSetup): null | ReelMusicSource {
    if (setup.music.source === 'none') return null
    if (setup.music.source === 'library') {
      const track = motionReelTrack(setup.music.id)
      if (!track) throw new MotionSetupError("That music isn't available.")
      return { bpm: track.bpm, file: presetPath(track.file), title: track.title }
    }
    const found = resolveAttachment(this.sessions.attachmentsDir(id), setup.music.id)
    if (!found || (found.kind !== 'audio' && found.kind !== 'video'))
      throw new MotionSetupError('Upload the music again: that file is gone or is not audio.')
    return { file: found.path, title: found.name }
  }

  private async prepare(
    id: string,
    session: AgentSession,
    setup: MotionReelSetup,
    music: null | ReelMusicSource,
  ): Promise<void> {
    // Progress is ReelMakeEasy talking (a plain message); a failure is a notice.
    const say = (line: string) => this.sessions.emitMessage(id, line)
    const warn = (line: string) => this.sessions.emitNotice(id, line)
    this.sessions.setFlowWorking(id, true)
    try {
      await ensureMotionReelRuntime(say)
      const workspace = this.sessions.workingDir(id)
      const prepared = await prepareReelProject({ music, setup, workspace })
      let referenceNote: null | string = null
      if (setup.reference) {
        try {
          referenceNote = await readReference(setup.reference, prepared.projectDir, say)
        } catch (error) {
          logger.warn(`Reference for ${id} not read: ${ensureError(error).message}`)
          warn(
            `Couldn't read the reference (${ensureError(error).message.split('\n')[0]?.slice(0, 160)}); going on without it.`,
          )
        }
      }
      if (referenceNote)
        fs.appendFileSync(
          path.join(prepared.projectDir, 'brief.md'),
          `- **Reference files:** \`${REFERENCE_DIR}/\`: ${referenceNote}\n`,
        )
      const style = motionReelStyle(setup.styleId)
      const view: AgentMotionSetupView = {
        ...setup,
        bars: prepared.reel.bars,
        bpm: prepared.reel.bpm,
        musicTitle: music?.title ?? null,
        reelSec: prepared.reel.lengthSec,
        styleLabel: style?.label ?? setup.styleId,
      }
      this.sessions.setFlowWorking(id, false)
      this.sessions.startMotionReel(
        id,
        view,
        motionReelKickoff(session.harness ?? 'codex', !!referenceNote),
      )
    } catch (error) {
      logger.warn(`Motion Reel setup for ${id} failed: ${ensureError(error).message}`)
      this.sessions.setFlowWorking(id, false)
      warn(`Couldn't set up the reel: ${ensureError(error).message.split('\n')[0]?.slice(0, 300)}`)
      this.sessions.emitAutonomousEvent(id, { type: 'motion_setup_request' })
    }
  }

  private async render(id: string, projectDir: string): Promise<ToolCallResult> {
    const result = await renderReel(projectDir)
    const n = ++this.renders
    const stamp = `${Date.now()}-${n}`
    const videoKey = `${STORE_FOLDER}/${id}/reel-${stamp}.mp4`
    const posterKey = `${STORE_FOLDER}/${id}/reel-${stamp}.jpg`
    await uploadToStore(result.file, storeUri(videoKey))
    await uploadToStore(result.poster, storeUri(posterKey))
    const reel = readReelJson(projectDir)
    this.sessions.emitAutonomousEvent(id, {
      itemId: `motion-${stamp}`,
      posterUrl: storeUri(posterKey),
      report: result.report,
      type: 'motion_video',
      videoUrl: storeUri(videoKey),
    })
    return {
      success: true,
      text: `Rendered the reel (${reel.lengthSec} s, ${reel.bars} bars at ${reel.bpm} BPM) and showed it to the user. Beat check: ${result.report} The file is ${REEL_DIR}/out/reel.mp4.`,
    }
  }

  private async stills(id: string, projectDir: string, args: unknown): Promise<ToolCallResult> {
    const reel = readReelJson(projectDir)
    const beats = parseStillBeats(args, MAX_STILLS)
    const frames = beats.map((beat) => frameOfBeat(reel, beat))
    const files = await renderStills(projectDir, frames, path.join(projectDir, 'out', 'stills'))
    for (const file of files) this.sessions.emitImage(id, file)
    const lines = beats.map(
      (beat, i) =>
        `- beat ${beat} (frame ${frames[i]}): ${REEL_DIR}/${path.relative(projectDir, files[i] as string)}`,
    )
    return {
      success: true,
      text: `Rendered ${files.length} stills (the user sees them too). Open each file and look at it:\n${lines.join('\n')}`,
    }
  }
}

/** A style's thumbnail in the presets, when there is one. */
function thumbnailUrl(styleId: string): null | string {
  const key = `motion-reel/styles/${styleId}.jpg`
  try {
    return fs.existsSync(presetPath(key)) ? presetUrl(key) : null
  } catch {
    return null
  }
}
