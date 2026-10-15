import type { SubstepStatus } from '@reelmakeeasy/common/utils/tool-step-timing'
import type {
  SessionState,
  SubstepState,
  ToolCallStateEntry,
} from '@reelmakeeasy/uip-planner-runtime'
import { ALWAYS_SUBSTEPS, describeSubstep } from '@reelmakeeasy/uip-planner-runtime'

import type { AgentEvent } from '../../workflows/uip-v2/types'

type SubTools = NonNullable<NonNullable<SessionState['tool_call_states']>[number]['sub_tools']>

// Monotonic ranking of substep lifecycle states. A tool_substep tick may only
// advance a substep along not_started -> running -> completed; a lower-or-equal
// rank is dropped so a retried activity re-signalling 'running' can never
// downgrade a step the user already saw complete.
const SUBSTEP_STATUS_RANK: Record<SubstepStatus, number> = {
  completed: 2,
  not_started: 0,
  running: 1,
}

/**
 * Predeclare the always-run substeps of `toolName` as `not_started` (with their
 * catalog descriptions) so the FE renders a stable, complete checklist the
 * moment the tool starts. Conditional substeps are omitted -- they enter the map
 * later via foldToolSubstep on their first `running` tick. Returns undefined for
 * tools with no always-run inventory, so their entry carries no sub_tools.
 */
export function buildInitialSubTools(toolName: string): SubTools | undefined {
  const substeps = ALWAYS_SUBSTEPS[toolName]
  if (!substeps || substeps.length === 0) {
    return undefined
  }
  return [
    {
      id: toolName,
      sub_step_states: Object.fromEntries(
        substeps.map((step): [string, SubstepState] => [
          step,
          { description: describeSubstep(step), status: 'not_started' },
        ]),
      ),
    },
  ]
}

export function buildStartedToolCallState(
  event: Extract<AgentEvent, { type: 'tool_started' }>,
): ToolCallStateEntry {
  const entry: ToolCallStateEntry = {
    id: event.toolCallId,
    started_at: event.startedAt,
    status: 'running',
    // V2 events type tool names as `string`, but V1 ToolCallStateEntry.tools
    // is the 6-tool union; the value is only stored here, never dispatched on.
    tools: [event.toolName as never],
  }
  const subTools = buildInitialSubTools(event.toolName)
  if (subTools) {
    entry.sub_tools = subTools
  }
  return entry
}

/**
 * Clear a completed tool's substep progress by setting `sub_tools = []` (an
 * intentional empty array, not a deleted key: spread-merge overlays would treat
 * a missing key as "keep the stale progress"). No-op if the id is not present.
 */
export function clearToolSubTools(
  entries: ToolCallStateEntry[] | undefined,
  toolCallId: string,
): void {
  const entry = entries?.find((e) => e.id === toolCallId)
  if (entry) {
    entry.sub_tools = []
  }
}

/**
 * Fold a passive+transient tool_substep tick into the matching tool call's
 * `sub_tools` (publish-only). Ignores substeps with no live tool_started entry.
 * A conditional substep (absent from the predeclared inventory) is created on
 * its first tick; a predeclared one is upgraded per SUBSTEP_STATUS_RANK.
 */
export function foldToolSubstep(
  entries: ToolCallStateEntry[] | undefined,
  event: Extract<AgentEvent, { type: 'tool_substep' }>,
): void {
  const entry = entries?.find((e) => e.id === event.toolCallId)
  if (!entry) {
    return
  }
  entry.sub_tools ??= []
  let subTool = entry.sub_tools.find((s) => s.id === event.toolName)
  if (!subTool) {
    subTool = { id: event.toolName, sub_step_states: {} }
    entry.sub_tools.push(subTool)
  }
  const current = subTool.sub_step_states[event.substep]
  if (!current || SUBSTEP_STATUS_RANK[event.status] > SUBSTEP_STATUS_RANK[current.status]) {
    subTool.sub_step_states[event.substep] = {
      description: describeSubstep(event.substep),
      status: event.status,
    }
  }
}
