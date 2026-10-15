import {
  applyPatchToState,
  buildKeyframeValuePatchState,
  buildTransitionTopology,
  clearLipSyncPreviewVariant,
  type KeyframeFrameRole,
  type KeyframePatch,
  type LongTakeSnapshot,
  replaySnapshots as replaySnapshotsImpl,
  resolveKeyframeIdForFrameRole,
  type TransitionTopology,
} from '@reelmakeeasy/common/long-take/editor-history-replay'
import { storeUriToUrl } from '@reelmakeeasy/common/storage/address'
import type {
  LongTakeEditorState,
  LongTakeTransition,
  TransitionRegenWorkflowResult,
} from '@shared/types/api/long-take'

// The patch/snapshot types and the pure replay primitives now live in
// @reelmakeeasy/common so the backend can replay a stored draft. Re-export them here so
// existing in-app imports from this module keep resolving unchanged.
export { applyPatchToState, buildTransitionTopology }
export type { TransitionTopology }

export interface TransitionRegenerateContext {
  affectedTransitionIds: string[]
  body: {
    prompt: string
    transitionList: Array<{
      firstFrameUrl: string
      lastFrameUrl: string
      transitionId: string
    }>
  }
}

export function applyKeyframeEditToState(
  state: LongTakeEditorState,
  input: {
    frameRole: KeyframeFrameRole
    keyframeUrl: string
    thumbnailUrl?: string
    transitionId: string
  },
): null | { nextState: LongTakeEditorState; patch: KeyframePatch } {
  const topology = buildTransitionTopology(state.transitions)
  const target = findKeyframeEditTarget(state, topology, input.transitionId, input.frameRole)
  if (!target) {
    return null
  }

  return {
    nextState: buildKeyframeValuePatchState(state, target.keyframeId, {
      keyframeUrl: input.keyframeUrl,
      thumbnailUrl: input.thumbnailUrl,
    }),
    patch: {
      action: 'keyframe_regen',
      frameRole: input.frameRole,
      next: {
        keyframeUrl: input.keyframeUrl,
        thumbnailUrl: input.thumbnailUrl,
      },
      prev: {
        keyframeUrl: target.prevKeyframe.keyframeUrl,
        thumbnailUrl: target.prevKeyframe.thumbnailUrl ?? undefined,
      },
      transitionId: input.transitionId,
    },
  }
}

export function buildTransitionRegenerateContext(
  historyPast: LongTakeSnapshot[],
  workingState: LongTakeEditorState | null,
  prompt: string,
  transitionId: string,
): null | TransitionRegenerateContext {
  if (!workingState) {
    return null
  }

  const topology = buildTransitionTopology(workingState.transitions)
  if (!topology.byId.has(transitionId)) {
    return null
  }

  const workingKeyframeUrls = buildKeyframeUrlMap(workingState)
  const pendingFrameRoles = getPendingFrameRolesForTransition(historyPast, topology, transitionId)
  const affectedTransitionIds = new Set<string>([transitionId])

  for (const frameRole of pendingFrameRoles) {
    for (const affectedTransitionId of getAffectedTransitionIds(
      topology,
      transitionId,
      frameRole,
    )) {
      affectedTransitionIds.add(affectedTransitionId)
    }
  }

  const transitionList: TransitionRegenerateContext['body']['transitionList'] = []
  for (const id of affectedTransitionIds) {
    const transition = topology.byId.get(id)
    if (!transition) {
      return null
    }
    const firstFrameUrl = workingKeyframeUrls.get(transition.fromShotId)
    const lastFrameUrl = workingKeyframeUrls.get(transition.toShotId)
    if (!firstFrameUrl || !lastFrameUrl) {
      return null
    }
    transitionList.push({ transitionId: id, firstFrameUrl, lastFrameUrl })
  }

  return {
    affectedTransitionIds: [...affectedTransitionIds],
    body: { prompt, transitionList },
  }
}

export function buildUpdatedTransitionsFromWorkflowResults(
  currentState: LongTakeEditorState,
  affectedIds: string[],
  workflowResults: TransitionRegenWorkflowResult[],
): LongTakeTransition[] | null {
  const resultsById = new Map(workflowResults.map((result) => [result.transitionId, result]))
  const updated: LongTakeTransition[] = []

  for (const transitionId of affectedIds) {
    const result = resultsById.get(transitionId)
    if (!result) {
      return null
    }

    const transition = currentState.transitions.find((item) => item.transitionId === transitionId)
    if (!transition) {
      return null
    }

    updated.push({
      ...clearLipSyncPreviewVariant(transition),
      videoUri: storeUriToUrl(result.fileUri),
      videoWidth: result.videoWidth,
      videoHeight: result.videoHeight,
    })
  }

  return updated
}

export function computeStaleTransitionIds(
  historyPast: LongTakeSnapshot[],
  topology: TransitionTopology,
): Set<string> {
  const staleIds = new Set<string>()

  for (const { patch } of historyPast) {
    if (patch.action === 'transition_regen') {
      for (const transitionId of patch.transitionIds) {
        staleIds.delete(transitionId)
      }
      continue
    }

    for (const transitionId of getAffectedTransitionIds(
      topology,
      patch.transitionId,
      patch.frameRole,
    )) {
      staleIds.add(transitionId)
    }
  }

  return staleIds
}

export function getAffectedTransitionIds(
  topology: TransitionTopology,
  transitionId: string,
  frameRole: KeyframeFrameRole,
): string[] {
  if (!topology.byId.has(transitionId)) {
    return []
  }

  const affectedIds = new Set<string>([transitionId])
  const adjacentTransitionId =
    frameRole === 'firstFrame'
      ? topology.previousTransitionIdById.get(transitionId)
      : topology.nextTransitionIdById.get(transitionId)

  if (adjacentTransitionId) {
    affectedIds.add(adjacentTransitionId)
  }

  return [...affectedIds]
}

export function getMaskedKeyframeIds(
  topology: TransitionTopology,
  staleTransitionIds: Set<string>,
): Set<string> {
  const keyframeIds = new Set<string>()

  for (const transitionId of staleTransitionIds) {
    const keyframeId = resolveKeyframeIdForFrameRole(topology, transitionId, 'firstFrame')
    if (keyframeId) {
      keyframeIds.add(keyframeId)
    }
  }

  return keyframeIds
}

export function getPendingFrameRolesForTransition(
  historyPast: LongTakeSnapshot[],
  topology: TransitionTopology,
  transitionId: string,
): KeyframeFrameRole[] {
  if (!topology.byId.has(transitionId)) {
    return []
  }

  const pendingFrameRoles: KeyframeFrameRole[] = []
  if (isFrameRolePending(historyPast, topology, transitionId, 'firstFrame')) {
    pendingFrameRoles.push('firstFrame')
  }
  if (isFrameRolePending(historyPast, topology, transitionId, 'lastFrame')) {
    pendingFrameRoles.push('lastFrame')
  }
  return pendingFrameRoles
}

export function hasRenderRelevantChanges(
  baseState: LongTakeEditorState | null,
  workingState: LongTakeEditorState | null,
): boolean {
  if (!baseState || !workingState) {
    return false
  }

  if (baseState.keyframes.length !== workingState.keyframes.length) {
    return true
  }

  const baseKeyframeUrls = buildKeyframeUrlMap(baseState)
  for (const keyframe of workingState.keyframes) {
    if (baseKeyframeUrls.get(keyframe.shotId) !== keyframe.keyframeUrl) {
      return true
    }
  }

  if (baseState.transitions.length !== workingState.transitions.length) {
    return true
  }

  const baseTransitionsById = new Map(
    baseState.transitions.map((transition) => [transition.transitionId, transition]),
  )
  for (const transition of workingState.transitions) {
    if (baseTransitionsById.get(transition.transitionId)?.videoUri !== transition.videoUri) {
      return true
    }
  }

  return false
}

export function mergeRegeneratedTransitionsIntoState(
  currentState: LongTakeEditorState,
  nextTransitions: LongTakeTransition[],
): LongTakeEditorState {
  return mergeTransitionsIntoState(currentState, nextTransitions)
}

// A thin wrapper over the shared impl (not a bare re-export) so it stays an own
// property on this module, which keeps jest.spyOn(module, 'replaySnapshots')
// working for callers that mock the replay step (the store's replay-failure
// fallback test).
export function replaySnapshots(
  baseState: LongTakeEditorState,
  snapshots: LongTakeSnapshot[],
): LongTakeEditorState {
  return replaySnapshotsImpl(baseState, snapshots)
}

function buildKeyframeUrlMap(state: LongTakeEditorState): Map<string, string> {
  return new Map(state.keyframes.map((keyframe) => [keyframe.shotId, keyframe.keyframeUrl]))
}

function findKeyframeEditTarget(
  state: LongTakeEditorState,
  topology: TransitionTopology,
  transitionId: string,
  frameRole: KeyframeFrameRole,
): null | {
  keyframeId: string
  prevKeyframe: LongTakeEditorState['keyframes'][number]
} {
  const keyframeId = resolveKeyframeIdForFrameRole(topology, transitionId, frameRole)
  if (!keyframeId) {
    return null
  }

  const prevKeyframe = state.keyframes.find((keyframe) => keyframe.shotId === keyframeId)
  if (!prevKeyframe) {
    return null
  }

  return { keyframeId, prevKeyframe }
}

function isFrameRolePending(
  historyPast: LongTakeSnapshot[],
  topology: TransitionTopology,
  transitionId: string,
  frameRole: KeyframeFrameRole,
): boolean {
  const adjacentTransitionId =
    frameRole === 'firstFrame'
      ? topology.previousTransitionIdById.get(transitionId)
      : topology.nextTransitionIdById.get(transitionId)
  const adjacentFrameRole: KeyframeFrameRole =
    frameRole === 'firstFrame' ? 'lastFrame' : 'firstFrame'

  for (let i = historyPast.length - 1; i >= 0; i -= 1) {
    const { patch } = historyPast[i]

    if (patch.action === 'transition_regen') {
      if (patch.transitionIds.includes(transitionId)) {
        return false
      }
      continue
    }

    if (patch.transitionId === transitionId && patch.frameRole === frameRole) {
      return true
    }

    if (patch.transitionId === adjacentTransitionId && patch.frameRole === adjacentFrameRole) {
      return true
    }
  }

  return false
}

function mergeTransitionsIntoState(
  state: LongTakeEditorState,
  transitions: LongTakeTransition[],
): LongTakeEditorState {
  if (transitions.length === 0) {
    return state
  }

  const nextMap = new Map(transitions.map((transition) => [transition.transitionId, transition]))

  return {
    ...state,
    transitions: state.transitions.map((transition) => {
      const next = nextMap.get(transition.transitionId)
      return next ? { ...clearLipSyncPreviewVariant(transition), ...next } : transition
    }),
  }
}
