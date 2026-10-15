/**
 * Activity Deps Factory (Architecture doc section 8.1)
 *
 * Builds a plain object that has the SAME shape as the runtime.ts facade class
 * instance (`this`). Sub-modules cast this to their specific `*Deps` interfaces
 * via `runtime as XxxDeps` -- they don't care if it's a class or a plain object.
 *
 * This factory eliminates the NestJS DI dependency so the planner loop can run
 * inside an activity (which is a pure function, not a class).
 *
 * Type safety note: This is a duck-typing bridge layer. Sub-modules do
 * `(runtime as SomeDepsInterface)`, so the object only needs to have methods
 * with matching names and compatible shapes at runtime.
 */

import type {
  PlannerOutput,
  PlannerOutputLike,
  SessionControlCommand,
  SessionState,
  SharedArtifactBatchContext,
} from '@reelmakeeasy/uip-planner-runtime'
import {
  activateBootstrapScript,
  appendAgentReply,
  appendProgressReply,
  // Spec + patch
  applyPatchOps,
  // Facade helpers
  applyTodoStateUpdate,
  applyToolArtifactsToSpec,
  // Context
  buildDirectivesExtractionInput,
  buildResponse,
  // Contract + guards
  checkPlannerOutputContract,
  clearSharedArtifactBatchContext,
  // Shared artifact batch
  createSharedArtifactBatchContext,
  ensureAssetDescriptionsLoadedIfNeeded,
  // Phase
  enterRefinementPhase,
  // Tools
  executeToolCall,
  executeUndoLastInternal,
  getAssetContextLightJson,
  getAssetDescriptionsJson,
  getPendingTodoCount,
  getSharedArtifactBatchContext,
  getUndescribedUploadedAssets,
  guardIntentRoutingBeforeAction,
  guardSessionControlBeforeAction,
  guardUndescribedAssetsBeforeAction,
  hasPendingTodoItems,
  hydrateBootstrapTodoFromArtifacts,
  // Todo
  isBootstrapArtifactsComplete,
  isBootstrapDraftPhase,
  markTodoStageDoneByTool,
  normalizeSessionControlOutput,
  // Recovery
  recordRecoveryFailure,
  recordToolEvent,
  recordToolResult,
  setSharedArtifactBatchContext,
  syncPostSpecMutation,
  withDefaultToolParams,
} from '@reelmakeeasy/uip-planner-runtime'
import type { CheckClarifyScopeDeps } from '@reelmakeeasy/uip-planner-runtime/runtime/runtime.types'
import type { GuardUndescribedAssetsDeps } from '@reelmakeeasy/uip-planner-runtime/runtime/runtime.types'
import {
  buildPlannerStepPrompt as buildPlannerStepPromptFn,
  callPlanner as callPlannerFn,
  isSessionLocked as isSessionLockedFn,
  transitionToBrandReview as transitionToBrandReviewFn,
  transitionToScriptReview as transitionToScriptReviewFn,
} from '@reelmakeeasy/uip-planner-runtime/runtime/runtime-phase'

import type { SessionStoreLike } from './in-memory-session-store'

/**
 * Bind `deps` as the first argument of a function that expects `(runtime: object, ...)`.
 * This is the core mechanism: sub-modules call `fn(runtime, session, ...)` where
 * `runtime` is our deps object. The method on deps is `(session, ...)`.
 */
function bindDeps<TArgs extends unknown[], TReturn>(
  deps: () => object,
  fn: (runtime: object, ...args: TArgs) => TReturn,
) {
  return (...args: TArgs) => fn(deps(), ...args)
}

/**
 * Build a deps object that mirrors the shape of UserIntentPlannerRuntime.
 *
 * Every sub-module in `@reelmakeeasy/uip-planner-runtime` does:
 *   `const deps = runtime as SomeDeps`
 * so we need an object with all the methods those interfaces expect.
 */
export function buildPlannerDeps(sessionStore: SessionStoreLike): object {
  const deps: Record<string, unknown> = {}

  // Lazy self-reference for bindDeps
  const self = () => deps as object

  //
  deps.sessionStore = sessionStore

  //
  deps.appendAgentReply = bindDeps(self, appendAgentReply)
  deps.appendProgressReply = bindDeps(self, appendProgressReply)
  deps.buildResponse = buildResponse

  //
  deps.applyPatchOps = bindDeps(self, applyPatchOps)
  deps.applyToolArtifactsToSpec = bindDeps(self, applyToolArtifactsToSpec)
  deps.syncPostSpecMutation = bindDeps(self, syncPostSpecMutation)

  deps.buildPlannerStepPrompt = buildPlannerStepPromptFn

  deps.callPlanner = callPlannerFn

  // checkPlannerOutputContract: planner-loop calls (session, output),
  // but the function expects (session, output, deps). Custom wrapper.
  deps.checkPlannerOutputContract = (session: SessionState, output: PlannerOutputLike) =>
    checkPlannerOutputContract(session, output, self() as CheckClarifyScopeDeps)

  // PlannerLoopRuntimeDeps expects (session, output), but the actual function is (output, sessionId)
  deps.normalizeSessionControlOutput = (session: SessionState, output: PlannerOutput) =>
    normalizeSessionControlOutput(output, session.sessionId)

  //
  // guardIntentRoutingBeforeAction: planner-actions calls (session, userMessage, output, policyHintedSignatures),
  // but the function expects ({ session, userMessage, output, policyHintedSignatures }). Custom wrapper.
  deps.guardIntentRoutingBeforeAction = (
    session: SessionState,
    userMessage: string,
    output: PlannerOutputLike,
    policyHintedSignatures: Set<string>,
  ) => guardIntentRoutingBeforeAction({ session, userMessage, output, policyHintedSignatures })
  // guardSessionControlBeforeAction: planner-actions calls (session, userMessage, output, successfulSessionControlsThisTurn, hasSpecMutationThisTurn),
  // but the function expects a single options object. Custom wrapper.
  deps.guardSessionControlBeforeAction = (
    session: SessionState,
    userMessage: string,
    output: PlannerOutputLike,
    successfulSessionControlsThisTurn: Set<SessionControlCommand>,
    hasSpecMutationThisTurn: boolean,
  ) =>
    guardSessionControlBeforeAction({
      session,
      userMessage,
      output,
      successfulSessionControlsThisTurn,
      hasSpecMutationThisTurn,
    })
  // guardUndescribedAssetsBeforeAction: planner-actions calls (session, output),
  // but the function expects (output, session, deps). Custom wrapper.
  deps.guardUndescribedAssetsBeforeAction = (session: SessionState, output: PlannerOutputLike) =>
    guardUndescribedAssetsBeforeAction(output, session, self() as GuardUndescribedAssetsDeps)

  //
  deps.executeToolCall = bindDeps(self, executeToolCall)
  deps.ensureAssetDescriptionsLoadedIfNeeded = bindDeps(self, ensureAssetDescriptionsLoadedIfNeeded)
  deps.recordToolResult = recordToolResult
  deps.recordToolEvent = recordToolEvent
  deps.withDefaultToolParams = withDefaultToolParams
  deps.markTodoStageDoneByTool = markTodoStageDoneByTool

  //
  deps.executeUndoLastInternal = bindDeps(self, executeUndoLastInternal)
  // enterScriptReviewGate: planner-actions calls (session),
  // same as enterScriptReviewPhase but with 'enter_script_review_gate' source.
  deps.enterScriptReviewGate = (session: SessionState) =>
    transitionToScriptReviewFn(
      session,
      'enter_script_review_gate',
      (s: SessionState, content: string) => appendAgentReply(self(), s, content),
      { appendAgentReply: true, forceNewReviewGate: true },
    )

  //
  // enterRefinementPhase: planner-loop calls (session, source),
  // but the actual function expects (session, source, isSessionLocked). Bind the 3rd arg.
  deps.enterRefinementPhase = (
    session: SessionState,
    source:
      | 'consistency_repair.bootstrap_visual_complete'
      | 'phase_canonicalization.bootstrap_visual_complete',
  ) => enterRefinementPhase(session, source, isSessionLockedFn)
  // enterScriptReviewPhase: planner-loop calls (session, source),
  // but the actual function is transitionToScriptReview(session, source, appendAgentReplyFn, options).
  deps.enterScriptReviewPhase = (
    session: SessionState,
    source:
      | 'consistency_repair.bootstrap_script_complete'
      | 'enter_script_review_gate'
      | 'phase_canonicalization.bootstrap_script_complete',
  ) =>
    transitionToScriptReviewFn(
      session,
      source,
      (s: SessionState, content: string) => appendAgentReply(self(), s, content),
      { appendAgentReply: true, forceNewReviewGate: true },
    )

  // enterBrandReviewPhase: planner-loop calls (session, source); the actual
  // function is transitionToBrandReview(session, source, appendAgentReplyFn,
  // options). Mirrors enterScriptReviewPhase wiring above.
  deps.enterBrandReviewPhase = (
    session: SessionState,
    source:
      | 'consistency_repair.bootstrap_brand_complete'
      | 'phase_canonicalization.bootstrap_brand_complete'
      | 'phase_canonicalization.brand_extraction_manual_entry',
  ) =>
    transitionToBrandReviewFn(
      session,
      source,
      (s: SessionState, content: string) => appendAgentReply(self(), s, content),
      {
        // The manual-entry reroute already appends a tailored failure message
        // in canonicalize; suppress the generic "ready to review" copy here.
        appendAgentReply: source !== 'phase_canonicalization.brand_extraction_manual_entry',
        forceNewReviewGate: true,
      },
    )

  // activateBootstrapScript: planner-loop calls (session, source) for the
  // F1 brand-extraction-failed reroute.
  deps.activateBootstrapScript = activateBootstrapScript

  //
  deps.isBootstrapArtifactsComplete = isBootstrapArtifactsComplete
  deps.hydrateBootstrapTodoFromArtifacts = hydrateBootstrapTodoFromArtifacts
  deps.getPendingTodoCount = getPendingTodoCount
  deps.hasPendingTodoItems = hasPendingTodoItems
  deps.isBootstrapDraftPhase = isBootstrapDraftPhase
  // applyAgentMemory: applies the full LLM output "memory" to session state.
  // The original prototype did 3 things: conversation_summary, mode_state, and todo_state.
  // applyTodoStateUpdate only handles todo. We must also apply the other two.
  deps.applyAgentMemory = (session: SessionState, output: PlannerOutputLike) => {
    session.conversation_summary = output.conversation_summary_update ?? ''
    // Spread prior mode_state first so any field this LLM call doesn't own
    // is preserved by default. Future fields stay safe without per-field
    // threading.
    session.spec.meta.mode_state = {
      ...session.spec.meta.mode_state,
      mode: output.mode_update.mode,
      confirmed: output.mode_update.confirmed,
      duration_seconds: output.mode_update.duration_seconds,
      // Sticky once classified: existing session value wins (see runtime.ts
      // comment). The song-to-video entry pre-seeds 'audio_music' at session
      // init and relies on this stickiness to survive MODE_CONFIRMED.
      input_type: session.spec.meta.mode_state.input_type ?? output.mode_update.input_type ?? null,
    }
    // brand_intent_pending is owned by the mode_confirmation prompt only.
    // The schema marks it optional/nullable so post-confirmation prompts
    // can omit it; only overwrite when the LLM explicitly returned a value
    // (`undefined` means "no opinion -- preserve prior state").
    if (output.mode_update.brand_intent_pending !== undefined) {
      session.spec.meta.mode_state.brand_intent_pending =
        output.mode_update.brand_intent_pending ?? false
    }
    // brand_video_type: the planner sets it as a mode_update field
    // (not a patch op, which the mode_confirmation no-ops contract would
    // reject). Write it through to global_constraints. Only overwrite with a
    // concrete arc -- a null/undefined emission preserves the prior value so a
    // later turn cannot silently clear a confirmed selection.
    if (output.mode_update.brand_video_type != null) {
      session.spec.global_constraints.brand_video_type = output.mode_update.brand_video_type
    }
    applyTodoStateUpdate(session, output as PlannerOutput)
  }

  //
  deps.buildDirectivesExtractionInput = buildDirectivesExtractionInput
  deps.getAssetContextLightJson = getAssetContextLightJson
  deps.getAssetDescriptionsJson = getAssetDescriptionsJson

  //
  deps.recordRecoveryFailure = recordRecoveryFailure

  //
  deps.getUndescribedUploadedAssets = getUndescribedUploadedAssets

  //
  deps._sharedArtifactBatchContext = null
  deps.createSharedArtifactBatchContext = createSharedArtifactBatchContext
  deps.getSharedArtifactBatchContext = () => getSharedArtifactBatchContext(deps as object)
  deps.setSharedArtifactBatchContext = (ctx: SharedArtifactBatchContext) =>
    setSharedArtifactBatchContext(deps as object, ctx)
  deps.clearSharedArtifactBatchContext = () => clearSharedArtifactBatchContext(deps as object)

  return deps
}
