import type { LongTakeEditorState, LongTakeKeyframe } from '@shared/types/api/long-take'

import type { RenderedCaptionStyle } from '../adapters/caption/caption-look'
import type { CaptionRenderPref } from '../adapters/caption/caption-style'
import type { AspectRatio } from '../media/types'
import type { CaptionTrack, VideoScript } from '../types/video-script'
import type { RenderVideoWorkflowDef } from '../workflow/workflow/render/types'

/** A transition video segment for the final render. */
export interface RenderFinalTransitionVideo {
  baseVideoUri?: string
  endMs: number
  fromShotId: string
  lipSyncEnabled?: boolean
  lipSyncVideoUri?: string
  prompt: string
  shouldLipSync?: boolean
  startMs: number
  toShotId: string
  transitionId: string
  /**
   * Actual clip dimensions in px. When present (and a target canvas is
   * known), the render plan center-crops the clip to the canvas aspect ratio
   * (crop-to-fill) instead of letterboxing an off-9:16 clip. Absent => full frame.
   */
  videoHeight?: number
  videoUri: string
  videoWidth?: number
}

/** Storage abstraction - the subset of ProjectStore the helper needs. */
export interface RenderFinalStorage {
  ensureDir(dirPath: string): Promise<string>
  getFullPath(relativePath: string): string
  readJsonFile<T>(pathName: string): Promise<T>
  uploadFile(
    localPath: string,
    storagePath: string,
    uploadOptions?: { metadata?: Record<string, string> },
  ): Promise<string | void>
  writeJsonFile(pathName: string, data: unknown): Promise<string | void>
}

/** Logger abstraction. */
export interface RenderFinalLogger {
  error(message: string): void
  info(message: string): void
  warn(message: string): void
}

/**
 * Factory that receives the clean VideoScript and total duration, returns
 * a watermark VideoScript if watermarking is enabled, or undefined to skip.
 */
export type WatermarkVideoScriptFactory = (
  cleanVideoScript: VideoScript,
  totalDurationMs: number,
) => undefined | VideoScript

/** Callback to get a fallback thumbnail URL when ffmpeg extraction fails. */
export type ThumbnailFallbackFn = () => Promise<string | undefined>

/** Primary input to the shared render-final helper. */
export interface RenderFinalInput {
  aspectRatio?: AspectRatio
  /**
   * Actual voiceover audio duration in milliseconds, measured via ffprobe.
   * When provided, the audio track's timeline.out will be set to
   * `max(transitionEndMs, audioDurationMs)` so the voiceover is never
   * clipped short by transition timing.
   */
  audioDurationMs?: number
  audioSourceUri: string
  /**
   * store address of the generated Story Mode BGM bed (see
   * generateLongTakeBgmBed). When set, finalize downloads the bed and bakes it
   * under the voiceover with one ffmpeg re-mux BEFORE the first upload, so
   * resultVideo AND the watermark variant ship with BGM (download/share/feed
   * then serve the mixed video with no API/FE change). Best-effort: any mix
   * failure delivers the no-BGM video. Absent => no mixing (today's behavior).
   */
  bgmBedUri?: string
  /**
   * The music's Volume % (0-100) the user saved, with `bgmBedUri`: the bake ducks the bed with
   * the same level rule as the music remux (0 bakes no music), so a video rendered again keeps
   * the level the user last heard. Absent: the BGM_DEFAULT_VOLUME level (a first render).
   */
  bgmVolume?: number
  buildWatermarkVideoScript?: WatermarkVideoScriptFactory
  /** The video's caption style, resolved once by the render activity; absent: the default. */
  captionRenderPref?: CaptionRenderPref
  /** The settings `captionRenderPref` came from, recorded in the video script (RenderedVideoScript). */
  captionStyle?: RenderedCaptionStyle
  enableCaption?: boolean | null
  getThumbnailFallback: ThumbnailFallbackFn
  keyframesToCommit?: LongTakeEditorState['keyframes']
  logger: RenderFinalLogger
  projectId: string
  storage: RenderFinalStorage
  transitionVideos: RenderFinalTransitionVideo[]
  userContext: {
    userEmail: string
    userId: string
  }
}

/**
 * The video script every render saves (`storyboard/video_script.json`) before it renders, which
 * the editor previews.
 */
export interface RenderedVideoScript extends VideoScript {
  /**
   * The caption settings `captionRenderPref` was resolved from, every default filled in
   * (RenderedCaptionStyle in adapters/caption/caption-look.ts). It describes this render, not
   * the delivered file: the delivery records it for the file once the file is uploaded
   * (FINAL_VIDEO_CAPTION_STYLE_PATH). Absent from scripts rendered before looks were recorded.
   */
  captionStyle?: RenderedCaptionStyle
}

/** A loop short's captions, as its render resolved them, once. */
export interface BeatLoopCaptions {
  /** The video's caption style: the captions draw in it, the stamps in its highlight colour. */
  captionRenderPref: CaptionRenderPref
  /** The captions to draw (the loop's transcript); absent with the captions off. */
  captionTrack?: CaptionTrack
}

/** The music a loop short's render puts under it (off unless the user added music). */
export interface BeatLoopMusicSetting {
  /** The project's music bed. */
  bedUri: string
  /** The user's Volume % (0-100): how loud the music is next to the narration. */
  volume: number
}

/** Input to the shared finalize-render helper. */
export interface FinalizeRenderInput {
  aspectRatio?: AspectRatio
  /**
   * A loop short's captions, resolved once by its render (`captionAdded` says whether there
   * are any): the finish pass draws exactly these.
   */
  beatLoopCaptions?: BeatLoopCaptions
  /**
   * A loop short's music: the finish pass mixes it under the loop's own sound before the master.
   * A loop never uses `bgmBedUri`: that bake would mix the music into the clips' sound.
   */
  beatLoopMusic?: BeatLoopMusicSetting
  /**
   * store address of the generated BGM bed to bake under the voiceover.
   * Best-effort: any failure ships the no-BGM video.
   */
  bgmBedUri?: string
  /**
   * Persisted panel volume (0-100) to duck the baked bed at, so a
   * re-render of a project whose BGM settings were already tuned reproduces
   * the delivered audio instead of resetting it to the default duck. Absent =>
   * the BGM_DEFAULT_VOLUME duck (creation-time renders, where none exists yet).
   */
  bgmVolume?: number
  captionAdded: boolean
  /**
   * The caption settings the file is drawn with, recorded for it right after it is uploaded
   * (FINAL_VIDEO_CAPTION_STYLE_PATH), so the status says what the delivered file shows. Absent:
   * the default look, recorded as null.
   */
  captionStyle?: RenderedCaptionStyle
  cleanVideoUri: string
  getThumbnailFallback: ThumbnailFallbackFn
  keyframesToCommit?: LongTakeKeyframe[]
  logger: RenderFinalLogger
  projectId: string
  startedAt: number
  storage: RenderFinalStorage
  totalDurationMs?: number
  transitionVideos: RenderFinalTransitionVideo[]
  userContext: { userEmail: string; userId: string }
  watermarkVideoUri?: string
}

export interface PrepareRenderResult {
  captionTrack?: CaptionTrack
  orderedTransitions: RenderFinalTransitionVideo[]
  totalDurationMs: number
  videoScript: RenderedVideoScript
  watermarkVideoScript?: VideoScript
}

export interface RenderChildWorkflowArgs {
  args: [RenderVideoWorkflowDef['arg']]
  taskQueue: string
  workflowId: string
}

export interface RenderFinalResult {
  /**
   * Whether the BGM bed was actually mixed into the delivered video.
   * Distinct from "a bed was generated" -- the bake is best-effort and ships
   * the no-BGM source on a muted volume or any download/mix failure. The completion event's has_bgm reports delivery, so
   * it must read this rather than the presence of a bed.
   */
  bgmBaked: boolean
  enableCaption: boolean
  finalVideoUri: string
  renderDurationMs: number
  thumbnailUri?: string
  thumbnailFallbackUsed: boolean
  videoUri: string
  deliveredWatermarkUri?: string
}

export interface RenderPayloads {
  clean: RenderChildWorkflowArgs
  watermark?: RenderChildWorkflowArgs
}
