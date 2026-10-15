import { ProjectStore } from '@reelmakeeasy/common/agent-v2/storage/project-store'
import type { Content } from '@reelmakeeasy/common/llm'
import type { LongTakeAnchorIndex } from '@reelmakeeasy/common/long-take/types'

import { formatError, formatLogFields, logger } from './common'
import {
  getLongTakeAnchorLookup,
  LONG_TAKE_ANCHOR_RAW_INDEX_PATH,
  LONG_TAKE_ANCHOR_STYLED_INDEX_PATH,
  readLongTakeAnchorIndex,
} from './storage'
import { readLongTakeAssetManifestOutput } from './storage-read'

export type LongTakeAnchorMeta = {
  keyword: string
  properName: null | string
  /** Human-readable semantic role from UIP, distinct from appearance. */
  role?: string
  source: 'USER_FILE' | null
  sourcePassthrough?: true | undefined
  type: 'Character' | 'Prop'
  uri: string
  visualReference: string
}

export interface LongTakeCharacterAnchors {
  /**
   * Distinct character anchors counted by asset_id. May exceed
   * `keywords.length` when multiple named-group members share a keyword
   * (e.g. three "Girl" assets with different proper_names) -- the
   * anti-cloning gate needs the true anchor count, not the deduped count.
   */
  count: number
  /** Keyword strings deduped, suitable for plural-form text matching. */
  keywords: string[]
}

const LONG_TAKE_ANCHOR_META_CACHE_TTL_MS = 5 * 60 * 1000

const longTakeAnchorMetaLookupCache = new Map<
  string,
  { byAssetId: Map<string, LongTakeAnchorMeta>; expiresAt: number }
>()

export function buildLongTakeAnchorContents(
  usedAssetIds: string[],
  anchorLookup: Map<string, LongTakeAnchorMeta> | Map<string, string>,
  _improvedVisualScriptEnabled?: boolean,
): Content[] {
  const contents: Content[] = []
  const deduped = new Set<string>()
  const missingAssetIds: string[] = []
  for (const assetId of usedAssetIds || []) {
    const normalizedAssetId = assetId?.trim()
    if (!normalizedAssetId || deduped.has(normalizedAssetId)) {
      continue
    }
    deduped.add(normalizedAssetId)
    const entry = anchorLookup.get(normalizedAssetId)
    if (!entry) {
      missingAssetIds.push(normalizedAssetId)
      continue
    }
    if (typeof entry === 'string') {
      contents.push({ type: 'image_url', imageUrl: entry })
      continue
    }
    const label = buildAnchorReferenceLabel(normalizedAssetId, entry)
    if (label) {
      contents.push({ type: 'text', text: label })
    }
    contents.push({ type: 'image_url', imageUrl: entry.uri })
  }
  if (missingAssetIds.length > 0) {
    // A dangling used_asset_id means the shot renders without its reference
    // image; surface it instead of degrading silently.
    logger.warn(
      `buildLongTakeAnchorContents: ${missingAssetIds.length}/${deduped.size} used_asset_id(s) not in anchor lookup, rendering without those references: ${missingAssetIds.join(', ')}`,
    )
  }
  return contents
}

export function clearLongTakeAnchorMetaLookupCache(projectId: string): void {
  longTakeAnchorMetaLookupCache.delete(projectId)
}

export function collectCharacterAnchors(
  usedAssetIds: string[] | undefined,
  anchorLookup: Map<string, LongTakeAnchorMeta>,
): LongTakeCharacterAnchors {
  const keywords: string[] = []
  const seenKeywords = new Set<string>()
  const seenAssetIds = new Set<string>()
  let count = 0
  for (const assetId of usedAssetIds || []) {
    const normalized = assetId?.trim()
    if (!normalized || seenAssetIds.has(normalized)) {
      continue
    }
    seenAssetIds.add(normalized)
    const meta = anchorLookup.get(normalized)
    if (meta?.type !== 'Character') {
      continue
    }
    count++
    const keyword = meta.keyword?.trim()
    if (!keyword || seenKeywords.has(keyword)) {
      continue
    }
    seenKeywords.add(keyword)
    keywords.push(keyword)
  }
  return { count, keywords }
}

export async function getLongTakeAnchorMetaLookup(
  storage: ProjectStore,
  projectId: string,
): Promise<Map<string, LongTakeAnchorMeta>> {
  const now = Date.now()
  const cached = longTakeAnchorMetaLookupCache.get(projectId)
  if (cached && cached.expiresAt > now) {
    return cached.byAssetId
  }

  const uriLookup = await getLongTakeAnchorLookup(storage, projectId)
  const metaLookup = new Map<string, LongTakeAnchorMeta>()

  if (uriLookup.size === 0) {
    longTakeAnchorMetaLookupCache.set(projectId, {
      byAssetId: metaLookup,
      expiresAt: now + LONG_TAKE_ANCHOR_META_CACHE_TTL_MS,
    })
    return metaLookup
  }

  // Index-level passthrough markers: the manifest only carries
  // source_passthrough when the experts LLM emitted it, so an asset whose
  // anchor is verbatim the user upload can otherwise read as non-passthrough
  // and silently lose logo compositing.
  const indexPassthroughAssetIds = await collectIndexPassthroughAssetIds(storage)

  type ManifestEntry = {
    keyword: string
    properName: null | string
    role?: string
    source: 'USER_FILE' | null
    sourcePassthrough?: true | undefined
    type: 'Character' | 'Prop'
    visualReference: string
  }
  let manifestById: Map<string, ManifestEntry> | undefined
  try {
    const manifest = await readLongTakeAssetManifestOutput(storage)
    manifestById = new Map(
      manifest.asset_manifest.map((item) => [
        item.asset_id,
        {
          keyword: item.keyword,
          properName: item.proper_name ?? null,
          role: item.role?.trim() || undefined,
          source: item.source ?? null,
          sourcePassthrough: item.source_passthrough ? true : undefined,
          type: item.type,
          visualReference: item.visual_reference ?? '',
        },
      ]),
    )
  } catch (error) {
    logger.warn(
      `[long-take] Failed to load asset manifest for anchor meta lookup ${formatLogFields({
        projectId,
        err: formatError(error),
      })}`,
    )
  }

  for (const [assetId, uri] of uriLookup) {
    const manifestEntry = manifestById?.get(assetId)
    metaLookup.set(assetId, {
      keyword: manifestEntry?.keyword?.trim() || assetId,
      properName: manifestEntry?.properName || null,
      role: manifestEntry?.role,
      source: manifestEntry?.source ?? null,
      sourcePassthrough:
        manifestEntry?.sourcePassthrough ?? (indexPassthroughAssetIds.has(assetId) || undefined),
      type: manifestEntry?.type || 'Character',
      uri,
      visualReference: manifestEntry?.visualReference ?? '',
    })
  }

  longTakeAnchorMetaLookupCache.set(projectId, {
    byAssetId: metaLookup,
    expiresAt: now + LONG_TAKE_ANCHOR_META_CACHE_TTL_MS,
  })
  return metaLookup
}

/**
 * Bundle the three anchor-derived inputs the keyframe prompt builder needs.
 * Centralizes the per-shot anchor inspection so callers can spread the
 * result into `buildLongTakeKeyframePrompt({ ..., ...flags })`.
 *
 * USER_FILE Prop preservation is intentionally suppressed so keyframe anchor
 * prompts match the legacy/gate-off path.
 */
export function getLongTakeKeyframeAnchorParams(
  usedAssetIds: string[] | undefined,
  anchorLookup: Map<string, LongTakeAnchorMeta>,
  hasAnchorReference: boolean,
  _improvedVisualScriptEnabled?: boolean,
): {
  characterAnchors: LongTakeCharacterAnchors
  hasAnchorReference: boolean
  hasUserFilePropAnchorReference: boolean
} {
  return {
    characterAnchors: collectCharacterAnchors(usedAssetIds, anchorLookup),
    hasAnchorReference,
    hasUserFilePropAnchorReference: false,
  }
}

/**
 * True when at least one bound anchor is a USER_FILE-sourced Prop.
 * Retained for callers/tests that need to inspect anchor metadata directly.
 * Keyframe prompt assembly no longer enables a separate gate-on preservation
 * directive from this helper.
 *
 * Mirrors `buildLongTakeAnchorContents` normalization: trims asset IDs,
 * skips empty/falsy IDs, and tolerates legacy URI-only string entries
 * (treated as non-USER_FILE since they carry no metadata).
 */
export function hasUserFilePropAnchorReference(
  usedAssetIds: string[] | undefined,
  anchorLookup: ReadonlyMap<string, LongTakeAnchorMeta | string>,
): boolean {
  const seen = new Set<string>()
  for (const assetId of usedAssetIds || []) {
    const normalized = assetId?.trim()
    if (!normalized || seen.has(normalized)) {
      continue
    }
    seen.add(normalized)
    const entry = anchorLookup.get(normalized)
    if (!entry || typeof entry === 'string') {
      continue
    }
    if (entry.type === 'Prop' && entry.source === 'USER_FILE') {
      return true
    }
  }
  return false
}

function buildAnchorReferenceLabel(assetId: string, meta: LongTakeAnchorMeta): string {
  const role = meta.role?.trim()
  if (role) {
    const appearance = meta.visualReference?.trim() || 'the attached reference image'
    const subjectType = meta.type === 'Prop' ? 'object' : 'individual'
    const bindingValue = (value: string) => JSON.stringify(value.replace(/\s+/g, ' ').trim())
    return `[Reference image binding — asset_id=${bindingValue(assetId)}; role=${bindingValue(role)}; appearance=${bindingValue(appearance)}. Match this specific ${subjectType}; do not transfer its role or appearance to another asset.]`
  }
  const displayName = meta.properName?.trim() || meta.keyword?.trim() || ''
  if (!displayName) {
    return ''
  }
  if (meta.type === 'Prop') {
    return `[Reference image — prop "${displayName}": match the appearance of this specific object.]`
  }
  return `[Reference image — character "${displayName}": match the appearance of this specific individual.]`
}

const CROWD_TERM_REGEX =
  /\b(several|multiple|many|numerous|various|dozens?|pairs?|couple(?:\s+of)?|crowds?|groups?|throngs?|clusters?|swarms?|hordes?|bunch(?:\s+of)?|lots\s+of|some\s+\w+s)\b/i

// Matches a numeral followed by a plural noun, optionally preceded by one
// intermediate adjective/qualifier word ("two first mates", "three young
// dancers"). The trailing \w+s is the head plural noun. We cap intermediate
// words at one to keep the parse tight and avoid false positives like
// "two pulled by horses".
const NUMERAL_PLURAL_REGEX =
  /\b(?:two|three|four|five|six|seven|eight|nine|ten|\d{1,3})\s+(?:\w+\s+)?\w+s\b/gi

const NUMBER_WORD_TO_DIGIT: Record<string, number> = {
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
}

// Plural nouns that refer to people / characters (the only thing
// extractMaxFigureCount cares about). Non-character plurals like "12 signs",
// "dozens of barrels", or "three windows" must not influence the figure count
// used to gate anti-cloning.
const GENERIC_CHARACTER_PLURAL_NOUNS = new Set([
  'adults',
  'boys',
  'characters',
  'children',
  'figures',
  'friends',
  'girls',
  'guys',
  'individuals',
  'kids',
  'ladies',
  'members',
  'men',
  'neighbors',
  'people',
  'persons',
  'strangers',
  'teenagers',
  'teens',
  'women',
])

export function detectCrowdScene(basePrompt: string, anchorKeywords?: string[]): boolean {
  const text = basePrompt?.trim()
  if (!text) {
    return false
  }
  if (CROWD_TERM_REGEX.test(text) || new RegExp(NUMERAL_PLURAL_REGEX.source, 'i').test(text)) {
    return true
  }
  for (const keyword of anchorKeywords || []) {
    const normalized = keyword?.trim()
    if (!normalized) {
      continue
    }
    const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)
    const pluralRegex = new RegExp(`\\b${escaped}(?:s|es)\\b`, 'i')
    if (pluralRegex.test(text)) {
      return true
    }
  }
  return false
}

/**
 * Extract the largest explicit figure count from the prompt -- e.g.
 * "three girls" -> 3, "two captains and 12 soldiers" -> 12 when
 * "captain"/"soldier" are character anchor keywords.
 *
 * Only character-related plural nouns count. Generic plural counts of objects
 * (e.g. "12 signs", "dozens of barrels") do NOT contribute, because those
 * counts shouldn't gate the anti-cloning directive (which is about people).
 *
 * A plural noun is considered character-related when it is either:
 *   - in GENERIC_CHARACTER_PLURAL_NOUNS (people, girls, men, etc.), OR
 *   - the pluralized form of one of the provided anchorKeywords
 *     (e.g. "sailor" anchor -> "sailors" plural matches).
 *
 * Returns 0 when no character-related numeral + plural pattern is present
 * (generic phrasing like "several", "a crowd", or bare plurals like
 * "the girls" yield 0 here and are handled separately).
 */
export function extractMaxFigureCount(basePrompt: string, anchorKeywords?: string[]): number {
  const text = basePrompt?.trim()
  if (!text) {
    return 0
  }
  const allowedNouns = new Set<string>(GENERIC_CHARACTER_PLURAL_NOUNS)
  for (const keyword of anchorKeywords || []) {
    const normalized = keyword?.trim().toLowerCase()
    if (!normalized) {
      continue
    }
    allowedNouns.add(`${normalized}s`)
    allowedNouns.add(`${normalized}es`)
  }

  let max = 0
  for (const match of text.matchAll(NUMERAL_PLURAL_REGEX)) {
    const parts = match[0].trim().split(/\s+/)
    if (parts.length < 2) {
      continue
    }
    const numToken = parts[0]?.toLowerCase()
    // Head noun is always the last token in the match (the trailing \w+s),
    // even when there are intermediate adjective/qualifier words like
    // "two first mates" -> head noun "mates".
    const noun = parts[parts.length - 1]?.toLowerCase()
    if (!numToken || !noun) {
      continue
    }
    if (!allowedNouns.has(noun)) {
      continue
    }
    const value = NUMBER_WORD_TO_DIGIT[numToken] ?? Number.parseInt(numToken, 10)
    if (Number.isFinite(value) && value > max) {
      max = value
    }
  }
  return max
}

/**
 * Asset ids whose anchor is the raw user upload passed through verbatim.
 * An index entry counts as passthrough when it is marked
 * `source_passthrough`, or -- because some writers and zod round-trips have
 * dropped that flag -- when its anchor URI IS one of its source image URIs,
 * which is passthrough by construction. Fail-soft: index reads degrade to
 * empty, matching readLongTakeAnchorIndex.
 */
async function collectIndexPassthroughAssetIds(storage: ProjectStore): Promise<Set<string>> {
  const [styledIndex, rawIndex] = await Promise.all([
    readLongTakeAnchorIndex(storage, LONG_TAKE_ANCHOR_STYLED_INDEX_PATH),
    readLongTakeAnchorIndex(storage, LONG_TAKE_ANCHOR_RAW_INDEX_PATH),
  ])
  const passthroughAssetIds = new Set<string>()
  for (const index of [styledIndex, rawIndex]) {
    for (const item of index.assets || []) {
      const assetId = item.asset_id?.trim()
      if (!assetId) {
        continue
      }
      const anchorUri = resolveIndexItemAnchorUri(item)
      if (
        item.source_passthrough === true ||
        (anchorUri && (item.source_image_uris || []).includes(anchorUri))
      ) {
        passthroughAssetIds.add(assetId)
      }
    }
  }
  return passthroughAssetIds
}

/** Mirrors storage.ts resolveItemAnchorUri: the URI keyframes actually use. */
function resolveIndexItemAnchorUri(
  item: LongTakeAnchorIndex['assets'][number],
): string | undefined {
  return (
    item.effective_anchor_uri?.trim() ||
    item.styled_anchor_uri?.trim() ||
    item.raw_anchor_uri?.trim() ||
    item.anchor_uri?.trim()
  )
}
