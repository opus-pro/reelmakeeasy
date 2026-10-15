import type { BrandBank, StagedAssetRef } from '../types'

/**
 * Single source of truth for "are these two staged brand assets the same
 * image?" Used by the fold/dedup step at brand-extraction completion and by
 * the defensive guard in patch-apply's applyAddBrandAsset.
 *
 * This is the cheap, EXACT pass: a match on either signal is a certain
 * duplicate.
 *   1. content_hash -- md5 of the original bytes. Collapses the same image
 *      across sources (crawl extraction vs user upload of the same file)
 *      even though their staging_uris differ.
 *   2. staging_uri -- the same staged file.
 *
 * Visually-equivalent-but-not-byte-identical dupes (a logo re-encoded png vs
 * webp, two sizes of the same icon) are NOT caught here on purpose -- that
 * semantic judgement is delegated to the LLM dedup pass at fold time, which
 * reasons over descriptions. Keeping this helper byte-exact means the
 * defensive guard never collapses two genuinely distinct assets.
 *
 * Pure: compares already-stored fields, never hashes.
 */
export function stagedAssetsAreSameImage(a: StagedAssetRef, b: StagedAssetRef): boolean {
  if (a.content_hash && b.content_hash && a.content_hash === b.content_hash) {
    return true
  }
  return normalizeUri(a.staging_uri) === normalizeUri(b.staging_uri)
}

/**
 * Returns the first ref in `existing` that is the same image as `candidate`,
 * or undefined when none match. The defensive guard uses this to skip a
 * blind push that would double-insert an asset already present in any bucket.
 */
export function findSameImageRef(
  existing: readonly StagedAssetRef[],
  candidate: StagedAssetRef,
): StagedAssetRef | undefined {
  return existing.find((ref) => stagedAssetsAreSameImage(ref, candidate))
}

/**
 * Flatten every staged-asset bucket into one array. Order is logo ->
 * product -> character, matching brandStagedAssetsToUploads, so duplicate
 * scans are deterministic.
 */
export function flattenStagedAssets(bank: BrandBank | null | undefined): StagedAssetRef[] {
  if (!bank) {
    return []
  }
  return [
    ...bank.staged_assets.logo,
    ...bank.staged_assets.product,
    ...bank.staged_assets.character,
  ]
}

function normalizeUri(uri: string): string {
  return uri.trim()
}
