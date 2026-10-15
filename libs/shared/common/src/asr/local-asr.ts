/**
 * Speech to text and caption timing on this computer, free and private: Whisper
 * (`/v1/transcribe`) and a forced aligner (`/v1/align`) in the local voice server
 * (tools/local-tts). Results are mapped to the shapes the direct ElevenLabs client
 * returns, like fal-scribe.ts, so callers can't tell them apart. The audio is first
 * made into 16 kHz mono 16-bit WAV, the one format the server reads. These throw when
 * nothing local could do the job, and callers then use the cloud.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type {
  ForcedAlignmentResponseModel,
  SpeechToTextChunkResponseModel,
  SpeechToTextWordResponseModel,
} from '../elevenlabs/client'
import { logger } from '../logger'
import { BCP47_PRIMARY_TO_ISO_639_3 } from '../tts/language-config'
import { forgetLocalTtsHealth, localSttSupports, localTtsUrl } from '../tts/local-tts'
import { runFfmpeg } from '../utils/cmdline'
import { ensureError } from '../utils/error-handler'

import { alignTextToWords } from './align-text'

/**
 * Whisper runs 10-40x real time on a Mac; a long voiceover still fits easily. The budget also
 * covers waiting for the server's GPU lock while Qwen3 speaks, and reloading a model unloaded
 * after 5 idle minutes, so a call made during a long local voice job can run out and go to
 * the cloud.
 */
const LOCAL_ASR_TIMEOUT_MS = 120_000
/**
 * The aligner is exact on short audio but drifts on long audio (seconds off by the end
 * of a 5-minute file), so Whisper times anything longer.
 */
export const ALIGNER_MAX_SECONDS = 120
/** 16 kHz, 16-bit, mono. */
const WAV_BYTES_PER_SECOND = 32_000

export interface LocalForcedAlignment extends ForcedAlignmentResponseModel {
  source: LocalTimingSource
}

export interface LocalSpeechToTextOptions {
  /** `eng`, `en` or `en-US`; unset lets Whisper detect the language. */
  languageCode?: string
}

/** Who timed the words: the aligner on the known script, or Whisper's words laid over it. */
export type LocalTimingSource = 'local-aligner' | 'local-whisper'

/** What `/v1/transcribe` returns. */
export interface LocalTranscribeOutput {
  /** ISO 639-1, as Whisper names languages (`en`). */
  language?: string
  languageProbability?: number
  model?: string
  text?: string
  words?: LocalWhisperWord[]
}

export interface LocalWhisperWord {
  end?: null | number
  probability?: null | number
  start?: null | number
  text?: string
}

interface LocalAlignOutput {
  model?: string
  words?: { end: number; start: number; text: string }[]
}

/** Whisper's ISO 639-1 names for the ISO 639-3 codes ElevenLabs uses (`en` for `eng`). */
const WHISPER_LANGUAGE = Object.fromEntries(
  Object.entries(BCP47_PRIMARY_TO_ISO_639_3).map(([iso1, iso3]) => [iso3, iso1]),
)

/**
 * A word-timed transcript from local Whisper, like ElevenLabs `speech-to-text`. Without a
 * language Whisper detects it, except the English-only model on CPU (`small.en`), which
 * always answers English.
 */
export async function localSpeechToText(
  audio: Blob,
  options: LocalSpeechToTextOptions = {},
): Promise<SpeechToTextChunkResponseModel> {
  const wav = await toSpeechWav(Buffer.from(await audio.arrayBuffer()))
  return transcribeWav(wav, whisperLanguage(options.languageCode))
}

/**
 * Word timings for a known script: the local forced aligner, or, when it isn't installed,
 * fails, or the audio is longer than it times well, the script's words laid over Whisper's.
 * Either way the words are the script's own, punctuation included. They come back as they
 * are; checking them is the caller's job. Throws only when Whisper fails too.
 */
export async function localForcedAlignment(
  audio: Blob,
  text: string,
): Promise<LocalForcedAlignment> {
  const wav = await toSpeechWav(Buffer.from(await audio.arrayBuffer()))
  if (speechWavSeconds(wav) <= ALIGNER_MAX_SECONDS && (await localSttSupports('align'))) {
    try {
      return await alignWav(wav, text)
    } catch (error) {
      // Whisper runs on the same server and was just reported running: try it before the cloud.
      logger.warn(`[LocalASR] ${ensureError(error).message}; timing with Whisper instead`)
    }
  }
  // Captions are English only for now.
  const { words } = await transcribeWav(wav, 'en')
  const heard = words.flatMap((w) =>
    w.start === undefined || w.end === undefined
      ? []
      : [{ end: w.end, start: w.start, text: w.text }],
  )
  return { characters: [], source: 'local-whisper', words: alignTextToWords(text, heard) }
}

/** Whisper's output in the client's shape: trimmed words of `type: 'word'`, ISO 639-3 language. */
export function mapLocalTranscription(
  output: LocalTranscribeOutput,
  requestedLanguage?: string,
): SpeechToTextChunkResponseModel {
  const words = (output.words ?? []).flatMap((word): SpeechToTextWordResponseModel[] => {
    const text = word.text?.trim()
    if (!text) return []
    const { end, probability, start } = word
    return [
      {
        ...(isFiniteNumber(end) ? { end } : {}),
        ...(isFiniteNumber(probability) && probability > 0
          ? { logprob: Math.log(probability) }
          : {}),
        ...(isFiniteNumber(start) ? { start } : {}),
        text,
        type: 'word',
      },
    ]
  })
  return {
    // Whisper is asked for English unless a caller wants it detected.
    languageCode: iso6393(output.language ?? requestedLanguage ?? 'en'),
    languageProbability: output.languageProbability ?? (requestedLanguage ? 1 : 0),
    text: output.text?.trim() ?? words.map((w) => w.text).join(' '),
    words,
  }
}

/** Seconds of audio in the WAV `toSpeechWav` makes, from its data chunk. */
export function speechWavSeconds(wav: Buffer): number {
  let offset = 12
  while (offset + 8 <= wav.length) {
    const size = wav.readUInt32LE(offset + 4)
    if (wav.toString('ascii', offset, offset + 4) === 'data') {
      return Math.min(size, wav.length - offset - 8) / WAV_BYTES_PER_SECOND
    }
    offset += 8 + size + (size % 2)
  }
  return 0
}

/**
 * The aligner's timings on the script's own words: it strips punctuation and hyphens
 * ("decades," comes back as "decades", "rule-based" as "rulebased"), so its words are only
 * the timings. Throws on any failure, including a server without an aligner after all (404).
 */
async function alignWav(wav: Buffer, text: string): Promise<LocalForcedAlignment> {
  const started = Date.now()
  const output = await post<LocalAlignOutput>('/v1/align', 'alignment', {
    audio: wav.toString('base64'),
    text,
  })
  const timed = output.words ?? []
  if (timed.length === 0) throw new Error('Local alignment found no words')
  const words = alignTextToWords(
    text,
    timed.map(({ end, start, text: word }) => ({ end, start, text: word })),
  )
  logger.info(
    `[LocalASR] alignment ready in ${Date.now() - started}ms model=${output.model ?? 'unknown'} words=${words.length}`,
  )
  return { characters: [], source: 'local-aligner', words }
}

const isFiniteNumber = (value: null | number | undefined): value is number =>
  typeof value === 'number' && Number.isFinite(value)

/** The ISO 639-3 code ElevenLabs returns (`eng`), from Whisper's `en`. */
function iso6393(code: string): string {
  const primary = code.trim().toLowerCase().split(/[-_]/)[0] ?? ''
  return primary.length === 2 ? (BCP47_PRIMARY_TO_ISO_639_3[primary] ?? primary) : primary
}

/**
 * Posts JSON to the local server. A failure forgets its cached status, so a crash is noticed,
 * except a 404: the server is up and only lacks that job.
 */
async function post<T>(route: string, job: string, body: object): Promise<T> {
  const url = localTtsUrl()
  if (!url) throw new Error('LOCAL_TTS_URL is not set')
  let res: Response
  try {
    res = await fetch(`${url}${route}`, {
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
      method: 'POST',
      signal: AbortSignal.timeout(LOCAL_ASR_TIMEOUT_MS),
    })
    if (res.ok) return (await res.json()) as T
  } catch (error) {
    forgetLocalTtsHealth()
    // fetch rejects with a DOMException, which isn't always an Error instance.
    if ((error as null | { name?: unknown })?.name === 'TimeoutError') {
      throw new Error(`Local ${job} timed out after ${LOCAL_ASR_TIMEOUT_MS / 1000} s`)
    }
    throw ensureError(error)
  }
  if (res.status !== 404) forgetLocalTtsHealth()
  const detail = await res.text().catch(() => '')
  throw new Error(`Local ${job} failed (HTTP ${res.status}): ${detail.slice(0, 300)}`)
}

/** 16 kHz mono 16-bit WAV, the one format the local server reads. */
async function toSpeechWav(audio: Buffer): Promise<Buffer> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'local-asr-'))
  try {
    const input = path.join(dir, 'in.bin')
    const output = path.join(dir, 'speech.wav')
    await writeFile(input, audio)
    await runFfmpeg('-i', input, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', output)
    return await readFile(output)
  } finally {
    await rm(dir, { force: true, recursive: true })
  }
}

async function transcribeWav(
  wav: Buffer,
  language: string | undefined,
): Promise<SpeechToTextChunkResponseModel> {
  const started = Date.now()
  const output = await post<LocalTranscribeOutput>('/v1/transcribe', 'speech to text', {
    audio: wav.toString('base64'),
    ...(language ? { language } : {}),
    wordTimestamps: true,
  })
  const transcript = mapLocalTranscription(output, language)
  logger.info(
    `[LocalASR] transcription ready in ${Date.now() - started}ms model=${output.model ?? 'unknown'} words=${transcript.words.length}`,
  )
  return transcript
}

/** Whisper's language name (`en`) for `eng`, `en` or `en-US`. */
function whisperLanguage(code: string | undefined): string | undefined {
  const primary = code?.trim().toLowerCase().split(/[-_]/)[0]
  if (!primary) return undefined
  return primary.length === 3 ? (WHISPER_LANGUAGE[primary] ?? primary) : primary
}
