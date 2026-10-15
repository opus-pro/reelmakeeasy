/**
 * Activity: merge UIP user-uploaded images into the story-mode anchor index.
 *
 * Called in UipToStoryModeFastWorkflow AFTER runAnchorAssetsStage has already
 * run the full AI anchor generation pipeline and written styled+raw anchor
 * indexes. This activity reads those indexes, appends entries for any
 * user-uploaded images from the UIP session (image/* only), and writes back
 * the merged result.
 *
 * This is equivalent to the buildUserUploadAnchorEntries injection that
 * executeConfirmOrchestration performs in the full UIP flow, but executed
 * inside the workflow rather than in the API layer.
 *
 * If no image assets are provided, this is a no-op (existing indexes unchanged).
 */

import { createSubLogger } from '@reelmakeeasy/common/logger'

import type { UipFastPathUploadedAsset } from '../../workflows/uip-to-story-mode/types'

import {
  createLongTakeStorage,
  LONG_TAKE_ANCHOR_RAW_INDEX_PATH,
  LONG_TAKE_ANCHOR_STYLED_INDEX_PATH,
  readLongTakeAnchorIndex,
} from './storage'

const logger = createSubLogger('story-mode-runtime')

export interface InitUipFastPathAnchorIndexParams {
  projectId: string
  uploadedAssets?: UipFastPathUploadedAsset[]
}

export interface InitUipFastPathAnchorIndexResult {
  uploadedAnchorCount: number
}

export async function initUipFastPathAnchorIndex(
  params: InitUipFastPathAnchorIndexParams,
): Promise<InitUipFastPathAnchorIndexResult> {
  const { projectId, uploadedAssets = [] } = params

  // Filter to image assets only -- matches buildUserUploadAnchorEntries behaviour
  // in executeConfirmOrchestration which skips non-image uploads.
  const imageAssets = uploadedAssets.filter((a) => a.contentType?.startsWith('image/'))

  if (imageAssets.length === 0) {
    logger.info(`[uip-fast-path] no user image uploads to merge projectId=${projectId}`)
    return { uploadedAnchorCount: 0 }
  }

  const storage = createLongTakeStorage(projectId)

  // Read the existing anchor indexes produced by runAnchorAssetsStage.
  const [styledIndex, rawIndex] = await Promise.all([
    readLongTakeAnchorIndex(storage, LONG_TAKE_ANCHOR_STYLED_INDEX_PATH),
    readLongTakeAnchorIndex(storage, LONG_TAKE_ANCHOR_RAW_INDEX_PATH),
  ])

  const uploadEntries = imageAssets.map((asset) => ({
    asset_id: asset.assetId,
    anchor_uri: asset.fileUri,
    effective_anchor_uri: asset.fileUri,
    raw_anchor_uri: asset.fileUri,
    styled_anchor_uri: null,
    prompt_text: asset.fileName ?? asset.assetId,
    status: 'raw',
    source_file_ids: [asset.assetId],
    source_image_uris: [asset.fileUri],
    // Marks these as raw passthrough (user-supplied, not AI-generated).
    // Parity with buildUserUploadAnchorEntries in executeConfirmOrchestration.
    source_passthrough: true,
  }))

  // Append user uploads to existing AI-generated anchors, deduplicating by
  // asset_id so retries after a partial write do not produce duplicate entries.
  const uploadAssetIds = new Set(uploadEntries.map((e) => e.asset_id))
  const mergedStyledIndex = {
    assets: [
      ...styledIndex.assets.filter((a) => !uploadAssetIds.has(a.asset_id)),
      ...uploadEntries,
    ],
  }
  const mergedRawIndex = {
    assets: [...rawIndex.assets.filter((a) => !uploadAssetIds.has(a.asset_id)), ...uploadEntries],
  }

  await Promise.all([
    storage.writeJsonFile(LONG_TAKE_ANCHOR_STYLED_INDEX_PATH, mergedStyledIndex),
    storage.writeJsonFile(LONG_TAKE_ANCHOR_RAW_INDEX_PATH, mergedRawIndex),
  ])

  logger.info(
    `[uip-fast-path] merged user uploads into anchor index projectId=${projectId} uploadedCount=${imageAssets.length} totalStyled=${mergedStyledIndex.assets.length} totalRaw=${mergedRawIndex.assets.length}`,
  )

  return { uploadedAnchorCount: imageAssets.length }
}
