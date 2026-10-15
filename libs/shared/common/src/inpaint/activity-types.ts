import type { InpaintModelFamily, InpaintSegmentParams, InpaintStrategy } from './types'

// --- align-and-concat-videos ---

export interface AlignAndConcatVideoInput {
  targetDurationSec?: number
  url: string
}

export interface AlignAndConcatVideosParams {
  // Generated chunks must never carry audio into the concat: narration rides
  // `audioSourceUri` at final render, so any chunk audio would double up there.
  // Omitted rather than set false on every existing caller, because the
  // activity's storage cache key (`buildCacheKey`) JSON-stringifies its params and
  // therefore drops undefined - every path that does not opt in keeps a
  // byte-identical key.
  dropAudio?: boolean
  projectId: string
  targetDurationSec?: number
  videos: AlignAndConcatVideoInput[]
}

export interface AlignAndConcatVideosResult {
  finalUrl: string
}

// --- apply-transition ---

export interface ApplyTransitionActivityParams {
  finalUrl: string
  projectId: string
  runId: string
  transitionId: string
}

export interface ApplyTransitionActivityResult {
  canonicalUrl: string
}

// --- compare-frames ---

export interface CompareFramesParams {
  anchorUrl: string
  projectId: string
  sourceFrameUrl: string
}

export interface CompareFramesResult {
  identical: boolean
  maxPixelDiff: number
  meanDiff: number
}

// --- concat-videos ---

export interface ConcatVideosParams {
  projectId: string
  seg1Url: string
  seg2Url: string
}

export interface ConcatVideosResult {
  storeUrl: string
}

// --- byteplus: create/delete asset group + upload ---

export interface CreateAssetGroupParams {
  workflowId: string
}

export interface CreateAssetGroupResult {
  groupId: string
}

export interface UploadAssetParams {
  assetType?: 'Image' | 'Video'
  fileUri: string
  groupId: string
  // Ignored by the activity: it forks the task cache key so a segment whose asset ids
  // the provider swept can re-upload without disturbing the task its siblings share.
  heal?: 1
}

export interface UploadAssetResult {
  assetId: string
}

// --- extract-video-frame ---

export interface ExtractVideoFrameParams {
  nonce?: string
  projectId: string
  timestampSec: number
  videoUrl: string
}

export interface ExtractVideoFrameResult {
  frameUrl: string
}

// --- extract-video-frames ---

export interface ExtractVideoFramesParams {
  durationSec: number
  projectId: string
  videoUrl: string
}

export interface ExtractVideoFramesResult {
  firstFrameUrl: string
  lastFrameUrl: string
}

// --- generate-anchor ---

export interface GenerateAnchorParams {
  /**
   * Owning edit, for analytics only. EXCLUDED from the anchor-run cache key so it
   * cannot fork an existing anchor; optional because runs replayed from before it
   * existed carry no value.
   */
  editId?: string
  editPrompt: string
  nonce?: string
  projectId: string
  /** User-attached images guiding how the edit should look. */
  references?: InpaintReference[]
  /** User-drawn box binding the edit to one part of the frame. */
  region?: InpaintRegion
  timestampSec: number
  videoUrl: string
}

export interface GenerateAnchorResult {
  anchorUrl: string
}

/** A user-attached image, fed to the anchor edit as extra visual guidance. */
export interface InpaintReference {
  fileUri: string
}

/**
 * A user-drawn box over the player, marking what the edit should apply to.
 * bbox is normalized to the rendered frame (0..1, x/y = top-left corner).
 */
export interface InpaintRegion {
  bbox: { h: number; w: number; x: number; y: number }
  tsMs: number
}

// --- generate-inpaint-segment ---

export interface GenerateInpaintSegmentParams extends InpaintSegmentParams {
  modelFamily: InpaintModelFamily
  segmentLabel: SegmentLabel
  strategy: InpaintStrategy
}

export interface GenerateInpaintSegmentResult {
  // Provider spend of this segment's generation; absent on a cache hit, which paid
  // nothing, and on providers whose cost this worker does not price.
  costUsd?: number
  storeUrl: string
  // Generated-clip dims for cover-crop (undefined on a cross-run storage cache hit).
  videoHeight?: number
  videoWidth?: number
}

export type SegmentLabel =
  | 'both_edited'
  | 'boundary_end'
  | 'boundary_start'
  | 'removal_fflf'
  | 'seg1'
  | 'seg2'
  | 'single'
  | 'split_plus_end'
  | 'split_plus_start'

// --- post-process-video ---

export interface PostProcessVideoParams {
  projectId: string
  speedFactor: number
  videoUrl: string
}

export interface PostProcessVideoResult {
  storeUrl: string
}

// --- probe-video ---

export interface ProbeVideoParams {
  projectId: string
  videoUrl: string
}

export interface ProbeVideoResult {
  aspectRatio: string
  durationSec: number
}

// --- split-reference-video ---

export interface SpeedUpReferenceVideoParams {
  projectId: string
  referenceVideoUrl: string
  targetDurationSec: number
}

export interface SpeedUpReferenceVideoResult {
  durationSec: number
  storeUrl: string
}

export interface SplitReferenceVideoParams {
  projectId: string
  referenceVideoUrl: string
  splitAtSec: number
}

export interface SplitReferenceVideoResult {
  seg1DurationSec: number
  seg1Url: string
  seg2DurationSec: number
  seg2Url: string
}

// --- edit-endpoint-frame ---

export interface EditEndpointFrameParams {
  /** User-confirmed anchor image: the visual reference for how the edit must look. */
  anchorUrl: string
  editPrompt: string
  endpoint: 'first' | 'last'
  /** Original endpoint frame to edit. */
  frameUrl: string
  projectId: string
}

export interface EditEndpointFrameResult {
  /** null = edit failed; the pipeline falls back to the original frame. */
  editedUrl: null | string
}

// --- judge-edit-scope ---

export interface JudgeEditScopeParams {
  /**
   * Boundary mode: judge this single frame against frameUrl instead of the clip endpoints.
   * The verdict is reported in both firstNeedsEdit and lastNeedsEdit.
   */
  boundaryFrameUrl?: string
  durationSec: number
  editPrompt: string
  firstFrameUrl: string
  /** Selected (anchor source) frame extracted at timestampSec. */
  frameUrl: string
  lastFrameUrl: string
  nonce?: string
  projectId: string
  timestampSec: number
  videoUrl: string
}

export interface JudgeEditScopeResult {
  /** Present only when judge.enforce resolved to false. */
  enforce?: boolean
  firstNeedsEdit: boolean
  lastNeedsEdit: boolean
  ok: boolean
  reason: string
}

// --- judge-edit-applied ---

export type JudgeAnchorVoteOutcome = 'error' | 'overturned' | 'upheld'

export interface JudgeEditAppliedChecks {
  anchorConsistent: boolean
  anchorFailureKind?:
    | 'different_shot'
    | 'edit_failed'
    | 'framing_drift'
    | 'identity_changed'
    | 'none'
    | null
  anchorReason: string
  applied: boolean
  appliedReason: string
  held: boolean
  heldReason?: string
}

export interface JudgeEditAppliedFrame {
  timestampSec?: number
  transitionId?: string
}

export interface JudgeEditAppliedParams {
  /**
   * 1-based positions, among outputFrameUrls, of the frames inside the anchor
   * window (the clicked timestamp and t +/- 0.5s/1s). Unlike strategy/genRoute,
   * THIS DOES affect the verdict: applied is a majority vote over these frames
   * only, and a regression outside this set is recorded rather than rejecting.
   */
  anchorFrameNumbers?: number[]
  /** User-confirmed anchor image: the visual reference for how the edit must look. */
  anchorUrl: string
  editPrompt: string
  /**
   * Telemetry only: whether the judged clip came from a fresh generation or a plain
   * v2v pass. Same contract as `strategy`/`genRoute`: NOT part of the storage verdict
   * cache key.
   */
  genMode?: 'new_gen' | 'simple_v2v'
  /**
   * Telemetry only: which generation chain produced the judged clip. Same
   * contract as `strategy`: NOT part of the storage verdict cache key, since the
   * route cannot change the verdict.
   */
  genRoute?: JudgeGenRoute
  /**
   * Set when the judged clip is a regenerated neighbor position (prev/next) rather
   * than cur. A neighbor has no clicked timestamp and no anchor composition of its
   * own, so this selects the neighbor prompt and schema, and re-roles the images:
   * anchorUrl becomes cur's adjacent edited frame and sourceFrameUrl the neighbor's
   * own pre-edit frame at that boundary. Unlike strategy/genRoute this DOES affect
   * the verdict.
   */
  neighborRole?: 'next' | 'prev'
  nonce?: string
  /**
   * Sampled timestamps in the judged clip's own time base, aligned index-for-index
   * with outputFrameUrls. Attribution only: never affects the verdict.
   */
  outputFrameTimestamps?: number[]
  /**
   * Frame extracted from the generated clip at the clicked timestamp, the same one as
   * sourceFrameUrl. Also sent alongside outputFrameUrls, which contains it.
   */
  outputFrameUrl?: string
  /**
   * Frames sampled across the generated clip's affected range, ascending by time,
   * including the clicked frame. When present it selects the multi-frame judgment.
   */
  outputFrameUrls?: string[]
  projectId: string
  /** Pre-edit frame at the anchor timestamp, before generation. */
  sourceFrameUrl: string
  /**
   * Telemetry only: tags the outcome metric so no-op rates split per strategy.
   * Deliberately NOT part of the storage verdict cache key: strategy cannot change
   * the verdict, and keying on it would fork cached verdicts for no reason.
   */
  strategy?: string
  /** Overrides the resolved inpaint_config judge temperature for every call this judgment makes. */
  temperature?: number
  /** Transition the judged clip belongs to. Attribution only. */
  transitionId?: string
}

/** The generation settings actually applied to a verdict, for attribution. */
export interface JudgeEditAppliedResult {
  /** Present only when a cur anchor rejection was re-asked across a pro majority vote. */
  anchorVote?: JudgeAnchorVoteOutcome
  applied: boolean
  checks?: JudgeEditAppliedChecks
  clickedFrameNumber?: number
  /** 1 for a clean verdict, 0.5 when a far-window regression was recorded. */
  confidence?: number
  /** What the pro second opinion did to this verdict; 'none' when it did not run. */
  escalated?: JudgeEscalationOutcome
  failedCheck?: JudgeFailedCheck
  /** Regressions found only on sweep frames outside the anchor window: recorded, never rejects. */
  farRegressedFrameNumbers?: number[]
  frames?: JudgeEditAppliedFrame[]
  reason: string
  regressedFrameNumbers?: number[]
  /** Present only when a temperature was actually sent to the judge completion call. */
  settings?: JudgeEditAppliedSettings
}

export interface JudgeEditAppliedSettings {
  /** Present only when judge.enforce resolved to false. */
  enforce?: boolean
  temperature?: number
}

export type JudgeEscalationOutcome = 'agreed' | 'error' | 'none' | 'overridden'

export type JudgeFailedCheck = 'anchor' | 'applied' | 'held' | 'none'

export type JudgeGenRoute = 'eraser' | 'fflf_split' | 'fflf_split_plus' | 'v2v'

// --- apply-edit ---

export interface ApplyEditClip {
  storeUrl: string
  transitionId: string
  // Generated-clip dims for cover-crop, carried into the apply_transition op
  // (undefined on a cross-run segment cache hit).
  videoHeight?: number
  videoWidth?: number
}

export interface CopyTransitionClipsParams {
  clientId: string
  clips: ApplyEditClip[]
  projectId: string
}

export interface CopyTransitionClipsResult {
  results: { canonicalUrl: string; transitionId: string }[]
}
