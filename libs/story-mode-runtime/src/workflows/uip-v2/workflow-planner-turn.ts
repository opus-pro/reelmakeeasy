// Do NOT import from workflow.ts
//
// runPlannerTurn (design step 7g), extracted from workflow.ts to keep that file
// under the max-lines cap. One planner LLM call + decision execution, with the
// contract-error / action-failure re-prompt loop. Activity/Node deps are behind
// the proxied plannerStepActivity + executeDecision; this workflow file imports
// only local pure modules (plus planner-runtime types).

import type { PlannerOutput, UipSessionWorkflowParams } from '@reelmakeeasy/uip-planner-runtime'

import type { PlannerStepFn } from './activity-proxies'
import { appendEvent } from './event-log'
import { executeDecision } from './execute-decision'
import { consecutiveIdenticalFailures, foldPhase, getLastActionResult, getStepIndex } from './folds'
import {
  appendRecoveryFailure,
  nowIso,
  surfaceContractGiveUp,
  surfaceToolFailureGiveUp,
} from './planner-turn-helpers'
import type { WorkflowState } from './types'

/** Max re-prompts for the SAME contract error before giving up (V1 parity). */
const MAX_SAME_CONTRACT_ERROR_RETRIES = 2
/** Hard cap on planner calls in one turn (bounds cost/history if errors vary). */
const MAX_PLANNER_ATTEMPTS_PER_TURN = 4
/**
 * Hard stop for consecutive identical tool failures since the last user message.
 * Slightly more lenient than MAX_SAME_CONTRACT_ERROR_RETRIES because tool errors
 * can be transient (infra blip, rate limit) and the planner needs a turn to
 * observe the failure and choose a different approach before we give up.
 */
const MAX_CONSECUTIVE_TOOL_FAILURES = 3

type PlannerStepResult = Awaited<ReturnType<PlannerStepFn>>

function applyPlannerChainStep(state: WorkflowState, step: PlannerStepResult): void {
  // Pin the A/B arm on the first round that reports one, then never re-read it:
  // the activity only resolves the config when this is undefined, so the model a
  // session starts on is the model it finishes on.
  state.plannerModel = step.plannerModel ?? state.plannerModel
  state.plannerChainGroundingKey = step.groundingKey ?? state.plannerChainGroundingKey
  state.plannerChainSegment = step.segment
  state.plannerResponseId = step.resetPlannerChain
    ? null
    : (step.responseId ?? state.plannerResponseId)
  const abandonedResponseIds =
    step.abandonedResponseIds ?? (step.abandonedResponseId ? [step.abandonedResponseId] : [])
  for (const responseId of abandonedResponseIds) {
    if (!state.plannerOrphanedChainResponseIds.includes(responseId)) {
      state.plannerOrphanedChainResponseIds.push(responseId)
    }
  }
}

/**
 * Run one planner turn (7g): call the activity, thread the Responses-chain state
 * forward, then either execute the decision or, on a contract error, re-prompt
 * the planner with the error fed back (V1 handleContractError parity) up to the
 * retry cap, after which it surfaces a user-facing message and parks.
 */
export async function runPlannerTurn(
  state: WorkflowState,
  plannerStepActivity: PlannerStepFn,
  projectId: string,
  taskQueue: string,
  params: UipSessionWorkflowParams,
): Promise<void> {
  // Hard stop: if the same tool has failed consecutively too many times this
  // turn, surface a message and park rather than burning another LLM call.
  const consecutiveFails = consecutiveIdenticalFailures(state.events)
  if (consecutiveFails >= MAX_CONSECUTIVE_TOOL_FAILURES) {
    surfaceToolFailureGiveUp(state)
    return
  }

  // Per-turn feedback fed into the next planner call (V1 lastActionResult).
  // When there are consecutive failures, annotate the count so the planner
  // knows this is a repeat and can self-correct (e.g. narrow scope, ask user).
  let lastActionResult = getLastActionResult(state.events)
  if (consecutiveFails > 1) {
    lastActionResult += ` [${consecutiveFails} consecutive failures — consider a different approach or ask the user]`
  }

  // Count repeats of the same action:error so we stop a contract-error loop.
  const contractErrorCounts = new Map<string, number>()

  for (let attempt = 0; attempt < MAX_PLANNER_ATTEMPTS_PER_TURN; attempt++) {
    // Mark the planner call in-flight so is_processing (the "Thinking" indicator)
    // is true during the LLM roundtrip, not only while a tool runs. Passive: it
    // never wakes the loop; the matching planner_decided below clears it.
    appendEvent(state, { type: 'planner_start', timestamp: nowIso() })
    const step = await plannerStepActivity({
      currentArtifacts: state.currentArtifacts,
      events: state.events,
      lastActionResult,
      plannerChainGroundingKey: state.plannerChainGroundingKey ?? 'base',
      plannerChainSegment: state.plannerChainSegment,
      plannerModel: state.plannerModel,
      plannerResponseId: state.plannerResponseId,
      stepIndex: getStepIndex(state.events) + attempt,
    })

    // Thread the OpenAI Responses chain state forward. groundingKey is absent
    // only on pre-rollout step results (keep the prior value then).
    applyPlannerChainStep(state, step)

    if (step.decision == null) {
      // No decision after all callPlanner retries: record a backstop trace and
      // park (the boundary already advanced, so we will not re-fire).
      appendRecoveryFailure(
        state,
        'PLANNER_NO_DECISION',
        'planner',
        'planner returned no decision',
        false,
      )
      return
    }

    if (step.contractError) {
      // Contract error is surfaced (not thrown). Record a trace, then re-prompt
      // the planner with the error as lastActionResult so it self-corrects
      // (mirrors V1 planner-loop handleContractError). Give up after the cap.
      appendRecoveryFailure(
        state,
        'PLANNER_CONTRACT_ERROR',
        'planner_contract',
        step.contractError,
        true,
      )
      const key = `${step.decision.action}:${step.contractError}`
      const count = (contractErrorCounts.get(key) ?? 0) + 1
      contractErrorCounts.set(key, count)
      if (count >= MAX_SAME_CONTRACT_ERROR_RETRIES) {
        surfaceContractGiveUp(state)
        return
      }
      lastActionResult = `Planner output contract error: ${step.contractError}`
      continue
    }

    appendEvent(state, {
      type: 'planner_decided',
      decision: step.decision,
      stepIndex: getStepIndex(state.events),
    })

    const failure = await executeDecision(state, step.decision, projectId, taskQueue, {
      runtimeClarificationKind: step.runtimeClarificationKind,
      verifiedPastedScript: step.verifiedPastedScript,
    })
    if (failure) {
      // A planner-decided spec mutation (PATCH_SPEC op / UNDO_LAST) failed to
      // apply. Mirror the contract-error path: record the failure, feed the
      // specific error back as lastActionResult, and re-prompt so the planner can
      // correct or explain -- bounded by the same per-(action,error) retry cap so
      // a persistently-bad op cannot loop. (Tool failures get the same feedback
      // via getLastActionResult; this is the equivalent for synchronous applies.)
      appendRecoveryFailure(state, failure.errorCode, 'artifact_apply', failure.errorMessage, true)
      const key = `${step.decision.action}:${failure.errorMessage}`
      const count = (contractErrorCounts.get(key) ?? 0) + 1
      contractErrorCounts.set(key, count)
      if (count >= MAX_SAME_CONTRACT_ERROR_RETRIES) {
        surfaceContractGiveUp(state)
        return
      }
      lastActionResult = `${step.decision.action} failed: ${failure.errorMessage}`
      continue
    }
    return
  }

  // Exhausted the per-turn attempt budget on contract errors -> give up.
  surfaceContractGiveUp(state)
}
