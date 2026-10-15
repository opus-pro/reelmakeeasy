/**
 * Describe staged brand assets at extraction time so the anchor-binding LLM
 * sees rich text descriptions for `brand_<bucket>_<hash>` IDs the same way it
 * does for user uploads. Also use the LLM verdict to re-classify each ref's
 * bucket (logo / product / character), correcting the crawler's heuristic
 * (e.g. a hero photo of a person ends up in `product` because of dimensions;
 * the LLM moves it to `character`).
 *
 * Defense in depth: when the crawler tagged a ref as `category: 'primary_brand_mark'`
 * and the LLM says it's not a logo, trust the crawler and override to `logo`.
 * Primary-brand-mark is a strong structural signal (the `<img>` inside an
 * `<a href="/">` at the page header); an LLM misclassification can lose this.
 *
 * Best-effort: any throw degrades to "crawler buckets, no descriptions" and
 * the workflow proceeds. Treat as enrichment, never blocking.
 */
import { createSubLogger } from '@reelmakeeasy/common/logger'
import type {
  AssetDescriptionItem,
  StagedAssetRef,
  UploadedAsset,
} from '@reelmakeeasy/uip-planner-runtime'
import { mapWithConcurrency } from '@reelmakeeasy/uip-planner-runtime/tool-internals/anchor-utils'
import {
  type BrandStagedAssetBucket,
  FALLBACK_MIME,
  inferContentType,
  synthesizeBrandAssetId,
} from '@reelmakeeasy/uip-planner-runtime/tool-internals/brand-staged-assets-to-uploads'
import {
  generateImageDescription,
  type ImageDescription,
  normalizeAssetDescription,
} from '@reelmakeeasy/uip-planner-runtime/tools/describe-uploaded-images'

import type { StagedAssetCandidates } from './crawl-brand-site'
import { filterBrandLogos } from './logo-relevance'

const logger = createSubLogger('brand-describe-staged-assets')

const BUCKETS: readonly BrandStagedAssetBucket[] = ['logo', 'product', 'character'] as const

// Mirrors `DESCRIBE_IMAGE_CONCURRENCY` in describe-uploaded-images.ts. Kept
// private (not imported) so the brand-extraction worker can tune independently
// if brand sessions ever differ from the planner-loop describe pass.
const DESCRIBE_CONCURRENCY = 3

export interface DescribeStagedAssetsActivityInput {
  /**
   * Authoritative brand name from synthesize, threaded in so logos can be
   * checked for brand ownership. Absent on the pre-reorder (parallel) path;
   * when absent or empty the relevance filter is skipped (all logos kept).
   */
  brandName?: string
  projectId: string
  runId: string
  stagedAssetCandidates: StagedAssetCandidates
}

export interface DescribeStagedAssetsActivityResult {
  assetDescriptions: AssetDescriptionItem[]
  rebucketedCandidates: StagedAssetCandidates
}

interface FlatEntry {
  crawlerBucket: BrandStagedAssetBucket
  ref: StagedAssetRef
}

export async function describeStagedAssetsActivity(
  input: DescribeStagedAssetsActivityInput,
): Promise<DescribeStagedAssetsActivityResult> {
  const { projectId, runId, stagedAssetCandidates } = input
  const degraded: DescribeStagedAssetsActivityResult = {
    assetDescriptions: [],
    rebucketedCandidates: stagedAssetCandidates,
  }

  try {
    const flat = flattenCandidates(stagedAssetCandidates)
    if (flat.length === 0) {
      return degraded
    }

    // Partition: only refs with a recognized image MIME go to OpenAI.
    // Refs whose extension infers to FALLBACK_MIME (.ico, no extension,
    // CDN URLs with query strings, ...) would 400 the entire batch on
    // unsupported MIME -- losing descriptions for ALL refs. Skipped refs
    // stay in their crawler buckets with the crawler's description.
    const describable: FlatEntry[] = []
    const skipped: FlatEntry[] = []
    for (const entry of flat) {
      if (inferContentType(entry.ref.staging_uri) === FALLBACK_MIME) {
        skipped.push(entry)
      } else {
        describable.push(entry)
      }
    }

    const rebucketed: StagedAssetCandidates = { character: [], logo: [], product: [] }
    const descriptions: AssetDescriptionItem[] = []

    // Skipped refs pass through unchanged in their crawler bucket.
    for (const { ref, crawlerBucket } of skipped) {
      rebucketed[crawlerBucket].push(ref)
    }

    if (describable.length === 0) {
      logger.warn(
        `[${projectId}/${runId}] no describable refs (all ${skipped.length} skipped on unsupported MIME); keeping crawler buckets`,
      )
      return { assetDescriptions: [], rebucketedCandidates: rebucketed }
    }

    const describeProjectId = `${projectId}/brand-extract/${runId}`
    const tempUploads: UploadedAsset[] = describable.map(({ ref, crawlerBucket }) =>
      buildTempUpload(ref, crawlerBucket),
    )

    const imageDescriptions: ImageDescription[] = await mapWithConcurrency(
      tempUploads,
      DESCRIBE_CONCURRENCY,
      (asset) => generateImageDescription(asset, { projectId: describeProjectId }),
    )

    for (let i = 0; i < describable.length; i++) {
      const entry = describable[i]
      const imageDesc = imageDescriptions[i]
      const tempUpload = tempUploads[i]
      if (!entry || !imageDesc || !tempUpload) {
        continue
      }
      const { ref, crawlerBucket } = entry
      const finalBucket = decideFinalBucket(crawlerBucket, ref, imageDesc.brand_asset_kind)
      const updatedRef: StagedAssetRef = {
        ...ref,
        asset_kind: finalBucket,
        description: imageDesc.summary?.trim() || ref.description,
      }
      rebucketed[finalBucket].push(updatedRef)

      const finalUpload: UploadedAsset = {
        ...tempUpload,
        asset_id: synthesizeBrandAssetId(ref.staging_uri, finalBucket),
      }
      descriptions.push(normalizeAssetDescription(finalUpload, imageDesc))
    }

    return await applyLogoRelevance(input, rebucketed, descriptions)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.warn(
      `[${projectId}/${runId}] describeStagedAssetsActivity failed; falling back to crawler buckets: ${message}`,
    )
    return degraded
  }
}

/**
 * Drop logos that are not this brand's own mark (sponsor / third-party). No-op
 * when no brand name was threaded in (pre-reorder path) or the logo bucket is
 * empty. Filters both the rebucketed logo refs and their asset descriptions by
 * the dropped staging URIs so the handoff stays consistent.
 */
async function applyLogoRelevance(
  input: DescribeStagedAssetsActivityInput,
  rebucketed: StagedAssetCandidates,
  descriptions: AssetDescriptionItem[],
): Promise<DescribeStagedAssetsActivityResult> {
  const unfiltered: DescribeStagedAssetsActivityResult = {
    assetDescriptions: descriptions,
    rebucketedCandidates: rebucketed,
  }
  if (!input.brandName || rebucketed.logo.length === 0) {
    return unfiltered
  }

  const { droppedUris } = await filterBrandLogos({
    brandName: input.brandName,
    logos: rebucketed.logo,
    projectId: input.projectId,
    runId: input.runId,
  })
  if (droppedUris.size === 0) {
    return unfiltered
  }

  const droppedAssetIds = new Set(
    [...droppedUris].map((uri) => synthesizeBrandAssetId(uri, 'logo')),
  )
  return {
    assetDescriptions: descriptions.filter((d) => !droppedAssetIds.has(d.asset_id)),
    rebucketedCandidates: {
      ...rebucketed,
      logo: rebucketed.logo.filter((ref) => !droppedUris.has(ref.staging_uri)),
    },
  }
}

function buildTempUpload(
  ref: StagedAssetRef,
  crawlerBucket: BrandStagedAssetBucket,
): UploadedAsset {
  return {
    asset_id: synthesizeBrandAssetId(ref.staging_uri, crawlerBucket),
    content_type: inferContentType(ref.staging_uri),
    file_name: extractBasename(ref.staging_uri),
    file_path: ref.staging_uri,
    uploaded_at: new Date().toISOString(),
  }
}

function decideFinalBucket(
  crawlerBucket: BrandStagedAssetBucket,
  ref: StagedAssetRef,
  llmKind: ImageDescription['brand_asset_kind'],
): BrandStagedAssetBucket {
  if (llmKind == null) {
    return crawlerBucket
  }
  if (ref.category === 'primary_brand_mark' && llmKind !== 'logo') {
    return 'logo'
  }
  return llmKind
}

function extractBasename(stagingUri: string): string {
  const slash = stagingUri.lastIndexOf('/')
  return slash === -1 ? stagingUri : stagingUri.slice(slash + 1)
}

function flattenCandidates(candidates: StagedAssetCandidates): FlatEntry[] {
  const out: FlatEntry[] = []
  for (const bucket of BUCKETS) {
    for (const ref of candidates[bucket]) {
      out.push({ crawlerBucket: bucket, ref })
    }
  }
  return out
}
