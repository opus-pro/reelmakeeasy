import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { downloadStoredFile } from '@reelmakeeasy/common/storage/stored-files'
import ffmpeg from 'fluent-ffmpeg'

/**
 * Get audio duration in seconds from a file on local disk (e.g. after downloading from storage).
 */
export function getAudioDurationSecondsFromFile(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err: Error | null, metadata: ffmpeg.FfprobeData) => {
      if (err) {
        reject(err)
        return
      }
      const duration = metadata?.format?.duration
      if (duration == null || !Number.isFinite(duration)) {
        reject(new Error('No duration in audio metadata'))
        return
      }
      resolve(duration)
    })
  })
}

/**
 * Get audio duration in seconds from an in-memory audio buffer.
 * Writes to a temp file because ffprobe expects a path.
 */
export async function getAudioDurationSecondsFromBuffer(
  buffer: Buffer,
  extension = '.mp3',
): Promise<number> {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'audio-duration-'))
  const safeExtension = extension.startsWith('.') ? extension : `.${extension}`
  const tempPath = path.join(tempDir, `audio${safeExtension}`)

  try {
    await fs.promises.writeFile(tempPath, buffer)
    return await getAudioDurationSecondsFromFile(tempPath)
  } finally {
    await fs.promises.rm(tempDir, { force: true, recursive: true })
  }
}

/**
 * Get audio duration in seconds from a stored file.
 * Downloads the file to a temp path, runs ffprobe, then removes the temp file.
 */
export async function getAudioDurationSecondsFromStore(fileUri: string): Promise<number> {
  const tempPath = path.join(
    os.tmpdir(),
    `audio-duration-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  try {
    await downloadStoredFile(fileUri, tempPath)
    return await getAudioDurationSecondsFromFile(tempPath)
  } finally {
    try {
      await fs.promises.unlink(tempPath)
    } catch {
      // ignore cleanup errors
    }
  }
}
