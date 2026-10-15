import { createBaseState } from '@/lib/jotai-base-state'
import type { JotaiStore } from '@/lib/jotai-types'

export type PlannerState = ReturnType<typeof createPlannerState>

let NEXT_PLANNER_STATE_ID = 0

export function createPlannerState(store: JotaiStore) {
  return {
    ...createBaseState(store),
    id: NEXT_PLANNER_STATE_ID++,
  }
}
