import { createSubLogger } from '@reelmakeeasy/common/logger'
import { isValidImageSizeTier } from '@reelmakeeasy/common/model-config/story-mode-generation-resolution-config.zod'
import { runSubstep, type SubstepReporter } from '@reelmakeeasy/common/utils/tool-step-timing'
import type { VoiceProfileGender } from '@shared/types/api/voice-profile'

import {
  createPlannerStorage,
  loadPlannerJsonArtifact,
  persistPlannerJsonArtifact,
} from '../persistence'
import {
  SharedArtifactBatchContext,
  withSharedArtifactResult,
} from '../runtime/shared-artifact-batch-context'
import { runAnchorAssetManagerCompletion } from '../tool-internals/anchor-asset-manager-completion'
import {
  buildAnchorAssetManagerPrompt,
  buildAnchorAssetsSummary,
  buildAnchorPromptSpecs,
  persistDerivedAnchorArtifacts,
  UIP_ANCHOR_FINAL_INDEX_PATH,
  UIP_ANCHOR_GENERATION_PROMPTS_PATH,
  UIP_ANCHOR_PROMPT_SPECS_PATH,
} from '../tool-internals/anchor-generation'
import { type AnchorImageResult, generateAnchorImages } from '../tool-internals/anchor-image-gen'
import { buildBrandStagedAssetMeta } from '../tool-internals/anchor-keep-raw-classifier'
import { ensureBrandLogoAnchor } from '../tool-internals/anchor-logo-guarantee'
import {
  buildDescriptionsById,
  buildUploadedById,
  collectTargetAnchorIds,
  dedupeCandidates,
  mergePersistedAnchorPlan,
  normalizeAnchorId,
  normalizeAnchorOperation,
  normalizeAnchorRequest,
  normalizeCoverageCandidate,
  normalizeSourceAssetIds,
  normalizeSourceUpdateMode,
  resolveFinalCandidates,
  UIP_ANCHOR_ASSET_PLAN_PATH,
} from '../tool-internals/anchor-plan'
import type { AnchorBusinessContext } from '../tool-internals/anchor-prompt-spec-builder'
import { isMultimodalImageMimeType, uploadedAssetToContent } from '../tool-internals/anchor-utils'
import { parseConversationContext } from '../tool-internals/conversation-context'
import {
  ensureWorldBible,
  getEffectiveStyleText,
} from '../tool-internals/generate-visual-script-full-scope-story-runtime'
import {
  buildVoiceCharacterText,
  loadVoiceCharacterArtifact,
} from '../tool-internals/voice-character-text'
import type {
  AnchorAssetCandidate,
  AnchorAssetPlanArtifact,
  AnchorAssetPromptSpecsArtifact,
  AnchorAssetsSummary,
  AnchorPlanUpdateRequest,
  AssetDescriptionsArtifact,
  PlannerAnchorRequest,
  PlannerToolParams,
  SessionState,
  UploadedAsset,
} from '../types'

// Re-export everything that external consumers import from this file
export type { AnchorImageResult } from '../tool-internals/anchor-image-gen'
export { UIP_ANCHOR_ASSET_PLAN_PATH } from '../tool-internals/anchor-plan'

const logger = createSubLogger('uip-planner-runtime:generate-anchor-assets')

// Phase A asset-manager only needs to *recognize* each upload (classify the
// passthrough category + bind source_asset_id), never reproduce it at full
// fidelity. Capping the long edge trims Gemini image tiles -> tokens ->
// latency on the single multimodal PRO call that fronts the anchor critical
// path (mirrors describe_uploaded_images / DESCRIBE_IMAGE_MAX_LONG_EDGE).
// The deterministic keep-raw classifier still backstops passthrough,
// so a downscaled image can't silently flip a logo/UI decision. Phase B
// (prompt-spec) and Phase C (image-gen) keep the full-res source.
const UIP_ANCHOR_ASSET_MANAGER_MAX_LONG_EDGE = 1536

const inflightCanonicalAnchorPlanBySession = new Map<
  string,
  Promise<{
    assetPlan: AnchorAssetPlanArtifact
    generationCandidates: AnchorAssetCandidate[]
    worldBible: unknown
  }>
>()
const inflightUpdatedAnchorPlanBySession = new Map<
  string,
  Promise<{
    assetPlan: AnchorAssetPlanArtifact
    generationCandidates: AnchorAssetCandidate[]
  }>
>()

export class MissingAnchorPlanError extends Error {
  constructor() {
    super('Missing persisted anchor plan')
    this.name = 'MissingAnchorPlanError'
  }
}

export class UnresolvedAnchorTargetsError extends Error {
  constructor(readonly anchorIds: string[]) {
    super(`Unresolved target anchors: ${anchorIds.join(', ')}`)
    this.name = 'UnresolvedAnchorTargetsError'
  }
}

export function buildAnchorPlanUpdateRequest(
  plannerParams: PlannerToolParams,
): AnchorPlanUpdateRequest | null {
  if (plannerParams.scope !== 'ANCHOR_IDS') {
    return null
  }

  const targetAnchorIds = [...collectTargetAnchorIds(plannerParams)].sort()
  const anchorRequestsById = new Map<string, PlannerAnchorRequest>()
  for (const request of plannerParams.anchor_requests ?? []) {
    const anchorId = normalizeAnchorId(request.anchor_id)
    if (!anchorId) {
      continue
    }
    const sourceAssetIds = normalizeSourceAssetIds({
      fallbackPrimary: request.source_asset_id,
      sourceAssetIds: request.source_asset_ids,
    })
    anchorRequestsById.set(anchorId, {
      anchor_id: anchorId,
      edit_instruction: request.edit_instruction?.trim() || null,
      label: request.label?.trim() || null,
      operation: normalizeAnchorOperation(request.operation),
      source_asset_id: sourceAssetIds[0] ?? null,
      source_asset_ids: sourceAssetIds,
      source_update_mode:
        sourceAssetIds.length > 0 ? normalizeSourceUpdateMode(request.source_update_mode) : null,
      type: request.type ?? null,
    })
  }

  const anchorRequests = [...anchorRequestsById.values()]
  anchorRequests.sort((left, right) => left.anchor_id.localeCompare(right.anchor_id))

  return {
    anchor_requests: anchorRequests,
    target_anchor_ids: targetAnchorIds,
  }
}

export function collectProvisionalAnchorPaths(results: AnchorImageResult[]): string[] {
  return results
    .filter(
      (result) =>
        result.status === 'success' &&
        Boolean(result.preview_asset_id) &&
        result.preview_relative_path?.startsWith('anchor_assets/final/') === true,
    )
    .map((result) => result.preview_relative_path)
    .filter((path): path is string => Boolean(path))
}

export async function commitAnchorRebuildMetadata(params: {
  backupPath: string
  commit: () => Promise<void>
  paths: string[]
  storage: ReturnType<typeof createPlannerStorage>
}): Promise<void> {
  const snapshots = await Promise.all(
    params.paths.map(async (path) => ({
      path,
      value: (await params.storage.exists(path))
        ? await params.storage.readJsonFile<unknown>(path)
        : null,
    })),
  )
  await params.storage.writeJsonFile(params.backupPath, { snapshots })
  try {
    await params.commit()
  } catch (error) {
    const restorations = await Promise.allSettled(
      snapshots.map(({ path, value }) =>
        value === null
          ? params.storage.deleteFile(path)
          : params.storage.writeJsonFile(path, value),
      ),
    )
    const failedPaths = restorations
      .map((result, index) => (result.status === 'rejected' ? snapshots[index]?.path : null))
      .filter((path): path is string => Boolean(path))
    if (failedPaths.length > 0) {
      throw new Error(
        `Anchor metadata rollback failed for ${failedPaths.join(', ')}; recovery snapshot retained at ${params.backupPath}. Original error: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    await params.storage.deleteFile(params.backupPath).catch(() => undefined)
    throw error
  }
  await params.storage.deleteFile(params.backupPath).catch(() => undefined)
}

export async function ensureCanonicalAnchorPlan(params: {
  assetDescriptions: AssetDescriptionsArtifact
  conversationContext: string
  params: PlannerToolParams
  script: string
  session: SessionState
  sharedBatchContext?: null | SharedArtifactBatchContext
  uploadedAssets: UploadedAsset[]
  voiceCharacterText?: string
  worldBibleAssetDescriptionsJson: string
}): Promise<{
  assetPlan: AnchorAssetPlanArtifact
  generationCandidates: AnchorAssetCandidate[]
  worldBible: unknown
}> {
  const forceFresh = params.sharedBatchContext?.forceFreshAnchorPlan === true
  const inflight = inflightCanonicalAnchorPlanBySession.get(params.session.sessionId)
  if (inflight) {
    return inflight
  }

  const persistedPlan = forceFresh ? null : await loadCurrentAnchorPlan(params.session)
  if (persistedPlan) {
    params.sharedBatchContext?.resolved.set('canonical_anchor_plan', {
      assetPlan: persistedPlan,
      generationCandidates: persistedPlan.candidates,
      worldBible: null,
    })
    return {
      assetPlan: persistedPlan,
      generationCandidates: persistedPlan.candidates,
      worldBible: null,
    }
  }

  return withSharedArtifactResult(
    params.sharedBatchContext ?? null,
    'canonical_anchor_plan',
    async () => {
      const task = buildAnchorAssetPlanInternal({ ...params, persistPlan: !forceFresh })
      inflightCanonicalAnchorPlanBySession.set(params.session.sessionId, task)
      try {
        const result = await task
        if (!forceFresh) {
          params.session.cached_artifacts.anchor_plan = result.assetPlan
        }
        return result
      } finally {
        inflightCanonicalAnchorPlanBySession.delete(params.session.sessionId)
      }
    },
  )
}

export async function ensureUpdatedAnchorPlan(params: {
  assetDescriptions: AssetDescriptionsArtifact
  request: AnchorPlanUpdateRequest | null
  session: SessionState
  sharedBatchContext?: null | SharedArtifactBatchContext
  uploadedAssets: UploadedAsset[]
}): Promise<{
  assetPlan: AnchorAssetPlanArtifact
  generationCandidates: AnchorAssetCandidate[]
}> {
  const requestSignature = JSON.stringify(
    params.request ?? { anchor_requests: [], target_anchor_ids: [] },
  )
  const batchKey = `updated_anchor_plan::${requestSignature}`
  const inflightKey = `${params.session.sessionId}:${requestSignature}`
  const inflight = inflightUpdatedAnchorPlanBySession.get(inflightKey)
  if (inflight) {
    return inflight
  }

  return withSharedArtifactResult(params.sharedBatchContext ?? null, batchKey, async () => {
    const task = applyAnchorPlanUpdateRequestInternal(params)
    inflightUpdatedAnchorPlanBySession.set(inflightKey, task)
    try {
      const result = await task
      params.session.cached_artifacts.anchor_plan = result.assetPlan
      return result
    } finally {
      inflightUpdatedAnchorPlanBySession.delete(inflightKey)
    }
  })
}

export async function generateAnchorAssets(params: {
  assetDescriptions: AssetDescriptionsArtifact
  conversationContext: string
  onPlanReady?: () => Promise<void>
  params: PlannerToolParams
  /**
   * Optional UIP-v2 substep progress reporter. When present, the phase
   * awaits report `running`/`done` for the subTools display. Absent
   * (tests, legacy callers) = no reporting, no behavioral change.
   */
  reportSubstep?: SubstepReporter
  script: string
  session: SessionState
  sharedBatchContext?: null | SharedArtifactBatchContext
  uploadedAssets: UploadedAsset[]
  worldBibleAssetDescriptionsJson: string
}): Promise<{
  assetPlan: AnchorAssetPlanArtifact
  promptSpecs: AnchorAssetPromptSpecsArtifact
  summary: AnchorAssetsSummary
}> {
  const storage = createPlannerStorage(params.session.sessionId)
  const isAtomicFullRebuild = params.sharedBatchContext?.forceFreshAnchorPlan === true
  const effectiveStyleText = getEffectiveStyleText(params.session)
  // Snapshot taken at session creation; when imageModel is present the
  // anchor generator routes through the selected-model orchestrator.
  const imageModel = params.session.imageModel
  const orgId = params.session.orgId
  // Image size tier snapshot; validated server-side at creation.
  const imageSizeTier = isValidImageSizeTier(params.session.generationResolution?.imageSize)
    ? params.session.generationResolution?.imageSize
    : undefined
  const { gender: voiceGender, text: voiceCharacterText } = await resolveVoiceCharacter(
    params.session,
  )
  const anchorPlanUpdateRequest =
    params.session.cached_artifacts.pending_anchor_plan_update_request ??
    buildAnchorPlanUpdateRequest(params.params)
  let assetPlan: AnchorAssetPlanArtifact
  let generationCandidates: AnchorAssetCandidate[]
  let worldBible: unknown

  if (params.params.scope === 'FULL') {
    const anchorPlanResult = await runSubstep(params.reportSubstep, 'anchor_plan_llm', () =>
      ensureCanonicalAnchorPlan({ ...params, voiceCharacterText }),
    )
    assetPlan = anchorPlanResult.assetPlan
    generationCandidates = anchorPlanResult.generationCandidates
    worldBible = anchorPlanResult.worldBible
  } else {
    const anchorPlanResult = await runSubstep(params.reportSubstep, 'anchor_plan_llm', () =>
      ensureUpdatedAnchorPlan({
        assetDescriptions: params.assetDescriptions,
        request: anchorPlanUpdateRequest,
        session: params.session,
        sharedBatchContext: params.sharedBatchContext,
        uploadedAssets: params.uploadedAssets,
      }),
    )
    assetPlan = anchorPlanResult.assetPlan
    generationCandidates = anchorPlanResult.generationCandidates
    worldBible = await ensureWorldBible({
      session: params.session,
      script: params.script,
      assetDescriptionsJson: params.worldBibleAssetDescriptionsJson,
      sharedBatchContext: params.sharedBatchContext,
    })
  }
  await params.onPlanReady?.()

  const descriptionsById = buildDescriptionsById(params.assetDescriptions)
  const uploadedById = buildUploadedById(params.uploadedAssets)

  const promptSpecs = await runSubstep(params.reportSubstep, 'prompt_specs', () =>
    buildAnchorPromptSpecs({
      brandStagedAssetMeta: buildBrandStagedAssetMeta(
        params.session.spec.global_constraints.brand_bank,
      ),
      businessContext: buildAnchorBusinessContext(params.session.spec.global_constraints),
      candidates: generationCandidates,
      descriptionsById,
      modelSelectorTier: params.session.modelSelectorTier,
      effectiveStyleText,
      existingSummary: params.session.cached_artifacts.anchor_assets_summary ?? null,
      planCandidates: assetPlan.candidates,
      plannerParams: params.params,
      sessionId: params.session.sessionId,
      storage,
      uploadedById,
      voiceCharacterText,
      voiceGender,
      worldBible,
      persist: !isAtomicFullRebuild,
    }),
  )
  const generationResults = await runSubstep(params.reportSubstep, 'image_gen', () =>
    generateAnchorImages({
      effectiveStyleText,
      imageModel,
      imageSizeTier,
      orgId,
      promptSpecs,
      sessionId: params.session.sessionId,
      storage,
      uploadedById,
    }),
  )
  const summary = buildAnchorAssetsSummary({
    candidates: assetPlan.candidates,
    existingSummary: isAtomicFullRebuild
      ? null
      : (params.session.cached_artifacts.anchor_assets_summary ?? null),
    generationResults,
  })
  const hasFailures = summary.anchors?.some((anchor) => anchor.status === 'failed') ?? false
  if (isAtomicFullRebuild) {
    if (params.sharedBatchContext) {
      const provisionalPaths = collectProvisionalAnchorPaths(generationResults)
      params.sharedBatchContext.rollbackAnchorRebuild = async () => {
        await Promise.all(provisionalPaths.map((path) => storage.deleteFile(path)))
      }
    }
    if (!hasFailures && params.sharedBatchContext) {
      // Provisional in-memory state is visible to the batch output only. The
      // canonical objects are committed after the VS arm succeeds too.
      params.session.cached_artifacts.anchor_plan = assetPlan
      params.session.cached_artifacts.anchor_assets_summary = summary
      params.sharedBatchContext.deferredAnchorCommit = async () => {
        const paths = [
          UIP_ANCHOR_PROMPT_SPECS_PATH,
          UIP_ANCHOR_GENERATION_PROMPTS_PATH,
          UIP_ANCHOR_FINAL_INDEX_PATH,
          UIP_ANCHOR_ASSET_PLAN_PATH,
        ]
        const backupPath = `anchor_assets/rebuild_backups/${assetPlan.generated_at.replace(/[^a-zA-Z0-9_-]/g, '-')}/canonical-metadata.json`
        await commitAnchorRebuildMetadata({
          backupPath,
          commit: async () => {
            await persistDerivedAnchorArtifacts({
              assetPlan,
              promptSpecs,
              sessionId: params.session.sessionId,
              storage,
              summary,
            })
            // The plan is the canonical commit point and is deliberately last.
            await persistPlannerJsonArtifact(
              params.session.sessionId,
              UIP_ANCHOR_ASSET_PLAN_PATH,
              assetPlan,
            )
          },
          paths,
          storage,
        })
        recordAbsorbedUploadIds(params.session, collectAnchorSourceAssetIds(assetPlan.candidates))
      }
    }
  } else {
    await persistDerivedAnchorArtifacts({
      assetPlan,
      promptSpecs,
      sessionId: params.session.sessionId,
      storage,
      summary,
    })
  }

  return { assetPlan, promptSpecs, summary }
}

export function getUnresolvedTargetAnchorIds(
  plannerParams: PlannerToolParams,
  candidates: AnchorAssetCandidate[],
): string[] {
  if (plannerParams.scope !== 'ANCHOR_IDS') {
    return []
  }

  const resolvedIds = new Set(candidates.map((candidate) => normalizeAnchorId(candidate.anchor_id)))
  return [...collectTargetAnchorIds(plannerParams)].filter((targetId) => !resolvedIds.has(targetId))
}

export async function loadCurrentAnchorPlan(
  session: SessionState,
): Promise<AnchorAssetPlanArtifact | null> {
  if (session.cached_artifacts.anchor_plan) {
    return session.cached_artifacts.anchor_plan
  }

  const persistedPlan = await loadPlannerJsonArtifact<AnchorAssetPlanArtifact>(
    session.sessionId,
    UIP_ANCHOR_ASSET_PLAN_PATH,
  )
  if (persistedPlan) {
    session.cached_artifacts.anchor_plan = persistedPlan
  }
  return persistedPlan
}

async function applyAnchorPlanUpdateRequestInternal(params: {
  assetDescriptions: AssetDescriptionsArtifact
  request: AnchorPlanUpdateRequest | null
  session: SessionState
  uploadedAssets: UploadedAsset[]
}): Promise<{
  assetPlan: AnchorAssetPlanArtifact
  generationCandidates: AnchorAssetCandidate[]
}> {
  const currentPlan = await loadCurrentAnchorPlan(params.session)
  if (!currentPlan) {
    throw new MissingAnchorPlanError()
  }

  if (!params.request || params.request.target_anchor_ids.length === 0) {
    return {
      assetPlan: currentPlan,
      generationCandidates: [],
    }
  }

  const descriptionsById = buildDescriptionsById(params.assetDescriptions)
  const uploadedById = buildUploadedById(params.uploadedAssets)
  const targetIds = new Set(
    params.request.target_anchor_ids.map((value) => normalizeAnchorId(value)),
  )
  const byId = new Map(
    currentPlan.candidates.map(
      (candidate) =>
        [
          candidate.anchor_id,
          normalizeCoverageCandidate(candidate, descriptionsById, uploadedById),
        ] as const,
    ),
  )
  const removedTargetIds = new Set<string>()

  for (const request of params.request.anchor_requests) {
    const normalizedRequestAnchorId = normalizeAnchorId(request.anchor_id)
    if (normalizeAnchorOperation(request.operation) === 'REMOVE_ANCHOR') {
      removedTargetIds.add(normalizedRequestAnchorId)
      if (byId.has(normalizedRequestAnchorId)) {
        byId.delete(normalizedRequestAnchorId)
      }
      continue
    }

    const normalized = normalizeAnchorRequest(
      request,
      byId.get(normalizedRequestAnchorId) ?? null,
      descriptionsById,
      uploadedById,
    )
    if (normalized) {
      byId.set(normalized.anchor_id, normalized)
    }
  }

  const generationCandidates = [...targetIds]
    .map((targetId) => byId.get(targetId) ?? null)
    .filter((candidate): candidate is AnchorAssetCandidate => Boolean(candidate))
  const unresolvedTargetAnchorIds = [...targetIds].filter(
    (targetId) => !byId.has(targetId) && !removedTargetIds.has(targetId),
  )
  if (unresolvedTargetAnchorIds.length > 0) {
    throw new UnresolvedAnchorTargetsError(unresolvedTargetAnchorIds)
  }

  const nextPlan: AnchorAssetPlanArtifact = {
    generated_at: new Date().toISOString(),
    candidates: dedupeCandidates([...byId.values()]),
  }
  await persistPlannerJsonArtifact(params.session.sessionId, UIP_ANCHOR_ASSET_PLAN_PATH, nextPlan)
  // Capture both currentPlan source ids (which may include sources about
  // to be dropped by REPLACE) and nextPlan source ids; once an upload is
  // absorbed, it stays "absorbed" for VS-prompt filtering even if a
  // later REPLACE removes it from the candidate. See
  // `excludeCanonicalizedAnchorSourceAssets`.
  recordAbsorbedUploadIds(params.session, [
    ...collectAnchorSourceAssetIds(currentPlan.candidates),
    ...collectAnchorSourceAssetIds(nextPlan.candidates),
  ])

  return {
    assetPlan: nextPlan,
    generationCandidates,
  }
}

async function buildAnchorAssetPlanInternal(params: {
  assetDescriptions: AssetDescriptionsArtifact
  conversationContext: string
  params: PlannerToolParams
  persistPlan?: boolean
  script: string
  session: SessionState
  sharedBatchContext?: null | SharedArtifactBatchContext
  uploadedAssets: UploadedAsset[]
  voiceCharacterText?: string
  worldBibleAssetDescriptionsJson: string
}): Promise<{
  assetPlan: AnchorAssetPlanArtifact
  generationCandidates: AnchorAssetCandidate[]
  worldBible: unknown
}> {
  const storage = createPlannerStorage(params.session.sessionId)
  const parsedContext = parseConversationContext(params.conversationContext)
  const worldBible = await ensureWorldBible({
    session: params.session,
    script: params.script,
    assetDescriptionsJson: params.worldBibleAssetDescriptionsJson,
    sharedBatchContext: params.sharedBatchContext,
  })
  // Filter non-raster MIMEs (SVG, FALLBACK) BEFORE building the prompt.
  // The prompt's "Attached Uploaded Images" block tells the LLM the image
  // contents are in the exact same order as Uploaded Assets JSON, so if we
  // dropped images from the multimodal payload but kept the entries in the
  // JSON list, indices would shift and the LLM's asset_id <-> image match
  // would break. Brand-extracted SVG asset_ids still surface via the
  // BRAND CONCEPT REFERENCES section (built from `brandBank` independently
  // of `uploadedAssets`), so the anchor planner can still pick them as
  // source_asset_id.
  const multimodalAssets = params.uploadedAssets.filter((asset) =>
    isMultimodalImageMimeType(asset.content_type),
  )
  if (multimodalAssets.length < params.uploadedAssets.length) {
    logger.info(
      `[uip-anchor-asset-manager] skipped non-raster assets from multimodal input total=${params.uploadedAssets.length} kept=${multimodalAssets.length}`,
    )
  }
  const assetManagerPrompt = buildAnchorAssetManagerPrompt({
    articleContext: params.session.bootstrap?.article_context ?? null,
    assetDescriptions: params.assetDescriptions,
    brandBank: params.session.spec.global_constraints.brand_bank,
    directives: params.session.spec.global_constraints.directives,
    latestUserMessage: parsedContext.latestUserMessage,
    mustNotViolate: params.session.spec.global_constraints.must_not_violate,
    pinnedRawUserPrompt: parsedContext.pinnedRawUserPrompt,
    script: params.script,
    uploadedAssets: multimodalAssets,
    voiceCharacterText: params.voiceCharacterText,
    worldBible,
  })
  const assetManagerContents = await Promise.all(
    multimodalAssets.map((asset) =>
      uploadedAssetToContent(asset, storage, {
        maxLongEdge: UIP_ANCHOR_ASSET_MANAGER_MAX_LONG_EDGE,
      }),
    ),
  )

  const assetManagerOutput = await runAnchorAssetManagerCompletion({
    assetManagerContents,
    assetManagerPrompt,
    modelSelectorTier: params.session.modelSelectorTier,
    sessionId: params.session.sessionId,
  })

  const descriptionsById = buildDescriptionsById(params.assetDescriptions)
  const uploadedById = buildUploadedById(params.uploadedAssets)
  const resolvedCandidates = await resolveFinalCandidates({
    // Lets the plan layer compute the same deterministic keep-raw
    // verdict Phase B does, so the PERSISTED `passthrough` is complete before
    // the `prompt_transform` guard is checked against it.
    brandBank: params.session.spec.global_constraints.brand_bank,
    descriptionsById,
    plannerParams: params.params,
    rawAnchors: assetManagerOutput.anchors,
    sessionId: params.session.sessionId,
    uploadedById,
  })
  // Guarantee a surviving brand logo is bound, even when the LLM created no
  // brand-identity anchor. Skip on targeted (ANCHOR_IDS) re-generation so it
  // never injects an unrelated anchor into a scoped request.
  const finalCandidates =
    params.params.scope === 'ANCHOR_IDS'
      ? resolvedCandidates
      : ensureBrandLogoAnchor({
          brandBank: params.session.spec.global_constraints.brand_bank,
          candidates: resolvedCandidates,
          descriptionsById,
          uploadedById,
        })
  const unresolvedTargetAnchorIds = getUnresolvedTargetAnchorIds(params.params, finalCandidates)
  if (unresolvedTargetAnchorIds.length > 0) {
    throw new UnresolvedAnchorTargetsError(unresolvedTargetAnchorIds)
  }

  const assetPlan: AnchorAssetPlanArtifact = {
    generated_at: new Date().toISOString(),
    candidates:
      params.params.scope === 'ANCHOR_IDS'
        ? await mergePersistedAnchorPlan(params.session.sessionId, finalCandidates)
        : finalCandidates,
  }
  if (params.persistPlan !== false) {
    await persistPlannerJsonArtifact(
      params.session.sessionId,
      UIP_ANCHOR_ASSET_PLAN_PATH,
      assetPlan,
    )
    params.session.cached_artifacts.anchor_plan = assetPlan
    recordAbsorbedUploadIds(params.session, collectAnchorSourceAssetIds(assetPlan.candidates))
  }

  return { assetPlan, generationCandidates: finalCandidates, worldBible }
}

// Project facts handed to the no-source anchor branch so an invented
// text-bearing prop (flyer, sign, label) can source its copy instead of
// inventing it. Every field is optional and empty ones are dropped
// downstream, so a brief with no brand bank keeps prompts byte-identical.
function buildAnchorBusinessContext(
  globalConstraints: SessionState['spec']['global_constraints'],
): AnchorBusinessContext {
  const basicInfo = globalConstraints.brand_bank?.basic_info
  return {
    aboutUs: basicInfo?.about_us_summary ?? null,
    // Only the extracted business_name is copy-eligible. brand_scope is a
    // planning scalar that can hold an industry or a literal "none", and
    // Business Context is quoted verbatim onto props, so a generic scope
    // would end up printed on a flyer as if it were the company.
    businessName: basicInfo?.business_name || null,
    keyEntities: globalConstraints.key_entities,
    targetAudience: globalConstraints.target_audience || null,
    topic: globalConstraints.topic || null,
  }
}

function collectAnchorSourceAssetIds(candidates: AnchorAssetCandidate[]): string[] {
  return candidates.flatMap((candidate) => {
    const ids = candidate.source_asset_ids?.length
      ? candidate.source_asset_ids
      : [candidate.source_asset_id]
    return ids.map((id) => id?.trim()).filter((id): id is string => Boolean(id))
  })
}

function recordAbsorbedUploadIds(session: SessionState, newlyAbsorbed: string[]): void {
  if (newlyAbsorbed.length === 0 && session.cached_artifacts.absorbed_upload_ids) {
    return
  }
  const merged = new Set(session.cached_artifacts.absorbed_upload_ids ?? [])
  for (const id of newlyAbsorbed) {
    if (id) {
      merged.add(id)
    }
  }
  session.cached_artifacts.absorbed_upload_ids = [...merged]
}

/**
 * Resolve voice character text for anchor generation injection.
 *
 * Audio mode (session.audioPath set): prefer the rich LLM-generated
 * description from `long_take/voice_character.json` written by the
 * pre-voiceover workflow's voice character analysis stage. The file
 * also includes a structured `voice_profile` we pass through for
 * fallback rendering when the LLM string is empty (defensive).
 *
 * In audio mode the audio-derived profile is authoritative. If it can't
 * be loaded, we return nothing rather than falling back to
 * `session.voiceProfile`: that field is a preset/clone seeded at session
 * creation, not this audio, so its gender must never override the
 * brief-derived `subject_gender` for char_singer.
 *
 * Non-audio mode: render from `session.voiceProfile`, which the API
 * service populated from `project.voiceOverJson.voiceProfile` at
 * session creation (preset metadata / temp-clone / saved-clone path).
 *
 * Returns `undefined`/empty when no authoritative source yields content --
 * callers skip injection and the prompt builders preserve their
 * pre-existing behavior.
 */
/** @internal exported for the audio-mode gender-source test. */
export async function resolveVoiceCharacter(
  session: SessionState,
): Promise<{ gender?: VoiceProfileGender; text?: string }> {
  if (session.audioPath) {
    let artifact: Awaited<ReturnType<typeof loadVoiceCharacterArtifact>> = null
    try {
      artifact = await loadVoiceCharacterArtifact(session.sessionId)
    } catch (err) {
      // Do NOT swallow this silently. A lost read here used to fall through to the
      // preset `session.voiceProfile` below and hand char_singer the WRONG gender
      // (observed: a female voice preset overrode a brief that explicitly asked
      // for a man, so the male artist rendered female).
      // The silent .catch was also why the failure left no trace in logs.
      logger.warn(
        { err: err instanceof Error ? err.message : String(err), projectId: session.sessionId },
        '[uip-anchor] voice_character.json load failed in audio mode; not falling back to a preset voice profile',
      )
    }
    if (artifact) {
      return {
        gender: artifact.voice_profile?.perceivedGender,
        text: buildVoiceCharacterText({
          source: 'audio',
          audioVoiceCharacter: artifact.voice_character,
          voiceProfile: artifact.voice_profile,
        }),
      }
    }
    // Audio mode, audio-derived profile unavailable. `session.voiceProfile` is a
    // preset/clone the API seeded at session creation -- NOT this audio -- so it must
    // NOT supply gender (or a stale description) here: that override is exactly what
    // turned the qp7 artist female. Inject nothing; `resolveAnchorGender` then falls
    // back to the asset plan's `subject_gender` (the user's brief), never a preset.
    return {}
  }
  if (session.voiceProfile) {
    return {
      gender: session.voiceProfile.perceivedGender,
      text: buildVoiceCharacterText({
        source: 'profile',
        voiceProfile: session.voiceProfile,
      }),
    }
  }
  return {}
}
