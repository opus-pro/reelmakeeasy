import type { LongTakeKeyframe } from '@shared/types/api/long-take'

import type { RenderFinalTransitionVideo } from '../long-take/render-final.types'
import { asStoreUri } from '../storage/address'

import type { InpaintHistoryData, InpaintHistoryDiff, Op } from './types'
import { parseStoreUri } from '../storage/stored-files'

export type HistoryState = {
  // editIds whose edit was applied (result written into the timeline) at this
  // history state. Derived from set_edit_applied ops along the path from base.
  // Distinguishes applied from merely hidden (dismissed) edits.
  appliedEditIds: Set<string>
  // editIds soft-deleted (dismissed) at this history state. Derived from
  // set_edit_hidden ops along the path from base; carries no transition data.
  hiddenEditIds: Set<string>
  id: string
  keyframeMap: Map<string, LongTakeKeyframe> // shotId -> keyframe
  keyframes: LongTakeKeyframe[]
  transitionMap: Map<string, RenderFinalTransitionVideo> // transitionId -> transition
  transitions: RenderFinalTransitionVideo[]
}

export class InpaintHistory {
  get current(): HistoryState {
    return this.stateMap[this._data.currentId]
  }

  get currentStateId(): string {
    return this._data.currentId
  }

  get data(): InpaintHistoryData {
    return this._data
  }

  // State at the tip of the main branch (latestId). Navigation-invariant: undo/redo
  // move currentId but never latestId, so side-effect consumers read this.
  get latest(): HistoryState {
    return this.stateMap[this._data.latestId]
  }

  private _data: InpaintHistoryData
  // Ordered path base.id to latestId (main branch), for default redo.
  private idList: string[]
  private stateMap: Record<string, HistoryState>

  constructor(data: InpaintHistoryData) {
    this._data = data
    this.stateMap = this.buildStateMap()
    this.idList = this.buildIdList()
  }

  // Apply a new diff: incremental stateMap update via semantic ops.
  // Updates latestId and rebuilds idList. Caller handles SSE bump.
  apply(diff: InpaintHistoryDiff): void {
    const parent = this.stateMap[diff.prevId]
    const { appliedEditIds, hiddenEditIds, keyframes, transitions } = applyOps(parent, diff.ops)
    this.stateMap[diff.id] = makeHistoryState(
      diff.id,
      transitions,
      keyframes,
      hiddenEditIds,
      appliedEditIds,
    )
    this._data = {
      ...this._data,
      diffs: { ...this._data.diffs, [diff.id]: diff },
      currentId: diff.id,
      latestId: diff.id,
    }
    this.idList = this.buildIdList()
  }

  // Move currentId directly to targetId. Unifies undo/redo: undo = an ancestor,
  // redo = a node toward latestId. Only main-branch nodes are reachable (idList),
  // so stale sibling branches are rejected. Returns false if not reachable.
  // Idempotent: targetId === currentId is a no-op success. Caller handles SSE.
  goto(targetId: string): boolean {
    if (targetId === this._data.currentId) {
      return true
    }
    if (!this.isOnMainBranch(targetId)) {
      return false
    }
    this._data = { ...this._data, currentId: targetId }
    return true
  }

  // True if `id` is on the main branch at or before currentId -- i.e. an
  // ancestor-or-self of the current node (inclusive of currentId itself). An edit's
  // historyId is valid/visible only when this holds (not undone past, not on a stale
  // branch). Equivalent to the backend checkHistoryConflict prevId traversal.
  isAtOrBeforeCurrent(id: string): boolean {
    const idx = this.idList.indexOf(id)
    if (idx === -1) {
      return false
    }
    return idx <= this.idList.indexOf(this._data.currentId)
  }

  // Whether id sits on the current main branch (base -> latestId). currentId is
  // always on it, so this also returns true for the current node.
  isOnMainBranch(id: string): boolean {
    return this.idList.includes(id)
  }

  // The next state id along the main branch (idList, toward latestId), or
  // undefined at the tip. Pure/non-mutating, so callers (e.g. an update
  // validator) can check redo-ability without side effects.
  nextRedoId(): string | undefined {
    const idx = this.idList.indexOf(this._data.currentId)
    if (idx === -1 || idx === this.idList.length - 1) {
      return undefined
    }
    return this.idList[idx + 1]
  }

  // Redo one step along the main branch. Returns false at the tip. An optional
  // childId is a confirmation: if given and it does not equal the main-branch
  // next step, the redo is rejected (no navigation) - this prevents jumping onto
  // a stale sibling branch. Caller handles SSE.
  redo(childId?: string): boolean {
    const next = this.nextRedoId()
    if (next === undefined || (childId !== undefined && childId !== next)) {
      return false
    }
    this._data = { ...this._data, currentId: next }
    return true
  }

  // Look up state at any id - used by edit task handlers to get full transition data.
  stateAt(id: string): HistoryState | undefined {
    return this.stateMap[id]
  }

  // Undo: move currentId to parent. Returns false if already at base. Caller handles SSE.
  undo(): boolean {
    if (this._data.currentId === this._data.base.id) {
      return false
    }
    const cur = this._data.diffs[this._data.currentId]
    this._data = { ...this._data, currentId: cur.prevId }
    return true
  }

  // The undo target (parent of current), or undefined at base. Pure; lets the
  // frontend compute a single-step undo destination for goto().
  undoTargetId(): string | undefined {
    if (this._data.currentId === this._data.base.id) {
      return undefined
    }
    return this._data.diffs[this._data.currentId]?.prevId
  }

  // Traverse latestId to base.id via prevId using unshift, building [base.id, ..., latestId].
  // Stops on a revisit so a malformed chain cannot spin: this runs inside the
  // workflow, where a cyclic payload would wedge the process silently
  // (no throw, no OOM) and recur on every revival.
  private buildIdList(): string[] {
    const list: string[] = []
    const seen = new Set<string>()
    let id: string = this._data.latestId
    while (!seen.has(id)) {
      seen.add(id)
      list.unshift(id)
      if (id === this._data.base.id) {
        break
      }
      id = this._data.diffs[id]?.prevId ?? this._data.base.id
    }
    return list
  }

  // O(n) - called once at construction. DFS from base applying ops forward.
  private buildStateMap(): Record<string, HistoryState> {
    const stateMap: Record<string, HistoryState> = {}
    const children: Record<string, string[]> = {}
    for (const diff of Object.values(this._data.diffs)) {
      ;(children[diff.prevId] ??= []).push(diff.id)
    }
    const { base } = this._data
    const baseState = makeHistoryState(
      base.id,
      normalizeTransitionUris(base.transitions),
      base.keyframes,
      new Set(base.hiddenEditIds ?? []),
      new Set(base.appliedEditIds ?? []),
    )
    const stack: HistoryState[] = [baseState]
    while (stack.length > 0) {
      const entry = stack.pop()
      if (!entry) {
        break
      }
      stateMap[entry.id] = entry
      for (const childId of children[entry.id] ?? []) {
        const diff = this._data.diffs[childId]
        const { appliedEditIds, hiddenEditIds, keyframes, transitions } = applyOps(entry, diff.ops)
        stack.push(makeHistoryState(childId, transitions, keyframes, hiddenEditIds, appliedEditIds))
      }
    }
    return stateMap
  }
}

// Apply ops to a parent HistoryState, returning new transitions, keyframes, and
// hiddenEditIds. Each is only re-allocated when an op actually changes it.
function applyOps(
  parent: HistoryState,
  ops: Op[],
): {
  appliedEditIds: Set<string>
  hiddenEditIds: Set<string>
  keyframes: LongTakeKeyframe[]
  transitions: RenderFinalTransitionVideo[]
} {
  let transitions = parent.transitions
  let keyframes = parent.keyframes
  let hiddenEditIds = parent.hiddenEditIds
  let appliedEditIds = parent.appliedEditIds
  for (const op of ops) {
    if (op.type === 'set_edit_applied') {
      // Applied marker: record the edit as applied, leave transitions/keyframes.
      const next = new Set(appliedEditIds)
      next.add(op.editId)
      appliedEditIds = next
    } else if (op.type === 'set_edit_hidden') {
      // Soft-delete marker: flip the edit's hidden flag, leave transitions/keyframes.
      const next = new Set(hiddenEditIds)
      if (op.hidden) {
        next.add(op.editId)
      } else {
        next.delete(op.editId)
      }
      hiddenEditIds = next
    } else if (op.type === 'apply_transition') {
      // Re-rendered transition has no lip-sync variant; clear stale base/lipSync
      // URIs so the preview never falls back to a pre-inpaint video.
      transitions = transitions.map((t) =>
        t.transitionId === op.transitionId
          ? {
              ...t,
              baseVideoUri: undefined,
              lipSyncEnabled: undefined,
              lipSyncVideoUri: undefined,
              // New clip dims for cover-crop; undefined (cross-run cache hit) clears
              // the stale dims so the preview falls back to full-frame.
              videoHeight: op.videoHeight,
              videoUri: op.videoUri,
              videoWidth: op.videoWidth,
            }
          : t,
      )
    } else if (op.type === 'apply_keyframe') {
      keyframes = keyframes.map((k) => (k.shotId === op.keyframe.shotId ? op.keyframe : k))
    }
  }
  return { appliedEditIds, hiddenEditIds, keyframes, transitions }
}

// A render manifest can carry CDN-form videoUris (a 4k export re-commits the
// already-CDN-converted canonical editor state), but every consumer of a
// transition downloads it through parseStoreUri, which accepts store:// only. Apply
// ops always write store://, so normalizing the base covers the whole tree.
function normalizeTransitionUris(
  transitions: RenderFinalTransitionVideo[],
): RenderFinalTransitionVideo[] {
  return transitions.map((t) => {
    const videoUri = asStoreUri(t.videoUri)
    return videoUri === t.videoUri ? t : { ...t, videoUri }
  })
}

// Helper to build a HistoryState with keyframeMap and transitionMap.
function makeHistoryState(
  id: string,
  transitions: RenderFinalTransitionVideo[],
  keyframes: LongTakeKeyframe[],
  hiddenEditIds: Set<string>,
  appliedEditIds: Set<string>,
): HistoryState {
  return {
    appliedEditIds,
    hiddenEditIds,
    id,
    keyframes,
    keyframeMap: new Map(keyframes.map((k) => [k.shotId, k])),
    transitionMap: new Map(transitions.map((t) => [t.transitionId, t])),
    transitions,
  }
}

// Build a new diff from a set of ops.
export function makeHistoryDiff(id: string, prevId: string, ops: Op[]): InpaintHistoryDiff {
  return { createdAt: Date.now(), id, ops, prevId }
}

// Return the set of transitionIds affected by a diff (for conflict detection).
// Only a user APPLY counts: such a diff carries set_edit_applied alongside its
// apply_transition ops. Draft-migration diffs seed the timeline with bare
// apply_transition ops (no set_edit_applied) and must NOT register as conflicts --
// keying on set_edit_applied mirrors how appliedEditIds is derived.
export function affectedTransitionIds(diff: InpaintHistoryDiff): Set<string> {
  const ids = new Set<string>()
  if (!diff.ops.some((op) => op.type === 'set_edit_applied')) {
    return ids
  }
  for (const op of diff.ops) {
    if (op.type === 'apply_transition') {
      ids.add(op.transitionId)
    }
  }
  return ids
}
