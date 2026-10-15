// Patch-operation domain types for the UIP planner runtime. Extracted from
// types.ts to keep that barrel under the 800-line cap. Re-exported
// from types.ts via `export * from './patch-op-types'`, so the package barrel
// and existing `../types` consumers keep resolving them from here.

import type { BrandBank, PreSelectedAsset, Shot, StagedAssetRef } from './types'

// Patch Ops

export interface AddPreselectedAssetOp {
  asset: PreSelectedAsset
  op: 'add_preselected_asset'
  shot_id: string
}

export interface DeleteShotsOp {
  op: 'delete_shots'
  shot_ids: string[]
}

export interface Patch {
  allowed_user_upload_asset_ids?: string[]
  base_version: number
  diff_summary: string
  ops: PatchOp[]
}

export type PatchOp =
  | AddBrandAssetOp
  | AddPreselectedAssetOp
  | ApplyBrandCarryOp
  | ChangeBrandExtractionSourceOp
  | DeleteShotsOp
  | FailBrandExtractionOp
  | LockBrandBankOp
  | MarkBrandReextractionStartedOp
  | RemovePreselectedAssetOp
  | ReorderShotsOp
  | ReplaceAllShotsOp
  | ReplaceShotsRangeOp
  | RetimeShotOp
  | RetryBrandExtractionOp
  | SeedBrandSynthesisOp
  | SeedManualBrandEntryOp
  | SetBrandExtractionInputOp
  | StartBrandExtractionOp
  | UpdateBrandBankFieldOp
  | UpdateGlobalFieldOp
  | UpdateShotFieldOp
  // Saved-brief chat ops + brand-review discard; shapes +
  // handlers in patch-apply-brand-brief-ops.ts.
  | { kind: BrandAssetKind; op: 'remove_brand_asset'; staging_uri: string }
  | { op: 'discard_brand_in_review' }
  | { op: 'reextract_saved_brand_brief' }
  | { op: 'remove_saved_brand_brief' }

export interface RemovePreselectedAssetOp {
  asset_id: string
  asset_source: 'anchor_asset' | 'user_upload'
  op: 'remove_preselected_asset'
  shot_id: string
}

export interface ReorderShotsOp {
  op: 'reorder_shots'
  order: string[]
}

export interface ReplaceAllShotsOp {
  op: 'replace_all_shots'
  shots: Shot[]
}

export interface ReplaceShotsRangeOp {
  from_shot_id: string
  op: 'replace_shots_range'
  shots: Shot[]
  to_shot_id: string
}

export interface RetimeShotOp {
  end_s: number
  op: 'retime_shot'
  shot_id: string
  start_s: number
}

export interface UpdateBrandBankFieldOp {
  op: 'update_brand_bank_field'
  path: 'basic_info.about_us_summary' | 'basic_info.business_name' | 'ctas'
  value: unknown
}

export interface UpdateGlobalFieldOp {
  op: 'update_global_field'
  path: string
  value: unknown
}

export interface UpdateShotFieldOp {
  field: string
  op: 'update_shot_field'
  shot_id: string
  value: unknown
}

// Brand-extraction named ops. Asset-mutating ops enforce BRAND_LOCKED in patch-apply.

export interface AddBrandAssetOp {
  kind: BrandAssetKind
  op: 'add_brand_asset'
  ref: StagedAssetRef
}

export type BrandAssetKind = 'character' | 'logo' | 'product'

export interface FailBrandExtractionOp {
  op: 'fail_brand_extraction'
  reason: string
}

export interface LockBrandBankOp {
  locked_at: string
  op: 'lock_brand_bank'
}

export interface SeedBrandSynthesisOp {
  // BrandBank shape minus `staged_assets`. Asset list is preserved across
  // this op so freeform-intake bundled uploads survive the synthesis write.
  bank_without_assets: Omit<BrandBank, 'staged_assets'>
  op: 'seed_brand_synthesis'
}

// Promote a FAILED extraction into an empty, user-editable bank so the
// brand_review card renders for manual entry instead of skipping the brand
// stage. Reuses status 'completed' so the existing review / edit / lock
// guards apply unchanged. Any staged_assets already on the bank are kept.
export interface SeedManualBrandEntryOp {
  op: 'seed_manual_brand_entry'
}

// Auto-start op for brand-intent. Applied by the deterministic brand-URL trigger
// (the planner may also emit it). patch-apply normalizes + validates the URL and
// enforces BRAND_INPUT_FROZEN; the workflow head-start hook then launches the child.
export interface SetBrandExtractionInputOp {
  input: { kind: 'freeform'; text: string } | { kind: 'url'; url: string }
  op: 'set_brand_extraction_input'
}

// Apply the staged brand carry (mode_confirmation only). Seeds the
// carried bank + input + shape and sets brand_extraction_status='completed' so
// extraction is skipped and canonicalize lands brand_review. Patch-apply
// enforces spec-level invariants; phase preconditions are contract-layer.
export interface ApplyBrandCarryOp {
  op: 'apply_brand_carry'
  // Attribution for brand_carry_state.applied_via. Omitted by the planner
  // (defaults to 'op'); the v2 runtime carry-by-default fallback sets
  // 'fallback' so the fold matches v1's handleModeConfirmedAction attribution.
  // Deliberately NOT in the planner-facing zod op schema.
  via?: 'fallback'
}

export interface StartBrandExtractionOp {
  op: 'start_brand_extraction'
  run_id: string
  started_at: string
}

// Re-extraction ops. See GlobalConstraints re-extraction fields.

// Auto-retry a transiently-failed extraction. Keeps status 'pending' (the
// failed signal is intercepted before fail_brand_extraction would flip it),
// bumps the retry counter, clears the stale failure reason, and raises the
// re-extraction trigger flag so the workflow fires a fresh child.
export interface RetryBrandExtractionOp {
  op: 'retry_brand_extraction'
}

// User-driven "re-extract from a different URL" (allowed once). Unfreezes the
// pinned input to the new URL, resets the bank for a full re-synthesis, flips
// status back to 'pending', bumps the source-change counter, and raises the
// re-extraction trigger flag.
export interface ChangeBrandExtractionSourceOp {
  op: 'change_brand_extraction_source'
  url: string
}

// Stamp the new run on a pending re-extraction and lower the trigger flag.
// Applied by the workflow immediately before it starts the fresh child, the
// re-extraction counterpart of start_brand_extraction's run stamping.
export interface MarkBrandReextractionStartedOp {
  op: 'mark_brand_reextraction_started'
  run_id: string
  started_at: string
}
