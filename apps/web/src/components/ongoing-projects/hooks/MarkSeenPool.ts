import { CoalescingQueue } from '@reelmakeeasy/common/utils/coalescing-queue'
import { createDeferred } from '@reelmakeeasy/common/utils/deferred-promise'
import { createWeakMapFn } from '@reelmakeeasy/common/utils/memo-fn'

import { markProjectsSeen } from '@/hooks/projects-query-utils'
import type { FetchApiDomain } from '@/hooks/useApi'

const MAX_BATCH_SIZE = 200

/**
 * Manages mark-seen for a single resource type.
 *
 * Two-level batching:
 * 1. Microtask delay - synchronous mark() calls accumulate before the first
 *    queue push, so they all go out in one request.
 * 2. CoalescingQueue - IDs arriving while a request is in-flight accumulate
 *    and go out together as a single trailing request.
 *
 * ID-level granularity:
 * - Already-marked IDs resolve immediately (no request).
 * - In-flight or pending IDs reuse the existing Promise (no duplicate request).
 */
abstract class ResourceMarkQueue {
  private readonly marked = new Set<string>()
  private microtaskScheduled = false
  private readonly pending = new Set<string>()
  private readonly queue = new CoalescingQueue<void>()
  private readonly tracked = new Map<string, ReturnType<typeof createDeferred<void>>>()

  mark(projectIds: Iterable<string>): Promise<void> {
    const promises: Promise<void>[] = []
    let hasNew = false

    for (const projectId of projectIds) {
      if (this.marked.has(projectId)) {
        continue
      }

      const existing = this.tracked.get(projectId)
      if (existing) {
        promises.push(existing.promise)
        continue
      }

      const deferred = createDeferred<void>()
      this.tracked.set(projectId, deferred)
      this.pending.add(projectId)
      promises.push(deferred.promise)
      hasNew = true
    }

    if (hasNew) {
      this.scheduleFlush()
    }

    return promises.length > 0 ? Promise.all(promises).then(() => undefined) : Promise.resolve()
  }

  unmark(projectIds: Iterable<string>): void {
    for (const projectId of projectIds) {
      this.marked.delete(projectId)
    }
  }

  protected abstract sendRequest(projectIds: ReadonlyArray<string>): Promise<void>

  private doFlush(): void {
    if (this.pending.size === 0) {
      return
    }

    void this.queue.push(async () => {
      const snapshot = [...this.pending]
      this.pending.clear()

      for (const batch of chunk(snapshot, MAX_BATCH_SIZE)) {
        try {
          await this.sendRequest(batch)
          for (const projectId of batch) {
            const deferred = this.tracked.get(projectId)
            if (deferred) {
              this.marked.add(projectId)
              this.tracked.delete(projectId)
              deferred.resolve()
            }
          }
        } catch (err) {
          for (const projectId of batch) {
            const deferred = this.tracked.get(projectId)
            if (deferred) {
              this.tracked.delete(projectId)
              deferred.reject(err)
            }
          }
        }
      }
    })
  }

  private scheduleFlush(): void {
    if (this.microtaskScheduled) {
      return
    }
    this.microtaskScheduled = true

    void Promise.resolve().then(() => {
      this.microtaskScheduled = false
      this.doFlush()
    })
  }
}

class ProjectMarkQueue extends ResourceMarkQueue {
  constructor(private readonly fetchApiDomain: FetchApiDomain) {
    super()
  }
  protected async sendRequest(projectIds: ReadonlyArray<string>) {
    await markProjectsSeen(this.fetchApiDomain, projectIds)
  }
}

export const getProjectMarkQueue = createWeakMapFn(
  (fetchApiDomain: FetchApiDomain) => new ProjectMarkQueue(fetchApiDomain),
)

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size))
  }
  return result
}
