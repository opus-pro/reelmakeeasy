/**
 * Multimodal input for the first `mode_confirmation` planner call.
 *
 * Why this exists: at session start the user often uploads images
 * alongside their text prompt ("make a 30s video about this product"
 * + product photos). Pre-multimodal the planner only saw
 * `asset_context_light.has_uploaded_assets` as a boolean -- it knew
 * something was uploaded but not what. So mode/duration inference
 * stalled on ASK_CLARIFY when an image would have answered the
 * question (portrait photo -> narrative, product shots -> ads,
 * screen recording -> explainer).
 *
 * Scope (locked-in via design review):
 *   - Only the FIRST chain start of the mode_confirmation segment.
 *     Continuation turns of mode_confirmation do NOT re-send images
 *     (chain memory holds them); users cannot upload new images
 *     mid-mode_confirmation in the current UI so the carry-over is
 *     mostly defensive.
 *   - post_confirmation segment is untouched. It uses the
 *     `describe_uploaded_images` tool to produce structured
 *     descriptions that downstream tools (script/visual gen) can
 *     consume; raw images would not give that surface area.
 *   - Filter: LLM-compatible raster MIMEs only (png / jpeg / webp /
 *     gif). Non-image uploads (audio, video, pdf) and LLM-incompatible
 *     images (SVG / HEIC / ...) that failed promote-time rasterization
 *     are dropped here -- sending them inline 400s the vision model and
 *     fails the whole turn.
 *
 * Encoding: read each image via the agent-v2 storage layer and
 * inline it as a `data:` URI. `file_path` on `UploadedAsset` is a
 * project-relative path (`uploads/...`), not a `store://...` URI, so
 * the SDK's bare-URI handling cannot consume it directly. Routing
 * the read through `createStorage()` also keeps us consistent with
 * how `describe_uploaded_images` already serves uploaded images to
 * Gemini -- same project-root, same auth path, same failure modes.
 *
 * Failure mode: if any individual image read fails, drop that image
 * (WARN log) and continue with the remainder rather than aborting
 * the planner call. The session still progresses with whatever
 * images we could load; a fully-failed read returns an empty array
 * and the planner reverts to the pre-multimodal text-only path.
 *
 * Token cost: OpenAI applies `detail: "low"` (SDK-hardcoded), so
 * each image costs ~85 input tokens. 20 images ~= 1700 tokens --
 * negligible. The raw base64 payload is larger (a few MB per
 * image), but that's request-time bandwidth, not chat-context
 * tokens.
 */

import { createStorage } from '@reelmakeeasy/common/agent-v2/storage/storage'
import { createSubLogger } from '@reelmakeeasy/common/logger'
import type { Content } from '@reelmakeeasy/llm'

import { isLlmCompatibleImageAsset } from '../tool-internals/llm-image-mime'
import type { SessionState, UploadedAsset } from '../types'

const logger = createSubLogger('user-intent-planner')

/**
 * Maximum number of image uploads forwarded to the planner on the
 * mode_confirmation chain-start call. 20 leaves headroom over the
 * 99th-percentile session upload count (typically <5) without
 * letting an outlier session blow the request size. Extras are
 * silently dropped + WARN-logged so we can spot it in the logs if
 * it ever happens at meaningful rate.
 */
export const IMAGE_ATTACHMENT_CAP = 20

/**
 * Build the multimodal content array to attach to the first
 * mode_confirmation planner call. Returns an EMPTY array (not
 * undefined) when there are no images -- caller checks `length > 0`
 * to decide whether to pass it to the SDK.
 *
 * Sort order is `uploaded_at` ascending so the planner sees images
 * in the chronological order the user attached them (matches what
 * the user just typed about). Stable order is also chain-cache
 * friendly: identical uploads on a re-run produce an identical
 * payload, so OpenAI's prefix cache can hit.
 */
export async function buildModeConfirmationImageContents(
  session: SessionState,
): Promise<Content[]> {
  const uploadedAssets = session.cached_artifacts.uploaded_assets ?? []
  const isCompatible = (asset: UploadedAsset): boolean =>
    isLlmCompatibleImageAsset({ contentType: asset.content_type, fileName: asset.file_name })
  // `uploaded_at` is typed as required but the API constructs assets without
  // normalizing it (it's optional upstream), so it can be undefined here. A
  // bare `a.uploaded_at.localeCompare(...)` throws and kills the whole
  // planner turn -- guard with `?? ''`, matching planner-recovery's sort.
  const imageAssets = uploadedAssets
    .filter(isCompatible)
    .slice()
    .sort((a, b) => (a.uploaded_at ?? '').localeCompare(b.uploaded_at ?? ''))

  const droppedIncompatible = uploadedAssets.filter(
    (asset) => asset.content_type.startsWith('image/') && !isCompatible(asset),
  )
  if (droppedIncompatible.length > 0) {
    logger.warn(
      `[user-intent-planner] [callPlanner] dropped ${droppedIncompatible.length} LLM-incompatible image upload(s) from mode_confirmation ${JSON.stringify(
        {
          sessionId: session.sessionId,
          dropped: droppedIncompatible.map((a) => ({
            assetId: a.asset_id,
            contentType: a.content_type,
          })),
        },
      )}`,
    )
  }

  if (imageAssets.length === 0) {
    return []
  }

  const truncated = imageAssets.length > IMAGE_ATTACHMENT_CAP
  const selected = truncated ? imageAssets.slice(0, IMAGE_ATTACHMENT_CAP) : imageAssets

  if (truncated) {
    logger.warn(
      `[user-intent-planner] [callPlanner] mode_confirmation upload count ${imageAssets.length} exceeds cap ${IMAGE_ATTACHMENT_CAP}; truncating ${
        imageAssets.length - IMAGE_ATTACHMENT_CAP
      } image(s) ${JSON.stringify({
        sessionId: session.sessionId,
        droppedAssetIds: imageAssets.slice(IMAGE_ATTACHMENT_CAP).map((a) => a.asset_id),
      })}`,
    )
  }

  // Same projectId scheme as `runDescribeUploadedImagesTool` so both
  // surfaces resolve the same project root and share auth.
  //
  // Storage bootstrap is wrapped in its own try / catch so a transient
  // storage / auth / factory failure degrades to the text-only path -- same
  // semantics as a fully-failed read loop below. Without this, the
  // throw would escape callPlanner entirely (there is no outer
  // try/catch around `resolveCallPlannerContents`) and fail the whole
  // planner turn, exactly the failure mode the per-image try / catch
  // is meant to prevent.
  const projectId = `${session.sessionId}/user-intent-planner`
  let storage: Awaited<ReturnType<typeof createStorage>>
  try {
    storage = await createStorage(projectId)
  } catch (err) {
    logger.warn(
      `[user-intent-planner] [callPlanner] failed to bootstrap storage for mode_confirmation images; falling back to text-only ${JSON.stringify(
        {
          sessionId: session.sessionId,
          imageCount: selected.length,
          message: err instanceof Error ? err.message : String(err),
        },
      )}`,
    )
    return []
  }
  const results = await Promise.all(
    selected.map(async (asset) => {
      try {
        const buffer = await storage.readFile(asset.file_path)
        const mimeType = asset.content_type || 'image/jpeg'
        const dataUri = `data:${mimeType};base64,${buffer.toString('base64')}`
        return toImageContent(dataUri)
      } catch (err) {
        logger.warn(
          `[user-intent-planner] [callPlanner] failed to load mode_confirmation image; dropping ${JSON.stringify(
            {
              sessionId: session.sessionId,
              assetId: asset.asset_id,
              fileUri: asset.file_path,
              message: err instanceof Error ? err.message : String(err),
            },
          )}`,
        )
        return null
      }
    }),
  )
  return results.filter((c): c is Content => c !== null)
}

function toImageContent(imageUrl: string): Content {
  return {
    type: 'image_url',
    imageUrl,
  }
}
