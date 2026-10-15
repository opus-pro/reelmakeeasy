/**
 * Shared Media Types
 *
 * Types used for media generation workflows (Text-to-Video/Image).
 * Shared between API and editor-worker.
 */

/**
 * Aspect ratio options for asset generation
 */
export type AspectRatio = '1:1' | '9:16' | '16:9'

/**
 * Requested video-generation resolution. Controls only the pixel
 * class video models generate at; the final render canvas stays 1080p.
 * Absent => current behavior (models default to 720p).
 */
export type VideoResolution = '480p' | '720p' | '768p' | '1080p'

/**
 * Requested image-generation size tier. libs/llm's image adapters
 * map it to each model's own vocabulary (a resolution enum or WxH pixels).
 * Absent => the adapter's default.
 */
export type ImageSizeTier = '1K' | '2K' | '4K'

/**
 * Topaz enhancement-mode selector. Mirrors the Topaz Video API
 * `filters[].auto` field: 'Auto' = parameter estimation with no customization
 * (today's behavior when no params are sent), 'Manual' = all parameters set
 * absolutely, 'Relative' = auto-estimated values with the given weights added.
 */
export type TopazAutoMode = 'Auto' | 'Manual' | 'Relative'

/**
 * Per-model Topaz filter tuning parameters. Field names and ranges
 * mirror the Topaz Video API `filters[]` entry for Proteus-family models
 * (numeric params -1..1, `prenoise` 0..0.1). All fields optional: an absent
 * field is simply not sent, so Topaz falls back to its own estimation for that
 * axis. Sent alongside `model` inside the same `filters[]` object.
 */
export interface UpscaleFilterParams {
  auto?: TopazAutoMode
  blur?: number
  compression?: number
  details?: number
  halo?: number
  noise?: number
  preblur?: number
  prenoise?: number
}

/**
 * Topaz upscale profile. When present on a resolved generation
 * profile, the initial-generation path renders the final video at
 * `sourceResolution` (the cost lever) and AI-upscales it to `targetResolution`
 * via the configured Topaz model; the result is then scaled to the 1080p canvas
 * constant so delivered dimensions are identical to today (invisible cost
 * reduction). Absent => no upscaling. `model` is a Topaz model slug (default
 * 'prob-4' = Proteus), swappable via dynamic config.
 */
export interface Upscale {
  /**
   * Ordered Topaz model slugs to try after `model` fails. The upscale
   * activity runs `[model, ...fallbackModels]` in order (e.g. Proteus 'prob-4'
   * -> Rhea 'rhea-1') and delivers the first success; if every model fails it
   * fails-closed to the raw naive scale. Absent/empty => single-model behavior
   * (identical to today). Config-driven via the dynamic config.
   */
  fallbackModels?: string[]
  /**
   * Topaz filter tuning parameters keyed by MODEL SLUG. Keyed per
   * model so each attempt in the `[model, ...fallbackModels]` chain sends only
   * the params meant for the model that runs (e.g. a Proteus 'Relative' preset
   * must never reach a 'rhea-1' fallback job). A model with no entry runs with
   * no params -- Topaz 'Auto', identical to today. Absent => no model sends
   * params (current behavior). Config-driven via the dynamic config.
   */
  filterParams?: Record<string, UpscaleFilterParams>
  model: string
  sourceResolution: VideoResolution
  targetResolution: VideoResolution
}

/**
 * Per-project generation-resolution settings, resolved once per
 * project (API option > defaults) and pinned so
 * every keyframe/transition in a project uses one consistent pixel class.
 */
export interface GenerationResolution {
  /**
   * Generation resolution for the EDITOR re-render path. The editor
   * generates natively at this resolution and never runs Topaz, so editing
   * adds zero upscaler latency. Absent => falls back to current behavior.
   */
  editorVideoResolution?: VideoResolution
  imageSize?: ImageSizeTier
  /**
   * Topaz upscale profile for the initial-generation path. Absent =>
   * no upscaling (current behavior). Read from the dynamic config only.
   */
  upscale?: Upscale
  videoResolution?: VideoResolution
}

/**
 * Narrative context retrieved from storyboard.json
 * Provides the "soul" of the shot - why it exists in the story.
 */
export interface NarrativeContext {
  /** Scene visual description */
  sceneDescription: string
  /** Voice over text for the scene */
  sceneVoiceOver: string
  /** Original shot visual description */
  shotDescription: string
  /** Voice over text for the shot */
  shotVoiceOver: string
  /** Full script for overall story context */
  wholeScript: string
}

/**
 * Parameters for asset generation workflow
 * Used as input to GenerateAssetWorkflow
 */
export interface GenerateAssetParams {
  /** Video duration in seconds (4-8s). Only applies to videos. Defaults to 5s */
  duration?: number
  /**
   * Resolved per-project selected image model id. Set only when the
   * image-model-selector gate is enabled for the org and the project has a
   * validated selection; undefined => existing default generation path.
   */
  imageModel?: string
  /** Narrative context for context-aware regeneration */
  narrativeContext?: NarrativeContext | null
  /** Org id used to gate and validate the selected image model */
  orgId?: string
  /** Project ID */
  projectId: string
  /** Generation prompt (user's change request) */
  prompt: string
  /** Aspect ratio: '1:1', '16:9', or '9:16' */
  ratio?: AspectRatio
  /** Optional URL of reference image/video (Visual Anchor) */
  referenceUrl: string
  /** Scene ID for context lookup */
  sceneId: string
  /** Shot ID for context lookup */
  shotId: string
  /** Asset type: 'image' or 'video'. Defaults to 'video' if not specified */
  type?: 'image' | 'video'
  /** User email for tracking */
  userEmail?: string
  /** User ID for tracking */
  userId?: string
}

/**
 * Result of asset generation workflow
 */
export interface GenerateAssetResult {
  /** Error category if generation failed */
  errorCategory?: string
  /** Error message if generation failed */
  errorMessage?: string
  /** store path of generated asset */
  fileUri: string
  /** store path of preview thumbnail (videos only) */
  previewThumbnail?: string
}

// ============================================================================
// SSE Event Types for Async Asset Generation (Unified State Model)
// ============================================================================

/**
 * Workflow status - the high-level state of the asset generation
 */
export type AssetWorkflowStatus =
  | 'completed'
  | 'failed'
  | 'processing'
  | 'queued'
  | 'waiting_for_selection'

/**
 * Progress stage - the current step within 'processing' status
 * Used for granular progress tracking during generation
 */
export type AssetProgressStage =
  | 'downloading'
  | 'generating'
  | 'started'
  | 'synthesizing'
  | 'uploading'

/**
 * Progress phase - the high-level phase of video generation
 * 'keyframe': Generating keyframe candidates for user selection
 * 'video': Generating final video after user selected a keyframe
 */
export type AssetProgressPhase = 'keyframe' | 'video'

/**
 * Keyframe candidates produced during Human-in-the-Loop generation.
 * URIs are typically `store://...` so they can be resumed safely across worker restarts.
 */
export interface AssetKeyframeCandidates {
  /** Candidate last-frame images for video generation */
  lastFrame: string[]
}

/**
 * Unified Asset State - Single Source of Truth for SSE Events
 *
 * This is a self-contained snapshot of the asset generation state.
 * Each SSE event contains the complete current state, enabling:
 * - Idempotent handling: `setState(event.data)` - no merging needed
 * - State rehydration: Works for both initial connect and reconnect
 * - Simplified frontend logic: One event type to handle
 */
export interface AssetState {
  /** Error information (present when status === 'failed') */
  error?: {
    /** Error category/code for tracking */
    code: string
    /** Human-readable error message */
    message: string
  }

  /**
   * Keyframe candidates (present when status === 'waiting_for_selection')
   * Used by frontend to render a selection UI.
   */
  keyframeCandidates?: AssetKeyframeCandidates

  /** Progress information (present when status === 'processing') */
  progress?: {
    /** Human-readable message */
    message?: string
    /** Progress percentage (0-100) */
    percent: number
    /** High-level phase: 'keyframe' or 'video' */
    phase?: AssetProgressPhase
    /** Current processing stage */
    stage: AssetProgressStage
  }

  /** Result information (present when status === 'completed') */
  result?: {
    /** store path of generated asset */
    fileUri: string
    /** store path of preview thumbnail (videos only) */
    previewThumbnail?: string
  }

  /** Current workflow status */
  status: AssetWorkflowStatus

  /** Timestamp for ordering events (prevents stale updates) */
  updatedAt: number
}

/**
 * SSE Update Event - The only event type needed
 * Contains a complete state snapshot
 */
export interface AssetUpdateEvent {
  data: AssetState
  type: 'update'
}

/**
 * Channel key prefix for asset generation SSE
 * Full key format: `asset-gen:{workflowId}`
 */
export const ASSET_SSE_CHANNEL_PREFIX = 'asset-gen'

/**
 * Generate SSE channel key for asset generation
 */
export function getAssetSSEChannelKey(workflowId: string): string {
  return `${ASSET_SSE_CHANNEL_PREFIX}:${workflowId}`
}

// ============================================================================
// Workflow Query Types (for the workflow query handler)
// ============================================================================

/**
 * Progress state returned by the workflow query
 * Maps to AssetState for SSE broadcasting
 */
export interface AssetWorkflowProgress {
  /** Error category if failed */
  errorCategory?: string
  /** Error message if failed */
  errorMessage?: string
  /** store path of generated asset (only when completed) */
  fileUri?: string
  /** Keyframe candidates (when waiting for user selection) */
  keyframeCandidates?: AssetKeyframeCandidates
  /** store path of preview thumbnail (videos only, when completed) */
  previewThumbnail?: string
  /** Progress message */
  progressMessage?: string
  /** Progress percentage (0-100) */
  progressPercent?: number
  /** High-level phase: 'keyframe' or 'video' */
  progressPhase?: AssetProgressPhase
  /** Current progress stage */
  progressStage?: AssetProgressStage
  /** Multiple results when a workflow regenerates more than one transition */
  results?: Array<{ fileUri: string; transitionId: string }>
  /** Current workflow status */
  status: AssetWorkflowStatus

  /** store path of generated keyframe thumbnail (when completed) */
  thumbnailStorePath?: string
}

/**
 * Query name for asset generation progress
 * Must match the query name defined in workflow
 */
export const ASSET_PROGRESS_QUERY_NAME = 'getAssetProgress'

// ============================================================================
// Legacy Types (Deprecated - kept for backward compatibility)
// ============================================================================
