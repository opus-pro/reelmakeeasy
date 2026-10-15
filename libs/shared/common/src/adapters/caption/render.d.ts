import { CenterPercentageAreaPosition, OverlayFrameBase } from './refine'
import { CaptionAnimationName } from './render.zod'

export type AudioMaskStyle = 'Bleep' | 'Mute' | 'NotProcessing'
export type BrandKitResource = {
  createdAt: string
  name: string
  orgId: string
  resourceId: string
  status: string
  storagePath: string
  storageSize: string
  type: MediaResourceType
  updatedAt: string
  userId: string
}
export type BrollConfig = {
  enabled: boolean
  types: BrollSource[]
}
export type BrollSource = 'genAI' | 'stock'
export type CanvasStyle = {
  height: number
  left: number
  scaleX: number
  scaleY: number
  top: number
  width: number
}
export type CaptionCustomStyle = {
  rect?: Omit<CenterPercentageAreaPosition, 'defaultRatioType'>
  scale?: number
}
export type CaptionMaskStyle = 'Asterisks' | 'Dashes'
export type CaptionPosition = 'auto' | 'bottom' | 'custom' | 'middle' | 'top'
export type CurseWordsConfig = Partial<{
  audioMaskStyle: AudioMaskStyle
  captionMaskStyle: CaptionMaskStyle
  enabled: boolean
  libId: string
}>
/**
 *******************************************************************************
 * caption-animation/types.ts
 *******************************************************************************
 */

export type IntroOutroMediaResource = MediaTrackResource
/**
 *******************************************************************************
 * render.d.ts
 *******************************************************************************
 */
/**
 * layoutAspectRatio
 * - portrait: 9:16 [default]
 * - square: 1:1
 * - landscape: 16:9
 * - four_five: 4:5
 */
export type LayoutAspectRatioType = 'four_five' | 'landscape' | 'portrait' | 'square'

/**
 * Media Resource
 * for media track, it contains basic info about media resource
 * usually under track => section => content
 */
export type MediaResource<T> = BrandKitResource & { extra?: T }

// Media
export type MediaResourceType = 'CustomizedFont' | 'UploadMedia'
export type MediaTrackResource = MediaResource<{
  duration?: number
  previewPath: string
  resourceType: 'audio' | 'image' | 'video'
  thumbnailHeight: number
  thumbnailPath: string
  thumbnailWidth: number
  waveformPublicUrl?: string
}>
export type QuickStartConfig = {
  bRollParams?: {
    // Maximum number of B-Rolls to generate. If not specified, the generator
    // sets its own default limit before starting B-Roll generation.
    maxNumber?: number
    type: BrollSource
  }

  enableBonusClip?: boolean

  enableBRoll: boolean
  enableRemoveFillerWords: boolean

  enableRemovePauses: boolean
  enableVoiceEnhancement: boolean

  enableVoiceover: boolean
  // Currently only used for caption only quickstart,
  // broll and voiceover cannot be enabled at the same time.
  skipReframe?: boolean
  voiceoverParams?: {
    narrativeTone: string
    speaker: string
    userInput?: string
    volume: number
    voType: '1' | '3'
  }
}
export type RemoveFillerWordConfig = {
  enabled: boolean
}
export type RemovePauseConfig = {
  enabled: boolean
  pauseDuration?: number
}

export type RenderPreference = {
  broll?: BrollConfig
  brollTrigger?: BrollTrigger
  captionAnimation?: {
    bgColor?: string
    highlightColor?: string
    /** '' is for off */
    name: CaptionAnimationName
  }
  captionCustomStyle?: CaptionCustomStyle
  captionPosition?: CaptionPosition
  curseWordsConfig?: CurseWordsConfig
  // VisualOptimization
  disableAsd?: boolean
  disableFillLayout?: boolean
  disableFitLayout?: boolean

  disableScreenOverlay?: boolean
  emojiStyle?: {
    pos?: OverlayFrameBase['position']
    rect?: CenterPercentageAreaPosition
    scaleX?: number
    scaleY?: number
  }

  /******************************
   *  BELOW ARE ALL DEPRECATED  *
   ******************************/
  enableAutoLayout: boolean
  // Editor 2.2
  enableAutoTransition?: boolean
  // Deprecated
  enableBroll?: boolean
  // -->overlay/caption
  enableCaption: boolean
  enableCaptionAnimation?: boolean
  // Deprecated
  enableCrop: boolean
  // -->overlay/emoji
  enableEmoji: boolean
  // Deprecated
  enableFillLayout: boolean // 1 person

  // Deprecated
  enableFitLayout: boolean // n people
  enableFourLayout: boolean // 4 people

  enableGameLayout?: boolean // 1 person, 1 screen, 3:7
  /** highlighting for keywords */
  enableHighlight: boolean

  /**
   * layout settings
   */
  enableScreenLayout: boolean

  // Deprecated use disableScreenOverlay
  enableScreenOverlay?: boolean
  enableSpeakerDetection?: boolean
  // Deprecated
  enableSplitLayout: boolean // 2 people

  enableThreeLayout: boolean // 3 people
  /** convert all char to uppercase */
  enableUppercase: boolean
  // Deprecated, not used anymore, should be always false */
  enableVisualHook: boolean
  enableVoiceEnhancement?: boolean
  /**
   * overlays
   * - captions
   * - emoji
   * - B-Roll
   * - screen overlays
   * - watermark
   */
  /** Watermark overlay, rendered after 3 seconds of playback */
  enableWatermark: boolean
  faceDetectFps?: number
  /**
   * crop ratio for fit layout
   * - default: no crop, keep full content show
   * - 4:3
   * - 1:1
   */
  fitLayoutCropRatio: '1:1' | '4:3' | ''

  font: {
    color: string
    family: string
    id?: string
    name?: string
    numericalSize?: number
    // storage path
    path?: string
    shadow: {
      blur: number
      color: string
      enabled: boolean
      /** use words' highlight color instead of shadow color */
      useWordHighlightColor?: boolean
      x: number
      y: number
    }
    size?: 'Large' | 'Middle' | 'Small'
    stroke: {
      color: string
      enabled: boolean
      width: number
    }
    style: Array<'italic' | string>
    textDecoration: '' | 'line-through' | 'underline'
    type?: 'CustomizedFont' | 'System'
  }

  highlightColor: {
    primary: string
    secondary: string
  }
  intro?: IntroOutroMediaResource
  /**
   * layoutAspectRatio
   * - portrait: 9:16 [default]
   * - square: 1:1
   * - landscape: 16:9
   */
  layoutAspectRatio?: LayoutAspectRatioType
  lineCount?: number
  outro?: IntroOutroMediaResource
  // Quick Start
  quickstartConfig?: QuickStartConfig
  /******************************
   *   NOT IN BRAND TEMPLATE    *
   *     PASSED BY FRONTEND     *
   ******************************/
  /**
   * classify faces into reals and fakes, remove the fakes from default layout
   */
  reduceFakeFace?: boolean
  /**
   * @deprecated Not used since 2024-08-29
   * Turbo Refine: reduce scene detect, reduce face detect, skip MovingSpeaker and ASD
   */
  // Deprecated
  refineTurboMode?: boolean
  removeFillerWord?: RemoveFillerWordConfig
  removePause?: RemovePauseConfig
  /**
   * Skip Adobe when render
   */
  renderSkipAdobe?: boolean
  /**
   * Scene Detect Threshold, bigger means less scenes
   */
  sceneDetThresh?: number
  // Deprecated move to screenOverlays
  screenOverlay?: StoredObjectMeta | null
  // Deprecated move to screenOverlays
  screenOverlayFileId?: null | string
  screenOverlays?: Array<{
    object: StoredObjectMeta
    rect?: CenterPercentageAreaPosition
    style?: CanvasStyle
    // users can adjust the timeline in the editor.
    timelines?: [
      {
        in: number
        out: number
      },
    ]
  }>
  selectedTransitions?: string[]
  skipReframe?: boolean
  skipRender?: boolean
  sound?: SoundConfig
  speakersColor?: SpeakerColor[]
  // Tracking
  trackingParams?: {
    expGroup?: string
    ref?: {
      bbox: CenterPercentageAreaPosition
      refOffsetMs: number
    }
  }
  useEditingScriptCache?: boolean
  watermarkType?: WatermarkType
}
/**
 * Defines how background sound should be applied to the video:
 * - TILE: Repeats the sound to fill the entire video duration
 * - TRUNCATE: Cuts off the sound at video end
 */
export type SoundApplyMode = 'TILE' | 'TRUNCATE'
export type SoundConfig = {
  mode: SoundApplyMode
  segments: SoundSegment[]
}
export type SoundSegment = {
  durationMs: number
  storeUrl?: string
  sourceId: string
  sourceName: string
  sourcePlatform: 'MUSIC_LIB' | 'UPLOADED'
  sourceUrl: string
  speed: number
  trimmedDurationMs: {
    end: number
    start: number
  }
  volume: number
  waveformUrl?: string
}
export type SpeakerColor = {
  color: string
  id: string
  name: string
}
export type WatermarkType = 'competition'
type StoredObjectMeta = {
  displayName: string
  name: string
}
