// Session-free core of the brand anchor-library store/reuse.
//
// Split out of anchor-library-store.ts so the RENDER side (story-mode-runtime's
// long-take anchor activities) can deep-import these pieces WITHOUT dragging in
// the planner barrel's heavy graph (call-planner -> llm/completion -> the LLM
// provider clients), which has broken under story-mode's jest env. Everything
// here depends only on node:crypto + the file store handle + the logger -- the
// same graph the render activities already load; nothing session-bound.
//
// The session-based wrappers (computeStyleHash(session),
// resolveAnchorLibraryTarget(session), matchStoredAnchorEntry(candidate), ...)
// live in anchor-library-store.ts and delegate here, so store + reuse -- across
// planner and render -- never key or match differently.

import { createHash } from 'node:crypto'

import { ProjectStore } from '@reelmakeeasy/common/agent-v2/storage/project-store'
import { createSubLogger } from '@reelmakeeasy/common/logger'

// Type-only + node:crypto module (no heavy graph), so the deep-import contract
// above holds. It owns the `brand_<bucket>_<hash8>` id shape, which is why the
// bucket-stripping half of the cross-session key lives there too.
import { stripBrandBucket } from './brand-staged-assets-to-uploads'

const logger = createSubLogger('anchor-library-store')

// v2 records each anchor's originating brand asset id. A v1 set is
// deliberately NOT read: its entries were matched purely on the planner's
// drifting text, so re-storing a v1 false match would stamp an authoritative
// asset id onto the wrong image and make a transient text-match error permanent.
// Ignoring v1 costs one regeneration per (brand, style) and then self-heals into
// a v2 set. Safe to discard outright because v1 sets were never in user-facing
// use, so no user-visible set is lost.
export const ANCHOR_LIBRARY_MANIFEST_VERSION = 2
export const ANCHOR_LIBRARY_MANIFEST_FILE = 'manifest.json'

// Synthetic asset_id under which a stored anchor final enters the anchor upload
// pool (mirrors the `brand_<bucket>_<hash>` synthetics from
// brandStagedAssetsToUploads). The stored entry's anchor_id is unique within a
// set, so this id is collision-safe.
export const ANCHOR_REUSE_SOURCE_ID_PREFIX = 'brand_reuse_'

// Where a stored anchor set lands for one (brand, style). `storagePrefix` is the
// ProjectStore root, so the durable folder is
// `brand-library/<orgId>/<briefId>/anchors/<styleHash>/`: inside the brief's own folder
// (deleting the brief deletes it), never under `projects/`, where every child is a project.
export interface AnchorLibraryTarget {
  briefId: string
  orgId: string
  storagePrefix: string
  styleHash: string
}

// The style-scoped record written to <prefix>/manifest.json; the reuse half
// reads it to rehydrate the stored anchors as pre-made passthrough candidates.
export interface AnchorLibraryManifest {
  anchors: StoredAnchorManifestEntry[]
  brief_id: string
  generated_at: string
  org_id: string
  source_project_id: string
  stored_at: string
  style_hash: string
  style_name: null | string
  version: number
}

// One stored anchor as recorded in the manifest. `file` is the object name under
// the style prefix; anchor_id is the join key the reuse half rehydrates against.
export interface StoredAnchorManifestEntry {
  anchor_id: string
  file: string
  is_multi_angle: boolean
  keyword: string
  label: string
  // The form the user's prompt asked this subject to take when the
  // stored image was generated ("a pirate"), or null for the as-uploaded
  // appearance. Part of the match identity: a transformed anchor must never
  // reuse a stored image of the UNTRANSFORMED subject, and `proper_name`
  // equality alone used to make them equally good matches. Optional, exactly as
  // `source_asset_id` is, so manifests written before this field keep
  // validating and read as "untransformed".
  prompt_transform?: null | string
  proper_name: null | string
  // The ONE brand-bank asset this anchor was generated from (the
  // `brand_<bucket>_<hash8>` synthetic, stable across videos because the hash is
  // of the asset's staging_uri). The primary reuse match key -- unlike
  // keyword / proper_name it does not drift between videos for the same subject.
  // null when the anchor traces to zero or several brand assets (no single stable
  // source); optional so manifests written before this field keep validating and
  // simply fall back to identity matching.
  source_asset_id?: null | string
  // EVERY brand-bank asset this anchor was generated from, so an anchor
  // composed of several bank assets still carries a stable key instead of the
  // `source_asset_id: null` a multi-source anchor collapses to (16 of one QA
  // manifest's 25 entries traced to 2 assets each and could therefore never
  // match). The match side binds on a non-empty intersection of these, so a
  // 2-source stored entry and a 1-source candidate for the same subject still
  // meet. Optional, exactly as `source_asset_id` is, so manifests written before
  // this field keep validating and simply key on the single id.
  source_asset_ids?: string[]
  type: 'CHARACTER' | 'OBJECT'
  visual_tag: string
}

/**
 * The session-free style-hash core: sha256 of the trimmed effective style text.
 * MUST stay identical to the world-bible batch key. Exported so the render side
 * (which has the effective style text but no planner SessionState) computes a
 * byte-identical hash and lands on the same (brief, style) storage key.
 */
export function computeStyleHashFromText(effectiveStyleText: string): string {
  return createHash('sha256').update(effectiveStyleText.trim()).digest('hex')
}

/**
 * Pure prefix builder for a stored anchor set's durable target. The single
 * source of truth for the `brand-library/<orgId>/<briefId>/anchors/<styleHash>`
 * ProjectStore prefix, shared by the session-based resolver and the render side.
 */
export function anchorLibraryTargetFromKey(args: {
  briefId: string
  orgId: string
  styleHash: string
}): AnchorLibraryTarget {
  return {
    briefId: args.briefId,
    orgId: args.orgId,
    storagePrefix: `brand-library/${args.orgId}/${args.briefId}/anchors/${args.styleHash}`,
    styleHash: args.styleHash,
  }
}

/**
 * The `ProjectStore` handle rooted at a target's style folder. Single source of truth
 * for the handle so planner + render read/write the identical file tree.
 */
export function buildAnchorLibraryStorage(target: AnchorLibraryTarget): ProjectStore {
  return new ProjectStore(target.storagePrefix, { root: target.storagePrefix })
}

/**
 * Build the manifest for a stored anchor set. Pure -- the caller supplies the
 * entries actually copied to storage (so a partial copy records only what landed).
 */
export function buildAnchorLibraryManifest(args: {
  entries: StoredAnchorManifestEntry[]
  generatedAt: string
  sourceProjectId: string
  storedAt: string
  styleName: null | string
  target: AnchorLibraryTarget
}): AnchorLibraryManifest {
  const { target } = args
  return {
    anchors: args.entries,
    brief_id: target.briefId,
    generated_at: args.generatedAt,
    org_id: target.orgId,
    source_project_id: args.sourceProjectId,
    stored_at: args.storedAt,
    style_hash: target.styleHash,
    style_name: args.styleName,
    version: ANCHOR_LIBRARY_MANIFEST_VERSION,
  }
}

/**
 * The synthetic upload-pool id for one stored entry. Keyed on the entry's `file`,
 * not its `anchor_id`: a merged manifest legitimately holds two entries
 * that share an `anchor_id` while naming DIFFERENT brand assets, and the pool is a
 * Map by asset_id, so an anchor_id-derived key would collapse them onto one storage
 * path and let a candidate bound to one entry passthrough the OTHER entry's image.
 * `file` is unique per entry (project-namespaced, anchor_id-unique within a store).
 * The anchor_id stays in the id for log readability; the digest is what guarantees
 * uniqueness.
 */
export function reuseSourceAssetId(
  entry: Pick<StoredAnchorManifestEntry, 'anchor_id' | 'file'>,
): string {
  const digest = createHash('sha1').update(entry.file).digest('hex').slice(0, 8)
  return `${ANCHOR_REUSE_SOURCE_ID_PREFIX}${entry.anchor_id}_${digest}`
}

/**
 * Whether two stored entries describe the SAME anchored subject, so a re-store
 * refreshes it in place instead of duplicating it. `type` must always agree.
 * Identity is the brand asset when BOTH sides carry one (the drift-free key), and
 * otherwise falls back to `anchor_id`, which the planner derives from the subject.
 * Two entries that each name a DIFFERENT brand asset are never the same subject
 * even when their anchor_ids collide: collapsing them would drop one asset's
 * anchor, the exact shrink the merge exists to prevent. Pure.
 *
 * Keyed on the SAME bucket-stripped asset keys the matcher uses --
 * were the merge still comparing whole ids, a re-store after a bucket flip would
 * file the same file's anchor as a new subject and the library would accumulate a
 * duplicate entry per flip, which then competes with the original in tier 0.
 *
 * Deliberately STRICTER than the tier-0 match, which binds on a non-empty key
 * intersection: here the sets must be EQUAL. The two rules answer questions with
 * opposite failure costs. A loose match costs one anchor's visuals for one video
 * and the ranking arbitrates; a loose merge silently DROPS another subject's
 * anchor from the org-shared library for good -- and two composite anchors that
 * merely share one reference (`[A, B]` and `[A, C]`) are routinely distinct
 * subjects, so an intersection rule would supersede one with the other.
 */
function isSameStoredSubject(a: StoredAnchorManifestEntry, b: StoredAnchorManifestEntry): boolean {
  if (a.type !== b.type) {
    return false
  }
  const aKeys = entryAssetKeys(a)
  const bKeys = entryAssetKeys(b)
  if (aKeys.size > 0 && bKeys.size > 0) {
    return aKeys.size === bKeys.size && sharedAssetKeys(aKeys, bKeys).length === aKeys.size
  }
  return a.anchor_id === b.anchor_id
}

/**
 * Union a store's fresh entries into the set already published for the same
 * (brand, style) so a session that owns only a SUBSET of the brand's anchors can
 * never shrink the library. Each store publishes only the anchors its
 * own session generated and owns, and a session legitimately sees fewer than the
 * full bank (its anchor-manager call can return an anchor with no bound brand
 * asset), so a replace-publish lets 4 anchors overwrite a 13-entry manifest and
 * caps the cross-video consistency reuse exists to deliver.
 *
 * Incoming wins for a subject present on both sides, so a re-store refreshes that
 * entry onto its newer file. An existing entry no incoming entry supersedes is
 * kept verbatim, INCLUDING one whose brand asset has since left the bank: reuse
 * gates on current-bank membership at match time, so a stale entry can never
 * match and costs only storage, whereas dropping it here would shrink the library
 * for every other video that still uses the asset. Pure -- the caller owns the
 * storage read of the published set.
 *
 * Each incoming entry supersedes AT MOST ONE published entry, which is what makes
 * the non-shrinking guarantee unconditional: one brand asset can produce several
 * same-type anchors (a logo file yielding white / black / abstract variants, which
 * `assignStoredAnchorEntries` explicitly disambiguates), so dropping every sibling
 * that shares the asset id would itself shrink the manifest whenever a session
 * re-stores only one variant. The superseded sibling is picked by the same
 * identity signal the matcher uses -- an equal `anchor_id` first, then the best
 * identity score -- so a refresh lands on the right variant and unclaimed siblings
 * survive untouched.
 *
 * `prune` is the ONE deliberate exception to non-shrinking: the
 * session-final store may drop entries THIS session itself published earlier and
 * has since walked away from (the user removed the anchor before confirming).
 * Ownership is provenance in the manifest -- `entry.file` is namespaced
 * `<sourceProjectId>/<anchorId>.<ext>` -- so entries from OTHER sessions are
 * never touched (the invariant stands for everything this session does
 * not own). Within the session's own entries, the persisted anchor PLAN's
 * candidate ids are the user's explicit intent: an owned entry still in the plan
 * survives even when this store did not re-copy it (kept but not storable this
 * round), and only an owned entry the plan no longer carries -- a real removal --
 * is dropped. Legacy flat-file entries (no project namespace) have unknowable
 * provenance and are always kept.
 */
export interface SessionFinalPrune {
  /** Explicit opt-in marker: only a session-FINAL store may prune. */
  ownerScope: 'session_final'
  /**
   * anchor_ids the persisted anchor plan (`anchor_assets/asset_plan.json`)
   * still carries -- the user's explicit intent of what should exist.
   */
  plannedAnchorIds: ReadonlySet<string>
  /** The confirming session's project id; only entries it namespaced may drop. */
  sessionProjectId: string
}

// The source project a stored entry's object is namespaced under, or null for a
// legacy flat file (older stores wrote `<anchorId>.<ext>` with no project
// segment -- provenance unknowable, so the prune must never claim them).
export function mergeStoredAnchorEntries(
  published: readonly StoredAnchorManifestEntry[],
  incoming: readonly StoredAnchorManifestEntry[],
  prune?: SessionFinalPrune,
): StoredAnchorManifestEntry[] {
  const claimed = new Set<StoredAnchorManifestEntry>()
  for (const fresh of incoming) {
    const siblings = published.filter(
      (entry) => !claimed.has(entry) && isSameStoredSubject(entry, fresh),
    )
    if (siblings.length === 0) {
      continue
    }
    const superseded =
      siblings.find((entry) => entry.anchor_id === fresh.anchor_id) ??
      siblings.reduce((best, entry) =>
        scoreIdentityAgainstEntry(fresh, entry, true) > scoreIdentityAgainstEntry(fresh, best, true)
          ? entry
          : best,
      )
    if (superseded) {
      claimed.add(superseded)
    }
  }
  return [
    ...published.filter((entry) => !claimed.has(entry) && !isPrunedSessionEntry(entry, prune)),
    ...incoming,
  ]
}

function isPrunedSessionEntry(
  entry: StoredAnchorManifestEntry,
  prune: SessionFinalPrune | undefined,
): boolean {
  if (prune?.ownerScope !== 'session_final') {
    return false
  }
  if (storedEntryProjectId(entry) !== prune.sessionProjectId) {
    return false
  }
  return !prune.plannedAnchorIds.has(entry.anchor_id)
}

function storedEntryProjectId(entry: StoredAnchorManifestEntry): null | string {
  const slash = entry.file.indexOf('/')
  return slash > 0 ? entry.file.slice(0, slash) : null
}

/**
 * The single brand-bank asset id an anchor derives from, or null when the anchor
 * has no ONE authoritative brand source. Null is returned for every ambiguous
 * case, so such an anchor consistently falls back to identity matching on BOTH
 * the store and the match side instead of half-binding:
 *   - no brand source at all (a script-only / one-off-upload anchor);
 *   - several distinct brand sources (a composite of multiple brand assets);
 *   - ANY source outside the allowlist. The anchor was conditioned on that other
 *     reference too, so the generated image is not purely this brand asset's --
 *     labelling it with the brand id would let a later video that sources ONLY
 *     the brand asset deterministically reuse an image carrying the foreign
 *     content (a private upload, or a stale / other-brand cached asset).
 *
 * `allowedAssetIds` is the caller's brand allowlist: the exact staged-asset ids of
 * the CURRENT brand bank. Membership, never id shape -- a stale / other-brand
 * cached upload can carry a `brand_<...>`-shaped id. Both the planner and the
 * render side already hold this set for the store's ownership gate, so store and
 * match resolve the key under the same rule by construction.
 */
export function resolveBrandSourceAssetId(args: {
  allowedAssetIds: ReadonlySet<string>
  sourceIds: readonly (null | string | undefined)[]
}): null | string {
  const ids = resolveBrandSourceAssetIds(args)
  return ids.length === 1 ? (ids[0] ?? null) : null
}

/**
 * ALL the brand-bank assets an anchor derives from -- the set form of
 * `resolveBrandSourceAssetId`, and the key `source_asset_ids` records.
 * Same allowlist rule, same foreign-source veto: one source outside the bank
 * means the generated image is not purely this brand's, so the whole anchor gets
 * NO brand key ([]) rather than a partial one. Distinct ids, first-seen order.
 *
 * The singular resolver delegates here, so an anchor with exactly one brand
 * source keeps behaving byte-identically; only the several-sources case changes,
 * from "no key at all" to "a key set the matcher can intersect".
 */
export function resolveBrandSourceAssetIds(args: {
  allowedAssetIds: ReadonlySet<string>
  sourceIds: readonly (null | string | undefined)[]
}): string[] {
  const distinct = new Set<string>()
  for (const raw of args.sourceIds) {
    const id = raw?.trim()
    if (!id) {
      continue
    }
    if (!args.allowedAssetIds.has(id)) {
      return []
    }
    distinct.add(id)
  }
  return [...distinct]
}

// A stored entry is only usable if the fields the reuse path dereferences are
// well-formed: a non-empty string `file` and `anchor_id`, plus a known `type`.
function isValidManifestEntry(entry: unknown): entry is StoredAnchorManifestEntry {
  if (typeof entry !== 'object' || entry === null) {
    return false
  }
  const record = entry as Record<string, unknown>
  return (
    typeof record['anchor_id'] === 'string' &&
    record['anchor_id'].length > 0 &&
    typeof record['file'] === 'string' &&
    record['file'].length > 0 &&
    (record['type'] === 'CHARACTER' || record['type'] === 'OBJECT')
  )
}

/**
 * Read + validate the manifest for an already-resolved target. Does NOT check
 * the reuse gate (callers gate before computing the target). Best-effort: a
 * missing manifest (the common "first video for this brand + style" case) or any
 * read error folds to null so the caller generates normally.
 */
export async function loadAnchorLibraryManifestByTarget(
  target: AnchorLibraryTarget,
): Promise<AnchorLibraryManifest | null> {
  try {
    const libraryStorage = buildAnchorLibraryStorage(target)
    const manifest = await libraryStorage.readJsonFile<AnchorLibraryManifest>(
      ANCHOR_LIBRARY_MANIFEST_FILE,
    )
    if (
      manifest?.version !== ANCHOR_LIBRARY_MANIFEST_VERSION ||
      !Array.isArray(manifest.anchors) ||
      manifest.anchors.length === 0
    ) {
      return null
    }
    const anchors = manifest.anchors.filter(isValidManifestEntry)
    if (anchors.length === 0) {
      return null
    }
    logger.info(
      `anchor-library-store: loaded ${anchors.length} stored anchors for brief ${target.briefId} style ${target.styleHash.slice(0, 12)}`,
    )
    return { ...manifest, anchors }
  } catch {
    return null
  }
}

/**
 * The currently published entries for a target, for a store about to merge into
 * them -- or null when the published state could NOT be determined.
 *
 * Deliberately NOT `loadAnchorLibraryManifestByTarget`: that one folds every
 * failure to null because the REUSE side treats "no set" and "unreadable set"
 * identically (generate normally either way). A store cannot: publishing only its
 * own entries after a transient read error is precisely how a published set shrinks, so
 * it must tell the two apart and skip publishing on error. `[]` therefore means
 * genuinely nothing to merge -- no manifest yet (the first video for this brand and
 * style), or a v1 / malformed one, which is discarded by design (see
 * ANCHOR_LIBRARY_MANIFEST_VERSION) and self-heals into a v2 set.
 */
export async function readPublishedAnchorEntries(
  target: AnchorLibraryTarget,
): Promise<null | StoredAnchorManifestEntry[]> {
  let raw: string
  try {
    raw = await buildAnchorLibraryStorage(target).readTextFile(ANCHOR_LIBRARY_MANIFEST_FILE)
  } catch (err) {
    // Read the object directly and classify the failure. `ProjectStore.exists` cannot
    // stand in for this: its probe swallows EVERY error and reports `false`, which a
    // store would read as "nothing published" and then overwrite the library with
    // its own subset -- the exact shrink this read exists to prevent. Only a genuine
    // not-found is an empty library; any other I/O failure leaves the published
    // state unknown.
    return isObjectNotFoundError(err) ? [] : null
  }
  try {
    const manifest = JSON.parse(raw) as AnchorLibraryManifest
    if (manifest?.version !== ANCHOR_LIBRARY_MANIFEST_VERSION || !Array.isArray(manifest.anchors)) {
      return []
    }
    return manifest.anchors.filter(isValidManifestEntry)
  } catch {
    // The object exists but does not parse. Same policy as a v1 / malformed
    // manifest: unusable, so discard rather than deadlock the store on it forever.
    return []
  }
}

// A storage "object not found", as distinct from any other read failure.
function isObjectNotFoundError(err: unknown): boolean {
  const code = (err as null | { code?: unknown })?.code
  return code === 404 || code === '404'
}

function normalizeReuseMatchKey(value: null | string | undefined): string {
  return (value ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function tokenizeReuseMatchKey(value: null | string | undefined): string[] {
  const normalized = normalizeReuseMatchKey(value)
  return normalized ? normalized.split(' ') : []
}

/**
 * Fuzzy keyword equivalence for two generated-anchor keywords that drift by a
 * qualifier across videos ("Clipping UI" vs "AI Clipping UI"). True when the
 * shorter keyword's token set is fully contained in the longer one, the shorter
 * carries at least FUZZY_KEYWORD_MIN_SHORTER_TOKENS tokens (a phrase, not a lone
 * category word), AND the pair shares a content-bearing token
 * (>= FUZZY_KEYWORD_MIN_CONTENT_TOKEN_LEN chars). Three guards, each closing a
 * false-positive class:
 *   - containment keeps disjoint subjects apart ("Login UI" != "Clipping UI");
 *   - the >=2-token floor stops a bare generic category word ("Logo", "Woman",
 *     "Product") from binding to a specific phrase ("Acme Logo", "Business Woman");
 *   - the content-token floor stops overlap on a short qualifier alone ("UI").
 * Deterministic, list-free, no LLM.
 */
function keywordsFuzzyMatch(a: null | string | undefined, b: null | string | undefined): boolean {
  const aTokens = new Set(tokenizeReuseMatchKey(a))
  const bTokens = new Set(tokenizeReuseMatchKey(b))
  if (aTokens.size === 0 || bTokens.size === 0) {
    return false
  }
  const [smaller, larger] = aTokens.size <= bTokens.size ? [aTokens, bTokens] : [bTokens, aTokens]
  if (smaller.size < FUZZY_KEYWORD_MIN_SHORTER_TOKENS) {
    // A single-token keyword is too generic to bind on containment alone.
    return false
  }
  let hasContentOverlap = false
  for (const token of smaller) {
    if (!larger.has(token)) {
      // Not fully contained -> the keywords name distinct subjects.
      return false
    }
    if (token.length >= FUZZY_KEYWORD_MIN_CONTENT_TOKEN_LEN) {
      hasContentOverlap = true
    }
  }
  return hasContentOverlap
}

// Identity-key weights. proper_name (4) outweighs visual_tag (2) + keyword (1)
// COMBINED, so a proper_name match always beats a non-proper_name match (global
// precedence). Secondary keys only break ties AMONG entries that share the
// winning key.
const MATCH_WEIGHT_PROPER_NAME = 4
const MATCH_WEIGHT_VISUAL_TAG = 2
const MATCH_WEIGHT_KEYWORD = 1

// A fuzzy keyword match scores strictly BELOW an exact keyword match (1), so an
// exact match always wins the keyword dimension and fuzzy only decides among
// entries that share no exact key -- it can only WIDEN which anchors reuse, never
// override a genuine exact identity match. It exists because the planner emits
// slightly different keywords per video for the same generated subject
// ("Clipping UI" vs "AI Clipping UI"), so a generated prop/logo without a
// proper_name otherwise regenerates and drifts instead of reusing.
const MATCH_WEIGHT_KEYWORD_FUZZY = 0.5

// A shared token must be at least this long to license a fuzzy keyword match, so
// overlap on a short generic qualifier alone ("ai", "ui", "the") never binds two
// distinct subjects -- only a content-bearing word ("clipping", "b-roll") does.
const FUZZY_KEYWORD_MIN_CONTENT_TOKEN_LEN = 4

// The shorter keyword must be a multi-token phrase to fuzzy-match, so a lone
// category word ("Logo", "Woman", "Product") never binds to a specific phrase
// ("Acme Logo", "Business Woman") that merely contains it.
const FUZZY_KEYWORD_MIN_SHORTER_TOKENS = 2

/**
 * The identity a candidate is matched on -- the subset of anchor fields the
 * weighted scorer reads. The render side builds this from a
 * `LongTakeAnchorAssetTask` (which lacks `visual_tag`, so it passes undefined and
 * the scorer simply never awards that weight), reusing this one matcher.
 */
export interface AnchorMatchIdentity {
  keyword: null | string | undefined
  // See `StoredAnchorManifestEntry.prompt_transform`. A mismatch
  // ZEROES the score rather than merely failing to add weight -- the scorer is
  // additive, so an extra key changes nothing on its own.
  prompt_transform?: null | string
  proper_name: null | string | undefined
  // The ONE brand-bank asset this anchor derives from, already resolved
  // by the caller against its brand allowlist (`resolveBrandSourceAssetId`). The
  // primary, drift-free match key. null / omitted for an anchor with no single
  // brand source, which is matched on the identity text alone.
  source_asset_id?: null | string
  // Every brand asset this anchor derives from (`resolveBrandSourceAssetIds`),
  // so a multi-source anchor still carries a key. Falls back to `source_asset_id`
  // when omitted, which is how a caller that only resolves the single id behaves
  // exactly as before.
  source_asset_ids?: string[]
  type: 'CHARACTER' | 'OBJECT'
  visual_tag?: null | string | undefined
}

/**
 * Deterministic identity match between a candidate identity and a stored entry
 * -- no LLM. `type` must always agree. Among same-type entries, picks the
 * highest weighted-key score (proper_name > visual_tag > keyword; more matching
 * keys beats fewer), first entry winning a tie. A keyword that is not an exact
 * match but a qualifier-drift fuzzy match scores below an exact keyword, so it
 * only widens which anchors reuse (never overrides an exact match). Fuzzy
 * keyword matching is suppressed when both sides carry a DIFFERENT `proper_name`
 * -- two explicitly named subjects are distinct, so a nameless-anchor keyword
 * drift must never bind one to the other. Pass `fuzzy: false` for an exact-only
 * pass (used to reserve exact matches before any fuzzy binding). Returns null
 * when nothing shares a key.
 */
export function matchStoredAnchorEntryByIdentity(
  identity: AnchorMatchIdentity,
  entries: readonly StoredAnchorManifestEntry[],
  options?: { fuzzy?: boolean },
): null | StoredAnchorManifestEntry {
  let best: null | StoredAnchorManifestEntry = null
  let bestScore = 0
  for (const entry of entries) {
    const score = scoreIdentityAgainstEntry(identity, entry, options?.fuzzy !== false)
    if (score > bestScore) {
      bestScore = score
      best = entry
    }
  }
  return bestScore > 0 ? best : null
}

/**
 * The weighted identity score for one (identity, entry) pair; 0 when they share no
 * key or disagree on type. Extracted so the asset-group disambiguation can rank
 * ALL pairs before binding any (see `assignStoredAnchorEntries`).
 */
function scoreIdentityAgainstEntry(
  identity: AnchorMatchIdentity,
  entry: StoredAnchorManifestEntry,
  allowFuzzy: boolean,
): number {
  if (entry.type !== identity.type) {
    return 0
  }
  // A transformed anchor and a stored entry depicting a DIFFERENT form
  // of the same subject are not interchangeable, however well their text keys
  // agree -- reusing the stored image would silently render the untransformed
  // subject after the plan already recorded the transform. This ZEROES the pair
  // rather than declining to add weight: `score` below is additive, so a mere
  // extra key would leave `proper_name` equality alone scoring non-zero and
  // change nothing. Both sides absent (every older manifest) is not a
  // conflict, so old entries keep matching exactly as before.
  if (transformsConflict(identity.prompt_transform, entry.prompt_transform)) {
    return 0
  }
  const properName = normalizeReuseMatchKey(identity.proper_name)
  const visualTag = normalizeReuseMatchKey(identity.visual_tag)
  const keyword = normalizeReuseMatchKey(identity.keyword)
  const entryProperName = normalizeReuseMatchKey(entry.proper_name)
  // Two explicitly named subjects that name DIFFERENT people/brands are
  // distinct; never let a fuzzy keyword drift bind one to the other.
  const properNamesConflict = Boolean(
    properName && entryProperName && properName !== entryProperName,
  )
  let score = 0
  if (properName && entryProperName === properName) {
    score += MATCH_WEIGHT_PROPER_NAME
  }
  if (visualTag && normalizeReuseMatchKey(entry.visual_tag) === visualTag) {
    score += MATCH_WEIGHT_VISUAL_TAG
  }
  if (keyword && normalizeReuseMatchKey(entry.keyword) === keyword) {
    score += MATCH_WEIGHT_KEYWORD
  } else if (
    allowFuzzy &&
    keyword &&
    !properNamesConflict &&
    keywordsFuzzyMatch(identity.keyword, entry.keyword)
  ) {
    score += MATCH_WEIGHT_KEYWORD_FUZZY
  }
  return score
}

/**
 * Whether a candidate and a stored entry describe DIFFERENT forms of a subject.
 * Absent / null / blank all normalize to "the as-uploaded form", so
 * a manifest written before the field existed reads as untransformed and keeps
 * matching an untransformed candidate. Also consulted by the tier-0 asset-key
 * guard in `assignStoredAnchorEntries`, which binds a forced 1:1 asset pair even
 * at score 0 and is therefore NOT covered by the zeroing rule alone.
 */
function transformsConflict(
  identityTransform: null | string | undefined,
  entryTransform: null | string | undefined,
): boolean {
  return normalizeReuseMatchKey(identityTransform) !== normalizeReuseMatchKey(entryTransform)
}

// Asset-id tier key: the brand asset AND the anchor type, so one photo used as
// both a CHARACTER and an OBJECT anchor can never cross-bind (a QA brief's
// `brand_product_382b85dc` legitimately produced a CHARACTER *and* an OBJECT).
// The asset half is bucket-stripped: the bucket is session-local, so
// the SAME file stored under `brand_logo_8f989fdd` must still match a later
// session's `brand_product_8f989fdd`. Normalizing on READ means manifests written
// with the bucketed id keep matching -- no migration.
function assetGroupKey(assetId: string, type: 'CHARACTER' | 'OBJECT'): string {
  return `${stripBrandBucket(assetId)}\u0000${type}`
}

// Every asset-tier key one side carries: the full `source_asset_ids` set when
// present, else the single `source_asset_id` -- which is how a legacy
// manifest entry, and a caller that only resolves one id, keep keying exactly as
// before.
function entryAssetKeys(entry: StoredAnchorManifestEntry): Set<string> {
  return toAssetKeys(entry.source_asset_ids, entry.source_asset_id, entry.type)
}

function identityAssetKeys(identity: AnchorMatchIdentity): Set<string> {
  return toAssetKeys(identity.source_asset_ids, identity.source_asset_id, identity.type)
}

function sharedAssetKeys(a: ReadonlySet<string>, b: ReadonlySet<string>): string[] {
  return [...a].filter((key) => b.has(key))
}

function toAssetKeys(
  ids: string[] | undefined,
  single: null | string | undefined,
  type: 'CHARACTER' | 'OBJECT',
): Set<string> {
  const sources = Array.isArray(ids) && ids.length > 0 ? ids : [single]
  const keys = new Set<string>()
  for (const raw of sources) {
    const id = raw?.trim()
    if (id) {
      keys.add(assetGroupKey(id, type))
    }
  }
  return keys
}

// How many identities / entries carry each asset key, so a pair that is the ONLY
// possible binding for one of its keys can bind on the key alone, without
// consulting the drifting identity text at all (one asset -> one anchor on both
// sides, the overwhelmingly common case).
function countAssetKeys(keySets: readonly ReadonlySet<string>[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const keys of keySets) {
    for (const key of keys) {
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  return counts
}

/**
 * Assign stored entries to candidate identities, brand-asset id FIRST and every
 * EXACT identity match reserved before any fuzzy one. Four ordered tiers, each
 * binding only against entries no earlier tier claimed:
 *
 *  0. Brand asset id. An anchor generated from brand-bank
 *     assets is matched on those assets' ids -- the one key that is stable across
 *     videos, since the planner's keyword / proper_name for the same subject
 *     drifts freely between videos ("Young" -> "Acme Founder", "AI Editing
 *     UI" -> "Editing Interface"). Deterministic and exact, on the
 *     bucket-stripped digest and the anchor type. Both sides may carry
 *     SEVERAL assets (a composite anchor), so a pair binds on a non-empty key
 *     INTERSECTION and pairs rank by (shared keys, identity score): the more
 *     assets two sides agree on, the stronger the claim. A pair that shares a key
 *     no other pair can use binds outright; otherwise the identity text
 *     disambiguates, so one asset's several anchors (a logo file yielding white /
 *     black / abstract variants) can't swap -- a weakly-matching variant never
 *     claims the entry a stronger one needs, and the outcome is independent of
 *     input order.
 *  1. Exact identity match (proper_name / visual_tag / keyword).
 *  2. Fuzzy keyword match.
 *  3. Exact-identity LAST RESORT for an anchor whose brand assets
 *     matched NOTHING in the stored set, against key-carrying entries whose
 *     assets likewise matched nothing -- and only when NO entry in the set was
 *     reached by any asset key.
 *
 * Tiers 1-2 are SKIPPED for an anchor that HAS brand-asset sources: the assets
 * are that anchor's identity, so a text match onto a DIFFERENT brand asset's
 * stored anchor is a wrong reuse, not a wider one (a second video's black-logo
 * anchor text-matching the first video's white-logo anchor). Anchors with no
 * brand source (script-only, composite of foreign refs) keep the identity tiers
 * unchanged.
 *
 * Tier 3 exists because an asset id can still drift for a reason the digest cannot
 * absorb: a re-crawl restages every brand file under a new URI, so a whole stored
 * set orphans at once and would otherwise regenerate and drift. It is deliberately
 * the narrowest possible rescue -- see the gates at the tier itself. Every bind it
 * makes is logged, because it is the one tier that binds on text alone.
 *
 * Returns one slot per identity (by index): the claimed entry or null; each entry
 * is claimed at most once. Within tiers 1-3 the first identity wins ties. The
 * single assignment definition shared by the planner and render reuse callers.
 */
export function assignStoredAnchorEntries(
  identities: readonly AnchorMatchIdentity[],
  entries: readonly StoredAnchorManifestEntry[],
): (null | StoredAnchorManifestEntry)[] {
  const assigned: (null | StoredAnchorManifestEntry)[] = identities.map(() => null)
  const claimed = new Set<StoredAnchorManifestEntry>()
  const bindByIdentity = (
    index: number,
    pool: readonly StoredAnchorManifestEntry[],
    fuzzy: boolean,
  ): null | StoredAnchorManifestEntry => {
    const identity = identities[index]
    if (!identity || assigned[index]) {
      return null
    }
    const entry = matchStoredAnchorEntryByIdentity(
      identity,
      pool.filter((candidate) => !claimed.has(candidate)),
      { fuzzy },
    )
    if (entry) {
      assigned[index] = entry
      claimed.add(entry)
    }
    return entry
  }

  // --- Tier 0: brand asset id ---
  const entryKeys = entries.map(entryAssetKeys)
  const identityKeys = identities.map(identityAssetKeys)
  const entryKeyCounts = countAssetKeys(entryKeys)
  const identityKeyCounts = countAssetKeys(identityKeys)
  // Whether each side found ANY counterpart sharing an asset key -- not whether it
  // went on to bind. A side that had a counterpart and merely lost the ranking has
  // still been "spoken for" by that asset, so tier 3 must leave it alone.
  const identityKeyMatched = identities.map(() => false)
  const entryKeyMatched = entries.map(() => false)
  const assetPairs: {
    entry: StoredAnchorManifestEntry
    entryIndex: number
    forced: boolean
    index: number
    overlap: number
    score: number
    // This pair shares a brand asset but depicts different forms of
    // the subject. `forced` binds a 1:1 asset pair even at score 0, so the
    // zeroing rule in `scoreIdentityAgainstEntry` does not stop it here.
    transformConflict: boolean
  }[] = []
  identities.forEach((identity, index) => {
    const keys = identityKeys[index]
    if (!keys?.size) {
      return
    }
    entries.forEach((entry, entryIndex) => {
      const shared = sharedAssetKeys(keys, entryKeys[entryIndex] ?? new Set())
      if (shared.length === 0) {
        return
      }
      identityKeyMatched[index] = true
      entryKeyMatched[entryIndex] = true
      assetPairs.push({
        entry,
        entryIndex,
        forced: shared.some(
          (key) => identityKeyCounts.get(key) === 1 && entryKeyCounts.get(key) === 1,
        ),
        index,
        overlap: shared.length,
        score: scoreIdentityAgainstEntry(identity, entry, true),
        transformConflict: transformsConflict(identity.prompt_transform, entry.prompt_transform),
      })
    })
  })
  assetPairs.sort(
    (a, b) =>
      b.overlap - a.overlap ||
      b.score - a.score ||
      a.index - b.index ||
      a.entryIndex - b.entryIndex,
  )
  for (const pair of assetPairs) {
    // A pair with no identity signal binds only when it is forced; otherwise the
    // text is the discriminator among an asset's several anchors, and a scoreless
    // pair would bind an arbitrary one of them. A transform conflict is never
    // bindable, forced or not: one brand photo of Sam legitimately backs both
    // the plain and the pirate anchor, so a shared asset id is not evidence that
    // the STORED IMAGE depicts the form this candidate needs.
    if (
      assigned[pair.index] ||
      claimed.has(pair.entry) ||
      pair.transformConflict ||
      (pair.score === 0 && !pair.forced)
    ) {
      continue
    }
    assigned[pair.index] = pair.entry
    claimed.add(pair.entry)
  }

  // --- Tiers 1-2: identity, exact before fuzzy, globally. Only for anchors with
  // no brand asset source; a brand-derived anchor that found no asset-id match
  // falls to tier 3 rather than text-matching another asset's image.
  const identityEligible = (index: number): boolean =>
    !assigned[index] && !identityKeys[index]?.size
  for (const fuzzy of [false, true]) {
    identities.forEach((_identity, index) => {
      if (identityEligible(index)) {
        bindByIdentity(index, entries, fuzzy)
      }
    })
  }

  // --- Tier 3: exact-identity last resort for a brand anchor no asset key reached.
  //
  // Two gates, because the case this rescues and the case it must not are
  // observationally identical from one entry alone -- both are "old id gone, new
  // id present, same name":
  //
  //  - the pool is entries that CARRY a brand key and merely found no counterpart,
  //    never a keyless one. A keyless entry is either an old multi-source anchor or
  //    one whose source set was VETOED for mixing in a foreign reference, and the
  //    manifest cannot tell those apart -- admitting them would let a brand anchor
  //    inherit an image carrying private / other-brand content (what the veto
  //    closed). Old multi-source entries lose nothing lasting: the next store
  //    records their full `source_asset_ids` and tier 0 then matches them outright.
  //  - and the WHOLE stored set must have gone unreached. A restage / re-extraction
  //    rewrites every staging_uri at once, so every entry orphans together -- that
  //    is the drift worth rescuing. A user REPLACING one brand asset orphans just
  //    that one while its siblings still match by id, and rescuing it would
  //    passthrough the image the user deliberately replaced. Worse, the reused
  //    image is then re-stored under the NEW asset id, stamping the stale visual
  //    onto it permanently -- the same "make a transient text-match error
  //    permanent" hazard that makes v1 manifests unreadable (see
  //    ANCHOR_LIBRARY_MANIFEST_VERSION). Regenerating costs one video's drift and
  //    self-heals on the next store.
  const wholeSetUnreached = entryKeyMatched.every((matched) => !matched)
  const orphanedEntries = wholeSetUnreached
    ? entries.filter((_entry, entryIndex) => Boolean(entryKeys[entryIndex]?.size))
    : []
  identities.forEach((identity, index) => {
    if (assigned[index] || !identityKeys[index]?.size || identityKeyMatched[index]) {
      return
    }
    const entry = bindByIdentity(index, orphanedEntries, false)
    if (entry) {
      logger.info(
        `anchor-library-store: last-resort identity bind -- anchor "${identity.proper_name ?? identity.keyword ?? ''}" (asset ${identity.source_asset_id ?? identity.source_asset_ids?.join(',') ?? 'none'}) reused stored ${entry.anchor_id} (${entry.file}); neither side's brand asset id matched`,
      )
    }
  })
  return assigned
}
