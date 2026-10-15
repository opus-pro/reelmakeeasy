import { createHash } from 'node:crypto'

import { createSubLogger } from '@reelmakeeasy/common/logger'
import {
  copyStoredFile,
  deleteStoredFile,
  keyIsUnder,
  storeKeyOf,
  storeUri,
} from '@reelmakeeasy/common/storage/stored-files'
import { type BrandBank, StagedAssetRefSchema } from '@reelmakeeasy/uip-planner-runtime'

import { MAX_CARRIED_BRAND_ASSETS, resolveSourceUri } from '../uip/uip-brand-remix-assets'

const logger = createSubLogger('brand-brief-assets')

export interface CopyBankAssetsToLibraryResult {
  /** Rewritten bank, or null when assets existed but none could be copied. */
  bank: BrandBank | null
  clonedCount: number
  droppedCount: number
  truncated: boolean
}

type StagedAssetBucket = 'character' | 'logo' | 'product'

type StagedRef = BrandBank['staged_assets']['logo'][number]

// One asset to add to a saved brief during an edit: a source object (an upload
// staged by the FE, or a prior library object) plus its bucket and caption.
export interface BriefAssetAdd {
  asset_kind: StagedAssetBucket
  description?: null | string
  staging_uri: string
}

export interface BriefAssetRemove {
  asset_kind: StagedAssetBucket
  staging_uri: string
}

// Desired staged-asset layout for an edit: the staging_uris the brief
// should keep, per bucket, in display order. The FE sends this after drag-drop
// (re-bucketing) and select-delete so one field expresses move + reorder +
// remove together.
export type StagedAssetsLayout = Record<StagedAssetBucket, string[]>

/**
 * Apply a full staged-asset layout to a brief's bank.
 * Re-buckets existing refs by the layout (a dragged asset just changes which
 * array it lives in; the stored file stays put, only `asset_kind` flips) and
 * drops any uri the layout omits, best-effort deleting its object. Unknown uris
 * in the layout are ignored. Returns a fresh bank; never mutates the input.
 */
export async function applyStagedAssetsLayout(
  bank: BrandBank,
  layout: StagedAssetsLayout,
  args: { briefId: string },
): Promise<BrandBank> {
  const byUri = new Map<string, StagedRef>()
  for (const bucket of ['logo', 'character', 'product'] as StagedAssetBucket[]) {
    for (const ref of bank.staged_assets[bucket]) {
      byUri.set(ref.staging_uri, ref)
    }
  }

  const staged_assets: BrandBank['staged_assets'] = { character: [], logo: [], product: [] }
  const kept = new Set<string>()
  for (const bucket of ['logo', 'character', 'product'] as StagedAssetBucket[]) {
    for (const uri of layout[bucket] ?? []) {
      const ref = byUri.get(uri)
      if (!ref || kept.has(uri)) {
        continue
      }
      kept.add(uri)
      staged_assets[bucket].push(StagedAssetRefSchema.parse({ ...ref, asset_kind: bucket }))
    }
  }

  for (const uri of byUri.keys()) {
    if (!kept.has(uri)) {
      await deleteStoredFile(uri).catch((err) => {
        logger.warn(`[${args.briefId}] brand library edit: failed to delete ${uri}: ${err}`)
      })
    }
  }

  return { ...bank, staged_assets }
}

/**
 * Apply add/remove asset edits to a saved brief's durable bank (edit
 * flow). Added assets are copied from their source into the brief's library
 * prefix and appended as user_upload refs; removed assets are dropped from the
 * bank and their library object best-effort deleted. Returns a fresh bank, never
 * mutates the input. storage is best-effort: a failed copy drops only that add, a
 * failed delete leaves an orphaned object (harmless, eventually GC'd) -- neither
 * blocks the user-visible edit.
 */
export async function applyBriefAssetEdits(
  bank: BrandBank,
  args: { add?: BriefAssetAdd[]; briefId: string; orgId: string; remove?: BriefAssetRemove[] },
): Promise<BrandBank> {
  const { orgId, briefId, add = [], remove = [] } = args
  const staged_assets: BrandBank['staged_assets'] = {
    character: [...bank.staged_assets.character],
    logo: [...bank.staged_assets.logo],
    product: [...bank.staged_assets.product],
  }

  // Remove first so re-adding the same uri in one edit isn't dropped by removal.
  for (const { asset_kind, staging_uri } of remove) {
    staged_assets[asset_kind] = staged_assets[asset_kind].filter(
      (ref) => ref.staging_uri !== staging_uri,
    )
    await deleteStoredFile(staging_uri).catch((err) => {
      logger.warn(`[${briefId}] brand library edit: failed to delete ${staging_uri}: ${err}`)
    })
  }

  const basePath = buildBriefAssetBasePath(orgId, briefId)
  for (const edit of add) {
    try {
      const destUri = buildLibraryDestUri(basePath, edit.asset_kind, edit.staging_uri)
      await copyStoredFile(edit.staging_uri, destUri)
      staged_assets[edit.asset_kind].push(
        StagedAssetRefSchema.parse({
          asset_kind: edit.asset_kind,
          description: edit.description ?? null,
          height: null,
          provenance: 'user_upload',
          size_bytes: null,
          source_url: null,
          staging_uri: destUri,
          width: null,
        }),
      )
    } catch (err) {
      logger.warn(`[${briefId}] brand library edit: failed to copy ${edit.staging_uri}: ${err}`)
    }
  }

  return { ...bank, staged_assets }
}

/**
 * Durable prefix for a saved brief's assets. Lives outside any projects/<projectId>/
 * workspace so per-project cleanup never touches it; deleting a brief deletes
 * this folder. Keyed by orgId so the whole org shares one library tree.
 */
export function buildBriefAssetBasePath(orgId: string, briefId: string): string {
  return `brand-library/${orgId}/${briefId}`
}

/**
 * Copy a confirmed bank's staged-asset images out of the source project's
 * workspace into the user's durable brand-library prefix and rewrite each
 * ref's staging_uri. A saved brief must outlive the project it came from.
 *
 * Same best-effort contract as the brand-carry clone (which this borrows its
 * source validation from): a per-file failure drops that ref only; all-failed
 * downgrades to bank: null so the caller can decide whether a text-only save
 * still makes sense; a zero-asset bank passes through unchanged.
 */
export async function copyBankAssetsToLibrary(
  sourceBank: BrandBank,
  args: { briefId: string; orgId: string; sourceProjectId: string },
): Promise<CopyBankAssetsToLibraryResult> {
  const { orgId, briefId, sourceProjectId } = args
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
      `[${briefId}] brand library save: capping staged assets ${flat.length} -> ${capped.length}`,
    )
  }
  if (capped.length === 0) {
    return { bank: sourceBank, clonedCount: 0, droppedCount: 0, truncated }
  }

  const basePath = buildBriefAssetBasePath(orgId, briefId)
  const results = await Promise.all(
    capped.map(async ({ bucket, ref }) => {
      try {
        const sourceUri = resolveBankSourceUri(ref.staging_uri, sourceProjectId)
        const destUri = buildLibraryDestUri(basePath, bucket, sourceUri)
        await copyStoredFile(sourceUri, destUri)
        return { bucket, ref: { ...ref, staging_uri: destUri } }
      } catch (err) {
        logger.warn(`[${briefId}] brand library save: failed to copy ${ref.staging_uri}: ${err}`)
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

// Resolve a staged ref's source object for the library copy. Crawl / UIP refs
// live under the source project's workspace and are validated + resolved by the
// shared project-scoped guard. A standalone create-in-library run folds the
// user's raw FE reference uploads straight into the bank; those sit under the
// shared temp-upload prefix (store://tmp/<user>/...), outside any project
// workspace, so the project-prefix guard would reject every one of them and
// drop the assets. Accept a temp upload directly (a checked key under `tmp/`),
// mirroring how applyBriefAssetEdits copies FE uploads; any other shape stays
// project-scoped.
function resolveBankSourceUri(stagingUri: string, sourceProjectId: string): string {
  const key = storeKeyOf(stagingUri)
  if (key && keyIsUnder(key, 'tmp')) {
    return stagingUri
  }
  return resolveSourceUri(stagingUri, sourceProjectId)
}

// {basePath}/{bucket}/{hash8}-{basename}; the hash of the full source URI
// keeps same-basename sources distinct.
function buildLibraryDestUri(
  basePath: string,
  bucket: StagedAssetBucket,
  sourceUri: string,
): string {
  const basename = sourceUri.split('/').findLast(Boolean) ?? 'asset'
  const hash8 = createHash('sha256').update(sourceUri).digest('hex').slice(0, 8)
  return storeUri(`${basePath}/${bucket}/${hash8}-${basename}`)
}
