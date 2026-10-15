// Do NOT import from workflow.ts
//
// UIP V2 -- generate_intent_context TOOL ACTIVITY (Task 2.6).
//
// Path: V1 `runGenerateIntentContextTool` wrapper. The wrapper runs the intent
// LLM (+ optional brand styling), canonicalizes the global_constraints (which
// now carries `directives` -- the user's positive hard requirements -- inline,
// parallel to must_not_violate), and stages them onto
// `session.cached_artifacts.pending_global_constraints` (it also copies style
// into the live spec). We read that staged slot back off the mutated session.
//
// Output shape: { global_constraints }. foldSession.applyToolOutput stages it
// into `cached_artifacts.pending_global_constraints` and the auto_apply
// `global_constraints_to_ops` mapper applies it to the spec.

import type { GlobalConstraints } from '@reelmakeeasy/uip-planner-runtime'
import { runGenerateIntentContextTool } from '@reelmakeeasy/uip-planner-runtime'

import { prepareToolRuntime, toToolOutcome } from './runtime'
import type { ToolActivityInput, ToolActivityResult } from './types'

export interface GenerateIntentContextActivityOutput {
  global_constraints?: GlobalConstraints
}

export async function generateIntentContextActivity(
  input: ToolActivityInput,
): Promise<ToolActivityResult> {
  const { runtime, session, userMessage } = await prepareToolRuntime(input)

  const result = await runGenerateIntentContextTool(runtime, session, userMessage)

  const output: GenerateIntentContextActivityOutput = {
    global_constraints: session.cached_artifacts.pending_global_constraints,
  }
  return { output, toolResult: toToolOutcome(result) }
}
