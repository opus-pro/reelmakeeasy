import { createSubLogger } from '@reelmakeeasy/common/logger'
import { runSubstep, type SubstepReporter } from '@reelmakeeasy/common/utils/tool-step-timing'

import { getPinnedUserPrompt } from '../context-builder'
import { canonicalizeGlobalConstraints } from '../normalization'
import { loadAssetDescriptions, persistAssetDescriptions } from '../persistence'
import { articlePromptFactsFromBootstrap } from '../tool-internals/article-prompt-facts'
import { brandPromptFactsFromConstraints } from '../tool-internals/brand-prompt-facts'
import { generateBrandStyling } from '../tool-internals/generate-brand-styling'
import { hasUipMusicSignal } from '../tool-internals/music-track-eligibility'
import { describeUploadedImages } from '../tools/describe-uploaded-images'
import { generateIntentContext } from '../tools/generate-intent-context'
import {
  AssetDescriptionItem,
  AssetDescriptionsArtifact,
  OpenQuestion,
  SessionState,
  Spec,
} from '../types'

import { plannerLog } from './planner-log'
import { ToolCallResult } from './runtime.types'
import { getScriptSource, getUndescribedUploadedAssets } from './session-runtime'
import { missingDependencyResult } from './tool-runtime-helpers'

const logger = createSubLogger('user-intent-planner')

interface AssetContextToolDeps {
  buildDirectivesExtractionInput: (session: SessionState, userMessage: string) => string
  getAssetContextLightJson: (session: SessionState, userMessage: string) => string
  getAssetDescriptionsJson: (session: SessionState) => string
  /**
   * Optional substep progress reporter (UIP-v2 subTools). Wired by
   * prepareToolRuntime in story-mode-runtime; absent in the legacy V1 planner
   * runner, where runSubstep just runs the step.
   */
  reportSubstep?: SubstepReporter
  syncPostSpecMutation?: (
    session: SessionState,
    prevSpec: Spec,
    extraQuestions?: OpenQuestion[],
    options?: { clearPendingArtifacts?: boolean },
  ) => void
}

export async function ensureAssetDescriptionsLoadedIfNeeded(
  _runtime: object,
  session: SessionState,
): Promise<void> {
  if (session._loaded_asset_descriptions?.items?.length) {
    return
  }
  if (!session.cached_artifacts.uploaded_assets?.length) {
    return
  }

  try {
    const loaded = await loadAssetDescriptions(session.sessionId)
    if (loaded?.items?.length) {
      session._loaded_asset_descriptions = loaded
    }
  } catch (error) {
    logger.warn(
      plannerLog(
        session.sessionId,
        '[ensureAssetDescriptionsLoadedIfNeeded] failed to load persisted descriptions',
        { error: error instanceof Error ? error.message : String(error) },
      ),
    )
  }
}

export async function runDescribeUploadedImagesTool(
  _runtime: object,
  session: SessionState,
): Promise<ToolCallResult> {
  const allUploadedAssets = session.cached_artifacts.uploaded_assets ?? []
  if (allUploadedAssets.length === 0) {
    return missingDependencyResult('describe_uploaded_images', ['uploaded_assets'])
  }

  await ensureAssetDescriptionsLoadedIfNeeded(_runtime, session)

  const undescribedAssets = getUndescribedUploadedAssets(session)
  if (undescribedAssets.length === 0) {
    return {
      ok: true,
      code: 'OK',
      retryable: false,
      message: 'No undescribed uploaded image(s); skipping describe_uploaded_images.',
    }
  }

  const descriptions = await describeUploadedImages(undescribedAssets, {
    projectId: `${session.sessionId}/user-intent-planner`,
  })

  const existingItems: AssetDescriptionItem[] = session._loaded_asset_descriptions?.items ?? []
  const mergedById = new Map<string, AssetDescriptionItem>(
    existingItems.map((item) => [item.asset_id, item]),
  )
  for (const item of descriptions.items) {
    mergedById.set(item.asset_id, item)
  }
  const mergedDescriptions: AssetDescriptionsArtifact = {
    generated_at: new Date().toISOString(),
    items: [...mergedById.values()],
  }

  try {
    await persistAssetDescriptions(session.sessionId, mergedDescriptions)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      code: 'TOOL_RUNTIME_ERROR',
      retryable: true,
      message: `describe_uploaded_images failed to persist asset descriptions: ${message}`,
    }
  }

  session._loaded_asset_descriptions = mergedDescriptions
  return {
    ok: true,
    code: 'OK',
    retryable: false,
    message: `Described ${descriptions.items.length} new uploaded image(s) (${mergedDescriptions.items.length} total described).`,
  }
}

export async function runGenerateIntentContextTool(
  runtime: object,
  session: SessionState,
  userMessage: string,
): Promise<ToolCallResult> {
  const deps = runtime as AssetContextToolDeps
  const isAudioMode = session.spec.meta.audio_source === 'user_audio'
  // The current turn may carry no fresh user message, so t1 resolves the user
  // signal through three tiers (otherwise it returns INVALID_INPUT errors,
  // bootstrap_script never advances, and the session is reaped by the 3h idle
  // timeout):
  //   1. the per-turn message, when present;
  //   2. audio mode: the last transcript entry -- the
  //      AUDIO_POST_TURN_SEED_PATCH re-invokes the planner with empty signals,
  //      and the ASR-seeded last turn is the canonical intent there;
  //   3. the pinned/original prompt -- branding sessions enter
  //      bootstrap_script via a brand-review confirm CTA (resolveLatestUserMessage
  //      returns '' by design). We use the pinned prompt rather than the last
  //      turn here on purpose: a brand_review chat edit before Confirm ("change
  //      the key message...") is the last user turn, but the bootstrap brief
  //      must ground on the requested video, not the edit.
  const resolvedUserMessage =
    userMessage.trim() ||
    (isAudioMode ? findLastUserTranscriptContent(session.transcript).trim() : '') ||
    getPinnedUserPrompt(session.transcript).trim()
  if (!resolvedUserMessage) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      retryable: false,
      message: 'generate_intent_context requires a non-empty user message.',
    }
  }

  // All audio uploads defer the brief until the pre-voiceover ASR has COMPLETED
  // (the working_script artifact is seeded -- possibly empty for instrumental
  // tracks), not until the script is non-empty. Gating on non-empty would
  // deadlock instrumental audio (no transcript ever). The brief then grounds on
  // the transcript when present, else on prompt + filename + assets (the tool's
  // own "if script missing, infer from intent context" path). Unifies the old
  // split (which exempted audio_music to read the filename) -- now all
  // audio waits, and the filename still serves as topic for empty transcripts
  // via the un-stripped @audio marker below.
  const workingScript = session.cached_artifacts.working_script
  const requiresAsrScript = isAudioMode
  if (requiresAsrScript && workingScript === undefined) {
    return missingDependencyResult('generate_intent_context', ['script'])
  }
  const workingScriptText = workingScript?.script

  await ensureAssetDescriptionsLoadedIfNeeded(runtime, session)
  const extractionInput = deps.buildDirectivesExtractionInput(session, resolvedUserMessage)

  // Brand styling gate. Fires only when the user opted
  // into hybrid brand styling AND a locked brand_bank exists. The helper
  // is fail-soft (returns null on LLM failure); flag-off sessions and
  // failed-styling sessions both flow through with style.style_text
  // unchanged from the user's preset.
  const gc = session.spec.global_constraints
  const stylingEnabled = gc.brand_style_directive === 'hybrid' && gc.brand_bank != null

  // When the user picked the brand-colors card, the FE carried the
  // exact style text that produced the preview into Confirm, persisted at
  // `brand_style_text`. Reuse it verbatim so the rendered video matches the
  // previewed look -- skip regeneration entirely. Absent (older clients, or
  // the preview never landed) falls through to live generation below.
  const preGeneratedStyleText = stylingEnabled ? gc.brand_style_text?.trim() : undefined

  // The user's selected preset lives on `bootstrap.seed_style_instruction`
  // (set at session creation), NOT on `spec.global_constraints.style` -- the
  // spec's style fields are empty until `generateIntentContext` copies the
  // seed into them on its way out. Because that copy happens inside the
  // parallel-fired call below, reading `gc.style.style_text` here would
  // always observe the empty default and our helper would fall back to the
  // no-preset string on every brand session (an earlier bug).
  // Read from the seed directly. Fall back to `style_name` for presets that
  // ship a label without descriptive text.
  const seedStyle = session.bootstrap.seed_style_instruction
  const userStyleText = seedStyle?.style_text?.trim() || seedStyle?.style_name?.trim() || ''

  const brandBank = gc.brand_bank
  const [intentContext, brandStylingResult] = await Promise.all([
    generateIntentContext({
      // Article grounding: the excerpt suffices for topic /
      // entities; the script tool loads the full text separately.
      article: articlePromptFactsFromBootstrap(session.bootstrap),
      brand: brandPromptFactsFromConstraints(gc),
      conversationContext: extractionInput,
      assetDescriptionsJson: deps.getAssetDescriptionsJson(session),
      assetContextLightJson: deps.getAssetContextLightJson(session, resolvedUserMessage),
      modelSelectorTier: session.modelSelectorTier,
      projectId: `${session.sessionId}/user-intent-planner`,
      reportSubstep: deps.reportSubstep,
      sessionId: session.sessionId,
      script: workingScriptText?.trim() ? workingScriptText : getScriptSource(session),
      seedStyleInstruction: session.bootstrap.seed_style_instruction,
      // The same preset catalog select_auto_style ranks, so a
      // style the user named in the prompt ("claymation") resolves to the real
      // preset -- id, curated text and thumbnail -- instead of free text the
      // candidates rail cannot highlight. Absent on gate-off / legacy sessions.
      styleCatalog: session.spec.meta.style_catalog,
      // Strip the @audio upload marker only when the ASR transcript is non-empty
      // (then the transcript is the ground truth). For empty/instrumental audio,
      // KEEP the marker so the filename can still serve as the topic (MV framing).
      stripAudioUploadMarkersInContext: Boolean(workingScriptText?.trim()),
    }),
    stylingEnabled && !preGeneratedStyleText && brandBank
      ? runSubstep(deps.reportSubstep, 'brand_styling', () =>
          generateBrandStyling({
            brandBank,
            userStyleText,
          }),
        )
      : Promise.resolve(null),
  ])

  // Activity-side mutation: overwrite style.style_text on the freshly
  // built intentContext before canonicalization writes pending_global_constraints.
  // Downstream long-take consumes style.style_text via the existing
  // `Stylize the image with ${styleText}` pathway -- no long-take change.
  if (preGeneratedStyleText) {
    intentContext.global_constraints.style.style_text = preGeneratedStyleText
    logger.info('[uip-brand-styling] reused pre-generated brand_style_text (no regeneration)')
  } else if (brandStylingResult) {
    intentContext.global_constraints.style.style_text = `${brandStylingResult.brand_style_paragraph}\n${brandStylingResult.medium_reskin_paragraph}`
    logger.info('[uip-brand-styling] applied universal styling to style.style_text')
  } else if (stylingEnabled) {
    logger.warn('[uip-brand-styling] gate ON but helper returned null; style.style_text unchanged')
  }

  // A brand look just replaced style_text, so a prompt-style capture
  // no longer describes what ships -- drop its provenance rather than leave the
  // session claiming 'user_prompt' over brand-generated text. The style_name /
  // thumbnail the capture resolved stay: they still label the style card.
  if (
    (preGeneratedStyleText || brandStylingResult) &&
    intentContext.global_constraints.selection_method === 'user_prompt'
  ) {
    intentContext.global_constraints.selection_method = undefined
    intentContext.global_constraints.style_source = undefined
  }

  // Music sessions are always labeled `music_video`. `video_type` is a
  // free string the LLM infers, so it drifts ('explainer' / 'narrative_story')
  // for music uploads. Force it here -- activity-side, before canonicalization
  // writes pending_global_constraints, mirroring the style override above -- so
  // the brief-card title and the long-take music world-bible prompt agree on a
  // single source of truth. hasUipMusicSignal = is_music preset | planner
  // audio_music classification | ID3 content pin.
  if (hasUipMusicSignal(session.spec)) {
    intentContext.global_constraints.video_type = 'music_video'
    logger.info('[uip-intent-context-music] forced video_type=music_video (music signal)')
  }

  session.cached_artifacts.pending_global_constraints = canonicalizeGlobalConstraints(
    intentContext.global_constraints,
  )
  // NB: `style` is deliberately NOT assigned here. It goes through the auto-apply
  // field filter (globalConstraintArtifactFieldsForTool), which preserves a landed
  // auto pick / user switch; a direct write here would bypass that guard.
  return {
    ok: true,
    code: 'OK',
    retryable: false,
    message: `Generated intent context (topic: ${intentContext.global_constraints.topic || 'n/a'}).`,
  }
}

function findLastUserTranscriptContent(transcript: SessionState['transcript']): string {
  for (let i = transcript.length - 1; i >= 0; i--) {
    if (transcript[i].role === 'user') {
      return transcript[i].content ?? ''
    }
  }
  return ''
}
