import type { InpaintTimelineEvent } from '@shared/types/api/long-take'

import type { InpaintHistoryData, InpaintHistoryDiff } from './types'

// Full chronology of an inpaint session: one event per classifiable diff across
// every branch, newest first. Unlike the client-side history list (which walks
// currentId back to base), abandoned branches are kept and marked via
// onMainBranch, so an undone-then-superseded edit is still visible.
export function deriveInpaintTimelineEvents(
  data: InpaintHistoryData,
  edits: Record<string, { editPrompt?: string }>,
  opts?: { before?: number; beforeId?: string; limit?: number },
): { events: InpaintTimelineEvent[]; hasMore: boolean } {
  const mainBranchIds = buildMainBranchIds(data)

  const all: InpaintTimelineEvent[] = []
  for (const diff of Object.values(data.diffs)) {
    const event = classify(diff, edits)
    if (event) {
      all.push({ ...event, onMainBranch: mainBranchIds.has(diff.id) })
    }
  }
  // Codepoint compare, not localeCompare: the tie-break must agree with the
  // beforeId cursor filter, which uses plain string comparison.
  all.sort((a, b) => b.createdAt - a.createdAt || (a.diffId < b.diffId ? -1 : 1))

  // Composite cursor: diffs sharing a millisecond are ordered by diffId ascending, so
  // paging past one of them needs the id too or its siblings are skipped.
  const before = opts?.before
  const beforeId = opts?.beforeId
  const page =
    before === undefined
      ? all
      : all.filter(
          (e) =>
            e.createdAt < before ||
            (e.createdAt === before && beforeId !== undefined && e.diffId > beforeId),
        )
  const limit = opts?.limit ?? 200
  return { events: page.slice(0, limit), hasMore: page.length > limit }
}

// base.id -> latestId via prevId. Stops at a missing node or a revisit so a
// corrupt chain cannot hang; ids past the break are simply not flagged.
function buildMainBranchIds(data: InpaintHistoryData): Set<string> {
  const seen = new Set<string>()
  let id: string = data.latestId
  while (!seen.has(id)) {
    seen.add(id)
    if (id === data.base.id) {
      break
    }
    const prevId = data.diffs[id]?.prevId
    if (prevId === undefined) {
      break
    }
    id = prevId
  }
  return seen
}

function classify(
  diff: InpaintHistoryDiff,
  edits: Record<string, { editPrompt?: string }>,
): Omit<InpaintTimelineEvent, 'onMainBranch'> | undefined {
  const keyframeCount = diff.ops.filter((op) => op.type === 'apply_keyframe').length
  const clipCount = diff.ops.filter((op) => op.type === 'apply_transition').length
  if (clipCount > 0) {
    // A migration diff carries a bare apply_transition with no owning edit.
    const editId = diff.ops.find((op) => op.type === 'set_edit_applied')?.editId
    return {
      clipCount,
      createdAt: diff.createdAt,
      diffId: diff.id,
      editId,
      // Applying an edit writes its keyframes into the same diff, so they are
      // reported here instead of on a keyframe_applied event that never fires.
      ...(keyframeCount > 0 && { keyframeCount }),
      kind: 'edit_applied',
      prompt: editId === undefined ? undefined : edits[editId]?.editPrompt,
    }
  }

  // An applying diff also carries set_edit_hidden ops, so this only runs for a
  // standalone hide/unhide, which carries exactly one op today.
  const hiddenOp = diff.ops.find((op) => op.type === 'set_edit_hidden')
  if (hiddenOp) {
    return {
      createdAt: diff.createdAt,
      diffId: diff.id,
      editId: hiddenOp.editId,
      kind: hiddenOp.hidden ? 'edit_hidden' : 'edit_unhidden',
      prompt: edits[hiddenOp.editId]?.editPrompt,
    }
  }

  if (keyframeCount > 0) {
    return {
      createdAt: diff.createdAt,
      diffId: diff.id,
      keyframeCount,
      kind: 'keyframe_applied',
    }
  }
  return undefined
}
