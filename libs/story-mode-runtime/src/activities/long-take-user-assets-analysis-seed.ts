import type {
  AnalyzeLongTakeUserAssetsActivityResult,
  LongTakeUserAssetCatalogItem,
} from '../workflows/long-take/types'

import { createLongTakeStorage } from './long-take/storage'
import { LONG_TAKE_ASSET_MANIFEST_PATH } from './long-take-experts-analysis'
import { LONG_TAKE_USER_ASSETS_ANALYSIS_PATH } from './long-take-user-assets-analysis'

type RawManifestEntry = {
  source?: null | string
  source_file_id?: null | string
}

/**
 * Writes a pre-seeded user_assets_analysis.json using the source_file_id
 * values from UIP's pre-built asset_manifest.json (written by
 * buildOptionalHandoffSaves before this workflow starts). Only USER_FILE
 * entries are included so validFileIds in the manifest expert covers exactly
 * the assets UIP already resolved. Falls back to all catalog images only if
 * the manifest is missing or unreadable; writes an empty files list when the
 * manifest exists but contains no USER_FILE entries.
 */
export async function seedLongTakeUserAssetsAnalysis(params: {
  projectId: string
  userAssetCatalog: LongTakeUserAssetCatalogItem[]
  userId: string
}): Promise<AnalyzeLongTakeUserAssetsActivityResult> {
  const { projectId, userAssetCatalog } = params
  const storage = createLongTakeStorage(projectId)

  const allCatalogFiles = userAssetCatalog.map((item) => ({
    file_id: item.fileId,
    mime: item.mime,
    shortname: item.shortname,
    storage_uri: item.storageUri,
  }))
  let files = allCatalogFiles

  try {
    const raw = await storage.readJsonFile<{ asset_manifest?: RawManifestEntry[] }>(
      LONG_TAKE_ASSET_MANIFEST_PATH,
    )
    const userFileIds = new Set(
      (raw?.asset_manifest ?? [])
        .filter((e) => e.source === 'USER_FILE' && e.source_file_id)
        .map((e) => e.source_file_id as string),
    )

    const catalogById = new Map(userAssetCatalog.map((item) => [item.fileId, item]))
    const matched = Array.from(userFileIds)
      .map((id) => catalogById.get(id))
      .filter((item): item is LongTakeUserAssetCatalogItem => item !== undefined)
    files = matched.map((item) => ({
      file_id: item.fileId,
      mime: item.mime,
      shortname: item.shortname,
      storage_uri: item.storageUri,
    }))
  } catch {
    // manifest not yet written or unreadable - fall back to all catalog images
  }

  await storage.writeJsonFile(LONG_TAKE_USER_ASSETS_ANALYSIS_PATH, {
    characters: [],
    files,
    objects: [],
    summary: { matched: files.length, unresolved: 0 },
  })

  return {
    contextSummary: undefined,
    fileCount: files.length,
    matchedCount: files.length,
    outputPath: LONG_TAKE_USER_ASSETS_ANALYSIS_PATH,
    unresolvedCount: 0,
  }
}
