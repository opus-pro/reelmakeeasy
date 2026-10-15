// Do NOT import from workflow.ts
//
// plannerStepActivity is the thin "1 LLM call = 1 activity" wrapper around a
// single V1 planner decision. It runs on the activity (Node) side, so VALUE
// imports of the V1 planner runtime are allowed. It MUST NEVER be imported by
// any workflow file (it pulls in callPlanner -> the OpenAI/Gemini SDK).
//
// Responsibility (a thin activity over one planner chain segment):
//   1. project the V2 AgentEvent log into a V1 SessionState via foldSession
//   2. build the per-step prompt with the V1 buildPlannerStepPrompt
//   3. manage the OpenAI Responses chain across mode_confirmation ->
//      post_confirmation segment boundaries (force a fresh chain, orphan the
//      old id)
//   4. make exactly ONE callPlanner roundtrip
//   5. parse + contract-check the result, surfacing (not throwing) a contract
//      error so the Phase-3 workflow owns the re-prompt / ask-user policy
//
// It reuses V1 buildPlannerStepPrompt / callPlanner / checkPlannerOutputContract
// verbatim -- it does not reimplement the prompt or the schema.

import { createSubLogger } from '@reelmakeeasy/common/logger'
import { EXPANDED_STORY_MODE_LIMITS } from '@reelmakeeasy/common/story-mode/user-limits'
import type {
  PlannerOutput,
  PlannerOutputLike,
  SessionState,
} from '@reelmakeeasy/uip-planner-runtime'
import {
  artifactsProducedBy,
  buildConsistencyContext,
  checkConsistencyContract,
  checkPlannerOutputContract,
  enforceSilhouetteIdentityClarification,
  guardUndescribedAssetsBeforeAction,
  normalizeSessionControlOutput,
  PLANNER_AGENT_MODEL_DEFAULT,
  resolvePlannerAgentModel,
} from '@reelmakeeasy/uip-planner-runtime'
import { getPinnedUserPrompt } from '@reelmakeeasy/uip-planner-runtime/context-builder'
// Deep imports: buildPlannerStepPrompt + callPlanner are NOT in the barrel.
import {
  buildPlannerStepPrompt,
  callPlanner,
} from '@reelmakeeasy/uip-planner-runtime/runtime/call-planner'
import {
  type PastedScriptFit,
  resolvePastedScriptDuration,
} from '@reelmakeeasy/uip-planner-runtime/runtime/pasted-script-duration'
// Deep import: the v1 contract-error auto-corrector is NOT in the barrel. It runs
// in v1's planner LOOP (planner-loop.ts); v2's single-step activity must call it
// explicitly so recoverable contract errors heal instead of dead-ending.
import { maybeAutoCorrectPhaseDriftContractError } from '@reelmakeeasy/uip-planner-runtime/runtime/planner-loop-post-iteration'
import { PlannerOutputSchema } from '@reelmakeeasy/uip-planner-runtime/runtime/planner-schema'
// CheckClarifyScopeDeps is the deps shape checkPlannerOutputContract wants;
// GuardUndescribedAssetsDeps is what the undescribed-assets guard wants. The
// buildPlannerDeps facade satisfies both (declared `object`, so we cast).
// Type-only deep import -- no runtime cost.
import type {
  CheckClarifyScopeDeps,
  GuardUndescribedAssetsDeps,
} from '@reelmakeeasy/uip-planner-runtime/runtime/runtime.types'
import { extractPastedScript } from '@reelmakeeasy/uip-planner-runtime/tool-internals/extract-pasted-script'

import type { AgentEvent, ArtifactSlot } from '../../workflows/uip-v2/types'

import { buildPlannerDeps } from './activity-deps-factory'
import { buildDidDirectiveExecutorRun } from './directive-execution-evidence'
import { createInMemorySessionStore } from './in-memory-session-store'
import { resolveLatestUserMessage } from './latest-user-message'
import { applyRuntimeReplyFallback } from './reply-fallback'
import { foldSession } from './session-state'
import { resolveSpecCheckpoint } from './spec-checkpoint'

const logger = createSubLogger('uip-v2:planner-step')

const PRESERVE_FULL_SCRIPT_OPTION_ID = 'preserve_full_script'
const REWRITE_TO_REQUESTED_DURATION_OPTION_ID = 'rewrite_to_requested_duration'

export interface PlannerStepInput {
  currentArtifacts: Record<string, ArtifactSlot>
  events: AgentEvent[]
  lastActionResult: string
  // Grounding fingerprint of the chain we have been continuing:
  // when the freshly built prompt's groundingKey differs, the system prompt
  // gained/lost a session-dynamic block (article loaded, URL route resolved)
  // and the chain must restart so the planner sees it. Optional: absent on
  // pre-rollout callers, treated as 'base'.
  plannerChainGroundingKey?: null | string
  plannerChainSegment: 'mode_confirmation' | 'post_confirmation'
  /**
   * `state.plannerModel` -- the A/B arm this session was pinned to on its first
   * planner round. When set, it is reused verbatim and nothing is
   * re-resolved, so the model cannot change under a live session. Absent on
   * the first round of a session and on pre-rollout step inputs, which is what
   * triggers the one-time resolve.
   */
  plannerModel?: null | string
  plannerResponseId: null | string
  stepIndex: number // 0-based
}

export interface PlannerStepOutput {
  abandonedResponseId?: string
  /** All response IDs made unreachable during this step. */
  abandonedResponseIds?: string[]
  // Set when checkPlannerOutputContract returned an error string. We surface
  // it instead of throwing so the workflow decides policy (re-prompt /
  // ask-user); the decision is still returned alongside it.
  contractError?: string
  // null when the LLM (after all callPlanner retry layers) returned no
  // decision; the Phase-3 workflow treats this as a planner failure.
  decision: null | PlannerOutput
  // Grounding fingerprint of the prompt this step ran with; the workflow
  // stores it next to the chain id for the next step's restart decision.
  // Optional only for pre-rollout results (treated as 'base').
  groundingKey?: string
  /**
   * The arm this round ran on. The workflow pins it into state on the first
   * round and passes it back in on every later one. Absent only on pre-rollout
   * results.
   */
  plannerModel?: string
  /** Explicitly clears the workflow's active planner chain. */
  resetPlannerChain?: boolean
  responseId?: string
  /** Trusted activity-owned metadata, never parsed from planner JSON. */
  runtimeClarificationKind?:
    | 'pasted_script_duration_cap'
    | 'pasted_script_fit'
    | 'pasted_script_unreadable'
  segment: 'mode_confirmation' | 'post_confirmation'
  /** Trusted activity-owned extraction reused by bootstrap preservation. */
  verifiedPastedScript?: {
    script: string
    shotEdits: Array<{ audio_vo: string; shot_id: string }>
  }
}

interface PastedScriptDurationDecision {
  decision: PlannerOutput
  replacedPlannerDecision: boolean
  runtimeClarificationKind?:
    | 'pasted_script_duration_cap'
    | 'pasted_script_fit'
    | 'pasted_script_unreadable'
  verifiedPastedScript?: {
    script: string
    shotEdits: Array<{ audio_vo: string; shot_id: string }>
  }
}

export async function plannerStepActivity(input: PlannerStepInput): Promise<PlannerStepOutput> {
  return runPlannerStep(input)
}

function isPastedScriptDurationClarification(
  event: AgentEvent,
): event is Extract<AgentEvent, { type: 'assistant_message' }> {
  if (event.type !== 'assistant_message') {
    return false
  }
  const optionIds = new Set(event.options?.map((option) => option.id))
  return (
    event.runtimeClarificationKind === 'pasted_script_fit' &&
    optionIds.has(PRESERVE_FULL_SCRIPT_OPTION_ID) &&
    optionIds.has(REWRITE_TO_REQUESTED_DURATION_OPTION_ID)
  )
}

function resolveDirectPastedScriptFit(
  message: string,
  options: Extract<AgentEvent, { type: 'assistant_message' }>['options'],
): null | PastedScriptFit {
  const normalizedMessage = message.trim()
  const selectedOption = options?.find(
    (option) => option.id === normalizedMessage || option.label === normalizedMessage,
  )
  if (selectedOption?.id === PRESERVE_FULL_SCRIPT_OPTION_ID) {
    return 'preserve'
  }
  if (selectedOption?.id === REWRITE_TO_REQUESTED_DURATION_OPTION_ID) {
    return 'rewrite_to_duration'
  }
  return null
}

/**
 * Authorizes a fit only from an actual answer to a prior runtime clarification.
 * Clicked chips carry the option label as the message body today; accepting the
 * stable id too keeps the event contract deterministic for other clients.
 */
function isAuthorizedOverLimitRewrite(events: AgentEvent[]): boolean {
  const userEventIndex = events.findLastIndex((event) => event.type === 'user_message')
  if (userEventIndex === -1) {
    return false
  }
  const userEvent = events[userEventIndex] as Extract<AgentEvent, { type: 'user_message' }>
  const priorEvents = events.slice(0, userEventIndex)
  const clarification = userEvent.answerToMessageId
    ? priorEvents.find(
        (event) =>
          event.type === 'assistant_message' && event.messageId === userEvent.answerToMessageId,
      )
    : priorEvents.findLast((event) => event.type === 'assistant_message')
  return (
    clarification?.type === 'assistant_message' &&
    clarification.runtimeClarificationKind === 'pasted_script_duration_cap' &&
    resolveDirectPastedScriptFit(userEvent.message, clarification.options) === 'rewrite_to_duration'
  )
}

function isReplyToPastedScriptDurationCap(events: AgentEvent[]): boolean {
  return isReplyToRuntimeClarification(events, 'pasted_script_duration_cap')
}

function isReplyToRuntimeClarification(
  events: AgentEvent[],
  kind: Extract<
    Extract<AgentEvent, { type: 'assistant_message' }>['runtimeClarificationKind'],
    string
  >,
): boolean {
  const userEventIndex = events.findLastIndex((event) => event.type === 'user_message')
  if (userEventIndex === -1) {
    return false
  }
  const priorAssistant = events
    .slice(0, userEventIndex)
    .findLast((event) => event.type === 'assistant_message')
  return priorAssistant?.runtimeClarificationKind === kind
}

function resolveAuthorizedPastedScriptFit(events: AgentEvent[]): null | PastedScriptFit {
  const userEventIndex = events.findLastIndex((event) => event.type === 'user_message')
  if (userEventIndex === -1) {
    return null
  }
  const userEvent = events[userEventIndex] as Extract<AgentEvent, { type: 'user_message' }>
  const priorEvents = events.slice(0, userEventIndex)

  if (userEvent.answerToMessageId) {
    const clarification = priorEvents.find(
      (event) =>
        event.type === 'assistant_message' && event.messageId === userEvent.answerToMessageId,
    )
    if (!clarification || !isPastedScriptDurationClarification(clarification)) {
      return null
    }
    return resolveDirectPastedScriptFit(userEvent.message, clarification.options)
  }

  // Legacy/client fallback when no answer link was recorded: only the most
  // recent preceding assistant message may authorize an exact stable id/label.
  const latestAssistant = priorEvents.findLast((event) => event.type === 'assistant_message')
  return latestAssistant && isPastedScriptDurationClarification(latestAssistant)
    ? resolveDirectPastedScriptFit(userEvent.message, latestAssistant.options)
    : null
}

function runtimeClarificationBase(
  plannerDecision: PlannerOutput,
  conversationSummary: string,
): PlannerOutput {
  return {
    ...plannerDecision,
    action: 'ASK_CLARIFY',
    conversation_summary_update: conversationSummary,
    expect_assets: null,
    mode_update: {
      ...plannerDecision.mode_update,
      confirmed: false,
      duration_seconds: null,
      pasted_script_fit: null,
    },
    ops: null,
    session_control: null,
    structure_edit: null,
    todo_snapshot: null,
    todo_update: {
      clear: null,
      phase: 'mode_confirmation',
      set_item_status: null,
    },
    tool_calls: null,
  }
}

/**
 * Reconciles a pasted-script MODE_CONFIRMED decision against the script text
 * extracted from the pinned user prompt. The extractor owns wrapper/asset
 * removal; duration arithmetic only sees its spoken `script` result.
 */
async function enforcePastedScriptDuration(
  events: AgentEvent[],
  session: SessionState,
  plannerDecision: PlannerOutput,
): Promise<PastedScriptDurationDecision> {
  if (plannerDecision.action !== 'MODE_CONFIRMED') {
    return { decision: plannerDecision, replacedPlannerDecision: false }
  }

  const inputType =
    plannerDecision.mode_update.input_type ?? session.spec.meta.mode_state.input_type
  if (inputType !== 'script_only' && inputType !== 'prompt_and_script') {
    return { decision: plannerDecision, replacedPlannerDecision: false }
  }

  const pinnedUserPrompt = getPinnedUserPrompt(session.transcript)
  const shouldPreferLatestUserMessage =
    isReplyToPastedScriptDurationCap(events) ||
    isReplyToRuntimeClarification(events, 'pasted_script_unreadable')
  const candidateTexts = shouldPreferLatestUserMessage
    ? [resolveLatestUserMessage(events), pinnedUserPrompt]
    : [pinnedUserPrompt]
  let verifiedExtraction: null | {
    outcome: 'extract_and_preserve' | 'extract_and_rewrite'
    script: string
    shotEdits: Array<{ audio_vo: string; shot_id: string }>
  } = null
  for (const rawText of new Set(candidateTexts.filter((text) => text.trim()))) {
    try {
      const extraction = await extractPastedScript({
        effectiveMaxScriptWords: EXPANDED_STORY_MODE_LIMITS.absoluteMaxScriptWords,
        isBootstrap: true,
        previousScript: null,
        projectId: session.sessionId,
        rawText,
      })
      if (extraction?.outcome !== 'no_paste_detected' && extraction?.script?.trim()) {
        verifiedExtraction = {
          outcome: extraction.outcome,
          script: extraction.script,
          shotEdits: extraction.shot_edits,
        }
        break
      }
    } catch {
      // The extractor already fails soft, but keep the planner safeguard soft if
      // an alternate implementation or test double throws before returning null.
      logger.warn(`[${session.sessionId}] pasted-script duration extraction failed`)
    }
  }

  const resolution = resolvePastedScriptDuration({
    allowOverLimitFitConfirmation: isAuthorizedOverLimitRewrite(events),
    durationSource: plannerDecision.mode_update.duration_source,
    pastedScriptFit: resolveAuthorizedPastedScriptFit(events),
    plannerDurationSeconds: plannerDecision.mode_update.duration_seconds,
    script: verifiedExtraction?.script ?? null,
    scriptLanguage:
      plannerDecision.mode_update.script_language ??
      session.spec.global_constraints.script_language,
  })

  if (resolution.status === 'needs_fit_confirmation') {
    const requestedDurationSeconds = plannerDecision.mode_update.duration_seconds
    const clarification = PlannerOutputSchema.parse({
      ...runtimeClarificationBase(
        plannerDecision,
        'Awaiting the user to choose whether to preserve the full pasted script or rewrite it to the requested duration.',
      ),
      options: [
        {
          id: PRESERVE_FULL_SCRIPT_OPTION_ID,
          label: `Preserve full script (${resolution.naturalDurationSeconds}s)`,
        },
        {
          id: REWRITE_TO_REQUESTED_DURATION_OPTION_ID,
          label: `Rewrite to ${requestedDurationSeconds}s`,
        },
      ],
      reply: `Your full script is about ${resolution.naturalDurationSeconds} seconds, longer than the ${requestedDurationSeconds}-second duration you requested.`,
      reply_question:
        'Would you like to preserve the full script or rewrite it to fit the requested duration?',
    })
    return {
      decision: clarification,
      replacedPlannerDecision: true,
      runtimeClarificationKind: 'pasted_script_fit',
    }
  }

  if (resolution.status === 'no_script') {
    const clarification = PlannerOutputSchema.parse({
      ...runtimeClarificationBase(
        plannerDecision,
        'Awaiting a readable pasted script before setting duration.',
      ),
      options: [],
      reply:
        "I couldn't reliably read the pasted script, so I haven't set a duration or changed its wording.",
      reply_question: 'Please paste the script again as plain text so I can continue.',
    })
    return {
      decision: clarification,
      replacedPlannerDecision: true,
      runtimeClarificationKind: 'pasted_script_unreadable',
    }
  }

  if (resolution.status === 'exceeds_duration_limit') {
    const rewriteDurationSeconds = Math.min(
      plannerDecision.mode_update.duration_seconds ??
        EXPANDED_STORY_MODE_LIMITS.maxNonAudioDurationSeconds,
      EXPANDED_STORY_MODE_LIMITS.maxNonAudioDurationSeconds,
    )
    const clarification = PlannerOutputSchema.parse({
      ...runtimeClarificationBase(
        plannerDecision,
        'Awaiting the user to shorten the pasted script or request a rewrite within 600 seconds.',
      ),
      options: [
        {
          id: REWRITE_TO_REQUESTED_DURATION_OPTION_ID,
          label: `Rewrite to ${rewriteDurationSeconds}s`,
        },
      ],
      reply: `Your full script is about ${resolution.naturalDurationSeconds} seconds, which exceeds the 600-second (10-minute) video limit.`,
      reply_question: 'Please shorten the script or request a rewrite within 600 seconds.',
    })
    return {
      decision: clarification,
      replacedPlannerDecision: true,
      runtimeClarificationKind: 'pasted_script_duration_cap',
    }
  }

  if (resolution.status === 'exceeds_script_limit') {
    const absoluteMaxScriptWords = EXPANDED_STORY_MODE_LIMITS.absoluteMaxScriptWords
    const clarification = PlannerOutputSchema.parse({
      ...runtimeClarificationBase(
        plannerDecision,
        `Awaiting the user to shorten the pasted script or request a rewrite within the ${absoluteMaxScriptWords}-unit script limit.`,
      ),
      options: [
        {
          id: REWRITE_TO_REQUESTED_DURATION_OPTION_ID,
          label: `Rewrite within ${absoluteMaxScriptWords} words/characters`,
        },
      ],
      reply: `Your script has ${resolution.wordCount} words/characters, which exceeds the ${absoluteMaxScriptWords}-unit script limit.`,
      reply_question: `Please shorten the script to ${absoluteMaxScriptWords} words/characters or request a rewrite within that limit.`,
    })
    return {
      decision: clarification,
      replacedPlannerDecision: true,
      runtimeClarificationKind: 'pasted_script_duration_cap',
    }
  }

  plannerDecision.mode_update.duration_seconds = resolution.resolvedDurationSeconds
  plannerDecision.mode_update.pasted_script_fit = resolution.pastedScriptFit
  return {
    decision: plannerDecision,
    replacedPlannerDecision: false,
    ...(resolution.pastedScriptFit === 'preserve' &&
    verifiedExtraction?.outcome === 'extract_and_preserve'
      ? {
          verifiedPastedScript: {
            script: verifiedExtraction.script,
            shotEdits: verifiedExtraction.shotEdits,
          },
        }
      : {}),
  }
}

/**
 * Cross-artifact consistency guard, RECORD-ONLY in rollout step 2: we
 * compute the rejection checkConsistencyContract would emit and log it. We
 * never write it to contractError, so no turn can be blocked and no extra LLM
 * call can be burned by it. Flipping to enforcing is adding that write here,
 * gated on session.spec.meta.consistency_guard_enabled. `enforced` records
 * what the flag *would* have done -- it is logged, not acted on -- so the
 * eventual flip can be compared against the same sessions.
 */
function recordConsistencyGuardRejection(session: SessionState, parsed: PlannerOutputLike): void {
  const consistencyError = checkConsistencyContract(session, parsed)
  if (!consistencyError) {
    return
  }
  // Fields go in the MESSAGE, not the payload, so they stay searchable in
  // plain-text logs, which keep only the message string (the same approach as
  // session-termination.ts). Logged with a payload, every one of these would be
  // an uncorrelatable tick.
  const enforced = session.spec.meta.consistency_guard_enabled === true
  const staleCount = (session.spec.meta.stale_artifacts ?? []).length
  logger.warn(
    `uip.consistency_guard.record_only session=${session.sessionId} ` +
      `action=${parsed.action} phase=${session.todo_state.phase} ` +
      `enforced=${enforced} staleCount=${staleCount} reason=${consistencyError}`,
  )
}

/**
 * Under-triggering counter-signal: flag a TOOL_CALLS
 * decision with no ENFORCEABLE ledger entry covering the artifact(s) its
 * tools would actually (re)produce -- per the same tool -> artifact mapping
 * the ledger's own mark/clear steps use (artifactsProducedBy), not "does the
 * ledger hold any entry at all". Without the per-artifact scoping, an
 * unrelated entry for a DIFFERENT artifact silently suppressed the signal:
 * regenerating visual_script while only a script entry sat in the ledger
 * logged nothing, even though no edge covered the visual_script
 * regeneration. Without the enforceable-only filter, a merely deferred entry
 * (artifact absent, phase forbids the executor, etc.) would count as
 * "covered" even though it cannot gate anything this turn. Three
 * explanations are possible when this fires: the absence is fine (the
 * user asked directly), the dependency graph is missing an edge, or a
 * covering edge already exists but `isEnforceable` (realizability.ts)
 * defers it for a reason unrelated to coverage -- the artifact does not
 * exist yet, the phase is in `NO_DISCHARGE_PHASES`, or an upload is still
 * undescribed. The third case is common: a `marked_while_absent`
 * visual_script entry followed by the visual-script tool call that is its
 * intended discharge logs this signal even though the covering edge is
 * sitting right there in the ledger, merely deferred rather than
 * enforceable.
 *
 * This does NOT restrict which tools can trigger the log line -- every
 * TOOL_CALLS decision is still a candidate. Filtering the noise down to
 * artifact-regeneration tools specifically belongs in the log search over
 * the `tools` field already logged below, not in a second tool list here
 * that can silently drift from artifactsProducedBy.
 *
 * When none of the called tools map to a tracked artifact (artifactsProducedBy
 * returns [] for all of them, e.g. a lookup-only tool), there is no artifact to
 * scope to; fall back to "does the ledger hold any enforceable entry at all",
 * the closest approximation available. Only the aggregate is meaningful; a
 * single line proves nothing.
 */
function recordRegenerationWithoutLedgerEntry(
  session: SessionState,
  parsed: PlannerOutputLike,
): void {
  if (parsed.action !== 'TOOL_CALLS') {
    return
  }
  const tools = (parsed.tool_calls ?? []).map((call) => call.tool)
  const producedArtifacts = new Set(tools.flatMap((tool) => artifactsProducedBy(tool)))
  const enforceableArtifacts = new Set(
    buildConsistencyContext(session)
      .stale.filter((entry) => entry.status === 'enforceable')
      .map((entry) => entry.artifact),
  )
  const covered =
    producedArtifacts.size > 0
      ? [...producedArtifacts].some((artifact) => enforceableArtifacts.has(artifact))
      : enforceableArtifacts.size > 0
  if (covered) {
    return
  }
  // Same reason as record_only above: message string, not payload. Without the
  // tool names this counter cannot distinguish a genuine under-mark from the
  // first build of an artifact that could not have been stale yet -- and the
  // first build fires it on every session, so the count is otherwise unreadable.
  logger.info(
    `uip.consistency_guard.regeneration_without_entry session=${session.sessionId} ` +
      `phase=${session.todo_state.phase} tools=${tools.join(',')}`,
  )
}

/**
 * Chain fingerprint for one planner round: the prompt's grounding key, plus the
 * planner model whenever it is not the control arm.
 *
 * A provider-held response chain belongs to the model that started it, so the
 * A/B arm is part of the chain's identity. It rides on the grounding
 * fingerprint -- already threaded through the workflow as
 * `plannerChainGroundingKey` -- rather than a new workflow field, so a session
 * that crosses arms mid-flight restarts its chain instead of continuing a chain
 * id the new model does not own.
 *
 * The suffix is added ONLY for a non-default arm: with everything on the control
 * arm the key stays byte-identical to the pre-A/B one, so shipping this forces
 * no in-flight session into a chain restart.
 */
function buildChainGroundingKey(promptGroundingKey: string, plannerModel: string): string {
  return plannerModel === PLANNER_AGENT_MODEL_DEFAULT
    ? promptGroundingKey
    : `${promptGroundingKey}|${plannerModel}`
}

/**
 * `resetPlannerChain` patch for a round that deliberately abandoned its chain
 * (segment, grounding blocks, or model arm changed) and came back WITHOUT a
 * replacement response id -- which is what the Layer 2 Gemini fallback returns,
 * and what total failure returns.
 *
 * Without it, `applyPlannerChainStep` keeps the previous id
 * (`step.responseId ?? state.plannerResponseId`) while storing the FRESH
 * fingerprint, so the next round reads the chain context as unchanged and
 * continues a chain id the current prompt / model does not own: one guaranteed
 * failed request before Layer 1b restarts it.
 *
 * Returns an empty object rather than `{ resetPlannerChain: false }` so the flag
 * stays absent from the activity result unless it is actually needed.
 */
function buildChainResetPatch(
  sameChainContext: boolean,
  responseId: string | undefined,
): { resetPlannerChain?: true } {
  return !sameChainContext && responseId === undefined ? { resetPlannerChain: true } : {}
}

async function runPlannerStep(input: PlannerStepInput): Promise<PlannerStepOutput> {
  // 1. Project the event log into a V1 SessionState.
  const { events } = input
  const checkpointSpec = await resolveSpecCheckpoint(events)
  const session = foldSession(events, input.currentArtifacts, checkpointSpec)
  // uip_planner_model A/B arm. Decided ONCE per session: an arm
  // already pinned in workflow state is reused as-is, and only a session
  // without one resolves it (to the default planner model). A live session
  // therefore cannot change models underneath its own response chain.
  const plannerModel = resolvePlannerAgentModel(session.sessionId, input.plannerModel)

  // 2. Latest user message drives the prompt's pinned_user_prompt. A CTA-
  //    triggered turn (continue / confirm) resolves to '' so the planner drives
  //    from the new phase instead of re-answering a stale message -- see
  //    resolveLatestUserMessage.
  // The panel-source reference is planner-only prompt context, so
  // opt in here. The tool path (prepareToolRuntime) deliberately does NOT, to
  // keep the raw user text intact for the byte-for-byte paste extractor.
  const latestUserMessage = resolveLatestUserMessage(events, { includePanelReference: true })

  // 3. Build the per-step prompt (segment is decided by mode_state.confirmed).
  //    The planner OWNS closing directive todos -- there is no runtime directive
  //    auto-reconcile.
  const prompt = buildPlannerStepPrompt(
    session,
    latestUserMessage,
    input.stepIndex,
    input.lastActionResult,
  )

  // 4. Chain reset: a fresh chain
  //    (previousResponseId undefined, old id orphaned for workflow-exit
  //    cleanup) is forced when EITHER
  //      - the prompt's segment differs (mode_confirmation ->
  //        post_confirmation boundary; different system prompt), or
  //      - the groundingKey differs within the segment (the system prompt
  //        gained/lost a session-dynamic block -- URL route resolved, article
  //        loaded). Chain continuations reuse the chain-start system prompt
  //        server-side, so continuing would leave the planner with stale
  //        "ask this turn" routing instructions and without the resolved
  //        article context.
  //    Same segment + same grounding continues the existing chain.
  //    A response chain also belongs to the model that started it, so the
  //    planner model is folded into the same fingerprint -- see
  //    buildChainGroundingKey.
  const chainGroundingKey = buildChainGroundingKey(prompt.groundingKey, plannerModel)
  const sameChainContext =
    prompt.segment === input.plannerChainSegment &&
    chainGroundingKey === (input.plannerChainGroundingKey ?? 'base')
  let previousResponseId: string | undefined
  let segmentBoundaryAbandonedId: string | undefined
  if (sameChainContext) {
    previousResponseId = input.plannerResponseId ?? undefined
    segmentBoundaryAbandonedId = undefined
  } else {
    previousResponseId = undefined
    segmentBoundaryAbandonedId = input.plannerResponseId ?? undefined
  }

  // 5. Exactly one planner roundtrip.
  const out = await callPlanner({
    model: plannerModel,
    monolithic: prompt.monolithic,
    previousResponseId,
    session,
    systemPrompt: prompt.systemPrompt,
    userMessage: prompt.userMessage,
  })

  // Clears the workflow chain when this round abandoned it and got nothing back
  // to continue from -- see buildChainResetPatch.
  const chainResetPatch = buildChainResetPatch(sameChainContext, out.responseId)

  // Preserve every unreachable response id. The singular field remains for
  // historical workflow/activity compatibility.
  const abandonedResponseId = out.abandonedResponseId ?? segmentBoundaryAbandonedId
  const abandonedResponseIds = uniqueResponseIds([
    segmentBoundaryAbandonedId,
    out.abandonedResponseId,
  ])

  // 6. No decision from the LLM -> return null; skip parse + contract.
  if (out.result == null) {
    return {
      ...chainResetPatch,
      decision: null,
      plannerModel,
      responseId: out.responseId,
      abandonedResponseId,
      ...(abandonedResponseIds.length > 0 ? { abandonedResponseIds } : {}),
      groundingKey: chainGroundingKey,
      segment: prompt.segment,
    }
  }

  // 7. Parse the raw LLM result through the V1 zod schema. If it throws, we let
  //    it throw: a malformed planner output is a real bug worth an activity
  //    retry, not a soft contract error.
  let parsed = PlannerOutputSchema.parse(out.result)

  // 7b. Normalize BEFORE the contract check, exactly as V1's planner loop does
  //     (planner-loop.ts calls normalizeSessionControlOutput at L662, before the
  //     contract at L675). The load-bearing part for us: strict structured
  //     output forces the optional `expect_assets` field present and the LLM
  //     often emits `false` on non-ASK_CLARIFY actions (e.g. MODE_CONFIRMED),
  //     which the contract rejects with "must not include expect_assets"; this
  //     resets it to null. Without it, mode_confirmation dead-ends. Mutates in
  //     place; reuse the V1 helper rather than re-deriving the rule.
  normalizeSessionControlOutput(parsed, session.sessionId)

  // 7c. The runtime, not the planner, owns pasted-script duration arithmetic.
  // Run this before the normal contract check so both a normalized
  // MODE_CONFIRMED and a runtime-owned ASK_CLARIFY are checked identically.
  const durationDecision = await enforcePastedScriptDuration(events, session, parsed)
  parsed = durationDecision.decision

  // Make the silhouette identity warning deterministic. A prompt-only
  // rule was skipped by the live planner, which generated two anonymous dark
  // anchors even though describe_uploaded_images had classified the source as
  // silhouette_only. Normalize before contract validation so the resulting
  // ASK_CLARIFY is checked and emitted like any other planner decision.
  parsed = enforceSilhouetteIdentityClarification(
    session,
    parsed as PlannerOutputLike,
  ) as PlannerOutput

  // 8. Contract-check. buildPlannerDeps returns the runtime facade (typed as
  //    `object`); checkPlannerOutputContract wants CheckClarifyScopeDeps, which
  //    that facade satisfies, so we cast. createInMemorySessionStore needs no
  //    args (we are not pushing transcript / SSE here).
  const deps = buildPlannerDeps(createInMemorySessionStore()) as CheckClarifyScopeDeps
  // Gives the directive-close guard evidence that the hinted executor tool
  // actually ran, so the planner cannot claim a directive done on a tool that
  // never dispatched.
  deps.didDirectiveExecutorRun = buildDidDirectiveExecutorRun(events, session.todo_state.items)
  // The contract check wants PlannerOutputLike (narrowed enum unions); the
  // zod-inferred PlannerOutput widens those to `string`. V1 feeds callPlanner's
  // already-PlannerOutputLike result straight to the contract; we re-parse only
  // to validate, then pass the validated value through under that same type.
  let contractError =
    checkPlannerOutputContract(session, parsed as PlannerOutputLike, deps) ?? undefined

  // 8a. Auto-correct recoverable contract errors (V1 parity: planner-loop.ts:712
  //     runs this in the loop). The load-bearing case for V2: in refinement the
  //     planner OWNS the d* directive todo, and the LLM
  //     sometimes emits set_item_status:{d1,done} while dropping d1 from THIS
  //     turn's todo_snapshot -- which the contract rejects as a "new todo id".
  //     v1 re-injects the missing id from session.todo_state (the authoritative
  //     prior state) and re-validates; without it the error retries and
  //     dead-ends the user ("I ran into the same issue ... send again"). We bake
  //     the V2 free-function contract checker (+ its deps) into the deps.method
  //     shape the helper expects. The helper MUTATES `parsed` in place, so the
  //     healed todo_snapshot flows through to the returned decision.
  if (contractError) {
    contractError =
      maybeAutoCorrectPhaseDriftContractError(session, parsed as PlannerOutputLike, contractError, {
        checkPlannerOutputContract: (s, o) => checkPlannerOutputContract(s, o, deps),
      }) ?? undefined
  }

  // 8b. Undescribed-assets guard (V1 handlePlannerStep parity, Gap A): a state
  //     prerequisite, not a schema rule -- so it runs AFTER the contract check
  //     and only when the contract passed. When the session has undescribed
  //     uploaded assets, it blocks every action except describe_uploaded_images
  //     (and describe + intent_context), returning a MISSING_DEPENDENCY-style
  //     message. We surface it on the SAME `contractError` channel so the
  //     workflow's runPlannerTurn re-prompts (feeding the message back) and the
  //     planner self-corrects by calling describe first -- exactly the
  //     "planner must describe before acting" behavior V1 enforces.
  if (!contractError) {
    const guardResult = guardUndescribedAssetsBeforeAction(
      parsed as PlannerOutputLike,
      session,
      deps as unknown as GuardUndescribedAssetsDeps,
    )
    if (guardResult) {
      contractError = guardResult.lastActionResult
    }
  }

  // 8c. Cross-artifact consistency guard, RECORD-ONLY in rollout
  //     step 2. Extracted to keep runPlannerStep's own cognitive complexity
  //     under budget; see the helpers below for the guard + counter-signal
  //     logic. Deliberately runs even when an earlier guard already produced a
  //     contractError: the measurement we want is "how often would this fire",
  //     not "how often would it fire first".
  runRecordOnlyConsistencyGuards(session, parsed as PlannerOutputLike)

  // 8d. What op shape this decision actually wrote. Its own try/catch
  //     rather than riding inside runRecordOnlyConsistencyGuards: this is not
  //     part of the guard rollout and must not be deleted along with it when the
  //     enforce decision lands.
  recordPatchOps(session, parsed as PlannerOutputLike)

  // 9. Surface (do NOT throw on) the contract error -- the Phase-3 workflow
  //    decides the re-prompt / ask-user policy. The decision is still returned.
  // Log the surfaced contract error (reason + phase + action) so the reason is
  // searchable in the logs. It is otherwise only stored in the Mongo
  // recovery_failure event -- this lets us size which contract errors are
  // schema-fixable per phase.
  if (contractError) {
    logger.info(
      `[${session.sessionId}] planner contract_error phase=${session.todo_state.phase} action=${parsed.action} reason=${contractError}`,
    )
  }
  return {
    ...chainResetPatch,
    // V1 parity: backfill the per-action runtime reply fallback when the planner
    // left `reply` empty (handleModeConfirmedAction / handlePatchAction /
    // handleToolCalls). executeDecision runs in the workflow and only surfaces
    // decision.reply, so the fallback must be applied here, not there.
    decision: applyRuntimeReplyFallback(parsed),
    // A runtime clarification is not the planner response the user will answer.
    // Drop it from the continuation chain and orphan that freshly-created id.
    ...(durationDecision.replacedPlannerDecision ? {} : { responseId: out.responseId }),
    abandonedResponseId: durationDecision.replacedPlannerDecision
      ? (out.responseId ?? abandonedResponseId)
      : abandonedResponseId,
    ...(durationDecision.replacedPlannerDecision
      ? {
          abandonedResponseIds: uniqueResponseIds([...abandonedResponseIds, out.responseId]),
          resetPlannerChain: true,
        }
      : abandonedResponseIds.length > 0
        ? { abandonedResponseIds }
        : {}),
    groundingKey: chainGroundingKey,
    plannerModel,
    segment: prompt.segment,
    contractError,
    ...(durationDecision.runtimeClarificationKind
      ? { runtimeClarificationKind: durationDecision.runtimeClarificationKind }
      : {}),
    ...(durationDecision.verifiedPastedScript
      ? { verifiedPastedScript: durationDecision.verifiedPastedScript }
      : {}),
  }
}

/**
 * Run both record-only consistency-guard helpers without letting a throw
 * reach the caller. Both dereference buildConsistencyContext, which walks
 * session.spec / session.cached_artifacts -- the same fields the fold path
 * guards with safeLedgerUpdate (session-state-consistency.ts) for the same
 * reason: "record-only cannot block a turn" is the whole rollout claim, so it
 * must be structural, not just true in the common case. A throw here would
 * fail the activity, the engine would retry it, and the retry re-runs callPlanner
 * -- burning an LLM call for telemetry that isn't even wired to block
 * anything yet.
 */
function runRecordOnlyConsistencyGuards(session: SessionState, parsed: PlannerOutputLike): void {
  try {
    recordConsistencyGuardRejection(session, parsed)
    recordRegenerationWithoutLedgerEntry(session, parsed)
  } catch (error) {
    // Message string, not payload -- see the two call sites above.
    const detail = error instanceof Error ? error.message : String(error)
    logger.warn(
      `uip.consistency_guard.record_only_error session=${session.sessionId} error=${detail}`,
    )
  }
}

/**
 * The op shape a PATCH_SPEC decision emitted.
 *
 * Exists because two staging defects turned on a question nothing could answer:
 * whether the planner rewrites a shot with a targeted `update_shot_field` or a
 * whole-shot `replace_shots_range`. The two are indistinguishable downstream and
 * behave differently -- a whole-shot replace re-emits `pre_selected_assets` from
 * scratch, which is how bound assets and user uploads get dropped.
 *
 * Lives here, activity-side, and NOT in `spec-runtime.ts`. The first attempt
 * instrumented `applyPatchOps` / `applyToolArtifactsToSpec` there and produced
 * zero lines in production: V2 calls neither. `applyPatchOps` has no caller at
 * all, and `session-state.ts:154` records why V2 deliberately avoids the other.
 * A planner activity runs once per real turn, so this is one line per turn;
 * the fold's `applyPatch` sites would fire on every projection instead.
 *
 * Op TYPES only, never values -- op values carry the user's script and brief
 * text. Fields ride IN the message: the prod pipeline keeps only the message
 * string and its log search indexes only message / namespace / time, which is how the
 * consistency-guard counters stayed unreadable for a week.
 */
function recordPatchOps(session: SessionState, parsed: PlannerOutputLike): void {
  try {
    const ops = parsed.ops ?? []
    if (ops.length === 0) {
      return
    }
    const types = [...new Set(ops.map((op) => op.op))].sort().join(',')
    const shotFields = [
      ...new Set(ops.flatMap((op) => (op.op === 'update_shot_field' ? [op.field] : []))),
    ]
      .sort()
      .join(',')
    logger.info(
      `uip.patch_ops session=${session.sessionId} phase=${session.todo_state.phase} ` +
        `action=${parsed.action} ops=${types} shotFields=${shotFields || 'none'} ` +
        `opCount=${ops.length}`,
    )
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    logger.warn(`uip.patch_ops_error session=${session.sessionId} error=${detail}`)
  }
}

function uniqueResponseIds(ids: Array<string | undefined>): string[] {
  return [...new Set(ids.filter((id): id is string => Boolean(id)))]
}
