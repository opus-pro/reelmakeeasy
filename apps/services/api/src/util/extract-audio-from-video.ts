import { ProjectStore } from '@reelmakeeasy/common/agent-v2/storage/project-store'
import { generateASRTranscription } from '@reelmakeeasy/common/asr/elevenlabs'
import { Logger } from '@reelmakeeasy/common/logger'
import {
  getStoryModeUserLimits,
  type StoryModeUserLimits,
} from '@reelmakeeasy/common/story-mode/user-limits'
import type { UserInfo } from '@reelmakeeasy/common/types/user'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import { downloadStoredFile, isStoreUri } from '@reelmakeeasy/common/storage/stored-files'
import ffmpeg from 'fluent-ffmpeg'

import { extractAudioScriptFromAsr } from '../long-take/long-take-workflow.util'

import { getAudioDurationSecondsFromFile, getAudioDurationSecondsFromStore } from './audio-duration'

const logger = new Logger('extract-audio-from-video')

/** Limits the audio cap enforcement / messaging needs from the user's tier. */
type AudioLimits = Pick<StoryModeUserLimits, 'audioUploadDisplayMinutes' | 'maxAudioUploadSeconds'>

/**
 * Thrown when a Story Mode audio source exceeds the per-user duration cap.
 * Carries the gate-aware, user-facing message (the marketed cap varies by
 * feature gate) so callers can surface `error.message` directly.
 */
export class StoryModeAudioDurationExceededError extends Error {
  constructor(maxDisplayMinutes: number) {
    super(`Story Mode audio must be ${maxDisplayMinutes} minutes or less.`)
    this.name = 'StoryModeAudioDurationExceededError'
  }
}

/**
 * Video container extensions recognized as Story Mode audio sources. Kept
 * here (and mirrored on the web client in `omni-chat-box-helpers.tsx`) so
 * the server can decide whether a downloaded file needs audio extraction.
 */
const VIDEO_EXTENSIONS = new Set(['avi', 'm4v', 'mkv', 'mov', 'mp4', 'mpeg', 'mpg', 'webm'])

export async function getStoryModeAudioDurationLimitMessage(params: {
  audioPath: string | undefined
  projectId: string
  user: UserInfo
}): Promise<null | string> {
  const { audioPath, projectId, user } = params
  if (!audioPath) {
    return null
  }

  const limits = getStoryModeUserLimits()
  const audioStoreUri = isStoreUri(audioPath)
    ? audioPath
    : new ProjectStore(projectId).getFullPath(audioPath)

  try {
    const durationSeconds = await getAudioDurationSecondsFromStore(audioStoreUri)
    return durationSeconds > limits.maxAudioUploadSeconds
      ? new StoryModeAudioDurationExceededError(limits.audioUploadDisplayMinutes).message
      : null
  } catch (probeError) {
    logger.warn(
      `Failed to validate Story Mode audio duration before start ${JSON.stringify({
        audioStoreUri,
        error: { message: ensureError(probeError).message },
        projectId,
        userId: user.userId || user.sub || 'unknown',
      })}`,
    )
    return null
  }
}

export function isVideoExtension(extension: string): boolean {
  return VIDEO_EXTENSIONS.has(extension.toLowerCase().replace(/^\./, ''))
}

/**
 * Extract the audio track of a video file to an mp3 on local disk.
 * Produces an mp3 via libmp3lame; `-vn` strips the video track.
 */
export function extractAudioTrackToMp3(inputPath: string, outputMp3Path: string): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg(inputPath)
      .noVideo()
      .audioCodec('libmp3lame')
      .format('mp3')
      .on('error', (err: Error) => reject(err))
      .on('end', () => resolve())
      .save(outputMp3Path)
  })
}

/**
 * Derive a safe source extension from a stored file key. Uses the
 * basename only so earlier dots in the key (e.g. `tmp/john.doe/...`)
 * don't leak into the extension. Falls back to `bin` for extensionless
 * or non-alphanumeric results.
 */
export function deriveSafeSourceExtension(objectKey: string): {
  extension: string
  safeExt: string
} {
  const lastSlashIdx = objectKey.lastIndexOf('/')
  const basename = lastSlashIdx === -1 ? objectKey : objectKey.slice(lastSlashIdx + 1)
  const lastDotIdx = basename.lastIndexOf('.')
  const extension = lastDotIdx > 0 ? basename.slice(lastDotIdx + 1).toLowerCase() : ''
  const safeExt = /^[a-z0-9]+$/.test(extension) ? extension : 'bin'
  return { extension, safeExt }
}

/**
 * Download a Story Mode audio source from storage into `tempDir`, enforce
 * the max-duration cap via ffprobe, extract the audio track to mp3 when
 * the source is a video container, and run ASR to produce the script.
 * Throws `StoryModeAudioDurationExceededError` when the probed duration
 * exceeds `limits.maxAudioUploadSeconds`. Probe failures are logged as
 * warnings and treated as "cap not enforceable here"; the caller should
 * rely on other validations in that case.
 */
export async function generateStoryModeAudioScript(params: {
  objectKey: string
  fileUri: string
  limits: AudioLimits
  tempDir: string
}): Promise<string> {
  const { fileUri, objectKey, tempDir, limits } = params
  const { extension, safeExt } = deriveSafeSourceExtension(objectKey)
  const downloadedPath = `${tempDir}/source.${safeExt}`
  const asrInputPath = `${tempDir}/voice_over.mp3`

  await downloadStoredFile(fileUri, downloadedPath)

  let durationSeconds: null | number = null
  try {
    durationSeconds = await getAudioDurationSecondsFromFile(downloadedPath)
  } catch (probeError) {
    logger.warn(
      `Failed to probe duration for Story Mode audio ${JSON.stringify({
        fileUri,
        error: { message: ensureError(probeError).message },
      })}`,
    )
  }
  if (durationSeconds !== null && durationSeconds > limits.maxAudioUploadSeconds) {
    throw new StoryModeAudioDurationExceededError(limits.audioUploadDisplayMinutes)
  }

  let localAudioPath = downloadedPath
  if (isVideoExtension(extension)) {
    await extractAudioTrackToMp3(downloadedPath, asrInputPath)
    localAudioPath = asrInputPath
  }
  const asrResult = await generateASRTranscription(localAudioPath)
  return extractAudioScriptFromAsr(asrResult)
}
