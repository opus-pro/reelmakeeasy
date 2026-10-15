// Do NOT import from workflow.ts -- this is a leaf module so workflow.ts (and the
// planner-turn runner) can import it without an import cycle. Small helpers
// shared by the main loop: the workflow clock, the spec-version fold, and
// the recovery_failure / give-up message appends.
//
// Workflow code: no value imports from `@reelmakeeasy/uip-planner-runtime`.

import { appendEvent } from './event-log'
import { foldPhase } from './folds'
import type { WorkflowState } from './types'

/** ISO timestamp from the workflow clock. */
export function nowIso(): string {
  return new Date(Date.now()).toISOString()
}

/** Current spec version: the last spec_patched.specVersionAfter, else 0. */
export function currentSpecVersion(state: WorkflowState): number {
  for (let i = state.events.length - 1; i >= 0; i--) {
    const e = state.events[i]
    if (e.type === 'spec_patched') {
      return e.specVersionAfter
    }
  }
  return 0
}

/** Append a recovery_failure trace (planner no-decision / contract error / failed apply). */
export function appendRecoveryFailure(
  state: WorkflowState,
  errorCode: string,
  failureStage: string,
  message: string,
  retryable: boolean,
): void {
  appendEvent(state, {
    type: 'recovery_failure',
    errorCode,
    failureStage,
    message,
    retryable,
    timestamp: nowIso(),
  })
}

/** V1-parity user-facing message when contract errors won't resolve; then park. */
export function surfaceContractGiveUp(state: WorkflowState): void {
  appendEvent(state, {
    type: 'assistant_message',
    content:
      'I ran into the same issue a few times and stopped to avoid a loop. Please send your request again.',
    messageId: `assistant-${state.events.length}`,
    phase: foldPhase(state.events),
    specVersion: currentSpecVersion(state),
    timestamp: nowIso(),
  })
}

/** User-facing message when a tool has failed too many consecutive times. */
export function surfaceToolFailureGiveUp(state: WorkflowState): void {
  appendEvent(state, {
    type: 'assistant_message',
    content:
      "I wasn't able to complete that step after several attempts. Please try rephrasing your request or send it again.",
    messageId: `assistant-${state.events.length}`,
    phase: foldPhase(state.events),
    specVersion: currentSpecVersion(state),
    timestamp: nowIso(),
  })
}
