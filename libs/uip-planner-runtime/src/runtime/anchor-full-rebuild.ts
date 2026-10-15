import { collectTargetAnchorIds } from '../tool-internals/anchor-plan'
import type { PlannerToolParams, SessionState } from '../types'

import type { ToolCallResult } from './runtime.types'
import type { SharedArtifactBatchContext } from './shared-artifact-batch-context'

export function findMissingStyleRefreshAnchorIds(params: {
  plannerParams: PlannerToolParams
  session: SessionState
}): string[] {
  if (
    params.plannerParams.scope !== 'ANCHOR_IDS' ||
    !hasActiveStyleAnchorRecovery(params.session)
  ) {
    return []
  }
  const removedAnchorIds = new Set(
    (params.plannerParams.anchor_requests ?? [])
      .filter((request) => request.operation === 'REMOVE_ANCHOR')
      .map((request) => request.anchor_id),
  )
  const targetedAnchorIds = collectTargetAnchorIds(params.plannerParams)
  return (params.session.cached_artifacts.anchor_plan?.candidates ?? [])
    .map((candidate) => candidate.anchor_id)
    .filter((anchorId) => !removedAnchorIds.has(anchorId) && !targetedAnchorIds.has(anchorId))
}

export function guardAnchorConsistencyScope(params: {
  plannerParams: PlannerToolParams
  session: SessionState
  sharedBatchContext: null | SharedArtifactBatchContext
}): null | ToolCallResult {
  if (
    params.plannerParams.scope !== 'FULL' ||
    params.session.todo_state.phase === 'bootstrap_visual' ||
    isAuthorizedRefinementFullAnchorRebuild(params)
  ) {
    const missingStyleAnchorIds = findMissingStyleRefreshAnchorIds(params)
    return missingStyleAnchorIds.length === 0
      ? null
      : {
          ok: false,
          code: 'INVALID_INPUT',
          retryable: false,
          message: `A style consistency refresh must regenerate every current anchor_id in one ANCHOR_IDS call; missing: ${missingStyleAnchorIds.join(', ')}.`,
        }
  }
  return {
    ok: false,
    code: 'INVALID_INPUT',
    retryable: false,
    message:
      'generate_anchor_assets with scope=FULL outside bootstrap_visual requires an active FULL anchor consistency entry and a paired FULL visual-script rebuild.',
  }
}

export function hasActiveFullAnchorRecovery(session: SessionState): boolean {
  return (
    session.spec.meta?.stale_artifacts?.some(
      (entry) =>
        entry.artifact === 'anchor_bindings' &&
        entry.required_params?.scope === 'FULL' &&
        !entry.dismissed_at,
    ) === true
  )
}

export function isAuthorizedRefinementFullAnchorRebuild(params: {
  plannerParams: PlannerToolParams
  session: SessionState
  sharedBatchContext: null | SharedArtifactBatchContext
}): boolean {
  return (
    params.plannerParams.scope === 'FULL' &&
    params.session.todo_state.phase === 'refinement' &&
    hasActiveFullAnchorRecovery(params.session) &&
    params.sharedBatchContext?.forceFreshAnchorPlan === true
  )
}

function hasActiveStyleAnchorRecovery(session: SessionState): boolean {
  return (
    session.spec.meta?.stale_artifacts?.some(
      (entry) =>
        entry.artifact === 'anchor_bindings' &&
        entry.source_path === 'global_constraints.style' &&
        !entry.dismissed_at,
    ) === true
  )
}
