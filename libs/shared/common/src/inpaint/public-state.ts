import type { JudgeFailedCheck } from './activity-types'
import type { TaskRunRecordState } from './task-types'
import type { InpaintHistoryData, InpaintModelFamily } from './types'

// Exactly the four anchorFailureKind values production emits (JudgeEditAppliedChecks).
export type InpaintAnchorFailureKind =
  | 'different_shot'
  | 'edit_failed'
  | 'framing_drift'
  | 'identity_changed'

// =============================================================================
// Inpaint public SSE state -- the client-facing projection of the workflow state.
//
// The raw InpaintSSEStateOutput passes the ENTIRE internal task state to the
// browser: every pipeline activity's result, its args, and the raw error
// (type/details). This DTO is the explicit allowlist of what the editor UI
// actually consumes:
//   - `history` in full + a field subset of `business.edits` (the editor content)
//   - a few task buckets' result fields the UI renders (tier A, below)
//   - run topology (id/state/startedAt + a sanitized error message) for every
//     other bucket, which the UI dep-graph failure walk needs (tier B)
//
// NOT exposed: internal store:// urls, prompts/args, model/provider internals, and
// raw error type/details.
// =============================================================================

// ---- Run records ----

// Sanitized run error: only business-safe fields survive the projection -- never
// the raw error message/type/details. `nonRetryable` is a product decision for the
// editor UI, independent from the activity retry policy.
export interface PublicRunError {
  readonly code?: PublicRunErrorCode
  readonly message: string
  readonly nonRetryable?: true
  // Why the run failed, in the words of the check that rejected it -- today only the
  // vision judge's verdict behind `edit_not_applied`. Sanitized single-line prose, so
  // it is renderable as-is. Absent when the failure carried no reason, which includes
  // every run recorded before the reason was attached.
  readonly reason?: string
}

export type PublicRunErrorCode =
  | 'anchor_edit_not_applied'
  | 'anchor_generation_blocked'
  | 'anchor_generation_no_image'
  | 'content_policy_blocked'
  | 'edit_not_applied'
  | 'input_audio_copyright'
  | 'input_audio_sensitive_content'
  | 'input_image_copyright'
  | 'input_image_real_person'
  | 'input_image_sensitive_content'
  | 'input_text_copyright'
  | 'input_text_sensitive_content'
  | 'input_video_copyright'
  | 'input_video_real_person'
  | 'input_video_sensitive_content'
  | 'output_audio_copyright'
  | 'output_audio_sensitive_content'
  | 'output_image_counterfeit_document'
  | 'output_image_sensitive_content'
  | 'output_text_sensitive_content'
  | 'output_video_copyright'
  | 'output_video_sensitive_content'
  | 'reference_fetch_failed'

// Field names mirror the raw TaskRunRecord (id / state / startedAt / finishedAt)
// so the public state is a structural subset, not a rename.
interface PublicRunCommon {
  // Absent while pending; set when the run reaches a terminal state.
  readonly finishedAt?: number
  readonly id: string
  readonly startedAt: number
}

// Topology-only run (tier B): no result payload, sanitized error only.
export type PublicRun =
  | (PublicRunCommon & { readonly error: PublicRunError; readonly state: 'rejected' })
  | (PublicRunCommon & { readonly state: Exclude<TaskRunRecordState, 'rejected'> })

// Result-bearing run (tier A): exposes an allowlisted result on resolution.
export type PublicResultRun<T> =
  | (PublicRunCommon & { readonly error: PublicRunError; readonly state: 'rejected' })
  | (PublicRunCommon & { readonly result: T; readonly state: 'resolved' })
  | (PublicRunCommon & { readonly state: 'cancelled' | 'pending' })

// ---- Tier-A result payloads (allowlisted fields only) ----

export interface PublicAnchorResult {
  readonly anchorUrl: string
}

export interface PublicFrameResult {
  readonly frameUrl: string
}

export interface PublicGenResult {
  readonly finalUrl: string
  // split_plus only: per-position clips the apply maps onto adjacent transitions.
  // Shape mirrors EditGenTaskResult['positions'] so downstream consumers (apply
  // clips, RunRecord) take it without copies.
  positions?: { storeUrl: string; role: 'cur' | 'next' | 'prev' }[]
}

export interface PublicPlan {
  // Structure only: the plan lists which model families an edit can generate with.
  // Informational: the server resolves the generation model from the source video's
  // provenance, so no client reads this to pick one.
  readonly modelFamily: InpaintModelFamily
}

export interface PublicPlanResult {
  // Per-side reach of the plan from the edit's own transition (see the backend
  // EditPlanTaskResult.affectedRange). Lets the UI span an edit's overlay across the
  // transitions it affects straight from the plan. Optional: absent for plan results
  // cached before this field existed.
  readonly affectedRange?: { readonly left: number; readonly right: number }
  readonly plans: readonly PublicPlan[]
}

// ---- Task entries ----

export interface PublicResultTaskEntry<T> {
  readonly runs: readonly PublicResultRun<T>[]
}

export interface PublicTaskEntry {
  readonly runs: readonly PublicRun[]
}

// gen/plan runs are linked to their edit via the forward reference on PublicEdit
// (genVideoTaskIds / planTaskId), not by an editId on the entry.
export interface PublicGenTaskEntry extends PublicResultTaskEntry<PublicGenResult> {
  // Family this shot's next run generates with, resolved server-side (provenance, plus
  // any retry escalation). Absent for entries recorded before this field existed.
  readonly modelFamily?: InpaintModelFamily
  // Plan run this shot was confirmed from. Absent for entries recorded before this
  // field existed.
  readonly planRunId?: string
  // Whether this shot's prompt is a pure deletion, which generation routes to the eraser
  // model whatever family is asked for. Absent for entries recorded before this field.
  readonly pureDeletion?: boolean
  // User retries of this shot so far. Drives the editor's retry cap; absent for
  // entries recorded before the count existed.
  readonly userRetryCount?: number
}

export type PublicPlanTaskEntry = PublicResultTaskEntry<PublicPlanResult>

// the original-frame lookup is keyed by timestamp, not by edit. videoUrl is the
// version discriminator: the same timestamp is extracted again from every applied
// version of a transition, so timestamp alone matches stale frames.
export interface PublicFrameTaskEntry extends PublicResultTaskEntry<PublicFrameResult> {
  readonly timestampSec: number
  readonly videoUrl: string
}

// ---- Tasks ----

export interface InpaintPublicTasks {
  // Tier B -- topology only.
  alignAndConcatRecords: Record<string, PublicTaskEntry>
  // Tier B -- topology only (the consumed anchor result lives in anchorRunRecords).
  anchorRecords: Record<string, PublicTaskEntry>
  // Tier A -- result.anchorUrl.
  anchorRunRecords: Record<string, PublicResultTaskEntry<PublicAnchorResult>>
  byteplusAssetGroupRecords: Record<string, PublicTaskEntry>
  concatRecords: Record<string, PublicTaskEntry>
  copyTransitionClipsRecords: Record<string, PublicTaskEntry>
  // Dep graph: child run/task ids per run id. Drives the UI failure walk.
  depRecords: Record<string, readonly string[]>
  // Tier B -- topology only (the applied/no-op verdict itself is not user-facing).
  editApplyJudgeRecords: Record<string, PublicTaskEntry>
  // Tier A -- result {finalUrl, positions}, linked to its edit via PublicEdit.genVideoTaskIds.
  editGenTaskRecords: Record<string, PublicGenTaskEntry>
  // Tier A -- result {affectedRange, plans:[{modelFamily}]}, linked via PublicEdit.planTaskId.
  editPlanRecords: Record<string, PublicPlanTaskEntry>
  editScopeRecords: Record<string, PublicTaskEntry>
  endpointEditRecords: Record<string, PublicTaskEntry>
  extractFramesRecords: Record<string, PublicTaskEntry>
  // Tier A -- result.frameUrl, keyed by (videoUrl, timestampSec).
  extractVideoFrameRecords: Record<string, PublicFrameTaskEntry>
  postProcessRecords: Record<string, PublicTaskEntry>
  probeRecords: Record<string, PublicTaskEntry>
  segmentRecords: Record<string, PublicTaskEntry>
  speedUpReferenceRecords: Record<string, PublicTaskEntry>
  splitRecords: Record<string, PublicTaskEntry>
  uploadByteplusAssetRecords: Record<string, PublicTaskEntry>
}

// ---- Business ----

// Allowlisted edit fields the UI consumes (drops createdAt and any future
// internal fields).
export interface InpaintPublicBusiness {
  readonly edits: Record<string, PublicEdit>
  // See InpaintBusinessState.legacyDraftDropped.
  readonly legacyDraftDropped?: boolean
}

// A user-attached reference image for the edit. Only the store path is carried:
// the client uploads the bytes via a signed upload and sends the resulting path,
// so the workflow state never holds image bytes or data URLs.
export interface InpaintReference {
  readonly fileUri: string
}

// A region of a frame the user boxed to scope the instruction. `bbox` is
// normalized to the frame (0..1 origin plus extent) and `tsMs` is the offset into
// the transition the box was drawn on.
export interface InpaintRegion {
  readonly bbox: { readonly h: number; readonly w: number; readonly x: number; readonly y: number }
  readonly tsMs: number
}

export interface PublicEdit {
  readonly editPrompt?: string
  // Forward links to this edit's gen tasks (keys into tasks.*Records). Length is
  // the per-type attempt count. See EditData for how they are populated.
  readonly genImageTaskIds?: readonly string[]
  readonly genVideoTaskIds?: readonly string[]
  readonly historyId: string
  readonly id: string
  readonly judgeMismatch?: PublicJudgeMismatch
  readonly planTaskId?: string
  // Exposed despite the store:// rule above: the client supplied these paths itself
  // (signed upload), and it needs them back to redraw the prompt pills after a
  // reload or the edit-mode echo.
  readonly references?: readonly InpaintReference[]
  readonly region?: InpaintRegion
  readonly selectedAnchorId?: string
  readonly timestampSec: number
  readonly transitionId: string
}

// Set only when the judge flagged the applied clip but enforcement was off, so the clip was kept and charged.
export interface PublicJudgeMismatch {
  readonly anchorFailureKind?: InpaintAnchorFailureKind
  readonly failedCheck: JudgeFailedCheck
  readonly reason?: string
}

// ---- Top-level ----

export interface InpaintPublicState {
  readonly business: InpaintPublicBusiness
  readonly history: InpaintHistoryData
  // True when `history` is a capped window of the full edit history: its base is
  // a synthesized snapshot at the cut, not the project's original base.
  readonly historyTruncated?: boolean
  readonly tasks: InpaintPublicTasks
  readonly version: number
}
