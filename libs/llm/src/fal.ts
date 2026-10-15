import { falKey, llmConfig } from './config'

const QUEUE_BASE = 'https://queue.fal.run'
/**
 * Status polls: quick at first, since fast models (Hailuo 3 turbo) finish in
 * seconds and each poll interval is added to the wait; slower after that, for
 * jobs that take minutes.
 */
const FAST_POLL_MS = 500
const FAST_POLL_WINDOW_MS = 30_000
const POLL_INTERVAL_MS = 2000
/** A status check that fails this many times in a row fails the call; fewer are retried. */
const MAX_STATUS_ERRORS = 3
const DEFAULT_TIMEOUT_MS = 20 * 60 * 1000

interface QueueStatus {
  error?: string
  status: 'COMPLETED' | 'FAILED' | 'IN_PROGRESS' | 'IN_QUEUE'
}

interface QueueSubmitResponse {
  request_id: string
  response_url: string
  status_url: string
}

function headers(): Record<string, string> {
  return { Authorization: `Key ${falKey()}`, 'Content-Type': 'application/json' }
}

async function readJson<T>(res: Response, what: string): Promise<T> {
  const text = await res.text()
  if (!res.ok) throw new Error(`fal ${what} failed (${res.status}): ${text.slice(0, 500)}`)
  return JSON.parse(text) as T
}

/**
 * Runs one fal model through the queue REST API: submit, poll the status URL,
 * then fetch the result. Returns the model's output JSON and the request id.
 */
export async function runFal<T = Record<string, unknown>>(
  endpoint: string,
  input: Record<string, unknown>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  signal?: AbortSignal,
): Promise<{ output: T; requestId: string }> {
  const { logger } = llmConfig()
  const submitted = await readJson<QueueSubmitResponse>(
    await fetch(`${QUEUE_BASE}/${endpoint}`, {
      body: JSON.stringify(input),
      headers: headers(),
      method: 'POST',
    }),
    `submit ${endpoint}`,
  )
  logger.info(`[fal] submitted ${endpoint} request=${submitted.request_id}`)

  const started = Date.now()
  const deadline = started + timeoutMs
  let statusErrors = 0
  for (;;) {
    signal?.throwIfAborted()
    if (Date.now() > deadline) throw new Error(`fal ${endpoint} timed out after ${timeoutMs}ms`)
    const interval = Date.now() - started < FAST_POLL_WINDOW_MS ? FAST_POLL_MS : POLL_INTERVAL_MS
    await new Promise((r) => setTimeout(r, interval))
    let status: QueueStatus
    try {
      status = await readJson<QueueStatus>(
        await fetch(submitted.status_url, { headers: headers() }),
        `status ${endpoint}`,
      )
      statusErrors = 0
    } catch (error) {
      // A network blip shouldn't throw away a generation that is still running.
      if (++statusErrors >= MAX_STATUS_ERRORS) throw error
      logger.warn(`[fal] status check ${statusErrors} for ${endpoint} failed; retrying`)
      continue
    }
    if (status.status === 'COMPLETED') break
    if (status.status === 'FAILED')
      throw new Error(`fal ${endpoint} failed: ${status.error ?? 'unknown error'}`)
  }

  const output = await readJson<T>(
    await fetch(submitted.response_url, { headers: headers() }),
    `result ${endpoint}`,
  )
  return { output, requestId: submitted.request_id }
}

const DOWNLOAD_ATTEMPTS = 4
const DOWNLOAD_RETRY_BASE_MS = 1000

/** Worth retrying: fal's CDN can 404 or 5xx for a moment right after a result is written. */
const isTransientStatus = (status: number) =>
  status === 404 || status === 408 || status === 429 || status >= 500

export async function download(url: string): Promise<Buffer> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url).catch((err: unknown) => err as Error)
    if (!(res instanceof Error) && res.ok) return Buffer.from(await res.arrayBuffer())
    const reason = res instanceof Error ? res.message : String(res.status)
    if (
      attempt >= DOWNLOAD_ATTEMPTS ||
      (!(res instanceof Error) && !isTransientStatus(res.status))
    ) {
      throw new Error(`Failed to download ${url}: ${reason}`)
    }
    llmConfig().logger.warn(
      `[fal] download ${url} failed (${reason}), retrying (${attempt}/${DOWNLOAD_ATTEMPTS - 1})`,
    )
    await new Promise((r) => setTimeout(r, DOWNLOAD_RETRY_BASE_MS * 2 ** (attempt - 1)))
  }
}

const STORAGE_INITIATE_URL =
  'https://rest.alpha.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3'

/** Uploads bytes to fal's CDN and returns a URL fal models can read. */
async function upload(file: Blob): Promise<string> {
  const contentType = file.type || 'application/octet-stream'
  const fileName = (file as File).name || 'upload.bin'
  const initiated = await readJson<{ file_url: string; upload_url: string }>(
    await fetch(STORAGE_INITIATE_URL, {
      body: JSON.stringify({ content_type: contentType, file_name: fileName }),
      headers: headers(),
      method: 'POST',
    }),
    'storage initiate',
  )
  const put = await fetch(initiated.upload_url, {
    body: Buffer.from(await file.arrayBuffer()),
    headers: { 'Content-Type': contentType },
    method: 'PUT',
  })
  if (!put.ok) throw new Error(`fal storage upload failed (${put.status})`)
  return initiated.file_url
}

/** A minimal stand-in for the fal client surface the pipeline uses, over plain HTTP. */
export const fal = {
  storage: { upload },
  async subscribe<T = unknown>(
    endpoint: string,
    options: {
      abortSignal?: AbortSignal
      input: Record<string, unknown>
      logs?: boolean
      timeout?: number
    },
  ): Promise<{ data: T; requestId: string }> {
    const { output, requestId } = await runFal<T>(
      endpoint,
      options.input,
      options.timeout,
      options.abortSignal,
    )
    return { data: output, requestId }
  },
}

export type FalClient = typeof fal
