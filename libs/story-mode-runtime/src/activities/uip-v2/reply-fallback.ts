// UIP V2 -- runtime reply fallbacks (activity side; value imports of the V1
// reply-vocab are allowed here, NOT in workflow code).
//
// V1's action handlers backfill a user-facing reply when the planner leaves
// `reply` empty (handleModeConfirmedAction, handlePatchAction, handleToolCalls /
// batch). V2's executeDecision lives in workflow code and can only surface
// `decision.reply`, so we apply the SAME fallbacks here in the planner-step
// activity (which already imports reply-vocab) and bake the result into
// `decision.reply`. executeDecision then surfaces it unchanged -- no reply-vocab import there.

import type { PatchOp, PlannerOutput, PlannerToolCall } from '@reelmakeeasy/uip-planner-runtime'
import {
  describeMode,
  describePatchOpsForUser,
  describeToolActivity,
} from '@reelmakeeasy/uip-planner-runtime/runtime/reply-vocab'

/**
 * Mirror V1's per-handler reply fallbacks: when the planner returns an empty
 * `reply` for an action that V1 backfills, fill it with the same runtime string.
 * Returns the decision unchanged when `reply` is non-empty or the action has no
 * V1 fallback. Pure.
 */
export function applyRuntimeReplyFallback(decision: PlannerOutput): PlannerOutput {
  if (decision.reply?.trim()) {
    return decision
  }
  const fallback = computeFallback(decision)
  return fallback ? { ...decision, reply: fallback } : decision
}

function computeFallback(decision: PlannerOutput): null | string {
  switch (decision.action) {
    // handleModeConfirmedAction duration / no-duration fallback
    // (planner-actions.ts:293-297).
    case 'MODE_CONFIRMED': {
      const label = describeMode(decision.mode_update?.mode)
      const duration = decision.mode_update?.duration_seconds
      return duration && duration > 0
        ? `Got it — a ${duration}-second ${label}. I'll start working on it.`
        : `Got it. I'll start on your ${label}.`
    }
    // handlePatchAction: describePatchOpsForUser(ops) (planner-actions.ts:332).
    case 'PATCH_SPEC': {
      const ops = (decision.ops ?? []) as PatchOp[]
      return ops.length ? describePatchOpsForUser(ops) : null
    }
    // handleToolCallsAction / handleToolCallBatchAction: "I'm {activity} and
    // {activity}..." (planner-actions.ts:610, planner-actions-batch.ts:371).
    case 'TOOL_CALLS': {
      const calls = (decision.tool_calls ?? []) as PlannerToolCall[]
      if (!calls.length) {
        return null
      }
      return `I'm ${calls.map((c) => describeToolActivity(c.tool)).join(' and ')}...`
    }
    default: {
      return null
    }
  }
}
