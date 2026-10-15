import { randomUUID } from 'node:crypto'

import { makeHistoryDiff } from '@reelmakeeasy/common/inpaint/history'
import type { InpaintHistoryData, Op } from '@reelmakeeasy/common/inpaint/types'
import {
  type LongTakeSnapshot,
  replaySnapshots,
} from '@reelmakeeasy/common/long-take/editor-history-replay'
import { buildLongTakeEditorRevision } from '@reelmakeeasy/common/long-take/editor-state'
import { asStoreUri } from '@reelmakeeasy/common/storage/address'
import type {
  LongTakeEditorDraft,
  LongTakeEditorState,
  LongTakeKeyframe,
  LongTakeTransition,
} from '@shared/types/api/long-take'

// One-time, lazy migration of a legacy long-take editor draft into the new
// inpaint editor's initial history.
//
// The old story-mode editor (StorySequencer / StorySequencerV2) persists
// accepted-but-unrendered keyframe/transition regenerations as a snapshot stack
// in storage (LongTakeEditorDraft.snapshots). Those results never reach the canonical
// base files (long_take/transition_videos.json, keyframes.json) until a render,
// and the new inpaint editor reads only those base files. So an old project's
// pending regenerations would silently disappear when it first opens in the new
// editor. This replays the draft and bakes the result into one inpaint history
// diff so that work survives the cutover.

interface MigrateArgs {
  // The empty base history the inpaint editor would otherwise start from. Its
  // base.id is reused as the migration diff's parent.
  baseHistory: InpaintHistoryData
  // The legacy draft read from storage, or null when absent.
  draft: LongTakeEditorDraft | null
  // Canonical base keyframes/transitions (the same ones seeded into baseHistory),
  // used both for the compatibility check and as the replay starting point.
  keyframes: LongTakeKeyframe[]
  transitions: LongTakeTransition[]
}

// 'migrated' carries the history with a single migration diff appended. 'none' is
// "nothing to migrate" (no draft, or the replay produced no effective change) -
// start from the empty base, no loss to report. 'dropped' is a real loss: the draft
// existed but its base revision no longer matches the canonical base, so it could
// not be replayed and the user's pending edits are gone.
export type LegacyDraftMigrationResult =
  | { history: InpaintHistoryData; status: 'migrated' }
  | { status: 'dropped' }
  | { status: 'none' }

// This is pure and may THROW on a schema-drifted / unreplayable draft. The
// caller (InpaintService.buildInitialHistory) wraps it in try/catch so a bad
// draft is logged and falls back to the empty base rather than wedging editor
// init - keeping the failure observable instead of silently swallowed here.
export function migrateLegacyDraftToInpaintHistory(args: MigrateArgs): LegacyDraftMigrationResult {
  const { baseHistory, draft, keyframes, transitions } = args
  // workingState is authoritative on its own: after >30 edits then undo-all, the
  // uncapped early edits live only in workingState with an empty undo stack, so
  // an empty snapshots array is not "nothing to migrate" when workingState exists.
  const hasSnapshots = Boolean(
    draft && Array.isArray(draft.snapshots) && draft.snapshots.length > 0,
  )
  if (!draft || (!draft.workingState && !hasSnapshots)) {
    return { status: 'none' }
  }

  const baseEditorState: LongTakeEditorState = { keyframes, transitions }

  // Compatibility gate: the snapshot stack was built on a specific editor
  // revision. Only adopt it when that revision still matches the canonical
  // base, otherwise the patches may not replay cleanly. Mirrors the web
  // editor's discard-on-mismatch behavior (initializeHistoryAtom).
  if (buildLongTakeEditorRevision(baseEditorState) !== draft.baseRevision) {
    return { status: 'dropped' }
  }

  const finalState =
    draft.workingState ?? replaySnapshots(baseEditorState, draft.snapshots as LongTakeSnapshot[])
  const ops = buildMigrationOps(baseEditorState, finalState)
  if (ops.length === 0) {
    return { status: 'none' }
  }

  const diff = makeHistoryDiff(randomUUID(), baseHistory.base.id, ops)
  return {
    history: {
      ...baseHistory,
      currentId: diff.id,
      diffs: { ...baseHistory.diffs, [diff.id]: diff },
      latestId: diff.id,
    },
    status: 'migrated',
  }
}

// Diff the replayed working state against the base, emitting one op per changed
// transition video / keyframe. Matches the op shapes the inpaint apply handler
// produces (apply_transition carries the URL directly; apply_keyframe carries the
// full keyframe), so applyOps reproduces finalState exactly. All URIs are stored
// as store:// (canonical); the comparison is also done in store:// space so a file that
// only differs by URL form (cdn vs gs) is not mistaken for a change.
function buildMigrationOps(base: LongTakeEditorState, final: LongTakeEditorState): Op[] {
  const ops: Op[] = []

  const baseTransitionById = new Map(base.transitions.map((t) => [t.transitionId, t]))
  for (const transition of final.transitions) {
    const baseTransition = baseTransitionById.get(transition.transitionId)
    const videoUri = asStoreUri(transition.videoUri)
    if (baseTransition && asStoreUri(baseTransition.videoUri) !== videoUri) {
      ops.push({
        transitionId: transition.transitionId,
        type: 'apply_transition',
        videoUri,
      })
    }
  }

  const baseKeyframeByShotId = new Map(base.keyframes.map((k) => [k.shotId, k]))
  for (const keyframe of final.keyframes) {
    const baseKeyframe = baseKeyframeByShotId.get(keyframe.shotId)
    const keyframeUrl = asStoreUri(keyframe.keyframeUrl)
    const thumbnailUrl = asStoreUri(keyframe.thumbnailUrl)
    if (
      baseKeyframe &&
      (asStoreUri(baseKeyframe.keyframeUrl) !== keyframeUrl ||
        asStoreUri(baseKeyframe.thumbnailUrl) !== thumbnailUrl)
    ) {
      ops.push({ keyframe: { ...keyframe, keyframeUrl, thumbnailUrl }, type: 'apply_keyframe' })
    }
  }

  return ops
}
