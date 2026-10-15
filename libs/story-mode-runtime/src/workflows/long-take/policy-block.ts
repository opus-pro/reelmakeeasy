import {
  type ProviderCode,
  providerCodeFromArkErrorCode,
  providerCodeFromErrorMessage,
  providerCodeFromUnknownErrorCode,
} from '@reelmakeeasy/common/utils/provider-error'

export function isPolicyBlockedError(error: unknown): boolean {
  const providerCode = extractProviderCode(error)
  if (providerCode === 'policy_blocked') {
    return true
  }
  if (providerCode === 'policy_blocked_image') {
    return false
  }

  return providerCodeFromErrorMessage(getErrorMessage(error)) === 'policy_blocked'
}

function extractEmbeddedProviderCode(value: unknown): ProviderCode | undefined {
  if (typeof value !== 'string' || !value.trim()) {
    return undefined
  }

  const explicitCodeMatch = value.match(/"code"\s*:\s*"([^"]+)"/i)
  if (explicitCodeMatch?.[1]) {
    return normalizeProviderCode(explicitCodeMatch[1])
  }

  return normalizeProviderCode(value)
}

function extractProviderCode(error: unknown): ProviderCode | undefined {
  if (!error || typeof error !== 'object') {
    return extractEmbeddedProviderCode(getErrorMessage(error))
  }

  const fields = error as {
    cause?: unknown
    code?: unknown
    error?: unknown
    failure?: unknown
    message?: unknown
    rawProviderCode?: unknown
  }

  const candidates = [fields.code, fields.rawProviderCode]
  for (const candidate of candidates) {
    const resolved = normalizeProviderCode(candidate)
    if (resolved) {
      return resolved
    }
  }

  const messageCode = extractEmbeddedProviderCode(fields.message)
  if (messageCode) {
    return messageCode
  }

  const nestedCandidates = [fields.error, fields.cause, fields.failure]
  for (const candidate of nestedCandidates) {
    const resolved = extractProviderCode(candidate)
    if (resolved) {
      return resolved
    }
  }

  return undefined
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name} ${error.message}`
  }
  if (error && typeof error === 'object') {
    const maybeMessage = (error as { message?: unknown }).message
    if (typeof maybeMessage === 'string' && maybeMessage.trim()) {
      return maybeMessage
    }
    try {
      return JSON.stringify(error)
    } catch {
      return String(error)
    }
  }
  return String(error)
}

// Vidu reports a moderation block as rawProviderCode 'AuditSubmitIllegal', which
// no shared provider-error map recognizes. Kept separate from isPolicyBlockedError,
// and out of provider-error.ts so it does not also feed isProviderHealthFailure.
export function isViduModerationBlockError(error: unknown): boolean {
  if (error && typeof error === 'object') {
    const rawProviderCode = (error as { rawProviderCode?: unknown }).rawProviderCode
    if (typeof rawProviderCode === 'string' && rawProviderCode.trim() === 'AuditSubmitIllegal') {
      return true
    }
  }

  return /"err_code"\s*:\s*"AuditSubmitIllegal"/i.test(getErrorMessage(error))
}

function normalizeProviderCode(value: unknown): ProviderCode | undefined {
  if (typeof value !== 'string' || !value.trim()) {
    return undefined
  }

  const code = value.trim()
  if (code === 'policy_blocked' || code === 'policy_blocked_image') {
    return code
  }

  const arkCode = providerCodeFromArkErrorCode(code)
  if (arkCode !== 'task_failed') {
    return arkCode
  }

  return providerCodeFromUnknownErrorCode(code)
}
