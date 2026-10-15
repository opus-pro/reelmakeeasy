'use client'

import { createWeakMapFn } from '@reelmakeeasy/common/utils/memo-fn'
import axios from 'axios'
import { useAtomValue, useStore } from 'jotai'
import { useCallback } from 'react'
import { z } from 'zod'

import { apiOriginAtom } from '@/atom/apiOrigin'
import { shareIdAtom } from '@/atom/share'
import { REQUEST_TIMEOUT_MESSAGE } from '@/constants/request-timeouts'
import { ApiError } from '@/lib/api-error'
import type { JotaiStore } from '@/lib/jotai-types'
import { SSEConnection, type SSEHandlers } from '@/util/sse'

/**
 * Schema for parsing API error responses
 * Handles common error formats from backend (NestJS, Express, etc.)
 */
const ApiErrorResponseSchema = z.object({
  message: z.string().optional(),
  error: z.string().optional(),
  code: z.string().optional(),
  statusCode: z.number().optional(),
  details: z.unknown().optional(),
  // Some error bodies use { errorMessage, errorName } instead of { message }.
  // Without these keys the parse "succeeds" with every field undefined and the
  // generic fallback masks the real message.
  errorMessage: z.string().optional(),
  errorName: z.string().optional(),
})

export type FetchOptions<PathParams extends Record<string, string> = Record<string, string>> = {
  data?: object
  headers?: Record<string, string | undefined>
  /**
   * Let the request outlive the document that started it. For a write fired
   * immediately before a full-document navigation (`hardNavigate`): the browser
   * cancels a normal in-flight request when the new document commits, and the
   * API is cross-origin with custom headers, so the CORS preflight alone
   * usually loses that race. Fetch adapter only (every non-stream request).
   */
  keepalive?: boolean
  method?: 'DELETE' | 'GET' | 'HEAD' | 'PATCH' | 'POST' | 'PUT'
  noThrowError?: boolean
  pathParams?: PathParams
  queryParams?: Record<string, boolean | number | string | undefined>
  responseType?: 'arraybuffer' | 'blob' | 'document' | 'json' | 'stream' | 'text'
  // Per-request axios timeout in ms. Omitted -> axios default (0 = no timeout),
  // so existing callers are unaffected. Set it for the rare long-running
  // synchronous endpoint (e.g. video ingestion) that must not be cut short.
  timeout?: number
  withCredentials?: boolean
}

export type FetchResponse<T> = {
  data: T
  error: null | string
  ok: boolean
  status: number
}

type ApiHeadersRuntime = {
  shareId?: string
}

type ApiRuntime = {
  apiOrigin?: string
  shareId?: string
}

type CreateSSEConnectionFn = (
  url: string,
  handlers: SSEHandlers,
  options?: Omit<FetchOptions, 'data' | 'method' | 'responseType'> & {
    timeoutMs?: number
  },
) => SSEConnection

type FetchApiDomainFn = <ResData>(
  url: string,
  options?: FetchOptions,
) => Promise<FetchResponse<ResData>>

type FetchWithAuthFn = <ResData>(
  url: string,
  options?: FetchOptions,
) => Promise<FetchResponse<ResData>>

// useRefCallback-equivalent semantics via store-scoped weak-map cache:
// stable function reference per store, while runtime values are read fresh on each call.
const getStoreScopedFetchWithAuth = createWeakMapFn(
  (store: JotaiStore): FetchWithAuthFn =>
    async <ResData>(url: string, options: FetchOptions = {}): Promise<FetchResponse<ResData>> => {
      const runtime = getApiRuntime(store)
      const mergedHeaders = buildMergedApiHeaders(runtime, options.headers)

      const method = options.method || 'GET'
      const isGetLikeMethod = method === 'GET' || method === 'HEAD'

      // stream responseType requires XHR adapter; all others use fetch for h2 multiplexing
      const adapter = options.responseType === 'stream' ? 'xhr' : 'fetch'

      try {
        const response = await axios.request({
          adapter,
          data: isGetLikeMethod
            ? undefined
            : method === 'POST'
              ? (options.data ?? {})
              : options.data,
          ...resolveKeepaliveConfig(options.keepalive),
          headers: mergedHeaders,
          method,
          params: isGetLikeMethod ? options.data : undefined,
          responseType: options.responseType || 'json',
          timeout: options.timeout,
          url,
          withCredentials: options.withCredentials,
        })

        const isSuccess = response.status >= 200 && response.status < 300

        if (!isSuccess && !options.noThrowError) {
          throw createErrorFromResponse(response.data, response.status, response.statusText)
        }

        return {
          data: response.data,
          error: isSuccess ? null : `API request failed: ${response.statusText}`,
          ok: isSuccess,
          status: response.status,
        }
      } catch (axiosError) {
        return handleFetchWithAuthError<ResData>(axiosError, options.noThrowError)
      }
    },
)

// Create SSE connection with unified auth/debug headers.
const getStoreScopedCreateSSEConnection = createWeakMapFn(
  (store: JotaiStore): CreateSSEConnectionFn =>
    (
      url: string,
      handlers: SSEHandlers,
      options: Omit<FetchOptions, 'data' | 'method' | 'responseType'> & {
        timeoutMs?: number
      } = {},
    ): SSEConnection => {
      const runtime = getApiRuntime(store)
      const { absoluteUrl } = resolveUrlAndHeadersWithApiOrigin(url, options, runtime.apiOrigin)

      // Remove Content-Type for SSE requests.
      const sseHeaders = options.headers
        ? { ...options.headers, 'Content-Type': undefined }
        : { 'Content-Type': undefined }
      const mergedHeaders = buildMergedApiHeaders(runtime, sseHeaders)

      return new SSEConnection(absoluteUrl, handlers, {
        headers: mergedHeaders,
        timeoutMs: options.timeoutMs ?? 5000,
        withCredentials: options.withCredentials ?? false,
      })
    },
)

export type API = ReturnType<typeof useApi>

export type CreateSSEConnection = API['createSSEConnection']

export type FetchApiDomain = API['fetchApiDomain']

export type FetchWithAuth = API['fetchWithAuth']

export function useApi() {
  const store = useStore() as JotaiStore
  const apiOrigin = useAtomValue(apiOriginAtom)
  const shareId = useAtomValue(shareIdAtom)

  const fetchWithAuth = getStoreScopedFetchWithAuth(store)
  const createSSEConnection = getStoreScopedCreateSSEConnection(store)

  // Keep this aligned with prior useCallback dependency semantics so consumers can
  // observe reference updates when API origin or share headers change.
  const fetchApiDomain: FetchApiDomainFn = useCallback(
    async <ResData>(url: string, options: FetchOptions = {}): Promise<FetchResponse<ResData>> => {
      const { absoluteUrl, headers } = resolveUrlAndHeadersWithApiOrigin(url, options, apiOrigin)
      return fetchWithAuth(absoluteUrl, { ...options, headers })
    },
    [apiOrigin, fetchWithAuth, shareId],
  )

  return { fetchWithAuth, fetchApiDomain, createSSEConnection }
}

function buildMergedApiHeaders(
  runtime: ApiHeadersRuntime,
  rawHeaders?: Headers | Record<string, string | undefined>,
) {
  // Build base headers (defaults).
  const baseHeaders: Record<string, string | undefined> = {
    'Content-Type': 'application/json',
    'X-REELMAKEEASY-SHARED-ID': runtime.shareId,
  }

  // Merge raw headers so callers can override defaults (e.g. unset Content-Type).
  const mergedHeadersWithUndefined: Record<string, string | undefined> = {
    ...baseHeaders,
    ...toRecordHeaders(rawHeaders),
  }

  // Remove headers explicitly set to undefined so axios/browser can handle them.
  return Object.fromEntries(
    Object.entries(mergedHeadersWithUndefined).filter(([_, value]) => value !== undefined),
  ) as Record<string, string>
}

/**
 * `fetchOptions` reaches the underlying `fetch` init untouched. Spread in only
 * when keepalive was asked for, so the XHR adapter (responseType: 'stream')
 * never sees a config key it does not understand. A helper rather than an
 * inline ternary: the request function sits at the cognitive-complexity ceiling.
 */
function resolveKeepaliveConfig(keepalive: boolean | undefined) {
  return keepalive ? { fetchOptions: { keepalive: true } } : {}
}

// Extract error message from response data and create ApiError object
// Uses zod for declarative parsing; preserves full payload for business logic
export function createErrorFromResponse(
  data: unknown,
  status: number,
  statusText: string,
): ApiError {
  const parsed = ApiErrorResponseSchema.safeParse(data)

  if (parsed.success) {
    const { message, error, code, errorMessage: houseErrorMessage } = parsed.data
    const errorMessage =
      message || houseErrorMessage || error || `API request failed: ${statusText}`
    return new ApiError(errorMessage, status, code, data)
  }

  // Fallback for non-object or unexpected error formats
  return new ApiError(`API request failed: ${statusText}`, status, undefined, data)
}

function getApiRuntime(store: JotaiStore): ApiRuntime {
  return {
    apiOrigin: store.get(apiOriginAtom),
    shareId: store.get(shareIdAtom),
  }
}

function handleFetchWithAuthError<ResData>(
  axiosError: unknown,
  noThrowError?: boolean,
): FetchResponse<ResData> {
  // Handle axios errors (4xx, 5xx, network errors)
  if (axios.isAxiosError(axiosError) && axiosError.response) {
    const response = axiosError.response
    const error = createErrorFromResponse(response.data, response.status, response.statusText)

    if (noThrowError) {
      return {
        data: response.data as ResData,
        error: error.message,
        ok: false,
        status: response.status,
      }
    }

    throw error
  }

  // Handle network errors or other axios errors
  const errorMessage = isRequestTimeoutError(axiosError)
    ? REQUEST_TIMEOUT_MESSAGE
    : axios.isAxiosError(axiosError) && axiosError.message
      ? axiosError.message
      : 'Network error or request failed'

  if (noThrowError) {
    return {
      data: null as unknown as ResData,
      error: errorMessage,
      ok: false,
      status: 0,
    }
  }

  throw new Error(errorMessage)
}

// A `timeout` breach surfaces as ETIMEDOUT from the fetch adapter (used for
// everything except responseType: 'stream') and ECONNABORTED from the XHR one,
// always with no `response` -- the request never came back. The response check
// is what makes that last part true rather than assumed: callers that reach
// here after their own `response` branch would pass either way, but this is
// exported, so it has to be right on its own terms.
export function isRequestTimeoutError(error: unknown): boolean {
  return (
    axios.isAxiosError(error) &&
    !error.response &&
    (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT')
  )
}

// Resolve URL (path params + apiOrigin) and normalize pass-through headers from options.
function resolveUrlAndHeadersWithApiOrigin(
  url: string,
  options: FetchOptions = {},
  apiOrigin?: string,
): { absoluteUrl: string; headers: Record<string, string | undefined> } {
  let finalUrl = url
  if (options.pathParams) {
    finalUrl = finalUrl.replace(/{(\w+)}/g, (match, key) => options.pathParams?.[key] || match)
  }
  const absoluteUrl = new URL(finalUrl, apiOrigin || undefined).toString()

  return { absoluteUrl, headers: toRecordHeaders(options.headers) }
}

function toRecordHeaders(rawHeaders?: Headers | Record<string, string | undefined>) {
  if (!rawHeaders) {
    return {}
  }

  return rawHeaders instanceof Headers ? Object.fromEntries(rawHeaders.entries()) : rawHeaders
}
