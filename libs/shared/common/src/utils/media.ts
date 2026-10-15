import { execFile } from 'node:child_process'
import fsSync from 'node:fs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { logger } from '../logger'

import { ensureError } from './error-handler'
import { downloadStoredFile, isStoreUri } from '../storage/stored-files'
import { RETIME_MAX_SPEED_MULTIPLIER, RETIME_MIN_SPEED_MULTIPLIER } from './retime-constants'

const execFileAsync = promisify(execFile)

const RENDER_OUTPUT_FPS = 24

// ---------------------------------------------------------------------------
// Image utilities
// ---------------------------------------------------------------------------

export async function convertImageToBase64(localPath: string): Promise<string> {
  const image: Buffer = await fs.readFile(localPath)
  return image.toString('base64')
}

export async function convertImageToBase64Uri(
  localPath: string,
  mimeType?: string,
): Promise<string> {
  mimeType ||= 'image/jpeg'
  const base64 = await convertImageToBase64(localPath)
  return `data:${mimeType};base64,${base64}`
}

// ---------------------------------------------------------------------------
// Video probe utilities
// ---------------------------------------------------------------------------

/**
 * Get video duration in seconds using ffprobe.
 * Prefers video stream duration; falls back to container duration.
 */
export async function getVideoDuration(videoPath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      videoPath,
    ])
    if (stdout) {
      const streamDuration = Number.parseFloat(stdout.trim())
      if (Number.isFinite(streamDuration) && streamDuration > 0) {
        return streamDuration
      }
    }
  } catch {
    logger.warn(
      `[getVideoDuration] Failed to get video stream duration for ${videoPath}, falling back to container duration`,
    )
  }

  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      videoPath,
    ])
    if (!stdout) {
      return 0
    }
    const duration = Number.parseFloat(stdout.trim())
    return Number.isFinite(duration) ? duration : 0
  } catch {
    return 0
  }
}

/**
 * Get the duration of a media file (audio or video) in milliseconds.
 * Accepts a local path or a store address (store://...). Returns undefined on failure
 * so the caller can fall back gracefully.
 *
 * Uses container-level format duration (not stream-level) so audio-only files
 * like MP3 voiceovers are probed cleanly without noisy video-stream warnings.
 */
export async function getMediaDurationMs(pathOrUri: string): Promise<number | undefined> {
  let localPath = pathOrUri
  let tempPath: string | undefined
  try {
    if (isStoreUri(pathOrUri)) {
      tempPath = path.join(
        os.tmpdir(),
        `media-duration-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      )
      await downloadStoredFile(pathOrUri, tempPath)
      localPath = tempPath
    }
    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      localPath,
    ])
    const durationSec = Number.parseFloat(stdout.trim())
    if (!Number.isFinite(durationSec) || durationSec <= 0) {
      return undefined
    }
    return Math.ceil(durationSec * 1000)
  } catch (err) {
    logger.warn(`[getMediaDurationMs] Failed to probe ${pathOrUri}: ${ensureError(err).message}`)
    return undefined
  } finally {
    if (tempPath) {
      fs.unlink(tempPath).catch(() => undefined)
    }
  }
}

/**
 * Get video frame rate (fps) using ffprobe.
 */
export async function getVideoFrameRate(videoPath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'error',
      '-select_streams',
      'v:0',
      '-show_entries',
      'stream=avg_frame_rate',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      videoPath,
    ])
    const value = stdout.trim()
    if (!value) {
      return 0
    }
    const [num, den] = value.split('/')
    const numerator = Number.parseFloat(num)
    const denominator = den ? Number.parseFloat(den) : 1
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
      return 0
    }
    const fps = numerator / denominator
    return Number.isFinite(fps) && fps > 0 ? fps : 0
  } catch {
    return 0
  }
}

// ---------------------------------------------------------------------------
// Video speed adjustment
// ---------------------------------------------------------------------------

async function probeHasAudioStream(videoPath: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v',
      'quiet',
      '-show_streams',
      '-select_streams',
      'a',
      '-of',
      'csv=p=0',
      videoPath,
    ])
    return stdout.trim().length > 0
  } catch (probeError) {
    logger.warn(`Could not probe audio streams, assuming no audio: ${probeError}`)
    return false
  }
}

/**
 * Apply speed adjustment to a video file using ffmpeg.
 */
export async function applyVideoSpeedUp(
  inputVideoPath: string,
  outputVideoPath: string,
  speedMultiplier = 1.3,
  options: { dropFirstFrame?: boolean; outputFps?: number } = {},
): Promise<boolean> {
  logger.info(`Applying ${speedMultiplier}x speed increase to video...`)

  try {
    const tempOutputPath = `${outputVideoPath}.temp.mp4`

    const hasAudio = await probeHasAudioStream(inputVideoPath)

    const videoFilters: string[] = []
    if (options.dropFirstFrame) {
      videoFilters.push("select='not(eq(n,0))'", 'setpts=PTS-STARTPTS')
    }
    videoFilters.push(`setpts=PTS/${speedMultiplier}`)
    if (options.outputFps && options.outputFps > 0) {
      videoFilters.push(`fps=${options.outputFps}`)
    }

    const ffmpegArgs = ['-i', inputVideoPath, '-filter:v', videoFilters.join(',')]

    if (hasAudio) {
      ffmpegArgs.push('-filter:a', `atempo=${speedMultiplier}`)
    } else {
      ffmpegArgs.push('-an')
    }

    ffmpegArgs.push('-y', tempOutputPath)

    await execFileAsync('ffmpeg', ffmpegArgs)

    await fs.rename(tempOutputPath, outputVideoPath)

    logger.info(`Successfully applied ${speedMultiplier}x speed increase`)
    return true
  } catch (error) {
    logger.warn(`Failed to apply speed increase: ${error}`)

    const tempOutputPath = `${outputVideoPath}.temp.mp4`
    if (fsSync.existsSync(tempOutputPath)) {
      fsSync.unlinkSync(tempOutputPath)
    }

    return false
  }
}

/**
 * Apply speed adjustment to a video file in-place with backup handling.
 */
export async function applyVideoSpeedUpInPlace(
  videoPath: string,
  speedMultiplier = 1.3,
  options: { dropFirstFrame?: boolean; outputFps?: number } = {},
): Promise<boolean> {
  const tempPath = `${videoPath}.temp.mp4`
  const backupPath = `${videoPath}.backup.mp4`

  try {
    await fs.copyFile(videoPath, backupPath)

    const success = await applyVideoSpeedUp(videoPath, tempPath, speedMultiplier, options)

    if (success) {
      fsSync.renameSync(tempPath, videoPath)
      fsSync.unlinkSync(backupPath)
      return true
    }
    fsSync.renameSync(backupPath, videoPath)
    return false
  } catch (error) {
    logger.warn(`Failed to apply in-place speed increase: ${error}`)

    if (fsSync.existsSync(tempPath)) {
      fsSync.unlinkSync(tempPath)
    }

    if (fsSync.existsSync(backupPath)) {
      fsSync.renameSync(backupPath, videoPath)
    }

    return false
  }
}

// ---------------------------------------------------------------------------
// Transition retime
// ---------------------------------------------------------------------------

export { RETIME_MAX_SPEED_MULTIPLIER, RETIME_MIN_SPEED_MULTIPLIER }

export function resolveRetimePlan(params: {
  adjustedDuration: number
  /** Speed-up cap; `RETIME_MAX_SPEED_MULTIPLIER` unless a caller wants faster clips. */
  maxSpeedMultiplier?: number
  targetDuration: number
}): {
  clampedMultiplier: number
  residual: 'none' | 'pad' | 'trim'
} {
  const maxSpeed = params.maxSpeedMultiplier ?? RETIME_MAX_SPEED_MULTIPLIER
  const raw = params.adjustedDuration / params.targetDuration
  if (raw > maxSpeed) {
    return { clampedMultiplier: maxSpeed, residual: 'trim' }
  }
  if (raw < RETIME_MIN_SPEED_MULTIPLIER) {
    return { clampedMultiplier: RETIME_MIN_SPEED_MULTIPLIER, residual: 'pad' }
  }
  return { clampedMultiplier: raw, residual: 'none' }
}

/**
 * Force a video to an exact duration in-place after a clamped-speed retime
 * still leaves a residual gap: trim the tail if it runs long, or freeze the
 * last frame (and pad audio) if it runs short.
 */
async function applyRetimeResidualFixInPlace(
  videoPath: string,
  targetDuration: number,
  residual: 'pad' | 'trim',
): Promise<boolean> {
  const tempPath = `${videoPath}.temp.mp4`
  const backupPath = `${videoPath}.backup.mp4`

  try {
    await fs.copyFile(videoPath, backupPath)

    const hasAudio = await probeHasAudioStream(videoPath)
    const ffmpegArgs = ['-i', videoPath]

    if (residual === 'trim') {
      ffmpegArgs.push('-t', `${targetDuration}`)
    } else {
      const currentDuration = await getVideoDuration(videoPath)
      const padDuration = Math.max(0, targetDuration - currentDuration)
      ffmpegArgs.push('-filter:v', `tpad=stop_mode=clone:stop_duration=${padDuration}`)
      if (hasAudio) {
        ffmpegArgs.push('-filter:a', 'apad')
      }
      ffmpegArgs.push('-t', `${targetDuration}`)
    }

    if (!hasAudio) {
      ffmpegArgs.push('-an')
    }

    ffmpegArgs.push('-y', tempPath)

    await execFileAsync('ffmpeg', ffmpegArgs)

    fsSync.renameSync(tempPath, videoPath)
    fsSync.unlinkSync(backupPath)
    return true
  } catch (error) {
    logger.warn(`Failed to apply retime residual fix: ${error}`)

    if (fsSync.existsSync(tempPath)) {
      fsSync.unlinkSync(tempPath)
    }
    if (fsSync.existsSync(backupPath)) {
      fsSync.renameSync(backupPath, videoPath)
    }

    return false
  }
}

/**
 * Retime a transition video to match the target duration, optionally dropping
 * the first frame to avoid duplication at shot boundaries.
 */
/**
 * Saves the last frame of a video as a PNG. Chained transitions start the next
 * clip from it, so it must be the frame that actually plays last.
 */
export async function extractLastFrame(videoPath: string, outputPath: string): Promise<void> {
  // Seek close to the end and keep overwriting one image: the last write is the final frame.
  await execFileAsync('ffmpeg', [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-sseof',
    '-0.5',
    '-i',
    videoPath,
    '-update',
    '1',
    outputPath,
  ])
  const stat = await fs.stat(outputPath).catch(() => undefined)
  if (!stat?.size) throw new Error(`Could not extract the last frame of ${videoPath}`)
}

export async function retimeTransitionVideoIfNeeded(params: {
  filePath: string
  /** Speed-up cap for this clip; the Dynamic camera style allows faster play than the default. */
  maxSpeedMultiplier?: number
  shouldDropFirstFrame: boolean
  targetDuration: number
  transitionId: string
}): Promise<void> {
  const { filePath, maxSpeedMultiplier, shouldDropFirstFrame, targetDuration, transitionId } =
    params
  const actualDuration = await getVideoDuration(filePath)
  if (actualDuration <= 0) {
    return
  }

  const inputFps = (await getVideoFrameRate(filePath)) || RENDER_OUTPUT_FPS
  const frameDuration = shouldDropFirstFrame ? 1 / inputFps : 0
  const adjustedDuration = Math.max(0.001, actualDuration - frameDuration)
  const speedMultiplier = adjustedDuration / targetDuration
  const delta = Math.abs(adjustedDuration - targetDuration)
  if (!(speedMultiplier > 0 && (shouldDropFirstFrame || delta >= 0.05))) {
    return
  }

  const { clampedMultiplier, residual } = resolveRetimePlan({
    adjustedDuration,
    maxSpeedMultiplier,
    targetDuration,
  })

  const applied = await applyVideoSpeedUpInPlace(filePath, clampedMultiplier, {
    dropFirstFrame: shouldDropFirstFrame,
    outputFps: RENDER_OUTPUT_FPS,
  })
  if (!applied) {
    logger.error(
      `[retime] Failed to retime transition ${transitionId}: actual=${actualDuration}s target=${targetDuration}s multiplier=${clampedMultiplier}`,
    )
    return
  }

  if (residual === 'none') {
    return
  }

  // On residual-fix failure the file keeps the clamped-speed intermediate:
  // its duration is strictly closer to the slot than the pre-retime original,
  // so restoring further back would only widen the gap the metric reports.
  const residualFixed = await applyRetimeResidualFixInPlace(filePath, targetDuration, residual)
  if (!residualFixed) {
    logger.error(
      `[retime] Failed to fix retime residual for transition ${transitionId}: target=${targetDuration}s residual=${residual}`,
    )
    return
  }

  logger.info(
    `[retime] Clamped transition ${transitionId} speed: raw=${speedMultiplier} clamped=${clampedMultiplier} residual=${residual}`,
  )
}
