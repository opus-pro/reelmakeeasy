import { X_REELMAKEEASY_REQ_CTX } from '@reelmakeeasy/common/constant/headers'
import { getReqContext } from '@reelmakeeasy/common/utils/req-ctx'

const INTERNAL_POST_TIMEOUT_MS = 10_000
const UIP_INTERNAL_API_PREFIX = '/api/uip-sessions/internal'

export async function postToInternalApi(
  path: string,
  payload: string,
  stringified: true,
  externalSignal?: AbortSignal,
): Promise<Response>
export async function postToInternalApi(
  path: string,
  payload: unknown,
  stringified?: false,
  externalSignal?: AbortSignal,
): Promise<Response>
export async function postToInternalApi(
  path: string,
  payload: unknown,
  stringified?: boolean,
  externalSignal?: AbortSignal,
): Promise<Response> {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const controller = new AbortController()

  // The API in this process, on its PORT (a second copy runs on another one).
  const domain = `http://127.0.0.1:${process.env['PORT'] || 5017}`

  const ctx = getReqContext()
  const reqCtxHeader = ctx ? Buffer.from(JSON.stringify(ctx)).toString('base64') : undefined

  const timeoutId = setTimeout(() => controller.abort(), INTERNAL_POST_TIMEOUT_MS)

  // If caller passed an externalSignal (typically the activity's
  // ctx.cancellationSignal), forward its abort onto our controller so the
  // in-flight fetch gets cancelled the moment the activity is cancelled.
  // We propagate the abort but keep our own controller ownership so the
  // local timeout still works.
  let externalAbortListener: (() => void) | undefined
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort()
    } else {
      externalAbortListener = () => controller.abort()
      externalSignal.addEventListener('abort', externalAbortListener)
    }
  }

  try {
    return await fetch(`${domain}${UIP_INTERNAL_API_PREFIX}${normalizedPath}`, {
      body: stringified ? String(payload) : JSON.stringify(payload),
      headers: {
        'Content-Type': 'application/json',
        ...(reqCtxHeader && { [X_REELMAKEEASY_REQ_CTX]: reqCtxHeader }),
      },
      method: 'POST',
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeoutId)
    if (externalSignal && externalAbortListener) {
      externalSignal.removeEventListener('abort', externalAbortListener)
    }
  }
}
