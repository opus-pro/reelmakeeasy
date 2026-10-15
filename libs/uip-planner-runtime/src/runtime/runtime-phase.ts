import { randomUUID } from 'node:crypto'

import { createSubLogger } from '@reelmakeeasy/common/logger'
import { BRAND_REVIEW_READY_MESSAGE } from '@reelmakeeasy/common/uip-runtime-messages'

import type { QueuedUserItem, ReviewGate, SessionState } from '../types'

import { REVIEW_AUTO_CONTINUE_DELAY_MS } from './constants'
import { plannerLog } from './planner-log'
import {
  setAutoLockDeadline as setAutoLockDeadlineInternal,
  shouldRunAutoLockCountdown,
} from './spec-runtime'
import { bootstrapTodoItemsFromArtifacts } from './todo-runtime'

// The planner LLM call lives in ./call-planner; re-exported here so the ~9
// modules importing buildPlannerStepPrompt / callPlanner / CallPlanner* from
// runtime-phase keep working without churn.
export * from './call-planner'

const logger = createSubLogger('user-intent-planner')

// ---------------------------------------------------------------------------
// Pure state-consistency checks
// ---------------------------------------------------------------------------

export function buildQueuedDrainMessage(
  queuedItems: QueuedUserItem[],
  opts?: { includePanelReference?: boolean },
): string {
  // The `sent from: <panel>` hint is a PLANNER-ONLY prompt signal.
  // Default off so the raw drained text can also feed tools (e.g. the
  // byte-for-byte paste extractor) without the synthetic hint corrupting it.
  const includePanelReference = opts?.includePanelReference ?? false
  const renderedItems = queuedItems.map((item, index) => {
    const uploads =
      item.uploaded_assets.length > 0
        ? item.uploaded_assets
            .map((asset) => `${asset.asset_id} (${asset.file_name || asset.file_path})`)
            .join(', ')
        : 'none'
    const message = item.message.trim() || '[no text; uploads only]'
    const sourceLine =
      includePanelReference && item.sent_from ? `\nsent from: ${item.sent_from} panel` : ''
    return `Queued item ${index + 1}:\nmessage: ${message}\nuploads: ${uploads}${sourceLine}`
  })

  return [
    'Queued follow-up user items arrived while the previous turn was processing.',
    'Apply them in order. Later items may refine or override earlier ones.',
    'If sequential items cancel each other out (e.g., "remove X" followed by "undo removal of X"), skip both and proceed to the remaining actionable items.',
    'Resolve references like "this", "these", and "both" against the ordered queued items below.',
    renderedItems.join('\n\n'),
  ].join('\n\n')
}

/**
 * Build the script-review review-gate. If the current script exceeds the
 * TTS vendor word cap we omit the "Create video" CTA entirely: without it
 * the frontend renders the gate with no actionable options, which is the
 * signal for "trim the script first, then the button reappears". The
 * gate still exists (status WAITING_FOR_USER) so the user sees they are
 * in review, not a dead state.
 */
export function buildScriptReviewGate(session: SessionState): ReviewGate {
  const capExceeded = session.spec.meta.script_word_cap?.exceeded === true
  return {
    kind: 'SCRIPT_REVIEW',
    status: 'WAITING_FOR_USER',
    token: randomUUID(),
    options: capExceeded ? [] : [{ id: 'continue_uip_draft', label: 'Create video' }],
  }
}

// Build the brand-review gate. Single "Confirm Brand Profile" CTA, no auto-confirm
// countdown. `_session` is unused but matches `buildScriptReviewGate`'s signature.
export function buildBrandReviewGate(_session: SessionState): ReviewGate {
  return {
    kind: 'BRAND_REVIEW',
    status: 'WAITING_FOR_USER',
    token: randomUUID(),
    options: [{ id: 'confirm_brand_review', label: 'Confirm Brand Profile' }],
  }
}

export function refreshReviewAutoContinueDeadline(
  session: SessionState,
  options?: { force?: boolean },
): void {
  // TTS word-cap block: never arm the 3-minute auto-continue countdown
  // while the script exceeds the vendor cap. The user must trim first;
  // a subsequent mutation will re-run this helper with cap cleared.
  if (session.spec.meta.script_word_cap?.exceeded === true) {
    session.review_auto_continue_deadline_at = null
    return
  }

  if (options?.force || !session.review_auto_continue_deadline_at) {
    session.review_auto_continue_deadline_at = new Date(
      Date.now() + REVIEW_AUTO_CONTINUE_DELAY_MS,
    ).toISOString()
    return
  }

  session.review_auto_continue_deadline_at = new Date(
    Date.now() + REVIEW_AUTO_CONTINUE_DELAY_MS,
  ).toISOString()
}

/**
 * Refresh the phase-owned inactivity timer back to "full 5 minutes from now".
 *
 * Semantic intent: these deadlines are an *inactivity* timer -- auto-continue
 * the session if the user stops interacting -- NOT a hard wall-clock cap on
 * the phase. So the timer should reset at every boundary where the session
 * becomes freshly idle from the user's perspective:
 *
 *  1. User sends a message (handled at message-ingestion sites in
 *     session-runtime.ts). The user just gave an instruction; they need
 *     fresh time to see the response.
 *  2. A planner turn completes and `is_processing` flips true -> false
 *     (handled in planner-loop.ts finally). The agent just produced output;
 *     the user needs fresh time to review it. Without this refresh, a long
 *     tool call (planner + VS tool + audit loop) could burn the grace
 *     period while the user was merely waiting -- so the moment they see
 *     the result, auto-continue could fire immediately.
 *
 * For `refinement` phase we always refresh -- nothing should block the user
 * from entering video production. `spec.meta.blocking` (e.g. anchor asset
 * needing a reference photo) only gates spec mutations; it must not prevent
 * the auto-lock countdown from running, because the session always has a
 * valid path forward (skip / generate without reference).
 */
export function refreshPhaseDeadline(session: SessionState): void {
  switch (session.todo_state.phase) {
    case 'refinement': {
      if (shouldRunAutoLockCountdown(session)) {
        setAutoLockDeadlineInternal(session.spec.meta, { refresh: true })
      } else {
        session.spec.meta.auto_lock_deadline_at = null
      }
      break
    }
    case 'script_review': {
      refreshReviewAutoContinueDeadline(session)
      break
    }
  }
}

// ---------------------------------------------------------------------------
// Phase-field repair helpers
// ---------------------------------------------------------------------------

export function syncBootstrapDraftOwnedState(session: SessionState): void {
  session.review_gate = null
  session.review_auto_continue_deadline_at = null
  session.spec.meta.auto_lock_deadline_at = null
}

export function syncRefinementOwnedState(
  session: SessionState,
  isSessionLocked: (s: SessionState) => boolean,
  options?: { refreshAutoLockDeadline?: boolean },
): void {
  session.review_gate = null
  session.review_auto_continue_deadline_at = null

  if (isSessionLocked(session)) {
    return
  }

  if (shouldRunAutoLockCountdown(session)) {
    setAutoLockDeadlineInternal(session.spec.meta, {
      refresh: options?.refreshAutoLockDeadline,
    })
  } else {
    // Word-cap exceeded: pause the countdown. A later mutation that drops the
    // word count back under cap will re-run this helper and arm the deadline.
    // Note: `blocking` deliberately does NOT pause the countdown -- nothing
    // should gate entering video production in refinement.
    session.spec.meta.auto_lock_deadline_at = null
  }
}

export function syncScriptReviewOwnedState(
  session: SessionState,
  options?: { forceNewReviewGate?: boolean; refreshReviewAutoContinueDeadline?: boolean },
): void {
  session.todo_state.items = session.todo_state.items.filter((item) => !/^t\d+/i.test(item.id))
  session.spec.meta.auto_lock_deadline_at = null
  if (options?.forceNewReviewGate || !session.review_gate) {
    session.review_gate = buildScriptReviewGate(session)
  }
  if (options?.refreshReviewAutoContinueDeadline || !session.review_auto_continue_deadline_at) {
    refreshReviewAutoContinueDeadline(session, { force: true })
  }
}

// Brand-review counterpart of `syncScriptReviewOwnedState`. No auto-continue
// deadline (V1); bootstrap todo items (`t...`) are filtered out same as script-review.
export function syncBrandReviewOwnedState(
  session: SessionState,
  options?: { forceNewReviewGate?: boolean },
): void {
  session.todo_state.items = session.todo_state.items.filter((item) => !/^t\d+/i.test(item.id))
  session.spec.meta.auto_lock_deadline_at = null
  if (options?.forceNewReviewGate || !session.review_gate) {
    session.review_gate = buildBrandReviewGate(session)
  }
}

// ---------------------------------------------------------------------------
// Phase transitions
// ---------------------------------------------------------------------------

export function activateBootstrapScript(
  session: SessionState,
  source: 'cta_confirm_brand_review' | 'phase_canonicalization.brand_extraction_failed',
): void {
  const fromPhase = session.todo_state.phase
  session.todo_state.phase = 'bootstrap_script'
  session.todo_state.items = bootstrapTodoItemsFromArtifacts(session)
  syncBootstrapDraftOwnedState(session)
  logPhaseTransition(session, fromPhase, session.todo_state.phase, source)
}

export function enterRefinementPhase(
  session: SessionState,
  source:
    | 'consistency_repair.bootstrap_visual_complete'
    | 'phase_canonicalization.bootstrap_visual_complete',
  isSessionLocked: (s: SessionState) => boolean,
): void {
  const fromPhase = session.todo_state.phase
  session.todo_state.phase = 'refinement'
  session.todo_state.items = session.todo_state.items.filter((item) => /^d\d+/i.test(item.id))
  syncRefinementOwnedState(session, isSessionLocked, { refreshAutoLockDeadline: true })
  logPhaseTransition(session, fromPhase, session.todo_state.phase, source)
}

export function logPhaseTransition(
  session: SessionState,
  fromPhase: SessionState['todo_state']['phase'],
  toPhase: SessionState['todo_state']['phase'],
  source:
    | 'auto_continue_script_review_timeout'
    | 'consistency_repair.bootstrap_brand_complete'
    | 'consistency_repair.bootstrap_script_complete'
    | 'consistency_repair.bootstrap_visual_complete'
    | 'cta_confirm_brand_review'
    | 'cta_continue_uip_draft'
    | 'enter_script_review_gate'
    | 'phase_canonicalization.bootstrap_brand_complete'
    | 'phase_canonicalization.bootstrap_script_complete'
    | 'phase_canonicalization.bootstrap_visual_complete'
    | 'phase_canonicalization.brand_extraction_failed'
    | 'phase_canonicalization.brand_extraction_manual_entry'
    | 'phase_canonicalization.brand_reextraction',
): void {
  if (fromPhase === toPhase) {
    return
  }

  logger.info(
    plannerLog(session.sessionId, '[phase.transition]', {
      from_phase: fromPhase,
      reviewGateToken: session.review_gate?.token ?? null,
      source,
      to_phase: toPhase,
    }),
  )
}

// Drop back into bootstrap_brand from brand_review when a re-extraction was
// kicked off: the user changed the extraction source, so status was
// reset to 'pending'. Rebuild the t_brand todo and tear down the review gate
// (mirrors activateBootstrapScript) so the existing bootstrap_brand ->
// brand_review flow re-runs once the fresh extraction completes.
export function reenterBootstrapBrand(
  session: SessionState,
  source: 'phase_canonicalization.brand_reextraction',
): void {
  const fromPhase = session.todo_state.phase
  session.todo_state.phase = 'bootstrap_brand'
  session.todo_state.items = bootstrapTodoItemsFromArtifacts(session)
  syncBootstrapDraftOwnedState(session)
  logPhaseTransition(session, fromPhase, session.todo_state.phase, source)
}

export function transitionToScriptReview(
  session: SessionState,
  source:
    | 'consistency_repair.bootstrap_script_complete'
    | 'enter_script_review_gate'
    | 'phase_canonicalization.bootstrap_script_complete',
  appendAgentReplyFn: (s: SessionState, content: string) => void,
  options?: { appendAgentReply?: boolean; forceNewReviewGate?: boolean },
): void {
  const fromPhase = session.todo_state.phase
  session.todo_state.phase = 'script_review'
  syncScriptReviewOwnedState(session, {
    forceNewReviewGate: options?.forceNewReviewGate ?? true,
    refreshReviewAutoContinueDeadline: true,
  })
  logPhaseTransition(session, fromPhase, session.todo_state.phase, source)

  if (options?.appendAgentReply) {
    appendAgentReplyFn(
      session,
      'Your video brief and script are ready to review. Tell me what to change, or press "Create video" when it looks right.',
    )
  }
}

// Brand-review counterpart of `transitionToScriptReview`. Entered from
// `bootstrap_brand` on `brand_extraction_complete` or from consistency-repair.
// User must click "Confirm Brand Profile" to advance (no auto-continue in V1).
export function transitionToBrandReview(
  session: SessionState,
  source:
    | 'consistency_repair.bootstrap_brand_complete'
    | 'phase_canonicalization.bootstrap_brand_complete'
    | 'phase_canonicalization.brand_extraction_manual_entry',
  appendAgentReplyFn: (s: SessionState, content: string) => void,
  options?: { appendAgentReply?: boolean; forceNewReviewGate?: boolean },
): void {
  const fromPhase = session.todo_state.phase
  session.todo_state.phase = 'brand_review'
  syncBrandReviewOwnedState(session, {
    forceNewReviewGate: options?.forceNewReviewGate ?? true,
  })
  logPhaseTransition(session, fromPhase, session.todo_state.phase, source)

  if (options?.appendAgentReply) {
    appendAgentReplyFn(session, BRAND_REVIEW_READY_MESSAGE)
  }
}

// ---------------------------------------------------------------------------
// Review-gate consistency orchestrator
// ---------------------------------------------------------------------------

export function isActiveReviewGateToken(session: SessionState, gateToken: string): boolean {
  if (!gateToken) {
    return false
  }
  return session.review_gate?.token === gateToken
}

// ---------------------------------------------------------------------------
// Global-constraint patch-ops builder
// ---------------------------------------------------------------------------

export function shouldAutoContinueReviewGate(
  session: SessionState,
  isSessionLocked: (s: SessionState) => boolean,
  getPendingTodoCount: (s: SessionState) => number,
): boolean {
  if (session.todo_state.phase !== 'script_review') {
    return false
  }
  if (!session.review_auto_continue_deadline_at) {
    return false
  }
  if (isSessionLocked(session)) {
    return false
  }
  // Defensive belt: `refreshReviewAutoContinueDeadline` already nulls out
  // the deadline when cap is exceeded, which makes the preceding
  // `!deadline` check short-circuit. Re-check here in case the deadline
  // was armed BEFORE a PATCH_SPEC pushed the script past the cap.
  if (session.spec.meta.script_word_cap?.exceeded === true) {
    return false
  }
  const deadlineMs = Date.parse(session.review_auto_continue_deadline_at)
  if (!Number.isFinite(deadlineMs) || Date.now() < deadlineMs) {
    return false
  }
  if (
    session.is_processing ||
    (session.queued_items?.length ?? 0) > 0 ||
    getPendingTodoCount(session) > 0
  ) {
    return false
  }
  return true
}

// ---------------------------------------------------------------------------
// Session-locked helper
// ---------------------------------------------------------------------------

export function isSessionLocked(session: SessionState): boolean {
  return Boolean(session.spec.meta.locked_at)
}

// ---------------------------------------------------------------------------
// Prepare session for planner loop
// ---------------------------------------------------------------------------
