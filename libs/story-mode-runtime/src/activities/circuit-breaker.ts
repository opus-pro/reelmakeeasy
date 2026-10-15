/**
 * Story Mode circuit breaker adapter.
 *
 * Creates a breaker instance wired with story-mode provider policies.
 * The instance is injected into API-layer routers
 * (generateVideo, generateImage) via their optional `breaker` parameter.
 */
import type { CircuitBreakerInstance } from '@reelmakeeasy/common/circuit-breaker'
import { createCircuitBreaker } from '@reelmakeeasy/common/circuit-breaker'
import { resolveBreakerScope as resolveBaseBreakerScope } from '@reelmakeeasy/common/circuit-breaker'
import { getProviderCode, isProviderHealthFailure } from '@reelmakeeasy/common/utils/provider-error'
import { Context } from '@reelmakeeasy/workflow-engine/activity'

import { resolveProviderPolicy } from './circuit-breaker-policy'

// ---------------------------------------------------------------------------
// Breaker instance (shared, injected into API routers)
// ---------------------------------------------------------------------------

function configResolverWithScopePrefix(identifier: string) {
  const parts = identifier.split(':')
  const provider = parts[parts.length - 1] || identifier
  return resolveProviderPolicy(provider)
}

/**
 * Shared breaker instance for story mode. Inject this into generateVideo()
 * and generateImage() via their `breaker` option parameter.
 */
export const storyModeBreaker: CircuitBreakerInstance = createCircuitBreaker({
  configResolver: configResolverWithScopePrefix,
  keyPrefix: 'story_mode:cb',
  loggerNamespace: 'story-mode:circuit-breaker',
})

/**
 * Record a generation error against the breaker. Only
 * provider-health failures count as breaker failure; deterministic
 * request-level rejections (content policy, invalid input) prove the provider
 * answered, so they go through recordRejection -- resolving a half-open probe
 * instead of letting its lease expire, without inflating the success count
 * that the failure rate is measured against.
 */
export async function recordBreakerOutcome(
  breakerId: string,
  metadata: { model: string; provider: string },
  error: unknown,
): Promise<void> {
  if (isProviderHealthFailure(error)) {
    await storyModeBreaker.recordFailure(breakerId, metadata)
    return
  }
  await storyModeBreaker.recordRejection(breakerId, getProviderCode(error) ?? 'unknown', metadata)
}

/**
 * Story-mode breaker scope includes the activity's task queue when available so
 * breaker state stays isolated across worker queues, lanes, and environments.
 */
export function resolveBreakerScope(): string {
  const baseScope = resolveBaseBreakerScope()
  try {
    const taskQueue = Context.current().info.taskQueue
    return taskQueue ? `${taskQueue}:${baseScope}` : baseScope
  } catch {
    return baseScope
  }
}
