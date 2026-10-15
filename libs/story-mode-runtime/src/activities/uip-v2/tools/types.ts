// Do NOT import from workflow.ts
//
// UIP V2 -- shared input/output contract for the 6 TOOL ACTIVITIES (Task 2.6).
// Each tool activity reconstructs a V1 SessionState from the event log via
// foldSession, runs the V1 tool (reusing the run*Tool wrappers), and returns the
// produced artifact as `output`. The Phase-3 tool-runner child workflow passes
// the input; the parent later appends `tool_completed { output }` and
// foldSession.applyToolOutput re-stages `output` into cached_artifacts. So each
// activity's `output` MUST be the artifact shape applyToolOutput expects for
// that tool (see session-state.ts).
//
// These activities run on the activity (Node) side, so VALUE imports of the V1
// planner runtime are allowed. They MUST NEVER be imported by a workflow file
// (they pull the V1 tool runtime -> provider clients).

import type { AgentEvent, ArtifactSlot } from '../../../workflows/uip-v2/types'

export interface ToolActivityInput {
  // This tool child's own workflow id; tags streamed progress messages as
  // child_id on the parent. Optional: when absent, progress streaming is skipped.
  childWorkflowId?: string
  currentArtifacts: Record<string, ArtifactSlot>
  events: AgentEvent[]
  // Parent session workflow id; the activity signals it (childProgressMessage)
  // with each appendProgressReply milestone. Optional (see childWorkflowId).
  parentWorkflowId?: string
  projectId: string
  // The planner's tool_call params (PlannerToolParams-shaped for the tools that
  // need it). For generate_explainer_visual_script the optional `structure_edit`
  // may ride alongside the params (V1 passes it as a separate arg; we read it off
  // toolInput here -- see generate-visual-script.ts).
  toolInput: unknown
  // One of the 6 tool names. The activity keys its read-back off this.
  toolName: string
}

/**
 * The run*Tool ToolCallResult outcome surfaced back to the tool-runner so an
 * `ok:false` soft failure (MISSING_DEPENDENCY / INVALID_INPUT / partial
 * generation) becomes a `tool_failed` event carrying the reason -- not a silent
 * empty `tool_completed`. Subset of V1 `ToolCallResult` (the fields the
 * tool-runner needs to shape the signal). `message` already encodes the missing
 * dependency list textually, so the `missing` array is intentionally omitted.
 */
export interface ToolActivityResult {
  // The produced artifact, shaped to match foldSession.applyToolOutput's
  // staging for `toolName`. Present even on an ok:false outcome when the tool
  // staged a partial artifact before failing (e.g. anchor partial summary), so
  // the tool-runner can preserve it on the tool_failed event.
  output: unknown
  // The run*Tool outcome. The tool-runner emits tool_completed when ok, else
  // tool_failed with code + message.
  toolResult: ToolOutcome
}

export interface ToolOutcome {
  code: string
  message: string
  ok: boolean
  retryable: boolean
}
