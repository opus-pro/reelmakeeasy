// V2-owned signal-payload types.
//
// Copied VERBATIM from `workflows/uip/types.ts` as part of the UIP v1 decouple
// so the V2 workflow no longer imports its signal payload shapes from
// the V1 types module (which is deleted with v1). Payloads serialize by shape,
// not type identity, so these are byte-for-byte the same wire contract the V2
// workflow uses today -- no behavior change.
//
// Scope: only the payload types not already defined elsewhere for v2.
// `PreVoiceover*` + tool-lifecycle payloads live in `./types`; the brand
// payloads that are already canonical in the shared kernel
// (Confirm/BrandBankEdit/BrandBriefSubmit) are imported from there directly by
// channels.ts/types.ts. The two BrandExtraction* payloads below are NOT in the
// kernel, so they are copied here. Tail types already live in the shared kernel
// and are imported type-only.

import type { CancellableToolName } from '@reelmakeeasy/common/workflow/uip-v2-signal-names'
import type {
  ActiveModalKind,
  AssetDescriptionItem,
  BrandBank,
  BrandBankEditSignalPayload,
  GlobalConstraints,
  StagedAssetRef,
  UploadedAsset,
} from '@reelmakeeasy/uip-planner-runtime'

// Sent by the BrandExtractionWorkflow child to the UIP parent. NOT in the shared
// kernel, so copied here verbatim (v1 decouple).
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

export interface CancelQueuedItemSignalPayload {
  queuedItemId: string
}

export interface CancelSessionSignalPayload {
  /** Idempotency key linking this signal to the nextAction record in the DB. */
  actionId?: string
  gateToken: string
}

export interface CancelToolSignalPayload {
  /** Idempotency key for tracing (cancels use a direct signal, not the inbox). */
  actionId?: string
  sentAt?: string
  /** Runtime toolName to cancel (matches activeToolCalls[].toolName). */
  toolName: CancellableToolName
}

export interface ConfirmFastSignalPayload {
  /** Idempotency key linking this signal to the nextAction record in the DB. */
  actionId?: string
}

export interface ConfirmSignalPayload {
  /** Idempotency key linking this signal to the nextAction record in the DB. */
  actionId?: string
}

export interface ContinueUipDraftSignalPayload {
  /** Idempotency key linking this signal to the nextAction record in the DB. */
  actionId?: string
  gateToken: string
}

export interface GuiUpdateSignalPayload {
  // Summary artifact field edits flushed via POST :id/summary.
  // Merged directly into spec.global_constraints by the fold (no PatchOp).
  globalConstraints?: { directives?: string[]; must_not_violate?: string[]; topic?: string }
  requestId?: string
  /** Video transcript text (cached_artifacts.working_script.script). */
  transcript?: string
}

export interface ScriptReviewUpdateSignalPayload {
  gateToken: string
  globalConstraints?: Partial<GlobalConstraints>
  /** API-generated UUID correlating this signal to a gui_edit timeline event. */
  requestId?: string
  script?: string
}

/** Mid-session auto-continue flip. */
export interface SetAutoContinueSignalPayload {
  enabled: boolean
  requestId?: string
}

/** Mid-session transition video model selection. Null/blank means default. */
export interface SetTransitionVideoModelSignalPayload {
  requestId?: string
  transitionVideoModel?: null | string
}

/**
 * Explicit user style switch, sent by
 * `POST /uip-sessions/{id}/style`. The handler writes this as a `spec_patched`
 * `update_global_field` on `style` + `style_source='auto_switched'` (see
 * signal-handlers.ts) -- never as a passive global_constraints merge -- so the
 * auto-style re-selection gate honors the switch on a later brief regen.
 */
export interface SetStyleSignalPayload {
  styleName: string
  styleText: string
  styleThumbnailUrl?: string
}

export interface UserMessageSignalPayload {
  /** Idempotency key linking this signal to the nextAction record in the DB. */
  actionId?: string
  answerToMessageId?: string
  // Pending brand-bank draft edits flushed from the GUI alongside this
  // message. Applied in-band in the planner-turn activity before
  // runPlannerLoop so the agent reads the post-flush brand_bank. Only
  // honored while the session is still in brand_review.
  brandDraftEdits?: BrandBankEditSignalPayload[]
  message: string
  messageId: string
  sentAt?: string
  uploadedAssets?: UploadedAsset[]
}

export interface UserMessagesSignalPayload {
  /** Idempotency key linking this signal to the nextAction record in the DB. */
  actionId?: string
  messages: Array<{
    answerToMessageId?: string
    brandDraftEdits?: BrandBankEditSignalPayload[]
    clientMessageId?: string
    message: string
    messageId: string
    sentAt?: string
    sentFrom?: ActiveModalKind
    uploadedAssets?: UploadedAsset[]
  }>
}
