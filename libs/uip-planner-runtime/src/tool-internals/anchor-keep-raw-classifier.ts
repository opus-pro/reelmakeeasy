/**
 * Keep-raw classification for anchor generation. Some assets carry their value
 * in informational fidelity, not style: logos, website / app UI (incl. product
 * UI screenshots), and infographics must render exactly as supplied and never
 * be style-transferred. Accurate information beats a good style.
 *
 * This is deterministic and additive: it returns the set of source asset_ids
 * that should be forced to passthrough (raw). It never turns passthrough off,
 * so the anchor-manager LLM's own passthrough verdict still stands as a
 * fallback for cases this misses.
 *
 * Three provenance lanes:
 *   1. Web-crawled brand assets   (BrandBank.staged_assets, StagedAssetRef)
 *   2. Brand-modal uploads        (same, provenance user_upload)
 *   3. Direct chat uploads        (AssetDescriptionItem from describe step)
 * Lanes 1 + 2 share the StagedAssetRef signal (asset_kind / category); lane 3
 * is judged from the per-image description.
 */
import type { AssetDescriptionItem } from '../anchor-types'
import type { BrandBank } from '../types'

import type { DescriptionsById } from './anchor-plan'
import {
  type BrandStagedAssetBucket,
  synthesizeBrandAssetId,
} from './brand-staged-assets-to-uploads'

export interface BrandStagedAssetMetaEntry {
  asset_kind: 'character' | 'logo' | 'product'
  category: null | string
}

export interface ClassifyKeepRawInput {
  brandAssetMeta: Map<string, BrandStagedAssetMetaEntry>
  descriptionsById: DescriptionsById
}

/**
 * Build an {asset_id -> {asset_kind, category}} map from a brand bank's staged
 * assets, keyed by the same synthesized id the anchor candidates reference.
 * Covers lanes 1 and 2 (both live in `staged_assets`). Empty when no bank.
 */
export function buildBrandStagedAssetMeta(
  brandBank: BrandBank | null | undefined,
): Map<string, BrandStagedAssetMetaEntry> {
  const meta = new Map<string, BrandStagedAssetMetaEntry>()
  if (!brandBank) {
    return meta
  }
  for (const bucket of BRAND_BUCKETS) {
    const refs = brandBank.staged_assets[bucket]
    if (!refs) {
      continue
    }
    for (const ref of refs) {
      meta.set(synthesizeBrandAssetId(ref.staging_uri, bucket), {
        asset_kind: ref.asset_kind,
        category: ref.category,
      })
    }
  }
  return meta
}

/**
 * Return the set of source asset_ids to force raw. Brand assets qualify on
 * asset_kind / category; direct uploads qualify on the description heuristics.
 */
export function classifyKeepRawAssetIds(input: ClassifyKeepRawInput): Set<string> {
  const keepRaw = new Set<string>()

  for (const [assetId, meta] of input.brandAssetMeta) {
    if (isKeepRawBrandAsset(meta)) {
      keepRaw.add(assetId)
    }
  }

  for (const [assetId, description] of input.descriptionsById) {
    // Brand-staged assets are also described, so their synthesized ids land
    // here too. They are governed solely by lanes 1 + 2 (the authoritative
    // StagedAssetRef asset_kind / category); skip them so a description
    // heuristic cannot re-include an asset the brand signal intentionally
    // left styled (e.g. a `hero` product photo).
    if (input.brandAssetMeta.has(assetId)) {
      continue
    }
    if (isKeepRawDirectUpload(description)) {
      keepRaw.add(assetId)
    }
  }

  return keepRaw
}

const BRAND_BUCKETS: readonly BrandStagedAssetBucket[] = ['logo', 'product', 'character']

// StagedAssetRef categories whose value is informational fidelity. A logo
// asset_kind already qualifies on its own; these add the brand marks and the
// product / app UI screenshots that live in the product bucket.
const KEEP_RAW_BRAND_CATEGORIES: ReadonlySet<string> = new Set([
  'favicon',
  'og_image',
  'partner_logo',
  'press_logo',
  'primary_brand_mark',
  'product_screenshot',
])

function isKeepRawBrandAsset(meta: BrandStagedAssetMetaEntry): boolean {
  if (meta.asset_kind === 'logo') {
    return true
  }
  return meta.category != null && KEEP_RAW_BRAND_CATEGORIES.has(meta.category)
}

// Direct chat uploads have no StagedAssetRef, so judge from the description.
// An infographic, a recognized logo, or an image whose visible content is
// dominated by text / brand marks (no real subject present) renders raw. The
// no-subject guard keeps product / character photos that merely carry a brand
// word on the styled path.
function isKeepRawDirectUpload(description: AssetDescriptionItem): boolean {
  if (description.quality.text_heavy_infographic) {
    return true
  }
  if (description.brand_asset_kind === 'logo') {
    return true
  }
  const { brands_or_text, characters, objects } = description.entities
  return brands_or_text.length > 0 && characters.length === 0 && objects.length === 0
}
