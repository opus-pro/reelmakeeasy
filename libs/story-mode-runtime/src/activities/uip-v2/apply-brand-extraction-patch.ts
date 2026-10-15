// applyBrandExtractionPatchActivity (local activity). Called by the UIP workflow
// at three points: before startChild fires (`start_brand_extraction`), on the
// child's `ready` signal (`seed_brand_synthesis` + `add_brand_asset` per candidate),
// and on the child's `failed` signal (`fail_brand_extraction`; canonicalize then
// reroutes bootstrap_brand -> bootstrap_script).
//
// On `ready` AND `failed` it also folds the user's init-prompt uploads
// (`cached_artifacts.uploaded_assets`) into staged_assets as user_upload assets,
// so the brand card shows website extractions AND the user's own uploads, each
// once. The combined set (extracted candidates + folded uploads) is deduped by
// image content hash (primary) / staging_uri / description before emitting ops,
// and the applyAddBrandAsset guard backstops any remaining double-insert.
//
// Patches flow through `applyPatch` so status preconditions + spec_version bumps
// are enforced. On `kind === 'ready'` also writes asset descriptions to storage
// best-effort; the in-memory copy survives a transient storage failure.

import { createHash } from 'node:crypto'

import { createStorage } from '@reelmakeeasy/common/agent-v2/storage/storage'
import { completion } from '@reelmakeeasy/common/llm'
import { createSubLogger } from '@reelmakeeasy/common/logger'
import type {
  AssetDescriptionItem,
  BrandBank,
  PatchOp,
  SessionState,
  StagedAssetRef,
} from '@reelmakeeasy/uip-planner-runtime'
import {
  applyPatch,
  flattenStagedAssets,
  reenterBootstrapBrand,
  runDescribeUploadedImagesTool,
  stagedAssetsAreSameImage,
} from '@reelmakeeasy/uip-planner-runtime'
import { persistAssetDescriptions } from '@reelmakeeasy/uip-planner-runtime/persistence'
import { z } from 'zod'
import { isStoreUri, storeUri } from '@reelmakeeasy/common/storage/stored-files'

const logger = createSubLogger('uip-apply-brand-extraction-patch')

export interface ApplyBrandExtractionPatchInput {
  kind: 'failed' | 'fold_uploads' | 'ready' | 'reextraction_started' | 'retry' | 'started'
  payload: {
    assetDescriptions?: AssetDescriptionItem[]
    bankWithoutAssets?: Omit<BrandBank, 'staged_assets'>
    failureReason?: string
    runId?: string
    stagedAssetCandidates?: {
      character: StagedAssetRef[]
      logo: StagedAssetRef[]
      product: StagedAssetRef[]
    }
    startedAt?: string
  }
  sessionState: SessionState
}

type BrandAssetBucket = 'character' | 'logo' | 'product'

interface BrandAssetCandidate {
  kind: BrandAssetBucket
  ref: StagedAssetRef
}

export async function applyBrandExtractionPatchActivity(
  input: ApplyBrandExtractionPatchInput,
): Promise<SessionState> {
  const { sessionState, kind, payload } = input
  const ops = await buildBrandExtractionOps(kind, payload, sessionState)
  if (ops.length === 0) {
    logger.warn(
      `[${sessionState.sessionId}] applyBrandExtractionPatchActivity called with kind=${kind} but produced no ops; skipping`,
    )
    return sessionState
  }

  const patch = {
    base_version: sessionState.spec.meta.spec_version,
    diff_summary: `brand_extraction.${kind}`,
    ops,
  }
  const result = applyPatch(sessionState.spec, patch, {
    transitionVideoModel: sessionState.transitionVideoModel,
  })
  if (result.error) {
    logger.warn(
      `[${sessionState.sessionId}] applyBrandExtractionPatchActivity rejected: ${result.error} (kind=${kind})`,
    )
    return sessionState
  }
  sessionState.spec = result.spec

  if (kind === 'reextraction_started') {
    // The re-extraction child is about to run. Drop the session back into the
    // bootstrap_brand phase so the FE shows the same "Drafting the
    // brand brief" state as the initial extraction instead of an empty review
    // card, and tear down the now-stale brand-review gate. For an auto-retry
    // the phase is already bootstrap_brand, so this is a no-op transition.
    reenterBootstrapBrand(sessionState, 'phase_canonicalization.brand_reextraction')
  }

  if (kind === 'ready' && payload.assetDescriptions?.length) {
    const existingItems = sessionState._loaded_asset_descriptions?.items ?? []
    const mergedById = new Map(existingItems.map((item) => [item.asset_id, item]))
    for (const item of payload.assetDescriptions) {
      mergedById.set(item.asset_id, item)
    }
    sessionState._loaded_asset_descriptions = {
      generated_at: new Date().toISOString(),
      items: [...mergedById.values()],
    }
    // Mirror to disk so a cold reload via loadAssetDescriptions sees brand
    // items even before the next planner-loop describe pass runs. Best-
    // effort: a storage write failure must not abort the ready-signal handler;
    // the in-memory _loaded_asset_descriptions is the primary read path.
    try {
      await persistAssetDescriptions(
        sessionState.sessionId,
        sessionState._loaded_asset_descriptions,
      )
    } catch (persistErr) {
      const msg = persistErr instanceof Error ? persistErr.message : String(persistErr)
      logger.warn(`[${sessionState.sessionId}] persistAssetDescriptions failed (non-fatal): ${msg}`)
    }
  }

  logger.info(
    `[${sessionState.sessionId}] Applied brand extraction patch (kind=${kind}, ops=${ops.length}, status=${sessionState.spec.global_constraints.brand_extraction_status})`,
  )
  return sessionState
}

// Exported for reuse by the UIP V2 brand activity (which needs the named ops to
// append as a spec_patched event); the V1 call site above is unchanged.
export async function buildBrandExtractionOps(
  kind: 'failed' | 'fold_uploads' | 'ready' | 'reextraction_started' | 'retry' | 'started',
  payload: ApplyBrandExtractionPatchInput['payload'],
  sessionState: SessionState,
): Promise<PatchOp[]> {
  switch (kind) {
    case 'failed': {
      const reason = payload.failureReason?.trim() || 'unknown'
      // The failed-extraction error card still renders an Assets section, so
      // surface the user's init-prompt uploads there even when the crawl
      // produced nothing.
      const uploads = await foldInitUploadCandidates(sessionState)
      const exact = dedupeCandidates([], uploads, sessionState)
      const survivors = await llmDedupeCandidates(exact, sessionState)
      return [{ op: 'fail_brand_extraction', reason }, ...survivors.map(toAddBrandAssetOp)]
    }
    case 'fold_uploads': {
      // Saved-brief reuse: the bank arrives pre-populated from the
      // library and no extraction child runs, so the user's init-prompt uploads
      // never reach staged_assets the way the fresh 'ready'/'failed' paths fold
      // them. Fold them in as user_upload assets so they show on the brand card
      // and feed the video. There are no crawl candidates to dedupe against, so
      // the byte-exact + semantic passes are skipped; the applyAddBrandAsset
      // guard backstops any upload that already matches a seeded bank asset.
      if (!sessionState.cached_artifacts?.uploaded_assets?.length) {
        return []
      }
      // Classify first (logo / character / product). The fresh path describes
      // uploads via the planner's describe_uploaded_images tool in
      // mode_confirmation; this path skips that, so without describing here every
      // upload hits foldInitUploadCandidates' 'product' default regardless of
      // what it is. Best-effort -- on failure the product default stands.
      await describeUploadsForFold(sessionState)
      const uploads = await foldInitUploadCandidates(sessionState)
      return uploads.map(toAddBrandAssetOp)
    }
    case 'ready': {
      if (!payload.bankWithoutAssets) {
        return []
      }
      const ops: PatchOp[] = [
        {
          op: 'seed_brand_synthesis',
          bank_without_assets: payload.bankWithoutAssets,
        },
      ]
      const extracted = flattenCandidates(payload.stagedAssetCandidates)
      const uploads = await foldInitUploadCandidates(sessionState)
      // Byte-exact pass: user uploads always survive; a crawl extraction that
      // duplicates an upload is dropped, and the upload adopts its richer
      // classification.
      const exact = dedupeCandidates(extracted, uploads, sessionState)
      // Then a semantic LLM pass collapses visually-equivalent assets that are
      // not byte-identical (e.g. the same logo at two sizes, two Spotify
      // badges) which the exact pass cannot catch. Best-effort.
      const survivors = await llmDedupeCandidates(exact, sessionState)
      for (const cand of survivors) {
        ops.push(toAddBrandAssetOp(cand))
      }
      return ops
    }
    case 'reextraction_started': {
      if (!payload.runId || !payload.startedAt) {
        return []
      }
      return [
        {
          op: 'mark_brand_reextraction_started',
          run_id: payload.runId,
          started_at: payload.startedAt,
        },
      ]
    }
    case 'retry': {
      // Auto-retry a transient failure. No assets fold here -- the
      // bank is not shown during a retry; the re-fired run reseeds it.
      return [{ op: 'retry_brand_extraction' }]
    }
    case 'started': {
      if (!payload.runId || !payload.startedAt) {
        return []
      }
      return [
        {
          op: 'start_brand_extraction',
          run_id: payload.runId,
          started_at: payload.startedAt,
        },
      ]
    }
  }
}

function flattenCandidates(
  candidates: ApplyBrandExtractionPatchInput['payload']['stagedAssetCandidates'],
): BrandAssetCandidate[] {
  if (!candidates) {
    return []
  }
  return [
    ...candidates.logo.map((ref): BrandAssetCandidate => ({ kind: 'logo', ref })),
    ...candidates.product.map((ref): BrandAssetCandidate => ({ kind: 'product', ref })),
    ...candidates.character.map((ref): BrandAssetCandidate => ({ kind: 'character', ref })),
  ]
}

function toAddBrandAssetOp(cand: BrandAssetCandidate): PatchOp {
  return { op: 'add_brand_asset', kind: cand.kind, ref: cand.ref }
}

/**
 * Build user_upload staged-asset candidates from the init-prompt upload pool,
 * computing each ref's content_hash from the downloaded bytes (best-effort).
 * The staging_uri is built the same way the brand-brief-submit fold builds it
 * so an upload that already landed in staged_assets dedups by staging_uri even
 * when hashing is unavailable.
 */
// Best-effort describe pass so a saved-brief fold buckets uploads by their real
// brand role (logo / character / product) instead of defaulting all of them to
// 'product'. Reuses the same V1 tool the fresh path runs from the planner; its
// runtime arg is unused, and it no-ops when every upload is already described.
async function describeUploadsForFold(sessionState: SessionState): Promise<void> {
  try {
    await runDescribeUploadedImagesTool({}, sessionState)
  } catch (err) {
    logger.warn(
      `[${sessionState.sessionId}] fold_uploads: describe pass failed; uploads default to product: ${errMsg(err)}`,
    )
  }
}

async function foldInitUploadCandidates(
  sessionState: SessionState,
): Promise<BrandAssetCandidate[]> {
  const uploads = sessionState.cached_artifacts?.uploaded_assets ?? []
  if (uploads.length === 0) {
    return []
  }
  let storage: Awaited<ReturnType<typeof createStorage>> | null = null
  try {
    storage = await createStorage(sessionState.sessionId)
  } catch (err) {
    logger.warn(
      `[${sessionState.sessionId}] foldInitUploadCandidates: createStorage failed; folding without content hashes: ${errMsg(err)}`,
    )
  }
  // Index the planner-loop describe output by asset_id so each upload can use
  // its LLM description (richer than the file name, for the semantic pass) and
  // its brand_asset_kind classification (logo / product / character) instead of
  // being force-bucketed as a logo.
  const descById = new Map(
    (sessionState._loaded_asset_descriptions?.items ?? []).map((item) => [item.asset_id, item]),
  )
  // Identity keys of a brand-remix carry's images. An init-prompt
  // upload matching one is the remix FE's re-attachment of the CARRIED brand's
  // image -- not a deliberate upload for the brand being extracted now -- so
  // folding it after a brand switch would re-introduce the old brand's logo
  // into the new bank. Skip those; genuinely new uploads never match.
  const carryKeys = new Set(
    sessionState.spec?.global_constraints?.brand_carry_state?.carried_asset_keys ?? [],
  )
  const candidates: BrandAssetCandidate[] = []
  for (const upload of uploads) {
    // `upload.file_path` is relative to `projects/<sessionId>/user-intent-planner/`,
    // so read (and key) by the full staging URI -- a bare readFile(file_path)
    // resolves to `projects/<sessionId>/<file_path>` and misses the file.
    const stagingUri = toUploadStagingUri(sessionState.sessionId, upload.file_path)
    let contentHash: null | string = null
    if (storage) {
      try {
        const bytes = await storage.readFile(stagingUri)
        contentHash = createHash('md5').update(bytes).digest('hex').slice(0, 12)
        // Backfill onto the pool entry so the downstream anchor/upload-pool
        // dedup can collapse this upload against its brand-staged synthetic.
        upload.content_hash = contentHash
      } catch (err) {
        logger.warn(
          `[${sessionState.sessionId}] foldInitUploadCandidates: hash failed for ${stagingUri}; falling back to uri/description dedup: ${errMsg(err)}`,
        )
      }
    }
    // The hash is authoritative when computable: a non-matching hash proves
    // the bytes differ from every carried image, so a same-basename upload is
    // a genuinely NEW file (generic names like logo.png recur across brands)
    // and must fold. The basename key only decides when hashing was
    // unavailable.
    if (
      carryKeys.size > 0 &&
      (contentHash === null
        ? carryKeys.has(`name:${(upload.file_name ?? '').toLowerCase()}`)
        : carryKeys.has(`hash:${contentHash}`))
    ) {
      continue
    }
    const desc = descById.get(upload.asset_id)
    // Generic uploads (brand_asset_kind null / undescribed) default to product,
    // never logo -- a code-editor screenshot must not land in the logo bucket.
    const kind: BrandAssetBucket = desc?.brand_asset_kind ?? 'product'
    candidates.push({
      kind,
      ref: {
        asset_kind: kind,
        category: null,
        content_hash: contentHash,
        description: desc?.summary?.trim() || desc?.description?.trim() || upload.file_name,
        height: null,
        in_home_link: false,
        location: null,
        provenance: 'user_upload',
        size_bytes: null,
        source_url: null,
        staging_uri: stagingUri,
        width: null,
      },
    })
  }
  return candidates
}

// Adapted from the story-loader asset dedup (ASSET_DEDUP_PROMPT): an LLM
// judges duplicates from descriptions, catching visually-equivalent assets
// that the byte-exact content_hash / staging_uri pass cannot.
const BRAND_ASSET_DEDUP_PROMPT = `You are an expert brand-asset deduplicator. Your job is to deduplicate the assets based on their descriptions.
The assets are (id, description):
{{LIST}}
The deduplication should be based on the description, not the id.

<duplicate detection guidelines>
- Compare visual elements strictly.
- Keep a single best instance of each distinct asset; when duplicates exist, keep the one with the richer, more specific description and mark the others as duplicates.
- Two assets are duplicates only if they depict the same logo / image / screenshot, even if re-encoded or differently sized. Distinct products, episodes, or people are NOT duplicates.
- Note which was kept and why in the reasoning field.
</duplicate detection guidelines>

Return ALL assets. If an asset is a duplicate of one you keep, set isDuplicate to true and give the reason; otherwise set isDuplicate to false.`

const DEDUP_RESPONSE_FORMAT = z.object({
  assets: z.array(
    z.object({
      id: z.string(),
      isDuplicate: z.boolean(),
      reasoning: z.string(),
    }),
  ),
})

/**
 * Semantic dedup of the candidate set via an LLM that reasons over each
 * asset's description. Runs after the byte-exact pass, on the survivors only.
 * Best-effort: any error (or a response that would drop everything) returns
 * the input unchanged, so the content_hash result always stands.
 */
async function llmDedupeCandidates(
  candidates: BrandAssetCandidate[],
  sessionState: SessionState,
): Promise<BrandAssetCandidate[]> {
  if (candidates.length < 2) {
    return candidates
  }
  // Only crawl extractions are ever dropped here (user uploads always survive),
  // so when nothing is droppable -- e.g. the failed path, where every folded
  // candidate is a user upload -- skip the model call entirely.
  if (!candidates.some((cand) => cand.ref.provenance === 'crawl')) {
    return candidates
  }
  const labeled = candidates.map((cand, index) => ({
    cand,
    description: cand.ref.description?.trim() || cand.ref.category || cand.kind,
    id: `a${index}`,
  }))
  const list = labeled.map((item) => `- ${item.id}, ${item.description}`).join('\n')
  try {
    const response = await completion({
      models: 'pro',
      prompt: BRAND_ASSET_DEDUP_PROMPT.replace('{{LIST}}', list),
      responseFormat: DEDUP_RESPONSE_FORMAT,
      task: 'uip-brand-asset-dedup',
    })
    const duplicateIds = new Set(
      response.assets.filter((asset) => asset.isDuplicate).map((asset) => asset.id),
    )
    void persistDedupAudit(sessionState.sessionId, response.assets)
    if (duplicateIds.size === 0) {
      return candidates
    }
    // Only ever drop crawl extractions. A user upload is never removed, even if
    // the model flags it -- the user explicitly provided it.
    const survivors = labeled
      .filter((item) => !(duplicateIds.has(item.id) && item.cand.ref.provenance === 'crawl'))
      .map((item) => item.cand)
    // Never let the model collapse the whole set to nothing.
    return survivors.length > 0 ? survivors : candidates
  } catch (err) {
    logger.warn(
      `[${sessionState.sessionId}] llmDedupeCandidates failed; keeping content-hash dedup result: ${errMsg(err)}`,
    )
    return candidates
  }
}

async function persistDedupAudit(sessionId: string, assets: unknown): Promise<void> {
  try {
    const storage = await createStorage(sessionId)
    await storage.writeFile(
      'user-intent-planner/duplicate_brand_assets.json',
      JSON.stringify(assets, null, 2),
    )
  } catch (err) {
    logger.warn(`[${sessionId}] persistDedupAudit failed (non-fatal): ${errMsg(err)}`)
  }
}

/**
 * Byte-exact dedup of the combined candidate set against each other AND against
 * assets already in the bank (brand-brief uploads land there at submit time).
 *
 * User uploads are NEVER dropped -- the user explicitly provided them, so they
 * always appear in the brand card. Only crawl extractions are removed. When a
 * crawl extraction is the same image as a surviving upload, the crawl entry is
 * dropped and its richer image-based classification (bucket + category +
 * description) is inherited onto the upload, so e.g. a user-uploaded logo that
 * also appears on the site stays in the logo bucket.
 */
function dedupeCandidates(
  extracted: BrandAssetCandidate[],
  uploads: BrandAssetCandidate[],
  sessionState: SessionState,
): BrandAssetCandidate[] {
  const hashByUri = new Map<string, string>()
  for (const cand of uploads) {
    if (cand.ref.content_hash) {
      hashByUri.set(cand.ref.staging_uri, cand.ref.content_hash)
    }
  }
  const existing: StagedAssetRef[] = flattenStagedAssets(
    sessionState.spec.global_constraints.brand_bank,
  ).map((ref) =>
    ref.content_hash || !hashByUri.has(ref.staging_uri)
      ? ref
      : { ...ref, content_hash: hashByUri.get(ref.staging_uri) ?? null },
  )

  // Uploads first: always kept. A crawl extraction is dropped when it is the
  // same image as a survivor (an upload, or an earlier-kept crawl) or a bank
  // asset. When it matches a surviving upload, the upload adopts the crawl's
  // richer classification.
  const survivors: BrandAssetCandidate[] = [...uploads]

  for (const cand of extracted) {
    const match = survivors.find((s) => stagedAssetsAreSameImage(s.ref, cand.ref))
    if (match) {
      if (match.ref.provenance === 'user_upload') {
        inheritExtractedClassification(match, cand)
      }
      continue
    }
    if (existing.some((ref) => stagedAssetsAreSameImage(ref, cand.ref))) {
      continue
    }
    survivors.push(cand)
  }
  return survivors
}

// Move a kept upload into the crawl extraction's bucket and adopt its richer
// category / description. Provenance stays user_upload so downstream still
// treats it as the user's asset.
function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

function inheritExtractedClassification(
  upload: BrandAssetCandidate,
  extracted: BrandAssetCandidate,
): void {
  upload.kind = extracted.kind
  upload.ref = {
    ...upload.ref,
    asset_kind: extracted.kind,
    category: extracted.ref.category,
    description: extracted.ref.description ?? upload.ref.description,
  }
}

function toUploadStagingUri(sessionId: string, fileUri: string): string {
  return isStoreUri(fileUri)
    ? fileUri
    : storeUri(`projects/${sessionId}/user-intent-planner/${fileUri}`)
}
