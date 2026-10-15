import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { captionWords, captionWordText, type TimedWord } from '@reelmakeeasy/common/asr/align-text'
import { type CloudAsrBackend, resolveAsrBackend } from '@reelmakeeasy/common/asr/asr-backend'
import {
  type CaptionTiming,
  type CaptionTimingSource,
  type FallbackMode,
  timeCaptionWordsFromAudio,
} from '@reelmakeeasy/common/asr/caption-timing'
import { generateForcedAlignment, type TimedAlignment } from '@reelmakeeasy/common/asr/elevenlabs'
import {
  ALIGNER_MAX_SECONDS,
  localForcedAlignment,
  localSpeechToText,
} from '@reelmakeeasy/common/asr/local-asr'
import { SpeechToTextChunkResponseModel } from '@reelmakeeasy/common/elevenlabs/client'
import { logger } from '@reelmakeeasy/common/logger'
import { stripDeliveryMarkup } from '@reelmakeeasy/common/tts/delivery-markup'
import { localSttSupports } from '@reelmakeeasy/common/tts/local-tts'
import { runFfmpeg } from '@reelmakeeasy/common/utils/cmdline'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import { getMediaDurationMs } from '@reelmakeeasy/common/utils/media'
import {
  CAPTION_PAUSE,
  detectSilences,
  splitAtSilences,
  type TimeSpan,
} from '@reelmakeeasy/common/utils/silence'

import { processWithLocalFile } from './common.util'
import { generateTranscriptionStep } from './elevenlabs-audio-pipeline.util'

/** Caption word times for a known script, and where they came from (for the logs). */
export interface ScriptWordTiming {
  /** How the punctuation + pause fallback laid the words out, when it was used. */
  fallbackMode?: FallbackMode
  /** The local steps the guard turned down, and why. */
  rejected: CaptionTiming['rejected']
  /**
   * `aligner`, `whisper` or `fallback` when the words were timed on this computer (or by the
   * free fallback); the cloud backend that aligned them otherwise.
   */
  source: CaptionTimingSource | CloudAsrBackend
  /** The script's words, each one word without spaces inside it. */
  words: TimedWord[]
}

interface TimeScriptParams {
  audioPath: string
  /** The audio's length from ffprobe; measured here when missing or not above 0. */
  durationSeconds?: number
  providerLabel: string
  /** The script; its delivery tags (`[excited]`) are never spoken, so never timed. */
  text: string
}

/**
 * The aligner gets at most this much audio per call: a hair under its limit, so a piece cut at
 * the limit itself (no pause before it) stays under it once encoded.
 */
const PIECE_MAX_SECONDS = ALIGNER_MAX_SECONDS - 0.5

/**
 * A transcript timed from the script itself: `timeScriptWords`, or with `localOnly`
 * `timeScriptWordsLocally`. A check that fails never makes it fail, since the punctuation +
 * pause fallback always has an answer. Null when there is no script, the audio can't be read
 * or, with `localOnly`, the local server failed.
 */
export async function generateForcedAlignmentTranscription(
  projectId: string,
  audioPath: string,
  providerLabel: string,
  text: string,
  languageCode = 'eng',
  options: { localOnly?: boolean } = {},
): Promise<null | SpeechToTextChunkResponseModel> {
  // What the voice says: delivery tags are never spoken (every engine drops or acts them) and
  // never shown in captions.
  const alignmentText = stripDeliveryMarkup(text)
  if (!alignmentText) {
    return null
  }

  try {
    const timing = await processWithLocalFile(projectId, audioPath, (localPath) => {
      const params = { audioPath: localPath, providerLabel, text: alignmentText }
      return options.localOnly ? timeScriptWordsLocally(params) : timeScriptWords(params)
    })
    if (!timing || timing.words.length === 0) {
      return null
    }
    return {
      languageCode,
      languageProbability: 1,
      text: alignmentText,
      words: timing.words.map((word) => ({
        end: word.end,
        start: word.start,
        text: word.text,
        type: 'word',
      })),
    }
  } catch (error) {
    logger.warn(
      `[${providerLabel}] Could not time the script on the final audio: ${ensureError(error).message}`,
    )
    return null
  }
}

export function hasTranscript(
  transcription: null | SpeechToTextChunkResponseModel,
): transcription is SpeechToTextChunkResponseModel {
  return Boolean(transcription?.words.some((word) => word.type === 'word'))
}

/**
 * The transcript captions are timed from, for the final audio of a known script. When speech to
 * text runs on this computer, the script's own words timed there (`timeScriptWordsLocally`):
 * free, and chosen over the cloud. Otherwise, or when the local server fails, the ASR
 * transcript as it is, so retiming never adds a paid call. The ASR transcript's detected
 * language is kept.
 */
export async function localCaptionTranscription(params: {
  audioPath: string
  projectId: string
  providerLabel: string
  /** What the voice says: the text the audio was made from. */
  text: string
  transcription: null | SpeechToTextChunkResponseModel
}): Promise<null | SpeechToTextChunkResponseModel> {
  const { transcription } = params
  if (!(await timesCaptionsLocally())) {
    return transcription
  }
  const timed = await generateForcedAlignmentTranscription(
    params.projectId,
    params.audioPath,
    params.providerLabel,
    params.text,
    transcription?.languageCode || undefined,
    { localOnly: true },
  )
  if (!timed) {
    return transcription
  }
  return transcription
    ? { ...timed, languageProbability: transcription.languageProbability }
    : timed
}

/**
 * The transcript for a voiceover that failed its checks. On this computer the script is timed
 * there (`timeScriptWordsLocally`); otherwise, or when the local server fails, the attempt's
 * ASR transcript, else a new ASR pass, else the script timed by `timeScriptWords` (the cloud
 * aligner when nothing runs locally, and the punctuation + pause fallback when alignment fails
 * too). Throws only when there is no script to time and ASR found nothing.
 */
export async function resolveBestEffortTranscription(params: {
  alignmentText: string
  audioPath: string
  initialTranscription: null | SpeechToTextChunkResponseModel
  languageCode?: string
  /** False for a chunk of a long voiceover: only the stitched audio is timed. */
  localTiming?: boolean
  projectId: string
  providerLabel: string
}): Promise<SpeechToTextChunkResponseModel> {
  const { audioPath, projectId, providerLabel } = params
  let finalTranscription = hasTranscript(params.initialTranscription)
    ? params.initialTranscription
    : null
  if (params.localTiming !== false && (await timesCaptionsLocally())) {
    const timed = await generateForcedAlignmentTranscription(
      projectId,
      audioPath,
      providerLabel,
      params.alignmentText,
      finalTranscription?.languageCode || params.languageCode,
      { localOnly: true },
    )
    if (timed) {
      return timed
    }
  }
  if (finalTranscription) {
    return finalTranscription
  }

  logger.info(`[${providerLabel}] No transcription available, generating ASR for final audio`)
  let failureMessage = 'ASR transcription returned null'
  try {
    const { transcription, issues } = await generateTranscriptionStep(projectId, audioPath)
    finalTranscription = hasTranscript(transcription) ? transcription : null
    if (finalTranscription) {
      logger.info(`[${providerLabel}] ASR transcription generated successfully for final audio`)
      return finalTranscription
    }
    if (issues.length > 0) {
      failureMessage = issues.join('; ')
    }
  } catch (asrError) {
    failureMessage = ensureError(asrError).message
  }

  finalTranscription = await generateForcedAlignmentTranscription(
    projectId,
    audioPath,
    providerLabel,
    params.alignmentText,
    params.languageCode,
  )
  if (finalTranscription) {
    return finalTranscription
  }

  failureMessage = `${failureMessage}; the script could not be timed either`
  logger.error(
    `[${providerLabel}] Failed to generate ASR transcription for final audio: ${failureMessage}`,
  )
  throw new Error(`Failed to generate transcript for audio with quality issues: ${failureMessage}`)
}

/**
 * Times a known script's words in a local audio file, in the order measured on real voiceovers:
 *  1. the local forced aligner, after an 80 ms repair. It gets at most 120 s of audio per call:
 *     longer audio is cut in the middle of its pauses, each piece aligned with the words Whisper
 *     placed in it, and the times shifted back;
 *  2. local Whisper with the script laid over its words, after a 40 ms repair, the first word
 *     moved to where the speech starts;
 *  3. the punctuation + pause fallback (beat-loop skill, section 7).
 * Each local step must pass the caption-timing guard. A failed guard goes to the next step,
 * never to a paid call. The alignment request goes through `generateForcedAlignment`: the
 * cloud aligner answers it when nothing runs locally or the local server fails, and its words
 * are kept as they are (the guard is for local timings). When that fails too, the fallback
 * times the words. Never throws.
 */
export async function timeScriptWords(input: TimeScriptParams): Promise<ScriptWordTiming> {
  const params = spoken(input)
  const durationSeconds = await audioSeconds(params)
  let alignment: null | TimedAlignment = null
  try {
    alignment = await generateForcedAlignment(params.audioPath, params.text)
  } catch (error) {
    logger.warn(
      `[${params.providerLabel}] Forced alignment failed; timing captions from punctuation and pauses: ${ensureError(error).message}`,
    )
  }
  if (alignment && isCloudSource(alignment.source) && alignment.words.length > 0) {
    logger.info(
      `[${params.providerLabel}] Caption words timed source=${alignment.source} words=${alignment.words.length}`,
    )
    return {
      rejected: [],
      source: alignment.source,
      words: alignment.words.map(({ end, start, text }) => ({
        end,
        start,
        text: captionWordText(text),
      })),
    }
  }
  return timeLocalAlignment({ ...params, durationSeconds }, alignment)
}

/**
 * `timeScriptWords` on this computer only, for audio that already has an ASR transcript: the
 * local aligner (or Whisper), then the guard's steps and the fallback. Null when the local
 * server fails, so the caller keeps the transcript it has rather than pay for a cloud aligner.
 */
export async function timeScriptWordsLocally(
  input: TimeScriptParams,
): Promise<null | ScriptWordTiming> {
  const params = spoken(input)
  const durationSeconds = await audioSeconds(params)
  let alignment: TimedAlignment
  try {
    alignment = await localForcedAlignment(
      new Blob([await readFile(params.audioPath)]),
      params.text,
    )
  } catch (error) {
    logger.warn(
      `[${params.providerLabel}] Local caption timing failed; keeping the transcript: ${ensureError(error).message}`,
    )
    return null
  }
  return timeLocalAlignment({ ...params, durationSeconds }, alignment)
}

/** The params with the script as it is spoken: its delivery tags taken out. */
function spoken(params: TimeScriptParams): TimeScriptParams {
  return { ...params, text: stripDeliveryMarkup(params.text) }
}

/** True when speech to text, and so caption timing, runs on this computer. */
export async function timesCaptionsLocally(): Promise<boolean> {
  try {
    return (await resolveAsrBackend()) === 'local'
  } catch {
    // Nothing runs locally, and no cloud backend can run either.
    return false
  }
}

/** The words from a local alignment through the guard's steps (see `timeScriptWords`). */
async function timeLocalAlignment(
  params: TimeScriptParams,
  alignment: null | TimedAlignment,
): Promise<ScriptWordTiming> {
  const { audioPath, durationSeconds, providerLabel, text } = params
  let aligned = alignment?.source === 'local-aligner' ? alignment.words : null
  let heard = alignment?.source === 'local-whisper' ? alignment.words : null
  if (heard?.length && durationSeconds !== undefined && durationSeconds > PIECE_MAX_SECONDS) {
    aligned = await alignInPieces({ audioPath, durationSeconds, heard, providerLabel, text })
  }
  const input = { aligned, durationSeconds, text }
  let timing = await timeCaptionWordsFromAudio(audioPath, { ...input, heard })
  if (timing.source === 'fallback' && aligned?.length && !heard?.length) {
    // The aligner was turned down: Whisper is the next step, asked on this computer only.
    heard = await localWhisperWords(audioPath, providerLabel)
    if (heard) timing = await timeCaptionWordsFromAudio(audioPath, { ...input, heard })
  }

  const rejected = timing.rejected.map(({ issues, step }) => `${step}:${issues.join('+')}`)
  const mode = timing.fallbackMode ? ` mode=${timing.fallbackMode}` : ''
  const summary =
    `[${providerLabel}] Caption words timed source=${timing.source}${mode} ` +
    `words=${timing.words.length} rejected=${rejected.join(',') || 'none'}`
  if (timing.source === 'fallback') logger.warn(summary)
  else logger.info(summary)
  return {
    ...(timing.fallbackMode ? { fallbackMode: timing.fallbackMode } : {}),
    rejected: timing.rejected,
    source: timing.source,
    words: timing.words.map((word) => ({ ...word, text: captionWordText(word.text) })),
  }
}

/**
 * The local aligner over audio longer than it times well: the audio is cut in the middle of
 * the last pause before every 120 s, each script word goes to the piece that holds the middle
 * of its Whisper time, and each piece is aligned on its own and shifted back. Null (keep
 * Whisper) when no aligner is installed, Whisper's words don't map onto the script, or any
 * piece doesn't come back from the aligner.
 */
async function alignInPieces(params: {
  audioPath: string
  durationSeconds: number
  heard: TimedWord[]
  providerLabel: string
  text: string
}): Promise<null | TimedWord[]> {
  const { audioPath, durationSeconds, heard, providerLabel } = params
  const tokens = captionWords(params.text)
  if (heard.length !== tokens.length || !(await localSttSupports('align'))) {
    return null
  }
  // Made inside the try: a temp folder that can't be made keeps Whisper's times, never throws.
  let dir: string | undefined
  try {
    dir = await mkdtemp(path.join(os.tmpdir(), 'caption-pieces-'))
    const { silences } = await detectSilences(audioPath, { ...CAPTION_PAUSE, durationSeconds })
    const pieces = splitAtSilences(silences, durationSeconds, PIECE_MAX_SECONDS)
    const groups = groupWordsByPiece(heard, pieces)
    const words: TimedWord[] = []
    for (const [k, piece] of pieces.entries()) {
      const pieceTokens = (groups[k] ?? []).map((i) => tokens[i] as string)
      if (pieceTokens.length === 0) continue
      const piecePath = path.join(dir, `piece-${k}.wav`)
      // Seeking after the input decodes up to the cut, so it is exact to the sample.
      await runFfmpeg(
        '-i',
        audioPath,
        '-ss',
        `${piece.start}`,
        '-to',
        `${piece.end}`,
        '-vn',
        '-ac',
        '1',
        '-ar',
        '16000',
        '-c:a',
        'pcm_s16le',
        piecePath,
      )
      const result = await localForcedAlignment(
        new Blob([await readFile(piecePath)]),
        pieceTokens.join(' '),
      )
      if (result.source !== 'local-aligner') {
        logger.warn(
          `[${providerLabel}] The aligner did not time piece ${k + 1}/${pieces.length}; keeping Whisper's times`,
        )
        return null
      }
      words.push(
        ...result.words.map((word) => ({
          end: roundMs(word.end + piece.start),
          start: roundMs(word.start + piece.start),
          text: word.text,
        })),
      )
    }
    logger.info(
      `[${providerLabel}] Aligned ${durationSeconds.toFixed(1)} s of audio in ${pieces.length} pieces`,
    )
    return words
  } catch (error) {
    logger.warn(
      `[${providerLabel}] Aligning the audio piece by piece failed; keeping Whisper's times: ${ensureError(error).message}`,
    )
    return null
  } finally {
    if (dir) await rm(dir, { force: true, recursive: true })
  }
}

/** Word indices per piece: the piece that holds the middle of the word. */
function groupWordsByPiece(words: TimedWord[], pieces: TimeSpan[]): number[][] {
  const groups: number[][] = pieces.map(() => [])
  for (const [i, word] of words.entries()) {
    const middle = (word.start + word.end) / 2
    const k = Math.max(
      0,
      pieces.findLastIndex((piece) => piece.start <= middle),
    )
    groups[k]?.push(i)
  }
  return groups
}

/** Whisper's words on this computer, never the cloud. Null when it fails. */
async function localWhisperWords(
  audioPath: string,
  providerLabel: string,
): Promise<null | TimedWord[]> {
  try {
    const { words } = await localSpeechToText(new Blob([await readFile(audioPath)]), {
      languageCode: 'eng',
    })
    const timed = words.flatMap(({ end, start, text }) =>
      typeof start === 'number' && typeof end === 'number' ? [{ end, start, text }] : [],
    )
    return timed.length > 0 ? timed : null
  } catch (error) {
    logger.warn(
      `[${providerLabel}] Local Whisper failed after the aligner was turned down: ${ensureError(error).message}`,
    )
    return null
  }
}

/** The caller's length when it is a real one, else ffprobe's (undefined when that fails). */
async function audioSeconds(params: TimeScriptParams): Promise<number | undefined> {
  const given = params.durationSeconds
  if (given !== undefined && Number.isFinite(given) && given > 0) return given
  const ms = await getMediaDurationMs(params.audioPath)
  return ms === undefined ? undefined : ms / 1000
}

const isCloudSource = (source: TimedAlignment['source']): source is CloudAsrBackend =>
  source === 'elevenlabs' || source === 'fal' || source === 'google'

const roundMs = (seconds: number): number => Math.round(seconds * 1000) / 1000
