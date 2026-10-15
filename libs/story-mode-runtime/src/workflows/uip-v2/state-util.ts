/**
 * Tiny shared workflow-state predicate. Lives in its own module so the main
 * loop, the background sync loop, and the handlers can all use one definition
 * without a circular import.
 *
 * Pure: reads the projected terminal flags only. No workflow-engine or
 * `@reelmakeeasy/uip-planner-runtime` import.
 */

import type { WorkflowState } from './types'

/** True iff the session has reached any terminal state (locked/cancelled/failed/timed-out). */
export function isTerminal(state: WorkflowState): boolean {
  return state.isLocked || state.isCancelled || state.isFailed || state.isTimedOut
}
