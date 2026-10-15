import type { AspectRatio, GenerationResolution } from '@reelmakeeasy/common/media/types'

export type LongTakeTextSeverity = 'minor' | 'moderate' | 'none' | 'severe'

/**
 * Static-hold fallback used when `generateLongTakeTransitionVideo` exhausts
 * its retry budget. Synthesizes a crossfade between the from/last keyframes
 * so a single failing transition does not kill the whole workflow.
 */
export interface BuildStaticHoldTransitionActivityParams {
  aspectRatio?: AspectRatio
  durationSeconds: number
  endMs: number
  firstFrameUri: string
  fromShotId: string
  /**
   * Per-project generation-resolution setting. When a video
   * resolution resolves, both keyframes are scaled to it before the xfade so
   * static-hold clips match the model-generated clips' pixel class (and
   * mismatched keyframe dims can no longer break xfade).
   */
  generationResolution?: GenerationResolution
  lastFrameUri: string
  /** Org id that owns the project. */
  orgId?: string
  /** Error message from the primary activity, for fallback-failure telemetry. */
  originalError: string
  projectId: string
  /** Original prompt; persisted on the output item for debug parity. */
  prompt: string
  startMs: number
  toShotId: string
  transitionId: string
  /**
   * Configured transition model (debugSettings/API), if any. Used only to
   * clamp the static-hold pixel class to the same cap the model-generated
   * clips were clamped to; absent => default model, like transitions.
   */
  transitionVideoModel?: string
  userEmail?: string
  userId?: string
}

export type BuildStaticHoldTransitionActivityResult = LongTakeTransitionVideoItem

/**
 * Photo pan/zoom transition: when a realistic-style news shot's
 * keyframe IS the raw article photograph (photo-passthrough), the clip is a
 * gentle ffmpeg zoom over the untouched photo -- never an i2v regeneration
 * that would alter the image. When the transition lands on a different
 * keyframe, the pan/zoom crossfades into it at the tail.
 */
export interface BuildPhotoPanZoomTransitionActivityParams {
  aspectRatio?: AspectRatio
  durationSeconds: number
  endMs: number
  firstFrameUri: string
  fromShotId: string
  /** Per-project generation-resolution setting; same pixel-class rules as static-hold. */
  generationResolution?: GenerationResolution
  lastFrameUri: string
  /** Org id that owns the project. */
  orgId?: string
  projectId: string
  /** Original prompt; persisted on the output item for debug parity. */
  prompt: string
  startMs: number
  toShotId: string
  transitionId: string
  /** Configured transition model, used only to clamp the pixel class. */
  transitionVideoModel?: string
  userEmail?: string
  userId?: string
}

export type BuildPhotoPanZoomTransitionActivityResult = LongTakeTransitionVideoItem

export interface LongTakeTransitionAttemptRecord {
  /**
   * Model that actually produced this attempt's clip. Attempts can differ (the
   * record layer may fall back mid-flight), and the quality fallback may select
   * an earlier attempt, so the chosen clip's model must travel with it.
   */
  actualModel: string
  bytesPerFrame?: number
  isBlackScreen: boolean
  path: string
  prompt: string
  severity: LongTakeTextSeverity
}

export interface LongTakeTransitionPlanItem {
  beatBoundarySeconds?: number
  durationSeconds: number
  endMs: number
  firstFrameUri: string
  fromAudio?: string
  fromKeyframePrompt?: string
  fromPrompt?: string
  fromShotId: string
  globalScript?: string
  /**
   * Ordered waypoint keyframes between the merged sub-segments of a Seedance
   * 2.5 merged transition; forwarded to the activity as @Image3+
   * references.
   */
  intermediateKeyframeUris?: string[]
  /**
   * Absent for a Story Mode 3.0 `cut` clip, which is generated
   * i2v-only from its opening frame; the cut itself is made by timeline
   * adjacency at render. Always set on every V2 path.
   */
  lastFrameUri?: string
  prompt: string
  referenceAssetIds?: string[]
  /** Marks a Seedance 2.5 clip merged from adjacent bridges. */
  seedance25MergedSegment?: boolean
  shouldLipSync?: boolean
  /** If true, use prompt as-is and skip any model-specific prompt rewrite (e.g. seedance2 rewrite) */
  skipPromptRewrite?: boolean
  startMs: number
  styleText?: string
  toAudio?: string
  toKeyframePrompt?: string
  toPrompt?: string
  toShotId: string
  transitionId: string
}

export interface LongTakeTransitionPromptRefinementInput {
  durationSeconds: number
  firstFrameUri: string
  fromKeyframePrompt: string
  fromPrompt: string
  lastFrameUri: string
  styleText?: string
  toKeyframePrompt: string
  toPrompt: string
  transitionId: string
  transitionType?: LongTakeTransitionType
}

export type LongTakeTransitionType = 'horizontal' | 'vertical'

export interface LongTakeTransitionVideoItem {
  /** Non-lip-sync version of the same generated transition, when a lip-sync variant exists. */
  baseVideoUri?: string
  bytesPerFrame?: number
  endMs: number
  fromShotId: string
  isBlackScreen?: boolean
  /** The clip's actual last frame (store://), when captured so the next chained clip can start from it. */
  lastFrameUri?: string
  /** Whether the editor preview should default to the lip-sync variant. */
  lipSyncEnabled?: boolean
  /** Lip-sync version of the same generated transition, when available. */
  lipSyncVideoUri?: string
  prompt: string
  qualityCheck: { hasGibberish: boolean; severity: LongTakeTextSeverity }
  /** Whether this timeline segment should be lip-synced after render/upscale. */
  shouldLipSync?: boolean
  startMs: number
  toShotId: string
  transitionId: string
  /**
   * The transition video model resolved for this transition at generation time
   * (API/debug override, else the default). Persisted so the
   * workflow can report the actually-used model on completion -- under the server-side
   * rollout the workflow-level param is empty, so this is the only source of truth.
   */
  transitionVideoModel?: string
  /**
   * True when the primary transition-video generation activity exhausted its
   * retry budget (typically a deterministic input failure -- e.g. ffmpeg
   * retime stuck on a malformed mp4) and the workflow fell back to a
   * static-hold crossfade synthesized from the from/last keyframes.
   * Persisted so downstream consumers (rendering, telemetry, debug UI) can
   * distinguish degraded transitions from real generations.
   */
  /** True when this transition was generated via the BytePlus asset library path. */
  usedAssetLibrary?: boolean
  usedFallback?: boolean
  /**
   * Actual generated clip dimensions in px. The model snaps to its own
   * resolution grid, so at 480p these can be slightly off 9:16 (e.g. 496x864).
   * Render uses them to crop-to-fill instead of letterboxing. Absent for the
   * asset-library and static-hold paths (which fall back to full-frame).
   */
  videoHeight?: number
  videoUri: string
  videoWidth?: number
}
