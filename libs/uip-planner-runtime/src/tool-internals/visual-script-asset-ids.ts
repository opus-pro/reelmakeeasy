import { synthesizeBrandAssetId } from '../tool-internals/brand-staged-assets-to-uploads'
import type { BrandBank } from '../types'

interface AnchorSourceLike {
  anchor_id?: string
  source_asset_id?: null | string
  source_asset_ids?: Array<null | string>
}

export function extractAnchorSourceAssetIdsByAnchorId(
  anchorAssetsJson: string,
): Map<string, Set<string>> {
  try {
    const parsed = JSON.parse(anchorAssetsJson) as {
      anchors?: AnchorSourceLike[]
      candidates?: AnchorSourceLike[]
    }
    const result = new Map<string, Set<string>>()
    for (const item of parsed.anchors ?? parsed.candidates ?? []) {
      const anchorId = item.anchor_id?.trim()
      if (!anchorId) {
        continue
      }
      const sourceIds = [item.source_asset_id, ...(item.source_asset_ids ?? [])]
        .filter((source): source is string => typeof source === 'string')
        .map((source) => source.trim())
        .filter(Boolean)
      result.set(anchorId, new Set(sourceIds))
    }
    return result
  } catch {
    return new Map()
  }
}

export function extractKnownAnchorIds(anchorAssetsJson: string): string[] {
  try {
    const parsed = JSON.parse(anchorAssetsJson) as {
      anchors?: Array<{ anchor_id?: string }>
      candidates?: Array<{ anchor_id?: string }>
    }
    return (parsed.anchors ?? parsed.candidates ?? [])
      .map((item) => item.anchor_id?.trim() ?? '')
      .filter((anchorId) => anchorId.length > 0)
  } catch {
    return []
  }
}

/**
 * Every uploaded asset_id consumed as a SOURCE by an anchor (the union of each
 * anchor's `source_asset_id` + `source_asset_ids`). Once an upload is absorbed
 * into a canonicalized anchor, the anchor is the binding surface -- the raw
 * upload should not ALSO be force-bound into a shot as `source="user_upload"`
 * (prompt rule visual-script-uip-prompts.ts: "user_upload only for residual
 * uploads not absorbed into anchor assets"). Callers subtract these from the
 * mandatory user-upload list so the mandatory rule stops contradicting that
 * default. A single multi-subject upload (a couple photo fanned out into two
 * single-person anchors) is the case this protects: without the exclusion the
 * shot receives both stylized single-person anchors AND the raw 2-person photo
 * (e.g. two parent anchors plus the couple upload they came from, all bound
 * to one shot).
 */
export function extractAnchorConsumedSourceAssetIds(anchorAssetsJson: string): string[] {
  return [
    ...new Set(
      [...extractAnchorSourceAssetIdsByAnchorId(anchorAssetsJson).values()].flatMap((sourceIds) => [
        ...sourceIds,
      ]),
    ),
  ]
}

/**
 * The anchor_id of the anchor sourced from a real staged brand logo
 * (`brand_logo_<hash>`), if any. The visual-script binding step surfaces it so
 * the LLM binds the user's real logo to brand-identity shots instead of a
 * product or an invented mark (observed: a logo anchor was correctly sourced
 * from the real logo but the VS bound a product to the logo shot). Returns
 * the first match, or null when no anchor is logo-sourced.
 */
export function extractBrandLogoAnchorId(anchorAssetsJson: string): null | string {
  try {
    const parsed = JSON.parse(anchorAssetsJson) as {
      anchors?: Array<AnchorSourceLike>
      candidates?: Array<AnchorSourceLike>
    }
    for (const item of parsed.anchors ?? parsed.candidates ?? []) {
      const anchorId = item.anchor_id?.trim() ?? ''
      if (!anchorId) {
        continue
      }
      const sources = [item.source_asset_id, ...(item.source_asset_ids ?? [])]
      if (
        sources.some((source) => typeof source === 'string' && BRAND_LOGO_ID_PATTERN.test(source))
      ) {
        return anchorId
      }
    }
    return null
  } catch {
    return null
  }
}

/**
 * The brand "logo vs. name" guidance block, shared by the UIP scaffold
 * and the classic FULL visual-script prompt so both paths get it (the classic
 * full path bypasses the scaffold). Empty string on non-brand sessions keeps
 * their prompt byte-identical. When an anchor is sourced from the user's real
 * logo, names it so the LLM binds it instead of inventing or substituting a mark.
 */
export function buildBrandLogoGuidance(
  brandBank: BrandBank | null,
  anchorAssetsJson: string,
): string {
  if (!brandBank) {
    return ''
  }
  const brandLogoAnchorId = extractBrandLogoAnchorId(anchorAssetsJson)
  const brandLogoAnchorLine = brandLogoAnchorId
    ? `- The user's real brand logo is available as anchor '${brandLogoAnchorId}'. Bind it via pre_selected_assets to any shot depicting the brand's logo, wordmark, or brand identity; do not substitute a product, character, or invented mark for it.\n`
    : ''
  return `\nBrand Identity (logo vs. name) -- CRITICAL:
- The brand NAME may always appear as on-screen text (single-quoted), e.g. 'Acme Co.'.
- A brand LOGO, WORDMARK, or BRAND MARK is a specific real asset, never something to invent, redraw, or stylize. Only depict the brand's logo/wordmark/brand-mark in a shot when that shot binds a real logo image via pre_selected_assets (a brand logo asset_id from the allowed asset lists below, or an uploaded logo).
- If no real logo asset is available for a shot, represent the brand by its NAME as on-screen text instead. Never reconstruct or generate the brand's logo/wordmark from the brand name alone.
${brandLogoAnchorLine}`
}

export function extractKnownAssetIds(
  assetDescriptionsJson: string,
  brandBank: BrandBank | null = null,
): string[] {
  try {
    const parsed = JSON.parse(assetDescriptionsJson) as {
      items?: Array<{ asset_id?: string }>
    }
    const assetIds = (parsed.items ?? [])
      .map((item) => item.asset_id?.trim() ?? '')
      .filter((assetId) => assetId.length > 0)
    if (!brandBank) {
      return assetIds
    }

    const allowedBrandIds = buildAllowedBrandIdSet(brandBank)
    return assetIds.filter((assetId) => {
      if (!BRAND_SYNTH_ID_PATTERN.test(assetId)) {
        return true
      }
      return allowedBrandIds.has(assetId)
    })
  } catch {
    return []
  }
}

export function extractUserUploadBrandAssetIds(brandBank: BrandBank | null): string[] {
  if (!brandBank) {
    return []
  }

  const assetIds: string[] = []
  for (const bucket of ['logo', 'product', 'character'] as const) {
    for (const ref of brandBank.staged_assets[bucket] ?? []) {
      if (ref.provenance === 'user_upload') {
        assetIds.push(synthesizeBrandAssetId(ref.staging_uri, bucket))
      }
    }
  }
  return assetIds
}

export function filterAssetDescriptionsByBrandBank(
  assetDescriptionsJson: string,
  brandBank: BrandBank | null,
): string {
  if (!brandBank) {
    return assetDescriptionsJson
  }

  try {
    const parsed = JSON.parse(assetDescriptionsJson) as {
      items?: Array<{ asset_id?: string }>
    }
    const allowedBrandIds = buildAllowedBrandIdSet(brandBank)
    const items = (parsed.items ?? []).filter((item) => {
      const assetId = item.asset_id?.trim() ?? ''
      if (!assetId || !BRAND_SYNTH_ID_PATTERN.test(assetId)) {
        return true
      }
      return allowedBrandIds.has(assetId)
    })
    return JSON.stringify({ ...parsed, items }, null, 2)
  } catch {
    return assetDescriptionsJson
  }
}

const BRAND_SYNTH_ID_PATTERN = /^brand_(character|logo|product)_[0-9a-f]{8}$/
const BRAND_LOGO_ID_PATTERN = /^brand_logo_[0-9a-f]{8}$/

function buildAllowedBrandIdSet(brandBank: BrandBank): Set<string> {
  const allowed = new Set<string>()
  for (const bucket of ['logo', 'product', 'character'] as const) {
    for (const ref of brandBank.staged_assets[bucket] ?? []) {
      allowed.add(synthesizeBrandAssetId(ref.staging_uri, bucket))
    }
  }
  return allowed
}
