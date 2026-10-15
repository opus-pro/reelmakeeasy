/**
 * @reelmakeeasy/uip-planner-runtime
 *
 * Core logic for the User Intent Planner (UIP) -- planner loop, tools, prompts, and types.
 * Shared between the prototype (playground) and production (workflow activities).
 */

//
export {
  API_INBOX_WORKFLOW_PROTOCOL_SINCE,
  CURRENT_WORKFLOW_PROTOCOL_VERSION,
  supportsWorkflowProtocolFeature,
  WORKFLOW_PROTOCOL_V1_API_INBOX,
} from '@reelmakeeasy/common/uip/protocol-version'
//
export type { ExecutionGuardrails, UnifiedContextPayload } from './context-builder'
export type { ModeRecipe, ModeRecipeStage, RecipeStageId } from './recipe'
export type { RenderPlanMdOptions, ShotChangedField, ShotChangeMap } from './renderer'
export {
  detectAllUrlsInText,
  detectFirstUrlInText,
  stripAssetMarkup,
} from './runtime/auto-brand-extraction'
export type { PlannerOutput } from './runtime/planner-schema'
export type { PlannerOutputLike, PlannerStepResultLike } from './runtime/runtime.types'
export type { SharedArtifactBatchContext } from './runtime/shared-artifact-batch-context'
export type { ArtifactKey, ToolManifest } from './tool-manifest'
export * from './types'

//
export {
  BOOTSTRAP_SCRIPT_PHASE_COMPLETE_CONTRACT_ERROR,
  BOOTSTRAP_VISUAL_PHASE_COMPLETE_CONTRACT_ERROR,
  checkClarifyScope,
  checkModeConfirmedContract,
  checkPlannerOutputContract,
  checkStructureEditContract,
  checkTodoUpdateOnlyContract,
  checkToolCallsContract,
} from './runtime/planner-contract'
export { checkPatchSpecContract } from './runtime/planner-contract-patch'
export { checkSessionControlContract } from './runtime/planner-contract-session'
export { PlannerOutputSchema } from './runtime/planner-schema'

//
export {
  enforceSilhouetteIdentityClarification,
  guardIntentRoutingBeforeAction,
  guardSessionControlBeforeAction,
  guardUndescribedAssetsBeforeAction,
  isSilhouetteIdentityClarification,
  normalizeText,
} from './runtime/planner-guards'

//
export {
  buildRecoveryContext,
  detectUserUploadBindingViolations,
  isUserUploadFailureRecentlyRecorded,
  recordRecoveryFailure,
} from './runtime/planner-recovery'

//
export { remapDirectiveShotIds } from './runtime/planner-directive-reconcile'

//
export { applyPatch } from './patch-apply/patch-apply'
export { buildBrandCarryAssetKeys } from './patch-apply/patch-apply-brand-carry'
export {
  applyPatchOps,
  applyToolArtifactsToSpec,
  pushSpecHistory,
  setAutoLockDeadline,
  shouldRunAutoLockCountdown,
  syncPostSpecMutation,
} from './runtime/spec-runtime'

//
export {
  brandStagedAssetsToDescriptions,
  brandStagedAssetsToUploads,
  dedupeUploadedAssets,
  isBrandStagedAssetId,
  synthesizeBrandAssetId,
} from './tool-internals/brand-staged-assets-to-uploads'
export {
  getUipMusicSignalSource,
  getUipMusicTrackIneligibilityReason,
  hasUipMusicSignal,
  isUipMusicTrackEligible,
  type UipMusicEligibilitySpec,
  type UipMusicSignalSource,
  type UipMusicTrackIneligibilityReason,
} from './tool-internals/music-track-eligibility'

//
export {
  findSameImageRef,
  flattenStagedAssets,
  stagedAssetsAreSameImage,
} from './tool-internals/staged-asset-dedup'

//
export {
  executeUndoLastInternal,
  getAllowedUploadedAssetIds,
  getUndescribedUploadedAssets,
  hasGlobalConstraintsArtifact,
  hasScriptArtifact,
  hasVisualScriptArtifact,
  shouldInjectUserDirectives,
} from './runtime/session-runtime'

//
export { appendAgentReply, appendProgressReply } from './runtime/message-runtime'
export {
  buildResponse,
  buildSpecHistoryTurns,
  getChangedShotFieldsForResponse,
  getLastDiffSummary,
} from './runtime/message-runtime'
export { describeMode } from './runtime/reply-vocab'

//
export {
  applyTodoStateUpdate,
  describePatchOps,
  describeToolArtifactPatch,
  normalizeSessionControlOutput,
  withDefaultToolParams,
} from './runtime/runtime-facade-helpers'
export {
  activateBootstrapScript,
  buildBrandReviewGate,
  buildQueuedDrainMessage,
  buildScriptReviewGate,
  enterRefinementPhase,
  isActiveReviewGateToken,
  reenterBootstrapBrand,
  refreshPhaseDeadline,
  refreshReviewAutoContinueDeadline,
  syncBootstrapDraftOwnedState,
  syncBrandReviewOwnedState,
  syncRefinementOwnedState,
  syncScriptReviewOwnedState,
  transitionToBrandReview,
} from './runtime/runtime-phase'

//
export { buildAutoApplyOpsForTool } from './runtime/auto-apply-runtime'
export { applyStructureEditToVisualScript } from './runtime/structure-runtime'
export { getMissingArtifactDependencies } from './runtime/tool-dependency-runtime'
export {
  ensureAssetDescriptionsLoadedIfNeeded,
  executeToolCall,
  executeToolCallByType,
  recordToolEvent,
  recordToolResult,
  runDescribeUploadedImagesTool,
  runGenerateAnchorAssetsTool,
  runGenerateIntentContextTool,
  runGenerateScriptTool,
  runGenerateVisualScriptTool,
  runPlanAssetAssignmentTool,
} from './runtime/tool-runtime'
export { buildVisualScriptAutoApplyOps } from './runtime/visual-auto-apply-runtime'
export {
  resolveEffectivePromptRoute,
  resolvePromptRouteForSession,
} from './tool-internals/prompt-route'

// Auto Style Selection ("preset-only" V1): the `select_auto_style`
// ranking tool, consumed by its activity wrapper
// (libs/story-mode-runtime/src/activities/uip-v2/tools/select-auto-style.ts).
export type { StylePreset } from './tool-internals/style-catalog'
export { heuristicRank, toRankingCandidates } from './tool-internals/style-catalog'
export type { BriefFacts, SelectAutoStyleResult } from './tools/select-auto-style'
export {
  buildRankingPrompt,
  runSelectAutoStyle,
  selectAutoStyleSchema,
} from './tools/select-auto-style'

//
export {
  getPendingTodoCount,
  hasPendingTodoItems,
  hydrateBootstrapTodoFromArtifacts,
  isBootstrapArtifactsComplete,
  isBootstrapDraftPhase,
  markTodoStageDoneByTool,
} from './runtime/todo-runtime'

//
export { buildContextPayload } from './context-builder'
export { hasActiveFullAnchorRecovery } from './runtime/anchor-full-rebuild'
export type { ConsistencyContext, ConsistencyContextEntry } from './runtime/consistency-context'
export { buildConsistencyContext, existingArtifactsOf } from './runtime/consistency-context'
export {
  buildDirectivesExtractionInput,
  getAssetContextLightJson,
  getAssetDescriptionsJson,
} from './runtime/context-runtime'
export { checkConsistencyContract } from './runtime/planner-contract-consistency'
export {
  ANCHOR_ASSETS_TOOL_PARAMS_BATCH_KEY,
  clearSharedArtifactBatchContext,
  createSharedArtifactBatchContext,
  getSharedArtifactBatchContext,
  setSharedArtifactBatchContext,
  withSharedArtifactResult,
} from './runtime/shared-artifact-batch-context'
export { ALWAYS_SUBSTEPS, describeSubstep, SUBSTEP_DESCRIPTIONS } from './runtime/substep-catalog'
export { buildAnchorPlanUpdateRequest } from './tools/generate-anchor-assets'

//
export { EXPLAINER_RECIPE, getModeRecipe } from './recipe'
export { buildEmptySpec } from './session-defaults'
export { getToolManifest } from './tool-manifest'

//
export { buildUnifiedPlannerPrompt } from './prompts/unified-planner-prompt'

//
export {
  ANCHOR_IMAGE_GENERATION_ROLE,
  ANCHOR_IMAGE_GENERATION_STYLED_ROLE,
  DESCRIBE_IMAGE_MODELS,
  PLANNER_AGENT_MODEL_DEFAULT,
  PLANNER_TOOL_MODELS,
  PLANNER_TOOL_MODELS_LIGHT,
  resolveAnchorImageGenerationModel,
  resolvePlannerAgentModel,
} from './model-config'
export { computeChangedShotFields, renderPlanMd } from './renderer'
export { MAX_LOOP_STEPS } from './runtime/constants'
export { validateSpec } from './validator'

// Confirm-time helpers exposed to the API layer for orchestrating the
// UIP -> story-mode handoff. Not invoked from inside the planner loop.
export { classifyGenre } from './tool-internals/classify-genre'

// Spec -> long-take render-format converters, shared by BOTH UIP handoff paths
// (normal confirm in apps/services/api + the fast-path convert activity in
// story-mode-runtime) so they never drift. Activity/API-side only -- never
// imported from workflow code.
export {
  buildAssetManifestEntry,
  buildLongTakeGlobalConstraintsJson,
  buildUserAssetCatalogForTracking,
  buildUserUploadAnchorEntries,
  convertUipAnchorsToStoryModeIndex,
  convertUipSpecToStoryModeVisualScript,
  countGeneratedAnchorsByCategoryForTracking,
  extractScriptFromSpec,
  type GeneratedAnchorCountsForTracking,
  type StoryModeAnchorIndexEntry,
  stripInlineTtsMarkupForDisplay,
  type UserAssetCatalogItemForTracking,
} from './story-mode-handoff'

// Image-normalization helpers shared with story-mode's long-take user-asset
// understanding step, so both runtimes downscale uploads identically
// (see describe-uploaded-images.ts / DESCRIBE_IMAGE_MAX_LONG_EDGE).
export { downscaleToLongEdge, flattenAlphaToContrastingPng } from './tool-internals/anchor-utils'

// Brand anchor-library store/reuse core.
// Session-free pieces are shared with story-mode's render-side long-take anchor
// path so a fast-path video stores + reuses anchors against the SAME
// (brief, style) storage key the planner uses. Activity-side only -- never imported
// from workflow code (which imports this package type-only).
export {
  ANCHOR_LIBRARY_MANIFEST_FILE,
  type AnchorLibraryManifest,
  type AnchorLibraryTarget,
  anchorLibraryTargetFromKey,
  type AnchorMatchIdentity,
  assignStoredAnchorEntries,
  buildAnchorLibraryManifest,
  buildAnchorLibraryStorage,
  computeStyleHashFromText,
  loadAnchorLibraryManifestByTarget,
  matchStoredAnchorEntryByIdentity,
  mergeStoredAnchorEntries,
  persistAnchorsToBrandLibrary,
  readPublishedAnchorEntries,
  reuseSourceAssetId,
  type StoredAnchorManifestEntry,
} from './tool-internals/anchor-library-store'

// Brand-styling helpers exposed to the API layer for the brand-card style
// preview: one LLM call produces the universal style paragraphs,
// the other restyles the preset reference frame.
export {
  generateBrandStyleFromWebsite,
  type WebsiteScrapeEvidence,
} from './tool-internals/generate-brand-style-from-website'
export { generateBrandStylePreviewImage } from './tool-internals/generate-brand-style-preview'
export { generateBrandStyling, toBrandDnaInput } from './tool-internals/generate-brand-styling'

// Workflow types (signal payloads, workflow params -- used by API layer)
export * from './consistency'
export type {
  BrandBankEditSignalPayload,
  BrandBriefSubmitSignalPayload,
  CancelQueuedItemSignalPayload,
  ConfirmBrandReviewSignalPayload,
  ContinueUipDraftSignalPayload,
  SavedBrandBriefParam,
  ScriptReviewUpdateSignalPayload,
  UipSessionWorkflowParams,
  UserMessageSignalPayload,
} from './workflow-types'
export { SHORTENED_SESSION_IDLE_TIMEOUT_MS } from './workflow-types'
