import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { runFfmpeg } from '@reelmakeeasy/common/utils/cmdline'
import { uploadToStore } from '@reelmakeeasy/common/storage/stored-files'
import { resolveVideoResolutionDimensions } from '@reelmakeeasy/common/veo3/video-resolution'
import { clampVideoResolution } from '@reelmakeeasy/common/video-models/registry'
import sharp from 'sharp'

import type {
  BuildPhotoPanZoomTransitionActivityParams,
  BuildPhotoPanZoomTransitionActivityResult,
} from '../../workflows/long-take/transition-types'

import {
  DEFAULT_ASPECT_RATIO,
  downloadAssetToLocal,
  formatLogFields,
  logger,
  withActivityHeartbeat,
  withLongTakeContext,
} from './common'
import { resolveGenerationResolution } from './generation-resolution'
import { createLongTakeStorage } from './storage'

const PHOTO_PANZOOM_FPS = 24
const PHOTO_PANZOOM_VIDEO_BITRATE = '4M'
const PHOTO_PANZOOM_VIDEO_CODEC = 'libx264'
// Total zoom over the clip: 1.0 -> 1.08. Slow enough to read as a
// documentary camera move, small enough to keep the photo's framing intact.
const PHOTO_PANZOOM_ZOOM_DELTA = 0.08
// Pre-zoompan upscale factor. zoompan works on integer pixel offsets, so
// zooming the native-size still produces visible stepping; sampling from a
// 4x supersampled frame keeps the motion smooth.
const PHOTO_PANZOOM_SUPERSAMPLE = 4
// Tail crossfade into the next keyframe when the transition does not loop on
// the same photo: capped so most of the clip is the untouched photo.
const PHOTO_PANZOOM_MAX_FADE_SEC = 0.6

/**
 * Build the pan/zoom filter graph. The photo input is supersampled and fed
 * through `zoompan` (slow linear zoom-in, centered) for the full duration;
 * when the transition lands on a DIFFERENT keyframe, a short `xfade` at the
 * tail hands off to that still. Every visible photo pixel comes straight from
 * the original image -- no generation of any kind.
 * @internal Exported for testing
 */
export function buildPhotoPanZoomFilterComplex(params: {
  dims: { height: number; width: number }
  durationSec: number
  sameFrame: boolean
}): string {
  const { dims, durationSec, sameFrame } = params
  const totalFrames = Math.max(PHOTO_PANZOOM_FPS, Math.round(durationSec * PHOTO_PANZOOM_FPS))
  const supersample = `scale=${dims.width * PHOTO_PANZOOM_SUPERSAMPLE}:${dims.height * PHOTO_PANZOOM_SUPERSAMPLE}:flags=lanczos`
  const zoom = `zoompan=z='1+${PHOTO_PANZOOM_ZOOM_DELTA}*on/${totalFrames}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${totalFrames}:s=${dims.width}x${dims.height}:fps=${PHOTO_PANZOOM_FPS}`
  if (sameFrame) {
    return `[0:v]${supersample},${zoom},format=yuv420p[v]`
  }
  const fadeSec = Math.min(PHOTO_PANZOOM_MAX_FADE_SEC, Math.max(0.1, durationSec * 0.25))
  const offsetSec = Math.max(0, durationSec - fadeSec)
  const scaleToFrame = `scale=${dims.width}:${dims.height}:force_original_aspect_ratio=decrease,pad=${dims.width}:${dims.height}:(ow-iw)/2:(oh-ih)/2,fps=${PHOTO_PANZOOM_FPS}`
  return (
    `[0:v]${supersample},${zoom}[zp];` +
    `[1:v]${scaleToFrame}[f1];` +
    `[zp][f1]xfade=transition=fade:duration=${fadeSec.toFixed(3)}:offset=${offsetSec.toFixed(3)},format=yuv420p[v]`
  )
}

async function preparePanZoomTempDir(params: {
  projectId: string
  transitionId: string
}): Promise<{ firstFramePath: string; lastFramePath: string; tempDir: string }> {
  const tempDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), `lt-photo-panzoom-${params.projectId}-`),
  )
  return {
    firstFramePath: path.join(tempDir, `${params.transitionId}-first.png`),
    lastFramePath: path.join(tempDir, `${params.transitionId}-last.png`),
    tempDir,
  }
}

/**
 * Photo pan/zoom transition: synthesizes the clip for a
 * photo-passthrough shot with ffmpeg -- a gentle zoom over the raw article
 * photograph, crossfading into the next keyframe at the tail when the
 * transition spans two different frames. Replaces the i2v model for these
 * shots so the real photo is never regenerated or animated by a model.
 *
 * Telemetry: an info log on entry, an error log when synthesis throws.
 */
export async function buildPhotoPanZoomTransition(
  params: BuildPhotoPanZoomTransitionActivityParams,
): Promise<BuildPhotoPanZoomTransitionActivityResult> {
  const {
    aspectRatio,
    durationSeconds,
    endMs,
    firstFrameUri,
    fromShotId,
    generationResolution,
    lastFrameUri,
    transitionVideoModel,
    projectId,
    prompt,
    startMs,
    toShotId,
    transitionId,
    userId,
  } = params
  const resolvedUserId = userId || 'long-take'
  const durationMs = Math.max(1, endMs - startMs)
  const sameFrame = firstFrameUri === lastFrameUri

  return withLongTakeContext({ projectId, userId: resolvedUserId }, () =>
    withActivityHeartbeat(async () => {
      const storage = createLongTakeStorage(projectId)
      const transitionUri = storage.getFullPath(
        `long_take/transitions/${transitionId}_photo_panzoom.mp4`,
      )
      const { tempDir, firstFramePath, lastFramePath } = await preparePanZoomTempDir({
        projectId,
        transitionId,
      })
      const outputPath = path.join(tempDir, `photo-panzoom-${transitionId}.mp4`)

      logger.info(
        `[long-take] Photo pan-zoom transition starting ${formatLogFields({
          projectId,
          transitionId,
          fromShotId,
          toShotId,
          durationSeconds,
          durationMs,
          sameFrame,
        })}`,
      )

      try {
        await downloadAssetToLocal(firstFrameUri, firstFramePath)
        if (!sameFrame) {
          await downloadAssetToLocal(lastFrameUri, lastFramePath)
        }

        const safeDurationSec = Math.max(0.5, durationMs / 1000)
        // Same pixel-class rules as the static-hold clip: normalize to the
        // project's video resolution when resolved, clamped at the transition
        // model's cap; otherwise fall back to the keyframe's native size
        // (zoompan needs explicit output dims either way).
        const requestedVideoResolution = resolveGenerationResolution({
          configured: generationResolution,
          projectId,
        }).videoResolution
        // The registry resolves an absent, legacy or unknown model to the
        // default transition role.
        const resolvedVideoResolution = requestedVideoResolution
          ? clampVideoResolution(requestedVideoResolution, transitionVideoModel)
          : undefined
        let dims = resolvedVideoResolution
          ? resolveVideoResolutionDimensions(
              resolvedVideoResolution,
              aspectRatio ?? DEFAULT_ASPECT_RATIO,
            )
          : undefined
        if (!dims) {
          const meta = await sharp(firstFramePath).metadata()
          // Even dimensions for yuv420p.
          dims = {
            height: Math.max(2, Math.floor((meta.height ?? 1024) / 2) * 2),
            width: Math.max(2, Math.floor((meta.width ?? 576) / 2) * 2),
          }
        }

        const filterComplex = buildPhotoPanZoomFilterComplex({
          dims,
          durationSec: safeDurationSec,
          sameFrame,
        })
        const inputArgs = sameFrame
          ? ['-i', firstFramePath]
          : [
              '-i',
              firstFramePath,
              '-loop',
              '1',
              '-t',
              safeDurationSec.toFixed(3),
              '-i',
              lastFramePath,
            ]
        await runFfmpeg(
          ...inputArgs,
          '-filter_complex',
          filterComplex,
          '-map',
          '[v]',
          '-c:v',
          PHOTO_PANZOOM_VIDEO_CODEC,
          '-b:v',
          PHOTO_PANZOOM_VIDEO_BITRATE,
          '-pix_fmt',
          'yuv420p',
          '-movflags',
          '+faststart',
          '-y',
          outputPath,
        )

        await uploadToStore(outputPath, transitionUri, { contentType: 'video/mp4' })

        logger.info(
          `[long-take] Photo pan-zoom transition uploaded ${formatLogFields({
            projectId,
            transitionId,
            transitionUri,
            durationMs,
          })}`,
        )

        return {
          endMs,
          fromShotId,
          prompt,
          qualityCheck: { hasGibberish: false, severity: 'none' },
          startMs,
          toShotId,
          transitionId,
          videoUri: transitionUri,
        }
      } catch (panZoomErr) {
        const message = panZoomErr instanceof Error ? panZoomErr.message : String(panZoomErr)
        logger.error(
          `[long-take] Photo pan-zoom transition FAILED ${formatLogFields({
            projectId,
            transitionId,
            fromShotId,
            toShotId,
            err: message,
          })}`,
        )
        throw panZoomErr
      } finally {
        await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
      }
    }),
  )
}
