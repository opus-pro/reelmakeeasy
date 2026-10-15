import type { PlannerState } from '../../state/planner-state'
import { getAdapterSessionAtom, getSessionStateAtom } from '../adapter-atoms'
import type { StateChanges } from '../api-types'

export function applySessionStateChanges(
  plannerState: PlannerState,
  changes: StateChanges,
  strictVersion?: boolean,
): boolean {
  const current = plannerState.get(getSessionStateAtom)
  if (strictVersion) {
    if (changes.version !== current.version + 1) {
      return false
    }
  } else {
    if (changes.version < current.version) {
      return false
    }
  }
  plannerState.set(getSessionStateAtom, {
    state: {
      ...current.state,
      ...changes.state,
    },
    version: changes.version,
  })
  plannerState.set(getAdapterSessionAtom, (session) =>
    session
      ? {
          ...session,
          state: { ...session.state, ...changes.state },
          state_version: changes.version,
        }
      : session,
  )
  return true
}
