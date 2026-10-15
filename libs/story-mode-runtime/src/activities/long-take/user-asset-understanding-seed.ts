import type {
  AssetDescriptionItem,
  AssetDescriptionsArtifact,
} from '@reelmakeeasy/uip-planner-runtime'

import {
  type LongTakeUserAssetUnderstandingModelOutput,
  LongTakeUserAssetUnderstandingModelOutputSchema,
} from '../long-take-user-assets-understanding'

// UIP-v2's describe_uploaded_images tool captions every uploaded image during
// planning and persists the result here (see uip-planner-runtime
// persistAssetDescriptions -> assets/image_description.json, under the sibling
// user-intent-planner/ subtree of the project root). createLongTakeStorage is
// rooted at the project, so this relative path reaches the planner artifact.
// Reusing it on the UIP fast path skips the redundant long-take vision call
// (the story-mode re-captioning is the call that tends to time out).
export const UIP_ASSET_DESCRIPTIONS_PATH = 'user-intent-planner/assets/image_description.json'

/** Minimal read surface of the long-take ProjectStore, kept structural for tests. */
export interface AssetDescriptionStorageReader {
  exists(path: string): Promise<boolean>
  readJsonFile(path: string): Promise<AssetDescriptionsArtifact>
}

/**
 * Load UIP's per-image descriptions and index them by `asset_id`. Best-effort:
 * a missing artifact (classic long-take path, or a session with no image
 * uploads) or any read error yields an empty map, so every asset falls through
 * to the vision model -- the legacy behavior. Only items with a real
 * description are kept; blank/failed UIP entries are re-captioned downstream.
 *
 * @example
 * ```ts
 * const seeded = await loadUipAssetDescriptionMap(createLongTakeStorage(projectId))
 * const reuse = seeded.get(catalogItem.fileId) // fileId === UIP asset_id
 * ```
 */
export async function loadUipAssetDescriptionMap(
  storage: AssetDescriptionStorageReader,
): Promise<Map<string, AssetDescriptionItem>> {
  const byAssetId = new Map<string, AssetDescriptionItem>()
  try {
    if (!(await storage.exists(UIP_ASSET_DESCRIPTIONS_PATH))) {
      return byAssetId
    }
    const artifact = await storage.readJsonFile(UIP_ASSET_DESCRIPTIONS_PATH)
    for (const item of artifact?.items ?? []) {
      if (item?.asset_id && item.description && item.description.trim()) {
        byAssetId.set(item.asset_id, item)
      }
    }
  } catch {
    // Best-effort: no artifact / unreadable -> empty map -> vision model handles all.
  }
  return byAssetId
}

/**
 * Adapt a UIP {@link AssetDescriptionItem} to the long-take vision-model output
 * shape so a seeded asset flows through the SAME
 * `normalizeLongTakeUserAssetUnderstandingModelOutput` path as a real model
 * call. `likely_role` is left undefined so the normalizer derives it (from
 * characters / shortname), matching the model path. UIP doesn't emit
 * `low_quality` / `watermark`, so they take the schema defaults.
 */
export function uipDescriptionToModelOutput(
  item: AssetDescriptionItem,
): LongTakeUserAssetUnderstandingModelOutput {
  // Parse a partial through the model schema so quality.low_quality / watermark
  // (and entities / tags) inherit the SAME defaults a real model call gets,
  // rather than re-hardcoding them here. likely_role is left unset so the
  // normalizer derives it (from characters / shortname), matching the model path.
  return LongTakeUserAssetUnderstandingModelOutputSchema.parse({
    description: item.description,
    entities: item.entities,
    quality: { text_heavy_infographic: item.quality.text_heavy_infographic },
    // Conditional spread: an item with no setting must parse to no setting, so
    // its ABSENCE keeps meaning "never split" rather than "split, found none".
    ...(item.setting ? { setting: item.setting } : {}),
    tags: item.tags,
    usage_guidance: item.usage_guidance,
  })
}
