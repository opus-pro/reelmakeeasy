import type { CaptionRenderPref } from '../adapters/caption/caption-style'
import { ImagesAndTexts, Texture } from '../template/type'

import { CaptionContent } from './refine-v2-definition'

export type AnimationMode = 'bezier' | 'linear'
export interface Area {
  /** The timestamp relative to the timeline.in of the current segment */
  frameTime: number
  /** Layout type: fill or cover, default is fit */
  layoutType?: 'fill' | 'fit'
  /** Crop mode: linear or bezier curve */
  mode: AnimationMode
  /** Position and size of the crop area */
  position: Position
}

/**
 * Audio content interface - defines specific properties for audio media
 */
export interface AudioContent extends BaseMediaContent {
  /** Resource type identifier - fixed as 'audio' */
  resourceType: 'audio'
}

/** Audio track type alias */
export interface AudioTrack extends BaseTrack<AudioContent> {
  type: 'audio'
}

/**
 * Base content interface - defines the common structure for content
 */
export interface BaseContent {
  /** Unique content identifier */
  id: `content-${string}`
}

/**
 * Base media content interface - defines the common structure for media content
 */
export interface BaseMediaContent extends BaseContent {
  /** Array of crop areas - defines how to crop the original media */
  cropAreas: Area[]
  /** Opacity of the media */
  opacity?: number
  /** Preview source file URI - optional, used for quick preview */
  previewSourceUri?: string
  /** Media source file URI */
  sourceUri: string
  /** Array of target areas - defines where the media is displayed on the canvas */
  targetAreas: Area[]
}

/**
 * Base section interface - defines the common structure for sections
 */
export interface BaseSection<T> extends TimeStamp {
  /** Unique section identifier */
  id: `section-${string}`
  /** Array of segments in the section */
  segments: BaseSegment<T>[]
}

/**
 * Base segment interface - defines the common structure for segments
 */
export interface BaseSegment<T> extends TimeStamp {
  /** Segment content - generic type, can be video, image, audio, etc. */
  content: T
  /** Effects of the segment */
  effects?: Array<
    Timeline & {
      name: 'circle'
    }
  >
  /** Unique segment identifier */
  id: `segment-${string}`
  lineCount?: number
  /** Segment position - optional, used for quick preview */
  position?: Position
  /** Rotation of the media in degrees, -360 ~ 360 */
  rotation?: number
  scale?: number
}

/**
 * Base track interface - defines the common structure for tracks
 */
export interface BaseTrack<T, V = object> {
  /** Unique track identifier */
  id: `track-${string}`
  /** Array of segments in the track */
  segments: Array<BaseSegment<T> & V>
}

// export interface CaptionTrack extends BaseTrack<CaptionTrackSegment> {
export interface CaptionTrack extends BaseTrack<CaptionContent> {
  type: 'caption'
}

/**
 * Duration interface - defines the time range in the original media file
 */
export interface Duration {
  /** End timestamp in the original video (milliseconds) */
  eO?: number
  /** Manually adjusted end timestamp (milliseconds) - optional */
  eOAdj?: number
  /** Start timestamp in the original video (milliseconds) */
  sO?: number
  /** Manually adjusted start timestamp (milliseconds) - optional */
  sOAdj?: number
}
export interface EffectContent extends BaseContent {
  sourceUri: string
}
export interface EffectTrack extends BaseTrack<EffectContent> {
  type: 'effect'
}

/** One fact stamp: a short exact label ("c. 2560 BC"), shown whole for its segment's timeline. */
export interface FactContent extends BaseContent {
  text: string
}

/**
 * A loop short's fact stamps (its storyboard's per-clip `stamp`), one segment per stamp, in
 * order. Facts, not captions: the caption switch never hides them, so they are not a `caption`
 * track. Only the labels and their windows are stored. Their look (PT Serif Bold on a strip in
 * the video's highlight colour, tilted, top right) comes from `TextAdapter.genFactStampTrack`
 * and the caption style the video is drawn in, so a new highlight recolours them.
 */
export interface FactsTrack extends BaseTrack<FactContent> {
  type: 'facts'
}

/**
 * Image content interface - defines specific properties for image media
 */
export interface ImageContent extends BaseMediaContent {
  /** Resource type identifier - fixed as 'image' */
  resourceType: 'gif' | 'image' | 'webp'
}

/** Video & Image track type alias */
export interface MediaTrack
  extends BaseTrack<
    ImageContent | VideoContent,
    {
      loop: number
    }
  > {
  type: 'media'
}

/**
 * Position interface - defines the position and size of elements on the canvas
 * Using percentage-based center coordinate system
 */
export interface Position {
  /**
   * Height percentage - ratio of bounding box height to canvas height
   * Range: [0, 1], where 0 is no height, 1 is full height
   */
  hPct?: number
  /**
   * Width percentage - ratio of bounding box width to canvas width
   * Range: [0, 1], where 0 is no width, 1 is full width
   */
  wPct?: number
  /**
   * Horizontal position percentage - horizontal distance between the center of the
   * bounding box and the center of the canvas
   * Range: [-1, 1], where -1 is far left, 1 is far right
   */
  xPct: number
  /**
   * Vertical position percentage - vertical distance between the center of the
   * bounding box and the center of the canvas
   * Range: [-1, 1], where -1 is top, 1 is bottom
   */
  yPct: number
}
export interface TemplateAssetContent extends BaseContent {
  layoutId: string
  params: Partial<ImagesAndTexts<string, string>>
  targetAreas?: Area[]
  texture?: Texture
}
export interface TemplateAssetTrack extends BaseTrack<TemplateAssetContent> {
  type: 'template-asset'
}

export interface TransitionContent extends BaseContent {
  name:
    | 'transition_blur_zoom_in'
    | 'transition_light_leak'
    | 'transition_saturation'
    | 'transition_spin_zoom_in'
}

export interface TransitionTrack extends BaseTrack<TransitionContent> {
  type: 'transition'
}

/**
 * Timeline interface - defines the time range on the editing timeline
 */
export interface Timeline {
  /** In point time (milliseconds) - start time of the segment on the timeline */
  in: number
  /** Out point time (milliseconds) - end time of the segment on the timeline */
  out: number
}

/**
 * Timestamp interface - combines timeline and duration information
 */
export interface TimeStamp {
  /** Duration information - time range in the original media file */
  duration?: Duration
  /** Timeline information - position on the editing timeline */
  timeline: Timeline
}

/** Track union type - can be video, image, or audio track */
export type Track =
  | AudioTrack
  | CaptionTrack
  | EffectTrack
  | FactsTrack
  | MediaTrack
  | TemplateAssetTrack
  | TransitionTrack

/**
 * Video content interface - defines specific properties for video media
 */
export interface VideoContent extends BaseMediaContent {
  /** Resource type identifier - fixed as 'video' */
  resourceType: 'video'
  volume?: number
}

/**
 * Editing script interface - defines the structure of the entire editing project
 */
export interface VideoScript {
  /**
   * Caption style preference. When present, the render worker uses this value
   * directly. When absent, the render worker falls back to the local default
   * via `getDefaultCaptionRenderPref()`. Kept whole, with the preset extras
   * (`chunking`, Explainer's `strip`): parsing it through
   * `CaptionRenderReferenceSchema` would drop them, and Punch and Explainer
   * would follow the voice and lose their strip.
   */
  captionRenderPref?: CaptionRenderPref
  /** Array of tracks - contains different types of tracks like video, image, audio, etc. */
  tracks: Track[]
}
