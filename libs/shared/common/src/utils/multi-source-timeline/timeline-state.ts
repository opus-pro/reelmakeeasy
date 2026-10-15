import { Snapshot } from './snapshot'
import { Bucket, Cache, ReadonlySegment, Segment, TimelineItem } from './types'
import { bottomTs, mergeById } from './utils'

export class TimelineState<T extends TimelineItem> {
  protected readonly bucketMap = new Map<string, Bucket<T>>()
  protected readonly itemIndex = new Map<string, T>()
  protected readonly itemSourceMap = new Map<string, string>()
  private snapshotCache: Cache<Snapshot<T>> | null = null
  private version = 0

  constructor(sourceKeys: Iterable<string>) {
    for (const key of new Set(sourceKeys)) {
      this.bucketMap.set(key, {
        hasOlder: true,
        key,
        segments: [],
      })
    }
  }

  addSegment(sourceKey: string, readonlyIncoming: ReadonlySegment<T>): boolean {
    const bucket = this.bucketMap.get(sourceKey)
    if (!bucket) {
      return false
    }

    const incoming = this.normalizeSegment(readonlyIncoming)
    if (incoming.items.length === 0) {
      return this.applyEmptySegment(bucket, incoming)
    }

    this.insertSegmentSorted(bucket, incoming)

    for (const item of incoming.items) {
      this.itemIndex.set(item.id, item)
      this.itemSourceMap.set(item.id, sourceKey)
    }

    this.recomputeBucket(bucket)
    return true
  }

  anyHasMoreOlder() {
    for (const bucket of this.bucketMap.values()) {
      if (bucket.hasOlder) {
        return true
      }
    }
    return false
  }

  bottlenecks(commit: number): string[] {
    if (!Number.isFinite(commit)) {
      return []
    }

    const keys: string[] = []
    for (const bucket of this.bucketMap.values()) {
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
    return keys
  }

  captureSnapshotBuckets() {
    const buckets = new Map<string, Bucket<T>>()

    for (const [key, bucket] of this.bucketMap) {
      buckets.set(key, {
        hasOlder: bucket.hasOlder,
        key: bucket.key,
        segments: bucket.segments.map((segment) => ({
          ...segment,
          items: [...segment.items],
        })),
      })
    }

    return buckets
  }

  commitBottom(): null | number {
    let hasOpen = false
    let maxBottom = Number.NEGATIVE_INFINITY

    for (const bucket of this.bucketMap.values()) {
      if (!bucket.hasOlder) {
        continue
      }
      hasOpen = true

      const active = bucket.segments[0]
      if (!active) {
        return null
      }

      const ts = bottomTs(active.items)
      if (ts === null) {
        return null
      }
      if (ts > maxBottom) {
        maxBottom = ts
      }
    }

    return hasOpen ? maxBottom : Number.NEGATIVE_INFINITY
  }

  has(id: string): boolean {
    return this.itemIndex.has(id)
  }

  hasOlder(sourceKey: string): boolean {
    return this.bucketMap.get(sourceKey)?.hasOlder ?? false
  }

  hasSource(sourceKey: string): boolean {
    return this.bucketMap.has(sourceKey)
  }

  newerCursor(sourceKey: string): number | undefined {
    return this.bucketMap.get(sourceKey)?.segments[0]?.items[0]?.createdAt
  }

  olderCursor(sourceKey: string): number | undefined {
    return this.bucketMap.get(sourceKey)?.segments[0]?.lowerBound
  }

  remove(id: string) {
    this.removeMany([id])
  }

  removeMany(ids: readonly string[]) {
    if (ids.length === 0) {
      return
    }

    const byBucket = new Map<string, Set<string>>()
    const foundIds: string[] = []

    for (const id of ids) {
      const bucketKey = this.itemSourceMap.get(id)
      if (!bucketKey) {
        continue
      }
      foundIds.push(id)
      let set = byBucket.get(bucketKey)
      if (!set) {
        set = new Set()
        byBucket.set(bucketKey, set)
      }
      set.add(id)
    }

    if (byBucket.size === 0) {
      return
    }

    let changed = false
    for (const [bucketKey, idSet] of byBucket) {
      const bucket = this.bucketMap.get(bucketKey)
      if (!bucket) {
        continue
      }
      if (this.removeIdsFromBucket(bucket, idSet)) {
        this.recomputeBucket(bucket)
        changed = true
      }
    }

    if (!changed) {
      return
    }

    for (const id of foundIds) {
      this.itemIndex.delete(id)
      this.itemSourceMap.delete(id)
    }
    this.touch()
  }

  snapshot(): Snapshot<T> {
    const cached = this.snapshotCache
    if (cached && cached.version === this.version) {
      return cached.value
    }

    const value = new Snapshot<T>(this.captureSnapshotBuckets())

    this.snapshotCache = {
      version: this.version,
      value,
    }

    return value
  }

  sourceKeys(): string[] {
    return [...this.bucketMap.keys()]
  }

  touch() {
    this.version += 1
    this.snapshotCache = null
  }

  update(item: T) {
    this.updateMany([item])
  }

  updateMany(items: readonly T[]) {
    if (items.length === 0) {
      return
    }

    let changed = false

    for (const item of items) {
      const existing = this.itemIndex.get(item.id)
      if (!existing) {
        continue
      }

      if (existing.createdAt !== item.createdAt) {
        throw new Error(`[timeline] cannot change createdAt of existing item: ${item.id}`)
      }

      const bucketKey = this.itemSourceMap.get(item.id)
      if (!bucketKey) {
        continue
      }
      const bucket = this.bucketMap.get(bucketKey)
      if (!bucket) {
        continue
      }

      for (const segment of bucket.segments) {
        const idx = segment.items.findIndex((candidate) => candidate.id === item.id)
        if (idx === -1) {
          continue
        }
        segment.items[idx] = item
        break
      }

      this.itemIndex.set(item.id, item)
      changed = true
    }

    if (changed) {
      this.touch()
    }
  }

  private applyEmptySegment(bucket: Bucket<T>, incoming: Segment<T>): boolean {
    if (!incoming.hasOlder && incoming.lowerBound === Number.NEGATIVE_INFINITY) {
      bucket.segments = []
      bucket.hasOlder = false
      return true
    }

    const head = bucket.segments[0]
    if (!head) {
      bucket.hasOlder = incoming.hasOlder
      return true
    }

    if (!this.rangesOverlap(head, incoming)) {
      return false
    }

    head.hasOlder = incoming.hasOlder
    head.upperBound = Math.max(head.upperBound, incoming.upperBound)
    head.lowerBound = Math.min(head.lowerBound, incoming.lowerBound)
    this.recomputeBucket(bucket)
    return true
  }

  private compareSegments(left: Segment<T>, right: Segment<T>): number {
    const byUpper = right.upperBound - left.upperBound
    if (byUpper !== 0) {
      return byUpper
    }
    return right.lowerBound - left.lowerBound
  }

  private insertSegmentSorted(bucket: Bucket<T>, incoming: Segment<T>) {
    const segments = bucket.segments
    let low = 0
    let high = segments.length

    while (low < high) {
      const mid = (low + high) >> 1
      if (this.compareSegments(incoming, segments[mid]) < 0) {
        high = mid
      } else {
        low = mid + 1
      }
    }

    segments.splice(low, 0, incoming)
  }

  private joinSegments(newer: Segment<T>, older: Segment<T>): Segment<T> {
    return {
      hasOlder: newer.lowerBound <= older.lowerBound ? newer.hasOlder : older.hasOlder,
      items: mergeById(older.items, newer.items),
      lowerBound: Math.min(newer.lowerBound, older.lowerBound),
      upperBound: Math.max(newer.upperBound, older.upperBound),
    }
  }

  private normalizeSegment(segment: ReadonlySegment<T>): Segment<T> {
    let lowerBound = segment.lowerBound
    let upperBound = segment.upperBound

    if (lowerBound > upperBound) {
      const nextLower = upperBound
      const nextUpper = lowerBound
      lowerBound = nextLower
      upperBound = nextUpper
    }

    for (const item of segment.items) {
      if (item.createdAt < lowerBound) {
        lowerBound = item.createdAt
      }
      if (item.createdAt > upperBound) {
        upperBound = item.createdAt
      }
    }

    return {
      hasOlder: segment.hasOlder,
      items: [...segment.items],
      lowerBound,
      upperBound,
    }
  }

  private rangesOverlap(left: Segment<T>, right: Segment<T>): boolean {
    return !(left.upperBound < right.lowerBound || right.upperBound < left.lowerBound)
  }

  private recomputeBucket(bucket: Bucket<T>) {
    bucket.segments = bucket.segments.filter((segment) => segment.items.length > 0)
    if (bucket.segments.length === 0) {
      bucket.hasOlder = false
      return
    }

    let index = 0
    while (index < bucket.segments.length - 1) {
      const newer = bucket.segments[index]
      const older = bucket.segments[index + 1]
      if (!this.rangesOverlap(newer, older)) {
        index += 1
        continue
      }
      bucket.segments[index] = this.joinSegments(newer, older)
      bucket.segments.splice(index + 1, 1)
    }

    bucket.hasOlder = bucket.segments[0]?.hasOlder ?? false
  }

  private removeIdsFromBucket(bucket: Bucket<T>, ids: ReadonlySet<string>): boolean {
    let changed = false
    for (const segment of bucket.segments) {
      const next = segment.items.filter((item) => !ids.has(item.id))
      if (next.length === segment.items.length) {
        continue
      }
      segment.items = next
      changed = true
    }
    return changed
  }
}
