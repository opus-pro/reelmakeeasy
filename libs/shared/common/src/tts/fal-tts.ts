/**
 * Kokoro and Qwen3-TTS speech: on this machine when the local voice server is
 * running (free, see local-tts.ts), otherwise on fal.ai.
 *
 * The fal models come from the model registry (`roles["tts.kokoro"]` and
 * `roles["tts.qwen3"]`) and are called over fal's queue API. A local call that
 * fails falls back to fal. Every synthesis returns MP3 bytes, the format the
 * voiceover pipeline stores and stitches.
 *
 * - Kokoro (English only): one fal endpoint per language. The registry names the
 *   American English endpoint; British voices (`bf_*`, `bm_*`) are sent to the
 *   sibling `british-english` endpoint. Kokoro returns WAV, transcoded here.
 * - Qwen3-TTS: preset speakers, or a user voice (cloned from reference audio or
 *   designed from a description). Locally a user voice is its reference audio
 *   and transcript; on fal it is a speaker embedding made from that audio. The
 *   registry entry also names the `design` and `clone` endpoints.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { fal } from '@reelmakeeasy/llm'
import { type ResolvedModel, resolveRole } from '@reelmakeeasy/llm/registry'

import { logger } from '../logger'
import { runFfmpeg } from '../utils/cmdline'
import { ensureError } from '../utils/error-handler'

import { planQwen3Segments, type Qwen3Segment, stripDeliveryMarkup } from './delivery-markup'
import { localSpeech, type LocalSpeechRequest, localTtsSupports } from './local-tts'

const FAL_TTS_TIMEOUT_MS = 600_000
const DOWNLOAD_TIMEOUT_MS = 120_000

/**
 * Qwen3-TTS stops at `max_new_tokens` codec tokens (12.5 per second of audio).
 * fal's default of 200 truncates speech at 16 seconds, so ask for the endpoint's
 * maximum; generation ends on its own when the text is spoken.
 */
const QWEN3_MAX_NEW_TOKENS = 8192

// ---------- voice ids ----------

/** Preset voice ids are namespaced by provider: `kokoro-af_heart`, `qwen3-vivian`. */
export const KOKORO_VOICE_PREFIX = 'kokoro-'
export const QWEN3_VOICE_PREFIX = 'qwen3-'
/** Qwen3 voices a user cloned or designed: `qwen3-clone-<id>`. */
export const QWEN3_USER_VOICE_PREFIX = `${QWEN3_VOICE_PREFIX}clone-`

export type FalTtsProvider = 'kokoro' | 'qwen3'

/** The fal TTS provider a voice id belongs to, or null for other providers' ids. */
export function falTtsProviderForVoiceId(voiceId: string): FalTtsProvider | null {
  if (voiceId.startsWith(KOKORO_VOICE_PREFIX)) return 'kokoro'
  if (voiceId.startsWith(QWEN3_VOICE_PREFIX)) return 'qwen3'
  return null
}

export const isQwen3UserVoiceId = (voiceId: string): boolean =>
  voiceId.startsWith(QWEN3_USER_VOICE_PREFIX)

/** Qwen3-TTS preset speakers, keyed by their voice-id suffix. */
export const QWEN3_SPEAKERS: Record<string, string> = {
  aiden: 'Aiden',
  dylan: 'Dylan',
  eric: 'Eric',
  ono_anna: 'Ono_Anna',
  ryan: 'Ryan',
  serena: 'Serena',
  sohee: 'Sohee',
  uncle_fu: 'Uncle_Fu',
  vivian: 'Vivian',
}

// ---------- languages ----------

/** Qwen3-TTS languages, by BCP-47 primary subtag. Anything else is left to `Auto`. */
const QWEN3_LANGUAGES: Record<string, string> = {
  de: 'German',
  en: 'English',
  es: 'Spanish',
  fr: 'French',
  it: 'Italian',
  ja: 'Japanese',
  ko: 'Korean',
  pt: 'Portuguese',
  ru: 'Russian',
  zh: 'Chinese',
}

/** ISO 639-2/3 codes (speech-to-text reports these) for the same languages. */
const ISO_639_3_TO_1: Record<string, string> = {
  cmn: 'zh',
  deu: 'de',
  eng: 'en',
  fra: 'fr',
  fre: 'fr',
  ger: 'de',
  ita: 'it',
  jpn: 'ja',
  kor: 'ko',
  por: 'pt',
  rus: 'ru',
  spa: 'es',
  yue: 'zh',
  zho: 'zh',
}

/**
 * The Qwen3-TTS `language` for a language code (`de-DE` -> `German`, `eng` ->
 * `English`), else `Auto`.
 */
export function qwen3Language(languageCode?: string): string {
  const primary = languageCode?.trim().toLowerCase().split(/[-_]/)[0]
  if (!primary) return 'Auto'
  return QWEN3_LANGUAGES[ISO_639_3_TO_1[primary] ?? primary] ?? 'Auto'
}

// ---------- models ----------

function resolveFalTtsModel(role: 'tts.kokoro' | 'tts.qwen3'): ResolvedModel {
  const model = resolveRole(role)
  if (!model) throw new Error(`No model is configured for role ${role} in reelmakeeasy.models.json`)
  if (model.provider !== 'fal' || !model.endpoint) {
    throw new Error(`roles["${role}"] must be a fal model with endpoints.generate`)
  }
  return model
}

/** The model id a provider synthesizes with, for logs and route metadata. */
export function falTtsModelName(provider: FalTtsProvider): string {
  return resolveFalTtsModel(provider === 'kokoro' ? 'tts.kokoro' : 'tts.qwen3').key
}

/** Kokoro serves British voices on its `british-english` sibling endpoint. */
export function kokoroEndpoint(generateEndpoint: string, voice: string): string {
  if (!/^b[fm]_/.test(voice)) return generateEndpoint
  return generateEndpoint.replace(/\/[^/]+$/, '/british-english')
}

// ---------- synthesis ----------

export interface FalTtsResult {
  audioBuffer: Buffer
  /** Seconds, when the endpoint reports it. */
  durationSeconds?: number
  /** `local` when the local voice server made it (free), else `fal`. */
  ranOn: 'fal' | 'local'
  requestId: string
}

interface FalAudioOutput {
  audio?: { content_type?: string; duration?: number; url?: string }
}

/** Kokoro speech for a `kokoro-*` voice id. */
export async function kokoroTextToSpeech(options: {
  speed?: number
  text: string
  voiceId: string
}): Promise<FalTtsResult> {
  const voice = options.voiceId.slice(KOKORO_VOICE_PREFIX.length)
  if (!voice) throw new Error(`Not a Kokoro voice id: ${options.voiceId}`)
  // Kokoro reads bracketed delivery tags aloud, so they are dropped.
  const text = stripDeliveryMarkup(options.text)
  const local = await tryLocal({ engine: 'kokoro', speed: options.speed ?? 1, text, voice })
  if (local) return local
  const model = resolveFalTtsModel('tts.kokoro')
  const endpoint = kokoroEndpoint(model.endpoint as string, voice)
  const input = { prompt: text, speed: options.speed ?? 1, voice, ...model.input }
  return synthesize(endpoint, input, 'Kokoro')
}

/** A user's Qwen3 voice, loaded only as far as the chosen runtime needs. */
export interface Qwen3VoiceReference {
  /** The reference speech as WAV (local synthesis), or null when the voice has none. */
  audio: () => Promise<Buffer | null>
  /** A fal URL of the voice's speaker embedding (cloud synthesis). */
  embeddingUrl: () => Promise<string>
  /** What the reference speech says. */
  text?: string
}

/** The speaker a Qwen3 request uses: a preset name, or a user voice. */
export type Qwen3Speaker = { reference: Qwen3VoiceReference } | { voice: string }

/** The preset speaker a `qwen3-*` preset voice id names, or null. */
export function qwen3PresetSpeaker(voiceId: string): null | string {
  if (!voiceId.startsWith(QWEN3_VOICE_PREFIX) || isQwen3UserVoiceId(voiceId)) return null
  return QWEN3_SPEAKERS[voiceId.slice(QWEN3_VOICE_PREFIX.length)] ?? null
}

/**
 * Qwen3-TTS speech with a preset speaker or a user's cloned or designed voice.
 *
 * The text may carry delivery markup (`[excited] ...`, see delivery-markup.ts).
 * Where delivery changes, or a question needs its pitch to rise, the text is
 * spoken as several takes (see `planQwen3Segments`) joined with short pauses; a
 * plain text with no questions is still a single request.
 */
export async function qwen3TextToSpeech(options: {
  languageCode?: string
  speaker: Qwen3Speaker
  /** Delivery instruction for a preset speaker where the text sets none. */
  stylePrompt?: string
  text: string
}): Promise<FalTtsResult> {
  const instructable = 'voice' in options.speaker
  const segments = planQwen3Segments(options.text, instructable)
  if (instructable && options.stylePrompt) {
    for (const segment of segments) segment.instruct ??= options.stylePrompt
  }
  const language = qwen3Language(options.languageCode)
  // A cloned voice's reference audio is read once, however many takes there are.
  const original = 'reference' in options.speaker ? options.speaker.reference : undefined
  let refAudio: Promise<Buffer | null> | undefined
  const speaker: Qwen3Speaker = original
    ? { reference: { ...original, audio: () => (refAudio ??= original.audio()) } }
    : options.speaker
  const speak = (segment: Pick<Qwen3Segment, 'instruct' | 'preferRising' | 'text'>) =>
    qwen3SpeakOnce({ ...segment, language, speaker })

  if (segments.length <= 1) {
    return speak(segments[0] ?? { text: stripDeliveryMarkup(options.text) })
  }
  const takes = await Promise.all(segments.map((segment) => speak(segment)))
  const audioBuffer = await joinSpeech(
    takes.map((take) => take.audioBuffer),
    segments.map((segment) => segment.pauseBeforeMs),
  )
  logger.info(
    `[FalTTS] Qwen3-TTS spoke ${segments.length} delivery segments (${takes.filter((t) => t.ranOn === 'local').length} local)`,
  )
  return {
    audioBuffer,
    ranOn: takes.every((take) => take.ranOn === 'local') ? 'local' : 'fal',
    requestId: takes.map((take) => take.requestId).join(','),
  }
}

/** One Qwen3 request: on the local server when it runs Qwen3, else on fal. */
async function qwen3SpeakOnce(options: {
  instruct?: string
  language: string
  /** Re-roll a question until its pitch rises (local server only). */
  preferRising?: boolean
  speaker: Qwen3Speaker
  text: string
}): Promise<FalTtsResult> {
  const { instruct, language, speaker, text } = options
  const rising = options.preferRising ? { bestOf: QUESTION_TAKES, prefer: 'rising' as const } : {}
  if ('voice' in speaker) {
    const local = await tryLocal({
      engine: 'qwen3',
      instruct,
      language,
      text,
      voice: speaker.voice,
      ...rising,
    })
    if (local) return local
  } else if (await localTtsSupports('qwen3')) {
    const refAudio = await speaker.reference.audio()
    const local =
      refAudio &&
      (await tryLocal({
        engine: 'qwen3',
        language,
        refAudio,
        refText: speaker.reference.text,
        text,
        ...rising,
      }))
    if (local) return local
  }

  const model = resolveFalTtsModel('tts.qwen3')
  const speakerInput =
    'voice' in speaker
      ? { voice: speaker.voice }
      : {
          speaker_voice_embedding_file_url: await speaker.reference.embeddingUrl(),
          ...(speaker.reference.text ? { reference_text: speaker.reference.text } : {}),
        }
  const input = {
    language,
    max_new_tokens: QWEN3_MAX_NEW_TOKENS,
    text,
    ...(instruct && 'voice' in speaker ? { prompt: instruct } : {}),
    ...speakerInput,
    ...model.input,
  }
  return synthesize(model.endpoint as string, input, 'Qwen3-TTS')
}

/**
 * Takes the local server makes of a question before keeping the one whose pitch
 * rises most. On a cloned voice a single take of a yes/no question rises about
 * half the time; the best of 3 rose on 91% of the questions we measured.
 */
const QUESTION_TAKES = 3

/**
 * Speaks `sampleText` in a new voice described in words (Qwen3 voice design).
 * The result is only audio: clone it to keep the voice.
 */
export async function qwen3DesignVoiceSample(options: {
  description: string
  languageCode?: string
  sampleText: string
}): Promise<FalTtsResult> {
  const local = await tryLocal({
    engine: 'qwen3',
    instruct: options.description,
    language: qwen3Language(options.languageCode),
    text: options.sampleText,
  })
  if (local) return local
  const model = resolveFalTtsModel('tts.qwen3')
  const endpoint = model.endpoints['design']
  if (!endpoint) throw new Error('roles["tts.qwen3"] has no endpoints.design')
  const input = {
    language: qwen3Language(options.languageCode),
    max_new_tokens: QWEN3_MAX_NEW_TOKENS,
    prompt: options.description,
    text: options.sampleText,
  }
  return synthesize(endpoint, input, 'Qwen3 voice design')
}

/**
 * Turns reference speech into a reusable Qwen3 speaker embedding (a small
 * safetensors file). The audio must be at most 5 minutes; a short clean clip is enough.
 */
export async function qwen3CloneVoice(options: {
  audio: Buffer
  contentType: string
  referenceText?: string
}): Promise<{ embedding: Buffer; requestId: string }> {
  const model = resolveFalTtsModel('tts.qwen3')
  const endpoint = model.endpoints['clone']
  if (!endpoint) throw new Error('roles["tts.qwen3"] has no endpoints.clone')
  const audioUrl = await fal.storage.upload(
    new File([new Uint8Array(options.audio)], `reference${extensionFor(options.contentType)}`, {
      type: options.contentType,
    }),
  )
  const result = await fal.subscribe<{ speaker_embedding?: { url?: string } }>(endpoint, {
    input: {
      audio_url: audioUrl,
      ...(options.referenceText?.trim() ? { reference_text: options.referenceText.trim() } : {}),
    },
    timeout: FAL_TTS_TIMEOUT_MS,
  })
  const embeddingUrl = result.data.speaker_embedding?.url
  if (!embeddingUrl) throw new Error('Qwen3 voice clone returned no speaker embedding')
  logger.info(`[FalTTS] Qwen3 voice clone ready request=${result.requestId}`)
  return { embedding: await downloadBytes(embeddingUrl), requestId: result.requestId }
}

/** Uploads a stored speaker embedding so fal can read it; returns its fal URL. */
export async function uploadQwen3Embedding(embedding: Buffer): Promise<string> {
  return fal.storage.upload(
    new File([new Uint8Array(embedding)], 'speaker.safetensors', {
      type: 'application/octet-stream',
    }),
  )
}

async function downloadBytes(url: string): Promise<Buffer> {
  const res = await fetch(url, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`Failed to download ${url}: ${res.status}`)
  return Buffer.from(await res.arrayBuffer())
}

async function synthesize(
  endpoint: string,
  input: Record<string, unknown>,
  label: string,
): Promise<FalTtsResult> {
  const started = Date.now()
  const result = await fal.subscribe<FalAudioOutput>(endpoint, {
    input,
    timeout: FAL_TTS_TIMEOUT_MS,
  })
  const audio = result.data.audio
  if (!audio?.url) throw new Error(`${label} returned no audio (request ${result.requestId})`)
  const raw = await downloadBytes(audio.url)
  const audioBuffer = isMp3(audio.content_type, audio.url) ? raw : await toMp3(raw, audio.url)
  logger.info(
    `[FalTTS] ${label} audio ready in ${Date.now() - started}ms request=${result.requestId} bytes=${audioBuffer.length}`,
  )
  return { audioBuffer, durationSeconds: audio.duration, ranOn: 'fal', requestId: result.requestId }
}

/**
 * Synthesizes on the local voice server when it runs this engine. Returns null
 * (so the caller uses fal) when it doesn't, or when the local call fails.
 */
async function tryLocal(request: LocalSpeechRequest): Promise<FalTtsResult | null> {
  if (!(await localTtsSupports(request.engine))) return null
  try {
    const wav = await localSpeech(request)
    return { audioBuffer: await toMp3(wav), ranOn: 'local', requestId: 'local' }
  } catch (error) {
    logger.warn(`[FalTTS] Local ${request.engine} failed, using fal: ${ensureError(error).message}`)
    return null
  }
}

/** Whether fal's audio is already MP3, from its content type or file name. */
export const isMp3 = (contentType: string | undefined, url: string) =>
  contentType === 'audio/mpeg' || /\.mp3($|\?)/i.test(url)

function extensionFor(contentType: string): string {
  const subtype = contentType.split('/')[1]?.split(';')[0]
  if (!subtype) return '.bin'
  return subtype === 'mpeg' ? '.mp3' : `.${subtype.replace(/^x-/, '')}`
}

/**
 * Reference speech for Qwen3 cloning, as the local server reads it: 24 kHz mono
 * 16-bit WAV, trimmed to the 5 minutes fal's clone endpoint accepts.
 */
export async function toReferenceWav(audio: Buffer, sourceName = 'audio.bin'): Promise<Buffer> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'qwen3-ref-'))
  const input = path.join(dir, `in${path.extname(sourceName) || '.bin'}`)
  const output = path.join(dir, 'ref.wav')
  try {
    await writeFile(input, audio)
    await runFfmpeg(
      '-i',
      input,
      '-t',
      '300',
      '-ac',
      '1',
      '-ar',
      '24000',
      '-c:a',
      'pcm_s16le',
      output,
    )
    return await readFile(output)
  } finally {
    await rm(dir, { force: true, recursive: true })
  }
}

/**
 * Joins takes into one MP3 with a pause before each (`pausesMs[i]` precedes
 * `takes[i]`). Each take's leading and trailing silence is trimmed first, so the
 * pauses are exactly as long as asked.
 */
export async function joinSpeech(takes: Buffer[], pausesMs: number[]): Promise<Buffer> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'tts-join-'))
  const output = path.join(dir, 'out.mp3')
  try {
    const inputs: string[] = []
    const filters: string[] = []
    const labels: string[] = []
    const trim = 'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.03'
    for (const [i, take] of takes.entries()) {
      const file = path.join(dir, `take${i}.mp3`)
      await writeFile(file, take)
      inputs.push('-i', file)
      const pause = (pausesMs[i] ?? 0) / 1000
      if (pause > 0) {
        filters.push(`aevalsrc=0:d=${pause}:s=24000[p${i}]`)
        labels.push(`[p${i}]`)
      }
      filters.push(
        `[${i}:a]aresample=24000,aformat=channel_layouts=mono,${trim},areverse,${trim},areverse[a${i}]`,
      )
      labels.push(`[a${i}]`)
    }
    filters.push(`${labels.join('')}concat=n=${labels.length}:v=0:a=1[out]`)
    await runFfmpeg(
      ...inputs,
      '-filter_complex',
      filters.join(';'),
      '-map',
      '[out]',
      '-codec:a',
      'libmp3lame',
      '-b:a',
      '192k',
      output,
    )
    return await readFile(output)
  } finally {
    await rm(dir, { force: true, recursive: true })
  }
}

/** The voiceover pipeline stores and stitches MP3; transcode anything else. */
export async function toMp3(audio: Buffer, sourceName = 'audio.wav'): Promise<Buffer> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'fal-tts-'))
  const ext = path.extname(new URL(sourceName, 'file:///').pathname) || '.wav'
  const input = path.join(dir, `in${ext}`)
  const output = path.join(dir, 'out.mp3')
  try {
    await writeFile(input, audio)
    await runFfmpeg('-i', input, '-codec:a', 'libmp3lame', '-b:a', '192k', output)
    return await readFile(output)
  } finally {
    await rm(dir, { force: true, recursive: true })
  }
}
