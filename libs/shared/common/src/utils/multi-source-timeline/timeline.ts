import { intersection } from 'lodash-es'

import { TimelineState } from './timeline-state'
import {
  ReadonlySegment,
  Segment,
  SourceFailure,
  TimelineItem,
  TimelineSnapshot,
  TimelineSource,
} from './types'
import { normalizeItems } from './utils'

type TimelineRunResult = {
  changed: boolean
  errors: SourceFailure[]
  succeededSourceKeys: string[]
}

export class Timeline<T extends TimelineItem> {
  get isLoadingMore() {
    return this.loadMoreInFlight !== null
  }

  get isLoadingMoreWaiting() {
    return this.loadMorePending
  }

  get isLoadingNew() {
    return this.loadNewInFlight !== null
  }

  get isLoadingNewWaiting() {
    return this.loadNewPending
  }

  get isWritingLocked() {
    return this.writeQueueDepth > 0
  }

  private loadMoreInFlight: null | Promise<TimelineRunResult> = null
  private loadMorePending = false
  private loadNewInFlight: null | Promise<TimelineRunResult> = null
  private loadNewPending = false
  private readonly sourceMap = new Map<string, TimelineSource<T>>()
  private readonly state: TimelineState<T>
  private writeQueue: Promise<void> = Promise.resolve()
  private writeQueueDepth = 0

  constructor(sources: Readonly<Record<string, TimelineSource<T>>>, state?: TimelineState<T>) {
    let sourceKeys = Object.keys(sources)
    if (state) {
      sourceKeys = intersection(state.sourceKeys(), sourceKeys)
      this.state = state
    } else {
      this.state = new TimelineState<T>(sourceKeys)
    }
    for (const key of sourceKeys) {
      this.sourceMap.set(key, sources[key])
    }
  }

  has(id: string): boolean {
    return this.state.has(id)
  }

  async loadMore() {
    if (this.loadMoreInFlight) {
      this.loadMorePending = true
      return this.loadMoreInFlight
    }

    this.loadMoreInFlight = this.runLoadMoreLoop().finally(() => {
      this.loadMoreInFlight = null
    })

    return this.loadMoreInFlight
  }

  async loadNew() {
    if (this.loadNewInFlight) {
      this.loadNewPending = true
      return this.loadNewInFlight
    }

    this.loadNewInFlight = this.runLoadNewLoop().finally(() => {
      this.loadNewInFlight = null
    })

    return this.loadNewInFlight
  }

  remove(id: string) {
    this.state.remove(id)
  }

  removeMany(ids: readonly string[]) {
    this.state.removeMany(ids)
  }

  snapshot(): TimelineSnapshot<T> {
    return this.state.snapshot()
  }

  update(item: T) {
    this.state.update(item)
  }

  updateMany(items: readonly T[]) {
    this.state.updateMany(items)
  }

  private async applyNewFromSources(sourceKeys: readonly string[]): Promise<{
    changed: boolean
    errors: SourceFailure[]
    succeededSourceKeys: string[]
  }> {
    if (sourceKeys.length === 0) {
      return { changed: false, errors: [], succeededSourceKeys: [] }
    }

    const results = await Promise.all(
      sourceKeys.map(async (sourceKey) => {
        const source = this.sourceMap.get(sourceKey)
        if (!source || !this.state.hasSource(sourceKey)) {
          return { kind: 'skip' as const, sourceKey }
        }

        const createdAfter = this.state.newerCursor(sourceKey)
        const queryTime = Date.now()
        try {
          const page = await source.loadNewer(createdAfter)
          return { createdAfter, kind: 'ok' as const, page, queryTime, sourceKey }
        } catch (error) {
          return { error, kind: 'err' as const, sourceKey }
        }
      }),
    )

    let changed = false
    const errors: SourceFailure[] = []
    const succeededSourceKeys: string[] = []

    for (const result of results) {
      if (result.kind === 'err') {
        errors.push({
          error: result.error,
          sourceKey: result.sourceKey,
        })
        continue
      }

      if (result.kind === 'skip') {
        continue
      }
      succeededSourceKeys.push(result.sourceKey)
      const segment = this.normalizeNewSegment(result.page, result.createdAfter, result.queryTime)
      if (!segment) {
        continue
      }
      if (this.state.addSegment(result.sourceKey, segment)) {
        changed = true
      }
    }

    return { changed, errors, succeededSourceKeys }
  }

  private async applyOlderFromSources(sourceKeys: readonly string[]): Promise<{
    changed: boolean
    errors: SourceFailure[]
    succeededSourceKeys: string[]
  }> {
    if (sourceKeys.length === 0) {
      return { changed: false, errors: [], succeededSourceKeys: [] }
    }

    const results = await Promise.all(
      sourceKeys.map(async (sourceKey) => {
        const source = this.sourceMap.get(sourceKey)
        if (!source || !this.state.hasSource(sourceKey) || !this.state.hasOlder(sourceKey)) {
          return { kind: 'skip' as const, sourceKey }
        }

        const createdBefore = this.state.olderCursor(sourceKey)
        if (createdBefore === undefined) {
          return { kind: 'skip' as const, sourceKey }
        }
        const queryTime = Date.now()

        try {
          const page = await source.loadOlder(createdBefore)
          return { createdBefore, kind: 'ok' as const, page, queryTime, sourceKey }
        } catch (error) {
          return { error, kind: 'err' as const, sourceKey }
        }
      }),
    )

    let changed = false
    const errors: SourceFailure[] = []
    const succeededSourceKeys: string[] = []

    for (const result of results) {
      if (result.kind === 'err') {
        errors.push({
          error: result.error,
          sourceKey: result.sourceKey,
        })
        continue
      }

      if (result.kind === 'skip') {
        continue
      }
      succeededSourceKeys.push(result.sourceKey)
      const segment = this.normalizeOlderSegment(
        result.page,
        result.createdBefore,
        result.queryTime,
      )
      if (!segment) {
        continue
      }
      if (this.state.addSegment(result.sourceKey, segment)) {
        changed = true
      }
    }

    return { changed, errors, succeededSourceKeys }
  }

  private normalizeNewSegment(
    page: Awaited<ReturnType<TimelineSource<T>['loadNewer']>>,
    createdAfter: number | undefined,
    queryTime: number,
  ): null | Segment<T> {
    const items = normalizeItems(page.items)
    const first = items[0]
    const last = items[items.length - 1]
    const hasOlder = page.hasMore
    const upperBound = first?.createdAt ?? queryTime

    let lowerBound: number
    if (hasOlder) {
      if (!last) {
        return null
      }
      lowerBound = last.createdAt
    } else if (createdAfter === undefined) {
      lowerBound = Number.NEGATIVE_INFINITY
    } else {
      lowerBound = last ? Math.min(createdAfter, last.createdAt) : createdAfter
    }

    return {
      hasOlder,
      items,
      lowerBound,
      upperBound,
    }
  }

  private normalizeOlderSegment(
    page: Awaited<ReturnType<TimelineSource<T>['loadOlder']>>,
    createdBefore: number,
    queryTime: number,
  ): null | ReadonlySegment<T> {
    const items = normalizeItems(page.items)
    const first = items[0]
    const last = items[items.length - 1]
    const hasOlder = page.hasMore
    const upperBound = Math.max(createdBefore, first?.createdAt ?? queryTime)

    let lowerBound: number
    if (hasOlder) {
      if (!last) {
        return null
      }
      lowerBound = last.createdAt
    } else {
      lowerBound = Number.NEGATIVE_INFINITY
    }

    return {
      hasOlder,
      items,
      lowerBound,
      upperBound,
    }
  }

  private runExclusive<R>(task: () => Promise<R>): Promise<R> {
    this.writeQueueDepth += 1
    const wrapped = async () => {
      try {
        return await task()
      } finally {
        this.writeQueueDepth = Math.max(0, this.writeQueueDepth - 1)
      }
    }
    const run = this.writeQueue.then(wrapped, wrapped)
    this.writeQueue = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  private async runLoadMoreLoop() {
    let merged = createRunResult()

    do {
      this.loadMorePending = false

      const result = await this.runExclusive(async () => {
        if (!this.state.anyHasMoreOlder()) {
          return createRunResult()
        }

        const commit = this.state.commitBottom()
        const sourceKeys =
          commit === null
            ? this.state.sourceKeys().filter((key) => this.state.hasOlder(key))
            : this.state.bottlenecks(commit)
        if (sourceKeys.length === 0) {
          return createRunResult()
        }

        const initKeys = sourceKeys.filter(
          (sourceKey) => this.state.newerCursor(sourceKey) === undefined,
        )
        const olderKeys = sourceKeys.filter(
          (sourceKey) => this.state.newerCursor(sourceKey) !== undefined,
        )

        const [initResult, olderResult] = await Promise.all([
          initKeys.length > 0
            ? this.applyNewFromSources(initKeys)
            : Promise.resolve(createRunResult()),
          olderKeys.length > 0
            ? this.applyOlderFromSources(olderKeys)
            : Promise.resolve(createRunResult()),
        ])
        const round = mergeRunResults(initResult, olderResult)

        if (round.changed) {
          this.state.touch()
        }
        return round
      })

      merged = mergeRunResults(merged, result)
    } while (this.loadMorePending)

    return merged
  }

  private async runLoadNewLoop() {
    let merged = createRunResult()

    do {
      this.loadNewPending = false

      const result = await this.runExclusive(async () => {
        const round = await this.applyNewFromSources(this.state.sourceKeys())
        if (round.changed) {
          this.state.touch()
        }
        return round
      })

      merged = mergeRunResults(merged, result)
    } while (this.loadNewPending)

    return merged
  }
}

function createRunResult(): TimelineRunResult {
  return {
    changed: false,
    errors: [],
    succeededSourceKeys: [],
  }
}

function mergeRunResults(base: TimelineRunResult, next: TimelineRunResult): TimelineRunResult {
  const succeeded = new Set(base.succeededSourceKeys)
  for (const sourceKey of next.succeededSourceKeys) {
    succeeded.add(sourceKey)
  }

  return {
    changed: base.changed || next.changed,
    errors: [...base.errors, ...next.errors],
    succeededSourceKeys: [...succeeded],
  }
}

export { Snapshot } from './snapshot'
export { TimelineState } from './timeline-state'
export type { TimelineItem, TimelinePage, TimelineSnapshot, TimelineSource } from './types'
