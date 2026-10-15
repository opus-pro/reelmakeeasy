import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import {
  ActivityFailure,
  ApplicationFailure,
  CancelledFailure,
  TimeoutFailure,
} from '@reelmakeeasy/workflow-engine/common'

// Cancellation/timeout are workflow-engine control-flow signals, not provider faults.
// Match the failure classes rather than error-message substrings -- a provider
// or network error whose text contains "timeout" must still count as a TTS
// failure, not be mistaken for control flow.
export function isVoiceoverControlFlowError(error: unknown): boolean {
  if (error instanceof CancelledFailure || error instanceof TimeoutFailure) {
    return true
  }
  return (
    error instanceof ActivityFailure &&
    (error.cause instanceof CancelledFailure || error.cause instanceof TimeoutFailure)
  )
}

/**
 * `provider` is tagged so a single vendor going dark is visible.
 *
 * The metric has always been named `provider_failed` while recording no provider, so a
 * monitor could only alert on aggregate TTS failure -- it could not tell "TTS is broken"
 * from "TTS is broken for the fal cohort", which is exactly the failure the fal A/B
 * introduces. An absolute-count threshold over all vendors also cannot see a minority arm
 * failing completely.
 *
 * 'unknown' when the throw happened before the provider was resolved (e.g. reading the
 * script). Deliberately a real tag value rather than an omitted tag: an omitted tag would
 * silently drop those failures out of a `by {provider}` monitor.
 */
export function throwTtsProviderFailure(error: unknown, provider?: string): never {
  throw ApplicationFailure.create({
    cause: ensureError(error),
    message: ensureError(error).message,
    nonRetryable: false,
    type: 'TTS_FAILED',
  })
}
