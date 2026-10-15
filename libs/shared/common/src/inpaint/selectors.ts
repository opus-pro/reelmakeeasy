import { InpaintHistory } from './history'
import type { EditData, InpaintGlobalState, InpaintTaskRecords, Normalized } from './state'
import type { TaskRunRecord } from './task-types'

// Derived reads / predicates over inpaint state (history + business). Shared by
// backend validators and the per-edit pipeline as well as the frontend display
// model, so the rules live in exactly one place.

type AnyRun = TaskRunRecord<unknown>

// An edit is "visible at currentId" when its creation node is reachable
// (ancestor-or-self on the current main branch) and it is not hidden there.
// Single source of truth -- previously hand-duplicated and inconsistently (some
// sites checked only the hidden flag, missing the branch-reachability half,
// which falsely flagged "already has an active edit" after an undo and ran the
// pipeline for edits on abandoned branches).
export function isEditVisible(
  history: InpaintHistory,
  edit: Pick<EditData, 'historyId' | 'id'>,
): boolean {
  return history.isAtOrBeforeCurrent(edit.historyId) && !history.current.hiddenEditIds.has(edit.id)
}

// The same visibility test, but evaluated at the tip (latestId) instead of the
// cursor (currentId): "is this a live draft on the main lineage." Side-effect
// consumers (the per-edit pipeline) use this so they follow the latest committed
// reality, not the viewing cursor. Navigation-invariant -- pure undo/redo never
// moves latestId or the main branch, so merely viewing an old state never
// starts/stops generation; only a real fork (undo-then-edit) or a dismiss does.
export function isEditLive(
  history: InpaintHistory,
  edit: Pick<EditData, 'historyId' | 'id'>,
): boolean {
  return history.isOnMainBranch(edit.historyId) && !history.latest.hiddenEditIds.has(edit.id)
}

// How many inpaint generations the user still perceives as in flight, derived
// straight from persisted state so a client that never mounts the editor (mobile)
// can ask the server for it. Mirrors the editor's task-overlay statuses: an edit
// counts while its latest gen run is pending with no failed dependency, or was
// cancelled (the overlay falls back to "pending" and the edit awaits generation).
// Only the editor's pre-generation range-selection overlay has no counterpart
// here -- it is driven by client-local UI state (active edit + flag), not state.
export function countInFlightGenerations(
  state: Normalized<Pick<InpaintGlobalState, 'business' | 'history' | 'tasks'>>,
): number {
  const history = new InpaintHistory(state.history)
  const runsById = indexRuns(state.tasks)
  let count = 0
  for (const edit of Object.values(state.business.edits)) {
    if (!isEditVisible(history, edit)) {
      continue
    }
    const run = latestGenRun(state.tasks, edit)
    if (!run) {
      continue
    }
    if (
      run.state === 'cancelled' ||
      (run.state === 'pending' && !hasFailedDependency(state.tasks.depRecords, runsById, run.id))
    ) {
      count++
    }
  }
  return count
}

// The gen orchestrator never propagates child rejection, so a pending run can sit
// forever behind a dependency that already failed. Same DFS the editor walks:
// depRecords children are run ids (resolved deps) or task ids (still pending).
function hasFailedDependency(
  depRecords: InpaintTaskRecords['depRecords'],
  runsById: Map<string, AnyRun>,
  rootRunId: string,
): boolean {
  const seen = new Set<string>()
  const stack = [...(depRecords[rootRunId] ?? [])]
  while (stack.length > 0) {
    const id = stack.pop()
    if (id === undefined || seen.has(id)) {
      continue
    }
    seen.add(id)
    const run = runsById.get(id)
    if (run && (run.state === 'rejected' || run.state === 'cancelled')) {
      return true
    }
    for (const key of run && run.id !== id ? [run.id, id] : [id]) {
      for (const child of depRecords[key] ?? []) {
        stack.push(child)
      }
    }
  }
  return false
}

// Run-id and task-id lookup across every task bucket; a task id resolves to its
// last run, matching the editor's dep resolution.
function indexRuns(tasks: InpaintTaskRecords): Map<string, AnyRun> {
  const index = new Map<string, AnyRun>()
  for (const [bucketName, bucket] of Object.entries(tasks)) {
    if (bucketName === 'depRecords') {
      continue
    }
    for (const [taskId, entry] of Object.entries(
      bucket as Record<string, { runs: readonly AnyRun[] }>,
    )) {
      const last = entry.runs[entry.runs.length - 1]
      if (last) {
        index.set(taskId, last)
      }
      for (const run of entry.runs) {
        index.set(run.id, run)
      }
    }
  }
  return index
}

// Latest gen run across the edit's gen task ids, by startedAt: retries append runs
// to an existing entry, so recency wins over task order.
export function latestGenRun(tasks: InpaintTaskRecords, edit: EditData): AnyRun | undefined {
  let best: AnyRun | undefined
  for (const taskId of edit.genVideoTaskIds ?? []) {
    for (const run of tasks.editGenTaskRecords[taskId]?.runs ?? []) {
      if (!best || run.startedAt > best.startedAt) {
        best = run
      }
    }
  }
  return best
}
