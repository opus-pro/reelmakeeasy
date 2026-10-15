import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { runFfmpeg } from '@reelmakeeasy/common/utils/cmdline'
import { uploadToStore } from '@reelmakeeasy/common/storage/stored-files'
import { resolveVideoResolutionDimensions } from '@reelmakeeasy/common/veo3/video-resolution'
import { clampVideoResolution } from '@reelmakeeasy/common/video-models/registry'

import type {
  BuildStaticHoldTransitionActivityParams,
  BuildStaticHoldTransitionActivityResult,
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

const STATIC_HOLD_FALLBACK_FPS = 24
const STATIC_HOLD_FALLBACK_VIDEO_BITRATE = '4M'
const STATIC_HOLD_FALLBACK_VIDEO_CODEC = 'libx264'

/**
 * Build the xfade filter graph. When target dims are provided, both keyframe
 * inputs are scaled to them first so (a) the clip matches the project's video
 * pixel class instead of the keyframe-native size and (b) mismatched keyframe
 * dimensions can never break xfade (which requires identical inputs).
 * @internal Exported for testing
 */
export function buildStaticHoldFilterComplex(params: {
  dims?: { height: number; width: number }
  halfDurationSec: number
}): string {
  const { dims, halfDurationSec } = params
  const xfade = `xfade=transition=fade:duration=${halfDurationSec.toFixed(3)}:offset=${halfDurationSec.toFixed(3)},format=yuv420p,fps=${STATIC_HOLD_FALLBACK_FPS}[v]`
  if (!dims) {
    return `[0:v][1:v]${xfade}`
  }
  const scale = `scale=${dims.width}:${dims.height}:force_original_aspect_ratio=decrease,pad=${dims.width}:${dims.height}:(ow-iw)/2:(oh-ih)/2`
  return `[0:v]${scale}[f0];[1:v]${scale}[f1];[f0][f1]${xfade}`
}

async function prepareStaticHoldTempDir(params: {
  projectId: string
  transitionId: string
}): Promise<{ firstFramePath: string; lastFramePath: string; tempDir: string }> {
  const tempDir = await fs.promises.mkdtemp(
    path.join(os.tmpdir(), `lt-static-hold-${params.projectId}-`),
  )
  return {
    firstFramePath: path.join(tempDir, `${params.transitionId}-first.png`),
    lastFramePath: path.join(tempDir, `${params.transitionId}-last.png`),
    tempDir,
  }
}

/**
 * Static-hold fallback transition. Synthesizes a crossfade between the
 * supplied first/last keyframes via ffmpeg's `xfade` filter when the
 * primary `generateLongTakeTransitionVideo` activity exhausts its retry
 * budget.
 *
 * Telemetry:
 * - an info log on entry.
 * - an error log only when the fallback synthesis itself throws.
 */
export async function buildStaticHoldTransition(
  params: BuildStaticHoldTransitionActivityParams,
): Promise<BuildStaticHoldTransitionActivityResult> {
  const {
    aspectRatio,
    durationSeconds,
    endMs,
    firstFrameUri,
    fromShotId,
    generationResolution,
    lastFrameUri,
    transitionVideoModel,
    originalError,
    projectId,
    prompt,
    startMs,
    toShotId,
    transitionId,
    userId,
  } = params
  const resolvedUserId = userId || 'long-take'
  const durationMs = Math.max(1, endMs - startMs)

  return withLongTakeContext({ projectId, userId: resolvedUserId }, () =>
    withActivityHeartbeat(async () => {
      const storage = createLongTakeStorage(projectId)
      const transitionUri = storage.getFullPath(
        `long_take/transitions/${transitionId}_static_hold.mp4`,
      )
      const { tempDir, firstFramePath, lastFramePath } = await prepareStaticHoldTempDir({
        projectId,
        transitionId,
      })
      const outputPath = path.join(tempDir, `static-hold-${transitionId}.mp4`)

      logger.info(
        `[long-take] Static-hold fallback transition starting ${formatLogFields({
          projectId,
          transitionId,
          fromShotId,
          toShotId,
          durationSeconds,
          durationMs,
          originalError,
        })}`,
      )

      try {
        await downloadAssetToLocal(firstFrameUri, firstFramePath)
        await downloadAssetToLocal(lastFrameUri, lastFramePath)

        const safeDurationSec = Math.max(0.1, durationMs / 1000)
        const halfDurationSec = Math.max(0.05, safeDurationSec / 2)
        // Per-project video resolution: when resolved, the clip is
        // normalized to the same pixel class as the model-generated clips --
        // including the clamp at the transition model's cap, so a 1080p
        // request with a 720p-capped model yields a 720p static-hold next to
        // 720p model clips. Absent => keyframe-native output (current
        // behavior).
        const requestedVideoResolution = resolveGenerationResolution({
          configured: generationResolution,
          projectId,
        }).videoResolution
        // The registry resolves an absent, legacy or unknown model to the
        // default transition role.
        const resolvedVideoResolution = requestedVideoResolution
          ? clampVideoResolution(requestedVideoResolution, transitionVideoModel)
          : undefined
        const dims = resolvedVideoResolution
          ? resolveVideoResolutionDimensions(
              resolvedVideoResolution,
              aspectRatio ?? DEFAULT_ASPECT_RATIO,
            )
          : undefined
        // xfade requires both inputs to be at least `offset + duration` long
        // -- duplicate each still frame for the full transition duration and
        // let xfade pick the crossfade window.
        await runFfmpeg(
          '-loop',
          '1',
          '-t',
          safeDurationSec.toFixed(3),
          '-i',
          firstFramePath,
          '-loop',
          '1',
          '-t',
          safeDurationSec.toFixed(3),
          '-i',
          lastFramePath,
          '-filter_complex',
          buildStaticHoldFilterComplex({ dims, halfDurationSec }),
          '-map',
          '[v]',
          '-c:v',
          STATIC_HOLD_FALLBACK_VIDEO_CODEC,
          '-b:v',
          STATIC_HOLD_FALLBACK_VIDEO_BITRATE,
          '-pix_fmt',
          'yuv420p',
          '-movflags',
          '+faststart',
          '-y',
          outputPath,
        )

        await uploadToStore(outputPath, transitionUri, { contentType: 'video/mp4' })

        logger.info(
          `[long-take] Static-hold fallback transition uploaded ${formatLogFields({
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
          usedFallback: true,
          videoUri: transitionUri,
        }
      } catch (fallbackErr) {
        const fallbackMessage =
          fallbackErr instanceof Error ? fallbackErr.message : String(fallbackErr)
        logger.error(
          `[long-take] Static-hold fallback transition FAILED ${formatLogFields({
            projectId,
            transitionId,
            fromShotId,
            toShotId,
            originalError,
            fallbackError: fallbackMessage,
          })}`,
        )
        throw fallbackErr
      } finally {
        await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
      }
    }),
  )
}
