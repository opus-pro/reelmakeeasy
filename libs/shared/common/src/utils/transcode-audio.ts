import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { logger } from '../logger'

import { runFfmpeg } from './cmdline'
import { ensureError } from './error-handler'
import {
  downloadStoredFile,
  isStoreUri,
  storedFileExists,
  uploadToStore,
} from '../storage/stored-files'

interface TranscodeOptions {
  bitrate?: string
  sampleRate?: string
  skipIfExists?: boolean
}

async function checkOutputExists(outputPath: string, isStored: boolean): Promise<boolean> {
  if (isStored) {
    try {
      return await storedFileExists(outputPath)
    } catch {
      return false
    }
  }
  return fs.existsSync(outputPath)
}

function cleanupDirectory(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    return
  }

  try {
    const files = fs.readdirSync(dirPath)
    for (const file of files) {
      cleanupFile(path.join(dirPath, file))
    }
    fs.rmdirSync(dirPath)
  } catch (error) {
    logger.warn(
      {
        dirPath,
        error: ensureError(error).message,
      },
      'Failed to cleanup temp directory',
    )
  }
}

function cleanupFile(filePath: string): void {
  if (fs.existsSync(filePath)) {
    try {
      fs.unlinkSync(filePath)
    } catch {
      // ignore cleanup errors
    }
  }
}

function formatFileSize(bytes: number): string | undefined {
  return bytes > 0 ? `${(bytes / (1024 * 1024)).toFixed(3)}MB` : undefined
}

function getFileSize(filePath: string): number {
  try {
    return fs.statSync(filePath).size
  } catch {
    return 0
  }
}

async function prepareInput(
  inputPath: string,
  isStored: boolean,
  localPath: string,
): Promise<void> {
  if (isStored) {
    await downloadStoredFile(inputPath, localPath)
  } else if (!fs.existsSync(localPath)) {
    throw new Error(`Input file not found: ${inputPath}`)
  }
}

async function uploadOutput(
  localPath: string,
  outputPath: string,
  isStored: boolean,
): Promise<void> {
  if (isStored) {
    await uploadToStore(localPath, outputPath)
  }
}

/**
 * Transcode audio file to M4A (AAC) format for better WASM/browser compatibility
 * Supports both local file paths and store addresses (store://)
 *
 * @param inputPath - Full path to input audio file (e.g., MP3) or store address (store://path/to/file.mp3)
 * @param outputPath - Full path to output M4A file or store address (store://path/to/file.m4a)
 * @param options - Transcode options
 * @returns Success status and output URI (if storage)
 */
export async function transcodeAudioToM4a(
  inputPath: string,
  outputPath: string,
  options?: TranscodeOptions,
): Promise<boolean> {
  const { bitrate = '128k', sampleRate = '44100', skipIfExists = true } = options || {}
  const isStoredInput = isStoreUri(inputPath)
  const isStoredOutput = isStoreUri(outputPath)

  if (!isStoredInput || !isStoredOutput) {
    logger.error(
      {
        inputPath,
        outputPath,
      },
      'Invalid input/output paths: must be a store address',
    )
    return false
  }

  if (skipIfExists) {
    const exists = await checkOutputExists(outputPath, isStoredOutput)
    if (exists) {
      logger.info(
        {
          inputPath,
          outputPath,
          reason: 'output_already_exists',
        },
        'Skipping transcode: output file already exists',
      )
      return true
    }
  }

  const tempDir =
    isStoredInput || isStoredOutput
      ? fs.mkdtempSync(path.join(os.tmpdir(), 'transcode-'))
      : undefined
  const localInputPath = isStoredInput
    ? path.join(tempDir ?? '', path.basename(inputPath))
    : inputPath
  const localOutputPath = isStoredOutput
    ? path.join(tempDir ?? '', path.basename(outputPath))
    : outputPath

  try {
    await prepareInput(inputPath, isStoredInput, localInputPath)

    const inputSize = getFileSize(localInputPath)
    logger.info(
      {
        inputPath,
        outputPath,
        bitrate,
        sampleRate,
        inputSize: formatFileSize(inputSize),
      },
      'Starting audio transcode to M4A',
    )

    await runFfmpeg(
      '-i',
      localInputPath,
      // Drop any embedded video stream (e.g. ID3 APIC album art); the m4a
      // (ipod) muxer rejects mjpeg, which silently leaves us with mp3 only.
      '-vn',
      '-c:a',
      'aac',
      '-b:a',
      bitrate,
      '-ar',
      sampleRate,
      '-movflags',
      '+faststart',
      localOutputPath,
    )

    if (!fs.existsSync(localOutputPath)) {
      throw new Error('FFmpeg conversion completed but output file not found')
    }

    const outputSize = getFileSize(localOutputPath)
    await uploadOutput(localOutputPath, outputPath, isStoredOutput)

    logger.info(
      {
        inputPath,
        outputPath,
        inputSize: formatFileSize(inputSize),
        outputSize: formatFileSize(outputSize),
        bitrate,
        sampleRate,
      },
      'Successfully transcoded audio to M4A',
    )

    return true
  } catch (error) {
    cleanupFile(localOutputPath)
    logger.error(
      {
        inputPath,
        outputPath,
        bitrate,
        sampleRate,
        error: ensureError(error),
      },
      'Failed to transcode audio to M4A',
    )
    return false
  } finally {
    if (tempDir) {
      cleanupFile(localInputPath)
      cleanupFile(localOutputPath)
      cleanupDirectory(tempDir)
    }
  }
}
