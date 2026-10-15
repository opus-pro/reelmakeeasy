/**
 * Centralized model configuration for the User Intent Planner.
 * All LLM calls in this runtime use these models.
 *
 * Cascade semantics: `models: Model[]` is a fallback chain -- the first
 * model is tried first; on failure the SDK falls back to the next one.
 */

import type { ModelChain } from '@reelmakeeasy/common/llm/completion'
import { imageModelForRole } from '@reelmakeeasy/common/llm/image-model-selection'
import type { Model } from '@reelmakeeasy/common/llm/models'
import {
  isUipPlannerModelArm,
  UIP_PLANNER_MODEL_DEFAULT,
} from '@reelmakeeasy/common/model-config/uip-planner-model-config.zod'
import type { ImageRole } from '@reelmakeeasy/llm/registry'

/**
 * Model for the planner agent loop itself (`callPlanner`) -- the calls that ARE
 * the planner's reasoning, as opposed to the tool tiers below, which serve
 * individual planner TOOLS. It was an inline `['gpt-5.4']` literal at the two
 * chain-mode call sites; it lives here now so the planner's model is stated
 * once, with the rest of them (see
 * docs/constraints/dont-scatter-model-capability-constants.md).
 *
 * Single model by construction, not a `ModelChain`: the loop runs in OpenAI
 * response-chain mode, which pins one provider + model for the life of a chain
 * (`ignoreFallbackModel: true`), and `callPlanner` owns its own layered
 * fallback instead (chain restart on the same model, then a non-chain Gemini
 * call).
 */
export const PLANNER_AGENT_MODEL_DEFAULT: Model = UIP_PLANNER_MODEL_DEFAULT

/**
 * Resolve the planner-loop model for one session.
 *
 * **Decided once per session, then pinned.** `pinnedModel` is the arm this
 * session already ran on, carried in workflow state; when it is a valid arm it
 * wins. A session with no pin yet runs on `PLANNER_AGENT_MODEL_DEFAULT`.
 *
 * The pin is a correctness requirement, not an optimization: the planner loop
 * runs in OpenAI response-chain mode, so a mid-session model change strands a
 * chain id the new model does not own.
 */
export function resolvePlannerAgentModel(sessionId: string, pinnedModel?: null | string): Model {
  return isUipPlannerModelArm(pinnedModel) ? pinnedModel : PLANNER_AGENT_MODEL_DEFAULT
}

export const PLANNER_TOOL_MODELS: ModelChain = ['gemini-3.8-flash', 'gpt-5.4']

/**
 * Models for generate_explainer_visual_script. Same primary as the
 * general planner tier, but with gemini-2.5-pro inserted BEFORE the gpt-5.4 net.
 *
 * Why VS needs its own chain: the visual-script completion sends a large
 * structured-output `responseFormat` plus multimodal anchor images. gpt-5.4
 * (OpenAI) rejects almost every request for this task -- `400 Invalid schema
 * for response_format` (OpenAI strict mode rejects the schema Gemini accepts)
 * and image errors (`unsupported MIME type 'application/octet-stream'`). So
 * when the primary model is rate-limited, gpt-5.4 is effectively no fallback --
 * the anchor_vs_batch VS half fails and bootstrap_visual stalls.
 *
 * gemini-2.5-pro is chosen because it accepts the identical structured schema
 * + image payload -- unlike gpt-5.4, which 400s deterministically on this task
 * -- and it is a generally available model, so it is a usable fallback when
 * the primary is throttled. gpt-5.4 stays as the last resort. The rest of the
 * planner tier keeps PLANNER_TOOL_MODELS unchanged -- gpt-5.4 is a working
 * fallback there.
 */
export const VISUAL_SCRIPT_TOOL_MODELS: ModelChain = [
  'gemini-3.8-flash',
  'gemini-2.5-pro',
  'gpt-5.4',
]

/**
 * Light-tier models for tool calls whose context is small and whose
 * reasoning is mostly structured extraction (not creative writing, not
 * multimodal). Used by:
 *   - generate_intent_context (summarize user prompt into the video brief)
 *   - beat-sheet, no-audio path (split a script into beat segments)
 *   - beat-sheet, timestamped path (same for audio mode, with audit loop)
 *   - plan_asset_assignment (match uploaded assets to shots)
 *   - extract_pasted_script (verbatim-copy the spoken script out of a paste)
 *
 * Cheaper/faster without meaningfully hurting quality for these tasks.
 *
 * Leads with gemini-3.5-flash. The extractor previously had its own chain
 * (SCRIPT_EXTRACTOR_MODELS) because gemini-2.5-flash often failed its large
 * verbatim-echo requests with 5xx errors and long retries. gemini-3.5-flash
 * does not, so the whole LIGHT tier now leads with it and the extractor just
 * reuses this chain -- one chain to tune.
 *
 * Side-benefit: also routes around gemini-3.1-pro-preview 504s (the LIGHT
 * chain leads with gemini-flash, not gemini-pro).
 */
export const PLANNER_TOOL_MODELS_LIGHT: ModelChain = ['gemini-3.5-flash', 'gpt-5']

/**
 * Models for the script generation tool. The single completion call
 * uses `enableSearch: true` so each model in the chain must support
 * grounded search:
 * - GPT-5.5 (primary): native web tool, strongest on prose voice and
 *   factual grounding.
 * - Seed Pro (secondary): InfoQuest MCP for grounded search; lower
 *   latency than GPT-5.5 and a reliable backup when GPT slot is
 *   throttled.
 * - Gemini Pro (tertiary): native search grounding; final net.
 *
 * Mirrors story-mode's V4 classification chain so the two systems
 * stay aligned on script-generation model behavior.
 */
export const SCRIPT_TOOL_MODELS: ModelChain = ['gpt-5.5', 'seed-2-0-pro-260328', 'gemini-3.8-flash']

/**
 * Models for select_auto_style. Its own chain, NOT the
 * shared LIGHT tier: on that tier's gemini-3.5-flash primary the ranking call took
 * 20-97s -- far slower than the concurrent generate_explainer_script, which
 * finishes in ~6s on gpt-5.5. Ranking ~25 presets is
 * a trivial structured judgment, so lead with gpt-5.5 (fast at reasoningEffort
 * 'minimal') and keep gemini-3.5-flash as the fallback: a different provider (covers
 * an OpenAI throttle) that also accepts the structured responseFormat if gpt-5.5's
 * strict mode rejects it (the failure mode VISUAL_SCRIPT_TOOL_MODELS documents). No
 * search grounding needed here, so both slots are fine without it.
 */
export const SELECT_AUTO_STYLE_MODELS: ModelChain = ['gpt-5.5', 'gemini-3.5-flash']

/**
 * Models for describe_uploaded_images (image captioning). Flash-class
 * first because captioning is latency-sensitive and the task is narrow.
 * Falls back to Pro if flash fails, then to GPT-5.4 as a final net.
 *
 * Stays on gemini-2.5-flash (~10s here). Two flash upgrades were tried and
 * BOTH regressed this caption payload badly:
 *   - gemini-3.5-flash: ~3x latency + 5xx
 *   - gemini-3-flash-preview: ~92s avg, ~40% server_error -- it is
 *     fast (~3s) only on keyframe->boolean vision judges, NOT on image->long
 *     caption generation. Reverted.
 * Both stay off this task; 2.5-flash is the proven captioner.
 */
export const DESCRIBE_IMAGE_MODELS: ModelChain = ['gemini-2.5-flash', 'gemini-3.8-flash', 'gpt-5.4']

/**
 * Registry role for anchor image generation (reference character / prop
 * images) when the project has no style instruction. The model it maps to must
 * accept reference images so the generator can see the user's uploads and
 * produce character-consistent outputs.
 */
export const ANCHOR_IMAGE_GENERATION_ROLE: ImageRole = 'image.fast'

/**
 * Registry role for anchor image generation when the project has a style
 * instruction (style preset / user-described style / NST-derived
 * `reusable_prompt`). Mirrors story-mode's
 * `resolveLongTakeOneShotAnchorImageModel` so UIP and story-mode produce
 * visually equivalent anchor sheets for styled projects.
 */
export const ANCHOR_IMAGE_GENERATION_STYLED_ROLE: ImageRole = 'image.generate'

/**
 * Pick the anchor image generation model (a registry key) based on whether the
 * project carries a style instruction. Mirrors story-mode's pattern in
 * `libs/story-mode-runtime/src/activities/long-take/anchors.ts`.
 *
 * Empty / whitespace-only `effectiveStyleText` => the fast role.
 * Non-empty => the styled role.
 */
export function resolveAnchorImageGenerationModel(effectiveStyleText: string): string {
  return imageModelForRole(
    effectiveStyleText.trim() ? ANCHOR_IMAGE_GENERATION_STYLED_ROLE : ANCHOR_IMAGE_GENERATION_ROLE,
  )
}
