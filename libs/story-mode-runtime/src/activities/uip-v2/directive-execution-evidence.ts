import type { PlannerTodoItem } from '@reelmakeeasy/uip-planner-runtime'

import type { AgentEvent } from '../../workflows/uip-v2/types'

import type { AnchorVsBatchOutput } from './tools/anchor-vs-batch'

/**
 * anchor_vs_batch dispatches generate_anchor_assets and
 * generate_explainer_visual_script as a single batched child; its
 * tool_completed carries toolName='anchor_vs_batch' instead of the individual
 * tool name. Mirrors the alias handled in session-state.ts artifactExistsFor.
 */
const ANCHOR_VS_BATCH_ALIAS_TOOLS = new Set([
  'generate_anchor_assets',
  'generate_explainer_visual_script',
])

export function buildDidDirectiveExecutorRun(
  events: AgentEvent[],
  items: PlannerTodoItem[],
): (directiveId: string) => boolean {
  return (directiveId: string): boolean => {
    const item = items.find((it) => it.id === directiveId)
    const hint = item?.executor_hint
    const tool = hint?.executor_type === 'TOOL_CALLS' ? hint.executor_tool : null
    if (!tool) {
      return false
    }

    const anchorIdx = findLastPendingIndex(events, directiveId)
    const eventsSincePending = events.slice(anchorIdx + 1)
    if (eventsSincePending.some((e) => e.type === 'tool_completed' && e.toolName === tool)) {
      return true
    }
    // A batch tool_completed can be a mixed result (one arm ok, the other
    // failed); only the requested tool's arm counts as evidence.
    return (
      ANCHOR_VS_BATCH_ALIAS_TOOLS.has(tool) &&
      eventsSincePending.some(
        (e) =>
          e.type === 'tool_completed' &&
          e.toolName === 'anchor_vs_batch' &&
          batchArmSucceeded(e.output, tool),
      )
    )
  }
}

function batchArmSucceeded(output: unknown, tool: string): boolean {
  const batch = output as AnchorVsBatchOutput | undefined
  const arm = tool === 'generate_anchor_assets' ? batch?.anchor : batch?.vs
  return arm?.ok === true
}

/**
 * Index of the last event that set `directiveId` to 'pending', via either a
 * full todo_snapshot introducing it pending or an incremental
 * set_item_status. Evidence found before this index is stale: it could belong
 * to a prior run of the directive, not the current pending window.
 */
function findLastPendingIndex(events: AgentEvent[], directiveId: string): number {
  let lastPendingIdx = -1
  for (const [index, event] of events.entries()) {
    if (event.type !== 'todo_updated') {
      continue
    }
    if (event.snapshot?.some((it) => it.id === directiveId && it.status === 'pending')) {
      lastPendingIdx = index
    }
    if (
      event.update?.set_item_status?.some((it) => it.id === directiveId && it.status === 'pending')
    ) {
      lastPendingIdx = index
    }
  }
  return lastPendingIdx
}
