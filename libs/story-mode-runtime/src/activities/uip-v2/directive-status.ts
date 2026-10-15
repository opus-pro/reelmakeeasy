// Directive (d*) status derivation for foldTodoState, split out of
// session-state.ts to keep that file under its strict max-lines cap.
// Activity-side ONLY (same as its caller): pure over the V2 AgentEvent log.
import type { PlannerTodoItem } from '@reelmakeeasy/uip-planner-runtime'

import type { AgentEvent } from '../../workflows/uip-v2/types'

/**
 * Whether the planner explicitly closed a d* directive via a todo_updated
 * carrying set_item_status { id, status:'done' } (auditable judgment). A later
 * set_item_status back to 'pending' reopens it; the last write wins.
 *
 * Directive ids are RECYCLED across refinement requests (a new request often
 * reuses `d1`). A todo_snapshot that (re)introduces this id as 'pending' starts
 * a FRESH directive under the same id, so it reopens the item: a stale
 * set_item_status:done from the id's PRIOR life must not carry over. Snapshot
 * reopens and set_item_status writes are interleaved in event order (last write
 * wins). Without this a reused, still-unexecuted directive folds as 'done',
 * which silently defeats the executor-evidence contract -- the
 * planner then closes the directive with no tool run and the user's request is
 * dropped (the iwj false-done: a fan-regen directive reused an already-done id).
 */
export function directiveClosedInLog(item: PlannerTodoItem, events: AgentEvent[]): boolean {
  let closed = false
  for (const e of events) {
    if (e.type !== 'todo_updated') {
      continue
    }
    // A snapshot re-introducing this id as pending reopens the directive.
    if (e.snapshot?.some((it) => it.id === item.id && it.status === 'pending')) {
      closed = false
    }
    // set_item_status is the authoritative close/reopen signal.
    for (const { id, status } of e.update?.set_item_status ?? []) {
      if (id === item.id) {
        closed = status === 'done'
      }
    }
  }
  return closed
}
