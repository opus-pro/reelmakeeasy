/**
 * UIP V2 shared event-log helper.
 *
 * `appendEvent` is the single write path into the AgentEvent log. It stamps the
 * authoritative `at` (ms epoch) so callers never set it. Used by the phase
 * machine, the signal handlers, the sync loop, executeDecision, and the main
 * loop.
 *
 * Runs in workflow code, kept light:
 *   - No workflow-engine import: time comes from the GLOBAL `Date.now()`.
 *   - No `@reelmakeeasy/uip-planner-runtime` import (not even `import type`); only the
 *     local `./types` module is referenced.
 */

import type { AgentEvent, WorkflowState } from './types'

/**
 * Distributive Omit: `Omit<AgentEvent, 'at'>` over a union would collapse to the
 * shared properties only. Distributing keeps each member's own fields, so a call
 * site passing a literal `{ type: 'user_message', ... }` is checked against the
 * UserMessageEvent member (discriminated by `type`).
 */
type AgentEventInput = AgentEvent extends infer T
  ? T extends AgentEvent
    ? Omit<T, 'at'>
    : never
  : never

/**
 * Append an event to the log, stamping the authoritative `at` (ms epoch).
 * Callers pass the event WITHOUT `at`; this stamps it.
 */
export function appendEvent(state: WorkflowState, event: AgentEventInput): void {
  state.events.push({ ...event, at: Date.now() } as AgentEvent)
}

/**
 * Deterministic assistant message id derived from the log length.
 * Lives here rather than in workflow.ts so the main-loop step modules can mint one
 * too without importing back into workflow.ts (a cycle).
 */
export function nextMessageId(state: WorkflowState): string {
  return `assistant-${state.events.length}`
}
