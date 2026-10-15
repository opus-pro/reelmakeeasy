/**
 * A small ElevenLabs REST client covering the endpoints the pipeline uses:
 * text-to-speech (with and without timestamps), speech-to-text, forced
 * alignment and instant voice cloning.
 *
 * Requests take camelCase fields and responses come back camelCased, the same
 * shape the official SDK exposed, so call sites read unchanged.
 */

const BASE_URL = 'https://api.elevenlabs.io/v1'

/** Request fields that ElevenLabs reads from the query string rather than the body. */
const QUERY_FIELDS = new Set(['enableLogging', 'optimizeStreamingLatency', 'outputFormat'])

const toSnake = (key: string) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
const toCamel = (key: string) => key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())

function mapKeys(value: unknown, fn: (key: string) => string): unknown {
  if (Array.isArray(value)) return value.map((v) => mapKeys(v, fn))
  if (value && typeof value === 'object' && !(value instanceof Blob)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [fn(k), mapKeys(v, fn)]))
  }
  return value
}

export interface SpeechToTextWordResponseModel {
  characters?: { end?: number; start?: number; text: string }[]
  end?: number
  logprob?: number
  speakerId?: string
  start?: number
  text: string
  type: 'audio_event' | 'spacing' | 'word'
}

export interface SpeechToTextChunkResponseModel {
  languageCode: string
  languageProbability: number
  text: string
  words: SpeechToTextWordResponseModel[]
}

export interface CharacterAlignmentResponseModel {
  characterEndTimesSeconds: number[]
  characterStartTimesSeconds: number[]
  characters: string[]
}

export interface ForcedAlignmentResponseModel {
  characters: { end: number; start: number; text: string }[]
  loss?: number
  words: { end: number; loss?: number; start: number; text: string }[]
}

export interface TextToSpeechRequest {
  languageCode?: string
  modelId?: string
  outputFormat?: string
  text: string
  voiceSettings?: Record<string, unknown>
  [field: string]: unknown
}

export interface SpeechToTextRequest {
  diarize?: boolean
  file: Blob
  languageCode?: string
  modelId: string
  tagAudioEvents?: boolean
  [field: string]: unknown
}

export class ElevenLabsClient {
  private readonly apiKey: string

  constructor(options: { apiKey: string }) {
    this.apiKey = options.apiKey
  }

  readonly textToSpeech = {
    /** Returns the audio as a stream, like the SDK. */
    convert: async (voiceId: string, request: TextToSpeechRequest): Promise<ReadableStream<Uint8Array>> => {
      const res = await this.postJson(`/text-to-speech/${encodeURIComponent(voiceId)}`, request)
      if (!res.body) throw new Error('ElevenLabs text-to-speech returned no audio')
      return res.body
    },
    convertWithTimestamps: async (
      voiceId: string,
      request: TextToSpeechRequest,
    ): Promise<{ alignment?: CharacterAlignmentResponseModel; audioBase64: string }> => {
      const res = await this.postJson(`/text-to-speech/${encodeURIComponent(voiceId)}/with-timestamps`, request)
      return mapKeys(await res.json(), toCamel) as { alignment?: CharacterAlignmentResponseModel; audioBase64: string }
    },
  }

  readonly speechToText = {
    convert: async (request: SpeechToTextRequest, _options?: unknown): Promise<SpeechToTextChunkResponseModel> =>
      (await this.postForm('/speech-to-text', request)) as SpeechToTextChunkResponseModel,
  }

  readonly forcedAlignment = {
    create: async (request: { file: Blob; text: string }): Promise<ForcedAlignmentResponseModel> =>
      (await this.postForm('/forced-alignment', request)) as ForcedAlignmentResponseModel,
  }

  readonly voices = {
    ivc: {
      create: async (request: {
        description?: string
        files: Blob[]
        labels?: Record<string, string> | string
        name: string
        removeBackgroundNoise?: boolean
      }): Promise<{ requiresVerification?: boolean; voiceId: string }> =>
        (await this.postForm('/voices/add', request)) as { requiresVerification?: boolean; voiceId: string },
    },
  }

  private async postJson(path: string, request: Record<string, unknown>): Promise<Response> {
    const query = new URLSearchParams()
    const body: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(request)) {
      if (value === undefined) continue
      if (QUERY_FIELDS.has(key)) query.set(toSnake(key), String(value))
      else body[key] = value
    }
    const qs = query.toString()
    return this.send(`${path}${qs ? `?${qs}` : ''}`, {
      body: JSON.stringify(mapKeys(body, toSnake)),
      headers: { 'Content-Type': 'application/json' },
    })
  }

  private async postForm(path: string, request: Record<string, unknown>): Promise<unknown> {
    const form = new FormData()
    for (const [key, value] of Object.entries(request)) {
      if (value === undefined) continue
      const field = toSnake(key)
      if (Array.isArray(value) && value.every((v) => v instanceof Blob)) {
        for (const blob of value) form.append(field, blob as Blob, (blob as File).name || 'audio')
      } else if (value instanceof Blob) {
        form.append(field, value, (value as File).name || 'audio')
      } else {
        form.append(field, typeof value === 'object' ? JSON.stringify(value) : String(value))
      }
    }
    const res = await this.send(path, { body: form })
    return mapKeys(await res.json(), toCamel)
  }

  private async send(path: string, init: { body: BodyInit; headers?: Record<string, string> }): Promise<Response> {
    const res = await fetch(`${BASE_URL}${path}`, {
      body: init.body,
      headers: { 'xi-api-key': this.apiKey, ...init.headers },
      method: 'POST',
    })
    if (!res.ok) {
      throw new Error(`ElevenLabs ${path} failed (${res.status}): ${(await res.text()).slice(0, 500)}`)
    }
    return res
  }
}
