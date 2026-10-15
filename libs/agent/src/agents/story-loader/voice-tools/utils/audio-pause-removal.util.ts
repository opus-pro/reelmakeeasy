import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

import { logger } from '@reelmakeeasy/common/logger'

const execFileAsync = promisify(execFile)

/**
 * Normalizes audio loudness to a consistent target level using FFmpeg's loudnorm filter.
 * This makes silence detection more consistent across files with varying volume levels.
 *
 * @param audioPath - Path to input audio file (will be replaced with normalized version)
 * @param targetLUFS - Target loudness in LUFS (default: -16, standard for podcasts/speech)
 * @returns Promise<boolean> - true if normalization was applied successfully
 */
export async function normalizeAudioLoudness(
  audioPath: string,
  targetLUFS = -16,
): Promise<boolean> {
  if (!fs.existsSync(audioPath)) {
    logger.warn(`Audio file not found for normalization: ${audioPath}`)
    return false
  }

  const originalExt = path.extname(audioPath)
  const tempPath = `${audioPath}.normalized${originalExt}`

  try {
    const ffmpegArgs = ['-y', '-i', audioPath, '-af', `loudnorm=I=${targetLUFS}:TP=-1.5:LRA=11`]

    // Preserve original format
    if (originalExt === '.mp3') {
      ffmpegArgs.push('-c:a', 'libmp3lame', '-b:a', '128k')
    } else if (originalExt === '.wav') {
      ffmpegArgs.push('-c:a', 'pcm_s16le')
    } else if (originalExt === '.m4a') {
      ffmpegArgs.push('-c:a', 'aac', '-b:a', '128k')
    } else if (originalExt === '.webm') {
      ffmpegArgs.push('-c:a', 'libopus', '-b:a', '128k')
    } else {
      ffmpegArgs.push('-c:a', 'libmp3lame', '-b:a', '128k')
    }

    ffmpegArgs.push(tempPath)

    await execFileAsync('ffmpeg', ffmpegArgs)

    // Replace original with normalized version
    await fs.promises.unlink(audioPath)
    await fs.promises.rename(tempPath, audioPath)

    logger.info(`Normalized audio loudness to ${targetLUFS} LUFS: ${audioPath}`)
    return true
  } catch (error) {
    logger.warn(
      `Audio loudness normalization failed: ${error instanceof Error ? error.message : String(error)}`,
    )

    // Clean up temp file if it exists
    if (fs.existsSync(tempPath)) {
      await fs.promises.unlink(tempPath)
    }

    return false
  }
}

/**
 * In-place audio pause removal with more conservative settings for uploaded files.
 * This version is specifically tuned for user-uploaded audio files and handles low-volume audio better.
 * Normalizes loudness before silence removal for consistent results.
 */
export async function removeAudioPausesInPlace(
  audioPath: string,
  maxPauseDuration = 0.5,
  // audio below this level is considered silence
  silenceThreshold = -50,
): Promise<boolean> {
  // Normalize loudness first for consistent silence detection
  await normalizeAudioLoudness(audioPath)

  return removeAudioPausesWithThreshold(audioPath, maxPauseDuration, silenceThreshold)
}

/**
 * Removes audio pauses with a custom silence threshold.
 * This allows for more fine-tuned control over what is considered "silence".
 *
 * @param audioPath - Path to input audio file
 * @param maxPauseDuration - Maximum pause duration in seconds
 * @param silenceThreshold - Silence threshold in dB (e.g., -30, -50, -60)
 * @returns Promise<boolean> - true if processing was applied, false if no changes needed
 */
export async function removeAudioPausesWithThreshold(
  audioPath: string,
  maxPauseDuration = 0.3,
  silenceThreshold = -50,
): Promise<boolean> {
  if (!fs.existsSync(audioPath)) {
    logger.warn(`Audio file not found: ${audioPath}`)
    return false
  }

  const originalExt = path.extname(audioPath)
  const tempPath = `${audioPath}.paused_removed${originalExt}`

  try {
    // Use FFmpeg silenceremove filter to remove pauses longer than maxPauseDuration
    // and trim them down to maxPauseDuration
    const ffmpegArgs = [
      '-y',
      '-i',
      audioPath,
      '-af',
      `silenceremove=stop_periods=-1:stop_duration=${maxPauseDuration}:stop_threshold=${silenceThreshold}dB`,
    ]

    // Preserve original format when possible, fallback to MP3 for unsupported formats
    if (originalExt === '.mp3') {
      ffmpegArgs.push('-c:a', 'libmp3lame', '-b:a', '128k')
    } else if (originalExt === '.wav') {
      ffmpegArgs.push('-c:a', 'pcm_s16le')
    } else if (originalExt === '.m4a') {
      ffmpegArgs.push('-c:a', 'aac', '-b:a', '128k')
    } else if (originalExt === '.webm') {
      ffmpegArgs.push('-c:a', 'libopus', '-b:a', '128k')
    } else {
      // Fallback to MP3 for other formats
      ffmpegArgs.push('-c:a', 'libmp3lame', '-b:a', '128k')
    }

    ffmpegArgs.push(tempPath)

    await execFileAsync('ffmpeg', ffmpegArgs)

    // Check if the processed file is different from original
    const originalStats = fs.statSync(audioPath)
    const processedStats = fs.statSync(tempPath)

    // If file size changed significantly, replace original
    if (Math.abs(originalStats.size - processedStats.size) > 1024) {
      await fs.promises.unlink(audioPath)
      await fs.promises.rename(tempPath, audioPath)

      logger.info(
        `Removed audio pauses >${maxPauseDuration}s (threshold: ${silenceThreshold}dB) from ${audioPath}`,
      )
      return true
    }
    // No significant changes, clean up temp file
    await fs.promises.unlink(tempPath)
    logger.info(`No significant pauses found in ${audioPath} (threshold: ${silenceThreshold}dB)`)
    return false
  } catch (error) {
    logger.warn(
      `Audio pause removal failed: ${error instanceof Error ? error.message : String(error)}`,
    )

    // Clean up temp file if it exists
    if (fs.existsSync(tempPath)) {
      await fs.promises.unlink(tempPath)
    }

    return false
  }
}

/**
 * Transcodes and compresses an audio file in-place using FFmpeg.
 * Default target: MP3, mono, 44.1kHz, 128kbps.
 *
 * The function writes to a temporary file next to the input and replaces the original on success.
 *
 * @param audioPath - Path to input audio file (will be replaced on success)
 * @param options - Optional transcoding options
 * @returns Promise<boolean> - true if processing was applied and file replaced, false otherwise
 */
export async function transcodeAudioInPlace(
  audioPath: string,
  options?: {
    bitrateKbps?: number
    channels?: number
    codec?: 'aac' | 'libmp3lame'
    sampleRate?: number
  },
): Promise<boolean> {
  if (!fs.existsSync(audioPath)) {
    logger.warn(`Audio file not found for transcode: ${audioPath}`)
    return false
  }

  const bitrateKbps = Math.max(16, Math.trunc(options?.bitrateKbps ?? 128))
  const channels = Math.max(1, Math.trunc(options?.channels ?? 1))
  const sampleRate = Math.max(8000, Math.trunc(options?.sampleRate ?? 44100))
  const codec = options?.codec ?? 'libmp3lame'

  const tempPath = `${audioPath}.transcoded.mp3`

  try {
    const before = fs.statSync(audioPath)?.size ?? 0

    await execFileAsync('ffmpeg', [
      '-y',
      '-i',
      audioPath,
      '-vn',
      '-ac',
      String(channels),
      '-ar',
      String(sampleRate),
      '-c:a',
      codec,
      '-b:a',
      `${bitrateKbps}k`,
      tempPath,
    ])

    const after = fs.statSync(tempPath)?.size ?? 0

    // Replace original with transcoded output
    await fs.promises.unlink(audioPath)
    await fs.promises.rename(tempPath, audioPath)

    logger.info(
      `Transcoded audio in-place: ${audioPath} (before=${(before / (1024 * 1024)).toFixed(3)}MB, after=${(after / (1024 * 1024)).toFixed(3)}MB, codec=${codec}, br=${bitrateKbps}k, ch=${channels}, sr=${sampleRate})`,
    )
    return true
  } catch (error) {
    logger.warn(`Audio transcode failed: ${error instanceof Error ? error.message : String(error)}`)
    // Clean up temp file if it exists
    if (fs.existsSync(tempPath)) {
      try {
        await fs.promises.unlink(tempPath)
      } catch {
        // ignore
      }
    }
    return false
  }
}
