import { PlannerOutputLike } from './runtime.types'

/**
 * PATCH_SPEC contract: must include at least one op, must not use coarse
 * shot-replacement ops (those are reserved for tool-artifact auto-apply),
 * and must not co-emit tool_calls.
 */
export function checkPatchSpecContract(
  output: PlannerOutputLike,
  options: { hasToolCalls: boolean },
): null | string {
  if (!output.ops || output.ops.length === 0) {
    return 'PATCH_SPEC must include at least one op.'
  }
  if (output.ops.some((op) => op.op === 'replace_shots_range' || op.op === 'replace_all_shots')) {
    return 'PATCH_SPEC must not use replace_shots_range/replace_all_shots; these coarse ops are reserved for tool artifact auto-apply.'
  }
  return options.hasToolCalls ? 'PATCH_SPEC must not include tool_calls.' : null
}
