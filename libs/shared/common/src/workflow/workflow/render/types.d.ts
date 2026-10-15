import type { ReqContext } from '@shared/types/api/req-ctx'

import type { AspectRatio } from '../../../media/types'
import { RenderPlan } from '../../../types/render-plan-struct'
import { VideoScript } from '../../../types/video-script'
import type { TaskRequest, TaskResponse, WorkflowDef } from '../../types'

export type RenderContext = {
  /** Carried from the parent context only; activities run on the service's own task queue (see AbstractService.getTaskQueue). */
  cluster?: string
  projectId: string
  requestContext?: ReqContext
  userEmail: string
  userId: string

  videoId: string
}

export type RenderPreviewResult = {
  errorCode?: number
  imageUri: string
  message?: string
}

export type RenderVideoParams = {
  /** Optional output aspect ratio */
  aspectRatio?: AspectRatio

  /** Name of the article's author */
  author?: string

  /** Optional background image path */
  backgroundImage?: string

  /** Optional background music path */
  backgroundMusic?: string

  /** Optional path to the body image */
  bodyImage?: string

  /** Additional configuration options */
  config?: {
    /** Optional Logo image URL or label */
    logoImage?: string
  }

  /** The main body text to display */
  content?: string

  /** Duration of the animation in seconds */
  durationInSeconds?: number

  /** Whether to enable captions in the rendered video */
  enableCaption?: boolean

  /** Output frame rate in fraction format (e.g., "24/1"). Falls back to VIDEO_FRAME_RATE if not set. */
  fps?: string

  /** Time in seconds when the highlight animation should start */
  highlightStartTime?: number

  /**
   * Explicit output canvas size. When set, overrides the
   * aspect-ratio-derived default so the render can produce at a low resolution
   * (e.g. 480p) for Topaz upscaling. Absent => the standard 1080p canvas.
   */
  outputResolution?: { height: number; width: number }

  /** Publication or post date */
  postDate?: string

  /** Pre-prepared render plan (bypasses videoScript processing in activity) */
  preparedRenderPlan?: RenderPlan

  previewTime?: number

  renderPlan?: RenderPlan

  /** Segment index for tracking (used in chunked rendering) */
  segmentIndex?: number

  /** Time range for this segment in milliseconds [start, end] */
  segmentTimeRange?: [number, number]

  /** Article Source text */
  source?: string

  /** The title of the article */
  title?: string

  /** Total segments count (used in chunked rendering) */
  totalSegments?: number

  /** The URL of the article */
  url?: string

  /**
   * @obsolete should be removed after AO_RENDER_PARAM_USE_VS_URI_ONLY = 'ao_render_param_use_vs_uri_only' is on
   *  and all legacy render workers are off.
   */
  videoScript?: VideoScript

  /** store address of video script JSON; used to avoid large workflow payloads. Takes precedence over videoScript when both are set.
   * Use `uploadVideoScriptForRender` to upload the json to storage.
   */
  videoScriptUri: string
}

// legacy types
export type { RenderPreviewResult as RenderPreviewResponse, RenderVideoParams as RenderReq }

export type RenderVideoResult = {
  errorCode?: number
  message?: string
  videoUri: string
}

export type RenderVideoWorkflowDef = WorkflowDef<
  'RenderVideo',
  TaskRequest<RenderVideoParams, RenderContext>,
  TaskResponse<RenderVideoResult>
>

// ==================== Concat Video Types ====================

export type ConcatContext = {
  /** Batch ID for tracking */
  batchId: string
  cluster?: string
  projectId: string
  requestContext?: ReqContext
  userEmail: string
  userId: string
}

export type ConcatVideoParams = {
  audioUri: string
  outputFileName?: string
  videoUris: string[]
}

export type ConcatVideoResult = {
  errorCode?: number
  message?: string
  /** store address of the concatenated video */
  videoUri: string
}

// ==================== Chunked Render Video Types ====================

export type RenderVideoChunkedWorkflowDef = WorkflowDef<
  'RenderVideoChunked',
  TaskRequest<RenderVideoChunkedParams, RenderVideoChunkedContext>,
  TaskResponse<RenderVideoChunkedResult>
>

type RenderVideoChunkedContext = {
  projectId: string
  userEmail: string
  userId: string
}

type RenderVideoChunkedParams = {
  /** Chunk duration in milliseconds (default: 60000ms = 1 minute) */
  chunkDurationMs?: number
  /** Minimum chunk duration in milliseconds (default: 30000ms = 30 seconds) */
  minChunkDurationMs?: number
  /**
   * Canvas/encode options forwarded verbatim into EVERY chunk's RenderVideo
   * payload: the 4K composite renders on an explicit 2160p canvas
   * via `outputResolution`, and omitting these would silently produce
   * default-1080p chunks. Script routing fields are NOT accepted here - the
   * chunk fan-out owns those.
   */
  renderOptions?: Pick<
    RenderVideoParams,
    'aspectRatio' | 'enableCaption' | 'fps' | 'outputResolution'
  >
  /** Total video duration in milliseconds */
  totalDurationMs: number
  /**
   * Type of video being rendered. Used in the child render / concat workflow
   * ids and logs only. 4k-clean / 4k-composite are the 4K export pipeline's
   * stage-B and stage-D renders.
   */
  type: '4k-clean' | '4k-composite' | 'final-video' | 'watermark-video'
  /** Inline video script; prefer videoScriptUri to avoid large workflow payloads. */
  videoScript?: VideoScript
  /** store address of video script JSON; takes precedence over videoScript when both are set. */
  videoScriptUri?: string
}

type RenderVideoChunkedResult = {
  /** Number of chunks rendered */
  chunkCount: number
  errorCode?: number
  message?: string
  /** store address of the final merged video */
  videoUri: string
}
