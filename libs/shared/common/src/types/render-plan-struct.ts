import { ImagesAndTexts } from '../template/type'

export enum AssetType {
  Audio = 3,
  Empty = 10,
  Filter = 12,
  Gif = 5,
  Image = 1,
  Lottie = 16,
  ManualText = 13,
  SeqImg = 6,
  Silence = 8,
  Text = 4,
  Timeline = 7,
  Unknown = 0,
  Video = 2,
  WaterMark = 9,
  WebP = 11,
}
export enum BackgroundMode {
  blur = 1,
  color = 0,
  image = 2,
}
export enum HorizontalAlign {
  left = 'l',
  middle = 'm',
  right = 'r',
}
export enum KeyFrameInterpolationMode {
  Bezier = 2,
  Init = 0,
  Linear = 1,
}
export enum SegType {
  AeEffect = 'ae-ef',
  Audio = 'a',
  Effect = 'e',
  Lottie = 'lt',
  ManualText = 'mt',
  Text = 't',
  Video = 'v',
}
export enum TrackType {
  Audio = 'a',
  Effect = 'e',
  ManualText = 'mt',
  Text = 't',
  Video = 'v',
}
export enum VerticalAlign {
  bottom = 'b',
  middle = 'm',
  top = 't',
}

/**
 * DLC: Downloadable Content
 */
export interface AnimatedTextSeg extends Omit<CaptionSeg, 'style'> {
  style: AnimatedWordStyle
  /**
   * Preset:SlideLeft
   */
  uri: string
}
export interface AnimatedWordStyle extends WordStyle {
  /**
   * for deep-diver bg color
   */
  animationBgColor?: string
  /**
   * for karaoke text color
   */
  animationColor?: string
}

/**
 * Represents out information about audio.
 */
export interface AudioInfo {
  /**
   * Channels of the audio.
   */
  channels: number

  /**
   * Sample rate of the audio.
   */
  sampleRate: number
}
export interface AudioSeg extends SegBase {
  /**
   * Trim end time of the segment.
   */
  trimEnd?: number

  /**
   * Trim start time of the segment.
   */
  trimStart?: number
  uri: string
  volume?: number
}
export type Background = BackgroundBlur | BackgroundColor | BackgroundImage
export interface CaptionSeg extends SegBase {
  autoScale: boolean
  // for one-line caption
  lineCount: number

  style: WordStyle
  texts: CaptionSegText[]
  type: SegType.Text
}
export interface CaptionSegText extends WordStyle {
  /**
   * for AI highlight
   */
  highlightColor?: string
  in: number
  out: number

  /**
   * Text of the caption.
   */
  t?: string
}
export interface Effect {
  in: number
  isPath: boolean
  out: number
  type: 'ae-ef'
  uri: string
}
export interface EffectSeg extends SegBase {
  /**
   * json for string
   * fade json: FadeEffect
   * zoom json: ZoomEffect
   */
  effectSrc?: string
}
export interface FadeEffect {
  alpha: KeyFrame<number>[]
  // name
  nm: 'fade'
}
export interface KeyFrame<T> {
  /**
   * Frame time
   */
  ft: number

  /**
   * Mode 0: init  1: linear, 2: bezier
   */
  mode: KeyFrameInterpolationMode

  /**
   * Value
   */
  v: T
}
export interface LottieSeg extends SegBase {
  effects?: Effect[]
  layoutId: string
  /** for lottie dynamic params */
  params?: ImagesAndTexts<string, string>
  volume?: number
}
export type PlanDiff = {
  additions: Array<PlanDiffNode>
  deletions: Array<PlanDiffNode>
  updates: Array<Omit<PlanDiffNode, 'idx'>>
}
export type PlanDiffNode = {
  /** nodeId */
  id: string
  /** index in parent node */
  idx: number
  path: string
}
/**
 * Represents a render template.
 */
export interface RenderPlan {
  audioInfo?: AudioInfo & WithId
  defaultFontGzipPath?: string
  id?: string
  rootDir?: string
  tracks: Track<Seg>[]
  /**
   * for trim
   * TODO: remove after editor 2.0
   */
  trimHead?: number
  /**
   * for trim
   * TODO: remove after editor 2.0
   */
  trimTail?: number
  videoInfo: VideoInfo & WithId
  watermark?: Array<Watermark & WithId>
}
export type Seg = AudioSeg | CaptionSeg | EffectSeg | LottieSeg | TextOverlaySeg | VideoSeg

/**
 * Represents a segment.
 */
export interface SegBase {
  /**
   * Anchor int the layer. -1.0~1.0
   */
  anchor?: VKF<XyPair>

  /**
   * Type of the asset in the segment, 0: undefined, 1: image, 2: video, 3: audio, 4: text, 5: gif, 6: seqImg, 7: timeline
   */
  assetType?: AssetType

  /**
   * Unique identifier for the segment.
   */
  id: string

  /**
   * In time of the timeline.
   */
  in: number

  /**
   * Minimum scale of the font. 0~1.0
   */
  minScale?: number

  /**
   * Opacity int the layer. 0~1.0
   */
  opacity?: VKF<number>

  /**
   * Out time of the timeline.
   */
  out: number

  /**
   * Position int the layer. -1.0~1.0
   */
  position?: VKF<XyPair>

  /**
   * Rotate int the layer. -360~360
   * TODO: compare with Premiere Pro
   */
  rotate?: VKF<number>

  /**
   * Scale int the layer. 0~Inf
   */
  scale?: VKF<XyPair>

  /**
   * Segment type, 0: image, 1: video, 2: audio, 3: text
   */
  type: SegType

  /**
   * Source path to the segment.
   * file:///path/to/file
   * https://xxxxx.com/path/to/file
   * base64://
   */
  uri?: string
}
export interface TextOverlaySeg extends SegBase {
  // for auto wrap
  maxWidth: number
  style: WordStyle

  texts: TextOverlaySegText[]
  type: SegType.ManualText
}
export interface TextOverlaySegText extends WordStyle {
  in: number
  out: number
  /**
   * Text of the text overlay.
   */
  t: string
}
export type Track<T extends SegBase> = AudioTrack<T> | TrackBase<T>

/**
 * Represents a track.
 */
export interface TrackBase<T> {
  /**
   * In of the track.
   */
  id: string

  /**
   * Represents a segment.
   */
  segs: T[]

  /**
   * Track type, 0: video, 1: audio, 2:text
   */
  type: TrackType
}

/**
 * Represents out information about a video.
 */
export interface VideoInfo {
  /**
   * Frame rate of the video.
   */
  frameRate: string

  /**
   * Height of the video.
   */
  height: number

  /**
   * Width of the video.
   */
  width: number
}

/**
 * Image included; gif included
 */
export interface VideoSeg extends SegBase {
  /**
   * Background
   */
  bg?: Background

  /**
   * Crop point.
   */
  cropPosition: Array<KeyFrame<[number, number]>>

  /**
   * Crop rotate of the segment. -360~360
   */
  cropRotate?: VKF<number>

  /**
   * Crop size.
   * [width, height]
   */
  cropSize: Array<KeyFrame<[number, number]>>

  /**
   * Loop of the segment. 0: no loop, 1: loop
   */
  loop: number
  /**
   * Speed of the segment.
   */
  speed?: number

  /**
   * Trim end time of the segment.
   */
  trimEnd?: number

  /**
   * Trim start time of the segment.
   */
  trimStart?: number

  /**
   * Volume of the segment. 0~1.0
   */
  volume?: number
}

/**
 * Value of key frame
 */
export type VKF<T extends number | XyPair> = Array<KeyFrame<T>> | T
export interface Watermark
  extends Pick<VideoSeg, 'assetType' | 'in' | 'opacity' | 'position' | 'uri'> {
  out?: number
  size: VKF<XyPair>
}
export interface WithId {
  id?: string
}

/**
 * Caption frame
 * - this is a long
 * - sentence
 */
export interface WordStyle {
  /**
   * Background color of the caption.
   */
  bgColor?: string

  /**
   * border radius of the caption.
   */
  borderRadius?: number

  /**
   * Font color of the caption.
   */
  fontColor?: string

  /**
   * Font family of the caption.
   */
  fontFamily?: string

  /**
   * Gzip font path of the caption.
   */
  fontGzipPath?: string

  /**
   * Font id of the caption.
   */
  fontId?: string

  /**
   * Font name of the caption.
   */
  fontName?: string

  /**
   * Font paths of the caption.
   */
  fontPaths?: string[]

  /**
   * Font scale of the caption.
   */
  fontScale?: number

  /**
   * Font size of the caption.
   */
  fontSize?: number

  /**
   * Font weight of the caption. 100 - 900;
   */
  fontWeight?: number

  /**
   * horizontal align of the caption
   */
  hAlign?: HorizontalAlign

  /**
   * Italic of the caption.
   */
  italic?: boolean

  /**
   * Letter space of the caption.
   */
  letterSpace?: number

  /**
   * Line space of the caption.
   */
  lineSpace?: number

  /**
   * Outline color of the caption.
   */
  outlineColor?: string

  /**
   * Outline width of the caption.
   */
  outlineWidth?: number

  /**
   * Stroke color of the caption.
   */
  strokeColor?: string

  /**
   * Stroke width of the caption.
   */
  strokeWidth?: number

  /**
   * Text height of the caption.
   */
  textH?: number

  /**
   * Text width of the caption.
   */
  textW?: number

  /**
   * Underline of the caption.
   */
  underline?: boolean

  /**
   * vertical align of the caption.
   */
  vAlign?: VerticalAlign
}
export type XyPair = [number, number]
export interface ZoomEffect {
  nm: 'zoom'
  scale: KeyFrame<number>[]
}

interface AudioTrack<T extends SegBase> extends TrackBase<T> {
  volume: Array<KeyFrame<number>>
}
interface BackgroundBlur {
  mode: BackgroundMode.blur
  value: number
}
interface BackgroundColor {
  color: string
  mode: BackgroundMode.color
}
interface BackgroundImage {
  mode: BackgroundMode.image
  uri: string
}
