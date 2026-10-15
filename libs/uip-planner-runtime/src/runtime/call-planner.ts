/**
 * Planner LLM call: builds the per-step prompt parts (system prompt +
 * per-turn user message + byte-exact monolithic fallback) and runs the
 * layered chain-aware planner completion. Extracted from runtime-phase.ts
 * (re-exported there for consumer compatibility); paired with the existing
 * call-planner.test.ts sibling.
 */

import { completion, completionWithMeta } from '@reelmakeeasy/common/llm/completion'
import type { Model } from '@reelmakeeasy/common/llm/models'
import { createSubLogger } from '@reelmakeeasy/common/logger'
import type { Content } from '@reelmakeeasy/llm'

import {
  buildContextPayload,
  buildModeConfirmationContextPayload,
  type ExecutionGuardrails,
} from '../context-builder'
import {
  buildModeConfirmationPerTurnMessage,
  buildModeConfirmationPrompt,
  buildModeConfirmationSystemPrompt,
} from '../prompts/mode-confirmation-prompt'
import { buildRemixContextBlock } from '../prompts/remix-context-block'
import {
  buildPostConfirmationPerTurnMessage,
  buildPostConfirmationSystemPrompt,
  buildUnifiedPlannerPrompt,
} from '../prompts/unified-planner-prompt'
import {
  articlePromptFactsFromBootstrap,
  renderArticleContextBlock,
  renderUrlRouteQuestionBlock,
} from '../tool-internals/article-prompt-facts'
import type { SessionState } from '../types'

import { MAX_LOOP_STEPS, PLANNER_CALL_TIMEOUT_MS } from './constants'
import { buildModeConfirmationImageContents } from './mode-confirmation-multimodal'
import { PlannerOutputSchema } from './planner-schema'
import type { PlannerOutputLike } from './runtime.types'

const logger = createSubLogger('user-intent-planner')

/**
 * Which prompt segment a planner step is running against. Mirrors the
 * `planner_chain_segment` field on `CachedArtifacts` and is the only
 * signal `runPlannerLoop` needs to detect a chain restart.
 */
export type PlannerChainSegment = 'mode_confirmation' | 'post_confirmation'

/**
 * Output of `buildPlannerStepPrompt`. Split into the chain-aware
 * `systemPrompt` (sent once per chain; reused server-side after that)
 * and the per-turn `userMessage` (sent every continuation), plus the
 * `segment` tag the planner loop uses to detect mode_confirmation ->
 * post_confirmation boundary crossings.
 *
 * `monolithic` is the byte-exact concatenation that pre-chain callers
 * (Gemini fallback path, playground) consume as a single prompt string.
 * We compute it eagerly here so the chain-mode path and the fallback
 * path produce IDENTICAL prompts when chain is unavailable.
 */
export interface PlannerStepPromptParts {
  /**
   * Fingerprint of the session-dynamic grounding blocks baked into the
   * mode_confirmation SYSTEM prompt (ARTICLE SOURCE, unresolved-URL routing
   * question). Chain continuations reuse the chain-start system
   * prompt server-side, so when this key changes mid-segment (the router
   * resolved, the article loaded) the caller must START A FRESH CHAIN --
   * otherwise the planner keeps stale "ask this turn" instructions and never
   * sees the resolved article context. Constant 'base' when no block renders
   * and for the post_confirmation segment (its system prompt has no
   * session-dynamic grounding blocks).
   */
  groundingKey: string
  monolithic: string
  segment: PlannerChainSegment
  systemPrompt: string
  userMessage: string
}

export function buildPlannerStepPrompt(
  session: SessionState,
  userMessage: string,
  step: number,
  lastActionResult: string,
): PlannerStepPromptParts {
  const guardrails: ExecutionGuardrails = {
    last_action_result: lastActionResult,
    max_steps: MAX_LOOP_STEPS,
    step_index: step + 1,
  }
  // mode_confirmation runs against a slimmer, dedicated context that
  // drops fields the intake-style conversation cannot use (visual_script,
  // global_constraints, recent_tool_events, recovery, available_artifacts,
  // describe-tracking) and ships the FULL transcript instead of the
  // trailing slice. Once mode is confirmed we switch to the full
  // post-confirmation context and prompt.
  // Remix carry-over: thread the carried-context block into the
  // monolithic prompts so they don't need to traverse SessionState; the
  // chain-mode system prompts read it from session.bootstrap directly via
  // the same helper. Empty string (no remix source) is a no-op in the builders.
  const remixContextBlock = buildRemixContextBlock(session.bootstrap?.remix_context)
  // Article source: thread the ARTICLE SOURCE block into the
  // monolithic mode_confirmation prompt so the Gemini-fallback path matches
  // the chain-mode system prompt (which reads bootstrap.article_context
  // directly). Empty string on non-news sessions is a builder no-op.
  const articleContextBlock = renderArticleContextBlock(
    articlePromptFactsFromBootstrap(session.bootstrap),
  )
  // Unresolved pasted-link route: '' unless the URL
  // router parked both doors below the confidence floor.
  const urlRouteQuestionBlock = renderUrlRouteQuestionBlock(session.bootstrap)
  if (!session.spec.meta.mode_state.confirmed) {
    const monolithic = buildModeConfirmationPrompt(
      buildModeConfirmationContextPayload(session, userMessage, guardrails),
      remixContextBlock,
      articleContextBlock,
      urlRouteQuestionBlock,
    )
    // Presence-keyed (not content-keyed): the semantic instruction of each
    // block is stable while it renders, so only appearance/disappearance
    // (route resolved, article loaded) warrants abandoning the chain.
    const groundingKey =
      [articleContextBlock && 'article', urlRouteQuestionBlock && 'route-ask']
        .filter(Boolean)
        .join('+') || 'base'
    return {
      groundingKey,
      monolithic,
      segment: 'mode_confirmation',
      systemPrompt: buildModeConfirmationSystemPrompt(session),
      userMessage: buildModeConfirmationPerTurnMessage(session, userMessage, guardrails, {
        includeRecentTurns: false,
      }),
    }
  }
  const monolithic = buildUnifiedPlannerPrompt(
    buildContextPayload(session, userMessage, guardrails),
    { remixContextBlock },
  )
  return {
    groundingKey: 'base',
    monolithic,
    segment: 'post_confirmation',
    systemPrompt: buildPostConfirmationSystemPrompt(session),
    userMessage: buildPostConfirmationPerTurnMessage(session, userMessage, guardrails, {
      includeRecentTurns: false,
    }),
  }
}

/**
 * Inputs to the chain-aware planner call. Carries the result of
 * `buildPlannerStepPrompt` plus the current chain id (so the SDK can
 * decide chain start vs continuation) and the session (so the
 * fallback path can rebuild a Gemini-compatible monolithic prompt).
 */
export interface CallPlannerInput {
  /**
   * Model for the chain-mode layers (1a / 1b), resolved by the caller via
   * `resolvePlannerAgentModel` so the model is decided once per round and the
   * same value can be tagged onto the round metric.
   */
  model: Model
  /**
   * Byte-exact monolithic prompt that pre-chain `callPlanner` would
   * have sent. Used by the Gemini fallback path so the fallback model
   * sees the SAME prompt + correct guardrails (step_index,
   * last_action_result) that the chain layer was about to send. Built
   * by `buildPlannerStepPrompt` from the same `step` + `lastActionResult`
   * the planner loop passed in.
   */
  monolithic: string
  /**
   * Chain id from the previous successful step in the same session and
   * segment. When set, the call is a continuation (system prompt is
   * stripped, model and id are pinned). When undefined, the call starts
   * a fresh chain (`enableResponseChain: true` server-side).
   */
  previousResponseId: string | undefined
  session: SessionState
  /**
   * Per-segment system prompt; only sent when `previousResponseId` is
   * undefined (chain start). The SDK strips it on continuation turns.
   */
  systemPrompt: string
  /**
   * Per-turn user message JSON dump. Always sent.
   */
  userMessage: string
}

/**
 * Result of a planner call.
 *
 * `responseId` is the chain id the next planner step should continue
 * from. Set when chain mode (Layer 1a or 1b) succeeded; undefined when
 * the call went through Gemini fallback (Layer 2) or all layers
 * failed.
 *
 * `abandonedResponseId` is the previous chain id the caller passed in
 * but is no longer continuing from -- always set when the call took
 * any path other than Layer 1a success (chain restart, Gemini
 * fallback, or full failure). Caller pushes it onto the session's
 * orphan list so workflow-exit cleanup deletes it. Undefined when
 * Layer 1a succeeded (the old id is the parent of `responseId`; the
 * chain is intact) or when no previous id was passed in (first step).
 */
export interface CallPlannerOutput {
  abandonedResponseId: string | undefined
  /** Whether web_search was attached to this planner call (for latency metric tagging). */
  enableSearch: boolean
  responseId: string | undefined
  result: null | PlannerOutputLike
}

/**
 * Planner LLM call with layered retry semantics:
 *
 *   Layer 1a (SDK chain continuation): the resolved planner model
 *                        (`input.model`, gpt-5.4 unless the
 *                        `uip_planner_model` config says otherwise) with the
 *                        supplied previousResponseId + the SDK's 3x same-model
 *                        retry. Used for every step after the first
 *                        successful chain start. Most common path.
 *
 *   Layer 1b (chain restart, same model): fires ONLY when Layer 1a was a
 *                        continuation and failed. We clear the previous
 *                        id and re-issue as a fresh chain start (full
 *                        systemPrompt, `enableResponseChain: true`) on
 *                        the same model. Recovers from the
 *                        "chain id invalidated" failure mode (OpenAI
 *                        4xx "previous_response not found") AND from
 *                        transient network hiccups that bled through
 *                        the SDK's retries. The old chain id is
 *                        surfaced as `abandonedResponseId` so the
 *                        caller orphans it for workflow-exit cleanup.
 *
 *   Layer 2 (Gemini fallback): on Layer 1a + Layer 1b both failing
 *                        (or Layer 1a failing when there was no
 *                        continuation to restart), re-call Gemini in
 *                        non-chain mode using the byte-exact monolithic
 *                        prompt the chain layer was about to send.
 *                        Gemini has no chain memory; the monolithic
 *                        prompt carries everything (transcript /
 *                        recent_turns / pinned_user_prompt /
 *                        asset_priority_hint inline) because
 *                        `buildPlannerStepPrompt` upstream produces
 *                        `monolithic` from the FULL `buildContextPayload`.
 *
 *   Layer 3 (return null): if Gemini also fails, return
 *                        `{ result: null, responseId: undefined }`.
 *                        planner-loop logs + writes a user-facing
 *                        failure reply, same as pre-chain semantics.
 *
 * Why two same-model attempts before falling back? Two of the five known
 * chain-failure modes (4xx invalid id, network timeout) recover with a
 * fresh chain start on the same model -- one extra HTTP roundtrip
 * keeps us on that model + chain instead of dropping to Gemini for a
 * turn just because a stale id was passed in. SDK's per-model retry only
 * handles 5xx / transient; 4xx invalidation needs the explicit chain
 * restart.
 */

/**
 * Decide whether to attach multimodal `contents` to this planner
 * call. Only the first `mode_confirmation` chain start sees images
 * directly; after that the chain memory holds them, and
 * `post_confirmation` uses the structured `describe_uploaded_images`
 * tool instead. Returns `undefined` (not `[]`) when no contents
 * should be attached so the SDK call shape stays byte-identical to
 * the pre-multimodal behavior on the no-image path.
 */
export async function callPlanner(input: CallPlannerInput): Promise<CallPlannerOutput> {
  const continuation = typeof input.previousResponseId === 'string'
  const contents = await resolveCallPlannerContents(input, continuation)
  const enableSearchForSegment = resolveEnableSearch(input, continuation)
  // Suffix the LLM task tag with the active planner phase so the LLM log lines
  // for each call (e.g. retry warnings) name the phase (mode_confirmation,
  // bootstrap_script, script_review, bootstrap_visual, refinement).
  const llmTask = `user-intent-planner-agent:${input.session.todo_state.phase}`

  // Layer 1a: chain continuation (or chain start when no previous id).
  try {
    const out = await completionWithMeta({
      contents,
      enableResponseChain: !continuation,
      models: [input.model],
      previousResponseId: continuation ? input.previousResponseId : undefined,
      prompt: input.userMessage,
      responseFormat: PlannerOutputSchema,
      reasoningEffort: 'low',
      // Chain mode pins one provider+model; pre-emptively skip the
      // multi-model fallback requirement so a one-item models[] is
      // accepted by the SDK.
      ignoreFallbackModel: true,
      enableSearch: enableSearchForSegment,
      systemPrompt: continuation ? undefined : input.systemPrompt,
      task: llmTask,
      temperature: 0.2,
      timeout: PLANNER_CALL_TIMEOUT_MS,
    })
    // Layer 1a success: old id (if any) is the parent of out.responseId;
    // the chain is intact, no abandonment.
    logger.info(
      `[user-intent-planner] [callPlanner] layer1a chain ${continuation ? 'continuation' : 'start'} succeeded ${JSON.stringify(
        {
          previousResponseId: input.previousResponseId,
          responseId: out.responseId,
        },
      )}`,
    )
    return {
      abandonedResponseId: undefined,
      enableSearch: enableSearchForSegment,
      responseId: out.responseId,
      result: out.result as PlannerOutputLike,
    }
  } catch (chainError) {
    logger.warn(
      `[user-intent-planner] [callPlanner] chain ${continuation ? 'continuation' : 'start'} failed ${JSON.stringify(
        {
          message: chainError instanceof Error ? chainError.message : String(chainError),
        },
      )}`,
    )
  }

  // Layer 1b: chain restart on gpt-5.4. Only meaningful when Layer 1a
  // was a continuation -- a chain-start failure already had no
  // previousResponseId and would just retry an identical request.
  if (continuation) {
    try {
      const out = await completionWithMeta({
        enableResponseChain: true,
        models: [input.model],
        previousResponseId: undefined,
        prompt: input.userMessage,
        responseFormat: PlannerOutputSchema,
        reasoningEffort: 'low',
        ignoreFallbackModel: true,
        enableSearch: enableSearchForSegment,
        // Fresh chain start always sends systemPrompt.
        systemPrompt: input.systemPrompt,
        task: llmTask,
        temperature: 0.2,
        timeout: PLANNER_CALL_TIMEOUT_MS,
      })
      logger.info(
        `[user-intent-planner] [callPlanner] chain restart on ${input.model} succeeded; old chain ${input.previousResponseId} abandoned`,
      )
      return {
        abandonedResponseId: input.previousResponseId,
        enableSearch: enableSearchForSegment,
        responseId: out.responseId,
        result: out.result as PlannerOutputLike,
      }
    } catch (restartError) {
      logger.warn(
        `[user-intent-planner] [callPlanner] chain restart also failed; falling back to gemini ${JSON.stringify(
          {
            message: restartError instanceof Error ? restartError.message : String(restartError),
          },
        )}`,
      )
    }
  }
  try {
    const out = await completion({
      contents,
      // Single-model fallback list: `ignoreFallbackModel: true` is
      // required, otherwise the SDK throws "Please provide at least
      // two fallback models." -- a pre-existing latent bug that only
      // surfaces when Layer 1a + 1b both fail (rare until multimodal
      // pushed the failure rate above zero).
      ignoreFallbackModel: true,
      enableSearch: enableSearchForSegment,
      models: ['gemini-3.8-flash'],
      prompt: input.monolithic,
      responseFormat: PlannerOutputSchema,
      reasoningEffort: 'low',
      task: llmTask,
      temperature: 0.2,
      timeout: PLANNER_CALL_TIMEOUT_MS,
    })
    logger.info(
      `[user-intent-planner] [callPlanner] layer2 gemini fallback succeeded ${JSON.stringify({
        abandonedResponseId: input.previousResponseId,
      })}`,
    )
    return {
      abandonedResponseId: input.previousResponseId,
      enableSearch: enableSearchForSegment,
      responseId: undefined,
      result: out as PlannerOutputLike,
    }
  } catch (fallbackError) {
    logger.error(
      `[user-intent-planner] [callPlanner] gemini fallback also failed ${JSON.stringify({
        message: fallbackError instanceof Error ? fallbackError.message : String(fallbackError),
        stack: fallbackError instanceof Error ? fallbackError.stack : undefined,
      })}`,
    )
    // Even on full failure, surface the previous id for cleanup --
    // the next planner step will start a fresh chain regardless.
    return {
      abandonedResponseId: input.previousResponseId,
      enableSearch: enableSearchForSegment,
      responseId: undefined,
      result: null,
    }
  }
}

/**
 * Decide whether the `web_search` tool should be attached to this
 * planner call. Mode_confirmation is an open intake conversation
 * whose prompt (section 2.5) asks the planner to "ground your
 * question (and the downstream script) in accurate details" about
 * any brand / product / topic the user mentions. Without web search
 * the planner can only rely on training-cutoff knowledge --
 * demonstrably weak for recent products / niche brands. So we
 * attach the tool for every mode_confirmation call (chain start,
 * continuations, and the Gemini fallback). `tool_choice` defaults
 * to `auto` so the model only actually searches when it judges it
 * needs to -- generic prompts ("explainer about my dog") still pay
 * zero latency / token cost.
 *
 * Post_confirmation is a dispatcher loop; the tools it dispatches
 * to (notably `generate_explainer_script`) already enable search
 * where needed. Adding search on the planner level here would
 * duplicate grounding work the tool layer already owns.
 *
 * Side effect: emits an INFO log on chain start so the logs show
 * how often grounded mode_confirmation calls actually run.
 */
async function resolveCallPlannerContents(
  input: CallPlannerInput,
  continuation: boolean,
): Promise<Content[] | undefined> {
  const isModeConfirmationChainStart =
    !continuation && !input.session.spec.meta.mode_state.confirmed
  if (!isModeConfirmationChainStart) {
    return undefined
  }
  const imageContents = await buildModeConfirmationImageContents(input.session)
  if (imageContents.length === 0) {
    return undefined
  }
  logger.info(
    `[user-intent-planner] [callPlanner] mode_confirmation chain start with ${imageContents.length} image part(s)`,
  )
  return imageContents
}

function resolveEnableSearch(input: CallPlannerInput, continuation: boolean): boolean {
  const isModeConfirmation = !input.session.spec.meta.mode_state.confirmed
  if (!isModeConfirmation) {
    // Only mode_confirmation grounds via web_search; no other phase searches.
    return false
  }
  if (!continuation) {
    logger.info(
      '[user-intent-planner] [callPlanner] mode_confirmation chain start grounded with web_search',
    )
  }
  return true
}
