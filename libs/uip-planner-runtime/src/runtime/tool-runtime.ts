import { createStorage } from '@reelmakeeasy/common/agent-v2/storage/storage'
import { createSubLogger } from '@reelmakeeasy/common/logger'
import { runSubstep, type SubstepReporter } from '@reelmakeeasy/common/utils/tool-step-timing'

import { createPlannerStorage } from '../persistence'
import { getRecipeStageByTool } from '../recipe'
import {
  type ArticlePromptFacts,
  articlePromptFactsFromBootstrap,
  articleStagedAssetsToDescriptions,
  articleStagedAssetsToUploads,
  isArticleLogoAssetId,
} from '../tool-internals/article-prompt-facts'
import {
  brandPromptFactsFromConstraints,
  buildStructuredBriefJson,
} from '../tool-internals/brand-prompt-facts'
import {
  brandStagedAssetsToDescriptions,
  brandStagedAssetsToUploads,
  dedupeUploadedAssets,
  partitionByExistence,
} from '../tool-internals/brand-staged-assets-to-uploads'
import {
  ensureFullScopeStoryArtifacts,
  ensureTranscriptWords,
} from '../tool-internals/generate-visual-script-full-scope-story-runtime'
import {
  resolveEffectivePromptRoute,
  resolvePromptRouteForSession,
} from '../tool-internals/prompt-route'
import { ArtifactKey, getToolManifest } from '../tool-manifest'
import {
  generateAnchorAssets,
  MissingAnchorPlanError,
  UnresolvedAnchorTargetsError,
} from '../tools/generate-anchor-assets'
import { generateExplainerScript } from '../tools/generate-script'
import { generateExplainerVisualScript } from '../tools/generate-visual-script'
import {
  planAssetAssignment,
  projectAssetDescriptionsForAssetAssignment,
  projectShotsForAssetAssignment,
} from '../tools/plan-asset-assignment'
import {
  OpenQuestion,
  PlannerStructureEdit,
  PlannerToolCall,
  PlannerToolParams,
  ScriptShotEdit,
  SessionState,
  Shot,
  Spec,
  ToolExecutionEvent,
  UploadedAsset,
} from '../types'

import { guardAnchorConsistencyScope } from './anchor-full-rebuild'
import { collapseWhitespace } from './planner-contract-helpers'
import { plannerLog } from './planner-log'
import { describeAnchorPlanReadyMilestone, describeShotsMilestone } from './reply-vocab'
import { ToolCallResult } from './runtime.types'
import { syncScriptWordCapAudit } from './script-word-cap-runtime'
import { getScriptSource, shouldInjectUserDirectives, toScopeSpec } from './session-runtime'
import { getSharedArtifactBatchContext } from './shared-artifact-batch-context'
import { getMissingArtifactDependencies } from './tool-dependency-runtime'
import {
  ensureAssetDescriptionsLoadedIfNeeded,
  runDescribeUploadedImagesTool,
  runGenerateIntentContextTool,
} from './tool-runtime-asset-context-tools'
import {
  buildAnchorFailureMessage,
  collectVisualScriptMissingDependencies,
  excludeCanonicalizedAnchorSourceAssets,
  mapLoadedAssetDescriptionsToImageAnalyses,
  maybeBuildRefinementPropagationBlockResult,
  mergeVisualScriptShots,
  missingDependencyResult,
  repinPreservedAudioVo,
  repinPreservedPreSelectedAssets,
  resolveAnchorPlanForVisualScript,
  resolveFixedSegmentsForFullVs,
  validatePreservedUserUploadBindings,
  validateScriptVoiceoverFloor,
  validateScriptWordBudget,
  validateVisualScriptStructureEdit,
} from './tool-runtime-helpers'
import { resolveAnchorImageContentsForVisualScript } from './visual-script-anchor-contents'

export {
  ensureAssetDescriptionsLoadedIfNeeded,
  runDescribeUploadedImagesTool,
  runGenerateIntentContextTool,
} from './tool-runtime-asset-context-tools'
export { missingDependencyResult } from './tool-runtime-helpers'

const logger = createSubLogger('user-intent-planner')

interface ToolRuntimeDeps {
  appendProgressReply: (
    session: SessionState,
    summary: string,
    options?: { reviewHint?: boolean },
  ) => void
  buildDirectivesExtractionInput: (session: SessionState, userMessage: string) => string
  getAssetContextLightJson: (session: SessionState, userMessage: string) => string
  getAssetDescriptionsJson: (session: SessionState) => string
  /**
   * Optional substep progress reporter (UIP-v2 subTools). Wired by
   * prepareToolRuntime in story-mode-runtime; absent in the legacy V1 planner
   * runner, where runSubstep just runs the step.
   */
  reportSubstep?: SubstepReporter
  sessionStore: {
    updateSession: (session: SessionState) => Promise<void>
  }
  syncPostSpecMutation: (
    session: SessionState,
    prevSpec: Spec,
    extraQuestions?: OpenQuestion[],
    options?: { clearPendingArtifacts?: boolean },
  ) => void
}

export function checkToolDependencies(
  session: SessionState,
  tool: PlannerToolCall['tool'],
): null | ToolCallResult {
  const stage = getRecipeStageByTool(tool)
  // Recipe captures static `requires` at module init. Consult the manifest
  // directly for spec-dependent `conditionalRequires` so the manifest stays
  // the single source of truth.
  const conditional = getToolManifest(tool).conditionalRequires?.(session.spec) ?? []
  const allRequires: ArtifactKey[] = Array.from(new Set([...conditional, ...stage.requires]))
  const missing = getMissingArtifactDependencies(session, allRequires)
  if (missing.length === 0) {
    return null
  }

  return missingDependencyResult(tool, missing, stage.id)
}

export async function executeToolCall(
  runtime: object,
  session: SessionState,
  userMessage: string,
  toolCall: PlannerToolCall,
  structureEdit?: null | PlannerStructureEdit,
): Promise<ToolCallResult> {
  try {
    return await executeToolCallByType(
      runtime,
      session,
      userMessage,
      toolCall.tool,
      toolCall.params,
      structureEdit,
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn(
      plannerLog(session.sessionId, `[executeToolCall] ${toolCall.tool} failed`, {
        error: error instanceof Error ? error.message : String(error),
        tool: toolCall.tool,
      }),
    )
    return {
      ok: false,
      code: 'TOOL_RUNTIME_ERROR',
      retryable: true,
      message: `${toolCall.tool} failed: ${message}`,
    }
  }
}

export async function executeToolCallByType(
  runtime: object,
  session: SessionState,
  userMessage: string,
  tool: PlannerToolCall['tool'],
  params: PlannerToolParams,
  structureEdit?: null | PlannerStructureEdit,
): Promise<ToolCallResult> {
  if (
    session.todo_state.phase === 'script_review' &&
    (tool === 'generate_anchor_assets' ||
      tool === 'generate_explainer_visual_script' ||
      tool === 'plan_asset_assignment')
  ) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      retryable: false,
      message:
        'script_review only allows script/global-constraint review edits. Use the review gate buttons before continuing into anchor or visual generation.',
    }
  }

  if (
    session.todo_state.phase === 'bootstrap_script' &&
    (tool === 'generate_explainer_visual_script' ||
      tool === 'plan_asset_assignment' ||
      (tool === 'generate_anchor_assets' && params.scope === 'FULL'))
  ) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      retryable: false,
      message:
        'bootstrap_script only allows intent-context and script generation. Visual bootstrap starts only after the script review gate is continued.',
    }
  }

  if (structureEdit && tool !== 'generate_explainer_visual_script') {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      retryable: false,
      message: `${structureEdit.op} structure_edit requires generate_explainer_visual_script tool.`,
    }
  }

  if (tool !== 'describe_uploaded_images') {
    await ensureAssetDescriptionsLoadedIfNeeded(runtime, session)
  }

  const dependencyResult = checkToolDependencies(session, tool)
  if (dependencyResult) {
    return dependencyResult
  }

  switch (tool) {
    case 'describe_uploaded_images': {
      return runDescribeUploadedImagesTool(runtime, session)
    }
    case 'generate_anchor_assets': {
      return runGenerateAnchorAssetsTool(runtime, session, userMessage, params)
    }
    case 'generate_explainer_script': {
      return runGenerateScriptTool(runtime, session, userMessage, params)
    }
    case 'generate_explainer_visual_script': {
      return runGenerateVisualScriptTool(runtime, session, userMessage, params, structureEdit)
    }
    case 'generate_intent_context': {
      return runGenerateIntentContextTool(runtime, session, userMessage)
    }
    case 'plan_asset_assignment': {
      return runPlanAssetAssignmentTool(runtime, session, userMessage)
    }
    default: {
      return {
        ok: false,
        code: 'INVALID_INPUT',
        retryable: false,
        message: `Unknown tool call: ${tool}`,
      }
    }
  }
}

export function recordToolEvent(session: SessionState, event: ToolExecutionEvent): void {
  if (!session.cached_artifacts.tool_events) {
    session.cached_artifacts.tool_events = []
  }
  session.cached_artifacts.tool_events.push(event)
  if (session.cached_artifacts.tool_events.length > 20) {
    session.cached_artifacts.tool_events = session.cached_artifacts.tool_events.slice(-20)
  }
}

export function recordToolResult(
  session: SessionState,
  tool: PlannerToolCall['tool'],
  result: ToolCallResult,
): void {
  recordToolEvent(session, {
    tool,
    status: result.ok ? 'success' : 'error',
    message: result.message,
    code: result.code,
    retryable: result.retryable,
    missing: result.missing,
    timestamp: new Date().toISOString(),
  })
}

/**
 * Merge reconstructed brand staged-asset descriptions into the session's
 * loaded descriptions so anchor binding can match them by id. Existing entries
 * (real uploads / a prior extraction) always win; brand entries only fill ids
 * that aren't already described. No-op for non-brand sessions and for sessions
 * whose brand assets are already described.
 */
export async function runGenerateAnchorAssetsTool(
  runtime: object,
  session: SessionState,
  userMessage: string,
  params: PlannerToolParams,
): Promise<ToolCallResult> {
  const deps = asDeps(runtime)
  const sharedBatchContext = getSharedArtifactBatchContext(runtime)
  const fullAnchorScopeError = guardAnchorConsistencyScope({
    plannerParams: params,
    session,
    sharedBatchContext,
  })
  if (fullAnchorScopeError) {
    return fullAnchorScopeError
  }
  await ensureAssetDescriptionsLoadedIfNeeded(runtime, session)
  // Saved-brief reuse skips the brand-extraction child, so describe_uploaded_images
  // never populates _loaded_asset_descriptions for the brand's staged assets. Their
  // bytes still reach the anchor pipeline via brandStagedAssetsToUploads (below), but
  // without a matching description entry anchor binding silently no-ops and the assets
  // are regenerated from scratch. Reconstruct the brand descriptions from the bank (same
  // synthetic ids) and merge them in; existing entries win, so fresh-extraction and
  // already-described sessions are untouched. Deterministic from the spec -- no NDE.
  mergeBrandStagedDescriptions(session)
  const script = getScriptSource(session) ?? session.cached_artifacts.working_script?.script
  if (!script?.trim()) {
    return missingDependencyResult('generate_anchor_assets', ['script'])
  }

  const assetDescriptions = session._loaded_asset_descriptions ?? {
    generated_at: new Date().toISOString(),
    items: [],
  }
  // Real uploads + selected brand-staged synthetics, deduped. The pool is
  // shared with the VS arm's plan-stage source resolution so the two never
  // diverge (see buildAnchorUploadPool).
  const uploadedAssets = await buildAnchorUploadPool(session)

  let result
  try {
    result = await generateAnchorAssets({
      session,
      params,
      script,
      uploadedAssets,
      assetDescriptions,
      conversationContext: deps.buildDirectivesExtractionInput(session, userMessage),
      reportSubstep: deps.reportSubstep,
      sharedBatchContext,
      worldBibleAssetDescriptionsJson: deps.getAssetDescriptionsJson(session),
      onPlanReady: async () => {
        deps.appendProgressReply(session, describeAnchorPlanReadyMilestone())
        await deps.sessionStore.updateSession(session)
      },
    })
  } catch (error) {
    if (error instanceof MissingAnchorPlanError) {
      return missingDependencyResult('generate_anchor_assets', ['anchor_plan'])
    }
    if (error instanceof UnresolvedAnchorTargetsError) {
      return {
        ok: false,
        code: 'INVALID_INPUT',
        retryable: false,
        message: `generate_anchor_assets could not resolve target anchor_ids: ${error.anchorIds.join(', ')}. For a new anchor, emit anchor_requests with UPSERT and provide label/type; include source_asset_ids only for upload-driven source updates. Use REMOVE_ANCHOR only for existing anchors.`,
      }
    }
    throw error
  }

  const atomicFullRebuild = sharedBatchContext?.forceFreshAnchorPlan === true
  if (!atomicFullRebuild) {
    // Bootstrap and targeted calls intentionally retain partial successes for
    // retry. Atomic FULL recovery remains provisional until both batch arms
    // succeed, so its summary must not leak through this path.
    session.cached_artifacts.anchor_assets_summary = result.summary
  }

  const failedCount = result.summary.anchors.filter((anchor) => anchor.status === 'failed').length
  if (failedCount > 0) {
    return {
      ok: false,
      code: 'TOOL_RUNTIME_ERROR',
      retryable: true,
      // Enriched failure message lists the specific failed + succeeded
      // anchor_ids so the planner can tell whether the failure affects
      // the anchor(s) it was actually working on. Without this, the
      // planner read "1 failure(s) (8/9 ready)" as "my swap failed" and
      // re-emitted the same batch ~20 times in a single user turn.
      // See buildAnchorFailureMessage for
      // the full reasoning.
      message: buildAnchorFailureMessage(result.summary),
    }
  }
  if (atomicFullRebuild) {
    session.cached_artifacts.anchor_assets_summary = result.summary
  }

  // The durable brand-library store happens once at confirm time
  // (storeFinalSessionAnchorsToBrandLibrary in the api confirm orchestration),
  // not here: a FULL-scope store froze the FIRST generation forever, making
  // every later ANCHOR_IDS edit (regenerate / re-source / delete) invisible to
  // the library. At confirm the summary is final by construction.

  return {
    ok: true,
    code: 'OK',
    markStageDone: true,
    retryable: false,
    message: `Generated anchor assets (${result.summary.ready_count}/${result.summary.total_count} ready).`,
  }
}

/**
 * The anchor upload pool = real user uploads + brand-staged synthetics
 * (logo/product/character assets the user toggled selected on the
 * brand-review card, surfaced with bytes so brand-mentioning shots can bind
 * them as anchor sources), deduped (an image present as both a real upload and
 * its brand-staged synthetic has different asset_ids but the same bytes).
 * MUST be identical for the anchor arm (which generates the anchors) and the VS
 * arm's plan-stage source-image resolution -- otherwise vs_main could ground on
 * a source the anchor arm never used.
 *
 * Async because brand-staged refs are existence-filtered against storage before
 * entering the pool: a saved brand's staged_assets can dangle (an edit/
 * re-extraction consistency gap deleting the object while the persisted bank
 * still references it), and the downstream anchor+VS batch's bare
 * `storage.readFile` throws `No such object` -- one dangling ref among N
 * hard-failed the whole first storyboard. The filter is
 * deterministic-from-storage-state, so the anchor and VS arms still build
 * byte-identical pools (the invariant holds).
 */
async function buildAnchorUploadPool(session: SessionState): Promise<UploadedAsset[]> {
  const brandStaged = await dropMissingBrandStagedAssets(
    session,
    brandStagedAssetsToUploads(session.spec.global_constraints.brand_bank),
  )
  return dedupeUploadedAssets([
    ...(session.cached_artifacts.uploaded_assets ?? []),
    ...brandStaged,
    // Article key image + publisher logo: first-class anchor
    // sources so news shots can bind the story's own visuals.
    ...articleStagedAssetsToUploads(session.bootstrap?.article_context),
  ])
}

/**
 * Existence-filter brand-staged uploads against storage, dropping refs whose
 * object is gone so a dangling saved-brand asset can't brick the anchor+VS
 * batch. Best-effort, mirroring the save path
 * (`copyBankAssetsToLibrary`); a dropped asset regenerates from prompt.
 *
 * Probes through `createPlannerStorage` -- the EXACT storage the anchor
 * pipeline reads these assets through (`anchor-image-gen`'s
 * `params.storage.readFile`). Using the same `ProjectStore` guarantees the
 * probe resolves the path identically to the read (`resolve()` strips
 * `store://<key>` and re-prepends `this.bucket`), so a present asset is
 * never wrongly dropped. A transient stat error
 * collapses to "missing" (`storage.exists` swallows errors) -- still
 * strictly better than the status-quo hard-fail, and consistent with the
 * read, which would hit the same transient failure.
 */
async function dropMissingBrandStagedAssets(
  session: SessionState,
  brandStaged: UploadedAsset[],
): Promise<UploadedAsset[]> {
  if (brandStaged.length === 0) {
    return brandStaged
  }
  const storage = createPlannerStorage(session.sessionId)
  const { missing, present } = await partitionByExistence(brandStaged, (path) =>
    storage.exists(path),
  )
  for (const asset of missing) {
    logger.warn(
      plannerLog(
        session.sessionId,
        '[uip-anchor] dropped brand-staged asset with missing stored file',
        {
          asset_id: asset.asset_id,
          file_path: asset.file_path,
        },
      ),
    )
  }
  return present
}

/**
 * Article prompt facts with the FULL extracted text loaded from storage.
 * The bootstrap projection only carries a 1200-char excerpt;
 * the script tool wants the whole story so it can state what the article
 * states. Fail-soft: any storage error degrades to the excerpt-based
 * facts, never blocks the script turn. Returns null on non-news sessions.
 */
async function loadArticlePromptFacts(session: SessionState): Promise<ArticlePromptFacts | null> {
  const article = session.bootstrap?.article_context
  if (!article) {
    return null
  }
  let fullText: null | string = null
  try {
    const storage = await createStorage(session.sessionId)
    const buffer = await storage.readFile(article.text_artifact_path)
    // ~2-3k tokens cap: a very long feature piece must not blow up the
    // script prompt, and the head of an article carries the story.
    fullText = buffer.toString('utf8').slice(0, 12_000)
  } catch (err) {
    logger.warn(
      plannerLog(session.sessionId, '[uip-script] article text load failed; using excerpt', {
        path: article.text_artifact_path,
        message: err instanceof Error ? err.message : String(err),
      }),
    )
  }
  return articlePromptFactsFromBootstrap(session.bootstrap, fullText)
}

function mergeBrandStagedDescriptions(session: SessionState): void {
  const brandDescriptions = [
    ...brandStagedAssetsToDescriptions(session.spec.global_constraints.brand_bank),
    // Article assets carry their attribution captions the same
    // way: no describe pass runs for them, the caption is what the
    // asset-manager binds on.
    ...articleStagedAssetsToDescriptions(session.bootstrap?.article_context),
  ]
  const persisted = session._loaded_asset_descriptions?.items ?? []
  // Prune stale publisher-logo descriptions: sessions that ran
  // before the logo was dropped persisted a synthetic `article_logo_*` entry.
  // The upload catalog no longer synthesizes it (uip-confirm-orchestration),
  // so leaving the description would let the planner select a dangling id that
  // confirmation cannot resolve. Drop it here so in-flight sessions converge on
  // the no-logo behavior too.
  const existing = persisted.filter((item) => !isArticleLogoAssetId(item.asset_id))
  const removedStaleLogo = existing.length !== persisted.length
  if (brandDescriptions.length === 0 && !removedStaleLogo) {
    return
  }
  const byId = new Map(existing.map((item) => [item.asset_id, item]))
  let added = false
  for (const item of brandDescriptions) {
    if (!byId.has(item.asset_id)) {
      byId.set(item.asset_id, item)
      added = true
    }
  }
  if (!added && !removedStaleLogo) {
    return
  }
  session._loaded_asset_descriptions = {
    generated_at: session._loaded_asset_descriptions?.generated_at ?? new Date().toISOString(),
    items: [...byId.values()],
  }
}

/**
 * Guards against silent erasure of FULL-scope `shot_edits` when the
 * script LLM regenerates the script and returns an empty `shot_edits`
 * array even though the prior artifact had per-shot segmentation.
 *
 * Failure mode this fixes: user pastes a pre-segmented script
 * ("SHOT 1: ... SHOT N: ..."). The first call captures N edits. A later
 * FULL-scope refresh asks the LLM to rewrite the script without
 * `exact_locks`; the LLM falls back to the prompt's documented default
 * of `shot_edits=[]` and the unconditional write at the end of this
 * tool wipes the captured segmentation. Downstream visual-script then
 * falls through to the beat-sheet expert and ships a different shot
 * count than the user asked for.
 *
 * Preservation rule (intentionally conservative):
 *   - scope must be FULL. Non-FULL scopes (SHOT_IDS / SHOT_RANGE /
 *     ANCHOR_IDS) already carry shot_id-based contracts; their empty
 *     `shot_edits` is a meaningful "no per-shot changes" signal.
 *   - new `shot_edits` is empty, previous was non-empty
 *   - the new script, after whitespace normalization, equals the join
 *     of the previous segments' `audio_vo` (the same script-vs-shot_edits
 *     invariant the LLM prompt requires; see `script-generation-prompt.ts`)
 *
 * When the invariant doesn't hold we cannot safely reuse the previous
 * boundaries, so we accept the loss but log a warning so the regression
 * is visible.
 */
export function resolveShotEditsForArtifact(params: {
  newScript: string
  newShotEdits: ScriptShotEdit[]
  previousArtifact: SessionState['cached_artifacts']['working_script']
  scope: PlannerToolParams['scope']
  sessionId: string
}): ScriptShotEdit[] {
  const { newScript, newShotEdits, previousArtifact, scope, sessionId } = params
  const previousShotEdits = previousArtifact?.shot_edits ?? []
  const isRegression = scope === 'FULL' && newShotEdits.length === 0 && previousShotEdits.length > 0
  if (!isRegression) {
    return newShotEdits
  }
  const joinedPrevious = collapseWhitespace(
    previousShotEdits.map((edit) => edit.audio_vo).join(' '),
  )
  const normalizedNew = collapseWhitespace(newScript)
  if (joinedPrevious === normalizedNew) {
    logger.info(
      plannerLog(sessionId, '[uip-script] preserved shot_edits across regen', {
        previousCount: previousShotEdits.length,
      }),
    )
    return previousShotEdits
  }
  logger.warn(
    plannerLog(sessionId, '[uip-script] shot_edits regression', {
      previousCount: previousShotEdits.length,
      newCount: 0,
      newScriptChars: newScript.length,
      joinedPreviousChars: joinedPrevious.length,
    }),
  )
  return newShotEdits
}

export async function runGenerateScriptTool(
  runtime: object,
  session: SessionState,
  userMessage: string,
  params: PlannerToolParams,
): Promise<ToolCallResult> {
  // Audio-mode script lock: in user_audio sessions the script comes from the
  // uploaded audio (pre-voiceover seed), never from this tool. Enforcement is
  // the deterministic contract guard in checkToolCallsContract, which rejects
  // generate_explainer_script before it can execute -- so this function is only
  // reached in non-audio sessions. (The previous in-tool short-circuit returned
  // an EMPTY working_script with ok:true on an unseeded race -- exactly the
  // empty-script-in-script_review bug the guard now prevents -- so it was
  // removed rather than kept as a footgun "net".)
  const deps = asDeps(runtime)
  const mode = session.spec.meta.mode_state.mode
  if (!mode) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      retryable: false,
      message:
        'generate_explainer_script requires a confirmed mode (explainer / ads / narrative_story).',
    }
  }

  const conversationContext = deps.buildDirectivesExtractionInput(session, userMessage)
  // Article grounding: load the full extracted text (fail-soft to
  // the excerpt) so the script states what the article states.
  const articleFacts = await loadArticlePromptFacts(session)
  const scriptResult = await generateExplainerScript({
    params,
    article: articleFacts,
    brand: brandPromptFactsFromConstraints(session.spec.global_constraints),
    conversationContext,
    conversationHistory: session.transcript,
    structuredBriefJson: buildStructuredBriefJson(session.spec.global_constraints),
    existingShotsJson: JSON.stringify(session.spec.visual_script.shots, null, 2),
    previousScript: getScriptSource(session) ?? session.cached_artifacts.working_script?.script,
    durationSeconds: session.spec.meta.mode_state.duration_seconds,
    imageAnalyses: mapLoadedAssetDescriptionsToImageAnalyses(session),
    enableTtsMarkup: session.spec.meta.transcript_voice_preview_enabled === true,
    // Feeds the pasted-script extractor short-circuit.
    inputType: session.spec.meta.mode_state.input_type ?? null,
    pastedScriptDurationSource: session.spec.meta.mode_state.duration_source ?? null,
    pastedScriptFit: session.spec.meta.mode_state.pasted_script_fit ?? null,
    verifiedPastedScript: session.spec.meta.mode_state.verified_pasted_script ?? null,
    // Planner-driven extractor gate for script_review / refinement (default
    // off). Bootstrap ignores this and gates on inputType above.
    runExtractor: params.run_extractor === true,
    projectId: session.sessionId,
    reportSubstep: deps.reportSubstep,
  })

  // Reject a degenerate whole-script (empty / "NO VOICEOVER" sentinel)
  // before it stages -- every video is voiceover-driven. Surfaces to the planner
  // so it ASK_CLARIFYs instead of shipping a silent video.
  const voiceoverFloorViolation = validateScriptVoiceoverFloor(session, scriptResult.script, params)
  if (voiceoverFloorViolation) {
    return voiceoverFloorViolation
  }

  const shotEditsToCommit = resolveShotEditsForArtifact({
    newScript: scriptResult.script,
    newShotEdits: scriptResult.shot_edits,
    previousArtifact: session.cached_artifacts.working_script,
    scope: params.scope,
    sessionId: session.sessionId,
  })

  // Validate the resolved edits (not scriptResult.shot_edits) so that
  // the preservation path can't bypass the word-budget guard with
  // previously-staged edits whose per-shot word counts are out of
  // range for the session's current state.
  const scriptWordBudgetValidation = validateScriptWordBudget(session, shotEditsToCommit)
  if (scriptWordBudgetValidation) {
    return scriptWordBudgetValidation
  }

  session.cached_artifacts.working_script = {
    script: scriptResult.script,
    shot_edits: shotEditsToCommit,
    scope: toScopeSpec(params),
    pending_vs_apply: params.scope === 'FULL',
  }

  // TTS word-cap audit: in bootstrap_script phase shots are empty, so
  // `getScriptSource` falls through to `working_script.script` that we just
  // wrote. Audit before the spec ever gets the script (VS tool auto-apply)
  // so the user hears the over-cap warning as early as possible.
  syncScriptWordCapAudit(runtime, session)

  return {
    ok: true,
    code: 'OK',
    retryable: false,
    message: `Generated script (${scriptResult.script.length} chars).`,
  }
}

export async function runGenerateVisualScriptTool(
  runtime: object,
  session: SessionState,
  userMessage: string,
  params: PlannerToolParams,
  structureEdit?: null | PlannerStructureEdit,
): Promise<ToolCallResult> {
  const deps = asDeps(runtime)
  const sharedBatchContext = getSharedArtifactBatchContext(runtime)
  const structureEditValidation = validateVisualScriptStructureEdit(structureEdit)
  if (structureEditValidation) {
    return structureEditValidation
  }

  // NOTE: audio_vo is NOT protected by edit_mode here. `edit_mode` only
  // controls visual determinism + temperature (EXACT 0.1 / CREATIVE 0.3);
  // it has no bearing on narration. VO preservation is enforced
  // structurally below by `repinPreservedAudioVo` (the VS tool re-pins
  // audio_vo from the existing spec for every path except a legit
  // staged-script FULL refresh and the bootstrap first generation). That
  // makes audio-mode VO immutable regardless of edit_mode, so audio
  // sessions can use CREATIVE for richer visuals.

  const shouldInjectDirectives = shouldInjectUserDirectives(
    session,
    'generate_explainer_visual_script',
  )
  // Default absent directives to [] (not null): a session created before the
  // directives flatten has no global_constraints.directives key, and directives
  // is an OPTIONAL positive-hint list -- its absence must not make
  // collectVisualScriptMissingDependencies report a missing dependency and block
  // the visual-script tool for legacy/in-flight sessions.
  const directives = shouldInjectDirectives
    ? ((session.cached_artifacts.pending_global_constraints ?? session.spec.global_constraints)
        .directives ?? [])
    : null
  const fullScriptArtifact = session.cached_artifacts.working_script
  // Resolve (and locally repair) the user's fixed segments ONCE; thread the same
  // array into both the beat sheet and the fixed-segment lock below so they stay
  // byte-identical (the LLM re-cut is non-deterministic).
  const fixedSegmentsForFullVs = await resolveFixedSegmentsForFullVs(params, structureEdit, session)
  const shouldPreferFullScriptArtifact =
    !structureEdit &&
    params.scope === 'FULL' &&
    fullScriptArtifact?.scope.scope === 'FULL' &&
    fullScriptArtifact.pending_vs_apply === true &&
    fullScriptArtifact.script.trim().length > 0
  const script = shouldPreferFullScriptArtifact
    ? fullScriptArtifact?.script
    : (getScriptSource(session) ?? fullScriptArtifact?.script)
  const constraints =
    session.cached_artifacts.pending_global_constraints ?? session.spec.global_constraints

  const missing = collectVisualScriptMissingDependencies(
    shouldInjectDirectives,
    directives,
    script,
    constraints,
  )
  if (missing.length > 0) {
    return missingDependencyResult('generate_explainer_visual_script', missing)
  }

  const strictScript = script as string
  const strictConstraints = constraints as NonNullable<typeof constraints>

  const refinementPropagationBlockResult = maybeBuildRefinementPropagationBlockResult(
    session,
    params,
    structureEdit,
  )
  if (refinementPropagationBlockResult) {
    return refinementPropagationBlockResult
  }

  await ensureAssetDescriptionsLoadedIfNeeded(runtime, session)
  // Same reconstruction as the anchor arm (see runGenerateAnchorAssetsTool):
  // brand/article synthetic descriptions must be visible to the standalone-VS
  // anchor plan too, or their assets are never selectable there.
  mergeBrandStagedDescriptions(session)
  const conversationContext = deps.buildDirectivesExtractionInput(session, userMessage)
  const assetDescriptionsJson = deps.getAssetDescriptionsJson(session)
  const promptRouteArtifact = await runSubstep(deps.reportSubstep, 'prompt_route', () =>
    resolvePromptRouteForSession({ session, script: strictScript }),
  )
  const promptRoute = resolveEffectivePromptRoute(promptRouteArtifact)
  const storyArtifacts =
    !structureEdit && params.scope === 'FULL'
      ? await ensureFullScopeStoryArtifacts({
          session,
          script: strictScript,
          assetDescriptionsJson,
          promptRoute,
          // Planner-driven re-segmentation control. true => beat-sheet
          // expert re-runs (LLM); false / null => existing shots are
          // synthesized into a 1:1 beat-sheet (no LLM). See
          // unified-planner-prompt section 7.2 "Segmentation routing"
          // for when planner sets this.
          // Also force refresh when a staged script artifact is pending VS
          // apply (shouldPreferFullScriptArtifact=true): the script content
          // has changed, so synthesizing the beat-sheet from old shots would
          // produce stale segment_text and the VS LLM would copy the old
          // audio_vo verbatim instead of segmenting the new script.
          refreshBeatSheet: params.refresh_beat_sheet === true || shouldPreferFullScriptArtifact,
          // Planner-driven world-bible force-refresh. Only the VS tool reads
          // `refresh_world_bible`; set it on a material topic/canon change so
          // the canon regenerates. Otherwise the persisted artifact is reused.
          forceWorldBibleRefresh: params.refresh_world_bible === true,
          fixedSegmentEdits: fixedSegmentsForFullVs,
          reportSubstep: deps.reportSubstep,
          sharedBatchContext,
        })
      : null
  // Audio-mode transcript alignment: pulled once per batch and threaded into
  // the VS tool so shot times come from word-level timestamps rather than
  // WPM estimates. Returns null outside audio mode or when the transcript
  // artifact is missing (both cases fall back to DEFAULT_WPM).
  const transcriptWords = await ensureTranscriptWords(session)
  // Build the (existence-filtered) anchor upload pool once and reuse it for both
  // the plan stage and vs_main's source resolution: awaiting it per call site
  // would stat storage twice, and computing it once guarantees the two stages see a
  // byte-identical pool even if a probe flaked between them.
  const anchorUploadPool = await buildAnchorUploadPool(session)
  // Standalone VS owns `anchor_plan_llm`; in batch mode the anchor arm owns it,
  // so reporting it here too would collide and downgrade statuses in the merged
  // `anchor_vs_batch` map. Closure keeps the args object un-duplicated.
  const resolveAnchorPlan = () =>
    resolveAnchorPlanForVisualScript({
      assetDescriptionsJson,
      conversationContext,
      params,
      script: strictScript,
      session,
      sharedBatchContext,
      structureEdit,
      uploadedAssetPool: anchorUploadPool,
    })
  const anchorPlanResult = sharedBatchContext
    ? await resolveAnchorPlan()
    : await runSubstep(deps.reportSubstep, 'anchor_plan_llm', resolveAnchorPlan)
  if (!anchorPlanResult.ok) {
    return anchorPlanResult.result
  }
  const anchorPlan = anchorPlanResult.anchorPlan

  const directUseAssetDescriptionsJson = excludeCanonicalizedAnchorSourceAssets(
    assetDescriptionsJson,
    anchorPlan,
    session.cached_artifacts.absorbed_upload_ids ?? null,
  )
  // vs_main grounds anchors on the PLAN (Phase A), not the anchor arm's
  // generated previews (Phase C) -- so it no longer awaits image gen and can
  // overlap anchor B+C. Same upload pool as the anchor arm (shared
  // helper) so a plan candidate's source always resolves to the same bytes.
  const anchorImageContents = await resolveAnchorImageContentsForVisualScript({
    anchorPlan,
    promptRoute,
    sessionId: session.sessionId,
    uploadedAssets: anchorUploadPool,
  })
  const shots = await runSubstep(deps.reportSubstep, 'main_vs_llm', () =>
    generateExplainerVisualScript(strictScript, strictConstraints, directives, {
      params,
      structureEdit,
      phase: session.todo_state.phase,
      conversationContext,
      assetDescriptionsJson: directUseAssetDescriptionsJson,
      anchorAssetsJson: JSON.stringify(anchorPlan ?? { candidates: [] }, null, 2),
      anchorImageContents,
      beatSheetJson: JSON.stringify(storyArtifacts?.beatSheet ?? {}, null, 2),
      existingShotsJson: JSON.stringify(session.spec.visual_script.shots, null, 2),
      fixedSegments: fixedSegmentsForFullVs,
      musicContextJson: storyArtifacts?.musicContextJson,
      // Model routing inputs: the tier keys the primary slot of
      // the visual-script chain, the session id is the
      // randomization unit so the arm is stable for the whole project.
      modelSelectorTier: session.modelSelectorTier,
      sessionId: session.sessionId,
      promptRoute,
      storyModeV3Enabled: session.spec.meta.story_mode_v3_enabled === true,
      transcriptWords: transcriptWords ?? undefined,
      transitionVideoModel: session.transitionVideoModel,
      worldBibleJson: JSON.stringify(storyArtifacts?.worldBible ?? {}, null, 2),
    }),
  )

  const fixedSegmentValidationError = validateFixedSegmentsForFullVs(fixedSegmentsForFullVs, shots)
  if (fixedSegmentValidationError) {
    return {
      ok: false,
      code: 'INVALID_INPUT',
      retryable: true,
      message: fixedSegmentValidationError,
    }
  }

  const mergeResult = mergeVisualScriptShots(
    session,
    params,
    structureEdit,
    strictConstraints,
    shots,
    { transcriptWords: transcriptWords ?? undefined },
  )
  if (!mergeResult.ok) {
    return mergeResult.result
  }
  const { finalScope, finalShots } = mergeResult

  // The VS tool's job is visuals, not narration. Re-pin audio_vo (and its
  // timing) from the authoritative existing spec shots so a visual-only
  // edit can never silently rewrite VO. Skipped for the legitimate
  // VO-(re)write paths, where the new per-shot VO IS the intent:
  //   - structureEdit: applyStructureEditToVisualScript already derives
  //     audio_vo deterministically (verbatim concat/slice) from existing
  //     shots, and renumbers shot_ids, so re-pin by shot_id would not apply.
  //   - shouldPreferFullScriptArtifact: a FULL refresh consuming a freshly
  //     staged script artifact (pending_vs_apply). The new VO is the user's
  //     staged script -- byte-checked above when shot_edits exist, and
  //     authored fresh from the new script when they don't (so we must NOT
  //     re-pin to the stale spec VO).
  //   - FULL refresh_beat_sheet: global re-segmentation ("more shots",
  //     "tighter cuts", pacing). The beat-sheet expert legitimately
  //     re-splits the same script into different per-shot audio_vo;
  //     re-pinning by old shot_id would clobber the new segmentation.
  //     Gated to scope===FULL: re-segmentation only runs on FULL (the
  //     beat-sheet is only rebuilt when !structureEdit && scope===FULL),
  //     so on a partial scope refresh_beat_sheet is a no-op for
  //     segmentation and must NOT be allowed to skip the VO re-pin.
  const repinnedVoShots = repinPreservedAudioVo(session, finalShots, {
    skipRepin:
      Boolean(structureEdit) ||
      shouldPreferFullScriptArtifact ||
      (params.scope === 'FULL' && params.refresh_beat_sheet === true),
  })
  const skipBindingRepin =
    Boolean(structureEdit) ||
    shouldPreferFullScriptArtifact ||
    (params.scope === 'FULL' && params.refresh_beat_sheet === true)
  const repinnedShots = repinPreservedPreSelectedAssets(session, repinnedVoShots, {
    anchorPlan,
    skipRepin: skipBindingRepin,
  })
  const bindingError = validatePreservedUserUploadBindings(
    session,
    repinnedShots,
    params.scope === 'FULL' || Boolean(structureEdit),
    anchorPlan,
  )
  if (bindingError) {
    return bindingError
  }

  session.cached_artifacts.pending_visual_script_shots = repinnedShots
  session.cached_artifacts.pending_visual_script_scope = finalScope

  deps.appendProgressReply(session, describeShotsMilestone(finalShots.length, finalScope.scope))
  await deps.sessionStore.updateSession(session)

  return {
    ok: true,
    code: 'OK',
    retryable: false,
    message: structureEdit
      ? `Generated visual script with ${structureEdit.op} (${finalShots.length} shots total).`
      : `Generated visual script (${finalShots.length} shots).`,
  }
}

export async function runPlanAssetAssignmentTool(
  runtime: object,
  session: SessionState,
  userMessage: string,
): Promise<ToolCallResult> {
  const deps = asDeps(runtime)
  await ensureAssetDescriptionsLoadedIfNeeded(runtime, session)

  // Feed the planner only the fields it reads, minified: the full shots carry
  // audio_vo + the rest of visual_primary + timing, and the upload catalog
  // carries long per-asset descriptions -- none of which this tool consults.
  // Trimming + dropping pretty-print indentation cuts the prompt's input
  // tokens (its dominant latency cost) with no decision-relevant loss.
  const plan = await planAssetAssignment({
    anchorAssetsJson: JSON.stringify(session.cached_artifacts.anchor_assets_summary ?? null),
    brandBank: session.spec.global_constraints.brand_bank,
    conversationContext: deps.buildDirectivesExtractionInput(session, userMessage),
    visualScriptJson: JSON.stringify(
      projectShotsForAssetAssignment(session.spec.visual_script.shots),
    ),
    assetDescriptionsJson: JSON.stringify({
      items: projectAssetDescriptionsForAssetAssignment(
        session._loaded_asset_descriptions?.items ?? [],
      ),
    }),
  })

  session.cached_artifacts.pending_asset_assignment_plan = plan
  return {
    ok: true,
    code: 'OK',
    retryable: false,
    message: `Planned asset assignment updates (${plan.actions.length} action(s)).`,
  }
}

export function validateFixedSegmentsForFullVs(
  fixedSegments: ScriptShotEdit[],
  generatedShots: Shot[],
): null | string {
  if (fixedSegments.length === 0) {
    return null
  }

  if (generatedShots.length !== fixedSegments.length) {
    return `Fixed segments validation failed: expected ${fixedSegments.length} shot(s), got ${generatedShots.length}.`
  }

  for (let index = 0; index < fixedSegments.length; index += 1) {
    const expectedAudio = collapseWhitespace(fixedSegments[index].audio_vo)
    const actualAudio = collapseWhitespace(generatedShots[index].audio_vo)
    if (expectedAudio !== actualAudio) {
      return `Fixed segments validation failed at index ${index}: audio_vo does not match script shot_edits.`
    }
  }

  return null
}

function asDeps(runtime: object): ToolRuntimeDeps {
  return runtime as ToolRuntimeDeps
}
