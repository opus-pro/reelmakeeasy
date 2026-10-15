# Multi-Source Timeline

Build one timeline from multiple upstream lists, with **visible completeness correctness** as the first priority.

## What Problem This Solves

Naive multi-source pagination often causes:

1. Missing items when one source lags.
2. Wasteful fetches on non-blocking sources.
3. Bad merges across overlapping ranges.
4. Unstable behavior with page-number pagination.

This module is intentionally opinionated: correctness first, then efficiency and freshness.

Typical sources:

- `projects`
- any future source that can provide `{ id, createdAt }`

## Quick Start

```ts
import { Timeline, type TimelineItem, type TimelineSource } from './timeline'

type ProjectItem = TimelineItem & {
  status: string
}

const projectSource: TimelineSource<ProjectItem> = {
  async loadNewer(createdAfter?: number) {
    const res = await fetchProjects({ createdAfter })
    return {
      hasMore: res.hasMore,
      items: res.items, // createdAt DESC
    }
  },
  async loadOlder(createdBefore: number, include?: boolean) {
    const res = await fetchProjects({ createdBefore, include })
    return {
      hasMore: res.hasMore,
      items: res.items, // createdAt DESC
    }
  },
}

const timeline = new Timeline({ projects: projectSource })

const newResult = await timeline.loadNew()
const moreResult = await timeline.loadMore()

if (newResult.errors.length > 0 || moreResult.errors.length > 0) {
  console.error({ newResult, moreResult })
}

const snap = timeline.snapshot()
console.log(snap.visible, snap.all, snap.commitBottom, snap.hasMore)
```

## Public API

Core types:

- `TimelineItem`: `{ id: string; createdAt: number }`
- `TimelineSource<T>`:
  - `loadNewer(createdAfter?: number) => Promise<TimelinePage<T>>`
  - `loadOlder(createdBefore: number, include?: boolean) => Promise<TimelinePage<T>>`

Timeline methods:

- `loadNew()`: fetch head updates from all sources.
- `loadMore()`: fetch older data from bottleneck sources; auto-initialize empty sources via `loadNewer`.
- `snapshot()`: returns `all`, `visible`, `commitBottom`, `bottlenecks`, `hasMore`.
  - Computation is lazy per field (unused fields are not computed).
  - Values are cached within the same state version.
  - Repeated `snapshot()` calls are safe; recompute happens after mutation only.
- `update` / `updateMany`: patch existing items in place.
- `remove` / `removeMany`: delete by id.

Runtime status getters:

- `isWritingLocked`: `true` when there is any running or queued write task.
- `isLoadingNew`: `true` when a `loadNew()` run is currently in flight.
- `isLoadingNewWaiting`: `true` when another `loadNew()` call arrived while one is in flight (trailing rerun requested).
- `isLoadingMore`: `true` when a `loadMore()` run is currently in flight.
- `isLoadingMoreWaiting`: `true` when another `loadMore()` call arrived while one is in flight (trailing rerun requested).

`loadNew()` / `loadMore()` return:

```ts
type TimelineRunResult = {
  changed: boolean
  errors: Array<{ sourceKey: string; error: unknown }>
  succeededSourceKeys: string[]
}
```

Use return fields:

- `changed`: skip expensive UI work if `false`.
- `errors`: log and decide retry policy per source.
- `succeededSourceKeys`: telemetry and partial-success handling.
  - Scope: only sources that succeeded in the current `loadNew()` / `loadMore()` call (including any merged trailing rerun in that call), not historical successes.
  - `skip` sources are not included.

## Practical Tips

1. When `loadNewer` has no `createdAfter`, call upstream without time filter when possible.
2. That no-cursor request can often return `304 Not Modified`.
3. Prefer handling `errors` from `loadNew` / `loadMore` explicitly (at least log + retry policy).
4. Use `changed` to reduce unnecessary rerenders.
5. Use `succeededSourceKeys` for retries/metrics.

## Important Semantics

### 1) `loadNewer` direction is head-down

`loadNewer(createdAfter)` does **not** mean ascending fetch from cursor upward.

- It still returns head-first data in `createdAt DESC`.
- Think: "latest window", optionally constrained by `createdAfter`.

### 1.1) Why `loadNew()` can create a new segment (and temporary gap)

`loadNew()` inserts a head-side segment. In real business traffic, this can happen:

1. Source A receives fresh items now.
2. Source B has no fresh items yet (or request is delayed/failed).
3. A gets a new head segment that does not bridge to older cached ranges immediately.

Result:

- `all` may contain disconnected ranges temporarily.
- `visible` is still protected by `commitBottom`, so cross-source completeness is not broken.

This is expected behavior; follow-up `loadNew()` / `loadMore()` calls usually bridge the gap once missing ranges arrive.

### 2) `upperBound` / `lowerBound` are continuous ranges

`items` are discrete points; bounds represent continuous time coverage.

- `upperBound`: newest covered timestamp.
- `lowerBound`: oldest covered timestamp.
  - `lowerBound` can be `-Infinity` when a segment has confirmed no older tail.

This enables range-level bridge decisions even when timestamps are sparse.

### 2.1) Multi-source bucket model

Per source:

- `segments[0]`: active segment (visibility + bottom alignment).
- `segments[1..]`: parked segments for later bridge/reuse.
- `hasOlder`: whether older data may still exist.

### 3) Why use `createdAt` cursors, not page-number pagination

`createdAt` cursors are better for multi-source feeds because they are:

1. Comparable across sources.
2. More stable under inserts/deletes.
3. Easier to merge/clip by time.
4. Better for head refresh + tail pagination.

## Visibility Model (`commitBottom`)

`commitBottom = max(activeBottom of sources where hasOlder=true)`

If all sources are fully exhausted (`hasOlder=false`), `commitBottom` becomes `-Infinity`.

Render policy:

- `visible`: `createdAt >= commitBottom`
- `all`: full merged cache

Reason:

- A source with `hasOlder=true` only guarantees completeness above its active bottom.
- Cross-source safe range is the intersection of all source guarantees.

## Why This Design

Design choices:

1. Segment model over flat list for explicit range semantics.
2. Bottleneck-driven `loadMore` to avoid unnecessary fetches.
3. Partial-success retention to keep good source updates.
4. Single-flight + trailing rerun for concurrent calls.
5. Lazy snapshot caching for cheap repeated reads.

## Core Requirements

1. Item shape is unified: `{ id, createdAt }`.
2. Display order is always `createdAt DESC`.
3. Pagination is cursor-based (time), not page-number based.
4. Cursors are timestamps: `createdAfter` / `createdBefore`.
5. Incremental loading depends on `hasMore`.
6. Visible range must avoid cross-source holes.
7. Tie-breaker for same `createdAt` is `id DESC`.
8. `createdAt` is immutable after first insert.

## Segment Bridge Rules

1. Segment range is normalized to `[lowerBound, upperBound]`.
2. Adjacent segments bridge when ranges overlap.
3. Merged bounds:
   - `upperBound = max(A.upperBound, B.upperBound)`
   - `lowerBound = min(A.lowerBound, B.lowerBound)`
4. `hasOlder` follows lower-edge ownership.
5. Bridging repeats until no further overlap.

## Source Adapter Contract

Source-side requirements:

1. Return `items` in `createdAt DESC`.
2. Keep cursor semantics consistent:
   - `loadNewer(createdAfter)` returns head-first data compatible with the cursor.
   - `loadOlder(createdBefore, include?)` returns tail-side data compatible with the cursor.
3. Keep `id` stable and globally unique in merged scope.
4. Never change `createdAt` for an existing id.
5. Avoid returning empty pages with `hasMore=true` in normal operation; this is a source reliability guideline, not a user-side guarantee.

## `include` Parameter on `loadOlder`

`loadOlder(createdBefore, include?)` controls boundary inclusion:

- `include=true`: include the boundary item at `createdBefore` if upstream supports it.
- `include=false|undefined`: exclude the boundary item.

The exact `include` behavior is defined by each source adapter contract, and Timeline assumes that behavior is stable.

## Real-Time Update Constraints

1. Existing items: patch in place (`update` / `updateMany`).
2. New head/tail data: use fetch flow (`loadNewer` / `loadOlder`), not ad-hoc inserts.
3. Deletions: use `remove` / `removeMany`.

## Real-Time Freshness Strategy

To keep the list fresh with real-time events, combine push signals with pull reconciliation:

1. On status/progress event for an existing id:
   - call `update` / `updateMany` only.
2. On create/new-item event:
   - trigger `loadNew()` instead of local prepend.
   - reason: source order, dedup, and segment bounds stay canonical; also, in-segment arbitrary insert is currently out of scope.
3. On delete event:
   - call `remove` / `removeMany`.
4. On reconnect, tab focus, or polling tick:
   - call `loadNew()` as reconciliation.
5. On user scroll near tail:
   - call `loadMore()`.

Recommended event loop:

```ts
socket.on('item-updated', (item) => {
  timeline.update(item)
})

socket.on('item-created', async () => {
  const result = await timeline.loadNew()
  if (result.errors.length > 0) report(result.errors)
})

socket.on('item-deleted', ({ id }) => {
  timeline.remove(id)
})

window.addEventListener('focus', async () => {
  await timeline.loadNew()
})
```

Why this works:

- Push gives low-latency UI updates.
- Pull (`loadNew`) repairs drift, ordering gaps, and missed events.
- `snapshot().visible` remains safe via `commitBottom` even with uneven source lag.

## Naming Stability

- Keep declaration names stable: `Timeline`, `TimelineItem`, etc.
- If aliases are added, do not break existing callers.

## Assumptions and Preconditions

1. `createdAt` is comparable across sources (same unit/epoch).
2. Backend ordering is deterministic for equal timestamps.
3. Source pages are eventually consistent for repeated polling.
4. Temporary difference between `all` and `visible` is expected.
5. Current segment mutation model is append/bridge + delete/update only; no in-segment arbitrary insert is supported today.
6. In-segment insert support is a possible future extension, but is intentionally out of current scope.
7. Local JS `queryTime` and backend `createdAt` must share a consistent time basis (clock skew should be bounded).

## Current Capability Summary

1. N-source aggregation with segment-based state.
2. Visibility correctness via `commitBottom`.
3. Bottleneck-driven `loadMore` and head refresh via `loadNew`.
4. Auto-bridge, global dedup by `id`, stable sort by `createdAt + id`.
5. Coalesced requests, lazy snapshot cache, and partial-success retention.

## Module Design Notes

`timeline.ts`:

- Public orchestration facade.
- Handles fetch flow (`loadNew`, `loadMore`), coalescing, runtime flags, and mutation APIs.
- Converts pages to normalized segments, then delegates state mutation to `timeline-state`.

`timeline-state.ts`:

- Pure in-memory state engine (no network calls).
- Owns buckets/segments/indexes and merge-bridge logic.

`timeline-builder.ts`:

- State reconstruction/resync helper (not the normal read path).
- Re-fetches older ranges from a previous snapshot target.
- Supports interruption/resume and returns `ok/errors/interrupted`.
- Main use case: reconnect/restart/recovery rebuild.

## File Responsibilities

- `timeline.ts`: public orchestration (`loadNew`, `loadMore`, snapshot, mutations).
- `timeline-state.ts`: pure state, segment insertion/merge/bridge, indexes.
- `snapshot.ts`: cached read model (`all`, `visible`, `commitBottom`, `bottlenecks`).
- `types.ts`: type contracts.
- `utils.ts`: normalization and merge helpers.
- `timeline-builder.ts`: resync builder from previous ranges.
- `timeline.test.ts`: high-level behavior and concurrency tests.
- `timeline-state.test.ts`: state-level bridge/merge tests.
- `timeline-builder.test.ts`: resync/interruption/range-coverage tests.

## Agent-Friendly Index

Keywords:

- `commitBottom`
- `bottleneck`
- `segment bridge`
- `upperBound lowerBound`
- `loadNew loadMore`
- `loadNewer source contract`
- `timeline-builder resync`
- `partial success retention`
- `single-flight pending rerun`
