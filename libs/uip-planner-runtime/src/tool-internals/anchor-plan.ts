import { createSubLogger } from '@reelmakeeasy/common/logger'
import type { VoiceProfileGender } from '@shared/types/api/voice-profile'

import { loadPlannerJsonArtifact } from '../persistence'
import type {
  AnchorAssetCandidate,
  AnchorAssetPlanArtifact,
  AssetDescriptionsArtifact,
  BrandBank,
  PlannerAnchorOperation,
  PlannerAnchorRequest,
  PlannerAnchorSourceUpdateMode,
  PlannerToolParams,
  UploadedAsset,
} from '../types'

import { buildBrandStagedAssetMeta, classifyKeepRawAssetIds } from './anchor-keep-raw-classifier'

const logger = createSubLogger('user-intent-planner')

const UIP_ANCHOR_ASSETS_DIR = 'anchor_assets'
export const UIP_ANCHOR_ASSET_PLAN_PATH = `${UIP_ANCHOR_ASSETS_DIR}/asset_plan.json`

export type DescriptionsById = Map<string, AssetDescriptionItem>
export type UploadedById = Map<string, UploadedAsset>
type AssetDescriptionItem = AssetDescriptionsArtifact['items'][number]

export function baseCandidateSourceAssetIds(baseCandidate: AnchorAssetCandidate | null): string[] {
  if (!baseCandidate) {
    return []
  }

  return normalizeSourceAssetIds({
    fallbackPrimary: baseCandidate.source_asset_id,
    sourceAssetIds: baseCandidate.source_asset_ids,
  })
}

export function buildDescriptionsById(
  assetDescriptions: AssetDescriptionsArtifact,
): DescriptionsById {
  return new Map(assetDescriptions.items.map((item) => [item.asset_id, item] as const))
}

export function buildUploadedById(uploadedAssets: UploadedAsset[]): UploadedById {
  return new Map(uploadedAssets.map((asset) => [asset.asset_id, asset] as const))
}

export function collectTargetAnchorIds(plannerParams: PlannerToolParams): Set<string> {
  const targetIds = new Set(
    (plannerParams.anchor_ids ?? []).map((value) => normalizeAnchorId(value)).filter(Boolean),
  )
  for (const request of plannerParams.anchor_requests ?? []) {
    const anchorId = normalizeAnchorId(request.anchor_id)
    if (anchorId) {
      targetIds.add(anchorId)
    }
  }
  return targetIds
}

/**
 * Deterministic, code-owned accumulation of anchor edit instructions.
 * Seeds from the base candidate's history (falling back to its single
 * `edit_instruction` for pre-history candidates), appends the newly
 * requested instruction unless it exactly repeats the last one, and
 * starts fresh when the anchor's source image is rebound (the old
 * appearance deltas no longer apply to a new source). Oldest first.
 */
export function computeAnchorEditHistory(params: {
  baseCandidate: AnchorAssetCandidate | null
  requestedEditInstruction: null | string
  sourceRebound: boolean
}): string[] {
  const history = params.sourceRebound
    ? []
    : params.baseCandidate?.edit_instructions?.length
      ? [...params.baseCandidate.edit_instructions]
      : params.baseCandidate?.edit_instruction
        ? [params.baseCandidate.edit_instruction]
        : []
  if (params.requestedEditInstruction && history.at(-1) !== params.requestedEditInstruction) {
    history.push(params.requestedEditInstruction)
  }
  return history
}

export function dedupeCandidates(candidates: AnchorAssetCandidate[]): AnchorAssetCandidate[] {
  const dedupedCandidates = new Map<string, AnchorAssetCandidate>()
  for (const candidate of candidates) {
    dedupedCandidates.set(candidate.anchor_id, candidate)
  }
  return [...dedupedCandidates.values()]
}

export async function mergePersistedAnchorPlan(
  sessionId: string,
  nextCandidates: AnchorAssetCandidate[],
): Promise<AnchorAssetCandidate[]> {
  const persistedPlan = await loadPlannerJsonArtifact<AnchorAssetPlanArtifact>(
    sessionId,
    UIP_ANCHOR_ASSET_PLAN_PATH,
  )
  const mergedById = new Map(
    (persistedPlan?.candidates ?? []).map((candidate) => [candidate.anchor_id, candidate] as const),
  )
  for (const candidate of nextCandidates) {
    mergedById.set(candidate.anchor_id, candidate)
  }
  return dedupeCandidates([...mergedById.values()])
}

export function mergeSourceAssetIds(params: {
  explicitPrimary: null | string
  nextIds: string[]
  previousIds: string[]
}): string[] {
  const ordered = new Set<string>()
  const merged: string[] = []

  const primary = params.explicitPrimary?.trim() || null
  if (primary && (params.previousIds.includes(primary) || params.nextIds.includes(primary))) {
    ordered.add(primary)
    merged.push(primary)
  }

  for (const assetId of [...params.previousIds, ...params.nextIds]) {
    if (!assetId || ordered.has(assetId)) {
      continue
    }
    ordered.add(assetId)
    merged.push(assetId)
  }

  return merged
}

export async function mergeTargetedAnchorCandidates(params: {
  candidates: AnchorAssetCandidate[]
  descriptionsById: DescriptionsById
  sessionId: string
  targetIds: Set<string>
  uploadedById: UploadedById
}): Promise<AnchorAssetCandidate[]> {
  const persistedPlan = await loadPlannerJsonArtifact<AnchorAssetPlanArtifact>(
    params.sessionId,
    UIP_ANCHOR_ASSET_PLAN_PATH,
  )
  const persistedById = new Map(
    (persistedPlan?.candidates ?? []).map((candidate) => [candidate.anchor_id, candidate] as const),
  )
  const mergedCandidates = [...params.candidates]

  for (const targetId of params.targetIds) {
    const existingCandidate = persistedById.get(targetId)
    if (!existingCandidate) {
      continue
    }

    const alreadySelected = mergedCandidates.some((candidate) => candidate.anchor_id === targetId)
    if (!alreadySelected) {
      mergedCandidates.push(
        normalizeCoverageCandidate(existingCandidate, params.descriptionsById, params.uploadedById),
      )
    }
  }

  return mergedCandidates.filter((candidate) => params.targetIds.has(candidate.anchor_id))
}

export function normalizeAnchorId(value: string): string {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '') || 'anchor_asset'
  )
}

export function normalizeAnchorOperation(
  value: null | PlannerAnchorOperation | string | undefined,
): PlannerAnchorOperation {
  return value === 'REMOVE_ANCHOR' ? 'REMOVE_ANCHOR' : 'UPSERT'
}

export function normalizeAnchorRequest(
  request: PlannerAnchorRequest,
  baseCandidate: AnchorAssetCandidate | null,
  descriptionsById: DescriptionsById,
  uploadedById: UploadedById,
): AnchorAssetCandidate | null {
  const anchorId = normalizeAnchorId(request.anchor_id)
  if (!anchorId) {
    return null
  }

  if (normalizeAnchorOperation(request.operation) === 'REMOVE_ANCHOR') {
    return null
  }

  const requestedSourceAssetId = request.source_asset_id?.trim() || null
  const normalizedRequestedSourceAssetIds = normalizeSourceAssetIds({
    fallbackPrimary: requestedSourceAssetId,
    sourceAssetIds: request.source_asset_ids,
  })
  const validRequestedSourceAssetIds = normalizedRequestedSourceAssetIds.filter(
    (sourceAssetId) => descriptionsById.has(sourceAssetId) && uploadedById.has(sourceAssetId),
  )
  const hasRequestedSource = validRequestedSourceAssetIds.length > 0
  const sourceUpdateMode = hasRequestedSource
    ? normalizeSourceUpdateMode(request.source_update_mode)
    : null
  const requestedEditInstruction = request.edit_instruction?.trim() || null
  const requestedLabel = request.label?.trim() || null
  const requestedType = request.type ?? null
  const hasRequestedMetadata = Boolean(requestedLabel || requestedType || requestedEditInstruction)

  if (
    baseCandidate &&
    !requestedSourceAssetId &&
    !request.source_asset_ids?.length &&
    !hasRequestedMetadata
  ) {
    return baseCandidate
  }

  if (!baseCandidate && !hasRequestedSource && !requestedLabel && !requestedType) {
    return null
  }

  const mergedSourceAssetIds = resolveNextSourceAssetIds({
    baseCandidate,
    requestedSourceAssetId,
    requestedSourceAssetIds: validRequestedSourceAssetIds,
    sourceUpdateMode,
  })
  const sourceRebound =
    hasRequestedSource && mergedSourceAssetIds[0] !== baseCandidate?.source_asset_id
  const editHistory = computeAnchorEditHistory({
    baseCandidate,
    requestedEditInstruction,
    sourceRebound,
  })
  const nextLabel = requestedLabel || baseCandidate?.label || prettifyAnchorId(anchorId)
  return {
    anchor_id: anchorId,
    edit_instruction: editHistory.at(-1) ?? null,
    edit_instructions: editHistory,
    // Rich metadata fields are Plan-LLM-derived, NOT planner-patchable:
    // preserve base values on UPSERT; seed sensible defaults for brand-
    // new anchor_ids that the planner creates via anchor_requests.
    is_multi_angle: baseCandidate?.is_multi_angle ?? false,
    keyword: baseCandidate?.keyword || nextLabel,
    label: nextLabel,
    passthrough: baseCandidate?.passthrough ?? false,
    // Deliberately NOT reset on sourceRebound, unlike `edit_instructions`
    // above. Rebinding which photo of Sam we use does not retract "make him
    // a pirate" -- the transform came from the pinned prompt, not from an
    // appearance delta against a particular source image.
    prompt_transform: baseCandidate?.prompt_transform ?? null,
    proper_name: baseCandidate?.proper_name ?? null,
    reason: baseCandidate?.reason || 'Explicitly requested by the user for anchor usage.',
    source_asset_id: mergedSourceAssetIds[0] ?? null,
    source_asset_ids: mergedSourceAssetIds,
    subject_gender: baseCandidate?.subject_gender ?? 'unknown',
    type: requestedType ?? baseCandidate?.type ?? 'OBJECT',
    visual_reference: baseCandidate?.visual_reference ?? '',
    visual_tag: baseCandidate?.visual_tag ?? '',
  }
}

export function normalizeCoverageCandidate(
  candidate: AnchorAssetCandidate,
  descriptionsById: DescriptionsById,
  uploadedById: UploadedById,
  // The deterministic keep-raw verdict, which
  // until now ran ONLY on the transient generation array
  // (`buildAnchorPromptSpecs`), leaving the PERSISTED `passthrough` incomplete.
  // `classifyKeepRawAssetIds` is pure and its inputs already live here, so
  // folding it in makes the persisted verdict complete -- which is what the
  // `prompt_transform` guard in `resolveFinalCandidates` is checked against.
  // Optional: callers renormalizing an already-persisted plan pass nothing and
  // keep the stored verdict.
  keepRawAssetIds?: ReadonlySet<string>,
): AnchorAssetCandidate {
  const validSourceAssetIds = normalizeSourceAssetIds({
    fallbackPrimary: candidate.source_asset_id,
    sourceAssetIds: candidate.source_asset_ids,
  }).filter(
    (sourceAssetId) => descriptionsById.has(sourceAssetId) && uploadedById.has(sourceAssetId),
  )
  const primarySourceAssetId = validSourceAssetIds[0] ?? null
  const hasValidSource = validSourceAssetIds.length > 0

  // Mirror story-mode's filename heuristic (storage.ts `isLogoAssetShortname`):
  // any source asset whose file_name starts with "Logo image" was uploaded via
  // the "Add logo" UX slot and should be passed through as-is (no Nano Banana,
  // no style transfer). This is a UX contract: the slot assignment IS the intent
  // signal, regardless of what the Plan-LLM decided about visual content.
  const isLogoByFilename = validSourceAssetIds.some((id) => {
    const asset = uploadedById.get(id)
    return asset?.file_name?.toLowerCase().startsWith('logo image')
  })

  // Deterministic keep-raw. Keyed on `source_asset_id` exactly as
  // `shouldForceRaw` does downstream, so the persisted verdict agrees with the
  // bytes Phase C would actually copy.
  const isKeepRawSource = Boolean(
    primarySourceAssetId && keepRawAssetIds?.has(primarySourceAssetId),
  )

  // Enforce passthrough invariants: passthrough is only safe when the
  // anchor has exactly one valid source. If planning attempts to mark a
  // source-less or multi-source anchor as passthrough, downgrade it.
  const effectivePassthrough =
    (candidate.passthrough || isLogoByFilename || isKeepRawSource) &&
    hasValidSource &&
    validSourceAssetIds.length === 1

  const coverageEditHistory = candidate.edit_instructions?.length
    ? candidate.edit_instructions.map((entry) => entry.trim()).filter(Boolean)
    : candidate.edit_instruction?.trim()
      ? [candidate.edit_instruction.trim()]
      : []
  return {
    anchor_id: normalizeAnchorId(candidate.anchor_id || candidate.label),
    edit_instruction: coverageEditHistory.at(-1) ?? null,
    edit_instructions: coverageEditHistory,
    is_multi_angle: candidate.is_multi_angle ?? false,
    keyword: candidate.keyword?.trim() || candidate.label.trim(),
    label: candidate.label.trim(),
    passthrough: effectivePassthrough,
    // Carried, never nulled here. The transform guard runs AFTER
    // `downgradePassthroughOnSharedSource`: that flip is
    // true->false, so nulling the transform against the pre-downgrade verdict
    // discards it for an anchor that then regenerates anyway -- exactly the
    // grounding case's two-people-in-one-frame upload.
    prompt_transform: candidate.prompt_transform?.trim() || null,
    proper_name: candidate.proper_name?.trim() || null,
    reason: candidate.reason.trim(),
    source_asset_id: hasValidSource ? primarySourceAssetId : null,
    source_asset_ids: hasValidSource ? validSourceAssetIds : [],
    subject_gender: candidate.subject_gender ?? 'unknown',
    type: candidate.type,
    visual_reference: candidate.visual_reference?.trim() || '',
    visual_tag: candidate.visual_tag?.trim() || '',
  }
}

export function normalizeSelectedCandidates(params: {
  // The bank whose staged assets feed the deterministic keep-raw
  // verdict (lanes 1 + 2). Direct chat uploads (lane 3) are judged from
  // `descriptionsById`, which is already here. Null / omitted on non-brand
  // sessions -- the verdict then rests on the descriptions alone, exactly as
  // `buildAnchorPromptSpecs` behaves with no brand bank.
  brandBank?: BrandBank | null
  descriptionsById: DescriptionsById
  rawAnchors: Array<{
    anchor_id: string
    is_multi_angle?: boolean
    keyword?: string
    label: string
    passthrough?: boolean
    prompt_transform?: null | string
    proper_name?: null | string
    reason: string
    source_asset_id: null | string
    source_asset_ids: string[]
    subject_gender?: VoiceProfileGender
    type: 'CHARACTER' | 'OBJECT'
    visual_reference?: string
    visual_tag?: string
  }>
  uploadedById: UploadedById
}): AnchorAssetCandidate[] {
  const keepRawAssetIds = classifyKeepRawAssetIds({
    brandAssetMeta: buildBrandStagedAssetMeta(params.brandBank),
    descriptionsById: params.descriptionsById,
  })
  return params.rawAnchors.map((anchor) =>
    normalizeCoverageCandidate(
      {
        anchor_id: anchor.anchor_id || anchor.label,
        edit_instruction: null,
        is_multi_angle: anchor.is_multi_angle ?? false,
        keyword: anchor.keyword ?? '',
        label: anchor.label.trim(),
        passthrough: anchor.passthrough ?? false,
        // The single most important line of the data flow.
        // `normalizeSelectedCandidates` builds this literal BEFORE delegating,
        // so a field added only to `normalizeCoverageCandidate` is dropped here
        // -- on the FULL-scope path, i.e. every first generation.
        prompt_transform: anchor.prompt_transform ?? null,
        proper_name: anchor.proper_name ?? null,
        reason: anchor.reason.trim(),
        source_asset_id: anchor.source_asset_id?.trim() || null,
        source_asset_ids: anchor.source_asset_ids ?? [],
        subject_gender: anchor.subject_gender ?? 'unknown',
        type: anchor.type,
        visual_reference: anchor.visual_reference ?? '',
        visual_tag: anchor.visual_tag ?? '',
      },
      params.descriptionsById,
      params.uploadedById,
      keepRawAssetIds,
    ),
  )
}

export function normalizeSourceAssetIds(params: {
  fallbackPrimary?: null | string
  // Widened alongside PlannerAnchorRequest.source_asset_ids -- the
  // `?? []` below already treated null and undefined identically, so this
  // was a type-only gap.
  sourceAssetIds?: null | string[]
}): string[] {
  const deduped = new Set<string>()
  const normalized: string[] = []
  const primary = params.fallbackPrimary?.trim() || null
  const rawIds = params.sourceAssetIds ?? []

  if (primary) {
    deduped.add(primary)
    normalized.push(primary)
  }

  for (const rawId of rawIds) {
    const normalizedId = rawId.trim()
    if (!normalizedId || deduped.has(normalizedId)) {
      continue
    }
    deduped.add(normalizedId)
    normalized.push(normalizedId)
  }

  return normalized
}

export function normalizeSourceUpdateMode(
  value: null | PlannerAnchorSourceUpdateMode | string | undefined,
): PlannerAnchorSourceUpdateMode {
  return value === 'APPEND' ? 'APPEND' : 'REPLACE'
}

export function prettifyAnchorId(anchorId: string): string {
  return anchorId
    .split('_')
    .filter((part) => part.length > 0)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

export async function resolveFinalCandidates(params: {
  /** See `normalizeSelectedCandidates.brandBank`. */
  brandBank?: BrandBank | null
  descriptionsById: DescriptionsById
  plannerParams: PlannerToolParams
  rawAnchors: Array<{
    anchor_id: string
    is_multi_angle?: boolean
    keyword?: string
    label: string
    passthrough?: boolean
    prompt_transform?: null | string
    proper_name?: null | string
    reason: string
    source_asset_id: null | string
    source_asset_ids: string[]
    type: 'CHARACTER' | 'OBJECT'
    visual_reference?: string
    visual_tag?: string
  }>
  sessionId: string
  uploadedById: UploadedById
}): Promise<AnchorAssetCandidate[]> {
  let candidates = normalizeSelectedCandidates({
    brandBank: params.brandBank,
    descriptionsById: params.descriptionsById,
    rawAnchors: params.rawAnchors,
    uploadedById: params.uploadedById,
  })

  if (params.plannerParams.scope !== 'ANCHOR_IDS') {
    return nullPromptTransformOnPassthrough(
      downgradePassthroughOnSharedSource(
        rebalanceEnumeratedCharacterSources(dedupeCandidates(candidates)),
      ),
    )
  }

  const targetIds = collectTargetAnchorIds(params.plannerParams)

  candidates = await mergeTargetedAnchorCandidates({
    candidates,
    descriptionsById: params.descriptionsById,
    sessionId: params.sessionId,
    targetIds,
    uploadedById: params.uploadedById,
  })

  const byId = new Map(candidates.map((candidate) => [candidate.anchor_id, candidate] as const))
  for (const request of params.plannerParams.anchor_requests ?? []) {
    const normalized = normalizeAnchorRequest(
      request,
      byId.get(normalizeAnchorId(request.anchor_id)) ?? null,
      params.descriptionsById,
      params.uploadedById,
    )
    if (normalized) {
      byId.set(normalized.anchor_id, normalized)
      targetIds.add(normalized.anchor_id)
    }
  }

  return nullPromptTransformOnPassthrough(
    downgradePassthroughOnSharedSource(
      rebalanceEnumeratedCharacterSources(
        dedupeCandidates(
          [...byId.values()].filter((candidate) => targetIds.has(candidate.anchor_id)),
        ),
      ),
    ),
  )
}

/**
 * Multi-asset-sharing-source protection (mirrors story-mode storage.ts
 * line 329-342): when two or more anchors draw from the same
 * `source_asset_id`, passthrough is unsafe for any of them -- the user
 * probably uploaded one image containing multiple entities, so the
 * image must go through generation to isolate each anchor. Downgrade
 * `passthrough` to false on every candidate in the conflict set.
 */
export function resolveNextSourceAssetIds(params: {
  baseCandidate: AnchorAssetCandidate | null
  requestedSourceAssetId: null | string
  requestedSourceAssetIds: string[]
  sourceUpdateMode: null | PlannerAnchorSourceUpdateMode
}): string[] {
  if (params.requestedSourceAssetIds.length === 0) {
    return baseCandidateSourceAssetIds(params.baseCandidate)
  }

  if (params.sourceUpdateMode === 'APPEND') {
    return mergeSourceAssetIds({
      explicitPrimary: params.requestedSourceAssetId,
      nextIds: params.requestedSourceAssetIds,
      previousIds: baseCandidateSourceAssetIds(params.baseCandidate),
    })
  }

  return mergeSourceAssetIds({
    explicitPrimary: params.requestedSourceAssetId,
    nextIds: params.requestedSourceAssetIds,
    previousIds: [],
  })
}

/**
 * Passthrough copies the source image through
 * untouched, so no transform can apply to it: logos, app UI and infographics
 * carry their value in informational fidelity and that outranks a costume
 * request. Enforced in CODE, not only in the manager prompt -- a prompt rule the
 * model can ignore is not a guarantee.
 *
 * MUST run LAST, after `downgradePassthroughOnSharedSource`. That flip is
 * true->false and is harmless for a transform (the anchor regenerates, so the
 * transform correctly applies); guarding before it nulls the transform against a
 * verdict that is about to be reversed. Keep-raw, the one flip the plan layer
 * could not previously see, is folded into `normalizeCoverageCandidate`, so
 * `candidate.passthrough` here is the complete persisted verdict.
 */
function downgradePassthroughOnSharedSource(
  candidates: AnchorAssetCandidate[],
): AnchorAssetCandidate[] {
  const usageCount = new Map<string, number>()
  for (const candidate of candidates) {
    for (const sourceAssetId of candidate.source_asset_ids) {
      usageCount.set(sourceAssetId, (usageCount.get(sourceAssetId) ?? 0) + 1)
    }
  }
  return candidates.map((candidate) => {
    if (!candidate.passthrough) {
      return candidate
    }
    const shared = candidate.source_asset_ids.some((id) => (usageCount.get(id) ?? 0) > 1)
    return shared ? { ...candidate, passthrough: false } : candidate
  })
}

function nullPromptTransformOnPassthrough(
  candidates: AnchorAssetCandidate[],
): AnchorAssetCandidate[] {
  return candidates.map((candidate) => {
    if (!candidate.passthrough || !candidate.prompt_transform) {
      return candidate
    }
    logger.info(
      `[uip-anchor-plan] dropped prompt_transform on passthrough anchor anchorId=${candidate.anchor_id} transform="${candidate.prompt_transform}"`,
    )
    return { ...candidate, prompt_transform: null }
  })
}

/**
 * Group CHARACTER anchors by their enumerated base id (`char_friend` and
 * `char_friend_2` share base `char_friend`). Multi-angle anchors are excluded --
 * each of their views legitimately carries its own source.
 */
function groupEnumeratedCharacterAnchors(
  candidates: AnchorAssetCandidate[],
): AnchorAssetCandidate[][] {
  const baseOf = (anchorId: string): string => anchorId.replace(/_\d+$/, '')
  const groups = new Map<string, AnchorAssetCandidate[]>()
  for (const candidate of candidates) {
    if (candidate.type !== 'CHARACTER' || candidate.is_multi_angle) {
      continue
    }
    const base = baseOf(candidate.anchor_id)
    const group = groups.get(base)
    if (group) {
      group.push(candidate)
    } else {
      groups.set(base, [candidate])
    }
  }
  return [...groups.values()]
}

/**
 * For one enumerated sibling group, hand each donor's surplus to the still-empty
 * siblings (one each, shared across all donors); leftover surplus stays on its donor.
 * Records the new source lists into `nextSources`; a no-op unless the group has both
 * an empty sibling and an over-bound donor.
 */
function planGroupSourceRedistribution(
  group: AnchorAssetCandidate[],
  nextSources: Map<string, string[]>,
): void {
  const unboundQueue = group.filter((candidate) => candidate.source_asset_ids.length === 0)
  const donors = group.filter((candidate) => candidate.source_asset_ids.length >= 2)
  if (group.length < 2 || unboundQueue.length === 0 || donors.length === 0) {
    return
  }
  for (const donor of donors) {
    const remaining: string[] = []
    for (const source of donor.source_asset_ids.slice(1)) {
      const sibling = unboundQueue.shift()
      if (sibling) {
        nextSources.set(sibling.anchor_id, [source])
      } else {
        remaining.push(source)
      }
    }
    nextSources.set(donor.anchor_id, [donor.source_asset_ids[0], ...remaining])
  }
}

/**
 * Repair the plan-LLM binding error where several DISTINCT character reference
 * uploads get bound to one anchor while an enumerated sibling is left source-less
 * (e.g. `char_friend` took both friends' refs and `char_friend_2`
 * got none, so it regenerated from scratch instead of using its own uploaded photo).
 * The empty enumerated sibling is the disambiguator: two photos of ONE subject never
 * spawn an empty `_N` sibling, so a source-less `char_X_N` next to an over-bound
 * `char_X` means the sources are distinct members -- each over-bound donor keeps its
 * primary source and hands its surplus to the still-empty siblings so every member
 * uses its own reference.
 */
export function rebalanceEnumeratedCharacterSources(
  candidates: AnchorAssetCandidate[],
): AnchorAssetCandidate[] {
  const nextSources = new Map<string, string[]>()
  for (const group of groupEnumeratedCharacterAnchors(candidates)) {
    planGroupSourceRedistribution(group, nextSources)
  }
  if (nextSources.size === 0) {
    return candidates
  }
  return candidates.map((candidate) => {
    const next = nextSources.get(candidate.anchor_id)
    return next
      ? { ...candidate, source_asset_id: next[0] ?? null, source_asset_ids: next }
      : candidate
  })
}
