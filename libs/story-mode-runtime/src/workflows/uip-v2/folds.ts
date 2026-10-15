/**
 * UIP V2 leaf folds: pure projections over the AgentEvent log.
 *
 * These functions run inside workflow code, so their imports stay light:
 *   - `@reelmakeeasy/uip-planner-runtime` is imported via `import type` ONLY (zero value
 *     imports), so no Node-only runtime tree is dragged into workflow code.
 *   - No `@reelmakeeasy/workflow-engine` import.
 *   - All event/state types come from the local `./types` module.
 *
 * Determinism: every fold is pure (reads events, returns a value). No
 * `Date.now()` is called inside a fold; helpers that need wall-clock take `now`
 * as an argument (see `computeIdleWaitMs`). `nowMs` derives time from the last
 * event's `at` rather than the system clock.
 */

import { USER_INACTIVITY_TIMEOUT_MS } from '@reelmakeeasy/common/workflow/uip-v2-deadline-policy'
import type { CancellableToolName } from '@reelmakeeasy/common/workflow/uip-v2-signal-names'
import type { PlannerPhase } from '@reelmakeeasy/uip-planner-runtime'

// Type-only import of the batch output shape (same precedent as execute-decision.ts).
// folds.ts is workflow code; a type-only import carries no runtime cost.
import type { AnchorVsBatchOutput } from '../../activities/uip-v2/tools/anchor-vs-batch'

import type { AgentEvent, ArtifactSlot, ToolStartedEvent } from './types'

// ---------------------------------------------------------------------------
// Constants (mirrored from V1; cited)
// ---------------------------------------------------------------------------

/**
 * Script-review auto-continue delay. Mirrors V1
 * `libs/uip-planner-runtime/src/runtime/constants.ts`
 * `REVIEW_AUTO_CONTINUE_DELAY_MS = 5 * 60 * 1000`.
 */
export const REVIEW_AUTO_CONTINUE_DELAY_MS = USER_INACTIVITY_TIMEOUT_MS

/**
 * Refinement auto-lock delay. Mirrors V1
 * `libs/uip-planner-runtime/src/runtime/spec-runtime.ts`
 * `AUTO_LOCK_DELAY_MS = 5 * 60 * 1000`.
 */
export const AUTO_LOCK_DELAY_MS = USER_INACTIVITY_TIMEOUT_MS

/**
 * Auto-continue delay for a seeded/reused brand_review. Matches the
 * 5-min script review window so the auto-proceed copy is consistent across
 * review gates.
 */
export const BRAND_REVIEW_AUTO_CONTINUE_DELAY_MS = USER_INACTIVITY_TIMEOUT_MS

/**
 * Cap on cumulative deadline auto-extends across the session lifetime (NOT reset
 * between phases). When the deadline fires while the session is still busy (a
 * planner turn or tool in flight), the sync loop defers via a `deadline_extended`
 * event instead of firing. This cap bounds how many times that can happen so a
 * wedged planner cannot keep the gate open forever; past it the sync loop fires
 * `deadline_expired` (force auto-continue / auto-lock). Mirrors V1
 * `MAX_AUTO_EXTENDS` in `workflows/uip/turn-executor.ts`. 12 * REVIEW_AUTO_CONTINUE_DELAY_MS
 * (~1h at the 5-min default) covers realistic active sessions.
 */
export const MAX_AUTO_EXTENDS = 12

/**
 * Word cap mirrored from V1
 * `libs/shared/common/src/story-mode/user-limits.ts`:
 *   EXPANDED_STORY_MODE_LIMITS.absoluteMaxScriptWords = 1700
 *
 * PHASE-2 RECONCILE: the authoritative cap audit is V1 `auditScriptWordCap`
 * (which also returns null for audio-mode sessions and uses a CJK-aware word
 * count). This leaf flag is a lightweight pure MIRROR used only to pause the
 * deadline timer; exact parity (audio-mode skip, CJK counting) is reconciled in
 * Phase 2 foldSession.
 */
export const SCRIPT_WORD_CAP = 1700

/**
 * Event types whose persist tick can be publish-only (`skipPersist`):
 * appending one leaves every payload `persistSessionSnapshot` writes identical
 * (except the assistant_message transcript row, whose reload consumer is the
 * publish-fed timeline; the /persist-fed history table is read only after
 * planning ends, behind a terminal full persist, and back-fills from the
 * cumulative transcript). planner_start / user_wake are pure control events in
 * foldSession; todo_updated feeds todo_state, whose only persisted projection
 * is `phase` (foldPhase, derived from phase_changed events only).
 * tool_substep folds only into tool_call_states[].sub_tools, which
 * buildPersistedPayloads strips from every persisted payload (publish-only).
 * deadline_extended is deliberately absent: it resets foldDeadline, which
 * foldSession stamps into PERSISTED state in gate phases
 * (review_auto_continue_deadline_at at script_review, and
 * spec.meta.auto_lock_deadline_at inside the spec at refinement).
 * transient-events.test.ts asserts payload identity for every type listed here
 * (including spec-history-turns) -- extend the list only with that proof.
 * Lives in this pure module (not sync-loop.ts) so the activity-side drift test
 * can import it without pulling in workflow code.
 */
export const TRANSIENT_EVENT_TYPES: readonly AgentEvent['type'][] = Object.freeze([
  'assistant_message',
  'planner_start',
  'todo_updated',
  'tool_substep',
  'user_wake',
])

// A Set for O(1) lookup; kept private so no importer can mutate the
// classification at runtime (ReadonlySet is compile-time only).
const transientEventTypeSet: ReadonlySet<AgentEvent['type']> = new Set(TRANSIENT_EVENT_TYPES)

/** Whether a persist tick triggered only by this event type may skip persist. */
export function isTransientEventType(type: AgentEvent['type']): boolean {
  return transientEventTypeSet.has(type)
}

// ---------------------------------------------------------------------------
// Decision-worthy predicate (CRITICAL; doc lines 660-692)
// ---------------------------------------------------------------------------

/**
 * Authoritative wake predicate. Cross-checked against doc lines 660-692 (table)
 * AND the per-event annotations in types.ts. An event of one of these types,
 * once appended, makes the main loop's condition() fire.
 *
 * `mode_confirmed` must be decision-worthy so the loop self-advances the phase
 * after the planner confirms mode (otherwise the loop parks). The three brand
 * events arrive from child / API signal handlers and must wake the loop to
 * advance the brand phases. `pre_voiceover_script_ready` IS decision-worthy per
 * the event table (doc line 687: the canonical voiceOverPath update
 * `pre_voiceover_artifacts_ready` is passive, but script_ready wakes the loop).
 *
 * Passive (deliberately NOT in the set): planner_decided, planner_start,
 * tool_started, deadline_extended (re-arms the timer + publishes, but must not
 * wake the loop), gate_deadline_dispatched (dispatch-dedup marker; must not wake
 * the loop), phase_changed, assistant_message, session_initialized,
 * spec_patched (passive, except a planner-sourced spec_patched, which is
 * decision-worthy -- see eventCountsAsDecision),
 * working_script_seeded, working_script_updated,
 * pre_voiceover_artifacts_ready,
 * user_activity, user_auto_continue_changed (a foldDeadline reset that must
 * not wake the planner), recovery_failure, compaction, todo_updated, review_gate_opened,
 * brand_bank_edited, session_locked/cancelled/failed/timed_out, AND
 * user_gui_update / user_script_review_update (these write spec / extend the
 * deadline but do NOT wake the planner). user_cancel_queued_item is also kept
 * out of the wake set here -- it is handled out-of-band and is not part of the
 * wake table.
 */
const DECISION_WORTHY_EVENT_TYPES = new Set<AgentEvent['type']>([
  'brand_extraction_failed',
  'brand_extraction_ready',
  'deadline_expired',
  'mode_confirmed',
  'music_beat_sheet',
  'pre_voiceover_script_ready',
  'tool_cancelled',
  'tool_completed',
  'tool_failed',
  'user_cancel',
  'user_cancel_tool',
  'user_confirm',
  'user_confirm_brand_review',
  'user_continue_draft',
  'user_gui_wake',
  'user_message',
  'user_wake',
])

/**
 * SINGLE SOURCE OF TRUTH for "does this event advance the decision boundary".
 *
 * `countDecisionWorthy` AND every boundary-consumer predicate
 * (hasUnprocessedCancel / hasUnprocessedConfirm / hasUnprocessedFastConfirm /
 * unprocessedDecisionEvents) MUST route through this so their `seen` index stays
 * aligned with `processedDecisionCount`. A divergent rule drifts the index by
 * the count of the mismatched event type, and a real user_confirm / user_cancel
 * past the boundary is then never detected (the refinement-lock / cancel misfire
 * flagged in review).
 *
 * A planner-sourced `spec_patched` ALSO counts, so the loop re-wakes the planner after
 * a PATCH_SPEC to execute the follow-up realization directive. Only
 * `source==='planner'` qualifies -- deadline/session_control/system/user_signal
 * patches must NOT wake the loop, and tool auto-apply emits no spec_patched event
 * at all (it is applied in foldSession), so it is inherently excluded.
 */
export function eventCountsAsDecision(e: AgentEvent): boolean {
  return (
    DECISION_WORTHY_EVENT_TYPES.has(e.type) || (e.type === 'spec_patched' && e.source === 'planner')
  )
}

/** Count of events that advance the decision boundary. */
export function countDecisionWorthy(events: AgentEvent[]): number {
  let count = 0
  for (const e of events) {
    if (eventCountsAsDecision(e)) {
      count++
    }
  }
  return count
}

/** Whether there is at least one decision-worthy event past the processed boundary. */
export function hasUnprocessedDecisionEvent(
  events: AgentEvent[],
  processedDecisionCount: number,
): boolean {
  return countDecisionWorthy(events) > processedDecisionCount
}

// ---------------------------------------------------------------------------
// Phase
// ---------------------------------------------------------------------------

/**
 * Fold the current phase from the log. Starts at 'mode_confirmation';
 * phase_changed.toPhase is authoritative.
 */
export function foldPhase(events: AgentEvent[]): PlannerPhase {
  let phase: PlannerPhase = 'mode_confirmation'
  for (const e of events) {
    if (e.type === 'phase_changed') {
      phase = e.toPhase
    }
  }
  return phase
}

/** Current spec version: the last spec_patched.specVersionAfter, else 0. */
export function foldSpecVersion(events: AgentEvent[]): number {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.type === 'spec_patched') {
      return e.specVersionAfter
    }
  }
  return 0
}

// ---------------------------------------------------------------------------
// Light spec (lightweight pure mirror)
// ---------------------------------------------------------------------------

interface LightSpec {
  hasScript: boolean
  wordCapExceeded: boolean
}

/**
 * Resolve the current working-script text from events / artifacts. The latest
 * working_script_updated / working_script_seeded event wins; otherwise the
 * `working_script` artifact slot's `script` field.
 */
function currentWorkingScript(
  events: AgentEvent[],
  currentArtifacts: Record<string, ArtifactSlot>,
): string {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.type === 'working_script_updated') {
      return e.script ?? ''
    }
    if (e.type === 'working_script_seeded') {
      return e.scriptText ?? ''
    }
  }
  const slot = currentArtifacts.working_script
  const current = slot?.current as undefined | { script?: string }
  return current?.script ?? ''
}

/**
 * Per-session auto-continue setting. Latest wins: the most recent
 * user_auto_continue_changed event (mid-session flip via the in-session
 * control), falling back to the session_initialized snapshot (the initial
 * value at create). Only an explicit `false` opts out; absent (older
 * event logs / default) keeps the legacy always-on behavior: pre-change
 * event logs carry neither the snapshot field nor flip events.
 */
export function foldAutoContinueEnabled(events: AgentEvent[]): boolean {
  const flip = findLast(events, (e) => e.type === 'user_auto_continue_changed')
  if (flip?.type === 'user_auto_continue_changed') {
    return flip.enabled
  }
  for (const e of events) {
    if (e.type === 'session_initialized') {
      return e.params.autoContinueEnabled !== false
    }
  }
  return true
}

/** Effective word cap for the session -- the single TTS-vendor ceiling. */
function effectiveWordCap(): number {
  return SCRIPT_WORD_CAP
}

/**
 * Lightweight booleans read from events / artifacts. See SCRIPT_WORD_CAP_*
 * comment for the Phase-2 reconcile note on wordCapExceeded.
 */
export function foldLightSpec(
  events: AgentEvent[],
  currentArtifacts: Record<string, ArtifactSlot>,
): LightSpec {
  const script = currentWorkingScript(events, currentArtifacts)
  return {
    hasScript: countWords(script) > 0,
    wordCapExceeded: countWords(script) > effectiveWordCap(),
  }
}

// ---------------------------------------------------------------------------
// Deadline (subtle)
// ---------------------------------------------------------------------------

/**
 * Project the current auto-continue / auto-lock deadline (ms epoch), or null
 * when no timer should run.
 */
export function foldDeadline(
  events: AgentEvent[],
  currentArtifacts: Record<string, ArtifactSlot>,
): null | number {
  // Per-session auto-continue setting (initial value at create, then
  // flippable mid-session via the in-session control). When off, no gate arms a
  // timer, so the planner waits for explicit user action at every review
  // (script_review, refinement, seeded brand_review) and routeGateDeadline's
  // side effects (auto-continue / auto-lock / self-confirm) are never reached.
  // Folded from the event log (latest flip wins) so BOTH callers (the workflow
  // sync loop AND the foldSession projection that stamps
  // review_auto_continue_deadline_at / auto_lock_deadline_at for the FE
  // countdown) honor it uniformly. Absent/true preserves the legacy always-on
  // behavior -- an older event log has no snapshot field and no flip
  // events, so it keeps the always-on default (same as longVideoEnabled).
  if (!foldAutoContinueEnabled(events)) {
    return null
  }
  const phase = foldPhase(events)
  // brand_review auto-continue applies ONLY to a seeded/reused brief.
  const brandReviewTimed = phase === 'brand_review' && seededEditableBrandReview(events)
  if (phase !== 'script_review' && phase !== 'refinement' && !brandReviewTimed) {
    return null
  }

  // Self-cancel: a pending (unconsumed / not-superseded) deadline_expired stops
  // the timer (fire-side dedup + "timer already stopped" marker).
  if (hasPendingDeadlineExpired(events)) {
    return null
  }

  // Word-cap exceeded pauses the countdown.
  if (foldLightSpec(events, currentArtifacts).wordCapExceeded) {
    return null
  }

  // Events that extend the deadline: user activity, a GUI/script edit, a planner
  // turn deciding, or a tool completing while in the gate phase.
  // user_gui_update / user_script_review_update are live user edits to the
  // transcript / working script -- an active edit must restart the inactivity
  // clock (their event-type comments promise "extends deadline"), otherwise the
  // auto-continue / auto-lock could fire mid-edit. planner_decided + tool_completed
  // mean the session just made progress, so the idle clock restarts from there
  // (this is also what keeps the timer from firing across a long refinement
  // regeneration -- see the busy-defer path in the sync loop, which appends
  // deadline_extended, also a reset). phase_changed is intentionally excluded -- it
  // was previously included as a proxy for the phase-entry baseline, but
  // phaseEnteredAt(events, phase) is the correct and explicit way to express that.
  // findLast scans all events (including pre-phase ones), so we take Math.max with
  // phaseEnteredAt to ensure the baseline is never earlier than phase entry.
  // user_auto_continue_changed is a reset so flipping auto-continue back ON
  // arms a fresh delay from the flip, never firing instantly off a stale
  // pre-flip baseline.
  const lastReset = findLast(
    events,
    (e) =>
      e.type === 'user_message' ||
      e.type === 'user_activity' ||
      e.type === 'user_auto_continue_changed' ||
      e.type === 'user_gui_update' ||
      e.type === 'user_script_review_update' ||
      e.type === 'planner_decided' ||
      e.type === 'tool_completed' ||
      e.type === 'deadline_extended',
  )
  const phaseStart = phaseEnteredAt(events, phase)
  const baseMs = Math.max(lastReset?.at ?? 0, phaseStart)
  const delayMs =
    phase === 'refinement'
      ? AUTO_LOCK_DELAY_MS
      : phase === 'brand_review'
        ? BRAND_REVIEW_AUTO_CONTINUE_DELAY_MS
        : REVIEW_AUTO_CONTINUE_DELAY_MS
  return baseMs + delayMs
}

/**
 * Whether an unconsumed / not-superseded deadline_expired is queued. Scan
 * backward: a deadline_expired seen first => pending; any reset / consume event
 * seen first => not pending.
 *
 * Used by foldDeadline to NULL the timer until the phase actually advances
 * (phase_changed / session_locked). It deliberately does NOT treat
 * user_continue_draft / user_confirm as resets: the API's signal-back to a routed
 * deadline must NOT re-arm the timer (that would let foldDeadline recompute a
 * stale past baseline and the sync loop re-fire). Whether the main loop should
 * still DISPATCH is a different question -- see hasUndispatchedGateDeadline.
 */
export function hasPendingDeadlineExpired(events: AgentEvent[]): boolean {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.type === 'deadline_expired') {
      return true
    }
    if (
      e.type === 'phase_changed' ||
      e.type === 'session_locked' ||
      e.type === 'user_message' ||
      e.type === 'user_activity' ||
      e.type === 'tool_completed' ||
      e.type === 'deadline_extended'
    ) {
      return false
    }
  }
  return false
}

/**
 * Whether a fired gate deadline still needs routing to the API. Distinct from
 * hasPendingDeadlineExpired (which keeps the timer null until phase_changed): this
 * answers "do we still need to CALL the API", not "is the timer suppressed". Scan
 * backward and stop on:
 *   - gate_deadline_dispatched: we already routed this deadline to the API. The
 *     marker is the explicit dedup -- once present, the API's signal-back
 *     (uip-continue-draft / uip-confirm) cannot make routeGateDeadline re-dispatch
 *     and storm the API. advancePhase / 7b consume that signal to transition.
 *   - user_message / user_activity: a genuine user action after the fire
 *     supersedes the auto-action -- don't auto-confirm/continue an active user.
 * phase_changed / session_locked are intentionally NOT listed: routeGateDeadline
 * already guards on the phase being a gate phase (and a refinement lock breaks the
 * loop), so a moved-on phase never reaches here. tool_completed / deadline_extended
 * cannot follow a deadline_expired (busy-defer fires only when idle, and extends
 * INSTEAD of firing).
 */
export function gateDeadlineNeedsDispatch(events: AgentEvent[]): boolean {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (
      e.type === 'gate_deadline_dispatched' ||
      // A deadline_extended after a fired deadline means routeGateDeadline already
      // handled that fire by re-arming it (extend), so the consumed deadline_expired behind it must NOT be
      // re-dispatched. The next (re-armed) fire appends a fresh deadline_expired
      // that sits on top and dispatches normally. Without this stop, a wake
      // between the re-arm and the next fire would scan past deadline_extended to
      // the old deadline_expired and spuriously re-dispatch it.
      e.type === 'deadline_extended' ||
      e.type === 'user_message' ||
      e.type === 'user_activity'
    ) {
      return false
    }
    if (e.type === 'deadline_expired') {
      return true
    }
  }
  return false
}

/**
 * Cumulative count of deadline auto-extends (`deadline_extended` events) over the
 * session lifetime -- the budget checked against MAX_AUTO_EXTENDS by the sync
 * loop's busy-defer path. Cumulative across phases (mirrors V1
 * `auto_extend_count`); compaction preserves these events so the count survives a
 * continueAsNew handoff.
 */
export function countDeadlineExtends(events: AgentEvent[]): number {
  let n = 0
  for (const e of events) {
    if (e.type === 'deadline_extended') {
      n++
    }
  }
  return n
}

// ---------------------------------------------------------------------------
// Cancel + wake
// ---------------------------------------------------------------------------

/**
 * Whether a user_cancel sits among the unprocessed decision-worthy tail (past
 * the processed boundary).
 */
export function hasUnprocessedCancel(
  events: AgentEvent[],
  processedDecisionCount: number,
): boolean {
  let seen = 0
  for (const e of events) {
    if (!eventCountsAsDecision(e)) {
      continue
    }
    seen++
    if (seen > processedDecisionCount && e.type === 'user_cancel') {
      return true
    }
  }
  return false
}

/**
 * Whether a user_confirm sits among the unprocessed decision-worthy tail (past
 * the processed boundary). Counterpart to hasUnprocessedCancel; MUST share the
 * canonical DECISION_WORTHY_EVENT_TYPES set so its `seen` index stays aligned
 * with processedDecisionCount (which countDecisionWorthy derives from the same
 * set). A divergent set drifts the index by the count of the missing event
 * types (e.g. user_confirm_brand_review, pre_voiceover_script_ready), so the
 * refinement-lock confirm is never detected on branded/audio sessions.
 */
export function hasUnprocessedConfirm(
  events: AgentEvent[],
  processedDecisionCount: number,
): boolean {
  let seen = 0
  for (const e of events) {
    if (!eventCountsAsDecision(e)) {
      continue
    }
    seen++
    if (seen > processedDecisionCount && e.type === 'user_confirm') {
      return true
    }
  }
  return false
}

/**
 * Whether a confirm_fast (a `user_confirm` with `fast === true`) sits among the
 * unprocessed decision-worthy tail. confirm_fast skips HITL refinement and is
 * fired from `script_review`, so -- unlike a normal refinement confirm -- it must
 * be able to lock the session from a non-refinement phase (mirrors V1, where
 * confirm AND confirm_fast both set `locked_at` and exit regardless of phase).
 * Shares DECISION_WORTHY_EVENT_TYPES for index alignment, same rationale as
 * hasUnprocessedConfirm.
 */
export function hasUnprocessedFastConfirm(
  events: AgentEvent[],
  processedDecisionCount: number,
): boolean {
  let seen = 0
  for (const e of events) {
    if (!eventCountsAsDecision(e)) {
      continue
    }
    seen++
    if (seen > processedDecisionCount && e.type === 'user_confirm' && e.fast === true) {
      return true
    }
  }
  return false
}

/** The unprocessed decision-worthy events (past the processed boundary). */
export function unprocessedDecisionEvents(
  events: AgentEvent[],
  processedDecisionCount: number,
): AgentEvent[] {
  const out: AgentEvent[] = []
  let seen = 0
  for (const e of events) {
    if (!eventCountsAsDecision(e)) {
      continue
    }
    seen++
    if (seen > processedDecisionCount) {
      out.push(e)
    }
  }
  return out
}

/** Whether the only unprocessed decision-worthy event is a user_wake. */
export function isOnlyUnprocessedWake(
  events: AgentEvent[],
  processedDecisionCount: number,
): boolean {
  const pending = unprocessedDecisionEvents(events, processedDecisionCount)
  return pending.length === 1 && pending[0].type === 'user_wake'
}

/**
 * Whether every unprocessed decision-worthy event is a `music_beat_sheet`
 * signal (and there is at least one). The planner never acts on this control signal
 * directly -- its only consumers are structural (the script_review phase gate + the
 * spec.meta fold). So when such a signal lands WITHOUT moving the phase (the common
 * case: the analysis finishes while the user is still reviewing the script, before
 * the Create click), the main loop consumes it and skips the planner turn rather
 * than waking it for a no-op -- mirroring why pre_voiceover_artifacts_ready stays
 * passive. When it DOES move the phase (the click-immediately race), advancePhase
 * runs first and the planner then runs in bootstrap_visual.
 */
export function isOnlyUnprocessedMusicBeatSheet(
  events: AgentEvent[],
  processedDecisionCount: number,
): boolean {
  const pending = unprocessedDecisionEvents(events, processedDecisionCount)
  return pending.length > 0 && pending.every((e) => e.type === 'music_beat_sheet')
}

/**
 * Distinct toolNames named by unprocessed `user_cancel_tool` events (past the
 * processed boundary). Empty when there is no pending per-tool cancel. Drives
 * the main-loop cancel fast-path.
 */
export function unprocessedToolCancelTargets(
  events: AgentEvent[],
  processedDecisionCount: number,
): CancellableToolName[] {
  const out: CancellableToolName[] = []
  for (const e of unprocessedDecisionEvents(events, processedDecisionCount)) {
    if (e.type === 'user_cancel_tool' && !out.includes(e.toolName)) {
      out.push(e.toolName)
    }
  }
  return out
}

/**
 * Whether every unprocessed decision-worthy event is a `tool_cancelled`
 * (and there is at least one). Post-feature `tool_cancelled` only originates from a
 * deliberate cancel (session-cancel terminates anyway; per-tool cancel should
 * pause), so when the only new decision events are cancel-completions the main loop
 * consumes them and skips the planner turn -- the session idles awaiting the next
 * user message. Mirrors isOnlyUnprocessedWake / isOnlyUnprocessedMusicBeatSheet.
 */
export function isOnlyUnprocessedToolCancelled(
  events: AgentEvent[],
  processedDecisionCount: number,
): boolean {
  const pending = unprocessedDecisionEvents(events, processedDecisionCount)
  return pending.length > 0 && pending.every((e) => e.type === 'tool_cancelled')
}

/** Whether the last appended unprocessed decision-worthy event is a user_wake. */
export function isLastUnprocessedWake(
  events: AgentEvent[],
  processedDecisionCount: number,
): boolean {
  const pending = unprocessedDecisionEvents(events, processedDecisionCount)
  return pending.length > 0 && pending[pending.length - 1].type === 'user_wake'
}

/**
 * Count of consecutive trailing planner `spec_patched` "turns" -- i.e. how many
 * times in a row the planner has patched the brief WITHOUT making real progress
 * (no tool dispatch / completion, no user input) since. Scans from the end:
 * counts planner patches, skips passive turn scaffolding (planner_start/_decided,
 * assistant_message, todo_updated, etc.), and resets at the first tool or user
 * event. Used to bound the patch-re-wake loop: a healthy planner realizes
 * on the re-wake (a tool event resets this to 0); a degraded planner that only
 * ever patches would otherwise re-wake forever.
 *
 * A `phase_changed` or a `user_confirm_brand_review` also ends the
 * spin. A spin is per-phase: when the
 * session advances phases (or the user confirms the brand review, which advances
 * brand_review -> bootstrap_script), the next phase's first planner turn is real
 * progress and must NOT inherit the previous phase's patch count -- otherwise the
 * spin guard would wrongly muzzle it (observed: a brand_review patch spin
 * leaked across the confirm and suppressed bootstrap_script script
 * generation -> idle timeout).
 */
export function consecutivePlannerPatchWakes(events: AgentEvent[]): number {
  let count = 0
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.type === 'spec_patched' && e.source === 'planner') {
      count++
      continue
    }
    // Real progress (a tool ran, or the user acted) ends the spin.
    if (
      e.type === 'tool_started' ||
      e.type === 'tool_completed' ||
      e.type === 'tool_failed' ||
      e.type === 'tool_cancelled' ||
      e.type === 'user_message' ||
      e.type === 'user_wake' ||
      e.type === 'user_confirm' ||
      e.type === 'user_cancel' ||
      e.type === 'mode_confirmed' ||
      e.type === 'phase_changed' ||
      e.type === 'user_confirm_brand_review'
    ) {
      break
    }
    // else: passive turn scaffolding -- keep scanning past it.
  }
  return count
}

// ---------------------------------------------------------------------------
// Per-turn derivations
// ---------------------------------------------------------------------------

/** Per-turn step index: number of planner_decided since the last user_message. */
export function getStepIndex(events: AgentEvent[]): number {
  let count = 0
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.type === 'user_message') {
      break
    }
    if (e.type === 'planner_decided') {
      count++
    }
  }
  return count
}

/**
 * Short string describing the most recent tool outcome, fed to the planner.
 * '<toolName>:succeeded' / '<toolName>:failed:<code>', or '' if none recent.
 */
export function getLastActionResult(events: AgentEvent[]): string {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.type === 'tool_completed') {
      // anchor_vs_batch reports a single tool_completed; per-sub-tool ok/fail is
      // encoded in the output. Surface a sub-tool failure (with its message) so
      // the planner sees WHY a batch member failed instead of "succeeded".
      if (e.toolName === 'anchor_vs_batch') {
        return batchActionResult(e.output as AnchorVsBatchOutput | undefined)
      }
      return `${e.toolName}:succeeded`
    }
    if (e.type === 'tool_failed') {
      // Include the full errorMessage so the planner can reason about why the
      // tool failed and choose a different approach (e.g. narrow the scope,
      // ask the user). The errorCode alone is opaque to the LLM.
      const msg = e.errorMessage?.trim()
      return msg
        ? `${e.toolName}:failed:${e.errorCode}: ${msg}`
        : `${e.toolName}:failed:${e.errorCode}`
    }
    if (e.type === 'tool_cancelled') {
      return `${e.toolName}:cancelled`
    }
  }
  return ''
}

/**
 * Derive the lastActionResult string for an anchor_vs_batch tool_completed. Reads
 * the per-sub-tool outcomes from the batch output: if either anchor or vs failed
 * (ok:false, not cancelled), return a failure string with the reason(s); else
 * succeeded. This is how a MIXED batch (one half succeeded -> tool_completed)
 * surfaces the failed half's reason to the planner. A wholly-failed batch
 * instead emits tool_failed (handled by the generic tool_failed branch above),
 * so this path runs only when at least one half committed an effect.
 */
function batchActionResult(output: AnchorVsBatchOutput | undefined): string {
  const fails: string[] = []
  const anchor = output?.anchor
  if (anchor && !anchor.ok && !anchor.cancelled) {
    fails.push(`anchor:${anchor.errorCode}: ${anchor.errorMessage}`)
  }
  const vs = output?.vs
  if (vs && !vs.ok && !vs.cancelled) {
    fails.push(`vs:${vs.errorCode}: ${vs.errorMessage}`)
  }
  return fails.length > 0
    ? `anchor_vs_batch:failed:${fails.join(' | ')}`
    : 'anchor_vs_batch:succeeded'
}

/**
 * Whether the `arm` of the bootstrap_visual anchor+VS work has succeeded in
 * `events` (advancePhase passes events since the last phase change). A success
 * comes from the standalone tool OR the matching arm of an anchor_vs_batch --
 * whose per-arm `ok` rides on the batch output even when the batch OVERALL
 * reports tool_failed (foldSession still stages the succeeded arm's artifacts).
 * advanceBootstrapVisual calls this for BOTH arms, so bootstrap_visual
 * enters refinement only once BOTH t4_anchor_assets and t3_vs have actually
 * succeeded -- never with a lone arm (permitted by the bootstrap_visual
 * exactly-one exemption) or a missing one.
 */
export function hasArmSuccess(events: AgentEvent[], arm: 'anchor' | 'vs'): boolean {
  const tool = arm === 'anchor' ? 'generate_anchor_assets' : 'generate_explainer_visual_script'
  return events.some(
    (e) =>
      (e.type === 'tool_completed' && e.toolName === tool) ||
      ((e.type === 'tool_completed' || e.type === 'tool_failed') &&
        e.toolName === 'anchor_vs_batch' &&
        (e.output as AnchorVsBatchOutput | undefined)?.[arm]?.ok === true),
  )
}

/**
 * Trailing consecutive identical failures since the last user_message (doc
 * 2319-2327). Signature = failed tool name (an approximation of the planner
 * intent signature).
 *
 * PHASE-2/3 RECONCILE: V1 uses a richer "intent signature" (the proposed action
 * shape). The tool name is a leaf-derivable proxy; exact parity is reconciled
 * when the backstop is wired in Phase 3.
 */
export function consecutiveIdenticalFailures(events: AgentEvent[]): number {
  let count = 0
  let signature: null | string = null
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.type === 'user_message') {
      break
    }
    if (e.type === 'tool_failed') {
      if (signature === null) {
        signature = e.toolName
        count = 1
      } else if (e.toolName === signature) {
        count++
      } else {
        break
      }
    } else if (e.type === 'tool_completed' || e.type === 'tool_cancelled') {
      // A non-failing outcome breaks the consecutive-failure run.
      break
    }
  }
  return count
}

// ---------------------------------------------------------------------------
// Review gate
// ---------------------------------------------------------------------------

/**
 * Token of the last review_gate_opened, or null if a later
 * user_continue_draft / user_confirm_brand_review consumed it.
 */
export function foldCurrentGateToken(events: AgentEvent[]): null | string {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.type === 'user_continue_draft' || e.type === 'user_confirm_brand_review') {
      return null
    }
    if (e.type === 'review_gate_opened') {
      return e.token
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Tool tracking
// ---------------------------------------------------------------------------

/** tool_started events with no later terminal event for the same toolCallId. */
export function openToolStartedEvents(events: AgentEvent[]): ToolStartedEvent[] {
  const closed = new Set<string>()
  for (const e of events) {
    if (e.type === 'tool_completed' || e.type === 'tool_cancelled' || e.type === 'tool_failed') {
      closed.add(e.toolCallId)
    }
  }
  const open: ToolStartedEvent[] = []
  for (const e of events) {
    if (e.type === 'tool_started' && !closed.has(e.toolCallId)) {
      open.push(e)
    }
  }
  return open
}

/** Whether any tool_completed in `events` matches the given tool name. */
export function toolSucceeded(events: AgentEvent[], toolName: string): boolean {
  return events.some((e) => e.type === 'tool_completed' && e.toolName === toolName)
}

/**
 * Whether a planner call is in flight: the latest planner_start has not yet been
 * resolved. The planner call resolves to exactly one of two events --
 * planner_decided (it produced a decision) or recovery_failure (no-decision
 * backstop / contract error / give-up). Scanning from the end, either settling
 * event seen first means the call finished; a planner_start seen first means it
 * is still running. (assistant_message is the planner's REPLY, not a completion
 * signal -- every give-up appends a recovery_failure before its assistant_message,
 * so it is already covered.) Feeds `is_processing` so the "Thinking" indicator
 * shows during the planner turn, not only while a tool runs.
 */
export function isPlannerInFlight(events: AgentEvent[]): boolean {
  for (let i = events.length - 1; i >= 0; i--) {
    const t = events[i].type
    if (t === 'planner_decided' || t === 'recovery_failure') {
      return false
    }
    if (t === 'planner_start') {
      return true
    }
  }
  return false
}

/**
 * Whether the agent is mid-turn (NOT settled / "transcript ready"), derived
 * PURELY from the planner event sequence. The point-in-time "a tool is running
 * OR the planner is in flight" reading flickers "settled" in the sub-turn gaps
 * between planner_decided and tool_started, and between tool_completed and the
 * next planner_start -- which surfaces the script-review gate mid-turn. Scanning
 * from the end:
 *   - planner_start (nothing settling after it) -> the planner LLM call is in
 *     flight (equivalent to isPlannerInFlight).
 *   - recovery_failure -> the planner call finished without a clean decision
 *     (no-decision backstop / contract give-up); treat the turn as settled so we
 *     never stick busy on a give-up.
 *   - planner_decided -> busy IFF its action is TOOL_CALLS. A TOOL_CALLS decision
 *     always dispatches a tool, and the workflow never runs the planner while a
 *     tool is in flight (workflow 7f.1), so the planner re-wakes only after the
 *     tool completes -- and that follow-up decision is never TOOL_CALLS. Keeping
 *     the whole tool sub-turn busy therefore has no point-in-time gap and cannot
 *     stick: the next non-tool decision settles it.
 * No planner event yet -> not busy (fresh session before the first turn).
 */
export function isAgentTurnBusy(events: AgentEvent[]): boolean {
  // A user tool-cancel breaks the "TOOL_CALLS always re-wakes the
  // planner" assumption above -- on a per-tool cancel the planner is deliberately
  // PAUSED (never re-woken), so the scan would otherwise stick on the stale
  // TOOL_CALLS decision and report busy forever, leaving the "Thinking" indicator
  // (is_idle / is_processing) stuck on. Settle only when the LATEST tool-lifecycle
  // event is a tool_cancelled that left nothing running. Guarding on "latest" (not
  // merely "no tools open") is what preserves the no-flicker property: an
  // interleaving like start(A) -> start(B) -> cancel(A) -> complete(B) also has no
  // open tools, but its newest tool event is a normal completion, so it must stay
  // busy until the planner re-wakes (same for tool_failed).
  const hasOpenTools = openToolStartedEvents(events).length > 0
  let latestToolEvent: AgentEvent | undefined
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]
    if (
      event.type === 'tool_started' ||
      event.type === 'tool_completed' ||
      event.type === 'tool_failed' ||
      event.type === 'tool_cancelled'
    ) {
      latestToolEvent = event
      break
    }
  }
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.type === 'planner_start') {
      return true
    }
    if (e.type === 'recovery_failure') {
      return false
    }
    if (e === latestToolEvent && e.type === 'tool_cancelled' && !hasOpenTools) {
      return false
    }
    if (e.type === 'planner_decided') {
      return e.decision.action === 'TOOL_CALLS'
    }
  }
  return false
}

/**
 * Whether generate_intent_context produced a REAL artifact (global_constraints,
 * which now carries the user's positive `directives` inline). The latest
 * generate_intent_context tool_completed wins. A missing-dependency early-return
 * yields an empty output (`{}`), so a bare tool_completed is NOT sufficient.
 * advancePhase uses this to gate the audio-mode bootstrap_script ->
 * script_review transition, where there is no generate_explainer_script success
 * to imply intent context ran first.
 *
 * Mirror stageIntentContextArtifact's acceptance shape (`wrapped.global_constraints
 * ?? output`): the normal output is the wrapped `{ global_constraints }`, but a
 * bare GlobalConstraints object (no wrapper key) is also treated as the
 * artifact. Recognizing only the wrapped form here would disagree with the fold
 * and could strand an audio session on a bare-output history.
 */
export function intentContextComplete(events: AgentEvent[]): boolean {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.type === 'tool_completed' && e.toolName === 'generate_intent_context') {
      const out = e.output as null | Record<string, unknown>
      if (!out || typeof out !== 'object') {
        return false
      }
      // Wrapped form: { global_constraints: {...} }.
      if ('global_constraints' in out) {
        return Boolean(out.global_constraints)
      }
      // Backward-compat: a bare GlobalConstraints object (the missing-dependency
      // early return is `{}`, which has no keys and correctly stays false).
      return Object.keys(out).length > 0
    }
  }
  return false
}

// ---------------------------------------------------------------------------
// Phase + time helpers
// ---------------------------------------------------------------------------

/**
 * The `at` of the last phase_changed whose toPhase === phase; falls back to the
 * session_initialized `at`, then 0.
 */
export function phaseEnteredAt(events: AgentEvent[], phase: PlannerPhase): number {
  const entered = findLast(events, (e) => e.type === 'phase_changed' && e.toPhase === phase)
  if (entered) {
    return entered.at
  }
  for (const e of events) {
    if (e.type === 'session_initialized') {
      return e.at
    }
  }
  return 0
}

/** Generic last-match helper (avoids relying on Array.prototype.findLast lib target). */
export function findLast<T>(arr: T[], pred: (value: T) => boolean): T | undefined {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (pred(arr[i])) {
      return arr[i]
    }
  }
  return undefined
}

/**
 * Pure "now": the last event's `at`, or 0 for an empty log. Callers that need
 * wall-clock pass it explicitly; the pure fold never calls Date.now.
 */
export function nowMs(events: AgentEvent[]): number {
  return events.length > 0 ? events[events.length - 1].at : 0
}

/** Events appended since the last phase_changed (the "recent" slice). */
export function unprocessedSincePhase(events: AgentEvent[]): AgentEvent[] {
  let lastPhaseIdx = -1
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].type === 'phase_changed') {
      lastPhaseIdx = i
      break
    }
  }
  return events.slice(lastPhaseIdx + 1)
}

/**
 * Idle / deadline wait in ms. `now` is passed by the caller
 * (Date.now()) to keep this pure. null deadline => clamp idle timeout to >= 0;
 * otherwise clamp (deadline - now) to [0, idleTimeoutMs].
 */
export function computeIdleWaitMs(
  deadlineMs: null | number,
  idleTimeoutMs: number,
  now: number,
): number {
  if (deadlineMs == null) {
    return Math.max(0, idleTimeoutMs)
  }
  return Math.max(0, Math.min(deadlineMs - now, idleTimeoutMs))
}

// ---------------------------------------------------------------------------
// Audio + brand (advancePhase inputs)
// ---------------------------------------------------------------------------

/**
 * Whether the session has audio: session_initialized.params.audioPath present,
 * or a working-script seed / pre-voiceover event recorded (advancePhase uses it).
 */
export function hasAudio(events: AgentEvent[]): boolean {
  for (const e of events) {
    if (e.type === 'session_initialized' && e.params.audioPath) {
      return true
    }
    if (
      e.type === 'working_script_seeded' ||
      e.type === 'pre_voiceover_script_ready' ||
      e.type === 'pre_voiceover_artifacts_ready'
    ) {
      return true
    }
  }
  return false
}

/**
 * Whether the user committed this session (continue or confirm). The API only
 * signals the workflow once its orchestration succeeds: a successful continue --
 * whether from the manual "Create video" click OR the script_review deadline
 * auto-continue (both route through the same API path; see routeGateDeadline) --
 * emits user_continue_draft, and a confirm / confirm_fast emits user_confirm.
 * Used by logTermination to scope the idle-timeout error to sessions the user
 * actually committed to (vs. an expected review-gate drop-off).
 */
export function sessionCommitted(events: AgentEvent[]): boolean {
  return events.some((e) => e.type === 'user_continue_draft' || e.type === 'user_confirm')
}

/**
 * Whether brand input has been set: a spec_patched carrying a
 * set_brand_extraction_input op, or an update_global_field op whose path targets
 * brand_extraction_input (advancePhase routing input).
 *
 * PHASE-2 RECONCILE: the authoritative brand-input state lives on
 * spec.global_constraints.brand_extraction_input after foldSession applies the
 * ops. This leaf check looks at op shape only; if a future op writes brand input
 * by another path it must be added here.
 */
export function hasBrandInput(events: AgentEvent[]): boolean {
  for (const e of events) {
    if (e.type !== 'spec_patched') {
      continue
    }
    for (const op of e.ops) {
      if (op.op === 'set_brand_extraction_input') {
        return true
      }
      // apply_brand_carry seeds brand_extraction_input from the carried source
      // inside patch-apply; count it as input for phase routing.
      if (op.op === 'apply_brand_carry') {
        return true
      }
      if (op.op === 'update_global_field' && op.path?.includes('brand_extraction_input')) {
        return true
      }
    }
  }
  return false
}

/**
 * The music beat-sheet readiness status from the latest `music_beat_sheet`
 * event (signalled by MusicPreAnalysisWorkflow). `null` = no signal yet -- for a
 * music-candidate session this means still pending. Mirrors `brandStatus`. Used by
 * `advanceScriptReview` to hold `bootstrap_visual` until the sheet resolves, and
 * folded onto `spec.meta.music_beat_sheet_status` so the VS tool can branch
 * (ready -> read beat_sheet.json; unavailable -> ASR-timing fallback).
 */
export function musicBeatSheetStatus(events: AgentEvent[]): 'ready' | 'unavailable' | null {
  let status: 'ready' | 'unavailable' | null = null
  for (const e of events) {
    if (e.type === 'music_beat_sheet') {
      status = e.status
    }
  }
  return status
}

/**
 * Whether this session will (eventually) receive a `music_beat_sheet`
 * signal -- i.e. whether `MusicPreAnalysisWorkflow` was started for it. Mirrors the
 * producer's start gate (`pre-voiceover/workflow.ts`): an audio session with
 * `music_video_improvement_enabled`. ONLY such sessions may be gated on a pending
 * status -- a non-candidate session never gets a signal, so gating it would hang
 * `bootstrap_visual` forever.
 */
export function isMusicBeatSheetCandidate(events: AgentEvent[]): boolean {
  // Gate on the session_initialized audioPath -- the exact producer start gate
  // (PreVoiceoverWorkflow runs for an audioPath session, then starts the music
  // child only when musicVideoImprovementEnabled). NOT hasAudio(), which also
  // turns true on working_script_seeded / pre_voiceover_* events: a session
  // wrongly flagged as a candidate after the producer start gate is gone could hang
  // bootstrap_visual forever waiting for a music_beat_sheet signal that never comes.
  const init = events.find((e) => e.type === 'session_initialized')
  return Boolean(
    init?.type === 'session_initialized' &&
      init.params.audioPath &&
      init.initialSpecSnapshot?.meta?.music_video_improvement_enabled,
  )
}

/**
 * The system-owned hold condition for script_review -> bootstrap_visual:
 * the user clicked "Create video" (user_continue_draft since the last phase change)
 * on a music-candidate session whose beat sheet has not resolved yet. While true,
 * advanceScriptReview holds the phase, the main loop skips the planner turn, and
 * incoming user messages are deferred -- symmetric with the bootstrap_brand
 * extraction hold. Released when the `music_beat_sheet` signal lands (ready or
 * unavailable).
 */
export function isAwaitingMusicBeatSheet(events: AgentEvent[]): boolean {
  return (
    foldPhase(events) === 'script_review' &&
    isMusicBeatSheetCandidate(events) &&
    musicBeatSheetStatus(events) === null &&
    unprocessedSincePhase(events).some((e) => e.type === 'user_continue_draft')
  )
}

/**
 * Whether the main loop should skip the planner turn for the music
 * beat-sheet wait (a system-owned hold, like bootstrap_brand). Two cases:
 *   (a) "Create video" was clicked on a music-candidate session but the beat sheet
 *       is still pending (isAwaitingMusicBeatSheet) -- bootstrap_visual cannot
 *       dispatch its forced anchor_vs_batch yet, so hold; the decision-worthy
 *       `music_beat_sheet` event re-wakes the loop and advancePhase moves into
 *       bootstrap_visual then.
 *   (b) a `music_beat_sheet` signal just landed WITHOUT moving the phase (the common
 *       case: analysis finishes while the user is still reviewing the script,
 *       pre-click). The planner never acts on this control signal directly -- it was
 *       already folded into spec.meta + the gate -- so idle instead of firing a
 *       no-op turn. `phaseBeforeAdvance` distinguishes this from the post-CTA release
 *       in (a), where advancePhase DID change the phase.
 */
export function shouldSkipPlannerForMusicBeatSheet(
  events: AgentEvent[],
  onlyMusicBeatSheetWasNew: boolean,
  phaseBeforeAdvance: PlannerPhase,
): boolean {
  if (isAwaitingMusicBeatSheet(events)) {
    return true
  }
  return onlyMusicBeatSheetWasNew && foldPhase(events) === phaseBeforeAdvance
}

/**
 * Brand extraction status derived from events: brand_extraction_ready =>
 * completed, brand_extraction_failed / fail_brand_extraction op => failed, a
 * start (start_brand_extraction op) => pending, else null. Later events win.
 */
export function brandStatus(events: AgentEvent[]): 'completed' | 'failed' | 'pending' | null {
  let status: 'completed' | 'failed' | 'pending' | null = null
  for (const e of events) {
    if (e.type === 'brand_extraction_ready') {
      status = 'completed'
    } else if (e.type === 'brand_extraction_failed') {
      status = 'failed'
    } else if (e.type === 'spec_patched') {
      for (const op of e.ops) {
        if (op.op === 'start_brand_extraction') {
          status = 'pending'
        } else if (
          op.op === 'change_brand_extraction_source' ||
          op.op === 'retry_brand_extraction'
        ) {
          // A re-extraction resets brand_extraction_status to 'pending'
          // in the spec (bank cleared / re-fetched). The event-fold must mirror
          // that, otherwise advanceBootstrapBrand reads the prior extraction's
          // 'completed' and bounces straight back to brand_review instead of
          // holding in bootstrap_brand until the fresh brand_extraction_ready.
          status = 'pending'
        } else if (op.op === 'fail_brand_extraction') {
          status = 'failed'
        } else if (op.op === 'apply_brand_carry') {
          // A carried bank sets status 'completed' directly -- no extraction
          // child ever runs. advanceBootstrapBrand routes
          // bootstrap_brand -> brand_review off this, and maybeStartBrandChild
          // must NOT fire a child for a carried bank.
          status = 'completed'
        }
      }
    }
  }
  return status
}

/**
 * Whether the session was seeded with a saved brand brief that should
 * enter an EDITABLE brand_review (the pivot away from lock-and-skip). Read off
 * the immutable session_initialized snapshot, which buildInitialSpec seeds as
 * status 'completed' + brand_library provenance. No brand extraction
 * runs (input stays null, brandStatus() stays null), so the phase router uses
 * this to route mode_confirmation -> bootstrap_brand -> brand_review.
 */
export function seededEditableBrandReview(events: AgentEvent[]): boolean {
  const init = events.find((e) => e.type === 'session_initialized')
  if (init?.type !== 'session_initialized') {
    return false
  }
  const gc = init.initialSpecSnapshot?.global_constraints
  return (
    Boolean(gc?.brand_bank) &&
    gc?.brand_bank_source?.kind === 'brand_library' &&
    gc?.brand_extraction_status === 'completed'
  )
}

/**
 * Whether any user message in the log carried init-prompt image uploads. The
 * saved-brief upload fold reads this to skip the activity when there is
 * nothing to fold. Event-shape scan (no value import).
 */
export function hasUploadedAssets(events: AgentEvent[]): boolean {
  return events.some((e) => e.type === 'user_message' && (e.uploadedAssets?.length ?? 0) > 0)
}

/**
 * Whether a brand re-extraction is requested but not yet re-fired.
 * `change_brand_extraction_source` (wrong-URL correction) and
 * `retry_brand_extraction` (transient-failure auto-retry) raise the flag inside
 * patch-apply; `mark_brand_reextraction_started` lowers it once the workflow
 * stamps the new run. Mirrors the folded-spec `brand_reextraction_pending`
 * field via an op-shape scan (no value import of patch-apply),
 * same pattern as brandStatus / brandCarryPending. Later events win.
 */
export function brandReextractionPending(events: AgentEvent[]): boolean {
  let pending = false
  for (const e of events) {
    if (e.type !== 'spec_patched') {
      continue
    }
    for (const op of e.ops) {
      if (op.op === 'change_brand_extraction_source' || op.op === 'retry_brand_extraction') {
        pending = true
      } else if (op.op === 'mark_brand_reextraction_started') {
        pending = false
      }
    }
  }
  return pending
}

/**
 * Cheap in-process pre-check for the 7d.2 brand auto-start: true when any
 * user message contains something URL-shaped
 * (scheme prefix or bare domain). Without it the hook scheduled a no-op LOCAL
 * activity on every mode_confirmation wake of every brand-enabled session --
 * v1 runs its detector in-process first and no-ops free
 * (maybeAutoStartBrandExtractionFromPrompt, planner-loop.ts:238).
 *
 * Deliberately a SUPERSET of the v1 detector's SCHEME_URL_RE/BARE_DOMAIN_RE
 * (auto-brand-extraction.ts) WITHOUT its asset-meta-tag stripping:
 * stripping only removes candidates, so every v1 match contains a substring
 * matching this pattern -- a false negative (skipping a URL v1 would find) is
 * impossible, and a false positive merely costs the one no-op activity call we
 * used to make unconditionally. The activity's full detector on the folded
 * transcript stays authoritative. The real detector does not run here: this
 * file is workflow code and only type-imports @reelmakeeasy/uip-planner-runtime.
 * PHASE-2 RECONCILE: widen this pattern if v1 detection ever widens.
 */
const BRAND_URL_CANDIDATE_RE = /https?:\/\/|[a-z0-9][a-z0-9-]*\.[a-z]{2,}/i

export function hasBrandAutoStartUrlCandidate(events: AgentEvent[]): boolean {
  for (const e of events) {
    if (e.type === 'user_message' && BRAND_URL_CANDIDATE_RE.test(e.message ?? '')) {
      return true
    }
  }
  return false
}

/**
 * Entry tab pinned onto the session's initial spec. Null for
 * older histories and tab-less sessions (buildInitialSpec passes
 * undefined through, which serialization drops).
 *
 * Snapshot access is optional-chained like every other reader of this event
 * (foldInputType / foldAudioSource above): a fold that throws takes the whole
 * main loop down, and this one is now reached BEFORE the article gate check
 * (newsDoorBlocksBrandAutoStart), so a thin snapshot can no longer be assumed
 * away by an earlier return.
 */
export function foldEntryUseCase(events: AgentEvent[]): null | string {
  for (const e of events) {
    if (e.type === 'session_initialized') {
      return e.initialSpecSnapshot?.meta?.entry_use_case ?? null
    }
  }
  return null
}

/**
 * Whether article extraction has been armed this session. The
 * started event is appended before the activity is scheduled, so this also
 * covers an in-flight run -- the trigger fires at most once per session.
 */
export function hasArticleExtractionRun(events: AgentEvent[]): boolean {
  return events.some((e) => e.type === 'article_extraction_started')
}

/**
 * Latest article extraction result; null until the activity
 * completes. Failed outcomes (typed failureKind) are carried too, so callers
 * can distinguish "ran and failed" from "never ran" (hasArticleExtractionRun).
 */
export function latestArticleExtraction(
  events: AgentEvent[],
): Extract<AgentEvent, { type: 'article_extraction_completed' }> | null {
  const found = findLast(events, (e) => e.type === 'article_extraction_completed')
  return found?.type === 'article_extraction_completed' ? found : null
}

// Pasted-URL router folds (URL_ROUTE_* constants, latestUrlClassification,
// urlRouteIs*, urlRouteExhausted, ...) live in folds-url-route.ts (entrance
// pivot; split out for the max-lines budget).

/**
 * Whether a seeded brand carry is still pending: the
 * session_initialized snapshot seeded brand_carry_state with status 'pending'
 * and no resolving op has landed since. Resolving ops: apply_brand_carry
 * (applied -- planner op, runtime fallback, or same-source auto-start) and
 * set_brand_extraction_input (a different brand discards the carry inside
 * patch-apply; a same-source set converts to apply -- either way resolved).
 * Op-shape scan; the authoritative state is the folded spec.
 */
export function brandCarryPending(events: AgentEvent[]): boolean {
  let pending = false
  for (const e of events) {
    if (e.type === 'session_initialized') {
      const snapshot = e.initialSpecSnapshot as {
        global_constraints?: { brand_carry_state?: null | { status?: string } }
      }
      pending = snapshot?.global_constraints?.brand_carry_state?.status === 'pending'
    } else if (e.type === 'spec_patched') {
      for (const op of e.ops) {
        if (op.op === 'apply_brand_carry' || op.op === 'set_brand_extraction_input') {
          pending = false
        }
      }
    }
  }
  return pending
}

// ---------------------------------------------------------------------------
// Misc pure helpers
// ---------------------------------------------------------------------------

/**
 * Trivial pure word count: split on whitespace. The authoritative (CJK-aware)
 * count lives in V1; see SCRIPT_WORD_CAP_* for the Phase-2 reconcile note.
 */
export function countWords(text: string): number {
  const trimmed = text.trim()
  if (!trimmed) {
    return 0
  }
  return trimmed.split(/\s+/).length
}

/**
 * Dedupe events by a stable identity (used in compaction). Identity is
 * the JSON of (type, at) -- best available stable key without a dedicated event
 * id field.
 *
 * PHASE-2 RECONCILE: if a true event id is added to BaseEvent, switch the
 * identity to it. Two genuinely distinct events sharing (type, at) is not
 * expected because appendEvent stamps a monotonically advancing `at`.
 */
export function dedupeById(events: AgentEvent[]): AgentEvent[] {
  const seen = new Set<string>()
  const out: AgentEvent[] = []
  for (const e of events) {
    const id = `${e.type}|${e.at}`
    if (seen.has(id)) {
      continue
    }
    seen.add(id)
    out.push(e)
  }
  return out
}
