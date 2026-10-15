/**
 * Deterministic "the brand logo must be used" guarantee.
 *
 * A logo that survived brand review is a high-intent user signal, but anchor
 * binding is otherwise left to the Plan-LLM: when the working script has no
 * brand-identity shot, the LLM creates no logo anchor and the logo silently
 * never reaches the video. This owns that trigger in the runtime instead --
 * when the brand bank has a usable logo asset that no candidate already
 * sources, synthesize a passthrough logo anchor pointing at it.
 *
 * The synthetic candidate is normalized through `normalizeCoverageCandidate`,
 * so it inherits the same passthrough invariants (single valid source that
 * exists in both descriptions and uploads) as any LLM-selected candidate; if
 * the logo asset is missing bytes or a description, nothing is added.
 */
import type { AnchorAssetCandidate } from '../anchor-types'
import type { BrandBank } from '../types'

import { type DescriptionsById, normalizeCoverageCandidate, type UploadedById } from './anchor-plan'
import { synthesizeBrandAssetId } from './brand-staged-assets-to-uploads'

export const BRAND_LOGO_ANCHOR_ID = 'brand_logo'

export function ensureBrandLogoAnchor(params: {
  brandBank: BrandBank | null | undefined
  candidates: AnchorAssetCandidate[]
  descriptionsById: DescriptionsById
  uploadedById: UploadedById
}): AnchorAssetCandidate[] {
  const logoRefs = params.brandBank?.staged_assets?.logo ?? []
  if (logoRefs.length === 0) {
    return params.candidates
  }

  // Bind the first logo in bucket order that has both bytes and a description.
  // This is a usability floor, not a primary-mark guarantee: the bucket follows
  // the crawler's order, which is not the same priority sort the prompt-facing
  // uploads use (see brandStagedAssetsToUploads' priorityScore).
  const logoAssetIds = logoRefs.map((ref) => synthesizeBrandAssetId(ref.staging_uri, 'logo'))
  const logoAssetIdSet = new Set(logoAssetIds)

  const alreadyBound = params.candidates.some((candidate) =>
    (candidate.source_asset_ids ?? []).some((id) => logoAssetIdSet.has(id)),
  )
  if (alreadyBound) {
    return params.candidates
  }

  const primaryLogoId = logoAssetIds.find(
    (id) => params.uploadedById.has(id) && params.descriptionsById.has(id),
  )
  if (!primaryLogoId) {
    return params.candidates
  }

  // Defensive: never clobber an existing anchor that happens to share the id.
  if (params.candidates.some((candidate) => candidate.anchor_id === BRAND_LOGO_ANCHOR_ID)) {
    return params.candidates
  }

  const businessName = params.brandBank?.basic_info?.business_name?.trim() || 'Brand'
  const synthetic = normalizeCoverageCandidate(
    {
      anchor_id: BRAND_LOGO_ANCHOR_ID,
      edit_instruction: null,
      is_multi_angle: false,
      keyword: `The ${businessName} Logo`,
      label: `${businessName} Logo`,
      passthrough: true,
      proper_name: businessName,
      reason: 'Brand logo must be available as a usable anchor for the brand identity.',
      source_asset_id: primaryLogoId,
      source_asset_ids: [primaryLogoId],
      type: 'OBJECT',
      visual_reference: '',
      visual_tag: 'Brand Logo Mark',
    },
    params.descriptionsById,
    params.uploadedById,
  )

  // normalizeCoverageCandidate downgrades passthrough off if the source did
  // not resolve; skip the add in that (already-guarded) case to avoid a
  // source-less anchor that would just fail generation.
  if (!synthetic.source_asset_id) {
    return params.candidates
  }

  return [...params.candidates, synthetic]
}
