// Store generated anchor assets to the durable brand library for reuse.
//
// A saved brand (BrandBrief) already persists its brand_bank source refs to
// brand-library/<orgId>/<briefId>/ (apps/services/api brand-brief-assets.ts).
// The GENERATED anchor finals, however, are ephemeral per-project, so three
// videos for the same brand + style each regenerate their own anchor images and
// the character / product / logo drift between videos.
//
// This module copies the freshly generated anchor finals out of the project
// workspace into a style-scoped folder under the brand's durable library prefix:
//   brand-library/<orgId>/<briefId>/anchors/<styleHash>/<file>
//   brand-library/<orgId>/<briefId>/anchors/<styleHash>/manifest.json
// The REUSE half reads this manifest and seeds the stored images as pre-made
// passthrough anchors, skipping regeneration so the visuals stay identical.
//
// This file holds the SESSION-coupled wrappers (planner SessionState / candidate
// / summary types). The session-free, LLM-free core -- the storage key + layout,
// manifest schema/build/read, style hash, matcher -- lives in
// ./anchor-library-core so the render side (story-mode-runtime) can deep-import it
// without the planner barrel's heavy graph. Re-exported here so existing callers
// and the package barrel keep importing from one place.

import type {
  AnchorAssetCandidate,
  AnchorAssetsSummary,
  AnchorAssetSummaryItem,
} from '../anchor-types'
import type { SessionState, UploadedAsset } from '../types'

import {
  type AnchorLibraryManifest,
  type AnchorLibraryTarget,
  anchorLibraryTargetFromKey,
  type AnchorMatchIdentity,
  assignStoredAnchorEntries,
  buildAnchorLibraryStorage,
  computeStyleHashFromText,
  matchStoredAnchorEntryByIdentity,
  resolveBrandSourceAssetId,
  resolveBrandSourceAssetIds,
  reuseSourceAssetId,
  type SessionFinalPrune,
  type StoredAnchorManifestEntry,
} from './anchor-library-core'
import { brandStagedAssetsToUploads, inferContentType } from './brand-staged-assets-to-uploads'
import { getEffectiveStyleText } from './generate-visual-script-full-scope-story-runtime'

// Re-export the shared core so callers + the package barrel keep one import site.
export {
  ANCHOR_LIBRARY_MANIFEST_FILE,
  ANCHOR_LIBRARY_MANIFEST_VERSION,
  ANCHOR_REUSE_SOURCE_ID_PREFIX,
  type AnchorLibraryManifest,
  type AnchorLibraryTarget,
  anchorLibraryTargetFromKey,
  type AnchorMatchIdentity,
  assignStoredAnchorEntries,
  buildAnchorLibraryManifest,
  buildAnchorLibraryStorage,
  computeStyleHashFromText,
  loadAnchorLibraryManifestByTarget,
  matchStoredAnchorEntryByIdentity,
  mergeStoredAnchorEntries,
  readPublishedAnchorEntries,
  resolveBrandSourceAssetId,
  resolveBrandSourceAssetIds,
  reuseSourceAssetId,
  type SessionFinalPrune,
  type StoredAnchorManifestEntry,
} from './anchor-library-core'

/**
 * Resolve the merge's session-final prune from a store's inputs, or undefined
 * whenever pruning must not run. All three guards are load-bearing:
 * `ownerScope` is the caller's explicit opt-in (only the confirm-time
 * session-FINAL store passes it -- a partial or legacy store must never prune);
 * `plannedAnchorIds` is the persisted anchor plan's candidate set (no plan, no
 * provable user intent, no prune); and a non-`success` summary skips pruning
 * entirely, so a failed re-generation can never delete a good stored image.
 * Pure -- exported for unit tests.
 */
export function resolveSessionFinalPrune(args: {
  ownerScope: 'session_final' | undefined
  plannedAnchorIds: ReadonlySet<string> | undefined
  projectId: string
  summaryStatus: AnchorAssetsSummary['status']
}): SessionFinalPrune | undefined {
  if (args.ownerScope !== 'session_final' || !args.plannedAnchorIds) {
    return undefined
  }
  if (args.summaryStatus !== 'success') {
    return undefined
  }
  return {
    ownerScope: 'session_final',
    plannedAnchorIds: args.plannedAnchorIds,
    sessionProjectId: args.projectId,
  }
}

/**
 * Stable per-style key for a session's anchor set (sha256 of the trimmed
 * effective style text). Delegates to the session-free core so the render side
 * computes the same hash and lands on the same stored set.
 */
export function computeStyleHash(session: SessionState): string {
  return computeStyleHashFromText(getEffectiveStyleText(session))
}

/**
 * Resolve the durable target for a session's anchor set, or null when the
 * session is not a saved-brand reuse we should store for. Pure -- no I/O.
 * Returns null when: the bank was not injected from the brand library, the org
 * scope is absent (cannot build the org-keyed prefix), or the session has no
 * effective style text (no stable key to scope by).
 */
export function resolveAnchorLibraryTarget(session: SessionState): AnchorLibraryTarget | null {
  const source = session.spec.global_constraints.brand_bank_source
  if (source?.kind !== 'brand_library' || !source.brief_id) {
    return null
  }
  const orgId = session.orgId
  if (!orgId) {
    return null
  }
  if (!getEffectiveStyleText(session).trim()) {
    return null
  }
  return anchorLibraryTargetFromKey({
    briefId: source.brief_id,
    orgId,
    styleHash: computeStyleHash(session),
  })
}

/**
 * The synthetic asset ids of a bank's staged assets -- the exact ids the anchor
 * manager saw in its upload pool (brandStagedAssetsToUploads), so an anchor
 * sourced from the brand bank carries one of these in its `source_asset_ids`.
 * Pure.
 */
export function brandStagedAssetIds(session: SessionState): Set<string> {
  return new Set(
    brandStagedAssetsToUploads(session.spec.global_constraints.brand_bank).map(
      (upload) => upload.asset_id,
    ),
  )
}

// A stored anchor must trace back to the saved brand bank. A saved-brand session
// can also generate project-specific anchors (script-only subjects, article
// photos, one-off uploads); copying those into the ORG-SHARED brand library
// would leak private / story-specific visuals and wrongly reuse them across the
// brand's future videos. Conservative by design: an anchor with no brand-asset
// source is treated as project-specific and skipped.
function isBrandOwnedAnchor(
  anchor: AnchorAssetSummaryItem,
  brandAssetIds: ReadonlySet<string>,
): boolean {
  if (anchor.source_asset_id && brandAssetIds.has(anchor.source_asset_id)) {
    return true
  }
  return (anchor.source_asset_ids ?? []).some((id) => brandAssetIds.has(id))
}

/**
 * The anchors worth storing: fully generated (`ready`) with a resolved preview
 * image AND owned by the brand (sourced from the bank). Skips still-generating /
 * failed / preview-less and project-specific anchors. Pure.
 */
export function collectStorableAnchors(
  summary: AnchorAssetsSummary,
  brandAssetIds: ReadonlySet<string>,
): AnchorAssetSummaryItem[] {
  return summary.anchors.filter(
    (anchor) =>
      anchor.status === 'ready' &&
      Boolean(anchor.preview_relative_path) &&
      isBrandOwnedAnchor(anchor, brandAssetIds),
  )
}

// The object name for a stored anchor, namespaced under the SOURCE project id
// (mirrors the render store's layout). anchor_id is unique within one session, so
// prefix with it to guarantee distinct sources never collide in the style folder
// (the passthrough fallback can carry an arbitrary source basename -- two such
// sources could otherwise share a basename and clobber each other). The project
// segment then makes the object immutable ACROSS sessions, which the merge
// requires: a manifest now carries entries from several sessions, and
// anchor_id is only session-unique, so a flat name would let a later session's
// copy silently overwrite the image a kept entry still points at. `file` is always
// resolved manifest-relative, so the extra segment is transparent to the reuse
// side. The source extension is preserved for clarity.
export function storedAnchorFile(projectId: string, anchor: AnchorAssetSummaryItem): string {
  const basename = anchor.preview_relative_path?.split('/').findLast(Boolean) ?? ''
  const ext = basename.includes('.') ? basename.slice(basename.lastIndexOf('.')) : '.png'
  return `${projectId}/${anchor.anchor_id}${ext}`
}

/**
 * The anchor's source asset ids, as the reuse matcher reads them: the full list
 * when present, else the single `source_asset_id`. Shared by the store (which
 * narrows them to the brand allowlist) and the matcher, so both sides see the
 * same source set. Pure.
 */
export function anchorSourceAssetIds(
  anchor: AnchorAssetCandidate | AnchorAssetSummaryItem,
): string[] {
  return anchor.source_asset_ids?.length
    ? anchor.source_asset_ids
    : [anchor.source_asset_id].filter((id): id is string => Boolean(id))
}

/** @internal exported for the manifest-writer guard test */
export function toManifestEntry(
  anchor: AnchorAssetSummaryItem,
  file: string,
  brandAssetIds: ReadonlySet<string>,
): StoredAnchorManifestEntry {
  return {
    anchor_id: anchor.anchor_id,
    file,
    is_multi_angle: anchor.is_multi_angle,
    keyword: anchor.keyword,
    label: anchor.label,
    // Part of the match identity, so a later video's transformed
    // anchor can never reuse a stored image of the untransformed subject (and
    // vice versa). Normalized to null so an omitted field, an explicit null and
    // a blank string are one value in the manifest -- the zod schema only trims,
    // so a whitespace-only model answer arrives as '' and would otherwise persist
    // as a transform that both prompt rendering and the matcher read as none.
    prompt_transform: anchor.prompt_transform?.trim() || null,
    proper_name: anchor.proper_name,
    // The stable cross-video match key. Narrowed by MEMBERSHIP in this
    // bank's staged ids (not the id shape), so a stale / other-brand cached
    // upload is never recorded as this brand's source.
    source_asset_id: resolveBrandSourceAssetId({
      allowedAssetIds: brandAssetIds,
      sourceIds: anchorSourceAssetIds(anchor),
    }),
    // The full source set, so a multi-source anchor -- which collapses
    // to `source_asset_id: null` and could never match -- still records a key the
    // matcher can intersect.
    source_asset_ids: resolveBrandSourceAssetIds({
      allowedAssetIds: brandAssetIds,
      sourceIds: anchorSourceAssetIds(anchor),
    }),
    type: anchor.type,
    visual_tag: anchor.visual_tag,
  }
}

/**
 * Brand-library anchor storage (the write half of the brand anchor library) does not run: this
 * is a no-op that keeps the api confirm orchestration's call site compiling.
 */
export function persistAnchorsToBrandLibrary(_args: {
  /**
   * The staged-asset ids of the session's brand bank (the exact synthetic ids
   * the anchor manager saw) -- the ownership allowlist for what may enter the
   * org-shared library.
   */
  brandStagedAssetIds: ReadonlySet<string>
  /**
   * Session-final prune opt-in: pass ONLY from the confirm-time
   * store of a session's FINAL set, together with `plannedAnchorIds`, to drop
   * this session's own previously published entries that the user removed
   * before confirming. A partial or legacy store must never pass it.
   */
  ownerScope?: 'session_final'
  /**
   * The persisted anchor plan's candidate anchor_ids
   * (`anchor_assets/asset_plan.json`) -- the user's explicit intent of what
   * should exist. Required for the prune to run; without it the merge stays
   * strictly non-shrinking.
   */
  plannedAnchorIds?: ReadonlySet<string>
  /** The source project the anchor finals are copied out of. */
  projectId: string
  /** Manifest metadata only; never part of the storage key. */
  styleName: null | string
  summary: AnchorAssetsSummary
  target: AnchorLibraryTarget
}): Promise<void> {
  return Promise.resolve()
}

// =============================================================================
// REUSE half (planner side). Read the manifest the store half wrote
// and rehydrate the stored anchor finals as pre-made passthrough sources so a
// later video for the same (brand, style) reuses the exact same visuals instead
// of regenerating them. All activity-side (storage I/O). Opt-in and best-effort: a
// session with the gate off, no stored set, or a read error simply generates
// anchors normally.
// =============================================================================

export interface AnchorReuseBinding {
  candidates: AnchorAssetCandidate[]
  reusedAnchorIds: string[]
}

/**
 * Synthetic upload-pool entries for a manifest's stored anchor finals, keyed by
 * `reuseSourceAssetId`. Pure -- the caller existence-filters them against storage
 * (like brand-staged assets) before they enter the pool, so a stored object
 * that has since been reaped can't brick generation. Returns [] when the target
 * can't be resolved (paired with a manifest, this never happens in practice).
 */
export function storedAnchorReuseUploads(
  session: SessionState,
  manifest: AnchorLibraryManifest,
): UploadedAsset[] {
  const target = resolveAnchorLibraryTarget(session)
  if (!target) {
    return []
  }
  const libraryStorage = buildAnchorLibraryStorage(target)
  const uploadedAt = new Date().toISOString()
  return manifest.anchors.map((entry) => ({
    asset_id: reuseSourceAssetId(entry),
    content_type: inferContentType(entry.file),
    file_name: entry.label || entry.anchor_id,
    file_path: libraryStorage.getFullPath(entry.file),
    uploaded_at: uploadedAt,
  }))
}

/**
 * Deterministic identity match between a freshly planned anchor candidate and a
 * stored manifest entry -- no LLM. Delegates to the session-free scorer. Identity
 * text only: the asset-id tier is a whole-set assignment (one asset's anchors are
 * disambiguated against each other), so it lives in
 * `bindStoredAnchorsToCandidates` / `assignStoredAnchorEntries`.
 */
export function matchStoredAnchorEntry(
  candidate: AnchorAssetCandidate,
  entries: readonly StoredAnchorManifestEntry[],
): null | StoredAnchorManifestEntry {
  return matchStoredAnchorEntryByIdentity(
    {
      keyword: candidate.keyword,
      // A transformed anchor and a stored entry depicting another form
      // of the same subject must never bind, however well their text agrees.
      prompt_transform: candidate.prompt_transform ?? null,
      proper_name: candidate.proper_name,
      type: candidate.type,
      visual_tag: candidate.visual_tag,
    },
    entries,
  )
}

/**
 * The match identity of a planned candidate -- its drifting text keys PLUS the
 * single brand asset it derives from, so the asset-id tier can key on the stable
 * brand asset. `brandAssetIds` is the current bank's staged ids
 * (membership, exactly as the store's ownership gate uses), so a candidate and the
 * stored entry it should bind to resolve their asset id under the same rule.
 */
function toAnchorMatchIdentity(
  candidate: AnchorAssetCandidate,
  brandAssetIds: ReadonlySet<string>,
): AnchorMatchIdentity {
  return {
    keyword: candidate.keyword,
    // See `matchStoredAnchorEntry`. Carried here too because this is
    // the identity the whole-set assignment in `assignStoredAnchorEntries`
    // actually uses -- the binding path in production.
    prompt_transform: candidate.prompt_transform ?? null,
    proper_name: candidate.proper_name,
    source_asset_id: resolveBrandSourceAssetId({
      allowedAssetIds: brandAssetIds,
      sourceIds: anchorSourceAssetIds(candidate),
    }),
    // The full set, so a candidate composed of several bank assets can
    // still intersect a stored entry instead of resolving to no key at all.
    source_asset_ids: resolveBrandSourceAssetIds({
      allowedAssetIds: brandAssetIds,
      sourceIds: anchorSourceAssetIds(candidate),
    }),
    type: candidate.type,
    visual_tag: candidate.visual_tag,
  }
}

/**
 * Rewrite the FULL-scope generation candidates that match a stored anchor to
 * passthrough the stored final: point their source at the rehydrated upload and
 * set `passthrough: true` so Phase C copies the stored image verbatim instead of
 * regenerating. Pure. Only entries whose rehydrated upload actually survived the
 * pool's existence filter (`availableSourceIds`) are bindable, and each stored
 * entry binds at most one candidate. Candidates with no match pass through
 * unchanged, so a new video's script-only subjects still generate.
 *
 * IMPORTANT: this rewrites ONLY the transient generation candidates -- the
 * persisted anchor plan keeps the freshly generated sources, so a later
 * ANCHOR_IDS edit regenerates the anchor normally (project-local edit
 * locked scope) with no edit-path special-casing.
 */
export function bindStoredAnchorsToCandidates(args: {
  availableSourceIds: ReadonlySet<string>
  brandAssetIds: ReadonlySet<string>
  candidates: AnchorAssetCandidate[]
  manifest: AnchorLibraryManifest
}): AnchorReuseBinding {
  const remaining = args.manifest.anchors.filter((entry) =>
    args.availableSourceIds.has(reuseSourceAssetId(entry)),
  )
  // Asset-id-first, then exact-before-fuzzy assignment (shared with the render
  // side) so a drifted keyword can't bind a candidate to another brand asset's
  // stored anchor, and a fuzzy-only candidate never steals an entry a later exact
  // candidate needs.
  const assignments = assignStoredAnchorEntries(
    args.candidates.map((candidate) => toAnchorMatchIdentity(candidate, args.brandAssetIds)),
    remaining,
  )
  const reusedAnchorIds: string[] = []
  const candidates = args.candidates.map((candidate, index) => {
    const entry = assignments[index]
    if (!entry) {
      return candidate
    }
    reusedAnchorIds.push(candidate.anchor_id)
    const sourceId = reuseSourceAssetId(entry)
    return {
      ...candidate,
      passthrough: true,
      source_asset_id: sourceId,
      source_asset_ids: [sourceId],
    }
  })
  return { candidates, reusedAnchorIds }
}
