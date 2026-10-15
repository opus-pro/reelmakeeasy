import type { SessionState } from '../types'

import {
  findMissingStyleRefreshAnchorIds,
  hasActiveFullAnchorRecovery,
} from './anchor-full-rebuild'
import type { PlannerOutputLike } from './runtime.types'

export function checkRefinementFullAnchorBatch(
  session: SessionState,
  visualTool: NonNullable<PlannerOutputLike['tool_calls']>[number],
  anchorTool: NonNullable<PlannerOutputLike['tool_calls']>[number],
): null | string | undefined {
  if (anchorTool.params.scope !== 'FULL') {
    return undefined
  }
  if (visualTool.params.scope !== 'FULL') {
    return 'refinement FULL anchor recovery requires FULL scope for both tool calls.'
  }
  if (visualTool.params.refresh_world_bible === true) {
    return 'refinement FULL anchor recovery cannot refresh_world_bible in the same atomic batch.'
  }
  if (!hasActiveFullAnchorRecovery(session)) {
    return 'refinement FULL anchor recovery requires an active anchor_bindings consistency entry with required_params.scope=FULL.'
  }
  return null
}

function checkRefinementFullAnchorRebuild(
  session: SessionState,
  output: PlannerOutputLike,
): null | string {
  if (output.action !== 'TOOL_CALLS' || session.todo_state.phase !== 'refinement') {
    return null
  }
  const anchorCall = (output.tool_calls ?? []).find(
    (toolCall) => toolCall.tool === 'generate_anchor_assets',
  )
  if (anchorCall?.params.scope !== 'FULL') {
    return null
  }
  const pairedFullVs = (output.tool_calls ?? []).some(
    (toolCall) =>
      toolCall.tool === 'generate_explainer_visual_script' && toolCall.params.scope === 'FULL',
  )
  // The two-tool validator owns batch shape and stale-entry checks so it can
  // preserve the more actionable shared_batch_key error ordering.
  if (pairedFullVs) {
    return null
  }
  return (
    'refinement generate_anchor_assets(scope=FULL) is reserved for an active FULL anchor ' +
    'consistency recovery and must run in the same shared batch as ' +
    'generate_explainer_visual_script(scope=FULL).'
  )
}

function checkStyleAnchorRefresh(session: SessionState, output: PlannerOutputLike): null | string {
  if (output.action !== 'TOOL_CALLS') {
    return null
  }
  const anchorCall = (output.tool_calls ?? []).find(
    (toolCall) => toolCall.tool === 'generate_anchor_assets',
  )
  if (!anchorCall) {
    return null
  }
  const missing = findMissingStyleRefreshAnchorIds({
    plannerParams: anchorCall.params,
    session,
  })
  return missing.length === 0
    ? null
    : `A style consistency refresh must regenerate every current anchor_id in one ANCHOR_IDS call; missing: ${missing.join(', ')}.`
}

/**
 * Guard against new-anchor UPSERT being emitted without a paired follow-on
 * (plan_asset_assignment OR generate_explainer_visual_script). New anchors
 * without a follow-on land in the spec but no shot.pre_selected_assets
 * references them -- orphan asset, user-visible bug.
 *
 * Two valid pair shapes per Section 7.2 anchor downstream matrix:
 *   - bind + propagate: VS tool in the SAME TOOL_CALLS batch (any scope)
 *   - bind + assign: pending plan_asset_assignment directive in todo_snapshot
 *
 * Existing-anchor rebind (anchor_id already in candidates) is exempt:
 * existing shot references auto-resolve to the new source.
 *
 * REMOVE_ANCHOR is exempt: runtime deterministically clears shot bindings
 * via maybeApplyDeterministicAnchorRemovalCleanup.
 *
 * Mirror of the audio-mode duration guard pattern.
 */
export function checkNewAnchorUpsertHasPairedFollowOn(
  session: SessionState,
  output: PlannerOutputLike,
): null | string {
  if (output.action !== 'TOOL_CALLS') {
    return null
  }

  const toolCalls = output.tool_calls ?? []
  const anchorCall = toolCalls.find((tc) => tc.tool === 'generate_anchor_assets')
  if (!anchorCall || anchorCall.params.scope !== 'ANCHOR_IDS') {
    return null
  }

  const requests = anchorCall.params.anchor_requests ?? []
  const upsertRequests = requests.filter((r) => r.operation === 'UPSERT')
  if (upsertRequests.length === 0) {
    // All requests are REMOVE_ANCHOR; runtime cleans up bindings deterministically.
    return null
  }

  const existingAnchorIds = new Set(
    (session.cached_artifacts?.anchor_plan?.candidates ?? []).map((c) => c.anchor_id),
  )
  const newAnchorIds = upsertRequests
    .map((r) => r.anchor_id?.trim())
    .filter((id): id is string => Boolean(id) && !existingAnchorIds.has(id))
  if (newAnchorIds.length === 0) {
    // All UPSERTs target existing anchors (rebind / add ref / metadata edit).
    // bind-only is appropriate; existing shot references resolve to new source.
    return null
  }

  // Pair signal A: same TOOL_CALLS batch contains a VS tool. Per planner-contract
  // checkAllowedTwoToolBatchContract this also enforces shared_batch_key (in
  // refinement) and scope validity, so we don't need to re-check those here.
  // Any VS scope (FULL / SHOT_IDS / SHOT_RANGE) satisfies the orphan-prevention
  // goal because VS tool reads pending_anchor_plan_update_request and binds the
  // new anchor in its target shots.
  const hasPairedVsInBatch = toolCalls.some((tc) => tc.tool === 'generate_explainer_visual_script')
  if (hasPairedVsInBatch) {
    return null
  }

  // Pair signal B: pending plan_asset_assignment directive in todo_snapshot.
  // Only `pending` counts -- a `done` directive came from a prior turn and is
  // unrelated to this anchor UPSERT. Only `plan_asset_assignment` counts -- a
  // pending VS directive is a hybrid that matches neither contract (bind +
  // propagate requires VS in the SAME batch above, not deferred to next iter).
  const pendingPlanAssetAssignment = (output.todo_snapshot?.items ?? []).some(
    (item) =>
      item.status === 'pending' && item.executor_hint?.executor_tool === 'plan_asset_assignment',
  )
  if (pendingPlanAssetAssignment) {
    return null
  }

  return (
    `New anchor UPSERT for [${newAnchorIds.join(', ')}] requires a paired follow-on per ` +
    'Section 7.2 anchor downstream matrix. Choose EXACTLY one contract: ' +
    '(bind + propagate) include generate_explainer_visual_script in the SAME TOOL_CALLS ' +
    'batch with shared_batch_key, OR (bind + assign) emit a pending plan_asset_assignment ' +
    'directive in todo_snapshot for the next iteration. ' +
    'bind-only is forbidden for new anchors -- the asset would land in the spec with no ' +
    'shot referencing it (orphan). A deferred VS directive in todo_snapshot does NOT count ' +
    'as a pair -- bind+propagate must be batched, not split. If the binding intent is ' +
    'genuinely ambiguous, ASK_CLARIFY instead of emitting anchor-only.'
  )
}

/**
 * Guard against a no-op CHARACTER re-render: an UPSERT on an EXISTING character
 * anchor that carries neither an `edit_instruction` nor a source asset. The
 * anchor merge (anchor-plan.ts) falls back to the existing anchor's old
 * edit_instruction in that case, so the regeneration reproduces the SAME design
 * -- the user's requested change (e.g. "make the employee an African American
 * woman") is silently dropped because it lived only in the planner's reply, not
 * in edit_instruction. Force the planner to put
 * the change in edit_instruction (or rebind a source) so the anchor actually
 * updates. Rebinds (source set) and new anchors are exempt; REMOVE_ANCHOR is
 * exempt (only UPSERT is inspected).
 */
export function checkCharacterUpsertHasEditInstruction(
  session: SessionState,
  output: PlannerOutputLike,
): null | string {
  if (output.action !== 'TOOL_CALLS') {
    return null
  }
  const anchorCall = (output.tool_calls ?? []).find((tc) => tc.tool === 'generate_anchor_assets')
  if (!anchorCall || anchorCall.params.scope !== 'ANCHOR_IDS') {
    return null
  }
  const existingAnchorIds = new Set(
    (session.cached_artifacts?.anchor_plan?.candidates ?? []).map((c) => c.anchor_id),
  )
  const noOpCharacterIds = (anchorCall.params.anchor_requests ?? [])
    .filter((r) => {
      if (r.operation !== 'UPSERT' || r.type !== 'CHARACTER') {
        return false
      }
      const id = r.anchor_id?.trim()
      if (!id || !existingAnchorIds.has(id)) {
        return false // new anchor -> handled by the paired-follow-on guard, not here
      }
      const hasEdit = Boolean(r.edit_instruction?.trim())
      const hasSource = Boolean(r.source_asset_id?.trim() || r.source_asset_ids?.length)
      return !hasEdit && !hasSource
    })
    .map((r) => r.anchor_id?.trim())
    .filter((id): id is string => Boolean(id))
  if (noOpCharacterIds.length === 0) {
    return null
  }
  return (
    `UPSERT on existing character anchor [${noOpCharacterIds.join(', ')}] has no edit_instruction ` +
    'and no source asset, so it re-renders the SAME design (no change). To change a character ' +
    '(demographics, hair, wardrobe, styling, etc.), put the change in edit_instruction -- the ' +
    'reply text is NOT read by the anchor tool. If you genuinely meant no change, omit this ' +
    'anchor from anchor_requests.'
  )
}

/**
 * bootstrap_visual first-gen must run the anchor stage
 * alongside the visual script. A lone generate_explainer_visual_script without a
 * succeeded anchor stage can never satisfy advanceBootstrapVisual's
 * hasAnchorSuccess guard, so the phase stalls to the 3h idle timeout while the
 * storyboard's shots reference an anchor that was never generated. A
 * standalone VS is only legitimate as the recovery,
 * which by then has a success/partial anchor_assets_summary from the batch's
 * anchor arm.
 *
 * Gate on the anchor stage having actually succeeded, not on mere presence: a
 * wholly-failed anchor_vs_batch still stages a status:'failed' summary (non-null)
 * with no ready anchors, which would otherwise let a lone VS through and recreate
 * the stall. Mirror isBootstrapStageComplete's t4_anchor_assets check
 * (success/partial).
 */
export function checkBootstrapVisualFirstGenPairsAnchor(
  session: SessionState,
  output: PlannerOutputLike,
): null | string {
  if (output.action !== 'TOOL_CALLS') {
    return null
  }
  const anchorStatus = session.cached_artifacts?.anchor_assets_summary?.status
  const anchorStageSucceeded = anchorStatus === 'success' || anchorStatus === 'partial'
  const toolCalls = output.tool_calls ?? []
  if (
    session.todo_state.phase === 'bootstrap_visual' &&
    toolCalls.length === 1 &&
    toolCalls[0]?.tool === 'generate_explainer_visual_script' &&
    !anchorStageSucceeded
  ) {
    return (
      'bootstrap_visual first visual generation must batch generate_anchor_assets + ' +
      'generate_explainer_visual_script (both FULL scope); a lone visual-script is only ' +
      'allowed to recover after the anchor stage has already succeeded.'
    )
  }
  return null
}

/**
 * Mirror of checkBootstrapVisualFirstGenPairsAnchor for the anchor arm:
 * a lone generate_anchor_assets in bootstrap_visual before any visual script
 * exists is also a first-gen under-dispatch -- it produces anchors with no
 * storyboard, so the phase cannot advance (bootstrap_visual needs BOTH
 * t4_anchor_assets and t3_vs) and stalls. A lone anchor is only legitimate as a
 * recovery, once the VS has already succeeded. Mirrors isBootstrapStageComplete's
 * t3_vs check (session.spec.visual_script.shots.length > 0).
 *
 * NOTE: the anchor-stage "succeeded" signal used by the sibling guard
 * (anchor_assets_summary.status success/partial) still differs from the
 * workflow's advanceBootstrapVisual (anchor.ok); aligning those two across
 * packages is intentionally deferred to the phase-machine PR (PR-C).
 */
export function checkBootstrapVisualFirstGenPairsVs(
  session: SessionState,
  output: PlannerOutputLike,
): null | string {
  if (output.action !== 'TOOL_CALLS') {
    return null
  }
  const vsStageComplete = session.spec.visual_script.shots.length > 0
  const toolCalls = output.tool_calls ?? []
  if (
    session.todo_state.phase === 'bootstrap_visual' &&
    toolCalls.length === 1 &&
    toolCalls[0]?.tool === 'generate_anchor_assets' &&
    !vsStageComplete
  ) {
    return (
      'bootstrap_visual first visual generation must batch generate_anchor_assets + ' +
      'generate_explainer_visual_script (both FULL scope); a lone anchor is only ' +
      'allowed to recover after the visual script has already succeeded.'
    )
  }
  return null
}

/** Run all generate_anchor_assets contract guards; return the first error. */
export function checkAnchorContracts(
  session: SessionState,
  output: PlannerOutputLike,
): null | string {
  return (
    checkRefinementFullAnchorRebuild(session, output) ??
    checkStyleAnchorRefresh(session, output) ??
    checkNewAnchorUpsertHasPairedFollowOn(session, output) ??
    checkCharacterUpsertHasEditInstruction(session, output) ??
    checkBootstrapVisualFirstGenPairsAnchor(session, output) ??
    checkBootstrapVisualFirstGenPairsVs(session, output)
  )
}
