import { ApplicationFailure } from '@reelmakeeasy/workflow-engine/workflow'
import * as wf from '@reelmakeeasy/workflow-engine/workflow'

import { releaseCapacityActivity, tryAcquireCapacityActivity } from './activity-proxies'

const DEFAULT_MAX_WAIT_MS = 2 * 60 * 60 * 1000 // 2 hours

/**
 * Wraps a capacity-limited activity call with a slot-based queue.
 *
 * Polls `tryAcquireCapacityActivity` until a slot is available, sleeping
 * between attempts via workflow timers (no activity slot held while waiting).
 * The slot is always released via `releaseCapacityActivity` in a `finally`
 * block even if the inner `fn` throws.
 *
 * Throws `ApplicationFailure` with type `CapacityWaitTimeout` if no slot
 * is acquired within `maxWaitMs`.
 */
export async function withCapacity<T>(
  params: {
    maxWaitMs?: number
    provider: string
  },
  fn: () => Promise<T>,
): Promise<T> {
  const { provider, maxWaitMs = DEFAULT_MAX_WAIT_MS } = params
  const deadline = Date.now() + maxWaitMs
  let leaseId: null | string = null

  try {
    while (true) {
      if (Date.now() >= deadline) {
        throw ApplicationFailure.nonRetryable(
          `Capacity wait timeout for provider "${provider}" after ${maxWaitMs}ms`,
          'CapacityWaitTimeout',
        )
      }

      const result = await tryAcquireCapacityActivity({ provider })
      if (result.acquired) {
        leaseId = result.leaseId
        break
      }

      const remainingMs = deadline - Date.now()
      const sleepMs = Math.min(result.retryAfterMs, remainingMs)
      if (sleepMs <= 0) {
        throw ApplicationFailure.nonRetryable(
          `Capacity wait timeout for provider "${provider}" after ${maxWaitMs}ms`,
          'CapacityWaitTimeout',
        )
      }
      await wf.sleep(sleepMs)
    }

    return await fn()
  } finally {
    if (leaseId !== null) {
      await releaseCapacityActivity({ provider, leaseId })
    }
  }
}
