import { InpaintHistory } from './history'
import type { InpaintHistoryData, InpaintHistoryDiff } from './types'

// Cap on the number of diffs the client-facing history projection carries.
export const MAX_PUBLIC_HISTORY_DIFFS = 200

// Bound the public history projection: keep at most `maxDiffs` main-branch diffs
// ending at latestId, re-basing on the state at the cut, and drop everything
// else (older main-branch nodes plus every abandoned branch, which the client can
// neither navigate to nor render). Never cuts past currentId, so the user's undo
// range stays intact. Nothing here is persisted, so the projection is free to
// change shape; it only has to be deterministic for the SSE diff stream.
export function truncateInpaintPublicHistory(
  data: InpaintHistoryData,
  maxDiffs: number,
): {
  droppedMainBranchIds: ReadonlySet<string>
  history: InpaintHistoryData
  historyTruncated: boolean
} {
  const untouched = {
    droppedMainBranchIds: new Set<string>(),
    history: data,
    historyTruncated: false,
  }

  // Legacy persisted blobs can omit whole top-level fields, so history may be
  // absent at runtime despite the type (see readInpaintState).
  if (data?.base === undefined) {
    return untouched
  }

  // InpaintHistory registers children by diff.id and then reads them back by
  // record key, so a mismatch anywhere (including abandoned branches) makes the
  // state walk throw.
  if (Object.entries(data.diffs).some(([key, diff]) => diff.id !== key)) {
    return untouched
  }

  const list = buildMainBranchIds(data)
  const currentIdx = list.indexOf(data.currentId)
  if (list[0] !== data.base.id || currentIdx === -1) {
    return untouched
  }

  const cutIdx = Math.min(Math.max(0, list.length - 1 - maxDiffs), currentIdx)
  // Deep undo pins the cut at the cursor, which can leave more redo steps ahead
  // than the cap allows; drop that tail too. The window slides forward as the
  // user redoes, since the projection is rebuilt on every state bump.
  const keptIds = list.slice(cutIdx + 1, cutIdx + 1 + maxDiffs)
  const latestId = keptIds.at(-1) ?? data.base.id
  if (cutIdx === 0 && keptIds.length === Object.keys(data.diffs).length) {
    return untouched
  }

  const diffs: Record<string, InpaintHistoryDiff> = {}
  for (const id of keptIds) {
    diffs[id] = data.diffs[id]
  }
  if (cutIdx === 0) {
    return {
      droppedMainBranchIds: new Set<string>(),
      history: { ...data, diffs, latestId },
      historyTruncated: latestId !== data.latestId,
    }
  }

  const cutId = list[cutIdx]
  const cutState = new InpaintHistory(data).stateAt(cutId)
  if (!cutState) {
    return untouched
  }
  return {
    droppedMainBranchIds: new Set(list.slice(0, cutIdx)),
    history: {
      base: {
        // Sorted so the same input always yields the same bytes to diff against.
        appliedEditIds: [...cutState.appliedEditIds].sort(),
        hiddenEditIds: [...cutState.hiddenEditIds].sort(),
        id: cutId,
        keyframes: cutState.keyframes,
        transitions: cutState.transitions,
      },
      currentId: data.currentId,
      diffs,
      latestId,
    },
    historyTruncated: true,
  }
}

// [base.id, ..., latestId] via prevId. Stops at a missing node or a revisit so a
// corrupt chain cannot hang; the caller detects that by list[0] !== base.id.
function buildMainBranchIds(data: InpaintHistoryData): string[] {
  const list: string[] = []
  const seen = new Set<string>()
  let id: string = data.latestId
  while (!seen.has(id)) {
    seen.add(id)
    list.unshift(id)
    if (id === data.base.id) {
      break
    }
    const prevId = data.diffs[id]?.prevId
    if (prevId === undefined) {
      break
    }
    id = prevId
  }
  return list
}
