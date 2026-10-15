// Debounced GUI-edit wake fold. Split out of
// folds.ts, which sits at its max-lines cap. Pure event-log reads -- no
// workflow-engine imports.

import { eventCountsAsDecision } from './folds'
import type { AgentEvent } from './types'

/**
 * How long the sync loop waits after the last GUI edit before waking the
 * planner. Long enough that editing topic, then directives, then
 * must_not_violate in sequence produces ONE wake; short enough that the user
 * still associates the agent's response with what they just did.
 *
 * Chosen, not derived. Edits arrive on commit rather than per keystroke, so
 * this only needs to span a user moving between fields. Tune it against real
 * session data once the wake is live - if sessions show repeated wakes within
 * a few seconds, it is too short.
 */
export const GUI_WAKE_DEBOUNCE_MS = 4000

/**
 * Deadline for the debounced GUI wake, or null when
 * no wake is owed.
 *
 * Deliberately NOT part of foldDeadline (in folds.ts): that fold returns null
 * outside script_review / refinement / seeded brand_review (see its phase
 * gate), and a manual summary edit is reachable well below those phases, so
 * extending it would arm nothing exactly where symptom 2 lives.
 *
 * "Owed" means: a user_gui_update exists, and nothing decision-worthy has
 * happened since. The second clause is what disarms the timer - without it the
 * sync loop would re-fire every iteration forever. It also means a user who
 * edits and then types a message gets ONE planner turn, not two: their message
 * already wakes the loop through the normal path.
 */
export function foldGuiDebounceDeadline(events: AgentEvent[]): null | number {
  let lastEditAt: null | number = null
  for (const event of events) {
    if (event.type === 'user_gui_update') {
      lastEditAt = event.at
      continue
    }
    if (lastEditAt !== null && eventCountsAsDecision(event)) {
      lastEditAt = null
    }
  }
  return lastEditAt === null ? null : lastEditAt + GUI_WAKE_DEBOUNCE_MS
}
