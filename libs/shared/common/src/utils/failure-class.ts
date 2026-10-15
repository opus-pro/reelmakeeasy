import { ensureError } from './error-handler'
import {
  asProviderErrorShape,
  providerCodeFromCrossPackageCode,
  providerCodeFromErrorMessage,
  ProviderError,
} from './provider-error'

/** The one cross-package code that is a catch-all rather than a diagnosis: every 4xx. */
const COARSE_CROSS_PACKAGE_CODE = 'client_error'

export type FailureClass =
  | 'auth_error'
  | 'internal'
  | 'internal_error'
  | 'invalid_input'
  // A plan we built ourselves that no downstream model can serve, as opposed to
  // invalid_input, which is the caller handing us something unusable.
  | 'invalid_plan'
  | 'no_output'
  | 'non_speech_audio'
  | 'policy_blocked'
  | 'policy_blocked_image'
  | 'rate_limit'
  | 'success'
  | 'task_failed'
  | 'task_timeout'
  | 'timeout'
  | `${number}`

type ErrorWithStatus = Error & {
  httpStatus?: number
  response?: {
    status?: number
  }
  status?: number
  statusCode?: number
}

export function getFailureClass(error: unknown, httpStatus?: number): FailureClass {
  // ProviderError carries a pre-resolved providerCode - trust it directly.
  if (error instanceof ProviderError) {
    return error.providerCode
  }

  // A cross-package ProviderError is as authoritative as our own; it just fails
  // `instanceof` across package boundaries. Trust it before sniffing anything,
  // or this tag contradicts the provider_code tag, which already duck-types it.
  const shape = asProviderErrorShape(error)
  if (shape) {
    return shape.providerCode
  }

  // A cross-package code outside our own vocabulary (e.g. libs/llm's) still
  // deserves translation, mirroring long-take-metrics.ts's resolveProviderCode. Every
  // such code is specific enough to outrank a policy word in the message except the
  // coarse `client_error`, which is returned for every 4xx alike, so that one alone is
  // deferred past the policy verdict below.
  const candidate =
    typeof error === 'object' && error !== null ? (error as Record<string, unknown>) : undefined
  const rawProviderCode =
    typeof candidate?.['providerCode'] === 'string' ? candidate['providerCode'] : undefined
  const crossPackageVerdict =
    rawProviderCode === undefined ? undefined : providerCodeFromCrossPackageCode(rawProviderCode)
  if (crossPackageVerdict !== undefined && rawProviderCode !== COARSE_CROSS_PACKAGE_CODE) {
    return crossPackageVerdict
  }

  // A policy refusal outranks the HTTP status the same way it does in the
  // provider_code resolver: 400 says the provider refused, not why, and only
  // the policy verdict tells a content refusal apart from a real defect. Google
  // ships IMAGE_PROHIBITED_CONTENT with no status at all (it would fall through
  // to 'internal') and OpenAI ships its safety refusal as a bare '400 ...'
  // message, so without this both land in the provider-health buckets the
  // zero-success monitor pages on.
  const policyFromMessage = policyVerdict(error)
  if (policyFromMessage) {
    return policyFromMessage
  }

  // The deferred `client_error`: no policy verdict fired, so its coarse mapping stands.
  if (crossPackageVerdict !== undefined) {
    return crossPackageVerdict
  }

  const status = normalizeHttpStatus(httpStatus ?? extractHttpStatusFromFields(error))
  if (status) {
    return `${status}` as `${number}`
  }
  if (isTimeoutError(error)) {
    return 'timeout'
  }
  const statusFromMessage = extractStatusFromMessage(ensureError(error).message)
  if (statusFromMessage) {
    return `${statusFromMessage}` as `${number}`
  }
  return 'internal'
}

function extractHttpStatusFromFields(error: unknown): number | undefined {
  if (!error || typeof error !== 'object') {
    return undefined
  }
  const statusError = error as ErrorWithStatus
  return normalizeHttpStatus(
    statusError.httpStatus ||
      statusError.status ||
      statusError.statusCode ||
      statusError.response?.status,
  )
}

function extractStatusFromMessage(message: string): number | undefined {
  if (!message) {
    return undefined
  }
  const match = message.match(/\b([45]\d{2})\b/)
  if (!match) {
    return undefined
  }
  const parsed = Number.parseInt(match[1], 10)
  return Number.isFinite(parsed) ? parsed : undefined
}

function isTimeoutError(error: unknown): boolean {
  const err = ensureError(error)
  const content = `${err.name} ${err.message}`.toLowerCase()
  return /(timeout|timed out|etimedout|deadline exceeded|request aborted|aborted)/i.test(content)
}

function normalizeHttpStatus(status?: number): number | undefined {
  if (!Number.isFinite(status)) {
    return undefined
  }
  const normalized = Number(status)
  if (normalized < 100 || normalized > 599) {
    return undefined
  }
  return normalized
}

// Reads through ensureError so a plain `{ message, status }` record is sniffed too --
// extractStatusFromMessage below already normalizes that way, and a record that reached
// status extraction with a policy message would otherwise be tagged by its status alone.
function policyVerdict(error: unknown): FailureClass | undefined {
  const code = providerCodeFromErrorMessage(ensureError(error).message)
  return code === 'policy_blocked' || code === 'policy_blocked_image' ? code : undefined
}
