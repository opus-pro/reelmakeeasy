import { getKvStore } from '@reelmakeeasy/common/kv'
import {
  DEFAULT_HAPPY_HORSE_CONCURRENCY_LIMIT,
  DEFAULT_SEEDANCE_CONCURRENCY_LIMIT,
} from '@reelmakeeasy/common/model-config/story-mode-video-concurrency-config.zod'

// Must cover startToCloseTimeout (2h) x maximumAttempts (4) so a slot is never
// pruned while its holder is still retrying. Slot leaks self-heal after this
// window; shorter values risk overcapacity during normal retry scenarios.
const SLOT_TTL_MS = (8 * 60 + 10) * 60 * 1000 // 8h10m
const BASE_RETRY_AFTER_MS = 15_000
const RETRY_JITTER_MS = 5_000

export async function releaseCapacityActivity(params: {
  leaseId: string
  provider: string
}): Promise<void> {
  const { provider, leaseId } = params
  getKvStore().releaseSemaphore(`capacity:${provider}`, leaseId)
}

export async function tryAcquireCapacityActivity(params: {
  provider: string
}): Promise<{ acquired: false; retryAfterMs: number } | { acquired: true; leaseId: string }> {
  const { provider } = params
  const limit = getProviderLimit(provider)
  const acquired = getKvStore().acquireSemaphore(`capacity:${provider}`, limit, SLOT_TTL_MS)
  if (acquired !== null) {
    return { acquired: true, leaseId: acquired.leaseId }
  }
  const retryAfterMs = BASE_RETRY_AFTER_MS + Math.floor(Math.random() * RETRY_JITTER_MS)
  return { acquired: false, retryAfterMs }
}

function getProviderLimit(provider: string): number {
  if (provider === 'seedance') {
    return DEFAULT_SEEDANCE_CONCURRENCY_LIMIT
  }
  // 'alicloud' == Happy Horse transitions: hard vendor cap of 5
  // concurrent tasks on the shared DashScope workspace.
  if (provider === 'alicloud') {
    return DEFAULT_HAPPY_HORSE_CONCURRENCY_LIMIT
  }
  return 1000
}
