// Do NOT import from workflow.ts
//
// UIP V2 -- plan_asset_assignment TOOL ACTIVITY (Task 2.6).
//
// Path: V1 `runPlanAssetAssignmentTool` wrapper. The wrapper runs the asset
// assignment LLM and writes the plan onto
// `session.cached_artifacts.pending_asset_assignment_plan`. We read it back off
// the mutated session.
//
// Output shape: AssetAssignmentPlanArtifact. foldSession.applyToolOutput for
// plan_asset_assignment stages this into pending_asset_assignment_plan and
// (auto_apply asset_assignment_to_ops) applies it to the spec.

import type { AssetAssignmentPlanArtifact } from '@reelmakeeasy/uip-planner-runtime'
import { runPlanAssetAssignmentTool } from '@reelmakeeasy/uip-planner-runtime'

import { prepareToolRuntime, toToolOutcome } from './runtime'
import type { ToolActivityInput, ToolActivityResult } from './types'

export async function planAssetAssignmentActivity(
  input: ToolActivityInput,
): Promise<ToolActivityResult> {
  const { runtime, session, userMessage } = await prepareToolRuntime(input)

  const result = await runPlanAssetAssignmentTool(runtime, session, userMessage)

  const output: AssetAssignmentPlanArtifact | undefined =
    session.cached_artifacts.pending_asset_assignment_plan
  return { output, toolResult: toToolOutcome(result) }
}
