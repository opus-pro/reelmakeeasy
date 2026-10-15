/**
 * Content identity for a create request.
 *
 * `sessionCreationId` only dedupes a *retried* create: the FE clears
 * the id as soon as a create succeeds, so a second successful submit always
 * carries a fresh one. That leaves the real duplicate-project path unguarded --
 * the composer is never reset after a story-mode create, so re-submitting the
 * same composition is one click, and a second tab / reload defeats the FE's
 * in-flight dedupe too.
 *
 * This module derives a key from what the request *is* rather than from a
 * client-supplied token, so two submissions of the same composition collide
 * regardless of tab, reload, or how the id was minted -- and without needing an
 * FE deploy, so clients on an old bundle are covered too. Two consumers:
 *   - a short dedupe window, so an accidental re-submit returns the first
 *     session instead of minting a second Project;
 *   - a longer "most recent session for this content" pointer, so a *deliberate*
 *     restart can park auto-continue on the session it replaced (which would
 *     otherwise auto-confirm and bill on its own).
 *
 * Two invariants keep this safe, both learned from review:
 *
 * 1. **Default-include.** Every field of the create request feeds the hash
 *    unless it is explicitly listed as volatile below. A field nobody thought
 *    about therefore *distinguishes* requests, so the failure mode of forgetting
 *    one is a missed dedupe (a duplicate project) rather than a false dedupe
 *    (silently handing back the wrong session and discarding the user's choice).
 *    Never invert this into an allowlist.
 * 2. **Identity is namespaced, not hashed.** The keys are scoped by org *and*
 *    user, so two members of one org submitting the same prompt can never
 *    dedupe onto each other -- or, worse, park each other's live sessions.
 *
 * Anything that cannot be identified with confidence yields `undefined`, which
 * disables both behaviours for that create.
 */
import { createHash } from 'node:crypto'

/**
 * Window in which an identical re-submit returns the already-created session.
 * Accidental duplicates (a double click, a retried request) land within
 * seconds of each other, so this leaves generous headroom for a slow
 * double-submit -- but is short enough that a considered "make another one
 * with the same input" is never denied.
 */
export const CONTENT_DEDUPE_TTL_SECONDS = 5 * 60

/**
 * Lifetime of the content -> most-recent-projectId pointer used to find a
 * superseded session. Much longer than the dedupe window because a deliberate
 * restart is slow: the case-2 restart came 11 minutes after the
 * original, well past any window we would dare dedupe on.
 */
export const CONTENT_RECENT_TTL_SECONDS = 6 * 60 * 60

/**
 * Volatile or non-identifying fields, excluded from the hash. Everything else is
 * included by default (see invariant 1 above). Only add here with a reason:
 * a wrongly-excluded field causes a *false* dedupe.
 */
const NON_IDENTIFYING_FIELDS: ReadonlySet<string> = new Set([
  'audioDurationSeconds',
  // Location, not content: the same track re-staged for a restart lands on a new
  // tmp path (the case-2 signature). Identity comes from the
  // content-hashed asset id in the audio mention instead.
  'audioPath',
  // Both derived from the audio file itself, and both can differ trivially
  // between two submissions of the same track (re-ASR, re-measure).
  'audioTranscript',
  // Handled explicitly below: mentions keep their asset id and position but drop
  // their per-project CDN URLs.
  'initialMessage',
  // Identity namespaces the key instead of feeding the hash (invariant 2).
  'loginId',
  'orgId',
  // Client capability marker, not a user choice.
  'remixBrandAware',
  // Handled explicitly below so the derived thumbnail URL is dropped.
  'seedStyleInstruction',
  // The single-use client key this guard exists to compensate for -- including
  // it would reproduce exactly the bug being fixed.
  'sessionCreationId',
  // Handled explicitly below: sorted, content-hashed asset ids.
  'uploadedAssets',
  'userEmail',
  'userId',
])

/** `@audio[label](assetId|url)` / `@img[label](assetId|url)` composer mentions. */
const MENTION_PATTERN = /@(audio|img)\[([^\]]*)\]\(([^)]*)\)/g
/** An audio mention specifically -- its assetId is the only content id for the track. */
const AUDIO_MENTION_PATTERN = /@audio\[[^\]]*\]\(([^)]*)\)/
/**
 * Composer asset ids are `<fileName>-<contentHash>`; the trailing hex is what
 * makes two uploads of the same bytes collide. Require it before trusting an id
 * as a content identity -- a bare filename would let two different files that
 * happen to share a name (`Untitled.mp3`) dedupe onto each other.
 */
const CONTENT_HASHED_ASSET_ID = /-[0-9a-f]{32}$/

export type CreateContentIdentityInput = {
  [field: string]: unknown
  audioPath?: string
  initialMessage?: string
  seedStyleInstruction?: {
    style_image_uri?: string
    style_name: string
    style_text: string
    style_thumbnail_url: string
  }
  uploadedAssets?: Array<{ asset_id: string }>
}

/**
 * Stable fingerprint of the composition a create request describes, or
 * `undefined` when it cannot be identified confidently.
 */
export function buildCreateContentFingerprint(
  input: CreateContentIdentityInput,
): string | undefined {
  const prose = normalizeProse(input.initialMessage)
  const assetIds = contentHashedAssetIds(input.uploadedAssets)
  const audioId = resolveAudioContentId(input)

  // An audio session whose track we cannot identify is not fingerprintable: the
  // track is the bulk of the composition, so ignoring it would collapse two
  // different songs that share a prompt and style onto one key.
  if (input.audioPath && !audioId) {
    return undefined
  }
  // Nothing identifying at all (no prose, no assets, no audio) -- e.g. a bare
  // "surprise me" create. Two of those are not evidence of a duplicate.
  if (!prose && assetIds.length === 0 && !audioId) {
    return undefined
  }

  const canonical = stableStringify({
    assetIds,
    audioId: audioId ?? null,
    prose,
    settings: identifyingSettings(input),
    style: identifyingStyle(input),
  })
  return createHash('sha256').update(canonical).digest('hex').slice(0, 32)
}

/**
 * Key for the short dedupe claim, scoped by org *and* user so one member's
 * content can never dedupe onto another's.
 */
export function contentDedupeCacheKey(
  orgId: string | undefined,
  userId: string | undefined,
  fingerprint: string,
): string {
  return `uip:create-content:${scope(orgId, userId)}:${fingerprint}`
}

/** Key for the long-lived content -> most-recent-projectId pointer. */
export function contentRecentCacheKey(
  orgId: string | undefined,
  userId: string | undefined,
  fingerprint: string,
): string {
  return `uip:create-content-recent:${scope(orgId, userId)}:${fingerprint}`
}

/** Sorted content-hashed asset ids; ids without a content hash are dropped. */
function contentHashedAssetIds(assets: Array<{ asset_id: string }> | undefined): string[] {
  return [...new Set((assets ?? []).map((a) => a.asset_id).filter(isContentHashedAssetId))].sort()
}

/**
 * Every remaining request field, by default. See invariant 1: a field absent
 * from NON_IDENTIFYING_FIELDS participates, so an unforeseen setting splits the
 * key rather than being silently ignored.
 */
function identifyingSettings(input: CreateContentIdentityInput): Record<string, unknown> {
  const settings: Record<string, unknown> = {}
  for (const field of Object.keys(input).sort()) {
    if (NON_IDENTIFYING_FIELDS.has(field) || input[field] === undefined) {
      continue
    }
    settings[field] = input[field]
  }
  return settings
}

/**
 * The style the user picked, minus `style_thumbnail_url` -- derived presentation
 * that can be regenerated, so two creates of the same pick must not diverge on it.
 */
function identifyingStyle(input: CreateContentIdentityInput): null | Record<string, unknown> {
  const style = input.seedStyleInstruction
  if (!style) {
    return null
  }
  return {
    image: style.style_image_uri ?? null,
    name: style.style_name,
    text: style.style_text,
  }
}

function isContentHashedAssetId(assetId: string | undefined): assetId is string {
  return Boolean(assetId && CONTENT_HASHED_ASSET_ID.test(assetId))
}

/**
 * Collapse the prompt to its identifying form: each mention keeps its kind,
 * label and content-hashed asset id **in place**, and loses only its
 * per-project CDN URL. Keeping the position matters -- the same image set bound
 * to different roles (hero vs logo) is a materially different prompt and must
 * not dedupe, which a set of sorted ids alone cannot express.
 */
function normalizeProse(message: string | undefined): string {
  return (message ?? '')
    .replace(MENTION_PATTERN, (_full, kind: string, label: string, target: string) => {
      const assetId = target.split('|')[0]?.trim() ?? ''
      return `@${kind}[${label}](${assetId})`
    })
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Content id of the uploaded track, parsed from its `@audio[...]` mention.
 * Returns undefined for a non-audio session, or when the mention is missing /
 * carries no content-hashed id.
 */
function resolveAudioContentId(input: CreateContentIdentityInput): string | undefined {
  if (!input.audioPath) {
    return undefined
  }
  const target = AUDIO_MENTION_PATTERN.exec(input.initialMessage ?? '')?.[1]
  const assetId = target?.split('|')[0]?.trim()
  return isContentHashedAssetId(assetId) ? assetId : undefined
}

function scope(orgId: string | undefined, userId: string | undefined): string {
  return `${orgId ?? 'no-org'}:${userId ?? 'no-user'}`
}

/**
 * Deterministic JSON: object keys sorted at every depth. Plain
 * `JSON.stringify` follows insertion order, so two equivalent requests whose
 * fields arrived in a different order (e.g. `generationResolution`, an
 * unordered `Record`) would otherwise hash differently.
 */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null'
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`)
  return `{${entries.join(',')}}`
}
