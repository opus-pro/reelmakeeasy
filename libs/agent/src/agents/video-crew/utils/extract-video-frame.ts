// Helper function to extract video frame
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { Storage } from '@reelmakeeasy/common/agent-v2/storage/storage'
import { logger } from '@reelmakeeasy/common/logger'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import { getVideoDuration } from '@reelmakeeasy/common/utils/media'

import { execFileAsync } from '../../common/child-process'
import { resolveVideoPath } from '../../common/media/resolve-video-path'
import { isStoreUri } from '@reelmakeeasy/common/storage/stored-files'

/**
 * Extract a frame from video at specified time
 * @param videoPath Path to the video file (local path or store address starting with store://)
 * @param framePath Specific output path for the frame
 * @param frameTime Time in seconds to extract frame (default: 1 second)
 * @returns Promise<boolean> indicating success
 */
export async function extractVideoFrame(
  videoPath: string,
  framePath: string,
  frameTime = 1,
  storage?: Storage,
): Promise<boolean> {
  const useStorageForVideo = !!storage && !path.isAbsolute(videoPath) && !isStoreUri(videoPath)
  const useStorageForFrame = !!storage && !path.isAbsolute(framePath) && !isStoreUri(framePath)

  let localPath = videoPath
  let cleanup: () => Promise<void> = async () => undefined
  let cleanupFrame: () => Promise<void> = async () => undefined
  let localFramePath = framePath

  if (useStorageForVideo && storage) {
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'reelmakeeasy_video_'))
    // Set cleanup immediately after creating temp dir to ensure cleanup even if downloadFile fails
    cleanup = async () => {
      await fs.promises.rm(tempDir, { force: true, recursive: true })
    }
    localPath = path.join(tempDir, path.basename(videoPath))
    await storage.downloadFile(videoPath, localPath)
  } else {
    const resolved = await resolveVideoPath(videoPath)
    localPath = resolved.localPath
    cleanup = resolved.cleanup
  }

  if (useStorageForFrame) {
    const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'reelmakeeasy_frame_'))
    // Set cleanup immediately after creating temp dir to ensure cleanup on any error
    cleanupFrame = async () => {
      await fs.promises.rm(tempDir, { force: true, recursive: true })
    }
    localFramePath = path.join(tempDir, framePath)
  }

  try {
    // Get video duration and adjust frameTime if video is shorter than requested time
    const duration = await getVideoDuration(localPath)
    let actualFrameTime = frameTime
    if (duration > 0 && duration < frameTime) {
      // If video is shorter than frameTime, extract the middle frame
      actualFrameTime = duration / 2
      logger.info(
        { videoPath, duration, originalFrameTime: frameTime, actualFrameTime },
        'Video shorter than requested frameTime, using middle frame',
      )
    }

    // Ensure output directory exists
    fs.mkdirSync(path.dirname(localFramePath), { recursive: true })

    // Extract a frame from the video using ffmpeg
    let stderr: string | undefined
    try {
      const result = await execFileAsync('ffmpeg', [
        '-i',
        localPath,
        '-ss',
        actualFrameTime.toString(),
        '-frames:v',
        '1',
        '-q:v',
        '2', // High quality
        '-update',
        '1', // ensure single-image output across ffmpeg builds
        '-y', // Overwrite output
        localFramePath,
      ])
      stderr = result.stderr
    } catch (e) {
      const err = ensureError(e)
      logger.error(
        {
          error: err,
          videoPath,
          localPath,
          framePath: localFramePath,
          frameTime: actualFrameTime,
          duration,
        },
        'FFmpeg command failed',
      )
      throw new Error(
        `FFmpeg failed to extract frame: ${err.message}. videoPath=${videoPath}, frameTime=${actualFrameTime}, duration=${duration}`,
      )
    }

    if (stderr && stderr.includes('Error')) {
      logger.error(
        {
          stderr,
          videoPath,
          localPath,
          framePath: localFramePath,
          frameTime: actualFrameTime,
          duration,
        },
        'FFmpeg stderr contains error',
      )
      throw new Error(
        `FFmpeg error in stderr: ${stderr.slice(0, 500)}. videoPath=${videoPath}, frameTime=${actualFrameTime}`,
      )
    }

    const frameExists = fs.existsSync(localFramePath)
    if (!frameExists) {
      logger.error(
        { videoPath, localPath, framePath: localFramePath, frameTime: actualFrameTime, duration },
        'Extracted frame file does not exist after FFmpeg execution',
      )
      throw new Error(
        `Frame file was not created: ${localFramePath}. videoPath=${videoPath}, frameTime=${actualFrameTime}`,
      )
    }

    if (frameExists && storage && useStorageForFrame) {
      try {
        await storage.uploadFile(localFramePath, framePath)
      } catch (e) {
        const err = ensureError(e)
        logger.error(
          { error: err, localFramePath, framePath },
          'Failed to upload extracted frame to storage',
        )
        throw new Error(`Failed to upload frame to storage: ${err.message}`)
      }
    }

    return frameExists
  } catch (e) {
    const err = ensureError(e)
    logger.error(
      { error: err, videoPath, framePath, localPath, localFramePath },
      `Failed to extract video frame - errorMessage: ${err.message}, stack: ${err.stack}`,
    )
    return false
  } finally {
    // Always release any temp download created for remote inputs.
    await cleanup()
    await cleanupFrame()
  }
}

export { getVideoDuration }
