import type { Spec } from '../types'

import type { PatchContext, PatchResult } from './patch-apply'

// Saved-brief chat ops: the user's escape hatches for an
// auto-injected brand-library brief. Op shapes live here (and are members of
// the PatchOp union in types.ts) alongside their apply handlers, kept out of
// patch-apply.ts so that dispatch file stays under the max-lines cap. Both
// reject when the bank is not a brand_library injection -- the planner only
// emits them while one is attached, but a stale or duplicate emit must fail
// loudly rather than wipe an in-session extracted bank.

// "remove the brand brief" / "don't use the brand info": detach the injected
// brief for THIS session (it stays in the library).
export interface RemoveSavedBrandBriefOp {
  op: 'remove_saved_brand_brief'
}

// "re-extract" / "refresh brand info": discard the saved brief and run a fresh
// extraction (staleness valve for stale sites / mediocre saves).
export interface ReextractSavedBrandBriefOp {
  op: 'reextract_saved_brand_brief'
}

// "remove the brand brief" while reviewing a brand: discard the bank
// and continue with no brand. Source-agnostic by design -- a brand in brand_review
// may be a fresh URL extraction, a manual-entry bank (extraction failed), or a v2
// saved-library brief routed into editable review. Distinct from the
// mode_confirmation saved-brief ops above, which only fire BEFORE review while a
// still-locked injected brief is attached.
export interface DiscardBrandInReviewOp {
  op: 'discard_brand_in_review'
}

// Both ops are valid ONLY while an auto-injected brand_library brief is attached
// AND only in mode_confirmation. The phase check is the HARD cross-phase backstop
// (the planner-contract check only runs through the mode_confirmation path, but
// the schema accepts these ops in every phase): a later-phase planner drift must
// never clear or re-extract a still-locked saved brief mid-project.
function assertRemovableInjectedBrief(
  spec: Spec,
  opName: string,
  context?: PatchContext,
): null | string {
  const phase = context?.phase
  if (phase !== 'mode_confirmation') {
    return `INVALID_BRAND_TRANSITION: ${opName} requires todo_state.phase === 'mode_confirmation' (current: ${phase ?? 'null'})`
  }
  const kind = spec.global_constraints.brand_bank_source?.kind
  if (kind !== 'brand_library') {
    return `INVALID_BRAND_TRANSITION: ${opName} requires an injected saved brief (brand_bank_source.kind='brand_library'), got '${kind ?? 'null'}'`
  }
  return null
}

// Reset every brand field the injection seeded back to its virgin default. The
// caller sets brand_extraction_declined afterwards (remove raises it; re-extract
// leaves it false so the deterministic auto-start re-fires).
function clearInjectedBrief(spec: Spec): void {
  const c = spec.global_constraints
  c.brand_bank = null
  c.brand_bank_locked_at = null
  c.brand_bank_source = null
  c.brand_extraction_status = null
  c.brand_extraction_input = null
  // Reset the extraction bookkeeping too so re-extract starts from a genuinely
  // virgin state -- otherwise stale failure/run/retry metadata from the saved
  // brief's original extraction would leak into the fresh run's spec.
  c.brand_extraction_failure_reason = null
  c.brand_extraction_started_at = null
  c.brand_extraction_run_id = null
  c.brand_extraction_retry_count = 0
  c.brand_source_change_count = 0
  c.brand_reextraction_pending = false
}

/**
 * "remove the brand brief" / "don't use the brand info": detach the injected
 * brief for this session. Clears the bank, lock, provenance, and any pinned
 * input, and raises brand_extraction_declined so the deterministic auto-start
 * (v1 + v2) stays suppressed -- a brand URL still in the prompt is treated as
 * plain content and never re-triggers extraction. The brief itself is untouched
 * in the library; only this session detaches.
 */
export function applyRemoveSavedBrandBrief(
  spec: Spec,
  op: RemoveSavedBrandBriefOp,
  context?: PatchContext,
): PatchResult {
  const err = assertRemovableInjectedBrief(spec, op.op, context)
  if (err) {
    return { spec, error: err }
  }
  clearInjectedBrief(spec)
  spec.global_constraints.brand_extraction_declined = true
  return { spec }
}

/**
 * "re-extract" / "refresh brand info": discard the saved brief and run a fresh
 * extraction. Resets the brand state to virgin so the deterministic auto-start
 * re-fires on the brand URL already in the transcript (the runtime owns firing
 * the extraction child; this op only clears state). declined stays false.
 */
export function applyReextractSavedBrandBrief(
  spec: Spec,
  op: ReextractSavedBrandBriefOp,
  context?: PatchContext,
): PatchResult {
  const err = assertRemovableInjectedBrief(spec, op.op, context)
  if (err) {
    return { spec, error: err }
  }
  clearInjectedBrief(spec)
  spec.global_constraints.brand_extraction_declined = false
  return { spec }
}

/**
 * "remove the brand brief" / "I don't want this brand" while reviewing a
 * freshly extracted brand: discard the bank and continue brand-less. Clears the
 * bank, lock, source, and pinned input (via clearInjectedBrief), raises
 * brand_extraction_declined so the brand URL still in the transcript never
 * re-fires extraction, and clears brand_video_type so the session is no longer
 * treated as a brand video. The runtime advances brand_review -> bootstrap_script
 * (see canonicalizePlannerPhase); this op only mutates state, never the phase.
 *
 * Hard-gated to brand_review + status 'completed', but source-agnostic: it clears
 * whatever bank is in review (fresh extraction, manual entry, or a brand_library
 * brief seeded into editable review). For a saved brief this detaches
 * it from THIS project only -- clearInjectedBrief nulls brand_bank_source; the
 * library BrandBrief is never touched. A drifted emit in any other phase must fail
 * loudly rather than wipe a locked or in-flight bank.
 */
export function applyDiscardBrandInReview(
  spec: Spec,
  op: DiscardBrandInReviewOp,
  context?: PatchContext,
): PatchResult {
  const phase = context?.phase
  if (phase !== 'brand_review') {
    return {
      spec,
      error: `INVALID_BRAND_TRANSITION: ${op.op} requires todo_state.phase === 'brand_review' (current: ${phase ?? 'null'})`,
    }
  }
  const status = spec.global_constraints.brand_extraction_status
  if (status !== 'completed') {
    return {
      spec,
      error: `INVALID_BRAND_TRANSITION: ${op.op} requires brand_extraction_status === 'completed' (current: ${status ?? 'null'})`,
    }
  }
  clearInjectedBrief(spec)
  spec.global_constraints.brand_extraction_declined = true
  spec.global_constraints.brand_video_type = null
  return { spec }
}
