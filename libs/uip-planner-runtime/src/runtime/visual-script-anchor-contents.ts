import type { Content } from '@reelmakeeasy/common/llm'
import { createSubLogger } from '@reelmakeeasy/common/logger'

import { createPlannerStorage } from '../persistence'
import { mapWithConcurrency, uploadedAssetToContent } from '../tool-internals/anchor-utils'
import type { AnchorAssetPlanArtifact, UploadedAsset } from '../types'

import { plannerLog } from './planner-log'

const logger = createSubLogger('user-intent-planner')

// Longest-edge cap (px) for the raw source image fed to vs_main, matching the
// asset-manager's UIP_ANCHOR_ASSET_MANAGER_MAX_LONG_EDGE.
// vs_main only needs the anchor's IDENTITY, not full resolution; capping keeps
// the multimodal payload from regressing token cost versus the ~1k generated
// previews this path used to feed.
const VS_ANCHOR_SOURCE_MAX_LONG_EDGE = 1536

// Bound concurrent source-image loads (storage read + raster + downscale). Anchor
// counts are small; 6 covers the multi-anchor tail without hammering storage.
const VS_ANCHOR_SOURCE_CONCURRENCY = 6

/**
 * Build the multimodal image blocks vs_main receives for its anchors, keyed on
 * the anchor PLAN (Phase A) -- NOT on generated previews (Phase C). This is what
 * de-serializes anchor_vs_batch: vs_main no longer awaits the anchor arm's full
 * image generation; it runs right after the plan resolves.
 *
 * For each candidate that has a source upload present in `uploadedAssets`, feed
 * the RAW uploaded source image (downscaled) preceded by an
 * `[asset_id: <anchor_id>]` marker. Source-backed non-passthrough, passthrough
 * (source == final), and multi-source anchors all take this path -- the raw
 * source conveys the identity vs_main needs (it is style-agnostic, so the styled
 * render it used to receive was never usable anyway). Source-less
 * (LLM-generated) candidates carry no image: vs_main relies on their
 * `visual_reference` text from the Anchor Assets JSON instead.
 *
 * `promptRoute === 'abstract'` returns [] (no anchor imagery on the abstract
 * route), matching the prior behavior.
 */
export async function resolveAnchorImageContentsForVisualScript(params: {
  anchorPlan: AnchorAssetPlanArtifact | null
  promptRoute: string
  sessionId: string
  uploadedAssets: UploadedAsset[]
}): Promise<Content[]> {
  if (params.promptRoute === 'abstract') {
    return []
  }

  const candidates = params.anchorPlan?.candidates ?? []
  if (candidates.length === 0) {
    return []
  }

  const uploadsById = new Map(params.uploadedAssets.map((asset) => [asset.asset_id, asset]))
  // Per candidate, pick the FIRST source id that actually resolves in the upload
  // pool -- a multi-source anchor's primary may have been deduped/removed while a
  // later `source_asset_ids` entry is still present, so don't stop at the first
  // id. Candidates with no resolvable source (LLM-generated / source-less) get
  // no image: vs_main uses their `visual_reference` text from the Anchor Assets
  // JSON instead.
  const candidateSources = candidates
    .map((candidate) => {
      const sourceId = [candidate.source_asset_id ?? '', ...(candidate.source_asset_ids ?? [])]
        .map((id) => id?.trim() ?? '')
        .find((id) => id.length > 0 && uploadsById.has(id))
      return sourceId ? { anchorId: candidate.anchor_id, sourceId } : null
    })
    .filter((entry): entry is { anchorId: string; sourceId: string } => entry !== null)
  if (candidateSources.length === 0) {
    return []
  }

  // Resolve each UNIQUE source once, concurrently: the storage read + raster +
  // downscale is independent per source, and two candidates can share one, so a
  // serial loop would negate part of the latency win and double-fetch shared
  // sources. A per-source failure is skipped (that anchor falls back to its
  // visual_reference text) and never fails the whole VS call.
  const storage = createPlannerStorage(params.sessionId)
  const uniqueSourceIds = [...new Set(candidateSources.map((entry) => entry.sourceId))]
  const contentBySourceId = new Map<string, Content>()
  await mapWithConcurrency(uniqueSourceIds, VS_ANCHOR_SOURCE_CONCURRENCY, async (sourceId) => {
    const upload = uploadsById.get(sourceId)
    if (!upload) {
      return
    }
    try {
      contentBySourceId.set(
        sourceId,
        await uploadedAssetToContent(upload, storage, {
          maxLongEdge: VS_ANCHOR_SOURCE_MAX_LONG_EDGE,
        }),
      )
    } catch (error) {
      logger.warn(
        plannerLog(
          params.sessionId,
          '[uip-visual-script] failed to load anchor source image; skipping (vs_main falls back to visual_reference text)',
          {
            error: error instanceof Error ? error.message : String(error),
            sourceAssetId: sourceId,
          },
        ),
      )
    }
  })

  // Emit in candidate (plan) order so the [asset_id] markers stay stable.
  const contents: Content[] = []
  for (const { anchorId, sourceId } of candidateSources) {
    const imageContent = contentBySourceId.get(sourceId)
    if (imageContent) {
      contents.push({ type: 'text', text: `[asset_id: ${anchorId}]` }, imageContent)
    }
  }
  return contents
}
