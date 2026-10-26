import fs from 'node:fs'
import path from 'node:path'

import { Logger } from '@reelmakeeasy/common/logger'
import { motionReelTrack, motionReelTracks } from '@reelmakeeasy/common/motion-reel/music'
import {
  DEFAULT_MOTION_REEL_LENGTH,
  DEFAULT_MOTION_REEL_RATIO,
  isMotionMusicEngine,
  MOTION_MUSIC_ENGINE_INFO,
  MOTION_MUSIC_ENGINES,
  MOTION_REEL_LENGTHS,
  MOTION_REEL_RATIOS,
  type MotionMusicEngine,
  motionMusicEngineOf,
  type MotionReelSetup,
} from '@reelmakeeasy/common/motion-reel/reel-config'
import {
  DEFAULT_MOTION_REEL_TYPE,
  MOTION_REEL_TYPE_INFO,
  MOTION_REEL_TYPES,
  motionReelTypeOf,
} from '@reelmakeeasy/common/motion-reel/reel-type'
import { storeUri } from '@reelmakeeasy/common/storage/address'
import { presetPath, presetUrl } from '@reelmakeeasy/common/storage/presets'
import { uploadToStore } from '@reelmakeeasy/common/storage/stored-files'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import {
  type AgentMotionOptions,
  type AgentMotionSetupView,
  type AgentSession,
  isMotionMode,
} from '@shared/types/api/agent'

import { resolveAttachment } from '../agent-attachments'
import { motionReelKickoff, motionReelNextSteps } from '../agent-brief'
import type { ToolCallResult } from '../tools/agent-tools'

import {
  composerTitle,
  ensureComposer,
  keptComposerScore,
  readComposedMusic,
} from './motion-composer'
import { composeMusic, parseComposeRequest } from './motion-music'
import { prepareReelProject, REEL_DIR, type ReelMusicSource } from './motion-project'
import { readReference, REFERENCE_DIR } from './motion-reference'
import {
  beatAt,
  frameOfBeat,
  MAX_STILLS,
  readReelJson,
  renderReel,
  renderStills,
  typeCheck,
} from './motion-render'
import { ensureMotionReelRuntime } from './motion-runtime'
import {
  MotionSetupError,
  motionSetupFromTool,
  parseMotionSetup,
  parseStillBeats,
} from './motion-setup'

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
  updateMotionReel(id: string, setup: AgentMotionSetupView): void
  /** What the user typed in the chat, oldest first (an Advanced reel's reference must be in it). */
  userTexts(id: string): string[]
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
 * starts the agent; an Advanced chat's `motion_setup`, the same from the agent; and the tools the
 * agent composes and renders with (`motion_music`, `motion_still`, `motion_render`).
 * Everything that touches the network (installing Remotion, reading a reference) happens here, on
 * the server; the agent only has its sandboxed shell inside the chat's folder.
 */
export class MotionReelService {
  private readonly busy = new Set<string>()
  private readonly preparing = new Set<string>()
  private renders = 0

  constructor(private readonly sessions: MotionReelSessions) {}

  /** The agent called one of the Motion Reel tools. */
  async callTool(id: string, tool: string, args: unknown): Promise<ToolCallResult> {
    if (this.busy.has(id) || this.preparing.has(id))
      return {
        refused: 'busy',
        success: false,
        text: 'A render or setup is already running; wait for it.',
      }
    const session = this.sessions.getSession(id)
    if (tool === 'motion_setup') return await this.setupFromChat(id, session, args)
    if (!isMotionMode(session.mode) || !session.motionReel)
      return {
        success: false,
        text:
          session.mode === 'motion_free'
            ? 'Set the reel up first: call motion_setup.'
            : 'This chat has no Motion Reel set up.',
      }
    const projectDir = path.join(this.sessions.workingDir(id), REEL_DIR)
    this.busy.add(id)
    try {
      const errors = await typeCheck(projectDir)
      if (errors)
        return {
          refused: 'type-check',
          success: false,
          text: `The reel doesn't type-check; fix these first:\n${errors}`,
        }
      if (tool === 'motion_music') return await this.compose(id, session, projectDir, args)
      if (tool === 'motion_still') return await this.stills(id, projectDir, args)
      if (tool === 'motion_render') return await this.render(id, projectDir)
      return { success: false, text: `Unknown tool ${tool}.` }
    } catch (error) {
      if (error instanceof MotionSetupError) return { success: false, text: error.message }
      const what = tool === 'motion_music' ? 'music' : tool === 'motion_still' ? 'stills' : 'render'
      return {
        success: false,
        text: `The ${what} failed:\n${ensureError(error).message.slice(-3000)}`,
      }
    } finally {
      this.busy.delete(id)
    }
  }

  /** What the setup card offers. */
  options(): AgentMotionOptions {
    return {
      composers: MOTION_MUSIC_ENGINES.map((id) => ({ id, ...MOTION_MUSIC_ENGINE_INFO[id] })),
      defaultLengthSec: DEFAULT_MOTION_REEL_LENGTH,
      defaultRatio: DEFAULT_MOTION_REEL_RATIO,
      lengths: [...MOTION_REEL_LENGTHS],
      ratios: [...MOTION_REEL_RATIOS],
      tracks: motionReelTracks().map((track) => ({
        bpm: track.bpm,
        id: track.id,
        previewUrl: presetUrl(track.file),
        title: track.title,
      })),
      types: MOTION_REEL_TYPES.map((id) => ({ id, ...MOTION_REEL_TYPE_INFO[id] })),
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

  /** The agent made the reel's own music (`motion_music`) the way it names (else the way the user
   *  picked): composed by itself, or by a music model and fitted to whole bars; the grid
   *  (reel.json) follows the new music, so beat-timed scenes follow it too. */
  private async compose(
    id: string,
    session: AgentSession,
    projectDir: string,
    args: unknown,
  ): Promise<ToolCallResult> {
    const view = session.motionReel as AgentMotionSetupView
    const asked = (args as null | Record<string, unknown>)?.['engine']
    if (asked !== undefined && !isMotionMusicEngine(asked))
      return { success: false, text: `engine is ${MOTION_MUSIC_ENGINES.join(' or ')}.` }
    const engine: MotionMusicEngine =
      asked ?? motionMusicEngineOf(view.music.source === 'agent' ? view.music.engine : undefined)
    if (engine === 'composer') return this.composed(id, view, projectDir)
    const request = parseComposeRequest(args)
    if (typeof request === 'string') return { success: false, text: request }
    const composed = await composeMusic(
      request,
      view.lengthSec,
      path.join(projectDir, 'music'),
      engine,
    )
    const title = `${MOTION_MUSIC_ENGINE_INFO[engine].label}: ${request.prompt.replace(/\s+/g, ' ').slice(0, 40)}`
    const { reel } = await this.refit(id, view, { file: composed.file, title })
    const hits = reel.strongHits.map((t) => beatAt(reel, t)).slice(0, 8)
    const tempoNote =
      request.bpm && Math.abs(reel.bpm - request.bpm) > 2
        ? ` (asked for ${request.bpm}; the model played ${reel.bpm}, and the grid follows what it played)`
        : ''
    return {
      success: true,
      text: [
        `Composed and fitted (${composed.model}). The reel is now ${reel.lengthSec} s: ${reel.bars} bars of ${reel.beatsPerBar} at ${reel.bpm} BPM${tempoNote}.`,
        `public/music.wav and public/reel.json are rewritten; scenes timed with beat() and bar() follow the new grid. Re-check anything that assumed the old bar count (${view.bars}).`,
        hits.length
          ? `Its strongest hits are at beats ${hits.join(', ')}.`
          : 'It has no stand-out hits: put impacts on bar starts.',
        'Compose again only if the user wants different music: each one is a paid generation.',
      ].join(' '),
    }
  }

  /** The music the agent composed in its own shell (`reel/music/`): read as data, never run, and
   *  put under the reel with its exact grid. */
  private async composed(
    id: string,
    view: AgentMotionSetupView,
    projectDir: string,
  ): Promise<ToolCallResult> {
    // A reel set up before the composer, or with other music: install it now.
    const installed = ensureComposer(projectDir, {
      bpm: view.bpm,
      lengthSec: view.lengthSec,
      title: composerTitle(view.subject),
    })
    const score = readComposedMusic(projectDir, view.lengthSec)
    if (typeof score === 'string')
      return {
        success: false,
        text: installed
          ? `The composer was not in this reel yet: it is now in reel/music/tools/ with reel/music/reel.config.mjs (set its bpm). ${score}`
          : score,
      }
    const { reel } = await this.refit(id, view, {
      file: score.file,
      grid: score.grid,
      title: score.title,
    })
    const hits = reel.strongHits.map((t) => beatAt(reel, t)).slice(0, 8)
    return {
      success: true,
      text: [
        `${score.title}. Put under the reel: ${reel.lengthSec} s, ${reel.bars} bars of ${reel.beatsPerBar} at ${reel.bpm} BPM.`,
        'public/music.wav and public/reel.json are rewritten from your score itself, so its beats, kicks, snares, motif notes, chords and sections are exact. Re-check anything that assumed the old grid.',
        hits.length
          ? `Its section entries that raise the energy are at beats ${hits.join(', ')}.`
          : '',
        ...score.qc,
        'Checked by measurement only: tell the user what the QC measured, never how it sounds; they hear it in the next render. Compose again freely (it is free) when the plan changes.',
      ]
        .filter(Boolean)
        .join(' '),
    }
  }

  private musicFor(id: string, setup: MotionReelSetup): null | ReelMusicSource {
    // No music, or the agent composes it first (`motion_music`).
    if (setup.music.source === 'none' || setup.music.source === 'agent') return null
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

  /** The choices motion_setup takes, for the agent to offer. */
  private optionsText(): string {
    const options = this.options()
    return [
      'Types (type: label, then what it is):',
      ...options.types.map((t) => `- ${t.id}: ${t.label}. ${t.description}`),
      `Lengths (lengthSec): ${options.lengths.join(', ')} (default ${options.defaultLengthSec}). Frames (ratio): ${options.ratios.join(', ')} (default ${options.defaultRatio}).`,
      'Library tracks (music "library", musicId: title, tempo):',
      ...options.tracks.map((t) => `- ${t.id}: ${t.title}, ${t.bpm} BPM`),
      'Or music "upload" (the user\'s own file through the paperclip; musicId: its path), "none", or "agent": you make it with motion_music right after the setup, in the way the user picks (musicEngine):',
      ...MOTION_MUSIC_ENGINES.map(
        (e) =>
          `- ${e}: ${MOTION_MUSIC_ENGINE_INFO[e].label} (${MOTION_MUSIC_ENGINE_INFO[e].cost}). ${MOTION_MUSIC_ENGINE_INFO[e].description}`,
      ),
    ].join('\n')
  }

  private async prepare(
    id: string,
    session: AgentSession,
    setup: MotionReelSetup,
    music: null | ReelMusicSource,
  ): Promise<void> {
    const warn = (line: string) => this.sessions.emitNotice(id, line)
    this.sessions.setFlowWorking(id, true)
    try {
      const { hasReference, view } = await this.ready(id, setup, music)
      this.sessions.setFlowWorking(id, false)
      this.sessions.startMotionReel(
        id,
        view,
        motionReelKickoff(
          session.harness ?? 'codex',
          hasReference,
          setup.music.source === 'agent' ? setup.music.engine : null,
        ),
      )
    } catch (error) {
      logger.warn(`Motion Reel setup for ${id} failed: ${ensureError(error).message}`)
      this.sessions.setFlowWorking(id, false)
      warn(`Couldn't set up the reel: ${ensureError(error).message.split('\n')[0]?.slice(0, 300)}`)
      this.sessions.emitAutonomousEvent(id, { type: 'motion_setup_request' })
    }
  }

  /**
   * Readies the reel's project in the chat's folder (installing Remotion the first time) and
   * reads its reference: what the setup card and an Advanced chat's motion_setup both do.
   * Progress is ReelMakeEasy talking (a plain message); a reference that can't be read is a
   * notice, and the reel goes on without it.
   */
  private async ready(
    id: string,
    setup: MotionReelSetup,
    music: null | ReelMusicSource,
  ): Promise<{ hasReference: boolean; view: AgentMotionSetupView }> {
    const say = (line: string) => this.sessions.emitMessage(id, line)
    await ensureMotionReelRuntime(say)
    const workspace = this.sessions.workingDir(id)
    const prepared = await prepareReelProject({ music, setup, workspace })
    let referenceNote: null | string = null
    if (setup.reference) {
      try {
        referenceNote = await readReference(setup.reference, prepared.projectDir, say)
      } catch (error) {
        logger.warn(`Reference for ${id} not read: ${ensureError(error).message}`)
        this.sessions.emitNotice(
          id,
          `Couldn't read the reference (${ensureError(error).message.split('\n')[0]?.slice(0, 160)}); going on without it.`,
        )
      }
    }
    if (referenceNote)
      fs.appendFileSync(
        path.join(prepared.projectDir, 'brief.md'),
        `- **Reference files:** \`${REFERENCE_DIR}/\`: ${referenceNote}\n`,
      )
    const view: AgentMotionSetupView = {
      ...setup,
      bars: prepared.reel.bars,
      bpm: prepared.reel.bpm,
      musicTitle: music?.title ?? null,
      reelSec: prepared.reel.lengthSec,
      typeLabel: MOTION_REEL_TYPE_INFO[setup.type].label,
    }
    return { hasReference: !!referenceNote, view }
  }

  /** Puts new music under the reel (its grid rewritten) and shows the updated setup. */
  private async refit(id: string, view: AgentMotionSetupView, music: ReelMusicSource) {
    const prepared = await prepareReelProject({
      music,
      musicOnly: true,
      setup: setupFrom(view),
      workspace: this.sessions.workingDir(id),
    })
    const { reel } = prepared
    this.sessions.updateMotionReel(id, {
      ...view,
      bars: reel.bars,
      bpm: reel.bpm,
      musicTitle: music.title,
      reelSec: reel.lengthSec,
    })
    return prepared
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
      text: `Rendered the reel (${reel.lengthSec} s, ${reel.bars} bars at ${reel.bpm} BPM) and showed it to the user. The file is ${REEL_DIR}/out/reel.mp4.\n\nSync check (the picture against the music):\n${result.sync.lines.join('\n')}${result.sync.passes ? '' : '\n\nFix every miss listed above at the beats it names, then render again.'}`,
    }
  }

  /**
   * An Advanced chat's motion_setup: with no type, the options to choose from; otherwise the
   * setup checked like the card's (a reference only from a link the user typed), the project
   * readied, the chat's setup card shown as chosen, and what to read next. Again later: the
   * project is readied anew around the agent's scenes and plan.
   */
  private async setupFromChat(
    id: string,
    session: AgentSession,
    args: unknown,
  ): Promise<ToolCallResult> {
    if (session.mode !== 'motion_free')
      return {
        success: false,
        text: "This chat's reel is set up with its setup card, not motion_setup.",
      }
    let setup: MotionReelSetup | null
    let music: null | ReelMusicSource
    try {
      setup = motionSetupFromTool(args, this.sessions.userTexts(id))
      if (!setup) return { success: true, text: this.optionsText() }
      music = this.musicFor(id, setup)
    } catch (error) {
      if (error instanceof MotionSetupError) return { success: false, text: error.message }
      throw error
    }
    const again = !!session.motionReel
    // Music the agent already made for this reel stays through a new setup made the same way (a
    // new type or frame needs no new paid track): its newest take, fitted to the length asked
    // for now. A score an earlier version wrote only while the length holds (its bars were the
    // old reel's).
    const before = session.motionReel
    const sameWay =
      setup.music.source === 'agent' &&
      before?.music.source === 'agent' &&
      motionMusicEngineOf(before.music.engine) === setup.music.engine
    const made = sameWay ? newestMade(path.join(this.sessions.workingDir(id), REEL_DIR)) : null
    const composed = made && before?.musicTitle ? keptMusic(made, before, setup) : null
    if (composed) music = composed
    this.preparing.add(id)
    try {
      const { hasReference, view } = await this.ready(id, setup, music)
      this.sessions.updateMotionReel(id, view)
      const musicNote = view.musicTitle
        ? `music: ${view.musicTitle}`
        : setup.music.source === 'agent'
          ? `music: yours to make (${MOTION_MUSIC_ENGINE_INFO[setup.music.engine].label})`
          : 'no music'
      return {
        success: true,
        text: [
          `\`reel/\` is ${again ? 'set up again' : 'ready'}: ${view.typeLabel}, ${view.ratio}, ${view.reelSec} s (${view.bars} bars at ${view.bpm} BPM), ${musicNote}. The user sees the setup in the chat.`,
          ...(composed
            ? [
                'The music you made is kept: make it again only if the user asks for different music.',
              ]
            : []),
          motionReelNextSteps(
            session.harness ?? 'codex',
            hasReference,
            setup.music.source === 'agent' && !composed ? setup.music.engine : null,
          ),
          ...(again
            ? [
                'Your scenes and plan were kept: re-check their timing against the new grid before rendering.',
              ]
            : []),
        ].join(' '),
      }
    } catch (error) {
      logger.warn(`Motion Reel setup for ${id} failed: ${ensureError(error).message}`)
      return {
        success: false,
        text: `Couldn't set up the reel: ${ensureError(error).message.split('\n')[0]?.slice(0, 300)}`,
      }
    } finally {
      this.preparing.delete(id)
    }
  }

  private async stills(id: string, projectDir: string, args: unknown): Promise<ToolCallResult> {
    const reel = readReelJson(projectDir)
    const beats = parseStillBeats(args, MAX_STILLS)
    const frames = beats.map((beat) => frameOfBeat(reel, beat))
    // A folder per call: the chat keeps showing earlier stills after the next look.
    const outDir = path.join(projectDir, 'out', 'stills', String(Date.now()))
    const files = await renderStills(projectDir, frames, outDir)
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

/** The setup card's choices back out of the chat's saved setup. */
function setupFrom(view: AgentMotionSetupView): MotionReelSetup {
  return {
    lengthSec: view.lengthSec as MotionReelSetup['lengthSec'],
    // A chat saved when music could be written in code reads as made by the default model.
    music:
      view.music.source === 'agent'
        ? { engine: motionMusicEngineOf(view.music.engine), source: 'agent' }
        : view.music,
    ratio: view.ratio,
    ...(view.reference ? { reference: view.reference } : {}),
    subject: view.subject,
    // A chat saved when reels had styles reads as its type.
    type: motionReelTypeOf(view) ?? DEFAULT_MOTION_REEL_TYPE,
  }
}

/**
 * Music the agent made that a new setup keeps (`newestMade`): a model's track, fitted to the new
 * length; a score it composed (with its exact grid again) or one an earlier version wrote (a
 * plain track) only while the length holds, as its bars are the reel's. Null: make it anew.
 */
function keptMusic(
  file: string,
  before: AgentMotionSetupView,
  setup: MotionReelSetup,
): null | ReelMusicSource {
  const name = path.basename(file)
  const title = before.musicTitle ?? ''
  if (name.startsWith('composer-')) {
    if (before.lengthSec !== setup.lengthSec) return null
    const score = keptComposerScore(file)
    return score ? { file, grid: score.grid, title } : null
  }
  if (name.startsWith('score-') && before.lengthSec !== setup.lengthSec) return null
  return { file, title }
}

/** The newest music the agent made for the reel in `projectDir` (`motion_music`), if any: a
 *  model's track, a score it composed, or a score an earlier version wrote there. */
function newestMade(projectDir: string): null | string {
  const dir = path.join(projectDir, 'music')
  let names: string[]
  try {
    names = fs.readdirSync(dir)
  } catch {
    return null
  }
  // Named composed-<time>.mp3, composer-<time>.wav (or score-<time>.wav): the newest has the
  // largest time.
  const newest = names
    .map((name) => ({
      name,
      time: Number(/^(?:composed|composer|score)-(\d+)\.(?:mp3|wav)$/.exec(name)?.[1]),
    }))
    .filter((m) => Number.isFinite(m.time))
    .sort((a, b) => a.time - b.time)
    .at(-1)
  return newest ? path.join(dir, newest.name) : null
}
