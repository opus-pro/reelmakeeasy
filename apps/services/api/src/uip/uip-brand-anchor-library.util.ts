// Brand anchor-library key resolution shared by the two confirm orchestrations.
// The (brief, styleHash) key decides which stored anchor set a
// video reads and writes, so the standard and fast paths MUST derive it
// identically -- extracted from uip-confirm-fast-orchestration so they can
// never drift. The standard path stores the session's FINAL anchor set here at
// confirm time; the fast path threads the key to its workflow, whose render
// side stores/reuses against the same storage layout.

import { createSubLogger } from '@reelmakeeasy/common/logger'
import { normalizeStyleInstruction } from '@reelmakeeasy/common/uip/normalization'
import {
  anchorLibraryTargetFromKey,
  brandStagedAssetsToUploads,
  computeStyleHashFromText,
  persistAnchorsToBrandLibrary,
  type PersistedSessionState,
  type Spec,
} from '@reelmakeeasy/uip-planner-runtime'

const logger = createSubLogger('uip-service')

/**
 * The resolved (brand, style) coordinates of a session's anchor set. Matches
 * the `brandAnchorLibrary` workflow-arg shape the fast path hands to
 * UipToStoryModeFastWorkflow (orgId travels separately on both paths).
 */
export interface BrandAnchorLibraryKey {
  /**
   * The EXACT staged-asset ids of the current brand bank (the same synthetics
   * the anchor manager saw), so a store publishes only anchors that trace to
   * THIS brand -- membership, not a brand_<...> id shape, which a stale /
   * other-brand cached upload could also match and thereby leak into the
   * org-shared library.
   */
  brandStagedAssetIds: string[]
  briefId: string
  styleHash: string
  styleName: null | string
}

/**
 * Resolve the brand anchor-library key for a saved-brand session with an
 * effective style, or undefined when the session has no durable set to key
 * (non-brand, no org, no style, or an empty staged bank) -- store/reuse then
 * no-op. styleHash is the sha256 of the SAME normalized effective style text
 * the planner hashes (computeStyleHash), so standard, fast and planner videos
 * land on one stored set per (brand, style).
 */
export function resolveBrandAnchorLibraryKey(args: {
  projectOrgId: string
  /** `Project.styleName` -- the last-resort style label (see styleName note). */
  projectStyleName: null | string | undefined
  sessionState: Pick<PersistedSessionState, 'bootstrap'>
  spec: Spec
}): BrandAnchorLibraryKey | undefined {
  const { sessionState, spec } = args
  const brandBankSource = spec.global_constraints.brand_bank_source
  // Mirror the planner's getEffectiveStyleText EXACTLY: the spec style wins,
  // else fall back to the bootstrap seed style (preset / legacy sessions).
  // The planner hashes this same effective text, so both sides MUST derive it
  // identically or they key the library differently and reuse silently breaks.
  const effectiveStyleText =
    normalizeStyleInstruction(spec.global_constraints.style) ||
    normalizeStyleInstruction(sessionState.bootstrap?.seed_style_instruction ?? null)
  // Falls back to the Project row last: a brand style applied through the
  // picker leaves BOTH the spec style and the bootstrap seed nameless, and
  // only `project.styleName` carries the label (observed: spec and seed style
  // names empty while project.styleName was set). The
  // project row is also what the completed event reports, so the manifest and
  // the telemetry name the style identically. Metadata only: never part of
  // the storage key.
  const effectiveStyleName =
    spec.global_constraints.style?.style_name?.trim() ||
    sessionState.bootstrap?.seed_style_instruction?.style_name?.trim() ||
    args.projectStyleName?.trim() ||
    ''
  const brandStagedAssetIds = brandStagedAssetsToUploads(
    spec.global_constraints.brand_bank ?? null,
  ).map((upload) => upload.asset_id)
  if (
    brandBankSource?.kind !== 'brand_library' ||
    !brandBankSource.brief_id ||
    !args.projectOrgId ||
    !effectiveStyleText.trim() ||
    brandStagedAssetIds.length === 0
  ) {
    return undefined
  }
  return {
    brandStagedAssetIds,
    briefId: brandBankSource.brief_id,
    styleHash: computeStyleHashFromText(effectiveStyleText),
    styleName: effectiveStyleName || null,
  }
}

/**
 * Store the session's FINAL anchor set to the durable brand library, once, at
 * confirm time. Replaces the planner's FULL-scope store, which fired
 * on the first generation only -- every ANCHOR_IDS edit after it (regenerate /
 * re-source / delete) never reached the library, so later videos for the same
 * (brand, style) reused the pre-edit set forever. The session is locked right
 * after confirm, so `anchor_assets_summary` is final by construction.
 *
 * Best-effort by contract: runs after the confirm point of no return, and both
 * this wrapper and the store itself log + swallow every failure -- a library
 * write must never fail a confirm nor eat the once-only uipVideoStarted emit.
 * The store itself (persistAnchorsToBrandLibrary) is currently a no-op.
 */
export async function storeFinalSessionAnchorsToBrandLibrary(args: {
  /**
   * The persisted anchor plan's candidate anchor_ids -- the user's explicit
   * intent of what should exist. Arms the store's session-final prune,
   * so entries this session published earlier and the user
   * then removed are dropped from the manifest. Omit when no plan exists;
   * the merge then stays strictly non-shrinking.
   */
  plannedAnchorIds?: ReadonlySet<string>
  projectId: string
  projectOrgId: string
  projectStyleName: null | string | undefined
  sessionState: Pick<PersistedSessionState, 'anchor_assets_summary' | 'bootstrap'>
  spec: Spec
}): Promise<void> {
  try {
    const summary = args.sessionState.anchor_assets_summary
    if (!summary) {
      return
    }
    const key = resolveBrandAnchorLibraryKey(args)
    if (!key) {
      return
    }
    await persistAnchorsToBrandLibrary({
      brandStagedAssetIds: new Set(key.brandStagedAssetIds),
      // This is the one store of a session's FINAL set, so it alone may carry
      // the prune opt-in; the store still skips pruning on a non-success
      // summary or without the plan ids (resolveSessionFinalPrune).
      ownerScope: 'session_final',
      plannedAnchorIds: args.plannedAnchorIds,
      projectId: args.projectId,
      styleName: key.styleName,
      summary,
      target: anchorLibraryTargetFromKey({
        briefId: key.briefId,
        orgId: args.projectOrgId,
        styleHash: key.styleHash,
      }),
    })
  } catch (err) {
    logger.warn(
      `[${args.projectId}] confirm-time anchor-library store failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
  }
}
