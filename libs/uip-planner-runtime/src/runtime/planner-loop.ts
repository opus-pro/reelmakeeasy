import { PlannerRecoveryFailure, SessionState } from '../types'

import { PlannerOutputLike, PlannerStepResultLike } from './runtime.types'

export interface PlannerLoopIterationResult {
  hasScriptMutationThisTurn: boolean
  hasSpecMutationThisTurn: boolean
  hasUnresolvedDirectiveReconcileError: boolean
  lastActionResult: string
  shouldContinueLoop: boolean
  shouldStopImmediately: boolean
  stepResult?: PlannerStepResultLike
}

export interface PlannerLoopRuntimeDeps {
  /**
   * Reroute bootstrap_brand to bootstrap_script when brand extraction
   * fails (F1 skip-on-failure). Resets the todo list to the script-bootstrap
   * stages so the planner picks up t1/t2 as if no brand work was attempted.
   */
  activateBootstrapScript: (
    session: SessionState,
    source: 'phase_canonicalization.brand_extraction_failed',
  ) => void
  appendAgentReply: (session: SessionState, content: string) => void
  applyAgentMemory: (session: SessionState, output: PlannerOutputLike) => void
  /**
   * Returns the chain-aware prompt parts (system + user message + segment)
   * plus a `monolithic` field that the legacy non-chain code path
   * concatenated and sent as a single prompt. The runtime activity
   * wires `buildPlannerStepPrompt` from `runtime-phase.ts`; the
   * playground wires its own compatible function.
   */
  buildPlannerStepPrompt: (
    session: SessionState,
    userMessage: string,
    step: number,
    lastActionResult: string,
  ) => {
    monolithic: string
    segment: 'mode_confirmation' | 'post_confirmation'
    systemPrompt: string
    userMessage: string
  }
  /**
   * Chain-aware planner LLM call with three-layer retry. Returns the
   * parsed `result` plus the OpenAI Responses API `responseId` (when
   * chain mode succeeded). Caller writes `responseId` to
   * `session.cached_artifacts.planner_response_id` so the next step
   * can continue the chain.
   *
   * `monolithic` is the pre-built byte-exact full prompt the Gemini
   * fallback path consumes when chain mode fails -- threading it
   * through keeps guardrails (step_index / last_action_result) and the
   * full context shape correct in fallback. Without it, fallback would
   * have to rebuild the prompt with stale / default guardrails.
   */
  callPlanner: (input: {
    monolithic: string
    previousResponseId: string | undefined
    session: SessionState
    systemPrompt: string
    userMessage: string
  }) => Promise<{
    abandonedResponseId: string | undefined
    responseId: string | undefined
    result: null | PlannerOutputLike
  }>
  checkPlannerOutputContract: (session: SessionState, output: PlannerOutputLike) => null | string
  ensureAssetDescriptionsLoadedIfNeeded: (session: SessionState) => Promise<void>
  /**
   * Enter brand_review from bootstrap_brand once the child extraction
   * workflow signals `brand_extraction_ready` and the seed_brand_synthesis
   * patch has flipped status to 'completed'. Mirrors enterScriptReviewPhase.
   */
  enterBrandReviewPhase: (
    session: SessionState,
    source:
      | 'phase_canonicalization.bootstrap_brand_complete'
      | 'phase_canonicalization.brand_extraction_manual_entry',
  ) => void
  enterRefinementPhase: (
    session: SessionState,
    source: 'phase_canonicalization.bootstrap_visual_complete',
  ) => void
  enterScriptReviewPhase: (
    session: SessionState,
    source: 'phase_canonicalization.bootstrap_script_complete',
  ) => void
  getPendingTodoCount: (session: SessionState) => number
  hydrateBootstrapTodoFromArtifacts: (session: SessionState) => boolean
  isBootstrapArtifactsComplete: (session: SessionState) => boolean
  isBootstrapDraftPhase: (session: SessionState) => boolean
  normalizeSessionControlOutput: (session: SessionState, output: PlannerOutputLike) => void
  recordRecoveryFailure: (session: SessionState, failure: PlannerRecoveryFailure) => void
  sessionStore: {
    updateSession: (session: SessionState) => Promise<void>
  }
}
