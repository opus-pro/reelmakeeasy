import { type Snapshot } from './snapshot'

export type Bucket<T extends TimelineItem> = {
  hasOlder: boolean
  key: string
  segments: Segment<T>[]
}

export type Cache<T> = {
  value: T
  version: number
}

export type ReadonlyBucket<T extends TimelineItem> = {
  readonly hasOlder: boolean
  readonly key: string
  readonly segments: readonly ReadonlySegment<T>[]
}

export type ReadonlySegment<T extends TimelineItem> = {
  readonly hasOlder: boolean
  readonly items: readonly T[]
  readonly lowerBound: number
  readonly upperBound: number
}

export type Segment<T extends TimelineItem> = {
  hasOlder: boolean
  items: T[]
  lowerBound: number
  upperBound: number
}

export type SourceFailure = {
  error: unknown
  sourceKey: string
}

export type TimelineItem = {
  readonly createdAt: number
  readonly id: string
}

export type TimelinePage<T extends TimelineItem> = {
  readonly hasMore: boolean
  readonly items: readonly T[]
}

export type TimelineSnapshot<T extends TimelineItem> = Snapshot<T>

export type TimelineSource<T extends TimelineItem> = {
  readonly loadNewer: (createdAfter?: number) => Promise<TimelinePage<T>>
  readonly loadOlder: (createdBefore: number, include?: boolean) => Promise<TimelinePage<T>>
}
