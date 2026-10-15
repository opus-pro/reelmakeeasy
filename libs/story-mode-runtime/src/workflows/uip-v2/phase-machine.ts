/**
 * UIP V2 phase machine.
 *
 * Forward-only phase progression: read the event log + the events appended
 * since the last phase change, and append `phase_changed` / `review_gate_opened`
 * events. Session TERMINATION (refinement lock / cancel) is NOT done here -- the
 * main loop (Phase 3) calls `shouldTerminateByLock` / `handleSessionLock`, which
 * live here because they are pure phase-log logic, but `advancePhase` itself is
 * strictly forward-only and has no `refinement` case.
 *
 * Imports (workflow code, kept light):
 *   - `@reelmakeeasy/uip-planner-runtime` is imported via `import type` ONLY.
 *   - VALUE imports only from local pure modules (`./folds`, `./event-log`).
 *   - `uuid4` from `@reelmakeeasy/workflow-engine/workflow` mints review-gate tokens.
 *   - Time via the global `Date.now()`.
 */

import type { PatchOp, PlannerPhase, PlannerToolCall } from '@reelmakeeasy/uip-planner-runtime'
import { uuid4 } from '@reelmakeeasy/workflow-engine/workflow'

import {
  autoStyleSelectionPending,
  foldGlobalStyle,
  foldStyleCatalog,
  isAutoStyleSession,
} from './auto-style-advance'
import { appendEvent } from './event-log'
import {
  brandStatus,
  foldPhase,
  foldSpecVersion,
  hasArmSuccess,
  hasAudio,
  hasBrandInput,
  hasUnprocessedConfirm,
  hasUnprocessedFastConfirm,
  intentContextComplete,
  isAwaitingMusicBeatSheet,
  seededEditableBrandReview,
  toolSucceeded,
  unprocessedSincePhase,
} from './folds'
import type { AgentEvent, WorkflowState } from './types'

/** The 6 tool names; authoritative union is `PlannerToolCall['tool']`. */
type ToolName = PlannerToolCall['tool']

/**
 * Mirror of `ANIMATION_ID` from @reelmakeeasy/uip-planner-runtime's style-catalog.ts.
 * The module docstring keeps VALUE imports from the planner runtime out of
 * this file, so the constant is re-declared here as a local literal. The
 * fallback-default seeding at bootstrap_visual entry skips this preset (see
 * `heuristicRank`'s anti-Animation guardrail for the rationale).
 */
const AUTO_STYLE_ANIMATION_PRESET_ID = '3d-animation'

// ---------------------------------------------------------------------------
// Declarative transition table
// ---------------------------------------------------------------------------

/**
 * Legal `from -> to` phase transitions. `isValidTransition` is backed by this
 * table. `refinement` has no forward successor (its exits are termination,
 * handled by the main loop), so its list is empty.
 */
export const PHASE_TRANSITIONS: Record<PlannerPhase, PlannerPhase[]> = {
  mode_confirmation: ['bootstrap_visual', 'bootstrap_script', 'bootstrap_brand'],
  bootstrap_script: ['script_review'],
  script_review: ['bootstrap_visual'],
  bootstrap_visual: ['refinement'],
  refinement: [],
  bootstrap_brand: ['brand_review', 'bootstrap_script'],
  // brand_review -> bootstrap_brand is the re-extraction re-entry (v1
  // reenterBootstrapBrand parity): a user-requested source change drops back to
  // bootstrap_brand so the FE shows the extracting state instead of an empty
  // review card; the normal bootstrap_brand -> brand_review flow re-runs once the
  // fresh extraction completes.
  brand_review: ['bootstrap_brand', 'bootstrap_script'],
}

/** True iff `to` is a legal successor of `from` per `PHASE_TRANSITIONS`. */
export function isValidTransition(from: PlannerPhase, to: PlannerPhase): boolean {
  return PHASE_TRANSITIONS[from].includes(to)
}

// ---------------------------------------------------------------------------
// Per-phase tool allowlist
// ---------------------------------------------------------------------------

/**
 * Tools allowed per phase. Only the 6 generation tools are gated; actions
 * (ASK_CLARIFY / PATCH_SPEC / TODO_UPDATE_ONLY / SESSION_CONTROL /
 * MODE_CONFIRMED) are not gated and may be emitted in any phase. Mirrors
 * V1 `tool-runtime.ts` phase gating.
 */
export const ALLOWED_TOOLS_PER_PHASE: Record<PlannerPhase, ToolName[]> = {
  mode_confirmation: ['describe_uploaded_images'],
  bootstrap_script: [
    'generate_intent_context',
    'generate_explainer_script',
    'describe_uploaded_images',
    'select_auto_style',
  ],
  script_review: [],
  bootstrap_visual: [
    'generate_explainer_visual_script',
    'generate_anchor_assets',
    'plan_asset_assignment',
    'describe_uploaded_images',
  ],
  refinement: [
    'generate_explainer_visual_script',
    'generate_anchor_assets',
    'plan_asset_assignment',
    'generate_explainer_script',
    'describe_uploaded_images',
  ],
  bootstrap_brand: [],
  brand_review: [],
}

// ---------------------------------------------------------------------------
// Phase change + review gate
// ---------------------------------------------------------------------------

/**
 * Unified entry: validate the transition, then append a `phase_changed` event.
 * An illegal transition is a guarded no-op (no side effect;
 * no workflow-side logger is wired here so we simply return). `reason` carries
 * the trigger label per the `PhaseChangedEvent` interface.
 */
export function changePhase(
  state: WorkflowState,
  from: PlannerPhase,
  to: PlannerPhase,
  reason = 'planner_decision',
): void {
  if (!isValidTransition(from, to)) {
    return
  }
  appendEvent(state, {
    type: 'phase_changed',
    fromPhase: from,
    toPhase: to,
    reason,
    timestamp: new Date(Date.now()).toISOString(),
  })
}

/**
 * Open a review gate on entering a review phase: append `review_gate_opened`
 * with a fresh workflow-safe token. Projected to `session.review_gate`; signal
 * handlers validate the last token.
 */
export function openReviewGate(state: WorkflowState, kind: 'BRAND_REVIEW' | 'SCRIPT_REVIEW'): void {
  appendEvent(state, {
    type: 'review_gate_opened',
    gateKind: kind,
    token: uuid4(),
    timestamp: new Date(Date.now()).toISOString(),
  })
}

/**
 * The review gate that still needs opening, derived purely from the event log:
 * the current phase is a review phase AND no `review_gate_opened` has been
 * appended since the last `phase_changed`. Returns null otherwise.
 *
 * `advancePhase` appends the `phase_changed` into the review phase but does NOT
 * open the gate; the main loop calls this AFTER the planner reply and opens the
 * gate then, so the actionable button lands after its explanatory message
 * (phase_changed -> assistant_message -> review_gate_opened). The
 * "since the last phase_changed" guard makes it open exactly once per entry and
 * keeps the decision a pure projection (no transient workflow state).
 */
export function reviewGateToOpen(events: AgentEvent[]): 'BRAND_REVIEW' | 'SCRIPT_REVIEW' | null {
  const phase = foldPhase(events)
  const kind: 'BRAND_REVIEW' | 'SCRIPT_REVIEW' | null =
    phase === 'script_review' ? 'SCRIPT_REVIEW' : phase === 'brand_review' ? 'BRAND_REVIEW' : null
  if (!kind) {
    return null
  }
  const gateAlreadyOpen = unprocessedSincePhase(events).some((e) => e.type === 'review_gate_opened')
  return gateAlreadyOpen ? null : kind
}

// ---------------------------------------------------------------------------
// Forward-only phase driver
// ---------------------------------------------------------------------------

/**
 * Read the current phase + the events appended since the last phase change, and
 * advance forward if the trigger condition is met. Forward-only: there is NO
 * `refinement` case (its exits are termination, handled by the main loop via
 * `shouldTerminateByLock` / `handleSessionLock`).
 *
 * On a transition into a review phase it appends the `phase_changed` but does
 * NOT open the gate. The main loop opens the gate AFTER the planner reply (via
 * `reviewGateToOpen` + `openReviewGate`), so the button lands after its
 * explanation.
 */
export function advancePhase(state: WorkflowState): void {
  // Cascade: a single wake can satisfy several forward transitions whose
  // conditions are ALREADY met in the log. Motivating case: brand extraction is
  // started eagerly during mode_confirmation and can finish (brand_extraction_ready)
  // before mode_confirmed; that event is then consumed in the same turn that
  // routes mode_confirmation -> bootstrap_brand, leaving nothing to wake the loop
  // for bootstrap_brand -> brand_review. Re-running until the phase is stable
  // fixes it. Each step is forward-only and condition-gated, so the loop halts as
  // soon as a phase needs a not-yet-present tool/user event (bounded regardless;
  // PHASE_CASCADE_CAP is a belt-and-suspenders guard against an unexpected cycle).
  for (let pass = 0; pass < PHASE_CASCADE_CAP; pass++) {
    const phase = foldPhase(state.events)
    const recent = unprocessedSincePhase(state.events)

    // No 'refinement' case: refinement exits are termination (confirm /
    // auto-lock), handled by the main loop, not by this forward-only driver.
    switch (phase) {
      case 'bootstrap_brand': {
        advanceBootstrapBrand(state)
        break
      }
      case 'bootstrap_script': {
        advanceBootstrapScript(state, recent)
        break
      }
      case 'bootstrap_visual': {
        advanceBootstrapVisual(state, recent)
        break
      }
      case 'brand_review': {
        advanceBrandReview(state, recent)
        break
      }
      case 'mode_confirmation': {
        advanceModeConfirmation(state, recent)
        break
      }
      case 'script_review': {
        advanceScriptReview(state, recent)
        break
      }
    }

    if (foldPhase(state.events) === phase) {
      return // stable -- no transition this pass
    }
  }
}

/**
 * Upper bound on `advancePhase` cascade passes. Phase transitions are forward-only
 * over 7 phases, so a real cascade never exceeds a handful of steps; this only
 * guards against an unexpected cycle.
 */
const PHASE_CASCADE_CAP = 8

function advanceBootstrapBrand(state: WorkflowState): void {
  const status = brandStatus(state.events)
  // A seeded saved brief runs no extraction, so brandStatus stays null;
  // it still opens an editable brand_review. A real extraction reaches review via
  // status 'completed'.
  if (status === 'completed' || (status === null && seededEditableBrandReview(state.events))) {
    changePhase(state, 'bootstrap_brand', 'brand_review', 'tool_completed')
  } else if (status === 'failed') {
    // F1 skip: brand extraction failed -> proceed to bootstrap_script.
    changePhase(state, 'bootstrap_brand', 'bootstrap_script', 'tool_failed')
  }
}

function advanceBootstrapScript(state: WorkflowState, recent: AgentEvent[]): void {
  // No-audio: the planner runs generate_explainer_script; its success advances.
  // Audio: the planner never calls generate_explainer_script -- the contract
  // guard in checkToolCallsContract (planner-contract.ts) HARD-rejects it, so
  // the toolSucceeded() branch below can only fire for non-audio sessions. Do
  // NOT re-add a defensive "empty script -> advance" branch here: an audio
  // session can never produce a generate_explainer_script success. The audio
  // script comes from the uploaded audio, seeded as working_script
  // (working_script_seeded); advance once the seed AND a real intent-context
  // artifact are present, mirroring isBootstrapArtifactsComplete (intent context
  // + script). The intent-context guard is load-bearing: the empty first
  // intent_context call (missing-dependency race before the seed lands) must NOT
  // advance the phase, or downstream tools that need global_constraints are
  // stranded.
  const audioScriptReady =
    hasAudio(state.events) &&
    state.events.some((e) => e.type === 'working_script_seeded') &&
    intentContextComplete(state.events)
  if (!(toolSucceeded(recent, 'generate_explainer_script') || audioScriptReady)) {
    return
  }
  // Auto Style Selection terminal-state gate. select_auto_style is
  // dispatched by the runtime after the brief, concurrently with the script
  // (start-auto-style-child.ts). If the script finishes first, advancing here
  // would carry an EMPTY global_constraints.style into bootstrap_visual and the
  // visual-script render would go out unstyled -- the exact failure this feature
  // removes. So for an auto session, hold ONLY while the LATEST select_auto_style
  // dispatch is still in flight (autoStyleSelectionPending): a completed, failed,
  // OR cancelled pick unblocks (the empty-style fallback at bootstrap_visual
  // entry covers a failed/cancelled pick), and a session whose section 5 dispatch was
  // intentionally skipped (e.g. committed brand look) never held a pick at all,
  // so it advances on script success without hanging to the idle timeout. Gated
  // on the auto-mode fold so non-auto sessions advance on script success.
  if (isAutoStyleSession(state.events) && autoStyleSelectionPending(state.events)) {
    return
  }
  changePhase(state, 'bootstrap_script', 'script_review', 'tool_completed')
}

function advanceBootstrapVisual(state: WorkflowState, recent: AgentEvent[]): void {
  // bootstrap_visual advances on "both arms must succeed": only once
  // BOTH the anchor stage and the visual script have succeeded, read per-arm
  // (hasArmSuccess for 'anchor' + 'vs'). bootstrap_visual dispatches anchor + vs
  // as one anchor_vs_batch child, but a batch whose VS half failed is recovered
  // by a standalone generate_explainer_visual_script, and a batch whose anchor
  // half failed must not advance with a missing anchor stage.
  if (hasArmSuccess(recent, 'anchor') && hasArmSuccess(recent, 'vs')) {
    changePhase(state, 'bootstrap_visual', 'refinement', 'tool_completed')
  }
}

function advanceBrandReview(state: WorkflowState, recent: AgentEvent[]): void {
  if (recent.some((e) => e.type === 'user_confirm_brand_review')) {
    changePhase(state, 'brand_review', 'bootstrap_script', 'user_confirm_brand_review')
    return
  }
  // The user removed the brand from chat. The planner emits
  // discard_brand_in_review as a PATCH_SPEC (recorded as a spec_patched event);
  // there is nothing left to review, so continue brand-less to the same
  // destination as confirm. Reusing the confirm transition clears the review
  // gate identically. Source-agnostic: covers a fresh extraction, a manual-entry
  // bank, or a seeded saved-library brief -- all discardable here.
  if (
    recent.some(
      (e) => e.type === 'spec_patched' && e.ops.some((op) => op.op === 'discard_brand_in_review'),
    )
  ) {
    changePhase(state, 'brand_review', 'bootstrap_script', 'brand_discarded_in_review')
  }
}

function advanceModeConfirmation(state: WorkflowState, recent: AgentEvent[]): void {
  if (!recent.some((e) => e.type === 'mode_confirmed')) {
    return
  }
  // Route: brand intent -> bootstrap_brand; otherwise -> bootstrap_script.
  // bootstrap_script is the script-generation phase for BOTH audio (pre-voiceover
  // seeds the script, so it skips generate_explainer_script and gates straight to
  // script_review) and no-audio (the planner generates the script) sessions
  // (MODE_CONFIRMED -> bootstrap_script, which needs ASR done or no audio).
  // bootstrap_visual is only reached later, from script_review.
  // Brand intent -> bootstrap_brand. Either a live extraction input, or a seeded
  // saved brief that should open an editable brand_review (routes
  // bootstrap_brand -> brand_review with no extraction child).
  const next: PlannerPhase =
    (state.brandExtractionEnabled && hasBrandInput(state.events)) ||
    seededEditableBrandReview(state.events)
      ? 'bootstrap_brand'
      : 'bootstrap_script'
  changePhase(state, 'mode_confirmation', next, 'mode_confirmed')
}

function advanceScriptReview(state: WorkflowState, recent: AgentEvent[]): void {
  // Advance only on user_continue_draft. This is appended both by an explicit
  // "Create video" click AND by the deadline auto-continue: the main loop routes
  // a script_review deadline through the API (POST /deadline-expired,
  // intent=continue) so it runs the same orchestration as a click, and the API
  // signals uip-continue-draft back. A bare deadline_expired never self-advances
  // here.
  if (!recent.some((e) => e.type === 'user_continue_draft')) {
    return
  }
  // bootstrap_visual dispatches anchor + visual-script as one forced
  // shared batch (anchor_vs_batch). The VS half needs the music beat sheet, and
  // the anchor half cannot be split off to run alone -- so while the sheet is
  // still pending the planner has nothing productive to do. Hold the transition
  // (system-owned, mirroring the bootstrap_brand hold) until the beat sheet
  // resolves: the decision-worthy `music_beat_sheet` event re-wakes the loop, and
  // `unavailable` advances anyway (the VS tool falls back to ASR-timing). Only
  // music-candidate sessions are held (isAwaitingMusicBeatSheet); a non-candidate
  // session never receives the signal, so gating it would hang here forever.
  // Usual case is a no-op: the sheet is built back in
  // pre-voiceover, so it is normally already ready by the time the user clicks
  // Create -- the hold only bites the click-immediately race.
  if (isAwaitingMusicBeatSheet(state.events)) {
    return
  }
  // Auto Style Selection empty-style fallback: guarantee a non-empty
  // style at the bootstrap_visual (visual render) entry. Even with the terminal
  // gate above, an auto pick can land the phase here with an EMPTY style -- a
  // FAILED select_auto_style, or a completed run that degraded with an empty
  // catalog. Seed a safe default so the render is never unstyled. Gated on the
  // auto-mode fold so non-auto sessions get no extra spec_patched.
  if (isAutoStyleSession(state.events)) {
    maybeSeedFallbackStyle(state)
  }
  changePhase(state, 'script_review', 'bootstrap_visual', 'user_continue_draft')
}

/**
 * Seed the fallback-default style at bootstrap_visual entry when an auto session
 * still has an empty `global_constraints.style`. Picks the FIRST NON-Animation
 * preset from the seeded catalog (meta.style_catalog) and field-level-writes
 * `style` + `style_source='auto'` + `selection_method='fallback_default'` via a
 * system-sourced spec_patched -- the same persisted-ops path the select_auto_style
 * auto-apply uses (all four paths are in patch-apply's update_global_field
 * allowlist; the projection re-applies them via applyPatch). No-op when a
 * concrete style already exists (the normal auto-pick path) or when the catalog
 * has no non-Animation preset (empty / Animation-only) -- there we leave the
 * style empty and accept an unstyled render (pre-feature behavior), never
 * hardcoding a preset id.
 *
 * "A concrete style already exists" folds the brief's own auto-applied style:
 * a brand session that
 * committed a style has the auto pick deliberately suppressed and gets its brand
 * look from generate_intent_context's output, so without that fold this seeding
 * overwrote the user's brand style with the first catalog preset.
 */
function maybeSeedFallbackStyle(state: WorkflowState): void {
  const { styleName, styleText } = foldGlobalStyle(state.events)
  if (styleName.trim() !== '' || styleText.trim() !== '') {
    return
  }
  const preset = foldStyleCatalog(state.events).find((p) => p.id !== AUTO_STYLE_ANIMATION_PRESET_ID)
  if (!preset) {
    return
  }
  const ops: PatchOp[] = [
    {
      op: 'update_global_field',
      path: 'style',
      value: {
        style_name: preset.id,
        style_text: preset.styleText,
        style_thumbnail_url: preset.thumbnailUrl,
      },
    },
    { op: 'update_global_field', path: 'style_source', value: 'auto' },
    { op: 'update_global_field', path: 'selection_method', value: 'fallback_default' },
  ]
  appendEvent(state, {
    type: 'spec_patched',
    ops,
    source: 'system',
    specVersionAfter: foldSpecVersion(state.events) + 1,
    timestamp: new Date(Date.now()).toISOString(),
  })
}

// ---------------------------------------------------------------------------
// Termination handling (main loop 7b; not in advancePhase)
// ---------------------------------------------------------------------------

/**
 * Whether the session should terminate by lock.
 *   - In `refinement`: true on any unprocessed `user_confirm` (the explicit HITL
 *     lock; also the landing point for the refinement deadline auto-confirm).
 *   - In any other phase (i.e. `script_review`): true ONLY on an unprocessed
 *     confirm_fast (a `user_confirm` with `fast === true`). confirm_fast skips
 *     HITL and is fired from `script_review`, so it must lock from there --
 *     mirroring V1, where confirm AND confirm_fast both set `locked_at` and exit
 *     regardless of phase. Without this the session never terminates on the fast
 *     path and lingers as a zombie until the 3h idle timeout.
 *
 * A refinement `deadline_expired` is deliberately NOT a lock trigger here. The
 * actual video-gen handoff is owned by the API
 * (executeConfirmOrchestration), which is also the writer of uipSession.lockedAt.
 * If the workflow self-locked first, the persist callback would set lockedAt and
 * the orchestration would short-circuit (it skips when lockedAt is set) -- so the
 * auto-lock would never start video-gen. Instead the main loop routes the
 * refinement deadline through the API (POST /deadline-expired, intent=confirm,
 * mirroring V1's checkDeadlineExpiredActivity); the orchestration signals
 * `uip-confirm` back and the lock then lands via the user_confirm path above.
 * For confirm_fast, the API likewise starts UipToStoryModeFastWorkflow + commits
 * the lock BEFORE signalling `uip-confirm-fast`, so this just mirrors that.
 *
 * M2 fix: accepts processedDecisionCount so that only genuinely unprocessed
 * events are inspected, preventing a previously-handled confirm from
 * re-triggering a lock on the next wake. Mirrors the hasUnprocessedCancel pattern.
 */
export function shouldTerminateByLock(
  state: WorkflowState,
  processedDecisionCount: number,
): boolean {
  if (foldPhase(state.events) === 'refinement') {
    return hasUnprocessedConfirm(state.events, processedDecisionCount)
  }
  // Non-refinement: only confirm_fast locks (skips HITL, fired from script_review).
  return hasUnprocessedFastConfirm(state.events, processedDecisionCount)
}

/**
 * Execute the lock termination: append `session_locked` (autoLocked
 * distinguishes explicit confirm vs deadline auto-lock) and set `isLocked`. The
 * actual video-gen kickoff is owned by the API layer; the workflow only marks
 * termination here. `projectId` is accepted to match the main-loop call site
 * (Phase 3 wires it through) even though Phase 1 does not need it.
 *
 * M2 fix: accepts processedDecisionCount to determine whether the lock was
 * explicitly confirmed by the user (user_confirm unprocessed) or triggered by
 * the deadline (auto-lock).
 */
export function handleSessionLock(
  state: WorkflowState,
  _projectId: string,
  processedDecisionCount: number,
): void {
  const autoLocked = !hasUnprocessedConfirm(state.events, processedDecisionCount)
  const lockedAt = new Date(Date.now()).toISOString()
  appendEvent(state, {
    type: 'session_locked',
    autoLocked,
    lockedAt,
    timestamp: lockedAt,
  })
  state.isLocked = true
}

// hasUnprocessedConfirm lives in ./folds (next to hasUnprocessedCancel) so it
// shares the canonical DECISION_WORTHY_EVENT_TYPES set; see its doc comment.
