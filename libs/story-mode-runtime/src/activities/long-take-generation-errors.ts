import { SafetyBlockError } from '@reelmakeeasy/common/llm'
import { asStoreUri } from '@reelmakeeasy/common/storage/address'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import {
  isReferenceFetchFailure,
  ProviderError,
  ReferenceFetchFailedError,
} from '@reelmakeeasy/common/utils/provider-error'
import { ApplicationFailure } from '@reelmakeeasy/workflow-engine/activity'

/**
 * A poisoned reference image (the provider cannot fetch it) is deterministic:
 * the activity's own retries resend the identical input against the
 * identical URL. Surface it as non-retryable, carrying the canonical keys so
 * the workflow can skip other work that depends on the same asset.
 *
 * `fallbackReferenceUris` supplies the keys on the legacy path, which raises a
 * bare provider error rather than a ReferenceFetchFailedError.
 */
export function asReferenceFetchFailure(
  error: unknown,
  fallbackReferenceUris: string[],
): ApplicationFailure | undefined {
  if (error instanceof ReferenceFetchFailedError) {
    return ApplicationFailure.nonRetryable(error.message, 'REFERENCE_FETCH_FAILED', {
      referenceKeys: error.referenceKeys,
    })
  }
  if (!isReferenceFetchFailure(error)) {
    return undefined
  }
  return ApplicationFailure.nonRetryable(ensureError(error).message, 'REFERENCE_FETCH_FAILED', {
    referenceKeys: [...new Set(fallbackReferenceUris.map((uri) => asStoreUri(uri)))],
  })
}

export function normalizeImageError(
  error: unknown,
  provider: string,
): ApplicationFailure | ProviderError {
  if (error instanceof ApplicationFailure) {
    return error
  }
  // ProviderError.fromUnknown handles both native and cross-package ProviderError via duck typing
  const normalized = ProviderError.fromUnknown(error, provider)
  // Preserve IMAGE_POLICY_BLOCKED code detection for non-ProviderError errors
  if (normalized.providerCode === 'task_failed') {
    const msg = error instanceof Error ? error.message : String(error)
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? (error as { code?: string }).code
        : undefined
    if (code === 'IMAGE_POLICY_BLOCKED' || /IMAGE_PROHIBITED_CONTENT/i.test(msg)) {
      return new ProviderError({
        cause: error,
        message: msg,
        provider,
        providerCode: 'policy_blocked',
      })
    }
  }
  return normalized
}

export function normalizeLlmError(error: unknown, provider: string): ProviderError {
  if (error instanceof ProviderError) {
    return error
  }
  // ProviderError.fromUnknown handles cross-package ProviderError via duck typing
  const normalized = ProviderError.fromUnknown(error, provider)
  if (normalized.providerCode !== 'task_failed') {
    return normalized
  }
  if (error instanceof SafetyBlockError) {
    return new ProviderError({
      cause: error,
      message: error.message,
      provider,
      providerCode: 'policy_blocked',
    })
  }
  if (error instanceof Error && error.name === 'AllModelsFailedError') {
    type FailureEntry = { error: unknown; modelId: string }
    const failures = (error as Error & { failures?: FailureEntry[] }).failures
    const safetyFailures = failures?.filter((f) => f.error instanceof SafetyBlockError) ?? []
    if (safetyFailures.length > 0) {
      const detail = safetyFailures
        .map((f) => `${f.modelId}: ${f.error instanceof Error ? f.error.message : String(f.error)}`)
        .join('; ')
      return new ProviderError({
        cause: error,
        message: `${error.message} - ${detail}`,
        provider,
        providerCode: 'policy_blocked',
      })
    }
  }
  return ProviderError.fromUnknown(error, provider)
}
