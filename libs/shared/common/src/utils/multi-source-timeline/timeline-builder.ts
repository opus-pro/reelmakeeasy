import { intersection } from 'lodash-es'

import { CoalescingQueue } from '../coalescing-queue'

import { TimelineState } from './timeline-state'
import {
  ReadonlyBucket,
  ReadonlySegment,
  TimelineItem,
  TimelinePage,
  TimelineSource,
} from './types'
import { normalizeItems } from './utils'

export type TimelineResyncError = {
  error: unknown
  sourceKey: string
}

export type TimelineResyncResult<T extends TimelineItem> = {
  errors: TimelineResyncError[]
  interrupted: boolean
  ok: boolean
  state: TimelineState<T>
}

type Range = [number, number]

export function createTimelineResyncBuilder<T extends TimelineItem>(
  sources: Readonly<Record<string, TimelineSource<T>>>,
  prevState: TimelineState<T>,
) {
  const allSourceKeys = Object.keys(sources)
  const prevBuckets = prevState.captureSnapshotBuckets()
  const syncKeys = intersection([...prevBuckets.keys()], allSourceKeys)
  const rangesByKey = new Map<string, Range[]>()
  const queue = new CoalescingQueue<TimelineResyncResult<T>>()
  const state = new TimelineState<T>(allSourceKeys)

  let interruptConsumed = false
  let interruptRequested = false
  let inFlight: null | Promise<TimelineResyncResult<T>> = null

  for (const sourceKey of syncKeys) {
    const bucket = prevBuckets.get(sourceKey)
    if (!bucket) {
      continue
    }
    const ranges = bucket.segments.map((segment): Range => [segment.lowerBound, segment.upperBound])
    rangesByKey.set(sourceKey, mergeRanges(ranges))
  }

  const requestInterrupt = () => {
    interruptRequested = true
    interruptConsumed = false
  }

  const readInterrupt = () => {
    if (!interruptRequested) {
      return false
    }
    interruptRequested = false
    interruptConsumed = true
    return true
  }

  const resync = () => {
    if (inFlight && interruptRequested && !interruptConsumed) {
      interruptRequested = false
      return inFlight
    }

    return queue.push(async () => {
      const current = runResync()
      inFlight = current
      try {
        return await current
      } finally {
        if (inFlight === current) {
          inFlight = null
        }
      }
    })
  }

  const runResync = async (): Promise<TimelineResyncResult<T>> => {
    const errors: TimelineResyncError[] = []
    let interrupted = false

    for (const sourceKey of syncKeys) {
      if (readInterrupt()) {
        interrupted = true
        break
      }

      const source = sources[sourceKey]
      if (!source) {
        continue
      }
      const targetRanges = rangesByKey.get(sourceKey) ?? []
      if (targetRanges.length === 0) {
        continue
      }

      try {
        const done = await resyncSource({
          bucket: prevBuckets.get(sourceKey),
          consumeInterrupt: readInterrupt,
          source,
          sourceKey,
          state,
          targetRanges,
        })
        if (!done) {
          interrupted = true
          break
        }
      } catch (error) {
        errors.push({
          error,
          sourceKey,
        })
      }
    }

    return {
      errors,
      interrupted,
      ok: !interrupted && errors.length === 0,
      state,
    }
  }

  return {
    cancel: requestInterrupt,
    requestInterrupt,
    resync,
    state,
  }
}

function decrementInclusive(value: number): number {
  if (!Number.isFinite(value)) {
    return value
  }
  return value - 1
}

function getStateRanges<T extends TimelineItem>(
  state: TimelineState<T>,
  sourceKey: string,
): Range[] {
  const bucket = state.captureSnapshotBuckets().get(sourceKey)
  if (!bucket) {
    return []
  }
  const ranges = bucket.segments.map((segment) => [segment.lowerBound, segment.upperBound] as Range)
  return mergeRanges(ranges)
}

function incrementInclusive(value: number): number {
  if (!Number.isFinite(value)) {
    return value
  }
  return value + 1
}

function mergeRanges(ranges: readonly Range[]): Range[] {
  if (ranges.length === 0) {
    return []
  }
  const sorted = [...ranges]
    .map(([left, right]) => (left <= right ? [left, right] : [right, left]) as Range)
    .sort((left, right) => {
      const byLeft = left[0] - right[0]
      if (byLeft !== 0) {
        return byLeft
      }
      return left[1] - right[1]
    })

  const merged: Range[] = [sorted[0]]
  for (let i = 1; i < sorted.length; i += 1) {
    const current = sorted[i]
    const tail = merged[merged.length - 1]
    if (current[0] <= tail[1]) {
      tail[1] = Math.max(tail[1], current[1])
      continue
    }
    merged.push([current[0], current[1]])
  }
  return merged
}

function normalizeOlderSegment<T extends TimelineItem>(
  page: TimelinePage<T>,
  createdBefore: number,
): null | ReadonlySegment<T> {
  const items = normalizeItems(page.items)
  const first = items[0]
  const last = items[items.length - 1]
  const upperBound = Math.max(createdBefore, first?.createdAt ?? createdBefore)

  let lowerBound: number
  if (page.hasMore) {
    if (!last) {
      return null
    }
    lowerBound = last.createdAt
  } else {
    lowerBound = Number.NEGATIVE_INFINITY
  }

  return {
    hasOlder: page.hasMore,
    items,
    lowerBound,
    upperBound,
  }
}

async function resyncSource<T extends TimelineItem>({
  bucket,
  consumeInterrupt,
  source,
  sourceKey,
  state,
  targetRanges,
}: {
  bucket?: ReadonlyBucket<T>
  consumeInterrupt: () => boolean
  source: TimelineSource<T>
  sourceKey: string
  state: TimelineState<T>
  targetRanges: Range[]
}): Promise<boolean> {
  let pending = subtractCoveredRanges(targetRanges, getStateRanges(state, sourceKey))
  if (pending.length === 0) {
    return true
  }

  const initialCursor =
    bucket?.segments[0]?.items[0]?.createdAt ??
    (pending.length > 0 ? Math.max(...pending.map((range) => range[1])) : undefined)
  if (initialCursor === undefined) {
    return true
  }

  let firstRequest = true
  let rollingCursor = initialCursor

  while (pending.length > 0) {
    if (consumeInterrupt()) {
      return false
    }

    const page = firstRequest
      ? await source.loadOlder(rollingCursor, true)
      : await source.loadOlder(rollingCursor)

    const segment = normalizeOlderSegment(page, rollingCursor)
    if (!segment) {
      throw new Error(
        `[timeline.resync] invalid empty older page with hasMore=true for ${sourceKey}`,
      )
    }

    state.addSegment(sourceKey, segment)
    pending = subtractCoveredRanges(pending, [[segment.lowerBound, segment.upperBound]])
    if (pending.length === 0) {
      return true
    }

    const oldest = page.items.at(-1)
    if (!oldest) {
      if (page.hasMore) {
        throw new Error(
          `[timeline.resync] source returned hasMore=true with empty items for ${sourceKey}`,
        )
      }
      throw new Error(`[timeline.resync] source exhausted before covering ranges for ${sourceKey}`)
    }

    rollingCursor = oldest.createdAt
    firstRequest = false

    if (!page.hasMore && pending.length > 0) {
      throw new Error(`[timeline.resync] source exhausted before covering ranges for ${sourceKey}`)
    }
  }

  return true
}

function subtractCoveredRanges(
  baseRanges: readonly Range[],
  coveredRanges: readonly Range[],
): Range[] {
  let pending = mergeRanges(baseRanges)
  if (pending.length === 0 || coveredRanges.length === 0) {
    return pending
  }

  const covered = mergeRanges(coveredRanges)
  for (const range of covered) {
    pending = subtractSingleRange(pending, range)
    if (pending.length === 0) {
      break
    }
  }
  return pending
}

function subtractSingleRange(baseRanges: readonly Range[], covered: Range): Range[] {
  const [coveredLower, coveredUpper] = covered
  const result: Range[] = []

  for (const [baseLower, baseUpper] of baseRanges) {
    if (coveredUpper < baseLower || coveredLower > baseUpper) {
      result.push([baseLower, baseUpper])
      continue
    }

    if (baseLower < coveredLower) {
      const leftUpper = decrementInclusive(coveredLower)
      result.push([baseLower, leftUpper])
    }

    if (coveredUpper < baseUpper) {
      const rightLower = incrementInclusive(coveredUpper)
      result.push([rightLower, baseUpper])
    }
  }

  return result
}
