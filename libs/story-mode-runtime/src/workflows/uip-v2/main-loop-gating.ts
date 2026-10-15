// Main-loop wake predicate, split out of workflow.ts to keep it under the
// max-lines cap. Imports local pure modules only.

import { hasUnprocessedDecisionEvent } from './folds'
import { isTerminal } from './state-util'
import type { WorkflowState } from './types'

/** The main loop's wake predicate: a terminal state or a decision-worthy event. */
export function shouldWakeMainLoop(state: WorkflowState): boolean {
  if (isTerminal(state)) {
    return true
  }
  return hasUnprocessedDecisionEvent(state.events, state.processedDecisionCount)
}
