import type { LongTakeKeyframe } from '@shared/types/api/long-take'

import type { AspectRatio } from '../media/types'
import type { CaptionTrack, VideoScript } from '../types/video-script'

// NOTE: render-final.ts imports renderAndFinalizeFromScripts (for renderFinal)
// and this module imports buildRenderPayloads + finalizeRender back from it -- a
// deliberate cycle. It is safe because both are accessed only at call time (not
// at module load), so the bindings are fully initialized by the time they run.
import { buildRenderPayloads, finalizeRender } from './render-final'
import type {
  RenderedVideoScript,
  RenderFinalLogger,
  RenderFinalResult,
  RenderFinalStorage,
  RenderFinalTransitionVideo,
  ThumbnailFallbackFn,
} from './render-final.types'
import { startRenderVideo } from './render-start'

/**
 * Render the clean + watermark videos from prebuilt VideoScripts and finalize
 * both. `renderFinal` calls this after `prepareRenderScripts`.
 */
export async function renderAndFinalizeFromScripts(input: {
  aspectRatio?: AspectRatio
  /**
   * store address of the generated BGM bed; finalize bakes it under the
   * voiceover (one re-mux) before uploading. Best-effort -- see finalizeRender.
   */
  bgmBedUri?: string
  /** The music's Volume % with `bgmBedUri` (RenderFinalInput.bgmVolume); absent: the default. */
  bgmVolume?: number
  captionTrack?: CaptionTrack
  getThumbnailFallback: ThumbnailFallbackFn
  keyframesToCommit?: LongTakeKeyframe[]
  logger: RenderFinalLogger
  projectId: string
  startedAt: number
  storage: RenderFinalStorage
  totalDurationMs: number
  transitionVideos: RenderFinalTransitionVideo[]
  userContext: { userEmail: string; userId: string }
  videoScript: RenderedVideoScript
  watermarkVideoScript?: VideoScript
}): Promise<RenderFinalResult> {
  const {
    aspectRatio,
    bgmBedUri,
    bgmVolume,
    captionTrack,
    getThumbnailFallback,
    keyframesToCommit,
    logger,
    projectId,
    startedAt,
    storage,
    totalDurationMs,
    transitionVideos,
    userContext,
    videoScript,
    watermarkVideoScript,
  } = input

  // Build payloads and execute render workflows.
  const payloads = await buildRenderPayloads({
    aspectRatio,
    captionTrack,
    projectId,
    renderPurpose: 'final',
    totalDurationMs,
    userContext,
    videoScript,
    watermarkVideoScript,
  })

  const cleanRenderPromise = startRenderVideo(payloads.clean)
  const watermarkRenderPromise = payloads.watermark
    ? startRenderVideo(payloads.watermark)
    : undefined

  const [cleanRenderResult, watermarkRenderResult] = await Promise.all([
    cleanRenderPromise,
    watermarkRenderPromise,
  ])

  if (!cleanRenderResult?.data?.videoUri) {
    throw new Error('RenderVideo returned no videoUri')
  }

  logger.info(
    `[long-take] Clean video render completed projectId=${projectId} videoUri=${cleanRenderResult.data.videoUri}`,
  )
  if (watermarkRenderResult?.data?.videoUri) {
    logger.info(
      `[long-take] Watermark video render completed projectId=${projectId} videoUri=${watermarkRenderResult.data.videoUri}`,
    )
  }

  // Finalize: download, upload, thumbnail, project-patch (both videos).
  return finalizeRender({
    bgmBedUri,
    ...(bgmVolume === undefined ? {} : { bgmVolume }),
    captionAdded: Boolean(captionTrack),
    // The look the script draws, recorded for the file once it is delivered.
    captionStyle: videoScript.captionStyle,
    cleanVideoUri: cleanRenderResult.data.videoUri,
    getThumbnailFallback,
    keyframesToCommit,
    logger,
    projectId,
    startedAt,
    storage,
    totalDurationMs,
    transitionVideos,
    userContext,
    watermarkVideoUri: watermarkRenderResult?.data?.videoUri,
  })
}
