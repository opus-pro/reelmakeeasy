// Do NOT import from workflow.ts
//
// Tool-call-state fold helper, split out of session-state.ts to keep it under the
// strict max-lines cap. Activity-side (uip-planner-runtime SessionState).

import type { SessionState } from '@reelmakeeasy/uip-planner-runtime'

/**
 * Update an existing tool_call_states entry (matched by id) to a terminal status,
 * stamping ended_at and (for failures) message. No-op if the id is not present -- a
 * tool_completed without a matching tool_started should not crash the projection.
 */
export function updateToolCallState(
  state: SessionState,
  toolCallId: string,
  status: 'failed' | 'running' | 'succeeded',
  at: string,
  errorMessage?: string,
): void {
  state.tool_call_states ??= []
  const entry = state.tool_call_states.find((e) => e.id === toolCallId)
  if (!entry) {
    return
  }
  entry.status = status
  entry.ended_at = at
  if (errorMessage !== undefined) {
    entry.message = errorMessage
  }
}
