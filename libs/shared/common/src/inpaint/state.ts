import type {
  AlignAndConcatVideosParams,
  AlignAndConcatVideosResult,
  CompareFramesParams,
  CompareFramesResult,
  ConcatVideosParams,
  ConcatVideosResult,
  CopyTransitionClipsParams,
  CopyTransitionClipsResult,
  CreateAssetGroupParams,
  CreateAssetGroupResult,
  EditEndpointFrameParams,
  EditEndpointFrameResult,
  ExtractVideoFrameParams,
  ExtractVideoFrameResult,
  ExtractVideoFramesParams,
  ExtractVideoFramesResult,
  GenerateAnchorParams,
  GenerateAnchorResult,
  GenerateInpaintSegmentParams,
  GenerateInpaintSegmentResult,
  JudgeEditAppliedParams,
  JudgeEditAppliedResult,
  JudgeEditScopeParams,
  JudgeEditScopeResult,
  PostProcessVideoParams,
  PostProcessVideoResult,
  ProbeVideoParams,
  ProbeVideoResult,
  SpeedUpReferenceVideoParams,
  SpeedUpReferenceVideoResult,
  SplitReferenceVideoParams,
  SplitReferenceVideoResult,
  UploadAssetParams,
  UploadAssetResult,
} from './activity-types'
import type { EditPlanCase } from './edit-plan-case'
import type { InpaintReference, InpaintRegion } from './public-state'
import type { TaskEntry } from './task-types'
import type {
  InpaintHistoryData,
  InpaintModelFamily,
  InpaintSegmentParams,
  InpaintStrategy,
} from './types'

// --- Task records ---

// A retry can restart only the shot's failed dependencies, leaving the shot task's
// own run list unchanged, so user retries are counted here rather than inferred from
// runs.length. Optional: entries recorded before this field carry no count.
export type EditGenTaskEntry = TaskEntryMeta<EditGenTaskResult, [EditGenTaskParams]> & {
  userRetryCount?: number
}

export type InpaintTaskRecords = {
  alignAndConcatRecords: Record<
    string,
    TaskEntryMeta<AlignAndConcatVideosResult, [AlignAndConcatVideosParams]>
  >
  anchorRecords: Record<string, TaskEntryMeta<GenerateAnchorResult, [GenerateAnchorParams]>>
  anchorRunRecords: Record<string, TaskEntryMeta<GenerateAnchorResult, [GenerateAnchorParams]>>
  byteplusAssetGroupRecords: Record<
    string,
    TaskEntryMeta<CreateAssetGroupResult, [CreateAssetGroupParams]>
  >
  concatRecords: Record<string, TaskEntryMeta<ConcatVideosResult, [ConcatVideosParams]>>
  copyTransitionClipsRecords: Record<
    string,
    TaskEntryMeta<CopyTransitionClipsResult, [CopyTransitionClipsParams]>
  >
  depRecords: Record<string, readonly string[]>
  editApplyJudgeRecords: Record<
    string,
    TaskEntryMeta<JudgeEditAppliedResult, [JudgeEditAppliedParams]>
  >
  editGenTaskRecords: Record<string, EditGenTaskEntry>
  editPlanRecords: Record<string, TaskEntryMeta<EditPlanTaskResult, [EditPlanTaskParams]>>
  editScopeRecords: Record<string, TaskEntryMeta<JudgeEditScopeResult, [JudgeEditScopeParams]>>
  endpointEditRecords: Record<
    string,
    TaskEntryMeta<EditEndpointFrameResult, [EditEndpointFrameParams]>
  >
  extractFramesRecords: Record<
    string,
    TaskEntryMeta<ExtractVideoFramesResult, [ExtractVideoFramesParams]>
  >
  extractVideoFrameRecords: Record<
    string,
    TaskEntryMeta<ExtractVideoFrameResult, [ExtractVideoFrameParams]>
  >
  frameCompareRecords: Record<string, TaskEntryMeta<CompareFramesResult, [CompareFramesParams]>>
  postProcessRecords: Record<
    string,
    TaskEntryMeta<PostProcessVideoResult, [PostProcessVideoParams]>
  >
  probeRecords: Record<string, TaskEntryMeta<ProbeVideoResult, [ProbeVideoParams]>>
  segmentRecords: Record<
    string,
    TaskEntryMeta<GenerateInpaintSegmentResult, [GenerateInpaintSegmentParams]>
  >
  speedUpReferenceRecords: Record<
    string,
    TaskEntryMeta<SpeedUpReferenceVideoResult, [SpeedUpReferenceVideoParams]>
  >
  splitRecords: Record<
    string,
    TaskEntryMeta<SplitReferenceVideoResult, [SplitReferenceVideoParams]>
  >
  uploadByteplusAssetRecords: Record<string, TaskEntryMeta<UploadAssetResult, [UploadAssetParams]>>
}

// Keys of InpaintTaskRecords whose value is a task-entry map (Record<string, TaskEntryMeta>),
// i.e. the real per-task record maps. Excludes non-task entries such as `depRecords`
// (Record<string, readonly string[]>). Derived from InpaintTaskRecords so the set tracks the
// source of truth and can never silently drift; use it to exhaustively key structures that
// must cover every task type (e.g. per-task ETA estimators).
export type InpaintTaskEntryKey = {
  [K in keyof InpaintTaskRecords]: InpaintTaskRecords[K] extends Record<
    string,
    TaskEntryMeta<infer _T, infer _TArgs>
  >
    ? K
    : never
}[keyof InpaintTaskRecords]

export type InpaintTaskRecordsInput = {
  alignAndConcatRecords?: Record<
    string,
    TaskEntryMeta<AlignAndConcatVideosResult, [AlignAndConcatVideosParams]>
  >
  anchorRecords?: Record<string, TaskEntryMeta<GenerateAnchorResult, [GenerateAnchorParams]>>
  anchorRunRecords?: Record<string, TaskEntryMeta<GenerateAnchorResult, [GenerateAnchorParams]>>
  byteplusAssetGroupRecords?: Record<
    string,
    TaskEntryMeta<CreateAssetGroupResult, [CreateAssetGroupParams]>
  >
  concatRecords?: Record<string, TaskEntryMeta<ConcatVideosResult, [ConcatVideosParams]>>
  copyTransitionClipsRecords?: Record<
    string,
    TaskEntryMeta<CopyTransitionClipsResult, [CopyTransitionClipsParams]>
  >
  depRecords?: Record<string, readonly string[]>
  editApplyJudgeRecords?: Record<
    string,
    TaskEntryMeta<JudgeEditAppliedResult, [JudgeEditAppliedParams]>
  >
  editGenTaskRecords?: Record<string, TaskEntryMeta<EditGenTaskResult, [EditGenTaskParams]>>
  editPlanRecords?: Record<string, TaskEntryMeta<EditPlanTaskResult, [EditPlanTaskParams]>>
  editScopeRecords?: Record<string, TaskEntryMeta<JudgeEditScopeResult, [JudgeEditScopeParams]>>
  endpointEditRecords?: Record<
    string,
    TaskEntryMeta<EditEndpointFrameResult, [EditEndpointFrameParams]>
  >
  extractFramesRecords?: Record<
    string,
    TaskEntryMeta<ExtractVideoFramesResult, [ExtractVideoFramesParams]>
  >
  extractVideoFrameRecords?: Record<
    string,
    TaskEntryMeta<ExtractVideoFrameResult, [ExtractVideoFrameParams]>
  >
  frameCompareRecords?: Record<string, TaskEntryMeta<CompareFramesResult, [CompareFramesParams]>>
  postProcessRecords?: Record<
    string,
    TaskEntryMeta<PostProcessVideoResult, [PostProcessVideoParams]>
  >
  probeRecords?: Record<string, TaskEntryMeta<ProbeVideoResult, [ProbeVideoParams]>>
  segmentRecords?: Record<
    string,
    TaskEntryMeta<GenerateInpaintSegmentResult, [GenerateInpaintSegmentParams]>
  >
  speedUpReferenceRecords?: Record<
    string,
    TaskEntryMeta<SpeedUpReferenceVideoResult, [SpeedUpReferenceVideoParams]>
  >
  splitRecords?: Record<
    string,
    TaskEntryMeta<SplitReferenceVideoResult, [SplitReferenceVideoParams]>
  >
  uploadByteplusAssetRecords?: Record<string, TaskEntryMeta<UploadAssetResult, [UploadAssetParams]>>
}

export type TaskEntryMeta<T, TArgs extends unknown[] = unknown[]> = TaskEntry<T, TArgs> & {
  id: string
}

// --- Edit data (business state entity) ---

export type EditData = {
  // Server-side auto-apply opt-in, stamped at creation by the range-selection flow.
  // Optional: edits created before this field (or by the manual-accept flow) carry
  // no value and are never applied by the workflow itself.
  autoApply?: boolean
  createdAt: number
  editPrompt?: string
  // Anchor (image) gen task ids this edit has triggered, in order. One per
  // regenerate (each uses a fresh nonce -> new task). Length is the attempt count.
  // The forward edit->task link (replaces reverse editId on task args).
  genImageTaskIds?: string[]
  // Video (shot) gen task ids this edit has triggered, in order. One per
  // confirm/regenerate. Length is the attempt count.
  genVideoTaskIds?: string[]
  historyId: string
  id: string
  // Model family pinned from the source video's provenance at edit creation. The
  // single value both the plan task and the gen task derive case4 from; optional
  // because edits persisted before this field existed carry none (readers fall back to
  // DEFAULT_INPAINT_MODEL_FAMILY).
  modelFamily?: InpaintModelFamily
  // Current plan task id for this edit (set by the pipeline when the plan is
  // created; changes if the prompt changes). Resolves genPlan without editId.
  planTaskId?: string
  // User-attached reference images for this edit, as store paths only.
  references?: InpaintReference[]
  // Frame region the user boxed to scope the instruction.
  region?: InpaintRegion
  selectedAnchorId?: string
  timestampSec: number
  transitionId: string
  // Explicit multi-clip range (covered transition ids), optional.
  transitionIds?: string[]
  // Attribution for the telemetry the worker emits about this edit. Optional: edits
  // persisted before this field carry none.
  userId?: string
}

// --- Edit plan task types (H: generation plan) ---

export type EditPlanTaskParams = {
  editPrompt: string
  // Whether the edit record carries attached reference images, one of the removal-fflf
  // eligibility conjuncts. Like `modelFamily`, EXCLUDED from the plan cache key (see
  // editPlanCache keyFn): adding a field to the key re-keys every persisted plan, so an
  // existing edit would miss its cached plan and start a new plan task. The value can
  // therefore be STALE (updateEditContext field-merges references onto a live edit
  // without touching editPrompt), so gen re-checks it against the live edit record before
  // taking the fflf route - see EditGenTaskParams.hasReferences. BOTH callers of
  // editPlanCache.get must pass it - the warm call in generate-anchor-image.ts runs first,
  // so its params are the ones the run receives.
  hasReferences?: boolean
  historyId: string // used to look up transition + keyframe URLs from historyInstance
  // Provenance family the plan's case4 ceiling check resolves against. Like `editId`
  // on EditGenTaskParams, EXCLUDED from the plan cache key (see
  // editPlanCache keyFn): it is constant per project (provenance), so it can never
  // legitimately fork a plan, and keeping it out of the key means no existing cached
  // plan entry re-keys.
  modelFamily?: InpaintModelFamily
  projectId: string
  // Explicit multi-clip range (covered transition ids), optional.
  rangeTransitionIds?: string[]
  timestampSec: number
  transitionId: string // identifies which transition in the history state
}

// Versioned so persisted state stays decodable. v0 (legacy, no `v` field) stored
// per-model plans[]; v1 stores only the structural planCase. Consumers
// (neighbor-gate, public-state, the API layer) branch on the discriminant.
export type EditPlanTaskResult =
  | {
      affectedRange?: { left: number; right: number }
      plans: Array<{ modelFamily: InpaintModelFamily }>
      // v0 (legacy): plan results persisted before the structural planCase existed.
      // affectedRange is itself optional: results cached before that field existed
      // decode to undefined, which the neighbor-gate treats as "unknown" (+/-1).
      v?: 0
    }
  | {
      planCase: EditPlanCase
      // Whether the removal-aware split treatment (editing the split chain's outer
      // boundaries before generating, see evaluateSplitChain in gen-mode-chain.ts) was
      // patched in when this plan resolved. Read back by gen (see EditGenTaskParams.
      // planRemovalAware) so gen consumes plan's decision instead of deciding
      // again itself, which can disagree with plan's read across a deploy that
      // lands between plan-time and generate-time. Additive/optional: a plan persisted
      // before this field existed, or a plan resolved pre-patch, decodes to undefined
      // and must read as false.
      removalAwarePatched?: boolean
      // Same decision, for the split_plus chain (case4a/case4b, see
      // evaluateSplitPlusChain in gen-split-plus-chain.ts). A SEPARATE field under its
      // own patch id, not a reuse of removalAwarePatched: split_plus gained its endpoint
      // edits one deploy later, so an in-flight plan that persisted
      // removalAwarePatched=true under the split-only deploy must NOT start issuing
      // split_plus endpoint-edit commands when gen replays on the newer worker. Additive
      // and optional on the same terms as the field above.
      removalAwareSplitPlusPatched?: boolean
      // Whether the removal-fflf route (anchor-split, i2v from the clip's own first and
      // last frames, no reference video) was patched in AND this edit was eligible for it
      // when the plan resolved. Read back by gen (see EditGenTaskParams.planRemovalFflf)
      // on the same terms as the two fields above. Additive/optional: a plan persisted
      // before this field existed, or resolved pre-patch, decodes to undefined and must
      // read as false.
      removalFflfPatched?: boolean
      // Which shape authorized the removal-fflf route when removalFflfPatched is true:
      // 'split' under REMOVAL_FFLF_PATCH_ID, 'split_plus' under
      // REMOVAL_FFLF_SPLIT_PLUS_PATCH_ID. Undefined whenever removalFflfPatched is
      // false/absent. Read back by gen (see EditGenTaskParams.planRemovalFflfShape) so
      // gen can refuse to enter a shape the plan never authorized, even when it
      // re-resolves a different strategy than plan saw.
      removalFflfShape?: 'split' | 'split_plus'
      // v1 (current): structure only; affectedRange is derived on demand via
      // planCaseSpread(planCase).
      v: 1
    }

// --- Edit gen task types (I+G: generation execution) ---

export type EditGenTaskParams = {
  anchorUrl: string
  // Owning edit, for analytics only. Deliberately EXCLUDED from the gen cache key (see
  // editGenTaskCache keyFn) so it cannot fork an existing generation; optional because
  // tasks persisted before it existed carry no value.
  editId?: string
  editPrompt: string
  // Whether the edit record carries attached reference images, read from the LIVE edit
  // record at signal time rather than forwarded from the plan task's args: plan's copy
  // is stale-able (see EditPlanTaskParams.hasReferences), and the fflf route must not be
  // entered on a plan that resolved before the user attached a reference the anchor-split
  // i2v chain would discard. EXCLUDED from the gen cache key for the same reason as
  // `editId`.
  hasReferences?: boolean
  historyId: string // used to look up transition + keyframe URLs from historyInstance
  modelFamily: InpaintModelFamily
  // Family this task's runs generate with from the escalation retry onward, replacing
  // `modelFamily`. Written onto the persisted args by the retry handler, so it MUST be
  // EXCLUDED from the gen cache key (see editGenTaskCache keyFn): a task id is its own
  // args hash, and forking one would orphan the shot from the owning edit's
  // genVideoTaskIds. Absent on every task that has never been escalated.
  modelFamilyOverride?: InpaintModelFamily
  nonce?: string
  // The family the PLAN's case4 was resolved against, forwarded from the plan task's
  // own args so gen cannot re-derive a different case. Distinct from `modelFamily`,
  // which is the model this generation actually calls and may differ when the model
  // fallback chain fires. EXCLUDED from the gen cache key for the same reason as
  // `editId`.
  planModelFamily?: InpaintModelFamily
  // Whether plan resolved this edit's split chain as removal-aware (see
  // EditPlanTaskResult.removalAwarePatched), forwarded from the plan task's own RESULT
  // so gen consumes plan's persisted decision instead of deciding again itself,
  // which can disagree with plan's read across a deploy that lands between plan-time
  // and generate-time. Absent (pre-field plan, or a v0 plan) reads as false, matching
  // an unpatched plan. EXCLUDED from the gen cache key for the same reason as `editId`.
  planRemovalAware?: boolean
  // Same forwarding for the split_plus chain (see
  // EditPlanTaskResult.removalAwareSplitPlusPatched). Separate from planRemovalAware
  // because the two chains were patched in on different deploys. EXCLUDED from the gen
  // cache key for the same reason as `editId`.
  planRemovalAwareSplitPlus?: boolean
  // Whether plan routed this edit to the removal-fflf pipeline (see
  // EditPlanTaskResult.removalFflfPatched), forwarded from the plan task's own RESULT so
  // gen consumes plan's persisted decision instead of deciding again itself:
  // plan-time and gen-time are separated by a real user action, so a deploy can land
  // between them. Absent (pre-field plan, or a v0 plan) reads as false. EXCLUDED from the
  // gen cache key for the same reason as `editId`.
  planRemovalFflf?: boolean
  // The shape plan authorized alongside planRemovalFflf (see EditPlanTaskResult.
  // removalFflfShape). Gen's routing must refuse to take the fflf route when its own
  // re-resolved strategy does not match this shape -- otherwise a plan/gen strategy
  // disagreement (see planRemovalFflf's comment) can route into a shape whose patch id
  // was never checked. Absent (pre-field plan, or a v0 plan, or removalFflfPatched was
  // false) is read as the legacy 'split' authorization, since 'split' is the only shape
  // code before this field existed could ever have authorized. EXCLUDED from the gen
  // cache key for the same reason as planRemovalFflf.
  planRemovalFflfShape?: 'split' | 'split_plus'
  // The plan run this generation was confirmed from. Pins the case an escalated retry
  // runs against: the edit's latest resolved plan run can be a newer one (the user
  // re-planned after the failure) whose case the replayed generation, bound to the args
  // above, never executes. EXCLUDED from the gen cache
  // key for the same reason as `editId`. Absent on tasks persisted before this field.
  planRunId?: string
  projectId: string
  // Explicit multi-clip range (covered transition ids), optional.
  rangeTransitionIds?: string[]
  timestampSec: number
  transitionId: string // identifies which transition; videoUrl derived via transitionMap
}

export type EditGenTaskResult = {
  // Total provider spend of the segments this generation consumed; absent when no
  // segment priced its generation (cache hits, unpriced providers).
  costUsd?: number
  finalUrl: string
  // Endpoint frames that were AI-edited; should be written back to history as keyframe ops.
  keyframeUpdates?: { keyframeUrl: string; shotId: string }[]
  // split_plus only: per-original-position clips for multi-position apply.
  positions?: { storeUrl: string; offset?: number; role: 'cur' | 'next' | 'prev' }[]
  // Generated-clip dims for cover-crop; one value covers finalUrl + all positions
  // (nothing rescales), undefined on a cross-run segment cache hit.
  videoHeight?: number
  videoWidth?: number
}

// --- Core mechanism state ---

export const MAX_SEEN_CLIENT_IDS = 200

export type InpaintCoreState = {
  deadlineAt: number
  defaultNonce: string
  inFlight: number
  pendingDrain: 'continue_as_new' | 'finish' | null
  seenClientIds: string[]
}

export type InpaintCoreStateInput = {
  deadlineAt?: number
  defaultNonce?: string
  inFlight?: number
  seenClientIds?: string[]
}

// --- SSE state ---

export type InpaintSSEState = {
  diffs: Array<{ delta: unknown; version: number }>
  version: number
}

// --- Business state ---

export type InpaintBusinessState = {
  edits: Record<string, EditData>
  // Set when a legacy long-take editor draft existed for this project but could not
  // be carried over into the inpaint editor's initial history (base revision moved,
  // or the draft failed to replay). Surfaced to the UI so the user knows why the
  // video they see doesn't reflect their last session there.
  legacyDraftDropped?: boolean
}

export type InpaintBusinessStateInput = {
  edits?: Record<string, EditData>
  legacyDraftDropped?: boolean
}

// --- Global state ---

// Not exported, so `brandNormalized` is the only place that can produce a value of
// this type. A reader that parses the persisted blob gets InpaintGlobalStateInput and
// cannot reach any consumer without normalizing first.
declare const normalized: unique symbol

// Split out from InpaintGlobalState so `brandNormalized` can take this (unbranded,
// structurally-checked) shape as a real parameter type: TypeScript enforces missing
// properties on a function argument, unlike an `as InpaintGlobalState` cast, which
// only checks for "sufficient overlap" and lets a missing task bucket through silently.
export type InpaintGlobalState = InpaintGlobalStateFields & { readonly [normalized]: true }

export type InpaintGlobalStateInput = {
  business?: InpaintBusinessStateInput
  core?: InpaintCoreStateInput
  history: InpaintHistoryData
  sse?: { diffs?: Array<{ delta: unknown; version: number }>; version?: number }
  tasks?: InpaintTaskRecordsInput
}

export type InpaintWorkflowState = InpaintGlobalState

type InpaintGlobalStateFields = {
  business: InpaintBusinessState
  core: InpaintCoreState
  history: InpaintHistoryData
  sse: InpaintSSEState
  tasks: InpaintTaskRecords
}

// Pick<InpaintGlobalState, ...> erases the symbol-keyed brand (unlike Omit), so a
// consumer typed with a bare Pick accepts an unbranded, hand-built slice. Wrap any
// such consumer param in Normalized<...> to keep it gated on brandNormalized.
export type Normalized<T> = T & { readonly [normalized]: true }

export function brandNormalized(fields: InpaintGlobalStateFields): InpaintGlobalState {
  return fields as InpaintGlobalState
}

// --- Strategy I/O types ---

export interface InpaintStrategyResult {
  segments: InpaintSegmentParams[]
  strategy: InpaintStrategy
}

export interface InpaintTransitionInput {
  anchorFrameUrl: string
  anchorTimestampSec: number
  aspectRatio: string
  firstFrameUrl: string
  lastFrameUrl: string
  modelFamily: InpaintModelFamily
  projectId: string
  prompt: string
  referenceVideoUrl: string
  totalDurationSec: number
}
