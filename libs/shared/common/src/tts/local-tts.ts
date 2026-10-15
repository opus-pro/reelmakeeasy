/**
 * The local voice server (tools/local-tts): Kokoro and Qwen3-TTS running on this
 * machine, free, and Whisper plus a forced aligner for caption timing
 * (asr/local-asr.ts). `pnpm dev` starts it when `pnpm reelmakeeasy setup` installed it
 * and passes its address as LOCAL_TTS_URL. Without it, callers use the cloud.
 */
import { logger } from '../logger'

const HEALTH_TTL_MS = 15_000
const HEALTH_TIMEOUT_MS = 2_000
/** Qwen3 on a GPU speaks 2-4x faster than real time; a long chunk still fits easily. */
const SPEECH_TIMEOUT_MS = 900_000

export interface LocalSpeechRequest {
  /** With `prefer`, how many takes to make before keeping the best (Qwen3 only). */
  bestOf?: number
  engine: LocalTtsEngine
  /** Qwen3 voice description (design) or delivery instruction (presets). */
  instruct?: string
  /** Qwen3 language name (`English`, `auto`). */
  language?: string
  /** Keep the take whose pitch rises most at the end (questions). */
  prefer?: 'rising'
  /** Qwen3 clone reference: 16-bit PCM WAV, ideally 24 kHz mono. */
  refAudio?: Buffer
  /** What the reference audio says; improves clone quality. */
  refText?: string
  speed?: number
  text: string
  /** Kokoro voice (`af_heart`) or Qwen3 preset speaker (`Ryan`). */
  voice?: string
}

export type LocalTtsEngine = 'kokoro' | 'qwen3'

export interface LocalTtsHealth {
  /** Where the models run: `mlx` (Apple Silicon), `cuda`, `mps` or `cpu`. */
  backend: string
  engines: Record<LocalTtsEngine, boolean>
  /** Speech to text for caption timing; missing on a server without it. */
  stt?: LocalSttHealth
}

/** Whisper (`transcribe`) and the forced aligner (`align`) on the local server. */
export interface LocalSttHealth {
  align: boolean
  /** Where Whisper runs: `mlx`, `cuda` or `cpu` (slower; the smaller model). */
  device?: string
  /** Model ids by job, for the doctor and logs. */
  models?: Record<string, null | string>
  transcribe: boolean
}

let cached: undefined | { at: number; health: LocalTtsHealth | null }

export const localTtsUrl = (): string | undefined =>
  process.env['LOCAL_TTS_URL']?.replace(/\/$/, '') || undefined

/** Drops the cached status, so a crashed server is noticed on the next call. */
export function forgetLocalTtsHealth(): void {
  cached = undefined
}

/** The server's status, or null when it isn't configured or doesn't answer. Cached briefly. */
export async function localTtsHealth(): Promise<LocalTtsHealth | null> {
  const url = localTtsUrl()
  if (!url) return null
  if (cached && Date.now() - cached.at < HEALTH_TTL_MS) return cached.health
  let health: LocalTtsHealth | null = null
  try {
    const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS) })
    if (res.ok) health = (await res.json()) as LocalTtsHealth
  } catch {
    health = null
  }
  cached = { at: Date.now(), health }
  return health
}

export async function localTtsSupports(engine: LocalTtsEngine): Promise<boolean> {
  return Boolean((await localTtsHealth())?.engines[engine])
}

/** Whether the local server runs Whisper (`transcribe`) or the forced aligner (`align`). */
export async function localSttSupports(
  job: keyof Omit<LocalSttHealth, 'models'>,
): Promise<boolean> {
  return Boolean((await localTtsHealth())?.stt?.[job])
}

/** Synthesizes on the local server; returns 16-bit PCM WAV. */
export async function localSpeech(request: LocalSpeechRequest): Promise<Buffer> {
  const url = localTtsUrl()
  if (!url) throw new Error('LOCAL_TTS_URL is not set')
  const { refAudio, ...rest } = request
  const started = Date.now()
  const res = await fetch(`${url}/v1/speech`, {
    body: JSON.stringify({
      ...rest,
      ...(refAudio ? { refAudio: refAudio.toString('base64') } : {}),
    }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
    signal: AbortSignal.timeout(SPEECH_TIMEOUT_MS),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    forgetLocalTtsHealth()
    throw new Error(`Local ${request.engine} failed (HTTP ${res.status}): ${detail.slice(0, 300)}`)
  }
  const audio = Buffer.from(await res.arrayBuffer())
  logger.info(
    `[LocalTTS] ${request.engine} ${request.text.length} chars in ${Date.now() - started}ms bytes=${audio.length}`,
  )
  return audio
}
