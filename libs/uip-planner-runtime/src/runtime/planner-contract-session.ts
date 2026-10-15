import type { PlannerOutputLike } from './runtime.types'

/**
 * SESSION_CONTROL contract: must include session_control.command (narrowed to
 * UNDO_LAST). Lock semantics moved to the UI-button path (confirmPlan) +
 * workflow auto-lock; planner redirects lock/proceed intents via ASK_CLARIFY.
 *
 * Extracted from planner-contract.ts to keep that file under the strict
 * eslint max-lines (800) cap. Mirrors the planner-contract-audio /
 * planner-contract-patch / planner-contract-anchor sibling pattern.
 */
export function checkSessionControlContract(output: PlannerOutputLike): null | string {
  const sessionControl = output.session_control
  if (!sessionControl?.command) {
    return 'SESSION_CONTROL must include session_control.command.'
  }

  const undoScope = sessionControl.undo_scope ?? 'LAST_CHANGE'
  if (undoScope === 'COUNT') {
    if (!Number.isInteger(sessionControl.count) || (sessionControl.count ?? 0) <= 0) {
      return 'UNDO_LAST with undo_scope=COUNT requires count as a positive integer.'
    }
    return null
  }

  if (sessionControl.count != null) {
    return 'UNDO_LAST count is only allowed when undo_scope=COUNT.'
  }
  return null
}
