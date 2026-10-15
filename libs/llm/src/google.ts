/**
 * The Gemini API (an AI Studio key in GEMINI_API_KEY) over plain HTTP, for the
 * google generation provider: generateContent (pictures, speech, music),
 * long-running predictions polled to the end (Veo), the Interactions API (Omni
 * Flash, Gemini Transcribe), and the Files API for uploads and for the files
 * the models make. Failures come back as GoogleApiError: plain words, plus the
 * provider code the pipeline's retries, safety rewrites and breaker read.
 */
import { geminiKey, llmConfig } from './config'

const API = 'https://generativelanguage.googleapis.com/v1beta'
const UPLOAD_API = 'https://generativelanguage.googleapis.com/upload/v1beta/files'
/** The only host the API key is ever sent to. */
const GOOGLE_API_HOST = 'generativelanguage.googleapis.com'
const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000
const SUBMIT_TIMEOUT_MS = 2 * 60 * 1000
const POLL_INTERVAL_MS = 5000
const FILE_POLL_INTERVAL_MS = 2000
/** A status check that fails this many times in a row fails the call; fewer are retried. */
const MAX_STATUS_ERRORS = 3
const DOWNLOAD_ATTEMPTS = 3
const MAX_REDIRECTS = 5
const FILE_ID = /\/files\/([^/:?]+)/

/** Finish or block reasons that mean a safety filter stopped the answer. */
const SAFETY_REASONS = new Set([
  'BLOCKLIST',
  'IMAGE_PROHIBITED_CONTENT',
  'IMAGE_SAFETY',
  'PROHIBITED_CONTENT',
  'SAFETY',
  'SPII',
])
/** The safety reasons about a picture: the pipeline swaps the picture rather than the words. */
const IMAGE_SAFETY_REASONS = new Set(['IMAGE_PROHIBITED_CONTENT', 'IMAGE_SAFETY'])

export const GOOGLE_SAFETY_MESSAGE =
  "Gemini's safety filter turned this request down. Try different words or pictures."

export interface GenerateContentResponse {
  candidates?: { content?: { parts?: GooglePart[] }; finishReason?: string }[]
  promptFeedback?: { blockReason?: string }
}

export interface GoogleFile {
  mimeType?: string
  name: string
  state?: string
  uri: string
}

export interface GoogleInlineData {
  data: string
  mimeType: string
}

export interface GoogleInteraction {
  id?: string
  status?: string
  steps?: { content?: GoogleInteractionContent[]; type?: string }[]
}

export interface GoogleInteractionContent {
  /** Word timings on a transcript (`type: 'word_info'`). */
  annotations?: GoogleWordInfo[]
  data?: string
  mime_type?: string
  text?: string
  type?: string
  uri?: string
}

export interface GoogleOperation {
  done?: boolean
  error?: { code?: number; message?: string }
  name: string
  response?: Record<string, unknown>
}

export interface GooglePart {
  inlineData?: GoogleInlineData
  text?: string
  thought?: boolean
}

/**
 * Normalized failure codes, the same values as `ProviderCode` in
 * libs/shared/common/src/utils/provider-error.ts (libs/llm can't import it): its
 * duck-typed `asProviderErrorShape` reads them off GoogleApiError.
 */
export type GoogleProviderCode =
  | 'auth_error'
  | 'internal_error'
  | 'invalid_input'
  | 'no_output'
  | 'policy_blocked'
  | 'policy_blocked_image'
  | 'rate_limit'
  | 'task_failed'
  | 'task_timeout'

export interface GoogleWordInfo {
  end_offset?: string
  speaker?: string
  start_offset?: string
  text?: string
  type?: string
}

interface CallOptions {
  intervalMs?: number
  signal?: AbortSignal
  timeoutMs?: number
}

interface GoogleFailure {
  message: string
  providerCode: GoogleProviderCode
}

export class GoogleApiError extends Error {
  /** The API's own answer, cut to 2,000 characters, for logs. */
  readonly detail: string
  readonly httpStatus?: number
  override readonly name = 'GoogleApiError'
  readonly provider = 'google'
  readonly providerCode: GoogleProviderCode
  /** Gemini's finish or block reason, or the operation's error code. */
  readonly rawProviderCode?: string

  constructor(params: {
    detail?: string
    httpStatus?: number
    message: string
    providerCode: GoogleProviderCode
    rawProviderCode?: string
  }) {
    super(params.message)
    this.detail = params.detail ?? ''
    this.httpStatus = params.httpStatus
    this.providerCode = params.providerCode
    this.rawProviderCode = params.rawProviderCode
  }
}

/** Plain words and a provider code for a failed call: plan, key, quota, region, safety, model id. */
export function describeGoogleFailure(what: string, status: number, body: string): GoogleFailure {
  const text = body.toLowerCase()
  const quota =
    status === 429 || text.includes('resource has been exhausted') || text.includes('quota')
  // Every 429 says "check your plan and billing details". Only a quota of zero (a free key
  // asking for a paid-only model) is about the plan; any other quota error passes.
  const paidOnly = quota
    ? /\blimit: 0\b/.test(text)
    : text.includes('billing') || text.includes('paid tier')
  if (paidOnly)
    return {
      message:
        'This Gemini model needs a paid Gemini API plan. Turn on billing at aistudio.google.com.',
      providerCode: 'auth_error',
    }
  if (status === 401 || status === 403 || text.includes('api key not valid'))
    return {
      message:
        'Gemini rejected the API key. Check GEMINI_API_KEY in .env, then restart ReelMakeEasy.',
      providerCode: 'auth_error',
    }
  if (quota)
    return {
      message:
        'The Gemini API limit is used up for now. Wait a minute and try again, or check your plan at aistudio.google.com.',
      providerCode: 'rate_limit',
    }
  if (text.includes('location is not supported') || text.includes('not available in your country'))
    return {
      message: "This Gemini model isn't available in your region.",
      providerCode: 'invalid_input',
    }
  if (text.includes('safety') || text.includes('blocked'))
    return {
      message: GOOGLE_SAFETY_MESSAGE,
      providerCode: text.includes('image') ? 'policy_blocked_image' : 'policy_blocked',
    }
  if (status === 404)
    return {
      message: `Gemini has no ${what}. The model id may have changed: check reelmakeeasy.models.json.`,
      providerCode: 'invalid_input',
    }
  return {
    message: `Gemini ${what} failed (${status}): ${body.slice(0, 300)}`,
    providerCode:
      status >= 500 ? 'internal_error' : status >= 400 ? 'invalid_input' : 'task_failed',
  }
}

/** A GoogleApiError for a failed HTTP call. */
export function googleHttpError(what: string, status: number, body: string): GoogleApiError {
  return new GoogleApiError({
    ...describeGoogleFailure(what, status, body),
    detail: body.slice(0, 2000),
    httpStatus: status || undefined,
  })
}

/** `data:image/png;base64,...` as the body of a Gemini inline part. */
export function inlineDataFromUri(uri: string): GoogleInlineData {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(uri)
  if (!match) throw new Error('Gemini requests take pictures as base64 data URIs')
  return { data: match[2] ?? '', mimeType: match[1] ?? 'application/octet-stream' }
}

/** The media parts of an answer (thinking drafts skipped), or a GoogleApiError when there are none. */
export function inlineParts(
  res: GenerateContentResponse,
  kind: 'audio' | 'image',
): GoogleInlineData[] {
  const candidate = res.candidates?.[0]
  const parts = (candidate?.content?.parts ?? []).flatMap((part) =>
    part.inlineData && !part.thought && part.inlineData.mimeType.startsWith(kind)
      ? [part.inlineData]
      : [],
  )
  if (parts.length) return parts
  const blocked = res.promptFeedback?.blockReason
  const reason = blocked ?? candidate?.finishReason ?? ''
  if (blocked || SAFETY_REASONS.has(reason)) throw safetyError(reason)
  const why = reason ? ` (finish reason ${reason})` : ''
  throw new GoogleApiError({
    message: `Gemini returned no ${kind}${why}`,
    providerCode: 'no_output',
    rawProviderCode: reason || undefined,
  })
}

/** The first output block of a type (`video`, `audio`, `image`, `text`) in a finished interaction. */
export function interactionContent(
  interaction: GoogleInteraction,
  type: string,
): GoogleInteractionContent {
  for (const block of modelOutput(interaction)) {
    if (block.type === type && (block.data || block.uri || block.text)) return block
  }
  throw new GoogleApiError({ message: `Gemini returned no ${type}`, providerCode: 'no_output' })
}

/** Every output block of a finished interaction, in order (thinking steps skipped). */
export function modelOutput(interaction: GoogleInteraction): GoogleInteractionContent[] {
  return (interaction.steps ?? []).flatMap((step) =>
    step.type === 'model_output' ? (step.content ?? []) : [],
  )
}

/** A safety block: `policy_blocked_image` for a picture, else `policy_blocked` (the prompt). */
export function safetyError(reason: string): GoogleApiError {
  return new GoogleApiError({
    detail: reason,
    httpStatus: 400,
    message: GOOGLE_SAFETY_MESSAGE,
    providerCode: IMAGE_SAFETY_REASONS.has(reason) ? 'policy_blocked_image' : 'policy_blocked',
    rawProviderCode: reason || undefined,
  })
}

// ---------- calls ----------

/** The Gemini API calls the google adapters make, as one object so tests can stub single calls. */
export const runGoogle = {
  createInteraction,
  download,
  generateContent,
  pollOperation,
  predictLongRunning,
  upload,
}

const keyHeader = (): Record<string, string> => ({ 'x-goog-api-key': geminiKey() })
const jsonHeaders = (): Record<string, string> => ({
  'Content-Type': 'application/json',
  ...keyHeader(),
})
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))
const isGoogleApi = (url: string): boolean => new URL(url).host === GOOGLE_API_HOST
const isRetryable = (error: unknown): boolean =>
  !(error instanceof GoogleApiError) ||
  error.providerCode === 'rate_limit' ||
  error.providerCode === 'internal_error'

async function createInteraction(
  body: Record<string, unknown>,
  opts: CallOptions = {},
): Promise<GoogleInteraction> {
  const what = `model ${String(body['model'])}`
  const res = await fetch(`${API}/interactions`, {
    body: JSON.stringify(body),
    headers: jsonHeaders(),
    method: 'POST',
    signal: timeoutSignal(opts),
  })
  const interaction = await readJson<GoogleInteraction>(res, what)
  if (interaction.status === 'failed')
    throw new GoogleApiError({
      message: `Gemini ${what} failed (${interaction.id ?? 'no id'})`,
      providerCode: 'task_failed',
    })
  return interaction
}

/** Downloads a file a Gemini model made, retrying server errors; the key goes only to Google. */
async function download(
  uri: string,
  opts: CallOptions & { waitUntilActive?: boolean } = {},
): Promise<Buffer> {
  const id = FILE_ID.exec(uri)?.[1]
  if (opts.waitUntilActive && id && isGoogleApi(uri)) await waitForFile(id, opts)
  for (let attempt = 1; ; attempt++) {
    const res = await fetchFile(uri).catch((err: unknown) => err as Error)
    if (!(res instanceof Error) && res.ok) return Buffer.from(await res.arrayBuffer())
    const status = res instanceof Error ? 0 : res.status
    const transient = status === 0 || status === 429 || status >= 500
    if (attempt >= DOWNLOAD_ATTEMPTS || !transient) {
      const body = res instanceof Error ? res.message : await res.text()
      throw googleHttpError(`download ${uri}`, status, body)
    }
    await sleep(1000 * 2 ** (attempt - 1))
  }
}

/** Fetches a file, following redirects by hand so the key never reaches another host. */
async function fetchFile(uri: string): Promise<Response> {
  let url = uri
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const res = await fetch(url, {
      headers: isGoogleApi(url) ? keyHeader() : {},
      redirect: 'manual',
    })
    const location = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null
    if (!location) return res
    url = new URL(location, url).toString()
  }
  throw new Error(`Gemini download ${uri} redirected more than ${MAX_REDIRECTS} times`)
}

/** The answer of a finished operation, or its error as a GoogleApiError. */
function finishedOperation(op: GoogleOperation): GoogleOperation {
  if (!op.error) return op
  const message = op.error.message ?? 'unknown error'
  // Operation errors carry gRPC codes, not HTTP statuses: classify by the words alone.
  const failure = describeGoogleFailure(op.name, 0, message)
  throw new GoogleApiError({
    detail: message,
    message: failure.message,
    providerCode: failure.providerCode === 'invalid_input' ? 'task_failed' : failure.providerCode,
    rawProviderCode: op.error.code === undefined ? undefined : String(op.error.code),
  })
}

async function generateContent(
  model: string,
  body: Record<string, unknown>,
  opts: CallOptions = {},
): Promise<GenerateContentResponse> {
  const res = await fetch(`${API}/models/${model}:generateContent`, {
    body: JSON.stringify(body),
    headers: jsonHeaders(),
    method: 'POST',
    signal: timeoutSignal(opts),
  })
  return readJson(res, `model ${model}`)
}

/** Polls a long-running operation until it is done; a few failed status checks in a row are retried. */
async function pollOperation(name: string, opts: CallOptions = {}): Promise<GoogleOperation> {
  const deadline = Date.now() + (opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  let statusErrors = 0
  for (;;) {
    opts.signal?.throwIfAborted()
    if (Date.now() > deadline)
      throw new GoogleApiError({
        message: `Gemini ${name} timed out`,
        providerCode: 'task_timeout',
      })
    await sleep(opts.intervalMs ?? POLL_INTERVAL_MS)
    let op: GoogleOperation
    try {
      op = await readJson<GoogleOperation>(
        await fetch(`${API}/${name}`, { headers: keyHeader() }),
        name,
      )
      statusErrors = 0
    } catch (error) {
      // A network blip shouldn't throw away a clip that is still being made.
      if (!isRetryable(error) || ++statusErrors >= MAX_STATUS_ERRORS) throw error
      llmConfig().logger.warn(`[gemini] status check ${statusErrors} for ${name} failed; retrying`)
      continue
    }
    if (op.done) return finishedOperation(op)
  }
}

async function predictLongRunning(
  model: string,
  body: Record<string, unknown>,
  opts: CallOptions = {},
): Promise<GoogleOperation> {
  const res = await fetch(`${API}/models/${model}:predictLongRunning`, {
    body: JSON.stringify(body),
    headers: jsonHeaders(),
    method: 'POST',
    signal: timeoutSignal(opts, SUBMIT_TIMEOUT_MS),
  })
  const operation = await readJson<GoogleOperation>(res, `model ${model}`)
  llmConfig().logger.info(`[gemini] started ${model} operation=${operation.name}`)
  return operation
}

async function readJson<T>(res: Response, what: string): Promise<T> {
  const text = await res.text()
  if (!res.ok) throw googleHttpError(what, res.status, text)
  return (text ? JSON.parse(text) : {}) as T
}

function timeoutSignal(opts: CallOptions, fallbackMs = DEFAULT_TIMEOUT_MS): AbortSignal {
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? fallbackMs)
  return opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout
}

/** Uploads bytes with the resumable Files API and waits until the file is ready. */
async function upload(bytes: Buffer, mimeType: string, displayName: string): Promise<GoogleFile> {
  const start = await fetch(UPLOAD_API, {
    body: JSON.stringify({ file: { display_name: displayName } }),
    headers: {
      ...jsonHeaders(),
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(bytes.length),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'X-Goog-Upload-Protocol': 'resumable',
    },
    method: 'POST',
  })
  if (!start.ok) throw googleHttpError('upload', start.status, await start.text())
  const uploadUrl = start.headers.get('x-goog-upload-url')
  if (!uploadUrl) throw new Error('Gemini upload did not return an upload URL')
  const finished = await fetch(uploadUrl, {
    body: new Uint8Array(bytes),
    headers: { 'X-Goog-Upload-Command': 'upload, finalize', 'X-Goog-Upload-Offset': '0' },
    method: 'POST',
  })
  const { file } = await readJson<{ file: GoogleFile }>(finished, 'upload')
  const id = FILE_ID.exec(file.uri)?.[1] ?? file.name.replace(/^files\//, '')
  return file.state === 'ACTIVE' ? file : waitForFile(id)
}

/** Waits until a file is ready (state ACTIVE); FAILED fails the call. */
async function waitForFile(id: string, opts: CallOptions = {}): Promise<GoogleFile> {
  const deadline = Date.now() + (opts.timeoutMs ?? DEFAULT_TIMEOUT_MS)
  for (;;) {
    const file = await readJson<GoogleFile>(
      await fetch(`${API}/files/${id}`, { headers: keyHeader() }),
      `file ${id}`,
    )
    if (!file.state || file.state === 'ACTIVE') return file
    if (file.state === 'FAILED')
      throw new GoogleApiError({
        message: `Gemini could not finish file ${id}`,
        providerCode: 'task_failed',
      })
    if (Date.now() > deadline)
      throw new GoogleApiError({
        message: `Gemini file ${id} was not ready in time`,
        providerCode: 'task_timeout',
      })
    await sleep(opts.intervalMs ?? FILE_POLL_INTERVAL_MS)
  }
}
