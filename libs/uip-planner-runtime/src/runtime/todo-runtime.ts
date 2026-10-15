import { createSubLogger } from '@reelmakeeasy/common/logger'

import { getRecipeStageByTool, RecipeStageId } from '../recipe'
import { PlannerToolCall, SessionState } from '../types'

import { plannerLog } from './planner-log'
import {
  getScriptSource,
  getUndescribedUploadedAssets,
  hasGlobalConstraintsArtifact,
} from './session-runtime'

const logger = createSubLogger('user-intent-planner')

export function bootstrapStageIds(session: SessionState): RecipeStageId[] {
  const hasUploadedAssets = (session.cached_artifacts.uploaded_assets?.length ?? 0) > 0
  const phase = session.todo_state.phase
  const scriptStages: RecipeStageId[] = hasUploadedAssets
    ? ['t0_assets', 't1_intent_context', 't2_script']
    : ['t1_intent_context', 't2_script']
  const visualStages: RecipeStageId[] = ['t4_anchor_assets', 't3_vs']

  if (phase === 'bootstrap_visual') {
    return visualStages
  }

  if (phase === 'bootstrap_script') {
    return scriptStages
  }

  // The bootstrap_brand phase has a single stage that the workflow's child
  // BrandExtractionWorkflow completes -- the planner does NOT dispatch a
  // tool here. We surface the stage so todo hydration / pendingTodoCount /
  // shouldStopPlannerLoop behave the same as the other bootstrap phases.
  // When `brand_extraction_input` is null the phase is reachable only by
  // misroute; return [] so completion checks bail without firing.
  if (phase === 'bootstrap_brand') {
    return session.spec.global_constraints.brand_extraction_input ? ['t_brand'] : []
  }

  return []
}

export function bootstrapTodoItemsFromArtifacts(
  session: SessionState,
): Array<{ id: string; status: 'done' | 'pending'; title: string }> {
  return bootstrapStageIds(session).map((stageId) => ({
    id: stageId,
    title: getBootstrapStageTitle(stageId),
    status: isBootstrapStageComplete(session, stageId) ? 'done' : 'pending',
  }))
}

export function getBootstrapStageTitle(stageId: RecipeStageId): string {
  switch (stageId) {
    case 't0_assets': {
      return 'Describe uploaded assets'
    }
    case 't1_intent_context': {
      return 'Build intent context'
    }
    case 't2_script': {
      return 'Generate script'
    }
    case 't3_vs': {
      return 'Generate visual script'
    }
    case 't4_anchor_assets': {
      return 'Generate anchor assets'
    }
    case 't_brand': {
      return 'Extract brand profile'
    }
    default: {
      return stageId
    }
  }
}

export function getPendingTodoCount(session: SessionState): number {
  return session.todo_state.items.filter((item) => item.status === 'pending').length
}

export function getTodoAliasesForStage(stageId: RecipeStageId): string[] {
  switch (stageId) {
    case 't0_assets': {
      return ['t0', 't0_assets', 't_assets']
    }
    case 't1_intent_context': {
      return ['t1', 't1_intent_context']
    }
    case 't2_script': {
      return ['t2', 't2_script']
    }
    case 't3_vs': {
      return ['t3', 't3_vs']
    }
    case 't4_anchor_assets': {
      return ['t4', 't4_anchor_assets']
    }
    case 't_brand': {
      return ['t_brand']
    }
    default: {
      return [stageId]
    }
  }
}

export function getTodoStatusByStage(
  session: SessionState,
  stageId: RecipeStageId,
): 'done' | 'pending' {
  const aliases = getTodoAliasesForStage(stageId)
  const matchingItems = session.todo_state.items.filter((item) => aliases.includes(item.id))
  if (matchingItems.length === 0) {
    return 'pending'
  }

  return matchingItems.some((item) => item.status === 'pending') ? 'pending' : 'done'
}

export function hasPendingTodoItems(session: SessionState): boolean {
  return getPendingTodoCount(session) > 0
}

export function hydrateBootstrapTodoFromArtifacts(session: SessionState): boolean {
  if (!isBootstrapDraftPhase(session)) {
    return false
  }

  const expectedStageIds = bootstrapStageIds(session)
  const actualIds = session.todo_state.items.map((item) => item.id)
  const expectedIdSet = new Set(expectedStageIds)
  const hasAllExpectedStages = expectedStageIds.every((stageId) => todoHasStage(session, stageId))
  const hasOnlyExpectedStages =
    actualIds.length === expectedStageIds.length &&
    actualIds.every((stageId) => expectedIdSet.has(stageId as RecipeStageId))
  const hasNoItems = session.todo_state.items.length === 0
  const hasStatusMismatch = expectedStageIds.some((stageId) => {
    const expectedStatus = isBootstrapStageComplete(session, stageId) ? 'done' : 'pending'
    const actualStatus = getTodoStatusByStage(session, stageId)
    return actualStatus !== expectedStatus
  })

  if (!hasNoItems && hasAllExpectedStages && hasOnlyExpectedStages && !hasStatusMismatch) {
    return false
  }

  const before = session.todo_state.items.map((item) => `${item.id}:${item.status}`).join(',')
  session.todo_state.items = bootstrapTodoItemsFromArtifacts(session)
  const after = session.todo_state.items.map((item) => `${item.id}:${item.status}`).join(',')
  logger.info(
    plannerLog(session.sessionId, '[todo.hydrate] hydrated bootstrap todo from artifacts', {
      before,
      after,
    }),
  )
  return true
}

export function isBootstrapArtifactsComplete(session: SessionState): boolean {
  const stageIds = bootstrapStageIds(session)
  return (
    stageIds.length > 0 && stageIds.every((stageId) => isBootstrapStageComplete(session, stageId))
  )
}

export function isBootstrapDraftPhase(session: SessionState): boolean {
  return (
    session.todo_state.phase === 'bootstrap_brand' ||
    session.todo_state.phase === 'bootstrap_script' ||
    session.todo_state.phase === 'bootstrap_visual'
  )
}

export function isBootstrapStageComplete(session: SessionState, stageId: RecipeStageId): boolean {
  switch (stageId) {
    case 't0_assets': {
      return getUndescribedUploadedAssets(session).length === 0
    }
    case 't1_intent_context': {
      return hasGlobalConstraintsArtifact(session)
    }
    case 't2_script': {
      return Boolean(getScriptSource(session))
    }
    case 't3_vs': {
      return session.spec.visual_script.shots.length > 0
    }
    case 't4_anchor_assets': {
      // Mirror advanceBootstrapVisual's per-arm anchor.ok, which
      // is false iff any anchor status==='failed' (tool-runtime buildAnchorOutcome).
      // A 'partial' summary can mean EITHER some anchors failed (anchor.ok=false) OR
      // some are only not-yet-ready/planned with no failures (anchor.ok=true), so the
      // old status-in-{success,partial} check disagreed with the phase gate on the
      // failed-partial case: the phase holds on anchor.ok=false, but t4 read done, so
      // the planner is stranded with a "done" anchor stage it never reruns (parks /
      // gives up instead of repairing). Gate on "no failed anchor" so a failed-partial
      // keeps t4 pending (planner reruns the failed anchors); a planned-only partial
      // still completes, matching anchor.ok.
      const summary = session.cached_artifacts.anchor_assets_summary
      return summary !== undefined && summary.anchors.every((a) => a.status !== 'failed')
    }
    case 't_brand': {
      // Source of truth: workflow-owned brand_extraction_status. Both
      // 'completed' and 'locked' read as "extracted" -- locked is a
      // later terminal state but is allowed here so a session
      // restarted post-lock still sees the stage as done.
      const status = session.spec.global_constraints.brand_extraction_status
      return status === 'completed' || status === 'locked'
    }
    default: {
      return false
    }
  }
}

export function markTodoStageDoneByTool(
  session: SessionState,
  tool: PlannerToolCall['tool'],
): void {
  if (!isBootstrapDraftPhase(session)) {
    logger.info(
      plannerLog(session.sessionId, '[todo.runtime_done.skip_non_bootstrap]', {
        phase: session.todo_state.phase,
        tool,
      }),
    )
    return
  }

  const stageId = getRecipeStageByTool(tool).id
  const aliases = getTodoAliasesForStage(stageId)
  const matchingItems = session.todo_state.items.filter((item) => aliases.includes(item.id))

  if (matchingItems.length > 0) {
    for (const item of matchingItems) {
      item.status = 'done'
    }
    logger.info(
      plannerLog(session.sessionId, '[todo.runtime_done]', {
        stageId,
        tool,
        updatedExisting: true,
      }),
    )
    return
  }

  session.todo_state.items.push({
    id: stageId,
    title: getBootstrapStageTitle(stageId),
    status: 'done',
  })
  logger.info(
    plannerLog(session.sessionId, '[todo.runtime_done]', {
      addedNew: true,
      stageId,
      tool,
    }),
  )
}

export function todoHasStage(session: SessionState, stageId: RecipeStageId): boolean {
  const aliases = getTodoAliasesForStage(stageId)
  return session.todo_state.items.some((item) => aliases.includes(item.id))
}
