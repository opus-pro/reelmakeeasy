/**
 * UIP planner spec -> story-mode (long-take) render-format bridge.
 *
 * These pure converters translate a UIP planner `Spec` + `AnchorAssetsSummary`
 * into the long-take render artifacts the story-mode render pipeline consumes:
 * `long_take/visual_script.json`, `anchors/{styled,raw}/index.json`,
 * `experts/asset_manifest.json`, `global_constraints.json`.
 *
 * Both UIP handoff paths import this ONE implementation, so they never drift:
 *   - normal confirm -> apps/services/api/src/uip/uip-confirm-orchestration.ts
 *   - fast path      -> convertUipFastToLongTakeArtifactsActivity (worker)
 */

import { createSubLogger } from '@reelmakeeasy/common/logger'
import type { LongTakeVisualScriptItem } from '@reelmakeeasy/common/long-take/types'

import type {
  AnchorAssetCandidate,
  AnchorAssetsSummary,
  AnchorAssetSummaryItem,
} from '../anchor-types'
import type { Spec, UploadedAsset } from '../types'
import { isStoreUri, storeUri } from '@reelmakeeasy/common/storage/stored-files'

const logger = createSubLogger('uip-story-mode-handoff')

export interface StoryModeAnchorIndexEntry {
  anchor_uri: null | string
  asset_id: string
  effective_anchor_uri: null | string
  prompt_text: null | string
  raw_anchor_uri: null | string
  source_file_ids: string[]
  source_image_uris: string[]
  source_passthrough?: boolean
  status: null | string
  styled_anchor_uri?: null | string
}

const INLINE_TTS_EMOTION_TAG_REGEX = /\[[^\]\n]{1,48}\]\s*/g
const INLINE_TTS_PRONUNCIATION_REGEX = /\{([^{}|/\n]{1,80})\|([^{}\n]{1,160})\}/g

export function convertUipAnchorsToStoryModeIndex(
  anchors: AnchorAssetsSummary | null | undefined,
  getFullPath: (relativePath: string) => string,
): StoryModeAnchorIndexEntry[] {
  if (!anchors?.anchors) {
    return []
  }

  return anchors.anchors
    .filter(
      (a): a is AnchorAssetSummaryItem & { preview_relative_path: string } =>
        a.status === 'ready' && Boolean(a.preview_relative_path),
    )
    .map((a) => {
      const fileUri = getFullPath(a.preview_relative_path)
      return {
        asset_id: a.anchor_id,
        anchor_uri: fileUri,
        effective_anchor_uri: fileUri,
        raw_anchor_uri: fileUri,
        styled_anchor_uri: fileUri,
        prompt_text: a.label,
        status: 'styled',
        source_file_ids: a.source_asset_ids,
        source_image_uris: [],
        // UIP's Plan-LLM-judged passthrough signal (logo / icon / brand
        // mark). UIP already enforces single-source + shared-source
        // downgrade in its Plan normalizer, so this value is safe.
        source_passthrough: a.passthrough,
      }
    })
}

export function convertUipSpecToStoryModeVisualScript(
  spec: Pick<Spec, 'meta' | 'visual_script'>,
): LongTakeVisualScriptItem[] {
  // Story Mode 3.0 fields are emitted ONLY for a gate-on session, off the pinned
  // snapshot. They are not inert otherwise: this artifact is serialized verbatim
  // into the V2 keyframe-prompt LLM call, so writing them unconditionally would
  // change the prompt every production project sends.
  const storyModeV3Enabled = spec.meta?.story_mode_v3_enabled === true
  // Copy before sort -- this is a pure converter; never reorder the caller's
  // spec.visual_script.shots in place.
  return [...spec.visual_script.shots]
    .sort((a, b) => a.order - b.order)
    .map((shot) => ({
      audio: stripInlineTtsMarkupForDisplay(shot.audio_vo),
      shot_id: shot.shot_id,
      // The planner's own timing, used by the V3 realign step as the fallback for
      // shots its transcript alignment cannot place.
      ...(storyModeV3Enabled && { time: shot.time ?? null }),
      used_asset_id: (shot.pre_selected_assets ?? []).map((a) => a.asset_id),
      visual: {
        // One key, not two. `description` used to carry the identical value as a
        // legacy alias for the V2 video-prompt meta-prompt, which now names
        // `core_description` like every other reader and like the upstream UIP
        // route prompts. The artifact is serialized verbatim into the keyframe
        // meta-prompt, so the duplicate put every shot's description in that
        // payload twice.
        core_description: shot.visual_primary.core_description ?? null,
        aesthetic_mode: shot.visual_primary.aesthetic_mode,
        expression_type: shot.visual_primary.expression_type,
        availability: shot.visual_primary.availability,
        entry_action: shot.visual_primary.entry_action ?? null,
        exit_action: shot.visual_primary.exit_action ?? null,
        notes: shot.visual_primary.notes ?? null,
        ...(storyModeV3Enabled && {
          transition_to_next: shot.visual_primary.transition_to_next ?? null,
        }),
      },
    }))
}

export function extractScriptFromSpec(spec: Pick<Spec, 'visual_script'>): string {
  return [...spec.visual_script.shots]
    .sort((a, b) => a.order - b.order)
    .map((s) => s.audio_vo)
    .join('\n')
}

export function stripInlineTtsMarkupForDisplay(text: string): string {
  return text
    .replace(INLINE_TTS_PRONUNCIATION_REGEX, (_, rawWord) => String(rawWord).trim())
    .replace(INLINE_TTS_EMOTION_TAG_REGEX, '')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .trim()
}

/**
 * Convert a UIP `AnchorAssetCandidate` into a story-mode asset_manifest
 * entry. Mirrors the shape declared in
 * `libs/story-mode-runtime/src/activities/long-take-experts-analysis.ts`
 * (`LongTakeAssetManifestModelOutputSchema`).
 */
export function buildAssetManifestEntry(candidate: AnchorAssetCandidate): {
  asset_id: string
  is_multi_angle: boolean
  keyword: string
  prompt_transform: null | string
  proper_name: null | string
  role: string
  source: 'USER_FILE' | null
  source_file_id: null | string
  source_passthrough?: boolean
  type: 'Character' | 'Prop'
  visual_reference: string
  visual_tag: string
} {
  const primarySourceId =
    candidate.source_asset_id?.trim() || candidate.source_asset_ids?.[0]?.trim() || null
  return {
    asset_id: candidate.anchor_id,
    is_multi_angle: candidate.is_multi_angle ?? false,
    keyword: candidate.keyword?.trim() || candidate.label?.trim() || candidate.anchor_id,
    // The form the user's pinned prompt asked this subject to take
    // ("a pirate"), so story mode's keyframe layer can see that the anchor is a
    // transformed subject rather than the as-uploaded one. null when the anchor
    // is the as-uploaded appearance, which is every plan made before transforms.
    prompt_transform: candidate.prompt_transform?.trim() || null,
    proper_name: candidate.proper_name?.trim() || null,
    // Role is intentionally distinct from keyword (short retrieval label) and
    // visual_reference (appearance). Downstream multimodal prompts need all
    // three to bind shared-source characters without swapping semantics.
    role: candidate.label?.trim() || candidate.keyword?.trim() || candidate.anchor_id,
    source: primarySourceId ? 'USER_FILE' : null,
    source_file_id: primarySourceId,
    // Forward the planner's passthrough decision so logos / icons survive
    // anchor-generation re-runs verbatim. Without this, story-mode's
    // `buildLongTakeAnchorAssetTasks` falls back to filename heuristics
    // (`isLogoAssetShortname`), which misses passthroughs the UIP planner
    // identified semantically.
    source_passthrough: candidate.passthrough ?? undefined,
    type: candidate.type === 'CHARACTER' ? 'Character' : 'Prop',
    visual_reference: candidate.visual_reference?.trim() || '',
    visual_tag: candidate.visual_tag?.trim() || '',
  }
}

/**
 * Build anchor-index entries for raw user-upload assets that are directly
 * assigned to shots via `pre_selected_assets` with `source="user_upload"`.
 *
 * These assets never go through the anchor-generation pipeline, so they're
 * absent from the AnchorAssetsSummary-based index. Without this injection,
 * `buildLongTakeAnchorContents` (called inside `generateLongTakeKeyframe`)
 * can't find them in the lookup and silently drops the reference image from
 * the keyframe prompt.
 *
 * Entries are added to the raw anchor index with status="raw" so they're
 * treated as unprocessed references (no style conversion applied).
 */
export function buildUserUploadAnchorEntries(
  spec: Spec,
  uploadedAssets: UploadedAsset[],
  uipPrefix: string,
  projectId: string,
): StoryModeAnchorIndexEntry[] {
  // Collect unique user-upload asset IDs referenced in any shot
  const userUploadIds = new Set<string>()
  for (const shot of spec.visual_script?.shots ?? []) {
    for (const asset of shot.pre_selected_assets ?? []) {
      if (asset.source === 'user_upload' && asset.asset_id?.trim()) {
        userUploadIds.add(asset.asset_id.trim())
      }
    }
  }
  if (userUploadIds.size === 0) {
    return []
  }

  // Build a lookup from the uploaded assets catalog (session-state.json carries
  // both a legacy top-level field and the newer cached_artifacts path; the
  // caller merges both before passing here).
  const uploadByAssetId = new Map(uploadedAssets.map((a) => [a.asset_id, a]))

  const entries: StoryModeAnchorIndexEntry[] = []
  for (const assetId of userUploadIds) {
    const upload = uploadByAssetId.get(assetId)
    if (!upload?.file_path) {
      logger.warn(
        `[${projectId}] user-upload asset ${assetId} in pre_selected_assets but not found in uploaded_assets catalog; skipping anchor injection`,
      )
      continue
    }
    // Two file_path shapes can reach here:
    // (a) literal chat upload  -- relative path under the UIP planner prefix:
    //     projects/<projectId>/user-intent-planner/uploads/<assetId>/<fileName>
    // (b) brand_bank synthesis -- full `store://<key>` URI carried over
    //     from `StagedAssetRef.staging_uri`.
    const fileUri = isStoreUri(upload.file_path)
      ? upload.file_path
      : storeUri(`${uipPrefix}/${upload.file_path}`)
    entries.push({
      asset_id: assetId,
      anchor_uri: fileUri,
      effective_anchor_uri: fileUri,
      raw_anchor_uri: fileUri,
      styled_anchor_uri: null,
      prompt_text: upload.file_name ?? assetId,
      status: 'raw',
      source_file_ids: [assetId],
      source_image_uris: [fileUri],
      // Excluded from `numAssetsGenerated` -- raw passthrough, not generated.
      source_passthrough: true,
    })
  }
  if (entries.length > 0) {
    logger.info(`[${projectId}] Injecting ${entries.length} user-upload asset(s) into anchor index`)
  }
  return entries
}

/**
 * Map UIP `session.spec.global_constraints` to story-mode's
 * `long_take/global_constraints.json` shape. Mirrors the legacy
 * `generateLongTakeVisualScript` activity that writes the same file at
 * `libs/story-mode-runtime/src/activities/long-take/visual-script.ts`.
 *
 * UIP-to-story-mode skips that activity (UIP planner already produced the
 * visual script), so this bridge ensures downstream stages -- specifically
 * `getLongTakeKeyframeGlobalContext` in `keyframes.ts`'s
 * `buildLongTakeKeyframePrompt` -- find the same context the legacy flow
 * would have produced.
 */
export function buildLongTakeGlobalConstraintsJson(spec: null | Spec | undefined): null | string {
  if (!spec?.global_constraints) {
    return null
  }
  const gc = spec.global_constraints
  const longTakeGc = {
    video_type: gc.video_type || '',
    script_category: gc.script_category ?? 'concept_centric',
    topic: gc.topic || '',
    key_entities: gc.key_entities || [],
    geo_scope: gc.geo_scope || '',
    time_scope: gc.time_scope || '',
    brand_scope: gc.brand_scope || '',
    target_audience: gc.target_audience || '',
    tone: gc.tone || '',
    script_language: gc.script_language || '',
    directives: gc.directives || [],
    must_not_violate: gc.must_not_violate || [],
  }
  return JSON.stringify(longTakeGc, null, 2)
}

// ---------------------------------------------------------------------------
// project.long_take.completed generated-anchor tracking (shared with the API
// confirm path). The story-mode anchor-assets picker renames uploads to
// `Actor image N` / `Logo image N` / `Object image N`, so generated anchors can
// be split per category by matching each anchor's source_file_ids to the upload
// catalog's shortnames.
// ---------------------------------------------------------------------------

export interface GeneratedAnchorCountsForTracking {
  numActorAssetsGenerated: number
  numAssetsGenerated: number
  numLogoAssetsGenerated: number
  numObjectAssetsGenerated: number
  numOtherAssetsGenerated: number
}

export interface UserAssetCatalogItemForTracking {
  aliases: string[]
  fileId: string
  mime: string
  shortname: string
  storageUri: string
}

type AnchorCategory = 'actor' | 'logo' | 'object'

/**
 * Build a story-mode user-asset catalog from uploaded assets, suitable for
 * `project.long_take.completed` counts. Only image attachments are included;
 * `fileId` is the raw asset_id so anchor `source_file_ids` line up.
 */
export function buildUserAssetCatalogForTracking(
  uploadedAssets: UploadedAsset[],
): UserAssetCatalogItemForTracking[] {
  const seen = new Set<string>()
  const items: UserAssetCatalogItemForTracking[] = []
  for (const asset of uploadedAssets) {
    if (!asset.asset_id || seen.has(asset.asset_id)) {
      continue
    }
    if (!asset.content_type?.startsWith('image/')) {
      continue
    }
    seen.add(asset.asset_id)
    items.push({
      aliases: [],
      fileId: asset.asset_id,
      mime: asset.content_type,
      shortname: asset.file_name || '',
      storageUri: asset.file_path || '',
    })
  }
  return items
}

/** Per-category generated-anchor counts. Skips failed + passthrough entries. */
export function countGeneratedAnchorsByCategoryForTracking(
  anchorEntries: StoryModeAnchorIndexEntry[],
  userAssetCatalog: UserAssetCatalogItemForTracking[],
): GeneratedAnchorCountsForTracking {
  const fileIdToCategory = new Map<string, AnchorCategory>()
  for (const item of userAssetCatalog) {
    const category = shortnameToAnchorCategory(item.shortname)
    if (category) {
      fileIdToCategory.set(item.fileId, category)
    }
  }

  let actor = 0
  let logo = 0
  let object = 0
  let other = 0
  let total = 0
  for (const anchor of anchorEntries) {
    // Skip null anchors (failed) and passthroughs (raw uploads, already counted
    // on the upload side).
    if (!anchor.anchor_uri || anchor.source_passthrough) {
      continue
    }
    total++
    const categories = resolveAnchorCategories(anchor, fileIdToCategory)
    actor += categories.has('actor') ? 1 : 0
    logo += categories.has('logo') ? 1 : 0
    object += categories.has('object') ? 1 : 0
    other += categories.size === 0 ? 1 : 0
  }

  return {
    numActorAssetsGenerated: actor,
    numAssetsGenerated: total,
    numLogoAssetsGenerated: logo,
    numObjectAssetsGenerated: object,
    numOtherAssetsGenerated: other,
  }
}

function resolveAnchorCategories(
  anchor: StoryModeAnchorIndexEntry,
  fileIdToCategory: Map<string, AnchorCategory>,
): Set<AnchorCategory> {
  const categories = new Set<AnchorCategory>()
  for (const fileId of anchor.source_file_ids) {
    const category = fileIdToCategory.get(fileId)
    if (category) {
      categories.add(category)
    }
  }
  return categories
}

function shortnameToAnchorCategory(shortname: string): AnchorCategory | null {
  const name = shortname.toLowerCase()
  if (name.startsWith('actor image')) {
    return 'actor'
  }
  if (name.startsWith('logo image')) {
    return 'logo'
  }
  if (name.startsWith('object image')) {
    return 'object'
  }
  return null
}
