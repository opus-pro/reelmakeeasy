import { createHash } from 'node:crypto'

import { createSubLogger } from '@reelmakeeasy/common/logger'
import {
  copyStoredFile,
  isStoreUri,
  keyIsUnder,
  projectRootKey,
  storeKeyOf,
  storeUri,
} from '@reelmakeeasy/common/storage/stored-files'
import type { BrandBank } from '@reelmakeeasy/uip-planner-runtime'

const logger = createSubLogger('uip-brand-remix-assets')

/**
 * Cap on staged-asset images cloned per carry. Deterministic priority order:
 * logo -> product -> character. Banks rarely approach this; the cap bounds
 * remix-create latency on pathological sources. Truncation is logged and
 * surfaced on the result for tracking.
 */
export const MAX_CARRIED_BRAND_ASSETS = 30

export interface CloneBrandStagedAssetsResult {
  /** Rewritten bank, or null when assets existed but none could be cloned (downgrade to no-carry). */
  bank: BrandBank | null
  clonedCount: number
  droppedCount: number
  truncated: boolean
}
type StagedAssetBucket = 'character' | 'logo' | 'product'

type StagedRef = BrandBank['staged_assets']['logo'][number]

/**
 * Clone a source project's brand staged-asset images into the TARGET project's
 * workspace and rewrite each ref's `staging_uri` (v2 "Phase-2 asset
 * clone"). Server-side storage copies, parallel, best-effort:
 *
 * - a per-file failure drops that ref only;
 * - if assets existed but ALL copies failed, returns bank: null so the caller
 *   downgrades to no-carry (the carry must never block session creation);
 * - a zero-asset bank passes through unchanged (text-only carry is valid --
 *   brand_review supports banks without staged assets, e.g. manual entry).
 *
 * `content_hash` is preserved (it hashes image bytes, which do not change), so
 * downstream dedup against real user uploads keeps working. Downstream
 * asset_ids are derived from staging_uri (synthesizeBrandAssetId), so the
 * rewritten URIs yield fresh ids -- safe in a brand-new session with no
 * pre-existing refs.
 */
export async function cloneBrandStagedAssets(
  sourceBank: BrandBank,
  targetProjectId: string,
  sourceProjectId: string,
): Promise<CloneBrandStagedAssetsResult> {
  const buckets: StagedAssetBucket[] = ['logo', 'product', 'character']
  const flat: Array<{ bucket: StagedAssetBucket; ref: StagedRef }> = []
  for (const bucket of buckets) {
    for (const ref of sourceBank.staged_assets[bucket]) {
      flat.push({ bucket, ref })
    }
  }

  const capped = flat.slice(0, MAX_CARRIED_BRAND_ASSETS)
  const truncated = flat.length > capped.length
  if (truncated) {
    logger.warn(
      `[${targetProjectId}] brand carry: capping staged assets ${flat.length} -> ${capped.length}`,
    )
  }
  if (capped.length === 0) {
    return { bank: sourceBank, clonedCount: 0, droppedCount: 0, truncated }
  }

  const results = await Promise.all(
    capped.map(async ({ bucket, ref }) => {
      try {
        const sourceUri = resolveSourceUri(ref.staging_uri, sourceProjectId)
        const destUri = buildCarryDestUri(targetProjectId, bucket, sourceUri)
        await copyStoredFile(sourceUri, destUri)
        return { bucket, ref: { ...ref, staging_uri: destUri } }
      } catch (err) {
        logger.warn(`[${targetProjectId}] brand carry: failed to clone ${ref.staging_uri}: ${err}`)
        return null
      }
    }),
  )

  const cloned = results.filter((r): r is NonNullable<(typeof results)[number]> => r !== null)
  if (cloned.length === 0) {
    return { bank: null, clonedCount: 0, droppedCount: capped.length, truncated }
  }

  const staged_assets: BrandBank['staged_assets'] = { logo: [], product: [], character: [] }
  for (const { bucket, ref } of cloned) {
    staged_assets[bucket].push(ref)
  }
  return {
    bank: { ...sourceBank, staged_assets },
    clonedCount: cloned.length,
    droppedCount: capped.length - cloned.length,
    truncated,
  }
}

// Crawl refs hold full store:// URIs; user-upload folds may hold workspace-relative
// paths (see toUploadStagingUri in apply-brand-extraction-patch.ts). Resolve
// relative paths against the SOURCE project's planner workspace.
//
// Security: staging_uri is user-influenceable (brand-brief upload writes absolute
// store:// URIs verbatim). We validate before returning a URI that will be copied:
//
//   Relative input -- reject any ".." segment (path traversal); resolve the rest
//   against the source project's workspace.
//
//   Absolute store:// input -- reject an address the parser refuses (".." traversal,
//   hidden or empty segments, leftover escapes), and reject a key outside
//   "projects/<sourceProjectId>/" (cross-tenant read -- bounds the copy to the one
//   project the caller was authorized for).
//   Crawl staging_uris are formed as "projects/<projectId>/..." so this bound holds
//   for all real asset shapes.
//
// Throws on any violation; the per-item try/catch in cloneBrandStagedAssets drops
// the ref and increments droppedCount (best-effort contract).
export function resolveSourceUri(stagingUri: string, sourceProjectId: string): string {
  if (isStoreUri(stagingUri)) {
    const object = storeKeyOf(stagingUri)
    if (!object) {
      throw new Error(
        'brand carry: staging_uri is not a valid stored file address (".." traversal or a malformed key) -- rejected',
      )
    }
    const allowedPrefix = `${projectRootKey(sourceProjectId)}/`
    if (!keyIsUnder(object, allowedPrefix)) {
      throw new Error(
        `brand carry: staging_uri object "${object}" is outside the authorized source project prefix "${allowedPrefix}" -- cross-tenant copy rejected`,
      )
    }
    return stagingUri
  }
  // Relative path: reject ".." per segment (not as substring, to avoid false
  // positives on names like "take..final.png" that contain ".." but are not
  // traversal segments).
  if (stagingUri.split('/').includes('..')) {
    throw new Error(
      `brand carry: relative staging_uri "${stagingUri}" contains ".." traversal segment -- rejected`,
    )
  }
  return storeUri(`projects/${sourceProjectId}/user-intent-planner/${stagingUri}`)
}

// projects/{target}/user-intent-planner/brand-carry/{bucket}/{hash8}-{basename}.
// The hash of the full source URI keeps same-basename sources distinct.
function buildCarryDestUri(
  targetProjectId: string,
  bucket: StagedAssetBucket,
  sourceUri: string,
): string {
  const basename = sourceUri.split('/').findLast(Boolean) ?? 'asset'
  const hash8 = createHash('sha256').update(sourceUri).digest('hex').slice(0, 8)
  return storeUri(
    `projects/${targetProjectId}/user-intent-planner/brand-carry/${bucket}/${hash8}-${basename}`,
  )
}
