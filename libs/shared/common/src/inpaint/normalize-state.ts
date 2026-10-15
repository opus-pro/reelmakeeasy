import { fillState } from './fill-state'
import type { InpaintGlobalState, InpaintGlobalStateInput } from './state'

// Lives apart from state-store so the inpaint workflow can re-normalize an activity
// result without pulling the storage client into workflow code. Pure and
// idempotent: re-applying it to an already normalized state is a no-op.
export function normalizeInpaintState(persisted: InpaintGlobalStateInput): InpaintGlobalState {
  const filled = fillState(persisted)
  // Overlay rather than replace: a newer writer may have persisted task buckets this
  // build predates, and ensureInitialState feeds this state back into workflow.start,
  // which would otherwise flush them away.
  return { ...persisted, ...filled, tasks: { ...persisted.tasks, ...filled.tasks } }
}
