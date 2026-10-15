// Do NOT import from workflow.ts
//
// UIP V2 -- generate_explainer_script TOOL ACTIVITY (Task 2.6).
//
// Path: V1 `runGenerateScriptTool` wrapper. The wrapper runs the script LLM
// (or returns the seeded ASR script in user_audio mode), resolves shot_edits,
// validates the word budget, and writes the result onto
// `session.cached_artifacts.working_script` ({ script, shot_edits, scope,
// pending_vs_apply }). We read working_script back off the mutated session.
//
// Output shape: { script, shot_edits, scope, pending_vs_apply }. We read ALL
// four working_script fields back -- not just script + shot_edits. `scope` and
// `pending_vs_apply` are load-bearing for the FULL-scope script -> visual-script
// two-step dance: runGenerateVisualScriptTool's shouldPreferFullScriptArtifact
// requires working_script.pending_vs_apply === true (tool-runtime.ts) to prefer
// the freshly-rewritten full script over the stale shot-derived script source.
// Dropping them (the original bug) made foldSession reconstruct a working_script
// without pending_vs_apply, so a refinement full-script refresh was silently
// lost (VS regenerated from the old shots' audio_vo). foldSession.applyToolOutput
// re-stages all four.

import type { PlannerScopeSpec, ScriptShotEdit } from '@reelmakeeasy/uip-planner-runtime'
import { runGenerateScriptTool } from '@reelmakeeasy/uip-planner-runtime'

import { normalizeToolParams, prepareToolRuntime, toToolOutcome } from './runtime'
import type { ToolActivityInput, ToolActivityResult } from './types'

export interface GenerateScriptActivityOutput {
  pending_vs_apply?: boolean
  scope?: PlannerScopeSpec
  script: string
  shot_edits: ScriptShotEdit[]
}

export async function generateScriptActivity(
  input: ToolActivityInput,
): Promise<ToolActivityResult> {
  const { runtime, session, userMessage } = await prepareToolRuntime(input)
  const params = normalizeToolParams(input.toolName, input.toolInput)

  const result = await runGenerateScriptTool(runtime, session, userMessage, params)

  const working = session.cached_artifacts.working_script
  const output: GenerateScriptActivityOutput = {
    pending_vs_apply: working?.pending_vs_apply,
    scope: working?.scope,
    script: working?.script ?? '',
    shot_edits: working?.shot_edits ?? [],
  }
  return { output, toolResult: toToolOutcome(result) }
}
