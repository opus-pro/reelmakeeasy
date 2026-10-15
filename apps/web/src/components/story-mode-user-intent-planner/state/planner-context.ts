import { createContext, useContext } from 'react'

import type { PlannerState } from './planner-state'

const PlannerStateContext = createContext<null | PlannerState>(null)

export const PlannerStateProvider = PlannerStateContext.Provider

export function usePlannerState(): PlannerState {
  const state = useContext(PlannerStateContext)
  if (!state) {
    throw new Error('usePlannerState must be used within PlannerStateProvider')
  }
  return state
}

/**
 * For code reachable both inside and outside a planner -- the shared TTS hooks serve the legacy
 * editor as well as the canvas. Null means "no session store to publish to", not a failure.
 */
export function usePlannerStateOptional(): null | PlannerState {
  return useContext(PlannerStateContext)
}
