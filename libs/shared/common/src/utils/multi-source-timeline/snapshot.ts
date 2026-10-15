import { ReadonlyBucket, TimelineItem } from './types'
import { bottomTs, mergeById } from './utils'

export class Snapshot<T extends TimelineItem> {
  get all(): readonly T[] {
    if (this.allCache) {
      return this.allCache
    }
    this.allCache = this.mergeAll()
    return this.allCache
  }

  get bottlenecks(): readonly string[] {
    if (this.bottlenecksCache) {
      return this.bottlenecksCache
    }

    const commit = this.commitBottom
    if (!Number.isFinite(commit)) {
      this.bottlenecksCache = []
      return this.bottlenecksCache
    }

    const keys: string[] = []
    for (const bucket of this.buckets.values()) {
      if (!bucket.hasOlder) {
        continue
      }
      const active = bucket.segments[0]
      if (!active) {
        continue
      }
      if (bottomTs(active.items) === commit) {
        keys.push(bucket.key)
      }
    }
    this.bottlenecksCache = keys
    return this.bottlenecksCache
  }

  get commitBottom(): null | number {
    if (this.commitBottomCache !== undefined) {
      return this.commitBottomCache
    }

    let hasOpen = false
    let maxBottom = Number.NEGATIVE_INFINITY
    for (const bucket of this.buckets.values()) {
      if (!bucket.hasOlder) {
        continue
      }
      hasOpen = true

      const active = bucket.segments[0]?.items
      if (!active || active.length === 0) {
        this.commitBottomCache = null
        return this.commitBottomCache
      }

      const ts = bottomTs(active)
      if (ts === null) {
        this.commitBottomCache = null
        return this.commitBottomCache
      }
      if (ts > maxBottom) {
        maxBottom = ts
      }
    }

    this.commitBottomCache = hasOpen ? maxBottom : Number.NEGATIVE_INFINITY
    return this.commitBottomCache
  }

  get hasMore(): boolean {
    if (this.hasMoreCache !== undefined) {
      return this.hasMoreCache
    }

    for (const bucket of this.buckets.values()) {
      if (bucket.hasOlder) {
        this.hasMoreCache = true
        return this.hasMoreCache
      }
    }

    this.hasMoreCache = false
    return this.hasMoreCache
  }

  get visible(): readonly T[] {
    if (this.visibleCache) {
      return this.visibleCache
    }

    const commit = this.commitBottom
    if (commit === null) {
      this.visibleCache = []
      return this.visibleCache
    }

    const active = this.active
    if (commit === Number.NEGATIVE_INFINITY) {
      this.visibleCache = active
      return this.visibleCache
    }

    this.visibleCache = active.filter((item) => item.createdAt >= commit)
    return this.visibleCache
  }

  private activeCache: null | readonly T[] = null

  private allCache: null | readonly T[] = null

  private bottlenecksCache: null | readonly string[] = null

  private commitBottomCache: null | number | undefined

  private hasMoreCache: boolean | undefined

  private visibleCache: null | readonly T[] = null

  private get active(): readonly T[] {
    if (this.activeCache) {
      return this.activeCache
    }
    this.activeCache = this.mergeActive()
    return this.activeCache
  }

  constructor(readonly buckets: ReadonlyMap<string, ReadonlyBucket<T>>) {}

  private mergeActive(): readonly T[] {
    let merged: readonly T[] = []

    for (const bucket of this.buckets.values()) {
      const active = bucket.segments[0]
      if (!active) {
        continue
      }
      merged = mergeById(merged, active.items)
    }

    return merged
  }

  private mergeAll(): readonly T[] {
    let merged: readonly T[] = []

    for (const bucket of this.buckets.values()) {
      for (const segment of bucket.segments) {
        merged = mergeById(merged, segment.items)
      }
    }

    return merged
  }
}
