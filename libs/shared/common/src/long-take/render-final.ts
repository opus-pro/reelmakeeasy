import { execFile } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { PROJECT_STAGE } from '@shared/types/enums/project'
import { v4 as uuidV4 } from 'uuid'

import {
  FINAL_VIDEO_CAPTION_STYLE_PATH,
  type RenderedCaptionStyle,
} from '../adapters/caption/caption-look'
import type { CaptionRenderPref } from '../adapters/caption/caption-style'
import { getDefaultCaptionRenderPref } from '../adapters/caption/default-caption-render-pref'
import { STORYBOARD_PATHS } from '../agent-v2/paths'
import { pushChunks } from '../agent-v2/util/push-chunks'
import type { AspectRatio } from '../media/types'
import type {
  AudioContent,
  AudioTrack,
  CaptionTrack,
  MediaTrack,
  VideoScript,
} from '../types/video-script'
import { asStoreUri } from '../storage/address'
import { filePath, uploadToStore, workspaceUri } from '../storage/stored-files'
import { uploadVideoScriptForRender } from '../utils/video-script-store'
import { resolveTaskQueueForClient } from '../workflow/task-queue'
import type { RenderVideoWorkflowDef } from '../workflow/workflow/render/types'
import { getWorkflowId } from '../workflow/workflow-id'

import { resolveDeliveryAudioPath, resolveWatermarkAudio } from './aac-normalize'
import { finishBeatLoopDelivery } from './beat-loop-delivery'
import { applyBgmBedToDeliveredVideo, applyBgmBedToWatermarkVideo } from './bgm-bake'
import { buildCaptionTrackIfEnabled } from './caption-track'
import { commitCanonicalKeyframes, commitRenderedTransitions } from './commit-canonical'
import { formatError, formatLogFields } from './log-fields'
import { burnOgCanvasThumbnail } from './og-canvas-thumbnail'
import { probeVideoDimensions } from './probe-video-dimensions'
// renderFinal delegates the render+finalize to this. Cyclic with render-and-finalize.ts (which imports buildRenderPayloads +
// finalizeRender back); safe because all cross-refs are call-time, not load-time.
import { renderAndFinalizeFromScripts } from './render-and-finalize'
import type {
  FinalizeRenderInput,
  PrepareRenderResult,
  RenderChildWorkflowArgs,
  RenderedVideoScript,
  RenderFinalInput,
  RenderFinalLogger,
  RenderFinalResult,
  RenderFinalStorage,
  RenderFinalTransitionVideo,
  RenderPayloads,
  WatermarkVideoScriptFactory,
} from './render-final.types'
import {
  buildClipCropArea,
  buildFullFrameArea,
  buildThumbnailVf,
  getDeliveryCanvasSize,
} from './render-frame-area'
import { buildRenderVideoIds } from './render-start'
import { resolveTransitionRenderVideoUri } from './render-transition-video-uri'
import { assertDeliveredVideoPlayable } from './validate-delivered-video'

export { buildCaptionTrackIfEnabled } from './caption-track'
export { renderAndFinalizeFromScripts } from './render-and-finalize'
export * from './render-final.types'

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Shared long-take final render pipeline.
 *
 * Sorts transition videos, builds video scripts, executes RenderVideo
 * workflows, uploads outputs, generates thumbnails, and publishes the
 * project-patch. Watermark policy and activity context are owned by
 * the caller.
 */
export async function renderFinal(input: RenderFinalInput): Promise<RenderFinalResult> {
  const {
    aspectRatio,
    audioDurationMs,
    audioSourceUri,
    bgmBedUri,
    bgmVolume,
    buildWatermarkVideoScript,
    enableCaption,
    getThumbnailFallback,
    keyframesToCommit,
    logger,
    projectId,
    storage,
    transitionVideos,
    userContext,
  } = input

  const startedAt = Date.now()

  try {
    logger.info(
      `[long-take] Render started ${formatLogFields({
        projectId,
        userId: userContext.userId,
        transitionCount: transitionVideos.length,
        aspectRatio,
      })}`,
    )

    // 1. Prepare scripts: resolve caption style and track if enabled once here and embed in videoScript so downstream render workers don't need to resolve it.
    const captionRenderPref = input.captionRenderPref ?? getDefaultCaptionRenderPref()
    const captionTrack = await buildCaptionTrackIfEnabled({ enableCaption, logger, storage })
    const prepared = await prepareRenderScripts({
      audioDurationMs,
      audioSourceUri,
      buildWatermarkVideoScript,
      captionTrack,
      captionRenderPref,
      captionStyle: input.captionStyle,
      logger,
      storage,
      targetCanvas: getDeliveryCanvasSize(aspectRatio),
      transitionVideos,
    })

    // 2-4. Build payloads, render clean + watermark, and finalize both.
    return renderAndFinalizeFromScripts({
      aspectRatio,
      bgmBedUri,
      // The user's music level, kept on a render again (absent: the default level).
      ...(bgmVolume === undefined ? {} : { bgmVolume }),
      captionTrack: prepared.captionTrack,
      getThumbnailFallback,
      keyframesToCommit,
      logger,
      projectId,
      startedAt,
      storage,
      totalDurationMs: prepared.totalDurationMs,
      transitionVideos,
      userContext,
      videoScript: prepared.videoScript,
      watermarkVideoScript: prepared.watermarkVideoScript,
    })
  } catch (error) {
    logger.error(
      `[long-take] Render failed ${formatLogFields({
        projectId,
        err: formatError(error),
      })}`,
    )
    throw error
  }
}

// ---------------------------------------------------------------------------
// Composable steps (used by editor-worker to support child workflow cancel)
// ---------------------------------------------------------------------------

/**
 * Step 1: Build VideoScript from transition videos, persist to storage, build watermark script.
 */
export async function prepareRenderScripts(input: {
  audioDurationMs?: number
  audioSourceUri: string
  buildWatermarkVideoScript?: WatermarkVideoScriptFactory
  captionRenderPref?: CaptionRenderPref
  /** Recorded beside the pref (RenderedVideoScript), so the status can say what the file shows. */
  captionStyle?: RenderedCaptionStyle
  captionTrack?: CaptionTrack
  logger: RenderFinalLogger
  /**
   * Mute the audio baked into each media segment's own source, so the only
   * audio in the render is the explicit voiceover track.
   *
   * The 4K export needs this: stage B bakes the voiceover into the pre-Topaz
   * composite, Topaz PRESERVES that stream (verified on a master: aac
   * 44100Hz alongside the h264), and stage E then adds the same voiceover
   * again over the master -- so the delivered 4K carried it twice, heard as
   * echo and smeared vocals.
   *
   * Muting at mix time rather than stripping the master avoids an ffmpeg pass
   * over a multi-GB 2160p file. The 1080p path renders transition clips that
   * are silent anyway, so this stays opt-in and default false keeps it
   * byte-for-byte.
   */
  muteMediaAudio?: boolean
  storage: RenderFinalStorage
  /**
   * Render canvas size. When set, each transition clip whose actual
   * dimensions are known is center-cropped to this aspect ratio (crop-to-fill)
   * instead of being letterboxed. Pass the delivery canvas. Absent => full-frame
   * (legacy).
   */
  targetCanvas?: { height: number; width: number }
  transitionVideos: RenderFinalTransitionVideo[]
}): Promise<PrepareRenderResult> {
  const {
    audioDurationMs,
    audioSourceUri,
    buildWatermarkVideoScript,
    captionRenderPref,
    captionStyle,
    captionTrack,
    logger,
    muteMediaAudio = false,
    storage,
    targetCanvas,
    transitionVideos,
  } = input

  await storage.ensureDir('long_take')
  if (!transitionVideos.length) {
    throw new Error('No transition videos available for Story Mode render')
  }

  const orderedTransitions = [...transitionVideos].sort((a, b) => a.startMs - b.startMs)
  const transitionDurationMs = Math.max(
    0,
    orderedTransitions.reduce((max, segment) => Math.max(max, segment.endMs), 0),
  )

  // Transition timing and voiceover duration should already be aligned by the
  // upstream pipeline, but codec-level encoding can shave off tens of
  // milliseconds at the tail, clipping the final word(s).
  // When the actual audio duration is available, use it as the authoritative
  // end point.  For small deltas (<= 2s) we also extend the last transition
  // so the final frame holds on screen (no black-screen gap).  Larger
  // mismatches indicate an upstream bug and are logged as warnings.
  const MAX_SAFE_EXTENSION_MS = 2000
  let totalDurationMs = transitionDurationMs

  if (audioDurationMs != null && orderedTransitions.length > 0) {
    const deltaMs = audioDurationMs - transitionDurationMs

    if (deltaMs > 0) {
      // Clone the last element before mutating so we don't affect the caller's
      // original transitionVideos array (orderedTransitions is a shallow copy).
      const lastIdx = orderedTransitions.length - 1
      orderedTransitions[lastIdx] = { ...orderedTransitions[lastIdx], endMs: audioDurationMs }
      totalDurationMs = audioDurationMs

      if (deltaMs <= MAX_SAFE_EXTENSION_MS) {
        logger.info(
          `[long-take] Extending timeline by ${deltaMs}ms to match voiceover duration ` +
            `(audio=${audioDurationMs}ms, transitions=${transitionDurationMs}ms)`,
        )
      } else {
        logger.warn(
          `[long-take] Audio duration exceeds transitions by ${deltaMs}ms (>${MAX_SAFE_EXTENSION_MS}ms) - ` +
            `possible upstream timing issue (audio=${audioDurationMs}ms, transitions=${transitionDurationMs}ms)`,
        )
      }
    }
    // deltaMs <= 0 means transitions already cover the audio - nothing to do.
  }

  const mediaTrack: MediaTrack = {
    id: 'track-media',
    type: 'media',
    segments: orderedTransitions.map((segment, index) => {
      const renderUri = resolveTransitionRenderVideoUri(segment)
      return {
        id: `segment-long-take-${index}`,
        content: {
          id: `content-${uuidV4()}`,
          resourceType: 'video',
          sourceUri: renderUri,
          // Silence audio the source carries, so the voiceover track
          // below is the only one in the mix. Omitted unless asked for -- the
          // adapter defaults an absent volume to 100, which is the 1080p path's
          // existing behavior.
          ...(muteMediaAudio ? { volume: 0 } : {}),
          // A raw transition clip needs cover-crop to the canvas.
          cropAreas: [buildClipCropArea(segment, targetCanvas)],
          targetAreas: [buildFullFrameArea()],
        },
        // The whole raw clip from 0.
        duration: { sO: 0, eO: Math.max(0, segment.endMs - segment.startMs) },
        loop: 0,
        timeline: {
          in: segment.startMs,
          out: segment.endMs,
        },
      }
    }),
  }

  const audioTrack: AudioTrack = {
    id: 'track-audio',
    type: 'audio',
    segments: [
      {
        id: 'segment-audio-voiceover',
        content: {
          id: `content-${uuidV4()}`,
          resourceType: 'audio',
          sourceUri: audioSourceUri,
        } as AudioContent,
        duration: {
          sO: 0,
          eO: totalDurationMs,
        },
        timeline: {
          in: 0,
          out: totalDurationMs,
        },
      },
    ],
  }

  const videoScript: RenderedVideoScript = {
    captionRenderPref,
    ...(captionStyle ? { captionStyle } : {}),
    tracks: captionTrack ? [mediaTrack, audioTrack, captionTrack] : [mediaTrack, audioTrack],
  }

  await storage.writeJsonFile(STORYBOARD_PATHS.videoScriptPath, videoScript)

  const watermarkVideoScript = buildWatermarkVideoScript?.(videoScript, totalDurationMs)
  logger.info(`[long-take] Watermark enabled: ${!!watermarkVideoScript}`)

  return { captionTrack, orderedTransitions, totalDurationMs, videoScript, watermarkVideoScript }
}

/**
 * Step 2: Build render workflow arguments (upload scripts to storage, construct payloads).
 */
export async function buildRenderPayloads(input: {
  aspectRatio?: AspectRatio
  captionTrack?: CaptionTrack
  projectId: string
  /**
   * Short kebab-case label naming this call site's render (e.g. 'final',
   * 'no-lipsync'). REQUIRED for collision safety: the deterministic
   * videoId is scoped to the calling activity invocation, and one activity can
   * build payloads for more than one render, so the purpose keeps them distinct.
   */
  renderPurpose: string
  totalDurationMs: number
  userContext: { userEmail: string; userId: string }
  videoScript: VideoScript
  watermarkVideoScript?: VideoScript
}): Promise<RenderPayloads> {
  const {
    aspectRatio,
    captionTrack,
    projectId,
    totalDurationMs,
    userContext,
    videoScript,
    watermarkVideoScript,
  } = input
  const { userEmail, userId } = userContext

  const taskQueue = await resolveTaskQueueForClient('render')
  const durationInSeconds = Math.max(1, Math.ceil(totalDurationMs / 1000))

  const sharedContext: RenderVideoWorkflowDef['arg']['context'] = {
    projectId,
    userEmail,
    userId,
    videoId: '',
  }
  const sharedPayload: RenderVideoWorkflowDef['arg']['payload'] = {
    durationInSeconds,
    enableCaption: !!captionTrack,
    aspectRatio: aspectRatio ?? undefined,
    fps: '24/1',
    videoScriptUri: '',
  }

  // Deterministic across activity retries: a retry rebuilds the SAME
  // workflowId and startRenderVideo re-attaches instead of duplicating. Script
  // ids are per-call so a retry can never swap the script under a running
  // render (see buildRenderVideoIds).
  const ids = buildRenderVideoIds(input.renderPurpose)
  const uploadScript = (id: string, script: VideoScript): Promise<string> =>
    uploadVideoScriptForRender(projectId, id, script)
  const videoScriptUri = await uploadScript(ids.cleanScriptId, videoScript)
  const cleanPayload = { ...sharedPayload, videoScriptUri, videoScript }

  const clean: RenderChildWorkflowArgs = {
    args: [
      {
        context: { ...sharedContext, videoId: ids.cleanVideoId },
        payload: cleanPayload,
      },
    ],
    taskQueue,
    workflowId: getWorkflowId(projectId, 'story-mode', 'render', ids.cleanVideoId),
  }

  // Watermark render
  let watermark: RenderChildWorkflowArgs | undefined
  if (watermarkVideoScript) {
    const videoScriptUriWatermark = await uploadScript(ids.watermarkScriptId, watermarkVideoScript)
    const watermarkPayload = {
      ...sharedPayload,
      videoScriptUri: videoScriptUriWatermark,
      videoScript,
    }

    watermark = {
      args: [
        {
          context: { ...sharedContext, videoId: ids.watermarkVideoId },
          payload: watermarkPayload,
        },
      ],
      taskQueue,
      workflowId: getWorkflowId(projectId, 'story-mode', 'render', ids.watermarkVideoId),
    }
  }

  return { clean, watermark }
}

/**
 * Step 3: Download/copy render outputs, generate thumbnail, upload, publish project-patch.
 */
export async function finalizeRender(input: FinalizeRenderInput): Promise<RenderFinalResult> {
  const {
    aspectRatio,
    bgmBedUri,
    bgmVolume,
    captionAdded,
    captionStyle,
    cleanVideoUri,
    getThumbnailFallback,
    keyframesToCommit,
    logger,
    projectId,
    startedAt,
    storage,
    totalDurationMs,
    transitionVideos,
    userContext,
    watermarkVideoUri,
  } = input
  const { userEmail, userId } = userContext

  const durationInSeconds =
    totalDurationMs == null ? undefined : Math.max(1, Math.ceil(totalDurationMs / 1000))

  const tmpDir = path.join(os.tmpdir(), `long-take-${projectId}-${uuidV4()}`)
  await fs.promises.mkdir(tmpDir, { recursive: true })

  const firstTransitionByTime =
    captionAdded && transitionVideos.length
      ? transitionVideos.reduce((earliest, current) =>
          current.startMs < earliest.startMs ? current : earliest,
        )
      : undefined

  try {
    // Stored files are on this disk: read the render output in place.
    let videoSourcePath = filePath(cleanVideoUri)

    // Bake the generated BGM bed under the voiceover BEFORE the first
    // upload, so resultVideo, the watermark variant, and the thumbnail all
    // derive from the mixed file. Best-effort: any failure ships the no-BGM
    // video (see bgm-bake.ts for the branch/fail-soft policy).
    const bgmBake = await applyBgmBedToDeliveredVideo({
      bgmBedUri,
      bgmVolume,
      logger,
      projectId,
      videoSourcePath,
      workDir: tmpDir,
    })
    // Without a BGM mix (no bed, muted, or bake fail-soft) the delivered audio
    // is the concat's stream-copied voiceover MP3, silent in QuickTime/Safari;
    // the resolver normalizes it before the gate and the uploads.
    videoSourcePath = await resolveDeliveryAudioPath(bgmBake, tmpDir)
    // A loop short's clips get their voice, captions, stamps and master here; others pass.
    videoSourcePath = await finishBeatLoopDelivery(input, videoSourcePath, tmpDir)

    // Fail loud (retryable) on a corrupt, never-finalized mp4 instead
    // of shipping it to the CDN and auto-post; see validate-delivered-video.ts.
    // decodeScan additionally decodes the full bitstream, so a file
    // whose container is sound but whose H.264 payload is garbage (corrupt
    // render chunk stream-copied into the delivery) also fails loud here.
    await assertDeliveredVideoPlayable(videoSourcePath, logger, projectId, {
      decodeScan: true,
      requireAudioStream: true,
    })

    const finalVideoUri = workspaceUri(projectId, 'final_video.mp4')
    const thumbnailPath = path.join(tmpDir, 'final_video.mp4.jpg')

    const [, watermarkPublished, thumbnailResult] = await Promise.all([
      // Upload clean video
      (async () => {
        await uploadToStore(videoSourcePath, finalVideoUri)
        logger.info(`[long-take] Video stored at ${finalVideoUri}`)

        await storage.uploadFile(videoSourcePath, 'final_video.mp4')
        // The file now has this render's caption look: record it for the status, only now, so
        // a render that fails before this point leaves the record of the file still there.
        await storage.writeJsonFile(FINAL_VIDEO_CAPTION_STYLE_PATH, {
          captionStyle: captionStyle ?? null,
        })
      })(),
      // Upload watermark video (a separate render).
      (async (): Promise<boolean> => {
        if (!watermarkVideoUri) {
          return false
        }
        let watermarkSourcePath = filePath(watermarkVideoUri)

        // The watermark variant is a SEPARATE render, so
        // bake the bed into it too (reusing the measured gain) -- free-tier
        // downloads must carry the same BGM. No-op unless the clean mix ran.
        const wmIn = watermarkSourcePath
        const wmBaked = await applyBgmBedToWatermarkVideo({
          bgmMix: bgmBake.bgmMix,
          logger,
          projectId,
          watermarkSourcePath,
          workDir: tmpDir,
        })
        // Its own mix fail-softs independently of the clean one, so the AAC
        // decision (and output name) is made per variant -- see the resolver.
        watermarkSourcePath = await resolveWatermarkAudio(wmBaked, wmIn, tmpDir)

        const watermarkVideoStoreUri = workspaceUri(projectId, 'watermark_video.mp4')
        // The watermark variant is user-facing too; gate it like the
        // clean video. A validation or publish failure propagates.
        await assertDeliveredVideoPlayable(watermarkSourcePath, logger, projectId, {
          decodeScan: true,
          requireAudioStream: true,
        })
        await uploadToStore(watermarkSourcePath, watermarkVideoStoreUri)
        logger.info(`[long-take] Watermark video stored at ${watermarkVideoStoreUri}`)

        await storage.uploadFile(watermarkSourcePath, 'watermark_video.mp4')
        return true
      })(),
      // Generate thumbnail
      (async (): Promise<{ fallbackUsed: boolean; url: string | undefined }> => {
        try {
          let thumbnailSourcePath = videoSourcePath
          if (firstTransitionByTime) {
            thumbnailSourcePath = filePath(resolveTransitionRenderVideoUri(firstTransitionByTime))
            logger.info(
              `[long-take] Using first transition segment as thumbnail source to avoid burned-in caption ${formatLogFields(
                {
                  projectId,
                  transitionId: firstTransitionByTime.transitionId,
                  source: thumbnailSourcePath,
                },
              )}`,
            )
          }

          // Center-crop the thumbnail to the delivery aspect ratio so an
          // off-9:16 source clip doesn't yield an off-ratio poster the UI letterboxes.
          const thumbVf = buildThumbnailVf(getDeliveryCanvasSize(aspectRatio))
          await new Promise<void>((resolve, reject) => {
            execFile(
              'ffmpeg',
              [
                '-i',
                thumbnailSourcePath,
                '-ss',
                '0',
                '-vframes',
                '1',
                '-q:v',
                '2',
                '-vf',
                thumbVf,
                thumbnailPath,
              ],
              (error) => (error ? reject(error) : resolve()),
            )
          })

          const thumbnailUri = workspaceUri(projectId, '_thumbnail/final_video.mp4.jpg')

          await uploadToStore(thumbnailPath, thumbnailUri)
          await storage.uploadFile(thumbnailPath, '_thumbnail/final_video.mp4.jpg')

          // Best-effort 1200x630 og link-preview variant at a sibling key
          // (.jpg -> .og.jpg); baseDimensions supplies only the aspect ratio. Runs in
          // its own try -- NOT the outer catch that flips to the keyframe fallback --
          // so any failure leaves the base thumbnail and render intact. Supersedes the
          // play_icon variant (no longer produced; /share still reads old ones).
          const baseDimensions = await probeVideoDimensions(thumbnailPath, logger, projectId)
          if (baseDimensions) {
            try {
              const ogCanvasPath = await burnOgCanvasThumbnail(
                thumbnailSourcePath,
                tmpDir,
                baseDimensions.width,
                baseDimensions.height,
              )
              const ogCanvasKey = '_thumbnail/final_video.mp4.og.jpg'
              await uploadToStore(ogCanvasPath, workspaceUri(projectId, ogCanvasKey))
              await storage.uploadFile(ogCanvasPath, ogCanvasKey)
              logger.info('[long-take] OG-canvas thumbnail generated and uploaded')
            } catch (ogCanvasError) {
              logger.warn(
                `[long-take] OG-canvas thumbnail failed, skipping variant ${formatLogFields({
                  projectId,
                  err: formatError(ogCanvasError),
                })}`,
              )
            }
          } else {
            logger.warn(
              `[long-take] Skipping thumbnail variants: could not probe base dimensions ${formatLogFields(
                { projectId },
              )}`,
            )
          }

          logger.info('[long-take] Thumbnail generated and uploaded')
          return { url: thumbnailUri, fallbackUsed: false }
        } catch (thumbnailError) {
          logger.warn(
            `[long-take] Failed to generate thumbnail, attempting keyframe fallback ${formatLogFields(
              {
                projectId,
                err: formatError(thumbnailError),
              },
            )}`,
          )
          const fallbackThumbnailUrl = await getThumbnailFallback()
          if (fallbackThumbnailUrl) {
            logger.info(
              `[long-take] Using first keyframe as thumbnail fallback ${formatLogFields({ projectId })}`,
            )
          } else {
            logger.warn(
              `[long-take] No keyframe available for thumbnail fallback ${formatLogFields({ projectId })}`,
            )
          }
          return { url: fallbackThumbnailUrl, fallbackUsed: true }
        }
      })(),
    ])

    const thumbnailUri = thumbnailResult.url
    const thumbnailFallbackUsed = thumbnailResult.fallbackUsed

    logger.info(
      `[long-take] Video and thumbnail processing completed ${formatLogFields({
        projectId,
        hasWatermark: watermarkPublished,
      })}`,
    )

    // Defense-in-depth: never overwrite the manifest with []; silently
    // skip to preserve any existing manifest.
    if (transitionVideos.length > 0) {
      await commitRenderedTransitions(storage, transitionVideos)
    }
    if (keyframesToCommit) {
      await commitCanonicalKeyframes(storage, keyframesToCommit)
    }

    // Publish project-patch. The project keeps addresses; their served URLs are
    // built when it is sent to a browser.
    const patchData: Record<string, unknown> = {
      stage: PROJECT_STAGE.FINISHED,
      resultVideo: finalVideoUri,
      resultVideoThumbnail: thumbnailUri,
      previewThumbnail: thumbnailUri,
      enableCaption: captionAdded,
      ...(durationInSeconds != null && { duration: durationInSeconds }),
    }

    // Publish watermarkVideo only when the watermark file was actually
    // uploaded, so the patch never points at a missing object.
    let deliveredWatermarkUri: string | undefined
    if (watermarkPublished) {
      deliveredWatermarkUri = workspaceUri(projectId, 'watermark_video.mp4')
      patchData['watermarkVideo'] = deliveredWatermarkUri
    }

    const pushResult = await pushChunks({
      projectId,
      userId,
      userEmail,
      chunks: [
        {
          type: 'project-patch',
          role: 'event',
          content: { data: patchData },
        },
      ],
    })
    if (!pushResult.success) {
      logger.error(
        `[long-take] Failed to push project-patch after render ${formatLogFields({
          projectId,
          error: pushResult.error,
        })}`,
      )
      throw new Error(`Failed to publish project-patch: ${pushResult.error}`)
    }

    logger.info(
      `[long-take] Render completed ${formatLogFields({
        projectId,
        durationMs: Date.now() - startedAt,
      })}`,
    )

    return {
      // Whether the bed actually reached the delivered video, not whether one
      // was generated: applyBgmBedToDeliveredVideo fail-softs to the no-BGM
      // source on a muted volume and any download/mix error. bgmMix is set only when the clean mix succeeded.
      bgmBaked: Boolean(bgmBake.bgmMix),
      enableCaption: captionAdded,
      finalVideoUri,
      renderDurationMs: Date.now() - startedAt,
      thumbnailUri,
      thumbnailFallbackUsed,
      videoUri: cleanVideoUri,
      deliveredWatermarkUri,
    }
  } finally {
    try {
      await fs.promises.rm(tmpDir, { recursive: true, force: true })
    } catch (cleanupError) {
      logger.warn(
        `[long-take] Cleanup failed ${formatLogFields({ projectId, err: formatError(cleanupError) })}`,
      )
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// buildCaptionTrackIfEnabled lives in ./caption-track and formatError /
// formatLogFields in ./log-fields: this file sits at the max-lines ceiling,
// and both are self-contained.

// ---------------------------------------------------------------------------
// Thumbnail fallback helper (shared across workers)
// ---------------------------------------------------------------------------

/** Minimal keyframe shape needed by the fallback helper. */
interface LongTakeKeyframeItem {
  keyframeUrl: string
  shotId: string
}

/**
 * Reads `long_take/keyframes.json` from storage and returns the address of the
 * first keyframe image, suitable as a thumbnail fallback when ffmpeg extraction
 * fails. Returns `undefined` when no keyframe is available.
 */
export async function getFirstLongTakeKeyframeThumbnailUrl(
  storage: { readJsonFile<T>(pathName: string): Promise<T> },
  projectId: string,
  logger?: RenderFinalLogger,
): Promise<string | undefined> {
  try {
    const keyframes = await storage.readJsonFile<LongTakeKeyframeItem[]>('long_take/keyframes.json')
    const keyframeUrl = Array.isArray(keyframes) ? keyframes[0]?.keyframeUrl?.trim() : undefined
    if (!keyframeUrl) {
      return undefined
    }
    return asStoreUri(keyframeUrl)
  } catch (error) {
    logger?.warn(
      `[long-take] Failed to load keyframes for thumbnail fallback ${formatLogFields({
        projectId,
        err: formatError(error),
      })}`,
    )
    return undefined
  }
}
