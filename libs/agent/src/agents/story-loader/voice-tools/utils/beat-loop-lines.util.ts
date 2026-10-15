/**
 * A loop short's narration lines, each said once in the loop's voice and kept.
 *
 * `make_beat_loop` says every line before the user is asked to pay (`checkBeatLoopLines`) and
 * measures it by the voice-over's own rule (`fitBeatLoopLine`: 3.45 s, at most 1.3x), so a
 * line too long for its clip is fixed in the storyboard, not found once the clips are paid
 * for. The run then says the lines through `speakBeatLoopLine` too, and gets the very audio
 * that was checked back: the audio is kept on this computer by voice, model and words
 * (`<data dir>/cache/beat-loop-lines`), so an unchanged line is never paid for twice and
 * sounds the same on every run.
 */
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { logger } from '@reelmakeeasy/common/logger'
import { fitBeatLoopLine } from '@reelmakeeasy/common/long-take/beat-loop-craft'
import { probeMediaDurationSec } from '@reelmakeeasy/common/long-take/bgm-mix'
import { dataDir } from '@reelmakeeasy/common/storage/file-store'
import { defaultLoopVoiceId } from '@reelmakeeasy/common/tts/default-voice'
import { localTtsSupports } from '@reelmakeeasy/common/tts/local-tts'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import { detectSilences, speechSpans } from '@reelmakeeasy/common/utils/silence'

import {
  generateTTSAudio,
  resolveTtsModel,
  resolveVoiceRoute,
  type VoiceRoute,
} from './provider-tts.util'

/** A line's own edges: quieter than this, for at least this long, is not speech. */
export const LINE_EDGE_SILENCE = { minSeconds: 0.03, noiseDb: -40 } as const
/** Lines no run has used for this long are dropped from the cache. */
const CACHE_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000
const PRUNE_EVERY_MS = 60 * 60 * 1000
/** Lines said at once while checking a storyboard (paid voices answer in seconds). */
const CHECK_CONCURRENCY = 3

let lastPruned = 0

export interface BeatLoopLineCheck {
  clipId: string
  clipIndex: number
  /** Whether the line fits its clip, sped up to 1.3x at most. */
  fits: boolean
  narration: string
  /** Its speech, from the first word to the last, before any speed-up. */
  seconds: number
  /** 1, or the speed-up the line needs. */
  tempo: number
}

export interface BeatLoopLineInput {
  /** Where the audio is kept (default: `<data dir>/cache/beat-loop-lines`). */
  cacheDir?: string
  /** The project the spend is counted on, when there is one yet. */
  projectId?: string
  route: VoiceRoute
  /** The narration as written (delivery tags included: each voice reads them its own way). */
  text: string
  ttsModel: string
  userContext?: { userEmail: string; userId: string }
}

export interface BeatLoopLinesCheck {
  /** The voice runs free on this computer (Kokoro or Qwen3 on the local voice server). */
  free: boolean
  lines: BeatLoopLineCheck[]
  provider: VoiceRoute['provider']
  /** The voice the lines were said in (one that can't run here is replaced by the loop's
   *  default voice: `resolveLoopVoiceRoute`). */
  voiceId: string
}

/**
 * Says every line in the voice, as the loop's run will, and measures each against the fit
 * rule. Lines already said in this voice come from the cache. Throws when a line can't be
 * said (the reason, as the voice gave it) or comes back silent.
 */
export async function checkBeatLoopLines(input: {
  cacheDir?: string
  clips: readonly { id: string; narration: string }[]
  /** True once the user stopped the chat: no line starts after that (the check throws). */
  shouldStop?: () => boolean
  userContext?: { userEmail: string; userId: string }
  voiceId: string
}): Promise<BeatLoopLinesCheck> {
  const route = await resolveLoopVoiceRoute(input.voiceId)
  const ttsModel = resolveTtsModel(route.provider)
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'beat-loop-check-'))
  try {
    const lines = await mapLimited(input.clips, CHECK_CONCURRENCY, async (clip, clipIndex) => {
      if (input.shouldStop?.()) throw new Error('Stopped before every line was said')
      const line: BeatLoopLineInput = {
        cacheDir: input.cacheDir,
        route,
        text: clip.narration,
        ttsModel,
        userContext: input.userContext,
      }
      const { audioBuffer } = await speakBeatLoopLine(line)
      const audioPath = path.join(
        tempDir,
        `line_${clipIndex + 1}${lineAudioExtension(audioBuffer)}`,
      )
      await fs.promises.writeFile(audioPath, audioBuffer)
      const speech = await measureSpokenLine(line, audioPath).catch((error: unknown) => {
        throw new Error(
          `The voice sent back audio that can't be read for clip ${clip.id}: ${ensureError(error).message}`,
        )
      })
      if (!speech) throw new Error(`The voice came back silent for clip ${clip.id}`)
      const { fits, tempo } = fitBeatLoopLine(speech.seconds)
      return {
        clipId: clip.id,
        clipIndex,
        fits,
        narration: clip.narration,
        seconds: Math.round(speech.seconds * 1000) / 1000,
        tempo,
      }
    })
    const free =
      (route.provider === 'kokoro' || route.provider === 'qwen3') &&
      (await localTtsSupports(route.provider))
    return { free, lines, provider: route.provider, voiceId: route.voiceId }
  } finally {
    await fs.promises.rm(tempDir, { force: true, recursive: true })
  }
}

/**
 * The route a loop's lines are said on: the voice named, else the loop's own default
 * (`defaultLoopVoiceId`: a free voice on this computer when one is installed). A voice that
 * can't run here (`substitutedFrom`: a clone with no key, a retired voice) falls back to that
 * same default too, never to the paid default voice the router puts in its place while a free
 * one is installed. A Gemini voice without GEMINI_API_KEY is refused by the router, never
 * swapped.
 */
export async function resolveLoopVoiceRoute(voiceId?: string): Promise<VoiceRoute> {
  if (voiceId) {
    const route = await resolveVoiceRoute(voiceId)
    if (!route.substitutedFrom) return route
    const fallback = await resolveVoiceRoute(await defaultLoopVoiceId())
    return { ...fallback, substitutedFrom: route.substitutedFrom }
  }
  return resolveVoiceRoute(await defaultLoopVoiceId())
}

/** Drops a kept line (it came back silent or unreadable), so the next run says it again. */
export async function forgetBeatLoopLine(input: BeatLoopLineInput): Promise<void> {
  await fs.promises.rm(cachePath(input), { force: true })
}

/** The file type a voice sent back, so FFmpeg reads it by its name too. */
export function lineAudioExtension(buffer: Buffer): string {
  const head = buffer.subarray(0, 4).toString('latin1')
  if (head === 'RIFF') return '.wav'
  if (head === 'OggS') return '.ogg'
  if (head === 'fLaC') return '.flac'
  return '.mp3'
}

/** Where a line's speech starts and ends (its lead-in and tail of silence left out); null
 *  when the audio is silent throughout. */
export async function measureLineSpeech(
  audioPath: string,
): Promise<null | { end: number; seconds: number; start: number }> {
  const length = await probeMediaDurationSec(audioPath)
  const { silences } = await detectSilences(audioPath, {
    ...LINE_EDGE_SILENCE,
    durationSeconds: length,
  })
  const spans = speechSpans(silences, length, LINE_EDGE_SILENCE.minSeconds)
  const start = spans[0]?.start
  const end = spans.at(-1)?.end
  if (start === undefined || end === undefined || end <= start) return null
  return { end, seconds: end - start, start }
}

/**
 * Measures a line `speakBeatLoopLine` said (its audio written to `audioPath`), as
 * `measureLineSpeech` does. Audio that is silent throughout (null) or that can't be read (the
 * error is passed on) is dropped from the kept lines, so the next try asks the voice again
 * instead of reading the same bad audio for good.
 */
export async function measureSpokenLine(
  line: BeatLoopLineInput,
  audioPath: string,
): Promise<null | { end: number; seconds: number; start: number }> {
  let speech: Awaited<ReturnType<typeof measureLineSpeech>>
  try {
    speech = await measureLineSpeech(audioPath)
  } catch (error) {
    await forgetBeatLoopLine(line).catch(() => undefined)
    throw error
  }
  if (!speech) await forgetBeatLoopLine(line)
  return speech
}

/**
 * One line in one voice: the kept audio when this voice already said these words, else a
 * new TTS call, kept for next time. A cache that can't be read or written is passed by.
 */
export async function speakBeatLoopLine(
  input: BeatLoopLineInput,
): Promise<{ audioBuffer: Buffer; cached: boolean }> {
  const file = cachePath(input)
  const kept = await fs.promises.readFile(file).catch(() => null)
  if (kept?.length) {
    const now = new Date()
    await fs.promises.utimes(file, now, now).catch(() => undefined)
    return { audioBuffer: kept, cached: true }
  }
  const { audioBuffer } = await generateTTSAudio(
    input.text,
    input.route.voiceId,
    input.ttsModel,
    input.route.provider,
    input.userContext,
    { languageCode: 'en', ...(input.projectId ? { projectId: input.projectId } : {}) },
  )
  await keep(file, audioBuffer)
  return { audioBuffer, cached: false }
}

function cachePath(input: BeatLoopLineInput): string {
  const key = createHash('sha256')
    .update(JSON.stringify([input.route.provider, input.route.voiceId, input.ttsModel, input.text]))
    .digest('hex')
  return path.join(cacheRoot(input.cacheDir), `${key}.audio`)
}

const cacheRoot = (cacheDir?: string): string =>
  cacheDir ?? path.join(dataDir(), 'cache', 'beat-loop-lines')

/** Writes the audio whole (a temp file, then a rename), then now and then drops old lines. */
async function keep(file: string, audio: Buffer): Promise<void> {
  const temp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`
  try {
    await fs.promises.mkdir(path.dirname(file), { recursive: true })
    await fs.promises.writeFile(temp, audio)
    await fs.promises.rename(temp, file)
  } catch (error) {
    await fs.promises.rm(temp, { force: true }).catch(() => undefined)
    logger.warn(`[beat-loop] Could not keep a line's audio: ${ensureError(error).message}`)
    return
  }
  if (Date.now() - lastPruned > PRUNE_EVERY_MS) {
    lastPruned = Date.now()
    await prune(path.dirname(file)).catch(() => undefined)
  }
}

/** Runs `fn` over the items, at most `limit` at once, keeping their order. */
async function mapLimited<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++
      results[index] = await fn(items[index] as T, index)
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

async function prune(dir: string): Promise<void> {
  const cutoff = Date.now() - CACHE_MAX_AGE_MS
  for (const name of await fs.promises.readdir(dir)) {
    const file = path.join(dir, name)
    const stat = await fs.promises.stat(file).catch(() => null)
    if (stat?.isFile() && stat.mtimeMs < cutoff) await fs.promises.rm(file, { force: true })
  }
}
