import type { ConsistencyContext } from './runtime/consistency-context'
import { buildConsistencyContext } from './runtime/consistency-context'
import { buildRecoveryContext } from './runtime/planner-recovery'
import {
  AssetIdentityClarity,
  Message,
  PlannerRecoveryContext,
  PlannerTodoState,
  SessionState,
  ToolExecutionEvent,
} from './types'

// Trimming limits for the per-turn JSON dumps. Each is sized to keep
// the planner's per-step token cost bounded while still giving the LLM
// enough recent context to reason about the in-flight turn.
const MAX_RECENT_TURNS = 8
const MAX_RECENT_TOOL_EVENTS = 5
const MAX_UNDESCRIBED_ASSET_IDS = 20
const MAX_ASSET_CATALOG_ENTRIES = 20

export interface ExecutionGuardrails {
  last_action_result: string
  max_steps: number
  step_index: number
}

export interface UnifiedContextPayload {
  conversation: {
    conversation_summary: string
    latest_user_message: string
    pinned_user_prompt: string
    recent_turns: Message[]
  }
  runtime: {
    asset_context_light: {
      asset_catalog: Array<{
        asset_id: string
        content_type: string
        file_name: string
        identity_clarity: AssetIdentityClarity
        summary: string
      }>
      current_shot_asset_usage: Array<{
        asset_ids: string[]
        shot_id: string
      }>
      has_asset_descriptions: boolean
      has_undescribed_uploaded_assets: boolean
      has_uploaded_assets: boolean
      undescribed_asset_count: number
      undescribed_asset_ids: string[]
    }
    available_artifacts: {
      asset_descriptions: boolean
      global_constraints: boolean
      script: boolean
      uploaded_assets: boolean
      visual_script: boolean
    }
    consistency: ConsistencyContext
    execution_guardrails: ExecutionGuardrails
    recent_tool_events: ToolExecutionEvent[]
    recovery: PlannerRecoveryContext
    todo_state: PlannerTodoState
  }
  spec: {
    global_constraints: SessionState['spec']['global_constraints']
    meta: SessionState['spec']['meta']
    visual_script: SessionState['spec']['visual_script']
  }
}

export function buildContextPayload(
  session: SessionState,
  latestUserMessage: string,
  executionGuardrails: ExecutionGuardrails,
): UnifiedContextPayload {
  const recentTurns = session.transcript.slice(-MAX_RECENT_TURNS)
  const pinnedUserPrompt = getPinnedUserPrompt(session.transcript)
  const gc = session.spec.global_constraints
  const uploadedAssets = session.cached_artifacts.uploaded_assets ?? []
  const assetDescriptions = session._loaded_asset_descriptions
  const describedAssetIds = new Set((assetDescriptions?.items ?? []).map((item) => item.asset_id))
  const undescribedAssetIds = uploadedAssets
    .map((asset) => asset.asset_id)
    .filter((assetId) => !describedAssetIds.has(assetId))
  const shotAssetUsage = session.spec.visual_script.shots
    .filter((shot) => shot.pre_selected_assets.length > 0)
    .map((shot) => ({
      shot_id: shot.shot_id,
      asset_ids: shot.pre_selected_assets.map((asset) => asset.asset_id),
    }))

  return {
    conversation: {
      pinned_user_prompt: pinnedUserPrompt,
      latest_user_message: latestUserMessage,
      recent_turns: recentTurns,
      conversation_summary: session.conversation_summary,
    },
    spec: {
      meta: session.spec.meta,
      global_constraints: session.spec.global_constraints,
      visual_script: session.spec.visual_script,
    },
    runtime: {
      asset_context_light: {
        has_uploaded_assets: uploadedAssets.length > 0,
        has_asset_descriptions: Boolean(assetDescriptions?.items?.length),
        has_undescribed_uploaded_assets: undescribedAssetIds.length > 0,
        undescribed_asset_count: undescribedAssetIds.length,
        undescribed_asset_ids: undescribedAssetIds.slice(0, MAX_UNDESCRIBED_ASSET_IDS),
        asset_catalog: uploadedAssets.map((asset) => ({
          asset_id: asset.asset_id,
          file_name: asset.file_name,
          content_type: asset.content_type,
          identity_clarity:
            assetDescriptions?.items.find((item) => item.asset_id === asset.asset_id)?.quality
              ?.identity_clarity ?? 'not_applicable',
          summary:
            assetDescriptions?.items.find((item) => item.asset_id === asset.asset_id)?.summary ??
            '',
        })),
        current_shot_asset_usage: shotAssetUsage,
      },
      available_artifacts: {
        uploaded_assets: uploadedAssets.length > 0,
        asset_descriptions: Boolean(assetDescriptions?.items?.length),
        script:
          session.spec.visual_script.shots.some((shot) => Boolean(shot.audio_vo?.trim())) ||
          Boolean(session.cached_artifacts.working_script?.script),
        global_constraints:
          Boolean(session.cached_artifacts.pending_global_constraints) ||
          Boolean(gc.topic?.trim()) ||
          Boolean(gc.video_type?.trim()) ||
          Boolean(gc.target_audience?.trim()),
        visual_script: session.spec.visual_script.shots.length > 0,
      },
      consistency: buildConsistencyContext(session),
      recent_tool_events: (session.cached_artifacts.tool_events ?? []).slice(
        -MAX_RECENT_TOOL_EVENTS,
      ),
      recovery: buildRecoveryContext(session),
      todo_state: session.todo_state,
      execution_guardrails: executionGuardrails,
    },
  }
}

/**
 * Single source of truth for the "anchor user intent" string both
 * context payload builders pin into their JSON dumps and the chain-
 * mode system prompts pin into a labelled block.
 *
 * Behavior: if the longest user message IS the first one, surface it
 * alone. Otherwise surface both -- the first message is what the user
 * originally walked in with, the longest message is the one they
 * subsequently took the most care to write, and either may be the
 * authoritative anchor.
 *
 * Exported because `prompts/chain-builders-shared.ts:buildPinnedUserPromptBlock`
 * also needs it to render the system-prompt block in chain mode.
 */
export function getPinnedUserPrompt(transcript: Message[]): string {
  const userMessages = transcript
    .filter((message) => message.role === 'user')
    .map((message) => message.content.trim())
    .filter((message) => message.length > 0)

  if (userMessages.length === 0) {
    return ''
  }

  const firstUserPrompt = userMessages[0]
  const longestUserPrompt = userMessages.reduce(
    (longest, current) => (current.length > longest.length ? current : longest),
    firstUserPrompt,
  )

  if (longestUserPrompt === firstUserPrompt) {
    return firstUserPrompt
  }

  return [
    'Initial user prompt:',
    firstUserPrompt,
    '',
    'Most detailed user prompt so far:',
    longestUserPrompt,
  ].join('\n')
}

// ===========================================================================
// Brand carry context view builder
// ===========================================================================

/**
 * Builds a trimmed view of the brand-remix carry state for the
 * mode-confirmation prompt. Deliberately EXCLUDES
 * `source_brand_bank` -- the bank (with its staged-asset arrays) would bloat
 * every prompt; the planner only needs enough to enumerate the carry in its
 * reply and decide apply-vs-discard.
 *
 * Returns null when brand extraction is disabled or the session has no carry.
 *
 * Exported so tests can call it directly (context-builder.brand-carry.test.ts).
 */
export function buildBrandCarryContextView(
  session: SessionState,
  brandExtractionEnabled: boolean,
): ModeConfirmationContextPayload['brand_carry_state'] {
  const carry = session.spec.global_constraints.brand_carry_state
  if (!brandExtractionEnabled || !carry) {
    return null
  }
  return {
    status: carry.status,
    source_brand_extraction_input: carry.source_brand_extraction_input,
    source_brand_video_type: carry.source_brand_video_type,
    // The bank is nulled once the carry resolves (applied/discarded); the
    // prompt only renders the carry block while pending, so the zeroed view
    // for resolved carries is never user-facing.
    business_name: carry.source_brand_bank?.basic_info.business_name || null,
    asset_counts: {
      character: carry.source_brand_bank?.staged_assets.character.length ?? 0,
      logo: carry.source_brand_bank?.staged_assets.logo.length ?? 0,
      product: carry.source_brand_bank?.staged_assets.product.length ?? 0,
    },
  }
}

// ===========================================================================
// Mode_confirmation context payload
// ===========================================================================
//
// Distinct from the post-confirmation `UnifiedContextPayload` because the
// mode_confirmation phase is an open intake conversation -- no tools,
// no patches, no structure edits, just ASK_CLARIFY and MODE_CONFIRMED.
// The JSON dump here drops fields the intake-style planner can't act on
// (visual_script, global_constraints, available_artifacts, recent_tool_events,
// recovery, describe-tracking) and ships the FULL transcript instead of
// the trailing slice so follow-up replies ("humor" referring to a question
// two turns back) resolve correctly.

/**
 * Trimmed context payload for the mode_confirmation phase. See module
 * header for the rationale on what's dropped vs the post-confirmation
 * `UnifiedContextPayload`.
 */
export interface ModeConfirmationContextPayload {
  /**
   * Synthesized brand bank, surfaced ONLY once extraction has completed
   * (non-null). The sections 2.6.5 / 2.6.6 brand clarification questions
   * ground their options in real fields here (business_name, pain_points,
   * product_offerings, ctas, palette, voice, testimonials, ...). Null
   * before extraction completes -- the prompt holds rather than fabricating
   * brand details. Kept lean (omitted as null) until the bank exists.
   */
  brand_bank: SessionState['spec']['global_constraints']['brand_bank']
  /**
   * Provenance of a pre-seeded bank (brand auto-reuse). 'brand_library'
   * means a saved brief was injected pre-locked at session start; the
   * mode-confirmation prompt renders the saved-brief block from this
   * (notice the user, skip the brand questions). Null for extraction-built
   * banks.
   */
  brand_bank_source: SessionState['spec']['global_constraints']['brand_bank_source']
  /**
   * Trimmed brand-remix carry view for the mode-confirmation prompt.
   * Deliberately EXCLUDES source_brand_bank -- the bank (with its
   * staged-asset arrays) would bloat every prompt; the planner only needs
   * enough to enumerate the carry in its reply and decide apply-vs-discard.
   * Null when brand extraction is disabled or the session has no carry.
   */
  brand_carry_state: null | {
    asset_counts: { character: number; logo: number; product: number }
    business_name: null | string
    source_brand_extraction_input: { kind: 'freeform'; text: string } | { kind: 'url'; url: string }
    // Null when the source locked without a shape (pre-shape era); the prompt
    // then runs the section 2.6.5 ask instead of treating it as satisfied.
    source_brand_video_type: 'friction_to_flow' | 'industry_explainer' | 'product_showcase' | null
    status: 'applied' | 'discarded' | 'pending'
  }
  /**
   * UIP Brand Extraction surface for the brand-intent classifier
   * (section 2.6 of the mode-confirmation prompt). Only carries meaningful
   * values when `enabled === true` (feature gate snapshot from session
   * creation); otherwise `input` is null, matching the pre-feature observable
   * state. The LLM detects URLs / brand cues from the raw user message
   * directly -- no pre-scan field.
   */
  brand_extraction: {
    /**
     * True after the user detached an injected saved brief with "remove the
     * brand brief". The prompt uses it to stop offering brand for
     * the rest of the session. Optional: the live builder always sets it, but
     * the prompt reads it as `=== true`, so an omitted value is a safe "not
     * declined" (keeps ad-hoc test payloads from having to specify it).
     */
    declined?: boolean
    enabled: boolean
    input: SessionState['spec']['global_constraints']['brand_extraction_input']
    /**
     * Workflow-owned extraction status (null -> pending -> completed /
     * failed -> locked). The mode_confirmation prompt gates the brand
     * clarification questions on this: hold while `pending`, ask grounded
     * questions once `completed`, ungrounded fallback on `failed`.
     */
    status: SessionState['spec']['global_constraints']['brand_extraction_status']
  }
  /**
   * User-picked narrative arc for branded videos (sections 2.6.5 / 2.6.6 of
   * the mode-confirmation prompt). Null when the planner has not yet
   * converged on a type, or when the session is not on the brand path. Threaded
   * separately from `brand_extraction` because the prompt's branching
   * predicate keys off it directly without dereferencing
   * `spec.global_constraints`.
   */
  brand_video_type: SessionState['spec']['global_constraints']['brand_video_type']
  conversation: {
    latest_user_message: string
    pinned_user_prompt: string
    transcript: Message[]
  }
  runtime: {
    asset_context_light: {
      asset_catalog: Array<{
        asset_id: string
        content_type: string
        file_name: string
      }>
      has_uploaded_assets: boolean
    }
    /**
     * Carried even though this payload drops most runtime fields: a summary
     * edit is reachable at mode_confirmation (PHASE_RANK 0), so an entry marked
     * here would otherwise be invisible to the planner. Every entry defers in
     * this phase (only ASK_CLARIFY and MODE_CONFIRMED are legal), so it is
     * informational -- but it is what lets the planner volunteer.
     */
    consistency: ConsistencyContext
    execution_guardrails: ExecutionGuardrails
    todo_state: PlannerTodoState
  }
  spec: {
    meta: SessionState['spec']['meta']
  }
}

export function buildModeConfirmationContextPayload(
  session: SessionState,
  latestUserMessage: string,
  executionGuardrails: ExecutionGuardrails,
): ModeConfirmationContextPayload {
  const uploadedAssets = session.cached_artifacts.uploaded_assets ?? []
  const brandExtractionEnabled = session.brandExtractionEnabled ?? false
  return {
    brand_extraction: {
      // Same flag-off gating as the rest of this block: a detached-brief signal
      // is meaningless when brand extraction is disabled.
      declined:
        brandExtractionEnabled &&
        session.spec.global_constraints.brand_extraction_declined === true,
      enabled: brandExtractionEnabled,
      // Pre-PR observable parity: when the flag is off we never surface the
      // input even if a stale field somehow leaked into the session. The
      // prompt only acts on this under section 2.6, gated by `enabled`.
      input: brandExtractionEnabled ? session.spec.global_constraints.brand_extraction_input : null,
      status: brandExtractionEnabled
        ? session.spec.global_constraints.brand_extraction_status
        : null,
    },
    // Ground the 2.6.5 / 2.6.6 brand questions in the real bank once
    // extraction completes. Surface it only when the flag is on AND the bank
    // is non-null; keep the payload lean (null) otherwise so a pre-extraction
    // turn carries no brand_bank noise and the prompt's hold gate stays clean.
    brand_bank:
      brandExtractionEnabled && session.spec.global_constraints.brand_bank != null
        ? session.spec.global_constraints.brand_bank
        : null,
    // Same flag-off gating: the saved-brief block only renders when the bank
    // itself is surfaced above.
    brand_bank_source: brandExtractionEnabled
      ? (session.spec.global_constraints.brand_bank_source ?? null)
      : null,
    // Mirror the flag-off gating: when brand extraction is disabled we
    // never surface a brand_video_type even if a stale field leaked in.
    // The 2.6.5 / 2.6.6 prompt sections are also gated on
    // `brand_extraction.input !== null`, so this is belt-and-braces.
    brand_video_type: brandExtractionEnabled
      ? session.spec.global_constraints.brand_video_type
      : null,
    // Same flag-off gating as brand_video_type - never surface carry state
    // when brand extraction is disabled, even if a stale field leaked in.
    // Trimmed view excludes source_brand_bank
    // to keep prompt size bounded.
    brand_carry_state: buildBrandCarryContextView(session, brandExtractionEnabled),
    conversation: {
      pinned_user_prompt: getPinnedUserPrompt(session.transcript),
      latest_user_message: latestUserMessage,
      transcript: session.transcript,
    },
    spec: {
      meta: session.spec.meta,
    },
    runtime: {
      asset_context_light: {
        has_uploaded_assets: uploadedAssets.length > 0,
        asset_catalog: uploadedAssets.slice(0, MAX_ASSET_CATALOG_ENTRIES).map((asset) => ({
          asset_id: asset.asset_id,
          file_name: asset.file_name,
          content_type: asset.content_type,
        })),
      },
      consistency: buildConsistencyContext(session),
      execution_guardrails: executionGuardrails,
      todo_state: session.todo_state,
    },
  }
}
