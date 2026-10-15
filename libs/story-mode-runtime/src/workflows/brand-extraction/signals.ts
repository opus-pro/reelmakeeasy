// Brand-extraction child -> parent signal channels + payload shapes.
//
// Relocated VERBATIM out of workflows/uip/types.ts as part of the UIP v1
// directory deletion: the BrandExtractionWorkflow child owns these
// outbound signals, so they live with the child now that the v1 types module
// is gone. Wire-name strings unchanged -> the UIP parent's matching handlers
// still receive them (the engine routes signals by name, not type identity).
//
// Workflow module, kept light: only `@reelmakeeasy/workflow-engine/workflow` is
// value-imported (defineSignal); the tail types come from the shared kernel
// via `import type` only (erased at build).

import type {
  AssetDescriptionItem,
  BrandBank,
  StagedAssetRef,
} from '@reelmakeeasy/uip-planner-runtime'
import { defineSignal } from '@reelmakeeasy/workflow-engine/workflow'

export interface BrandExtractionFailedSignalPayload {
  message: string
  reason: BrandExtractionFailureReason
  runId: string
}

export type BrandExtractionFailureReason =
  | 'crawl_blocked'
  | 'crawl_timeout'
  | 'internal_error'
  | 'invalid_url'
  | 'synthesis_failed'

export interface BrandExtractionReadySignalPayload {
  // Rich per-asset descriptions for the LLM-re-bucketed refs. Keyed by
  // `synthesizeBrandAssetId(staging_uri, finalBucket)` so the anchor manager
  // and asset-assignment tool find descriptions for `brand_<bucket>_<hash>`
  // IDs the same way they do for user uploads. Empty for pre-patch workflows
  // and for sessions whose crawl produced no stageable assets.
  assetDescriptions?: AssetDescriptionItem[]
  // BrandBank with `staged_assets` removed -- matches the shape of the
  // `seed_brand_synthesis` patch op that the parent will apply.
  // Asset binaries staged to storage are listed in `stagedAssetCandidates`
  // for the asset-upload UI to consume separately.
  bankWithoutAssets: Omit<BrandBank, 'staged_assets'>
  runId: string
  stagedAssetCandidates: {
    character: StagedAssetRef[]
    logo: StagedAssetRef[]
    product: StagedAssetRef[]
  }
}

export const brandExtractionReadySignal = defineSignal<[BrandExtractionReadySignalPayload]>(
  'uip-brand-extraction-ready',
)
export const brandExtractionFailedSignal = defineSignal<[BrandExtractionFailedSignalPayload]>(
  'uip-brand-extraction-failed',
)
