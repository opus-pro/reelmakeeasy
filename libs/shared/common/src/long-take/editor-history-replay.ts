// Long-take editor undo/redo patch shapes and the pure replay primitives that
// turn a base editor state plus a snapshot stack back into a working state.
//
// These live in @reelmakeeasy/common (rather than apps/web) so both the web editor and
// the backend can replay a stored editor draft. The backend uses them to
// migrate a legacy editor draft (LongTakeEditorDraft.snapshots, persisted
// verbatim) into the new inpaint editor's initial history on first open.

import type { LongTakeEditorState, LongTakeTransition } from '@shared/types/api/long-take'

export type KeyframeFrameRole = 'firstFrame' | 'lastFrame'

export type KeyframePatch = {
  action: 'keyframe_regen'
  frameRole: KeyframeFrameRole
  next: { keyframeUrl: string; thumbnailUrl?: string }
  prev: { keyframeUrl: string; thumbnailUrl?: string }
  transitionId: string
}

export interface LongTakeSnapshot {
  description?: string
  id: string
  patch: KeyframePatch | TransitionPatch
  timestamp: number
}

export type PatchDirection = 'next' | 'prev'

export type TransitionPatch = {
  action: 'transition_regen'
  next: LongTakeTransition[]
  prev: LongTakeTransition[]
  transitionIds: string[]
}

export interface TransitionTopology {
  byId: ReadonlyMap<string, LongTakeTransition>
  nextTransitionIdById: ReadonlyMap<string, string>
  previousTransitionIdById: ReadonlyMap<string, string>
}

type KeyframePatchValue = KeyframePatch['next']

// Replay a snapshot stack onto a base state, applying each patch in the 'next'
// (redo) direction, to reproduce the working state the snapshots described.
export function applyPatchToState(
  state: LongTakeEditorState,
  patch: KeyframePatch | TransitionPatch,
  direction: PatchDirection,
): LongTakeEditorState {
  if (patch.action === 'transition_regen') {
    return applyTransitionPatch(state, patch, direction)
  }

  const topology = buildTransitionTopology(state.transitions)
  const keyframeId = resolveKeyframeIdForFrameRole(topology, patch.transitionId, patch.frameRole)
  if (!keyframeId) {
    return state
  }

  return buildKeyframeValuePatchState(state, keyframeId, patch[direction])
}

export function buildKeyframeValuePatchState(
  state: LongTakeEditorState,
  keyframeId: string,
  value: KeyframePatchValue,
): LongTakeEditorState {
  return {
    ...state,
    keyframes: state.keyframes.map((keyframe) =>
      keyframe.shotId === keyframeId
        ? { ...keyframe, keyframeUrl: value.keyframeUrl, thumbnailUrl: value.thumbnailUrl }
        : keyframe,
    ),
  }
}

export function buildTransitionTopology(transitions: LongTakeTransition[]): TransitionTopology {
  const byId = new Map(transitions.map((transition) => [transition.transitionId, transition]))
  const transitionIdByFromShotId = new Map(
    transitions.map((transition) => [transition.fromShotId, transition.transitionId]),
  )
  const transitionIdByToShotId = new Map(
    transitions.map((transition) => [transition.toShotId, transition.transitionId]),
  )

  const previousTransitionIdById = new Map<string, string>()
  const nextTransitionIdById = new Map<string, string>()

  for (const transition of transitions) {
    const previousTransitionId = transitionIdByToShotId.get(transition.fromShotId)
    if (previousTransitionId) {
      previousTransitionIdById.set(transition.transitionId, previousTransitionId)
    }

    const nextTransitionId = transitionIdByFromShotId.get(transition.toShotId)
    if (nextTransitionId) {
      nextTransitionIdById.set(transition.transitionId, nextTransitionId)
    }
  }

  return {
    byId,
    nextTransitionIdById,
    previousTransitionIdById,
  }
}

export function clearLipSyncPreviewVariant(transition: LongTakeTransition): LongTakeTransition {
  const next = { ...transition }
  delete next.baseVideoUri
  delete next.lipSyncEnabled
  delete next.lipSyncVideoUri
  return next
}

export function replaySnapshots(
  baseState: LongTakeEditorState,
  snapshots: LongTakeSnapshot[],
): LongTakeEditorState {
  return snapshots.reduce(
    (state, snapshot) => applyPatchToState(state, snapshot.patch, 'next'),
    baseState,
  )
}

export function resolveKeyframeIdForFrameRole(
  topology: TransitionTopology,
  transitionId: string,
  frameRole: KeyframeFrameRole,
): null | string {
  const transition = topology.byId.get(transitionId)
  if (!transition) {
    return null
  }

  return frameRole === 'firstFrame' ? transition.fromShotId : transition.toShotId
}

function applyTransitionPatch(
  state: LongTakeEditorState,
  patch: TransitionPatch,
  direction: PatchDirection,
): LongTakeEditorState {
  const ids = new Set(patch.transitionIds)
  const valueMap = new Map(
    patch[direction].map((transition) => [transition.transitionId, transition]),
  )
  return {
    ...state,
    transitions: state.transitions.map((transition) =>
      ids.has(transition.transitionId)
        ? { ...clearLipSyncPreviewVariant(transition), ...valueMap.get(transition.transitionId) }
        : transition,
    ),
  }
}
