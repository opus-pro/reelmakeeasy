import * as path from 'node:path'

import { ensureError } from '../utils/error-handler'
import { downloadStoredFile } from '../storage/stored-files'

import { mixBgmIntoVideo } from './bgm-mix'
import { resolveBgmDuckDbForVolume } from './bgm-volume'
import type { RenderFinalLogger } from './render-final.types'

// Export bake glue for finalizeRender: download the generated BGM bed
// and bake it under the voiceover BEFORE the first upload, so resultVideo, the
// watermark variant, and the thumbnail all derive from the mixed file (and the
// CDN never caches an unmixed object). Everything here is BEST-EFFORT: a mix
// failure must never fail the render -- the no-BGM video ships and a warning is
// logged. Lives outside render-final.ts, which sits at the max-lines ceiling.

/** Gain context measured on the delivered video, reused for sibling variants. */
export interface BgmBakeContext {
  bedPath: string
  gainDb: number
}

/**
 * Bake the bed into the delivered (clean) video. Returns the mixed local path
 * as the new video source plus the gain context for the watermark variant; on
 * skip or ANY failure returns the original source path with no context.
 */
export async function applyBgmBedToDeliveredVideo(params: {
  bgmBedUri?: string
  /**
   * The project's persisted panel volume (0-100). When set, the bed
   * is ducked with the same slider curve the settings remux uses, so a
   * re-render reproduces the audio the user last heard. Absent => the
   * BGM_DEFAULT_VOLUME duck (creation-time bakes, where no volume exists yet).
   */
  bgmVolume?: number
  logger: RenderFinalLogger
  projectId: string
  videoSourcePath: string
  workDir: string
}): Promise<{ bgmMix?: BgmBakeContext; videoSourcePath: string }> {
  const { bgmBedUri, bgmVolume, logger, projectId, videoSourcePath, workDir } = params
  if (!bgmBedUri) {
    // This skip is load-bearing -- a caller that forgets to thread
    // the bed silently strips BGM from the delivered video. Log it so a
    // missing-bed delivery is a grep, not a forensic audio analysis.
    logger.info(`[long-take] BGM bake skipped: no bed uri passed ${formatLogFields({ projectId })}`)
    return { videoSourcePath }
  }
  if (bgmVolume !== undefined && bgmVolume <= 0) {
    // Volume 0 is the voiceover-only delivery everywhere else (the settings
    // remux and the live preview hard-mute): never bake a muted bed, even if
    // a caller passes one alongside volume 0.
    logger.info(
      `[long-take] BGM bake skipped: volume is 0 (voiceover-only) ${formatLogFields({ projectId })}`,
    )
    return { videoSourcePath }
  }
  try {
    const bedPath = path.join(workDir, 'bgm_bed.mp3')
    await downloadStoredFile(bgmBedUri, bedPath)
    const mixResult = await mixBgmIntoVideo({
      bedPath,
      ...(bgmVolume === undefined ? {} : { duckDb: resolveBgmDuckDbForVolume(bgmVolume) }),
      outputFileName: 'final_video_bgm.mp4',
      videoPath: videoSourcePath,
      workDir,
    })
    logger.info(
      `[long-take] BGM bed baked into final video ${formatLogFields({
        projectId,
        bgmBedUri,
        bgmGainDb: mixResult.gainDb,
        ...(bgmVolume === undefined ? {} : { bgmVolume }),
        videoDurationSec: mixResult.videoDurationSec,
      })}`,
    )
    return {
      bgmMix: { bedPath, gainDb: mixResult.gainDb },
      videoSourcePath: mixResult.outputPath,
    }
  } catch (bgmError) {
    logger.warn(
      `[long-take] BGM mix failed, delivering without BGM ${formatLogFields({
        projectId,
        bgmBedUri,
        err: formatError(bgmError),
      })}`,
    )
    return { videoSourcePath }
  }
}

/**
 * Bake the bed into the watermark variant. The
 * watermark is a SEPARATE render (not derived from the clean video), so it
 * needs its own re-mux for free-tier downloads to carry the same BGM. Reuses
 * the gain measured on the clean video (same voiceover) instead of a second
 * loudness measurement, and only runs when the clean mix succeeded (`bgmMix`
 * set) so the two variants never diverge on whether BGM is present.
 * Best-effort: on failure the unmixed watermark path is returned.
 */
export async function applyBgmBedToWatermarkVideo(params: {
  bgmMix?: BgmBakeContext
  logger: RenderFinalLogger
  projectId: string
  watermarkSourcePath: string
  workDir: string
}): Promise<string> {
  const { bgmMix, logger, projectId, watermarkSourcePath, workDir } = params
  if (!bgmMix) {
    return watermarkSourcePath
  }
  try {
    const mixResult = await mixBgmIntoVideo({
      bedPath: bgmMix.bedPath,
      gainDb: bgmMix.gainDb,
      outputFileName: 'watermark_video_bgm.mp4',
      videoPath: watermarkSourcePath,
      workDir,
    })
    return mixResult.outputPath
  } catch (bgmError) {
    logger.warn(
      `[long-take] BGM mix failed for the watermark variant, publishing without BGM ${formatLogFields(
        { projectId, err: formatError(bgmError) },
      )}`,
    )
    return watermarkSourcePath
  }
}

function formatError(error: unknown): { message: string; name: string } {
  const err = ensureError(error)
  return { name: err.name, message: err.message }
}

function formatLogFields(fields: Record<string, unknown>): string {
  try {
    return JSON.stringify(fields)
  } catch {
    return String(fields)
  }
}
