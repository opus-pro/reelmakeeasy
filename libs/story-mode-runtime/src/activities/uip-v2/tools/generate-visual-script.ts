// Do NOT import from workflow.ts
//
// UIP V2 -- generate_explainer_visual_script TOOL ACTIVITY (Task 2.6).
//
// Path: V1 `runGenerateVisualScriptTool` wrapper. The wrapper runs the visual
// script LLM (beat-sheet / anchor plan / merge), and writes the merged shots +
// scope onto `session.cached_artifacts.pending_visual_script_shots` /
// `pending_visual_script_scope`. We read both back off the mutated session.
//
// structure_edit: V1 passes the structure_edit as a SEPARATE arg (not inside
// params). The Phase-3 tool-runner contract only carries `toolInput`, so we read
// an optional `structure_edit` field off toolInput and forward it to the wrapper.
// When absent, undefined is passed (a plain full/scoped regenerate).
//
// Output shape: { shots, scope, prompt_route? }. foldSession.applyToolOutput for
// generate_explainer_visual_script reads output.shots (Shot[]) and output.scope,
// stages them into pending_visual_script_shots / pending_visual_script_scope,
// preserves the prompt_route artifact, and (auto_apply visual_script_to_ops) applies them to the
// spec.

import type {
  PlannerScopeSpec,
  PlannerStructureEdit,
  PromptRouteArtifact,
  Shot,
} from '@reelmakeeasy/uip-planner-runtime'
import { runGenerateVisualScriptTool } from '@reelmakeeasy/uip-planner-runtime'

import { normalizeToolParams, prepareToolRuntime, toToolOutcome } from './runtime'
import type { ToolActivityInput, ToolActivityResult } from './types'

export interface GenerateVisualScriptActivityOutput {
  prompt_route?: null | PromptRouteArtifact
  scope?: PlannerScopeSpec
  shots: Shot[]
}

export async function generateVisualScriptActivity(
  input: ToolActivityInput,
): Promise<ToolActivityResult> {
  const { runtime, session, userMessage } = await prepareToolRuntime(input)
  const params = normalizeToolParams(input.toolName, input.toolInput)

  // structure_edit rides alongside the params on toolInput (V1 plumbs it as a
  // separate arg). Read it defensively; undefined => plain regenerate.
  const structureEdit =
    input.toolInput && typeof input.toolInput === 'object' && 'structure_edit' in input.toolInput
      ? ((input.toolInput as { structure_edit?: null | PlannerStructureEdit }).structure_edit ??
        undefined)
      : undefined

  const result = await runGenerateVisualScriptTool(
    runtime,
    session,
    userMessage,
    params,
    structureEdit,
  )

  const promptRoute = session.cached_artifacts.prompt_route
  const output: GenerateVisualScriptActivityOutput = {
    scope: session.cached_artifacts.pending_visual_script_scope,
    shots: session.cached_artifacts.pending_visual_script_shots ?? [],
  }
  if (promptRoute === undefined) {
    return { output, toolResult: toToolOutcome(result) }
  }
  output.prompt_route = promptRoute
  return { output, toolResult: toToolOutcome(result) }
}
