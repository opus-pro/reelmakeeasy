import { PlannerToolCall, SessionState, TodoExecutorHint } from '../types'

import { checkAnchorContracts, checkRefinementFullAnchorBatch } from './planner-contract-anchor'
import {
  checkAudioDirectiveScriptHint,
  checkAudioModeDurationAskGuard,
  checkAudioSelfScriptToolCall,
} from './planner-contract-audio'
import {
  checkBrandVideoTypeBeforeConfirm,
  checkModeConfirmationBrandContract,
} from './planner-contract-brand'
import {
  checkDirectiveExecutorEvidenceContract,
  getDirectivePhaseBaselineItems,
} from './planner-contract-directive-evidence'
import {
  areShotIdsContinuous,
  hasExplicitRefinementSharedBatchGroup,
  isDirectiveTodoId,
  isDirectiveTodoPhase,
  isSupportedToolScopeHint,
  normalizeText,
} from './planner-contract-helpers'
import { checkPatchSpecContract } from './planner-contract-patch'
import { checkSessionControlContract } from './planner-contract-session'
import { isSilhouetteIdentityClarification } from './planner-guards'
import { CheckClarifyScopeDeps, PlannerOutputLike } from './runtime.types'

export const BOOTSTRAP_SCRIPT_PHASE_COMPLETE_CONTRACT_ERROR =
  'bootstrap_script is invalid after intent context and script are complete; switch to script_review.'
export const BOOTSTRAP_VISUAL_PHASE_COMPLETE_CONTRACT_ERROR =
  'bootstrap_visual is invalid after visual bootstrap artifacts are complete; switch to refinement.'

export function checkClarifyScope(
  session: SessionState,
  output: PlannerOutputLike,
  deps: CheckClarifyScopeDeps,
): null | string {
  const reply = output.reply?.trim()
  if (!reply) {
    return 'ASK_CLARIFY requires a non-empty reply.'
  }

  // Options length: 0 allowed for "pure reminder" ASK_CLARIFY (no interactive
  // choice, frontend renders as plain assistant message), 1 for a single
  // suggested action offered alongside the free-text input, or 2-or-3 for the
  // normal multiple-choice clarify. See unified-planner-prompt for the pure-
  // reminder use case (lock/proceed redirect to UI button).
  //
  // Length 1 used to be rejected, but the runtime itself builds
  // single-option clarifications -- enforcePastedScriptDuration's
  // exceeds_duration_limit / exceeds_script_limit branches offer only
  // rewrite_to_requested_duration. That substitution is a pure function of the
  // script and the cap, so re-prompting rebuilt the identical rejected output
  // and the turn dead-ended on the give-up loop guard. The frontend renders any
  // option count (it checks truthiness, then maps), so 1 is a legal shape.
  // A null / absent array stays rejected: that is a schema violation, not a shape.
  if (!Array.isArray(output.options) || output.options.length > 3) {
    return 'ASK_CLARIFY requires options with length 0-3.'
  }

  if (output.options.some((option) => !option.id?.trim() || !option.label?.trim())) {
    return 'ASK_CLARIFY options require non-empty id and label.'
  }

  // Audio-mode duration-ask guard. See planner-contract-audio.ts.
  const audioErr = checkAudioModeDurationAskGuard(session, output)
  if (audioErr) {
    return audioErr
  }

  if (!session.spec.meta.mode_state.confirmed) {
    return null
  }

  if (session.spec.meta.open_questions.some((question) => question.blocking)) {
    return null
  }

  // Runtime-owned silhouette-identity clarification. This intentionally pauses before
  // anchor generation while bootstrap_visual todo items are still pending; the
  // user choice determines whether those items may proceed.
  if (isSilhouetteIdentityClarification(output)) {
    return null
  }

  if (output.todo_update?.clear === true) {
    return null
  }

  if (
    (session.todo_state.phase === 'bootstrap_script' ||
      session.todo_state.phase === 'bootstrap_visual') &&
    deps.hasPendingTodoItems(session)
  ) {
    return 'ASK_CLARIFY is not allowed while todo has pending items and no blocking questions.'
  }

  return null
}

/**
 * Hard cap on user-confirmed video duration in non-audio mode (the TTS
 * vendor's per-video ceiling). Audio mode is exempt (duration is backfilled
 * from measured audio length).
 */
export const MODE_CONFIRMED_NON_AUDIO_MAX_DURATION_SECONDS = 600

export function checkModeConfirmedContract(
  session: SessionState,
  output: PlannerOutputLike,
): null | string {
  if (!output.mode_update.confirmed || output.mode_update.mode === null) {
    return 'MODE_CONFIRMED requires mode_update.confirmed=true and non-null mode_update.mode.'
  }
  // Audio mode: runtime owns duration_seconds (seedWorkingScriptActivity backfills); allow null.
  const audioMode = session.spec.meta.audio_source === 'user_audio'
  if (output.mode_update.duration_seconds === null && !audioMode) {
    return 'MODE_CONFIRMED requires non-null mode_update.duration_seconds.'
  }
  const effectiveMaxDuration = MODE_CONFIRMED_NON_AUDIO_MAX_DURATION_SECONDS
  if (!audioMode && (output.mode_update.duration_seconds ?? 0) > effectiveMaxDuration) {
    return `MODE_CONFIRMED requires mode_update.duration_seconds <= ${effectiveMaxDuration} in non-audio mode (video-duration limit). Got ${output.mode_update.duration_seconds}. ASK_CLARIFY first to request a supported duration.`
  }
  // Skip when a previous MODE_CONFIRMED already classified input_type for this
  // session: runtime stickiness preserves it, so a later turn that re-emits
  // MODE_CONFIRMED (e.g. after spec edits) does not need to repeat the value.
  if (!output.mode_update.input_type && !session.spec.meta.mode_state.input_type) {
    return 'MODE_CONFIRMED requires non-null mode_update.input_type per mode-confirmation-prompt.ts section 2.6 (one of prompt_only | script_only | prompt_and_script | audio_music | audio_script).'
  }
  return checkBrandVideoTypeBeforeConfirm(session, output)
}

export function checkPlannerOutputContract(
  session: SessionState,
  output: PlannerOutputLike,
  deps: CheckClarifyScopeDeps,
): null | string {
  const hasToolCalls = Array.isArray(output.tool_calls) && output.tool_calls.length > 0
  const hasOps = Array.isArray(output.ops) && output.ops.length > 0
  const hasOptions = Array.isArray(output.options) && output.options.length > 0
  const hasExpectAssetsFlag = typeof output.expect_assets === 'boolean'

  const mustNotIncludeToolCallsOrOps =
    output.action === 'ASK_CLARIFY' ||
    output.action === 'MODE_CONFIRMED' ||
    output.action === 'SESSION_CONTROL' ||
    output.action === 'TODO_UPDATE_ONLY'
  if (mustNotIncludeToolCallsOrOps && (hasToolCalls || hasOps)) {
    return `${output.action} must not include tool_calls or ops.`
  }

  if (output.action !== 'ASK_CLARIFY' && hasOptions) {
    return `${output.action} must not include options.`
  }

  if (output.action !== 'ASK_CLARIFY' && hasExpectAssetsFlag) {
    return `${output.action} must not include expect_assets.`
  }

  const directiveTodoError = checkDirectiveTodoContract(session, output, deps)
  if (directiveTodoError) {
    return directiveTodoError
  }

  const structureEditError = checkStructureEditContract(session, output)
  if (structureEditError) {
    return structureEditError
  }

  const phaseGuardError = checkPhaseTransitionContract(session, output, deps)
  if (phaseGuardError) {
    return phaseGuardError
  }

  const phaseTodoError = checkPhaseTodoOwnershipContract(output)
  if (phaseTodoError) {
    return phaseTodoError
  }

  const anchorError = checkAnchorContracts(session, output)
  if (anchorError) {
    return anchorError
  }

  switch (output.action) {
    case 'ASK_CLARIFY': {
      return checkClarifyScope(session, output, deps)
    }
    case 'MODE_CONFIRMED': {
      return checkModeConfirmedContract(session, output)
    }
    case 'PATCH_SPEC': {
      return checkPatchSpecContract(output, { hasToolCalls })
    }
    case 'SESSION_CONTROL': {
      return checkSessionControlContract(output)
    }
    case 'TODO_UPDATE_ONLY': {
      return checkTodoUpdateOnlyContract(output)
    }
    case 'TOOL_CALLS': {
      return checkToolCallsContract(session, output, { hasOps })
    }
    default: {
      return 'Unknown action.'
    }
  }
}

export function checkStructureEditContract(
  session: SessionState,
  output: PlannerOutputLike,
): null | string {
  const structureEdit = output.structure_edit
  if (!structureEdit) {
    return null
  }

  if (
    output.action === 'ASK_CLARIFY' ||
    output.action === 'MODE_CONFIRMED' ||
    output.action === 'SESSION_CONTROL' ||
    output.action === 'TODO_UPDATE_ONLY'
  ) {
    return `${output.action} must not include structure_edit.`
  }

  // structure_edit and `refresh_beat_sheet=true` are mutually exclusive.
  // structure_edit is surgical (operates on specific shot_ids); refresh
  // re-segments the entire script and reassigns shot_ids from scratch.
  // Combining them creates undefined behaviour because the structure-edit
  // target shot_ids would point at pre-refresh shots that no longer exist
  // in the post-refresh segmentation. Planner must pick one path per turn.
  // See unified-planner-prompt section 7.2 "Segmentation routing".
  if (
    output.tool_calls?.some(
      (toolCall) =>
        toolCall.tool === 'generate_explainer_visual_script' &&
        toolCall.params.refresh_beat_sheet === true,
    )
  ) {
    return 'generate_explainer_visual_script must not combine refresh_beat_sheet=true with structure_edit; pick one (surgical structural edit OR global re-segmentation).'
  }

  if (structureEdit.op === 'DELETE') {
    return checkDeleteStructureEditContract(session, output)
  }

  const toolCallError = checkToolCallForStructureEdit(output)
  if (toolCallError) {
    return toolCallError
  }

  if (structureEdit.op === 'INSERT') {
    return checkInsertStructureEditContract(session, output)
  }

  if (structureEdit.op === 'SPLIT') {
    return checkSplitStructureEditContract(session, output)
  }

  return checkMergeStructureEditContract(session, output)
}

export function checkTodoUpdateOnlyContract(output: PlannerOutputLike): null | string {
  if (output.session_control?.command) {
    return 'TODO_UPDATE_ONLY must not include session_control.'
  }
  if (output.structure_edit) {
    return 'TODO_UPDATE_ONLY must not include structure_edit.'
  }
  return null
}

export function checkToolCallsContract(
  session: SessionState,
  output: PlannerOutputLike,
  options: { hasOps: boolean },
): null | string {
  if (!output.tool_calls || output.tool_calls.length === 0) {
    return 'TOOL_CALLS must include at least one tool call.'
  }

  if (output.tool_calls.length > 2) {
    return `${session.todo_state.phase} TOOL_CALLS may include at most two tool calls.`
  }

  const audioToolError = checkAudioSelfScriptToolCall(session, output.tool_calls)
  if (audioToolError) {
    return audioToolError
  }

  if (session.todo_state.phase === 'script_review') {
    const disallowedTool = output.tool_calls.find(
      (toolCall) =>
        toolCall.tool !== 'describe_uploaded_images' &&
        toolCall.tool !== 'generate_explainer_script' &&
        toolCall.tool !== 'generate_intent_context',
    )
    if (disallowedTool) {
      return 'script_review only allows script/global-constraint review work; do not run anchor, visual, or asset-assignment tools until the user clicks continue_uip_draft.'
    }
  }

  if (session.todo_state.phase === 'bootstrap_script') {
    const disallowedBootstrapScriptTool = output.tool_calls.find(
      (toolCall) =>
        toolCall.tool === 'generate_explainer_visual_script' ||
        toolCall.tool === 'plan_asset_assignment' ||
        (toolCall.tool === 'generate_anchor_assets' && toolCall.params.scope === 'FULL'),
    )
    if (disallowedBootstrapScriptTool) {
      return 'bootstrap_script only allows intent-context and script generation; do not start anchor or visual bootstrap before script_review is explicitly continued.'
    }
  }

  if (output.tool_calls.length === 2) {
    const batchError = checkAllowedTwoToolBatchContract(session, output)
    if (batchError) {
      return batchError
    }
  } else if (
    session.todo_state.phase !== 'bootstrap_visual' &&
    session.todo_state.phase !== 'bootstrap_script' &&
    session.todo_state.phase !== 'mode_confirmation' &&
    output.tool_calls.length !== 1
  ) {
    return 'TOOL_CALLS outside allowed shared-anchor-plan batches must include exactly one tool call.'
  }

  for (const toolCall of output.tool_calls) {
    const toolError = checkSingleToolCallContract(toolCall)
    if (toolError) {
      return toolError
    }
    // There is deliberately no audio-mode edit_mode=EXACT requirement
    // here. edit_mode only governs visual determinism, not narration; VO is
    // preserved structurally by the VS tool's repinPreservedAudioVo (it
    // re-pins audio_vo from the existing spec for every path except a
    // staged-script FULL refresh and bootstrap first-gen). So audio-mode VS
    // may use CREATIVE for richer visuals while VO stays immutable.
  }
  return options.hasOps ? 'TOOL_CALLS must not include ops.' : null
}

export function getInvalidTodoIdsForPhase(
  phase: SessionState['todo_state']['phase'],
  ids: string[],
): string[] {
  if (phase === 'mode_confirmation') {
    return ids
  }

  if (phase === 'bootstrap_script') {
    const allowed = new Set(['t0_assets', 't1_intent_context', 't2_script'])
    return ids.filter((id) => !allowed.has(id))
  }

  if (phase === 'bootstrap_brand') {
    // Only the workflow-owned t_brand stage is valid here (see
    // runtime/todo-runtime.ts bootstrapStageIds). Without this case the
    // fallback below would reject t_brand and loop into the contract
    // "I ran into the same issue" recovery message even though the
    // planner is correctly mirroring the runtime-owned todo snapshot.
    const allowed = new Set(['t_brand'])
    return ids.filter((id) => !allowed.has(id))
  }

  if (phase === 'script_review') {
    return ids.filter((id) => !isDirectiveTodoId(id))
  }

  if (phase === 'bootstrap_visual') {
    const allowed = new Set(['t3_vs', 't4_anchor_assets'])
    return ids.filter((id) => !allowed.has(id))
  }

  if (phase === 'refinement') {
    return ids.filter((id) => isBootstrapTodoId(id))
  }

  return ids
}

export function isBootstrapTodoId(id: string): boolean {
  return /^t\d+/i.test(id)
}

function checkAllowedTwoToolBatchContract(
  session: SessionState,
  output: PlannerOutputLike,
): null | string {
  const toolCalls = output.tool_calls ?? []
  const tools = new Set(toolCalls.map((toolCall) => toolCall.tool))
  if (tools.has('generate_explainer_visual_script') && tools.has('plan_asset_assignment')) {
    return 'generate_explainer_visual_script already owns final pre_selected_assets for this turn; do not combine it with plan_asset_assignment.'
  }
  if (
    (session.todo_state.phase === 'bootstrap_script' ||
      session.todo_state.phase === 'mode_confirmation') &&
    tools.size === 2 &&
    tools.has('describe_uploaded_images') &&
    tools.has('generate_intent_context')
  ) {
    return null
  }
  if (
    tools.size !== 2 ||
    !tools.has('generate_explainer_visual_script') ||
    !tools.has('generate_anchor_assets')
  ) {
    return `${session.todo_state.phase} tool batch only supports generate_explainer_visual_script + generate_anchor_assets.`
  }

  const visualTool = toolCalls.find(
    (toolCall) => toolCall.tool === 'generate_explainer_visual_script',
  )
  const anchorTool = toolCalls.find((toolCall) => toolCall.tool === 'generate_anchor_assets')
  if (!visualTool || !anchorTool) {
    return `${session.todo_state.phase} tool batch only supports generate_explainer_visual_script + generate_anchor_assets.`
  }

  if (session.todo_state.phase === 'bootstrap_visual') {
    if (visualTool.params.scope !== 'FULL' || anchorTool.params.scope !== 'FULL') {
      return `${session.todo_state.phase} VS + anchor batch requires FULL scope for both tool calls.`
    }
    return null
  }

  if (session.todo_state.phase === 'refinement') {
    if (!hasExplicitRefinementSharedBatchGroup(session, output)) {
      return 'refinement anchor + visual two-tool batches require a shared_batch_key on the paired pending directives.'
    }
    const fullAnchorBatchError = checkRefinementFullAnchorBatch(session, visualTool, anchorTool)
    if (fullAnchorBatchError !== undefined) {
      return fullAnchorBatchError
    }
    if (
      !isSupportedToolScopeHint(visualTool.params.scope) ||
      visualTool.params.scope === 'ANCHOR_IDS' ||
      anchorTool.params.scope !== 'ANCHOR_IDS'
    ) {
      return 'refinement shared batch requires generate_explainer_visual_script scope=FULL | SHOT_IDS | SHOT_RANGE plus generate_anchor_assets scope=ANCHOR_IDS.'
    }
    if ((anchorTool.params.anchor_requests?.length ?? 0) === 0) {
      return 'refinement shared batch requires generate_anchor_assets anchor_requests.'
    }
    return null
  }

  return 'TOOL_CALLS outside allowed shared-anchor-plan batches must include exactly one tool call.'
}

function checkDeleteStructureEditContract(
  session: SessionState,
  output: PlannerOutputLike,
): null | string {
  const deleteShotIds = output.structure_edit?.shot_ids ?? []
  const hasUnknownDeleteTargets = deleteShotIds.some(
    (shotId) => !session.spec.visual_script.shots.some((shot) => shot.shot_id === shotId),
  )
  if (hasUnknownDeleteTargets) {
    return 'DELETE structure_edit shot_ids contain unknown shot_id.'
  }
  if (output.action !== 'PATCH_SPEC') {
    return 'DELETE structure_edit must use PATCH_SPEC.'
  }
  const ops = output.ops ?? []
  if (ops.length === 0) {
    return 'DELETE structure_edit requires PATCH_SPEC delete_shots op.'
  }
  const hasDeleteOp = ops.some((op) => op.op === 'delete_shots')
  if (!hasDeleteOp) {
    return 'DELETE structure_edit requires PATCH_SPEC delete_shots op.'
  }
  const hasNonDeleteOp = ops.some((op) => op.op !== 'delete_shots')
  return hasNonDeleteOp
    ? 'DELETE structure_edit must stay local: only delete_shots ops are allowed.'
    : null
}

function checkDirectiveClearConstraint(
  phase: 'refinement' | 'script_review',
  baselineItems: Array<{ id: string; status: 'done' | 'pending' }>,
  statusUpdates: Array<{ id: string; status: 'done' | 'pending' }>,
): null | string {
  const projected = new Map(baselineItems.map((item) => [item.id, item.status]))
  for (const update of statusUpdates) {
    projected.set(update.id, update.status)
  }

  const hasPendingDirectives = Array.from(projected.entries()).some(
    ([id, status]) => isDirectiveTodoId(id) && status === 'pending',
  )
  return hasPendingDirectives
    ? `${phase} todo_update.clear=true is invalid while directive todo items are still pending.`
    : null
}

function checkDirectiveExecutorHints(output: PlannerOutputLike): null | string {
  const phase = output.todo_snapshot?.phase
  if (!phase || !isDirectiveTodoPhase(phase)) {
    return null
  }

  // ASK_CLARIFY may propose directives without executor_hint when blocking
  // questions exist - the user's response determines the execution approach.
  if (output.action === 'ASK_CLARIFY') {
    return null
  }

  const directivePhase = phase as 'refinement' | 'script_review'

  for (const item of getPendingDirectiveItems(output)) {
    const hintError = checkPendingDirectiveHint(directivePhase, item)
    if (hintError) {
      return hintError
    }
  }

  return null
}

function checkDirectiveSnapshotContract(output: PlannerOutputLike): null | string {
  const snapshot = output.todo_snapshot
  const phase = snapshot?.phase
  if (!snapshot || !phase || !isDirectiveTodoPhase(phase)) {
    return null
  }

  if (snapshot.items.some((item) => isBootstrapTodoId(item.id))) {
    return `${phase} todo_snapshot must not include bootstrap stage ids (t*).`
  }

  return checkDirectiveExecutorHints(output)
}

function checkDirectiveTodoContract(
  session: SessionState,
  output: PlannerOutputLike,
  deps: CheckClarifyScopeDeps,
): null | string {
  const phase = output.todo_update.phase
  if (!isDirectiveTodoPhase(phase)) {
    return null
  }

  const audioHintError = checkAudioDirectiveScriptHint(session, getPendingDirectiveItems(output))
  if (audioHintError) {
    return audioHintError
  }

  const snapshotError = checkDirectiveSnapshotContract(output)
  if (snapshotError) {
    return snapshotError
  }

  const todoUpdateError = checkDirectiveTodoUpdateContract(session, output, deps)
  if (todoUpdateError) {
    return todoUpdateError
  }

  if (phase === 'refinement') {
    return checkRefinementSharedAnchorPlanBatchRequirement(session, output)
  }

  return null
}

function checkDirectiveTodoUpdateContract(
  session: SessionState,
  output: PlannerOutputLike,
  deps: CheckClarifyScopeDeps,
): null | string {
  const phase = output.todo_update.phase as 'refinement' | 'script_review'
  const baselineItems = getDirectivePhaseBaselineItems(session, output)
  const statusUpdates = output.todo_update.set_item_status ?? []
  const unknownIds = getUnknownTodoUpdateIds(baselineItems, statusUpdates)
  if (unknownIds.length > 0) {
    return `${phase} todo_update.set_item_status must not introduce new todo ids: ${unknownIds.join(', ')}`
  }

  const executorEvidenceError = checkDirectiveExecutorEvidenceContract(
    phase,
    baselineItems,
    statusUpdates,
    output,
    deps,
    session.todo_state.items,
  )
  if (executorEvidenceError) {
    return executorEvidenceError
  }

  if (output.todo_update.clear !== true) {
    return null
  }

  return checkDirectiveClearConstraint(phase, baselineItems, statusUpdates)
}

function checkInsertStructureEditContract(
  session: SessionState,
  output: PlannerOutputLike,
): null | string {
  const structureEdit = output.structure_edit
  if (!structureEdit?.anchor_shot_id?.trim() || !structureEdit?.position) {
    return 'INSERT structure_edit requires anchor_shot_id and position.'
  }
  const anchorExists = session.spec.visual_script.shots.some(
    (shot) => shot.shot_id === structureEdit.anchor_shot_id,
  )
  if (!anchorExists) {
    return `INSERT structure_edit anchor_shot_id '${structureEdit.anchor_shot_id}' not found.`
  }
  return null
}

function checkMergeStructureEditContract(
  session: SessionState,
  output: PlannerOutputLike,
): null | string {
  const mergeShotIds = output.structure_edit?.shot_ids ?? []
  if (mergeShotIds.length < 2) {
    return 'MERGE structure_edit requires shot_ids length >= 2.'
  }
  return areShotIdsContinuous(session, mergeShotIds)
    ? null
    : 'MERGE structure_edit shot_ids must be continuous in current shot order.'
}

function checkPatchSpecDirectiveHint(
  phase: 'refinement' | 'script_review',
  directiveId: string,
  hint: {
    executor_patch_ops?: null | string[]
    scope_hint?: null | string
  },
): null | string {
  if (!hint.executor_patch_ops || hint.executor_patch_ops.length === 0) {
    return `${phase} pending directive '${directiveId}' with PATCH_SPEC executor_hint requires executor_patch_ops.`
  }
  if (!hint.scope_hint?.trim()) {
    return `${phase} pending directive '${directiveId}' with PATCH_SPEC executor_hint requires scope_hint identifying the mutation target.`
  }
  return null
}

function checkPendingDirectiveHint(
  phase: 'refinement' | 'script_review',
  item: {
    executor_hint?: null | TodoExecutorHint
    id: string
    title: string
  },
): null | string {
  const hint = item.executor_hint
  if (!hint) {
    return `${phase} pending directive '${item.id}' requires executor_hint.`
  }

  if (isUndoDirectiveTodoItem(item) && !isUndoSessionControlHint(hint)) {
    return `${phase} pending directive '${item.id}' expresses undo intent and must use executor_hint SESSION_CONTROL with scope_hint UNDO_LAST.`
  }

  if (phase === 'script_review' && hint.executor_type === 'SESSION_CONTROL') {
    return `script_review pending directive '${item.id}' only allows PATCH_SPEC or TOOL_CALLS executor_hint for script/global-constraint review work.`
  }

  if (hint.executor_type === 'TOOL_CALLS') {
    return phase === 'script_review'
      ? checkScriptReviewToolCallsDirectiveHint(item.id, hint)
      : checkToolCallsDirectiveHint(item.id, hint)
  }

  if (hint.executor_type === 'PATCH_SPEC') {
    return checkPatchSpecDirectiveHint(phase, item.id, hint)
  }

  return checkSessionControlDirectiveHint(phase, item.id, hint)
}

function checkPhaseTodoOwnershipContract(output: PlannerOutputLike): null | string {
  const snapshotError = checkPhaseTodoSnapshotOwnership(output)
  if (snapshotError) {
    return snapshotError
  }

  return checkPhaseTodoUpdateOwnership(output)
}

function checkPhaseTodoSnapshotOwnership(output: PlannerOutputLike): null | string {
  if (!output.todo_snapshot) {
    return null
  }

  const invalidIds = getInvalidTodoIdsForPhase(
    output.todo_snapshot.phase,
    output.todo_snapshot.items.map((item) => item.id),
  )
  if (invalidIds.length === 0) {
    return null
  }

  return `${output.todo_snapshot.phase} todo_snapshot contains invalid ids: ${invalidIds.join(', ')}`
}

function checkPhaseTodoUpdateOwnership(output: PlannerOutputLike): null | string {
  const statusIds = (output.todo_update.set_item_status ?? []).map((update) => update.id)
  if (statusIds.length === 0) {
    return null
  }

  const invalidIds = getInvalidTodoIdsForPhase(output.todo_update.phase, statusIds)
  if (invalidIds.length === 0) {
    return null
  }

  return `${output.todo_update.phase} todo_update contains invalid ids: ${invalidIds.join(', ')}`
}

function checkPhaseTransitionContract(
  session: SessionState,
  output: PlannerOutputLike,
  deps: CheckClarifyScopeDeps,
): null | string {
  if (output.todo_snapshot && output.todo_snapshot.phase !== output.todo_update.phase) {
    return 'todo_snapshot.phase must match todo_update.phase.'
  }

  if (session.todo_state.phase === 'mode_confirmation') {
    const modeExitError = checkModeConfirmationBrandContract(session, output)
    if (modeExitError) {
      return modeExitError
    }
  }

  if (
    session.todo_state.phase !== 'mode_confirmation' &&
    output.todo_update.phase !== session.todo_state.phase
  ) {
    return `${session.todo_state.phase} is a system-owned phase boundary; planner outputs must stay within the current phase.`
  }

  if (
    session.todo_state.phase === 'script_review' &&
    output.todo_update.phase !== 'script_review'
  ) {
    return 'script_review is a runtime-owned gate and can only be exited via CTA backend actions.'
  }

  if (
    session.todo_state.phase === 'bootstrap_script' &&
    output.todo_update.phase === 'bootstrap_visual'
  ) {
    return 'bootstrap_visual can only start after the user explicitly clicks continue_uip_draft.'
  }

  if (session.spec.meta.mode_state.confirmed && deps.isBootstrapArtifactsComplete(session)) {
    if (output.todo_update.phase === 'bootstrap_script') {
      return BOOTSTRAP_SCRIPT_PHASE_COMPLETE_CONTRACT_ERROR
    }

    if (output.todo_update.phase === 'bootstrap_visual') {
      return BOOTSTRAP_VISUAL_PHASE_COMPLETE_CONTRACT_ERROR
    }
  }
  return null
}

function checkRefinementSharedAnchorPlanBatchRequirement(
  session: SessionState,
  output: PlannerOutputLike,
): null | string {
  if (output.todo_update.phase !== 'refinement') {
    return null
  }

  if (!hasExplicitRefinementSharedBatchGroup(session, output)) {
    return null
  }

  // A topic or other global-field change is applied before the runtime can
  // mark the resulting consistency entries and execute their recovery tools.
  // Keeping the pending pair during that preparatory PATCH_SPEC is safe: the
  // next TOOL_CALLS step is still required to execute both batch arms below.
  if (output.action === 'PATCH_SPEC') {
    return null
  }

  const toolCalls = output.tool_calls ?? []
  if (toolCalls.length !== 2) {
    return 'refinement directives sharing a shared_batch_key must EITHER execute the matching anchor + visual pair in one TOOL_CALLS batch -- generate_anchor_assets(FULL) + generate_explainer_visual_script(FULL) for an active FULL anchor recovery, or generate_anchor_assets(ANCHOR_IDS with anchor_requests) + generate_explainer_visual_script for a targeted batch -- OR, if you did not intend to batch them (e.g. the pairing was created by mistake or the user changed course), emit a refinement todo_snapshot that drops the shared_batch_key (split them into independent directives, or remove the ones no longer needed) so you are no longer forced into the batch.'
  }

  return null
}

function checkScriptReviewToolCallsDirectiveHint(
  directiveId: string,
  hint: TodoExecutorHint,
): null | string {
  if (!hint.executor_tool) {
    return `script_review pending directive '${directiveId}' with TOOL_CALLS executor_hint requires executor_tool.`
  }
  if (
    hint.executor_tool !== 'generate_explainer_script' &&
    hint.executor_tool !== 'generate_intent_context'
  ) {
    return `script_review directives only allow script/global-constraint review work; directive '${directiveId}' cannot use TOOL_CALLS ${hint.executor_tool}.`
  }
  if (hint.scope_hint && !isSupportedScriptReviewToolScopeHint(hint.scope_hint)) {
    return `script_review pending directive '${directiveId}' has invalid TOOL_CALLS scope_hint '${hint.scope_hint}'. Use FULL | SHOT_IDS | SHOT_RANGE.`
  }
  return null
}

function checkSessionControlDirectiveHint(
  phase: 'refinement' | 'script_review',
  directiveId: string,
  hint: TodoExecutorHint,
): null | string {
  if (!hint.scope_hint || !isSupportedSessionControlHint(hint.scope_hint)) {
    return `${phase} pending directive '${directiveId}' with SESSION_CONTROL executor_hint requires scope_hint UNDO_LAST.`
  }
  return null
}

function checkSingleToolCallContract(toolCall: PlannerToolCall): null | string {
  if (
    toolCall.tool === 'generate_explainer_script' &&
    toolCall.params.edit_mode === 'EXACT' &&
    toolCall.params.scope !== 'FULL'
  ) {
    return 'generate_explainer_script with edit_mode=EXACT is only allowed for scope=FULL. Use PATCH_SPEC for partial exact audio_vo updates.'
  }

  if (toolCall.tool === 'generate_anchor_assets') {
    if (toolCall.params.scope === 'SHOT_IDS' || toolCall.params.scope === 'SHOT_RANGE') {
      return 'generate_anchor_assets only supports FULL or ANCHOR_IDS scope.'
    }
    if (toolCall.params.scope === 'ANCHOR_IDS' && !(toolCall.params.anchor_ids?.length ?? 0)) {
      return 'generate_anchor_assets with scope=ANCHOR_IDS requires non-empty anchor_ids.'
    }
    if (toolCall.params.scope !== 'ANCHOR_IDS' && (toolCall.params.anchor_requests?.length ?? 0)) {
      return 'generate_anchor_assets only allows anchor_requests when scope=ANCHOR_IDS.'
    }
  } else if (toolCall.params.scope === 'ANCHOR_IDS') {
    return `${toolCall.tool} does not support ANCHOR_IDS scope.`
  }

  return null
}

function checkSplitStructureEditContract(
  session: SessionState,
  output: PlannerOutputLike,
): null | string {
  const structureEdit = output.structure_edit
  const shotId = structureEdit?.shot_ids?.[0]
  if (!shotId) {
    return 'SPLIT structure_edit requires exactly one shot_id.'
  }
  const sourceShot = session.spec.visual_script.shots.find((shot) => shot.shot_id === shotId)
  if (!sourceShot) {
    return `SPLIT structure_edit shot '${shotId}' not found.`
  }
  const segments = structureEdit?.split_audio_segments ?? []
  if (segments.length < 2) {
    return 'SPLIT structure_edit requires split_audio_segments length >= 2.'
  }
  const merged = normalizeText(segments.join(' '))
  const original = normalizeText(sourceShot.audio_vo)
  return merged === original
    ? null
    : 'SPLIT structure_edit split_audio_segments must preserve original shot audio_vo text.'
}

function checkToolCallForStructureEdit(output: PlannerOutputLike): null | string {
  if (output.action !== 'TOOL_CALLS') {
    return `${output.structure_edit?.op ?? 'UNKNOWN'} structure_edit must use TOOL_CALLS with generate_explainer_visual_script.`
  }
  const toolCalls = output.tool_calls ?? []
  if (toolCalls.length !== 1 && toolCalls.length !== 2) {
    return `${output.structure_edit?.op ?? 'UNKNOWN'} structure_edit requires generate_explainer_visual_script, optionally batched with generate_anchor_assets.`
  }
  const hasVisualTool = toolCalls.some(
    (toolCall) => toolCall.tool === 'generate_explainer_visual_script',
  )
  const hasInvalidTool = toolCalls.some(
    (toolCall) =>
      toolCall.tool !== 'generate_explainer_visual_script' &&
      toolCall.tool !== 'generate_anchor_assets',
  )
  if (!hasVisualTool || hasInvalidTool) {
    return `${output.structure_edit?.op ?? 'UNKNOWN'} structure_edit requires TOOL_CALLS generate_explainer_visual_script.`
  }
  return null
}

function checkToolCallsDirectiveHint(directiveId: string, hint: TodoExecutorHint): null | string {
  if (!hint.executor_tool) {
    return `refinement pending directive '${directiveId}' with TOOL_CALLS executor_hint requires executor_tool.`
  }
  if (hint.scope_hint && !isSupportedToolScopeHint(hint.scope_hint)) {
    return `refinement pending directive '${directiveId}' has invalid TOOL_CALLS scope_hint '${hint.scope_hint}'. Use FULL | SHOT_IDS | SHOT_RANGE | ANCHOR_IDS.`
  }
  return null
}

function getPendingDirectiveItems(output: PlannerOutputLike): Array<{
  executor_hint?: null | TodoExecutorHint
  id: string
  title: string
}> {
  if (!output.todo_snapshot) {
    return []
  }

  return output.todo_snapshot.items.filter(
    (item) => isDirectiveTodoId(item.id) && item.status === 'pending',
  )
}

function getUnknownTodoUpdateIds(
  baselineItems: Array<{ id: string; status: 'done' | 'pending' }>,
  statusUpdates: Array<{ id: string; status: 'done' | 'pending' }>,
): string[] {
  const baselineIds = new Set(baselineItems.map((item) => item.id))
  return statusUpdates.map((update) => update.id).filter((id) => !baselineIds.has(id))
}

function isSupportedScriptReviewToolScopeHint(value: string): boolean {
  const normalized = normalizeText(value).toUpperCase()
  return normalized === 'FULL' || normalized === 'SHOT_IDS' || normalized === 'SHOT_RANGE'
}

function isSupportedSessionControlHint(value: string): boolean {
  const normalized = normalizeText(value).toUpperCase()
  return normalized === 'UNDO_LAST'
}

function isUndoDirectiveTodoItem(item: { id: string; title: string }): boolean {
  const idText = normalizeTodoText(item.id)
  const titleText = normalizeTodoText(item.title)
  return /\b(undo|revert|rollback)\b/.test(idText) || /\b(undo|revert|rollback)\b/.test(titleText)
}

function isUndoSessionControlHint(hint: {
  executor_type: 'PATCH_SPEC' | 'SESSION_CONTROL' | 'TOOL_CALLS'
  scope_hint?: null | string
}): boolean {
  return (
    hint.executor_type === 'SESSION_CONTROL' && normalizeText(hint.scope_hint ?? '') === 'undo_last'
  )
}

function normalizeTodoText(value: string): string {
  return value.trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ')
}
