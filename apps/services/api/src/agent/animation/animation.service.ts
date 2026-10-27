import fs from 'node:fs'
import path from 'node:path'

import { ANIMATION_LOOKS, animationLook } from '@reelmakeeasy/common/animation/looks'
import { Logger } from '@reelmakeeasy/common/logger'
import { motionReelTrack, motionReelTracks } from '@reelmakeeasy/common/motion-reel/music'
import {
  MOTION_MUSIC_ENGINE_INFO,
  type MotionMusicEngine,
} from '@reelmakeeasy/common/motion-reel/reel-config'
import { storeUri } from '@reelmakeeasy/common/storage/address'
import { uploadToStore } from '@reelmakeeasy/common/storage/stored-files'
import { presetPath, presetUrl } from '@reelmakeeasy/common/storage/presets'
import {
  DEFAULT_ASR_MODEL_ID,
  generateForcedAlignment,
  speechToText,
} from '@reelmakeeasy/common/asr/elevenlabs'
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
import { animationKickoff, animationNextSteps } from '../agent-brief'
import { composeMusic, parseComposeRequest } from '../motion-reel/motion-music'
import { MAX_STILLS, renderReel, renderStills, typeCheck } from '../motion-reel/motion-render'
import type { ReelMusicSource } from '../motion-reel/motion-project'
import { ensureMotionReelRuntime } from '../motion-reel/motion-runtime'
import type { ToolCallResult } from '../tools/agent-tools'

import {
  ANIMATION_DIR,
  prepareAnimationProject,
  readAnimationJson,
  writeAnimationJson,
} from './animation-project'
import {
  ANIMATION_MUSIC_ENGINES,
  animationSetupFromTool,
  AnimationSetupError,
  parseAnimationSetup,
  voiceReadiness,
} from './animation-setup'
import { parseVoiceArgs, recordVoices, VoiceArgsError, type VoiceDeps } from './animation-voice'

const logger = new Logger('AnimationService')

/** Why the 2D look can't be picked: its characters need designed voices. */
export const NO_DESIGNED_VOICES = 'Needs Qwen3 voices on this computer or a fal key.'

/** Where rendered animations are stored (served at /api/files/agent-animation/...). */
const STORE_FOLDER = 'agent-animation'
/** The project's one composition (presets/animation/template/src/Root.tsx). */
const COMPOSITION = 'Animation'

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
  transcribe: async (file) =>
    (
      await speechToText({
        file: new Blob([fs.readFileSync(file)]),
        languageCode: 'en',
        modelId: DEFAULT_ASR_MODEL_ID,
      })
    ).words
      .filter((w) => w.type === 'word')
      .map((w) => w.text),
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
  private renders = 0

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
    if (tool === 'animation_setup') return await this.setupFromChat(id, session, args)
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
      if (tool === 'animation_voice')
        return await this.recordVoice(session.animation, projectDir, args)
      if (tool === 'animation_music') return await this.compose(id, session.animation, args)
      if (tool !== 'animation_still' && tool !== 'animation_render')
        return { success: false, text: `Unknown tool ${tool}.` }
      const errors = await typeCheck(projectDir)
      if (errors)
        return {
          success: false,
          text: `The animation doesn't type-check; fix these first:\n${errors}`,
        }
      return tool === 'animation_still'
        ? await this.stills(id, projectDir, args)
        : await this.render(id, projectDir)
    } catch (error) {
      if (error instanceof VoiceArgsError || error instanceof AnimationSetupError)
        return { success: false, text: error.message }
      return { success: false, text: `It failed:\n${ensureError(error).message.slice(-3000)}` }
    } finally {
      this.busy.delete(id)
    }
  }

  /** animation_music: Claude composes the music with the model the user picked (else the one
   *  it names), then it is fitted to the length and put under the voice. */
  private async compose(
    id: string,
    setup: AgentAnimationSetupView,
    args: unknown,
  ): Promise<ToolCallResult> {
    const asked = (args as null | Record<string, unknown>)?.['engine']
    if (asked !== undefined && !(ANIMATION_MUSIC_ENGINES as readonly unknown[]).includes(asked))
      return { success: false, text: `engine is ${ANIMATION_MUSIC_ENGINES.join(' or ')}.` }
    const engine = (asked ??
      (setup.music.source === 'agent'
        ? setup.music.engine
        : ANIMATION_MUSIC_ENGINES[0])) as MotionMusicEngine
    const request = parseComposeRequest(args)
    if (typeof request === 'string') return { success: false, text: request }
    const workspace = this.sessions.workingDir(id)
    const composed = await composeMusic(
      request,
      setup.lengthSec,
      path.join(workspace, ANIMATION_DIR, 'music'),
      engine,
    )
    const title = `${MOTION_MUSIC_ENGINE_INFO[engine].label}: ${request.prompt.replace(/\s+/g, ' ').slice(0, 40)}`
    await prepareAnimationProject({
      music: { file: composed.file, title },
      musicOnly: true,
      setup: setupFrom(setup),
      workspace,
    })
    this.sessions.updateAnimation(id, { ...setup, musicTitle: title })
    return {
      success: true,
      text: `Made the music (${composed.model}) and put it under the voice: public/music.wav, ${setup.lengthSec} s, fading out at the end (the kit ducks it while anyone speaks). Make it again only if the user wants different music: each one is a paid generation.`,
    }
  }

  private async render(id: string, projectDir: string): Promise<ToolCallResult> {
    const result = await renderReel(projectDir, {
      composition: COMPOSITION,
      name: 'animation',
      sync: false,
    })
    const stamp = `${Date.now()}-${++this.renders}`
    const videoKey = `${STORE_FOLDER}/${id}/animation-${stamp}.mp4`
    const posterKey = `${STORE_FOLDER}/${id}/animation-${stamp}.jpg`
    await uploadToStore(result.file, storeUri(videoKey))
    await uploadToStore(result.poster, storeUri(posterKey))
    this.sessions.emitAutonomousEvent(id, {
      itemId: `animation-${stamp}`,
      posterUrl: storeUri(posterKey),
      type: 'motion_video',
      videoUrl: storeUri(videoKey),
    })
    return {
      success: true,
      text: `Rendered the animation and showed it to the user. The file is ${ANIMATION_DIR}/out/animation.mp4. You can't hear it: say so, and ask the user to listen to the voices.`,
    }
  }

  /** An Advanced chat's animation_setup: with no look, the options to choose from; otherwise
   *  the setup checked like the card's, the project readied, the chat's card shown as chosen,
   *  and what to read next. Again later: readied anew around Claude's scenes and voices. */
  private async setupFromChat(
    id: string,
    session: AgentSession,
    args: unknown,
  ): Promise<ToolCallResult> {
    if (session.mode !== 'animation_free')
      return {
        success: false,
        text: "This chat's animation is set up with its setup card, not animation_setup.",
      }
    let setup: AgentAnimationSetup | null
    let music: null | ReelMusicSource
    try {
      setup = animationSetupFromTool(args)
      if (!setup) return { success: true, text: await this.optionsText() }
      music = this.musicFor(id, setup)
    } catch (error) {
      if (error instanceof AnimationSetupError) return { success: false, text: error.message }
      throw error
    }
    const again = !!session.animation
    // Music Claude already made stays through a new setup made the same way (a new length or
    // look needs no new paid track): its newest take, fitted to the length asked for now.
    const before = session.animation
    const sameWay =
      setup.music.source === 'agent' &&
      before?.music.source === 'agent' &&
      before.music.engine === setup.music.engine
    const made = sameWay
      ? newestComposed(path.join(this.sessions.workingDir(id), ANIMATION_DIR, 'music'))
      : null
    const kept = made && before?.musicTitle ? { file: made, title: before.musicTitle } : null
    if (kept) music = kept
    this.preparing.add(id)
    try {
      const view = await this.ready(id, setup, music)
      this.sessions.updateAnimation(id, view)
      const musicNote = view.musicTitle
        ? `music: ${view.musicTitle}`
        : setup.music.source === 'agent'
          ? `music: yours to make (${MOTION_MUSIC_ENGINE_INFO[setup.music.engine].label})`
          : 'no music'
      return {
        success: true,
        text: [
          `\`${ANIMATION_DIR}/\` is ${again ? 'set up again' : 'ready'}: ${view.lookLabel}, about ${view.lengthSec} s, ${musicNote}. The user sees the setup in the chat.`,
          ...(kept
            ? [
                'The music you made is kept: make it again only if the user asks for different music.',
              ]
            : []),
          animationNextSteps(setup, !again, setup.music.source === 'agent' && !kept),
          ...(again
            ? [
                'Your scenes were kept, and so were the voices: record again only if the script changed.',
              ]
            : []),
        ].join(' '),
      }
    } catch (error) {
      logger.warn(`Claude Animation setup for ${id} failed: ${ensureError(error).message}`)
      return {
        success: false,
        text: `Couldn't set up the animation: ${ensureError(error).message.split('\n')[0]?.slice(0, 300)}`,
      }
    } finally {
      this.preparing.delete(id)
    }
  }

  /** The choices animation_setup takes, for Claude to offer. */
  private async optionsText(): Promise<string> {
    const options = await this.options()
    return [
      'Looks (lookId: label, its lengths in seconds, then what it is):',
      ...options.looks.map(
        (l) =>
          `- ${l.id}: ${l.label} (lengths ${l.lengths.join(', ')}). ${l.description}${l.disabledReason ? ` Not available here: ${l.disabledReason}` : ''}`,
      ),
      'Library tracks (music "library", musicId):',
      ...options.tracks.map((t) => `- ${t.id}: ${t.title}`),
      'Or music "upload" (the user\'s own file through the paperclip; musicId: its path), "none", or "agent": you make it with animation_music right after the setup, with the music model the user picks (musicEngine):',
      ...ANIMATION_MUSIC_ENGINES.map(
        (e) =>
          `- ${e}: ${MOTION_MUSIC_ENGINE_INFO[e].label} (${MOTION_MUSIC_ENGINE_INFO[e].cost}). ${MOTION_MUSIC_ENGINE_INFO[e].description}`,
      ),
    ].join('\n')
  }

  /** animation_still: frames at the seconds asked, shown to Claude and the user. */
  private async stills(id: string, projectDir: string, args: unknown): Promise<ToolCallResult> {
    const seconds = parseStillSeconds(args)
    const spec = readAnimationJson(projectDir)
    const lastFrame = Math.round(videoSeconds(projectDir, spec) * spec.fps) - 1
    const frames = seconds.map((t) => Math.min(lastFrame, Math.round(t * spec.fps)))
    // A folder per call: the chat keeps showing earlier stills after the next look.
    const outDir = path.join(projectDir, 'out', 'stills', String(Date.now()))
    const files = await renderStills(projectDir, frames, outDir, COMPOSITION)
    for (const file of files) this.sessions.emitImage(id, file)
    const lines = seconds.map(
      (t, i) =>
        `- ${t} s (frame ${frames[i]}): ${ANIMATION_DIR}/${path.relative(projectDir, files[i] as string)}`,
    )
    return {
      success: true,
      text: `Rendered ${files.length} stills (the user sees them too). Open each file and look at it:\n${lines.join('\n')}`,
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
      composers: ANIMATION_MUSIC_ENGINES.map((id) => ({ id, ...MOTION_MUSIC_ENGINE_INFO[id] })),
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

/** The newest track Claude made (`animation_music` writes `composed-<time>.mp3`), if any. */
function newestComposed(dir: string): null | string {
  let names: string[]
  try {
    names = fs.readdirSync(dir)
  } catch {
    return null
  }
  const newest = names
    .map((name) => ({ name, time: Number(/^composed-(\d+)\.mp3$/.exec(name)?.[1]) }))
    .filter((m) => Number.isFinite(m.time))
    .sort((a, b) => a.time - b.time)
    .at(-1)
  return newest ? path.join(dir, newest.name) : null
}

/** The seconds an animation_still call asks for: up to 6 distinct, non-negative numbers. */
export function parseStillSeconds(raw: unknown): number[] {
  const text =
    raw &&
    typeof raw === 'object' &&
    typeof (raw as Record<string, unknown>)['seconds'] === 'string'
      ? ((raw as Record<string, unknown>)['seconds'] as string)
      : ''
  const seconds = [
    ...new Set(
      text
        .split(/[\s,]+/)
        .filter(Boolean)
        .map(Number)
        .filter((n) => Number.isFinite(n) && n >= 0),
    ),
  ]
  if (!seconds.length)
    throw new AnimationSetupError('Pass the moments to look at, in seconds, e.g. "0, 4.5, 12".')
  return seconds.slice(0, MAX_STILLS)
}

/** How long the video is: its length, or the voice plus a second, whichever is longer (as the
 *  project's clock counts it). */
function videoSeconds(projectDir: string, spec: { lengthSec: number }): number {
  let lastEnd = 0
  try {
    const lines = JSON.parse(
      fs.readFileSync(path.join(projectDir, 'public', 'voice', 'lines.json'), 'utf8'),
    ) as { end: number }[]
    lastEnd = lines.at(-1)?.end ?? 0
  } catch {
    lastEnd = 0
  }
  return Math.max(spec.lengthSec, lastEnd + 1)
}

/** The setup card's choices back out of the chat's saved setup. */
function setupFrom(view: AgentAnimationSetupView): AgentAnimationSetup {
  return {
    lengthSec: view.lengthSec,
    lookId: view.lookId,
    music: view.music,
    subject: view.subject,
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
