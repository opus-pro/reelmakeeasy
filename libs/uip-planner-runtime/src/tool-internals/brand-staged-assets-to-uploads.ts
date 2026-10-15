import { createHash } from 'node:crypto'

import type { AssetDescriptionItem } from '../anchor-types'
import type { BrandBank, UploadedAsset } from '../types'

/**
 * Bucket key matching `BrandBank.staged_assets` shape.
 */
export type BrandStagedAssetBucket = 'character' | 'logo' | 'product'

type StagedAssetRef = BrandBank['staged_assets']['logo'][number]

const EXTENSION_TO_MIME: Record<string, string> = {
  avif: 'image/avif',
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  svg: 'image/svg+xml',
  webp: 'image/webp',
}

/**
 * Returned by `inferContentType` when the URI's extension isn't in the
 * `EXTENSION_TO_MIME` map. Callers that hand the asset to an LLM (OpenAI
 * image inputs reject non-image MIMEs) should treat this as a skip
 * signal -- see crawler's stageOneLogo + describeStagedAssetsActivity.
 */
export const FALLBACK_MIME = 'application/octet-stream'

/**
 * Stable synthetic asset_id for a brand-staged asset. The hash is the
 * first 8 hex chars of sha256(staging_uri) -- deterministic across
 * re-extraction (same URI -> same id), short enough to be human-debuggable,
 * and bucket-prefixed so two buckets cannot collide on a shared id.
 *
 * Used by both `brandStagedAssetsToUploads` (to set the synthetic
 * `UploadedAsset.asset_id`) and `anchor-generation.ts`'s BRAND CONCEPT
 * REFERENCES renderer (to cross-reference the same id in the prompt).
 * The two call sites MUST produce identical ids; this helper is the
 * single source of truth.
 */
export function synthesizeBrandAssetId(stagingUri: string, bucket: BrandStagedAssetBucket): string {
  const hash8 = createHash('sha256').update(stagingUri).digest('hex').slice(0, 8)
  return `brand_${bucket}_${hash8}`
}

// Matches the ids `synthesizeBrandAssetId` produces (`brand_<bucket>_<hash8>`),
// so a downstream anchor whose source traces to the brand bank can be told apart
// from a one-off chat/project upload. Kept here as the single source of truth for
// the id shape -- the render-side anchor-library store uses it to
// decide which generated anchors are brand-owned and may enter the org-shared
// library, mirroring the planner store's brandStagedAssetIds membership test.
const BRAND_STAGED_ASSET_ID_RE = /^brand_(?:character|logo|product)_([0-9a-f]{8})$/

export function isBrandStagedAssetId(assetId: string): boolean {
  return BRAND_STAGED_ASSET_ID_RE.test(assetId)
}

/**
 * The bucket-independent half of a brand staged-asset id: `brand_<hash8>`, where
 * hash8 is the sha256(staging_uri) digest above. The bucket is SESSION-local --
 * a brand-review confirm can re-categorize the same file (product -> logo) and
 * that move is not always written back to the saved brief, so one image yields
 * `brand_product_8f989fdd` in the session that stored an anchor from it and
 * `brand_logo_8f989fdd` in the next one. Only the digest identifies the file
 * across sessions, so every CROSS-SESSION key (the anchor library's match and
 * merge keys) compares this, never the whole id.
 *
 * An id that is not brand-staged-shaped (a chat / project upload uuid) is
 * returned verbatim: it carries no bucket, and `brand_<hash8>` is not a shape
 * `synthesizeBrandAssetId` can emit, so the two namespaces cannot collide.
 */
export function stripBrandBucket(assetId: string): string {
  const hash8 = BRAND_STAGED_ASSET_ID_RE.exec(assetId)?.[1]
  return hash8 ? `brand_${hash8}` : assetId
}

/**
 * Convert a brand_bank's staged_assets into synthetic `UploadedAsset`
 * entries so the anchor-asset manager + downstream Phase B/C see them
 * as first-class image references with bytes.
 *
 * Ordering (within each bucket): provenance=user_upload first, then
 * category=primary_brand_mark, then in_home_link=true, then remaining
 * "high-signal" categories (favicon, hero, product_screenshot), then the
 * rest. Stable ordering keeps the LLM's prompt deterministic across
 * re-renders.
 *
 * Returns `[]` when `brandBank` is null or the bucket is empty -- in
 * either case the caller's merge is a no-op and the anchor manager's
 * prompt + Attached Uploaded Images list are byte-identical to a
 * non-brand session.
 */
export function brandStagedAssetsToUploads(
  brandBank: BrandBank | null | undefined,
): UploadedAsset[] {
  if (!brandBank) {
    return []
  }
  const businessName = brandBank.basic_info.business_name
  const buckets: BrandStagedAssetBucket[] = ['logo', 'product', 'character']
  const uploadedAt = new Date().toISOString()
  const result: UploadedAsset[] = []
  for (const bucket of buckets) {
    const refs = brandBank.staged_assets[bucket]
    if (!refs || refs.length === 0) {
      continue
    }
    const ordered = [...refs].sort((left, right) => priorityScore(left) - priorityScore(right))
    for (const ref of ordered) {
      result.push({
        asset_id: synthesizeBrandAssetId(ref.staging_uri, bucket),
        content_type: inferContentType(ref.staging_uri),
        // Carry the staged ref's hash so the pool dedup can collapse this
        // synthetic against a byte-identical real upload in cached_artifacts.
        ...(ref.content_hash ? { content_hash: ref.content_hash } : {}),
        file_name: synthesizeFileName(businessName, bucket, ref),
        file_path: ref.staging_uri,
        uploaded_at: uploadedAt,
      })
    }
  }
  return result
}

/**
 * Reconstruct asset descriptions for a brand_bank's staged_assets, keyed by the
 * SAME synthetic ids as `brandStagedAssetsToUploads` so the anchor pipeline's
 * `uploadedById` and `descriptionsById` maps line up.
 *
 * In the saved-brief reuse flow the brand-extraction child never runs, so
 * `describeUploadedImages` never populates `_loaded_asset_descriptions`. Without
 * a description entry, anchor binding (the deterministic logo guarantee and the
 * LLM asset-manager) cannot pick a `source_asset_id`, and every brand asset is
 * regenerated from scratch instead of grounded in the real logo/character file.
 * The bank ref only carries the `description` caption (the LLM-rich entities /
 * quality / role fields are extraction-time only), so those default to neutral
 * values -- enough to satisfy the presence gate and give the asset-manager the
 * caption text to bind on.
 *
 * Returns `[]` when `brandBank` is null or has no staged assets.
 */
export function brandStagedAssetsToDescriptions(
  brandBank: BrandBank | null | undefined,
): AssetDescriptionItem[] {
  if (!brandBank) {
    return []
  }
  const businessName = brandBank.basic_info.business_name
  const buckets: BrandStagedAssetBucket[] = ['logo', 'product', 'character']
  const result: AssetDescriptionItem[] = []
  for (const bucket of buckets) {
    const refs = brandBank.staged_assets[bucket]
    if (!refs || refs.length === 0) {
      continue
    }
    const ordered = [...refs].sort((left, right) => priorityScore(left) - priorityScore(right))
    for (const ref of ordered) {
      result.push({
        asset_id: synthesizeBrandAssetId(ref.staging_uri, bucket),
        brand_asset_kind: bucket,
        content_type: inferContentType(ref.staging_uri),
        description: ref.description,
        entities: { brands_or_text: [], characters: [], objects: [] },
        file_name: synthesizeFileName(businessName, bucket, ref),
        file_path: ref.staging_uri,
        quality: { text_heavy_infographic: false },
        summary: ref.description ?? '',
        tags: [],
        usage_guidance: null,
      })
    }
  }
  return result
}

/**
 * Collapse the same image in an anchor/upload pool that concatenates
 * `cached_artifacts.uploaded_assets` with `brandStagedAssetsToUploads(bank)`.
 * A brand asset can appear in both lists with different asset_ids (a real
 * upload's uuid vs the `brand_<bucket>_<hash>` synthetic) yet be the same
 * bytes, so an asset_id-keyed merge never collapses them. Key on content_hash
 * when present (set on brand assets), else file_path. First occurrence wins, so
 * real `cached_artifacts` uploads survive over their brand-staged synthetics
 * (ordering otherwise preserved).
 */
export function dedupeUploadedAssets(assets: UploadedAsset[]): UploadedAsset[] {
  const seen = new Set<string>()
  const out: UploadedAsset[] = []
  for (const asset of assets) {
    const key = asset.content_hash ? `h:${asset.content_hash}` : `p:${asset.file_path}`
    if (seen.has(key)) {
      continue
    }
    seen.add(key)
    out.push(asset)
  }
  return out
}

/**
 * Partition brand-staged uploads by whether their backing object still
 * exists, using the caller-supplied `exists` probe. Kept pure/injectable
 * (no storage import) so the pool builder owns the storage handle and this
 * stays trivially unit-testable.
 *
 * Brand-library assets are durable by design, but an edit/re-extraction
 * consistency gap can leave a saved bank pointing at a deleted stored file.
 * Without this filter, the anchor/VS batch's bare `storage.readFile` throws
 * `No such object` and one dangling ref among N hard-fails the whole first
 * storyboard. Callers drop the `missing` refs and proceed with the
 * survivors, mirroring the save path's best-effort contract
 * (`copyBankAssetsToLibrary`); a dropped asset regenerates from prompt.
 */
export function inferContentType(stagingUri: string): string {
  const lastDot = stagingUri.lastIndexOf('.')
  if (lastDot === -1) {
    return FALLBACK_MIME
  }
  const ext = stagingUri.slice(lastDot + 1).toLowerCase()
  return EXTENSION_TO_MIME[ext] ?? FALLBACK_MIME
}

export async function partitionByExistence(
  assets: UploadedAsset[],
  exists: (fileUri: string) => Promise<boolean>,
): Promise<{ missing: UploadedAsset[]; present: UploadedAsset[] }> {
  const probed = await Promise.all(
    assets.map(async (asset) => ({ asset, present: await exists(asset.file_path) })),
  )
  const present: UploadedAsset[] = []
  const missing: UploadedAsset[] = []
  for (const entry of probed) {
    ;(entry.present ? present : missing).push(entry.asset)
  }
  return { missing, present }
}

/**
 * Like `inferContentType`, but for pre-download source URLs that may carry
 * query strings or fragments (`?v=123`, `?w=400&fit=crop`, `#anchor`, signed
 * URLs, image-CDN transforms, etc.).
 *
 * `inferContentType` does a naive `lastIndexOf('.')` which trips on URLs like
 * `https://cdn.shopify.com/logo.png?v=123` (extracts `png?v=123`, falls back).
 * Marketing sites set cache-busters reflexively, so the bare helper would
 * false-positive-drop nearly every Shopify/Squarespace/Wix/Webflow logo when
 * used at a pre-download call site.
 *
 * Post-download staging URIs (`${slug}-${hash}.${ext}`) are clean and should
 * keep using `inferContentType` directly.
 *
 * Image-proxy URLs (Next.js `/_next/image?url=...`, Vercel, Wsrv, etc.) invert
 * the cache-buster assumption: the path is extensionless and the real filename
 * lives URL-encoded inside the `url=` query param, which the strip above
 * discards. So when path inference fails, decode the embedded source and try
 * that before giving up. Without this, every Next.js site's logo and product
 * images fall to FALLBACK_MIME and get dropped pre-download.
 */
export function inferContentTypeFromSourceUrl(sourceUrl: string): string {
  // Unwrap proxy layers iteratively. Bounded by depth and a seen-set so a
  // crafted nested `url=` chain cannot overflow the stack or loop forever.
  const seen = new Set<string>()
  let current: null | string = sourceUrl
  for (let depth = 0; depth < 8 && current && !seen.has(current); depth += 1) {
    seen.add(current)
    const queryStart = current.indexOf('?')
    const fragmentStart = current.indexOf('#')
    let cutAt = current.length
    if (queryStart !== -1 && queryStart < cutAt) {
      cutAt = queryStart
    }
    if (fragmentStart !== -1 && fragmentStart < cutAt) {
      cutAt = fragmentStart
    }
    const fromPath = inferContentType(current.slice(0, cutAt))
    if (fromPath !== FALLBACK_MIME) {
      return fromPath
    }
    current = extractProxiedSourceUrl(current)
  }
  return FALLBACK_MIME
}

/**
 * Pull the original asset URL out of an image-proxy URL's query string. Image
 * proxies forward the real file in a `url` param (Next.js/Vercel `/_next/image`,
 * Wsrv `images.weserv.nl`, ...). Returns the decoded value, or null when there
 * is no such param. Tolerant of malformed input -- a bad URL just yields null.
 */
function extractProxiedSourceUrl(sourceUrl: string): null | string {
  try {
    const params = new URL(sourceUrl, 'https://invalid.local').searchParams
    return params.get('url')
  } catch {
    return null
  }
}

/**
 * Resolve an image-proxy URL to the absolute URL of the original file it wraps,
 * or null when the input isn't a proxy URL (or the embedded source has no usable
 * image extension). Callers should prefer downloading the original: the proxy
 * serves a variant downscaled to the rendered display size (`/_next/image?w=48`),
 * which for a small logo can fall under the staging size floor and get dropped,
 * whereas the original is full-resolution. Relative embedded paths
 * (`url=%2Flogo.png`) are resolved against the proxy URL's origin.
 */
export function resolveProxiedImageUrl(sourceUrl: string): null | string {
  const embedded = extractProxiedSourceUrl(sourceUrl)
  if (!embedded || inferContentTypeFromSourceUrl(embedded) === FALLBACK_MIME) {
    return null
  }
  try {
    return new URL(embedded, sourceUrl).href
  } catch {
    return null
  }
}

function priorityScore(ref: StagedAssetRef): number {
  // Lower score = higher priority.
  let score = 100
  if (ref.provenance === 'user_upload') {
    score -= 50
  }
  if (ref.category === 'primary_brand_mark') {
    score -= 20
  }
  if (ref.in_home_link === true) {
    score -= 10
  }
  if (
    ref.category === 'favicon' ||
    ref.category === 'hero' ||
    ref.category === 'product_screenshot'
  ) {
    score -= 5
  }
  return score
}

function synthesizeFileName(
  businessName: string,
  bucket: BrandStagedAssetBucket,
  ref: StagedAssetRef,
): string {
  const descriptor =
    ref.description?.trim() || ref.category?.replace(/_/g, ' ') || `${bucket} asset`
  return `${businessName} ${bucket} - ${descriptor}`
}
