import { ensureError } from './error-handler'

/**
 * Structured error for external model provider failures.
 *
 * Distinguishes two failure layers:
 *   1. HTTP-level: non-2xx response from the provider API -> set httpStatus
 *   2. Job-level:  async task failed/timeout/policy block -> set providerCode
 *
 * Both layers can coexist (e.g. a 400 with SensitiveContentDetected).
 */
export type ProviderCode =
  | 'auth_error'
  | 'internal_error'
  | 'invalid_input'
  | 'no_output'
  | 'policy_blocked'
  | 'policy_blocked_image'
  | 'rate_limit'
  | 'task_failed'
  | 'task_timeout'

export class ProviderError extends Error {
  /** HTTP status code when the failure is at the HTTP transport layer. */
  readonly httpStatus?: number

  /** The name of the provider (e.g. 'kling', 'seedance', 'seedream', 'veo'). */
  readonly provider: string

  /**
   * Normalized failure code. Values:
   *   - 'task_failed'    - async job ended in failure state
   *   - 'task_timeout'   - async job did not complete within poll budget
   *   - 'no_output'      - provider responded successfully but returned no usable content
   *   - 'policy_blocked' - content policy / safety filter rejection
   *   - 'rate_limit'     - 429 / quota exceeded (mirrors httpStatus=429)
   *   - 'auth_error'     - 401 / invalid credentials
   *   - 'invalid_input'  - 400 / bad request
   *   - 'internal_error' - 500 / provider-side error
   */
  readonly providerCode: ProviderCode

  /**
   * The raw code string returned by the provider API, for debugging.
   * e.g. 'SensitiveContentDetected', 'ErrCode=50'
   */
  readonly rawProviderCode?: string

  constructor(params: {
    cause?: unknown
    httpStatus?: number
    message: string
    provider: string
    providerCode: ProviderCode
    rawProviderCode?: string
  }) {
    super(`[${params.providerCode}] ${params.message}`)
    this.name = 'ProviderError'
    this.provider = params.provider
    this.providerCode = params.providerCode
    this.httpStatus = params.httpStatus
    this.rawProviderCode = params.rawProviderCode
    this.cause = params.cause
  }

  /**
   * Normalize any unknown error thrown by an external provider into a ProviderError.
   * If the error is already a ProviderError, it is returned unchanged.
   * Otherwise the message is inspected for well-known patterns; unrecognised
   * errors default to 'task_failed'.
   */
  static fromUnknown(error: unknown, provider: string): ProviderError {
    if (error instanceof ProviderError) {
      return error
    }
    // Accept duck-typed ProviderError from other packages (e.g. libs/llm)
    // that share the same shape but are a different class.
    const shape = asProviderErrorShape(error)
    if (shape) {
      return new ProviderError({
        cause: error,
        httpStatus: shape.httpStatus,
        message: shape.message,
        provider: shape.provider ?? provider,
        providerCode: shape.providerCode,
        rawProviderCode: shape.rawProviderCode,
      })
    }
    const message = error instanceof Error ? error.message : String(error)
    return new ProviderError({
      cause: error,
      message,
      provider,
      providerCode: providerCodeFromErrorMessage(message) ?? 'task_failed',
    })
  }
}

/**
 * Duck-typed shape of a ProviderError-like object.
 * Used to bridge across package boundaries where `instanceof` fails
 * (e.g. libs/llm errors carry the same fields on their own class).
 */
interface ProviderErrorShape {
  httpStatus?: number
  message: string
  provider?: string
  providerCode: ProviderCode
  rawProviderCode?: string
}

const PROVIDER_CODE_LIST = [
  'auth_error',
  'internal_error',
  'invalid_input',
  'no_output',
  'policy_blocked',
  'policy_blocked_image',
  'rate_limit',
  'task_failed',
  'task_timeout',
] as const satisfies readonly ProviderCode[]

const VALID_PROVIDER_CODES: ReadonlySet<string> = new Set(PROVIDER_CODE_LIST)

/**
 * Extract ProviderError fields from any error-like object that carries a valid
 * `providerCode`. Returns undefined when the error doesn't match the shape.
 *
 * This handles cross-package boundaries where `instanceof ProviderError` fails
 * because another package and `@reelmakeeasy/common` each define their own class.
 */
export function asProviderErrorShape(error: unknown): ProviderErrorShape | undefined {
  if (!(error instanceof Error)) {
    return undefined
  }
  const candidate = error as unknown as Record<string, unknown>
  if (typeof candidate['providerCode'] !== 'string') {
    return undefined
  }
  if (!VALID_PROVIDER_CODES.has(candidate['providerCode'])) {
    return undefined
  }
  return {
    httpStatus: typeof candidate['httpStatus'] === 'number' ? candidate['httpStatus'] : undefined,
    message: error.message,
    provider: typeof candidate['provider'] === 'string' ? candidate['provider'] : undefined,
    providerCode: candidate['providerCode'] as ProviderCode,
    rawProviderCode:
      typeof candidate['rawProviderCode'] === 'string' ? candidate['rawProviderCode'] : undefined,
  }
}

/**
 * Derive a ProviderCode from an HTTP status code.
 * Returns undefined when the status does not map to a well-known code.
 */
export function providerCodeFromHttpStatus(status: number): ProviderCode | undefined {
  if (status === 401 || status === 403) {
    return 'auth_error'
  }
  if (status === 429) {
    return 'rate_limit'
  }
  if (status >= 400 && status < 500) {
    return 'invalid_input'
  }
  if (status >= 500) {
    return 'internal_error'
  }
  return undefined
}

/** Provider codes that represent transient failures worth retrying. */
const RETRYABLE_PROVIDER_CODES: ReadonlySet<ProviderCode> = new Set([
  'internal_error',
  'rate_limit',
  'task_timeout',
])

/** Returns true when the error is likely transient and safe to retry. */
export function isRetryableProviderCode(code: ProviderCode): boolean {
  return RETRYABLE_PROVIDER_CODES.has(code)
}

/** Content-policy refusal codes: the provider answered and refused THIS request. */
export const POLICY_REJECTION_CODES: ReadonlySet<ProviderCode> = new Set([
  'policy_blocked',
  'policy_blocked_image',
])

/**
 * Takes a plain string so provider-agnostic callers, the circuit breaker in
 * particular, can ask the question without casting into ProviderCode.
 */
export function isPolicyRejectionCode(code: string): boolean {
  return POLICY_REJECTION_CODES.has(code as ProviderCode)
}

/**
 * Provider codes that are deterministic, request-level rejections: the provider
 * is up and answered, it just refused THIS request (content moderation, bad
 * input). They say nothing about provider availability.
 */
const REQUEST_LEVEL_PROVIDER_CODES: ReadonlySet<ProviderCode> = new Set([
  'invalid_input',
  ...POLICY_REJECTION_CODES,
])

/**
 * Returns true when the error signals provider-health trouble and should count
 * toward a circuit-breaker trip; false for deterministic request-level
 * rejections (content policy, invalid input), which would otherwise let one
 * story with blocked content trip the shared breaker for everyone.
 *
 * Unknown errors count as health failures (fail-safe: the breaker still
 * protects against unclassified outages). Cross-package ProviderError shapes
 * are handled via duck typing; plain errors fall back to message sniffing so
 * SDK safety-block errors are also excluded.
 */
export function isProviderHealthFailure(error: unknown): boolean {
  const code = getProviderCode(error)
  return code === undefined || !REQUEST_LEVEL_PROVIDER_CODES.has(code)
}

/**
 * Best-effort ProviderCode for any error: the structured code when present,
 * otherwise sniffed from the message. Returns undefined when unclassifiable.
 */
export function getProviderCode(error: unknown): ProviderCode | undefined {
  const shape = asProviderErrorShape(error)
  return shape?.providerCode ?? providerCodeFromErrorMessage(ensureError(error).message)
}

/**
 * Ark reports a reference image it could not fetch as
 * `Error while downloading: <url>, status code: 403` under code
 * `InvalidImageURL`, which classifies as `invalid_input`. The asset is the
 * problem, not the request or the model, so no other model can do better.
 * Only 403/404 qualify: a 429 or 5xx from the asset host is transient, so
 * those must stay retryable and keep walking the fallback chain.
 */
export function isReferenceFetchFailure(error: unknown): boolean {
  const shape = asProviderErrorShape(error)
  if (shape?.rawProviderCode === 'InvalidImageURL') {
    return true
  }
  const message = shape?.message ?? (error instanceof Error ? error.message : undefined)
  if (!message) {
    return false
  }
  return (
    /InvalidImageURL/.test(message) ||
    (/error while downloading/i.test(message) && /status code:\s*40[34]\b/i.test(message))
  )
}

/**
 * A generation attempt failed because one of its reference images could not be
 * fetched by the provider. Carries the canonical (store://) keys of the request's
 * references so callers can skip work that depends on the same poisoned asset.
 */
export class ReferenceFetchFailedError extends Error {
  readonly referenceKeys: string[]

  constructor(params: { cause?: unknown; message: string; referenceKeys: string[] }) {
    super(params.message)
    this.name = 'ReferenceFetchFailedError'
    this.referenceKeys = params.referenceKeys
    this.cause = params.cause
  }
}

/**
 * Map ByteDance Ark API error code strings to ProviderCode.
 * Reference: https://docs.byteplus.com/en/docs/ModelArk/1299023
 *
 * Policy codes use pattern matching rather than exact equality so that new
 * Ark codes following the same naming convention (e.g. AudioSensitiveContentDetected,
 * OutputSensitiveContentDetected) are captured automatically.
 */
export function providerCodeFromArkErrorCode(code: string): ProviderCode {
  if (/SensitiveContent|PolicyViolation/i.test(code)) {
    return /image|img/i.test(code) ? 'policy_blocked_image' : 'policy_blocked'
  }
  if (
    code.startsWith('RateLimitExceeded') ||
    code === 'QuotaExceeded' ||
    code === 'ServerOverloaded' ||
    code === 'RequestBurstTooFast'
  ) {
    return 'rate_limit'
  }
  if (code === 'AuthenticationError') {
    return 'auth_error'
  }
  if (
    code === 'MissingParameter' ||
    code === 'InvalidParameter' ||
    code === 'InvalidImageURL' ||
    code === 'OutofContextError' ||
    code === 'InvalidSubscription'
  ) {
    return 'invalid_input'
  }
  if (code === 'InternalServiceError') {
    return 'internal_error'
  }
  return 'task_failed'
}

/**
 * Best-effort extraction of ProviderCode from a free-form error message string.
 * Use as a fallback when the structured error code is absent or unrecognised.
 * Returns undefined when no pattern matches; caller should continue to the next fallback.
 */
export function providerCodeFromErrorMessage(message: string): ProviderCode | undefined {
  if (
    /sensitive|safety|prohibited|policy.?violation|content.?block|harmful|inappropriate|nsfw/i.test(
      message,
    )
  ) {
    return 'policy_blocked'
  }
  if (/rate.?limit|quota.?exceed|too.?many.?request|throttl/i.test(message)) {
    return 'rate_limit'
  }
  if (/unauthorized|forbidden|invalid.?key|invalid.?token|authentication/i.test(message)) {
    return 'auth_error'
  }
  if (/invalid.?param|missing.?param|bad.?request|malformed/i.test(message)) {
    return 'invalid_input'
  }
  return undefined
}

/**
 * Best-effort mapping for providers that don't have a dedicated mapping function.
 * Matches common policy/safety terminology used across video-gen and LLM providers.
 * Returns undefined when no pattern matches; caller should fall back to HTTP status or 'task_failed'.
 */
export function providerCodeFromUnknownErrorCode(code: string): ProviderCode | undefined {
  if (
    /sensitive|safety|prohibited|policy|content.?filter|harmful|inappropriate|blocked/i.test(code)
  ) {
    return /image|img/i.test(code) ? 'policy_blocked_image' : 'policy_blocked'
  }
  if (/rate.?limit|quota|throttl|too.?many.?request/i.test(code)) {
    return 'rate_limit'
  }
  if (/auth|unauthorized|forbidden|credential/i.test(code)) {
    return 'auth_error'
  }
  if (/invalid|bad.?request|missing.?param|malformed/i.test(code)) {
    return 'invalid_input'
  }
  if (/internal|server.?error|service.?unavailable/i.test(code)) {
    return 'internal_error'
  }
  return undefined
}

const CROSS_PACKAGE_PROVIDER_CODE_MAP: ReadonlyMap<string, ProviderCode> = new Map([
  ['client_error', 'invalid_input'],
  ['conflicting_provider_option', 'invalid_input'],
  ['invalid_credentials', 'auth_error'],
  ['refusal', 'policy_blocked'],
  ['server_error', 'internal_error'],
  ['unsupported_provider_option', 'invalid_input'],
])

/**
 * Translate a providerCode from a cross-package ProviderError (e.g. libs/llm's own
 * vocabulary) into this package's ProviderCode union. Already-valid codes pass through as-is.
 * Returns undefined for anything unmapped rather than guessing.
 */
export function providerCodeFromCrossPackageCode(code: string): ProviderCode | undefined {
  if (VALID_PROVIDER_CODES.has(code)) {
    return code as ProviderCode
  }
  return CROSS_PACKAGE_PROVIDER_CODE_MAP.get(code)
}
