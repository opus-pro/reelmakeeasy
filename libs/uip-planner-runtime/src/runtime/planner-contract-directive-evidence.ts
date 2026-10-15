import { SessionState, TodoExecutorHint } from '../types'

import { CheckClarifyScopeDeps, PlannerOutputLike } from './runtime.types'

export function getDirectivePhaseBaselineItems(
  session: SessionState,
  output: PlannerOutputLike,
): Array<{ executor_hint?: null | TodoExecutorHint; id: string; status: 'done' | 'pending' }> {
  if (output.todo_snapshot) {
    return output.todo_snapshot.items.map((item) => ({
      executor_hint: item.executor_hint,
      id: item.id,
      status: item.status,
    }))
  }
  return session.todo_state.items.map((item) => ({
    executor_hint: item.executor_hint,
    id: item.id,
    status: item.status,
  }))
}

/**
 * Rejects a directive done-close that has no evidence its hinted executor
 * tool actually ran. Without this, the planner can claim
 * `set_item_status: [{id, status:'done'}]` for a pending TOOL_CALLS directive
 * whose tool never dispatched, silently dropping the user's request. Skipped
 * when the caller supplies no evidence channel (back-compat) or when the
 * hinted tool is dispatched in the same turn (same-step dispatch).
 */
export function checkDirectiveExecutorEvidenceContract(
  phase: 'refinement' | 'script_review',
  phaseBaselineItems: Array<{
    executor_hint?: null | TodoExecutorHint
    id: string
    status: 'done' | 'pending'
  }>,
  statusUpdates: Array<{ id: string; status: 'done' | 'pending' }>,
  output: PlannerOutputLike,
  deps: CheckClarifyScopeDeps,
  sessionBaselineItems: Array<{
    executor_hint?: null | TodoExecutorHint
    id: string
    status: 'done' | 'pending'
  }>,
): null | string {
  if (deps.didDirectiveExecutorRun === undefined) {
    return null
  }

  const phaseBaselineById = new Map(phaseBaselineItems.map((item) => [item.id, item]))
  const sessionBaselineById = new Map(sessionBaselineItems.map((item) => [item.id, item]))
  for (const update of statusUpdates) {
    if (update.status !== 'done') {
      continue
    }
    const phaseBaseline = phaseBaselineById.get(update.id)
    const sessionBaseline = sessionBaselineById.get(update.id)
    const isPending = phaseBaseline?.status === 'pending' || sessionBaseline?.status === 'pending'
    if (!isPending) {
      continue
    }
    // The session hint is authoritative for an item that is pending in the
    // session: a same-turn snapshot could otherwise re-hint the directive away
    // from TOOL_CALLS and bypass the evidence check entirely.
    const hint =
      sessionBaseline?.status === 'pending'
        ? (sessionBaseline.executor_hint ?? phaseBaseline?.executor_hint)
        : (phaseBaseline?.executor_hint ?? sessionBaseline?.executor_hint)
    if (hint?.executor_type !== 'TOOL_CALLS' || !hint.executor_tool) {
      continue
    }
    const tool = hint.executor_tool
    const dispatchedThisTurn =
      output.action === 'TOOL_CALLS' &&
      (output.tool_calls?.some((toolCall) => toolCall.tool === tool) ?? false)
    if (dispatchedThisTurn || deps.didDirectiveExecutorRun(update.id)) {
      continue
    }
    return `${phase} todo_update must not mark directive '${update.id}' done: its executor tool '${tool}' has not run since the directive became pending. Dispatch TOOL_CALLS ${tool} to execute it, or if the user cancelled this request emit todo_snapshot without it.`
  }
  return null
}
