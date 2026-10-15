import { SessionState, SetBrandExtractionInputOp } from '../types'

import { PlannerOutputLike } from './runtime.types'

export const MODE_CONFIRM_REQUIRES_BOOTSTRAP_BRAND_CONTRACT_ERROR =
  'mode_confirmation must advance to bootstrap_brand when brand_extraction_input is set (brand extraction must run before script generation).'
export const MODE_CONFIRM_REQUIRES_BOOTSTRAP_SCRIPT_CONTRACT_ERROR =
  'mode_confirmation cannot advance to bootstrap_brand without brand_extraction_input set; advance to bootstrap_script instead.'

export const APPLY_BRAND_CARRY_INVALID_CONTRACT_ERROR =
  'apply_brand_carry is only valid in mode_confirmation while brand_carry_state.status === "pending". Drop the op; if the user named a different brand, emit set_brand_extraction_input for it instead.'
export const APPLY_BRAND_CARRY_MIXED_OPS_CONTRACT_ERROR =
  'apply_brand_carry must be the ONLY op in its PATCH_SPEC. Re-emit it alone; any other spec changes belong in later phases.'

// Brand carry v2: apply_brand_carry preconditions. Spec-level invariants
// (input/status null) are enforced by patch-apply; this catches the planner
// emitting the op in the wrong phase, with no staged carry, or buried in a
// mixed batch (the prompt mandates a single-op PATCH_SPEC -- a mixed batch
// could smuggle unrelated mutations into mode_confirmation, and op ordering
// inside the batch could break the apply preconditions), so it retries
// cleanly instead of burning a patch rejection.
export function checkApplyBrandCarryOp(
  session: SessionState,
  output: PlannerOutputLike,
): null | string {
  if (output.action !== 'PATCH_SPEC' || !output.ops) {
    return null
  }
  const hasApplyOp = output.ops.some((op) => op.op === 'apply_brand_carry')
  if (!hasApplyOp) {
    return null
  }
  if (output.ops.length > 1) {
    return APPLY_BRAND_CARRY_MIXED_OPS_CONTRACT_ERROR
  }
  const carry = session.spec.global_constraints?.brand_carry_state
  if (session.todo_state.phase !== 'mode_confirmation' || carry?.status !== 'pending') {
    return APPLY_BRAND_CARRY_INVALID_CONTRACT_ERROR
  }
  return null
}

export const SET_BRAND_INPUT_REQUIRES_PENDING_CARRY_CONTRACT_ERROR =
  'set_brand_extraction_input is only planner-emittable while brand_carry_state.status === "pending" (discarding a staged brand carry because the user named a DIFFERENT brand without a URL). Outside that case, drop the op: the section 2.6.2 runtime auto-start owns URL inputs, and a freeform brand description goes through the Stage 1 ASK_CLARIFY -> Stage 2 modal flow.'
export const SET_BRAND_INPUT_URL_KIND_CONTRACT_ERROR =
  'set_brand_extraction_input with kind "url" is never planner-emitted: the section 2.6.2 runtime auto-start sets URL inputs deterministically (a different URL discards a pending carry on its own). Drop the op.'
export const SET_BRAND_INPUT_SAME_AS_CARRY_CONTRACT_ERROR =
  'set_brand_extraction_input matches the carried brand input, so this is not a brand change. Emit { "op": "apply_brand_carry" } instead.'

// Brand carry v2 review follow-up: the planner-emitted set_brand_extraction_input
// exists for exactly ONE narrow sub-scenario -- a staged brand carry where the
// user names a DIFFERENT brand with text only (no URL). It deviates from the
// v1 invariant that the planner never sets brand_extraction_input (the runtime
// auto-start owns URLs; the Stage 1 -> Stage 2 modal owns freeform), so fence
// it to precisely that scenario: pending carry only, freeform kind only, and a
// genuine brand change (a same-text re-paste is a reuse, not a change -- the
// planner must emit apply_brand_carry for it). The prompt only opens this door
// while a carry is staged; this check is the runtime backstop for drift.
export function checkSetBrandExtractionInputOp(
  session: SessionState,
  output: PlannerOutputLike,
): null | string {
  if (output.action !== 'PATCH_SPEC' || !output.ops) {
    return null
  }
  const setOps = output.ops.filter(
    (op): op is SetBrandExtractionInputOp => op.op === 'set_brand_extraction_input',
  )
  if (setOps.length === 0) {
    return null
  }
  const carry = session.spec.global_constraints?.brand_carry_state
  if (carry?.status !== 'pending') {
    return SET_BRAND_INPUT_REQUIRES_PENDING_CARRY_CONTRACT_ERROR
  }
  if (setOps.some((op) => op.input.kind !== 'freeform')) {
    return SET_BRAND_INPUT_URL_KIND_CONTRACT_ERROR
  }
  const source = carry.source_brand_extraction_input
  if (
    source.kind === 'freeform' &&
    setOps.some((op) => op.input.kind === 'freeform' && op.input.text.trim() === source.text.trim())
  ) {
    return SET_BRAND_INPUT_SAME_AS_CARRY_CONTRACT_ERROR
  }
  return null
}

export const MODE_CONFIRM_REQUIRES_BRAND_VIDEO_TYPE_CONTRACT_ERROR =
  'MODE_CONFIRMED on the brand path requires mode_update.brand_video_type (one of friction_to_flow | product_showcase | industry_explainer) per mode-confirmation-prompt.ts section 2.6.5 -- set it from the chosen brand-direction option before confirming.'
export const MODE_CONFIRM_REQUIRES_PASTED_SCRIPT_DURATION_SOURCE_CONTRACT_ERROR =
  'MODE_CONFIRMED with a pasted script requires non-null mode_update.duration_source.'

/**
 * Brand path: brand_video_type drives the downstream narrative-arc
 * grounding, so it MUST be set before MODE_CONFIRMED. Accept it either already
 * on the spec or emitted this turn via mode_update (applyAgentMemory writes the
 * latter through after the contract check). Enforced in the runtime, not just
 * the prompt, so a branded session can never confirm with a null arc.
 */
const BRAND_VIDEO_TYPE_VALUES = new Set([
  'friction_to_flow',
  'industry_explainer',
  'product_showcase',
])

export function checkBrandVideoTypeBeforeConfirm(
  session: SessionState,
  output: PlannerOutputLike,
): null | string {
  const inputType = output.mode_update.input_type ?? session.spec.meta.mode_state.input_type
  const durationSource =
    output.mode_update.duration_source === undefined
      ? session.spec.meta.mode_state.duration_source
      : output.mode_update.duration_source
  if (
    (inputType === 'script_only' || inputType === 'prompt_and_script') &&
    durationSource == null
  ) {
    return MODE_CONFIRM_REQUIRES_PASTED_SCRIPT_DURATION_SOURCE_CONTRACT_ERROR
  }
  const onBrandPath = session.spec.global_constraints?.brand_extraction_input != null
  if (!onBrandPath) {
    return null
  }
  // Require an actual arc enum, not merely a truthy value -- a stale / malformed
  // value on the spec must not slip past MODE_CONFIRMED validation.
  const brandVideoType =
    output.mode_update.brand_video_type ?? session.spec.global_constraints?.brand_video_type
  return brandVideoType && BRAND_VIDEO_TYPE_VALUES.has(brandVideoType)
    ? null
    : MODE_CONFIRM_REQUIRES_BRAND_VIDEO_TYPE_CONTRACT_ERROR
}

export const SAVED_BRIEF_OP_REQUIRES_INJECTED_BRIEF_CONTRACT_ERROR =
  'remove_saved_brand_brief / reextract_saved_brand_brief are only valid in mode_confirmation while an auto-injected saved brief is attached (brand_bank_source.kind === "brand_library"). Drop the op.'
export const SAVED_BRIEF_OP_MIXED_OPS_CONTRACT_ERROR =
  'A saved-brief chat op (remove_saved_brand_brief / reextract_saved_brand_brief) must be the ONLY op in its PATCH_SPEC. Re-emit it alone.'

// Saved-brief chat ops (detach / re-extract an auto-injected brief).
// The mode_confirmation prompt opens the PATCH_SPEC door for these only while a
// brand_library brief is attached; this gives the planner a clean single-op
// retry message when it drifts IN mode_confirmation. Mirrors the
// apply_brand_carry gate: single-op PATCH_SPEC and a brief actually attached.
// The HARD cross-phase backstop lives in patch-apply-brand-brief-ops.ts, which
// rejects the ops whenever phase !== mode_confirmation (the schema accepts them
// globally and the apply layer runs in every phase) -- so a later-phase drift
// can't clear/re-extract a still-locked brief even though this contract check
// is only wired through the mode_confirmation path.
export function checkSavedBriefChatOp(
  session: SessionState,
  output: PlannerOutputLike,
): null | string {
  if (output.action !== 'PATCH_SPEC' || !output.ops) {
    return null
  }
  const hasSavedBriefOp = output.ops.some(
    (op) => op.op === 'remove_saved_brand_brief' || op.op === 'reextract_saved_brand_brief',
  )
  if (!hasSavedBriefOp) {
    return null
  }
  if (output.ops.length > 1) {
    return SAVED_BRIEF_OP_MIXED_OPS_CONTRACT_ERROR
  }
  const source = session.spec.global_constraints?.brand_bank_source
  if (session.todo_state.phase !== 'mode_confirmation' || source?.kind !== 'brand_library') {
    return SAVED_BRIEF_OP_REQUIRES_INJECTED_BRIEF_CONTRACT_ERROR
  }
  return null
}

// Single mode_confirmation entry point for planner-contract.ts: the carry-op
// gates run before the exit-transition check, mirroring the order the planner
// resolves a pending carry before the phase can advance.
export function checkModeConfirmationBrandContract(
  session: SessionState,
  output: PlannerOutputLike,
): null | string {
  return (
    checkApplyBrandCarryOp(session, output) ??
    checkSetBrandExtractionInputOp(session, output) ??
    checkSavedBriefChatOp(session, output) ??
    checkModeConfirmExitTransition(session, output)
  )
}

export function checkModeConfirmExitTransition(
  session: SessionState,
  output: PlannerOutputLike,
): null | string {
  const next = output.todo_update.phase
  if (next !== 'mode_confirmation' && next !== 'bootstrap_script' && next !== 'bootstrap_brand') {
    return 'mode_confirmation may only remain in mode_confirmation or advance to bootstrap_script / bootstrap_brand.'
  }
  // maybeAutoCorrectPhaseDriftContractError rewrites the misroute.
  const hasBrandInput = session.spec.global_constraints?.brand_extraction_input != null
  if (next === 'bootstrap_script' && hasBrandInput) {
    return MODE_CONFIRM_REQUIRES_BOOTSTRAP_BRAND_CONTRACT_ERROR
  }
  if (next === 'bootstrap_brand' && !hasBrandInput) {
    return MODE_CONFIRM_REQUIRES_BOOTSTRAP_SCRIPT_CONTRACT_ERROR
  }
  // brand_video_type is best-effort, NOT a hard gate (parity with main): a brand
  // video may advance to bootstrap_brand with only brand_extraction_input set, and
  // the shape is inferred/asked on a later turn (section 2.6.5). Hard-requiring it
  // deadlocked turn 1 whenever an undescribed uploaded image blocked the
  // brand_video_type PATCH -- the asset guard blocked the PATCH and this gate
  // blocked the MODE_CONFIRMED fallback, leaving no exempt escape.
  return null
}
