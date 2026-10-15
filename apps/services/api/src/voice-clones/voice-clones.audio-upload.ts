import { randomUUID } from 'node:crypto'
import fs from 'node:fs'

import { removeAudioPausesInPlace } from '@agent-lib/agents/story-loader/voice-tools/utils/audio-pause-removal.util'
import { logger } from '@reelmakeeasy/common/logger'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import { storeUri, uploadToStore } from '@reelmakeeasy/common/storage/stored-files'
import { BadRequestException } from '@nestjs/common'

import { AUDIO_VALIDATION, validateUploadedFile } from '../common/validation/file-validation'

import { convertToMp3, getAudioDuration, getMimeTypeFromExtension } from './voice-clones.utils'

export async function uploadVoiceCloneFile(
  fileBuffer: Buffer,
  userId: string,
  originalFileName: string,
) {
  const fileForValidation = {
    buffer: fileBuffer,
    mimetype: getMimeTypeFromExtension(originalFileName),
    originalname: originalFileName,
    size: fileBuffer.length,
  }

  await validateUploadedFile(fileForValidation, AUDIO_VALIDATION)

  const fileExtension = originalFileName.split('.').pop()?.toLowerCase() || 'mp3'
  const fileName = `${randomUUID()}-voice-sample.${fileExtension}`
  const fileKey = `voice-clones/${userId}/${fileName}`
  const tempFilePath = `/tmp/${fileName}`

  try {
    await fs.promises.writeFile(tempFilePath, fileBuffer)
    await uploadToStore(tempFilePath, storeUri(fileKey))
  } finally {
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath)
    }
  }

  logger.info(
    { fileKey, userId, fileId: fileName },
    '[VoiceClone] Voice sample uploaded to storage',
  )

  return {
    fileId: fileName,
    fileUri: storeUri(fileKey),
    message: 'File uploaded successfully',
  }
}

export async function validateVoiceCloneAudioFile(fileBuffer: Buffer, originalFileName: string) {
  const fileForValidation = {
    buffer: fileBuffer,
    mimetype: getMimeTypeFromExtension(originalFileName),
    originalname: originalFileName,
    size: fileBuffer.length,
  }

  await validateUploadedFile(fileForValidation, AUDIO_VALIDATION)

  const fileExtension = originalFileName.split('.').pop()?.toLowerCase() || 'mp3'
  const needsConversion = ['m4a', 'mp4', 'webm'].includes(fileExtension)
  const fileName = `validation-${Date.now()}-voice-sample.${fileExtension}`
  const tempFilePath = `/tmp/${fileName}`

  await fs.promises.writeFile(tempFilePath, fileBuffer)

  try {
    if (needsConversion) {
      logger.info(`Converting ${fileExtension.toUpperCase()} to MP3: ${tempFilePath}`)
      const mp3Path = tempFilePath.replace(`.${fileExtension}`, '.mp3')
      await convertToMp3(tempFilePath, mp3Path, {
        bitrateKbps: 128,
        channels: 1,
        sampleRate: 44100,
      })
      fs.unlinkSync(tempFilePath)
      fs.renameSync(mp3Path, tempFilePath)
      logger.info(`${fileExtension.toUpperCase()} to MP3 conversion successful: ${tempFilePath}`)
    }

    const pauseRemoved = await removeAudioPausesInPlace(tempFilePath, 0.5)
    if (pauseRemoved) {
      logger.info(`Removed audio pauses from voice sample: ${fileName}`)
    }

    const finalDuration = await getAudioDuration(tempFilePath)
    fs.unlinkSync(tempFilePath)

    if (finalDuration < 10) {
      return {
        duration: finalDuration,
        isValid: false,
        message: `Please record at least 10 seconds to ensure sufficient speech content. Current duration: ${finalDuration.toFixed(1)}s`,
      }
    }

    return {
      duration: finalDuration,
      isValid: true,
      message: 'Audio validation successful',
    }
  } catch (error) {
    if (fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath)
    }

    const errorMessage = ensureError(error).message
    logger.error(`[VoiceClone] Failed to validate audio file ${fileName}: ${errorMessage}`)
    throw new BadRequestException(`Audio validation failed: ${errorMessage}`)
  }
}
