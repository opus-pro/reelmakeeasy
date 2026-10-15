// Pure tool-output field extractors, pulled out of session-state.ts to keep
// that file under the 800-line cap. Each reads one optional
// field off an unknown tool output, returning undefined when absent/malformed.

import type {
  CachedArtifacts,
  PromptRouteArtifact,
  ScriptShotEdit,
  Shot,
} from '@reelmakeeasy/uip-planner-runtime'

export function extractPendingVsApply(output: unknown): boolean | undefined {
  if (output && typeof output === 'object' && 'pending_vs_apply' in output) {
    const value = (output as Record<string, unknown>).pending_vs_apply
    return typeof value === 'boolean' ? value : undefined
  }
  return undefined
}

export function extractPromptRoute(output: unknown): null | PromptRouteArtifact | undefined {
  if (output && typeof output === 'object' && 'prompt_route' in output) {
    return (output as Record<string, unknown>).prompt_route as
      | null
      | PromptRouteArtifact
      | undefined
  }
  return undefined
}

export function extractScope(
  output: unknown,
): CachedArtifacts['pending_visual_script_scope'] | undefined {
  if (output && typeof output === 'object' && 'scope' in output) {
    return (output as Record<string, unknown>)
      .scope as CachedArtifacts['pending_visual_script_scope']
  }
  return undefined
}

export function extractShotEdits(output: unknown): ScriptShotEdit[] | undefined {
  if (output && typeof output === 'object' && 'shot_edits' in output) {
    const value = (output as Record<string, unknown>).shot_edits
    return Array.isArray(value) ? (value as ScriptShotEdit[]) : undefined
  }
  return undefined
}

export function extractShots(output: unknown): Shot[] | undefined {
  if (output && typeof output === 'object' && 'shots' in output) {
    const value = (output as Record<string, unknown>).shots
    return Array.isArray(value) ? (value as Shot[]) : undefined
  }
  return undefined
}

export function extractString(output: unknown, key: string): string | undefined {
  if (output && typeof output === 'object' && key in output) {
    const value = (output as Record<string, unknown>)[key]
    return typeof value === 'string' ? value : undefined
  }
  return undefined
}
