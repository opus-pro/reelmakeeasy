import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'

import { BadRequestException } from '@nestjs/common'
import type { Logger } from '@reelmakeeasy/common/logger'
import { getStoryModeUserLimits } from '@reelmakeeasy/common/story-mode/user-limits'
import { UserInfo } from '@reelmakeeasy/common/types/user'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'

import { validateUserTmpAudioPath } from './voiceover-audio-script.util'
import {
  generateStoryModeAudioScript,
  StoryModeAudioDurationExceededError,
} from '../util/extract-audio-from-video'

const STORY_MODE_AUDIO_SCRIPT_MISSING_ERROR_MESSAGE =
  'The downloaded audio file does not contain a script. Please upload another file or delete the current one.'

export async function generateAudioScriptPreview(
  logger: Logger,
  params: { audioUri: string; user: UserInfo },
): Promise<{ script: string }> {
  const normalizedAudioStorePath = params.audioUri?.trim() || ''
  if (!normalizedAudioStorePath) {
    throw new BadRequestException('Audio path is required')
  }
  const { object } = validateUserTmpAudioPath(
    normalizedAudioStorePath,
    params.user.userId || params.user.sub || '',
    'story-mode-audio',
    {
      invalidUser: 'Invalid user context',
      notOwned: 'Audio file must be uploaded by current user',
      notWorkspace: 'Audio file must be uploaded to workspace storage',
    },
  )

  const audioUserLimits = getStoryModeUserLimits()
  const tempDir = await mkdtemp(`${os.tmpdir()}/long-take-audio-preview-`)
  try {
    const script = await generateStoryModeAudioScript({
      fileUri: normalizedAudioStorePath,
      objectKey: object,
      tempDir,
      limits: audioUserLimits,
    })
    if (!script) {
      throw new BadRequestException(STORY_MODE_AUDIO_SCRIPT_MISSING_ERROR_MESSAGE)
    }
    return { script }
  } catch (error) {
    if (error instanceof BadRequestException) {
      throw error
    }
    if (error instanceof StoryModeAudioDurationExceededError) {
      throw new BadRequestException(error.message)
    }
    const err = ensureError(error)
    logger.warn(
      `Failed to generate Story Mode audio script preview ${JSON.stringify({
        audioUri: normalizedAudioStorePath,
        error: { message: err.message, name: err.name },
        userId: params.user.userId || params.user.sub || 'unknown',
      })}`,
    )
    throw new BadRequestException('Failed to generate transcript from audio')
  } finally {
    await rm(tempDir, { force: true, recursive: true })
  }
}
