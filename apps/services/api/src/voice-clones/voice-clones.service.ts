import fs, { unlinkSync } from 'node:fs'
import { readFile } from 'node:fs/promises'

import {
  createVoiceClone,
  generateVoiceClonePreview,
  isolateVoiceFromAudio,
} from '@agent-lib/agents/story-loader/voice-tools/utils/elevenlabs.util'
import { PrismaClientKnownRequestError } from '@reelmakeeasy/api-db'
import { NEEDS_ELEVENLABS_KEY } from '@reelmakeeasy/common/elevenlabs/key'
import { logger } from '@reelmakeeasy/common/logger'
import { textToSpeech as falMinimaxTextToSpeech } from '@reelmakeeasy/common/tts/fal-minimax'
import { cloneVoice as falCloneVoice } from '@reelmakeeasy/common/tts/fal-minimax-clone'
import type { TTSResult } from '@reelmakeeasy/common/tts/minimax-text'
import { qwen3ReferenceAudioPath } from '@reelmakeeasy/common/tts/qwen3-voice'
import { currentVoiceContext, qwen3CloneStatus } from '@reelmakeeasy/common/tts/voice-engines'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import {
  copyStoredFile,
  deleteStoredFile,
  downloadStoredFile,
  storedFileExists,
  storeUri,
  uploadBufferToStore,
} from '@reelmakeeasy/common/storage/stored-files'
import { getReqContext } from '@reelmakeeasy/common/utils/req-ctx'
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common'
import type { VoiceProfile } from '@shared/types/api/voice-profile'

import { PrismaService } from '../prisma/prisma.service'

import { uploadVoiceCloneFile, validateVoiceCloneAudioFile } from './voice-clones.audio-upload'
import { standardCloneBackend } from './voice-clones.backend'
import {
  CreateVoiceCloneDto,
  UpdateVoiceCloneDto,
  type VoiceCloneProvider,
} from './voice-clones.dto'
import {
  DEFAULT_LANGUAGE_CONFIG,
  detectVoiceLanguageConfig,
  VoiceLanguageConfig,
  VoiceLanguageDetection,
} from './voice-clones.language-config'
import {
  createQwen3VoiceFromDescription,
  createQwen3VoiceFromSample,
  readQwen3TemporaryVoice,
} from './voice-clones.qwen3'
import {
  assertOwnedVoiceCloneSource,
  convertToMp3,
  deleteVoiceCloneArtifact,
  deleteVoiceCloneSourceAudio,
  generateSignedUrl,
  resolveVoiceCloneSourceUri,
  transcodeIfOverLimit,
  unlinkTempFile,
  uploadVoiceClonePreview,
} from './voice-clones.utils'
import { analyzeVoiceProfileFromAudioUri } from './voice-profile.util'

@Injectable()
export class VoiceClonesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(createVoiceCloneDto: CreateVoiceCloneDto) {
    // Single choke point for every save path - all of them land here.
    const { originalSource, userId } = createVoiceCloneDto
    assertOwnedVoiceCloneSource(originalSource, userId)
    try {
      createVoiceCloneDto.orgId = getReqContext().org_id
      const createdVoiceClone = await this.prisma.userVoiceClone.create({
        data: createVoiceCloneDto,
      })
      return await this.attachVoiceProfile(createdVoiceClone)
    } catch (e) {
      const error = ensureError<PrismaClientKnownRequestError>(e)
      if (error.code === 'P2002') {
        // Check which unique constraint was violated
        const target = error.meta?.target as string[]
        if (target?.includes('voiceId') && target?.includes('provider')) {
          throw new ConflictException('Voice clone already exists for this provider and voice ID')
        } else if (['userId', 'name', 'provider'].every((field) => target?.includes(field))) {
          throw new ConflictException('A voice clone with this name already exists')
        } else {
          throw new ConflictException('Voice clone already exists')
        }
      }
      throw error
    }
  }

  // Provider-specific methods for ElevenLabs
  async createTemporaryElevenLabsVoiceClone(fileId: string, userId: string, userEmail: string) {
    // Standard clones run on ElevenLabs (its key, outside development) or MiniMax on fal.
    const backend = standardCloneBackend()
    if (backend === 'minimax') {
      return this.createTemporaryMiniMaxVoiceClone(fileId, userId)
    }
    if (!backend) {
      throw new BadRequestException(NEEDS_ELEVENLABS_KEY)
    }

    const fileUri = `voice-clones/${userId}/${fileId}`
    const originalAudioUri = storeUri(fileUri)
    const tempFilePath = `/tmp/${fileId}`
    const voiceProfilePromise = analyzeVoiceProfileFromAudioUri({
      audioUri: originalAudioUri,
      sourceKind: 'voice_clone',
    })

    // The uploaded sample is training input only for ElevenLabs - the voice lives
    // provider-side keyed by voice_id - so it used to be deleted in the `finally` below
    // once cloning reached a conclusive result. That deletion is SUSPENDED on this path
    // (a provider migration re-submits the original audio): the `finally` now only settles
    // the voice-profile analysis, and the sample is retained until the voice itself is
    // deleted. The download stays inside the scope so the temp file is still cleaned up.
    try {
      await downloadStoredFile(originalAudioUri, tempFilePath)

      // Detect language from original audio before isolation modifies the file.
      // ElevenLabs cloning is multilingual, so unsupported languages are not blocked here.
      const detection = await detectVoiceLanguageConfig(tempFilePath)
      const languageConfig =
        detection.kind === 'unsupported' ? DEFAULT_LANGUAGE_CONFIG : detection.config

      // Apply voice isolation using ElevenLabs before cloning
      logger.info({ fileId, userId }, 'Applying voice isolation to uploaded audio for ElevenLabs')

      try {
        const isolationResult = await isolateVoiceFromAudio(tempFilePath)

        if (isolationResult.status === 'error') {
          logger.warn(
            {
              fileId,
              userId,
              err: isolationResult.message,
            },
            '[VoiceClone] Voice isolation failed, proceeding with original audio',
          )
        } else {
          logger.info(
            {
              fileId,
              userId,
              isolatedPath: isolationResult.isolatedAudioPath,
            },
            'Voice isolation completed successfully',
          )
        }
        await transcodeIfOverLimit(tempFilePath, fileId, userId)
      } catch (isolationError) {
        logger.warn(
          {
            fileId,
            userId,
            err: isolationError instanceof Error ? isolationError.message : String(isolationError),
          },
          '[VoiceClone] Voice isolation encountered an error, proceeding with original audio',
        )
      }

      const result = await createVoiceClone(
        `voice_clone_${Date.now()}`,
        tempFilePath,
        'Voice clone created from uploaded audio',
      )

      unlinkSync(tempFilePath)

      if (result.status === 'error') {
        throw new BadRequestException(`Voice cloning failed\n ${result.message.split('\n')[0]}`)
      }

      if (result.voice_id) {
        logger.info('ElevenLabs voice clone created successfully')

        // Generate preview using the cloned voice
        const previewResult = await generateVoiceClonePreview(
          result.voice_id,
          languageConfig.previewText,
          `/tmp/preview-${result.voice_id}.mp3`,
        )

        if (previewResult.status === 'success' && previewResult.previewPath) {
          // Read the preview file and upload to storage
          const previewBuffer = await readFile(previewResult.previewPath)
          await uploadVoiceClonePreview(previewBuffer, result.voice_id, userId)
        }
      }

      const voiceProfile = result.voice_id ? await voiceProfilePromise : null
      if (result.voice_id && voiceProfile) {
        await this.writeTemporaryVoiceProfile(userId, result.voice_id, 'elevenlabs', voiceProfile)
      }
      return {
        previewPath: result.voice_id
          ? `voice-clones/${userId}/previews/preview-${result.voice_id}.mp3`
          : null,
        provider: 'elevenlabs' as const,
        requestedProvider: 'elevenlabs' as const,
        voiceId: result.voice_id,
        voiceProfile: voiceProfile || undefined,
      }
    } finally {
      await this.releaseVoiceCloneSource(voiceProfilePromise, userId, fileId)
    }
  }

  /**
   * MiniMax voice clone, minted on fal (`roles["voice.clone"]`) and stored as
   * `provider: 'fal'`. Fal deletes a clone that isn't used for TTS within 7 days, so
   * saving it runs one fal TTS call to keep it (see `activateAndSaveMiniMax`).
   */
  async createTemporaryMiniMaxVoiceClone(fileId: string, userId: string) {
    const fileUri = `voice-clones/${userId}/${fileId}`
    const originalAudioUri = storeUri(fileUri)
    const tempFilePath = `/tmp/${fileId}`
    const voiceProfilePromise = analyzeVoiceProfileFromAudioUri({
      audioUri: originalAudioUri,
      sourceKind: 'voice_clone',
    })

    // The uploaded sample is training input only for MiniMax - the voice lives
    // provider-side keyed by voiceId - so it used to be deleted in the `finally` below
    // once cloning reached a conclusive result. That deletion is SUSPENDED on this path
    // (a provider migration re-submits the original audio): the `finally` now only settles
    // the voice-profile analysis, and the sample is retained until the voice itself is
    // deleted. The download stays inside the scope so the temp file is still cleaned up.
    try {
      await downloadStoredFile(originalAudioUri, tempFilePath)

      // Detect language before isolation; block early if MiniMax can't clone it.
      const languageConfig = this.resolveMiniMaxLanguageConfig(
        await detectVoiceLanguageConfig(tempFilePath),
        () =>
          unlinkTempFile(
            tempFilePath,
            '[VoiceClone] Failed to delete temp file after unsupported language',
          ),
      )

      // Apply voice isolation using ElevenLabs before cloning
      logger.info({ fileId, userId }, 'Applying voice isolation to uploaded audio for MiniMax')

      try {
        const isolationResult = await isolateVoiceFromAudio(tempFilePath)

        if (isolationResult.status === 'error') {
          logger.warn(
            {
              fileId,
              userId,
              err: isolationResult.message,
            },
            '[VoiceClone] Voice isolation failed, proceeding with original audio',
          )
        } else {
          logger.info(
            {
              fileId,
              userId,
              isolatedPath: isolationResult.isolatedAudioPath,
            },
            'Voice isolation completed successfully',
          )
        }
      } catch (isolationError) {
        logger.warn(
          {
            fileId,
            userId,
            err: isolationError instanceof Error ? isolationError.message : String(isolationError),
          },
          '[VoiceClone] Voice isolation encountered an error, proceeding with original audio',
        )
      }

      // fal's clone endpoint accepts only MP3 and WAV, so transcode anything else.
      const fileExtension = fileId.split('.').pop()?.toLowerCase() || 'mp3'
      const needsConversion = !['mp3', 'wav'].includes(fileExtension)

      let finalAudioPath = tempFilePath // Will point to the file to use for cloning

      if (needsConversion) {
        const mp3Path = tempFilePath.replace(`.${fileExtension}`, '.mp3')
        await convertToMp3(tempFilePath, mp3Path, {
          bitrateKbps: 128,
          channels: 1,
          sampleRate: 44100,
        })
        // Remove original and keep MP3 file with .mp3 extension
        fs.unlinkSync(tempFilePath)
        finalAudioPath = mp3Path // Use MP3 file with correct extension
      }

      let result: Awaited<ReturnType<typeof falCloneVoice>> | undefined
      try {
        // fal's clone input has no accent prompt or language_boost, so the sample alone
        // defines the voice. The preview is spoken in the detected language's text.
        result = await falCloneVoice({
          audioFile: finalAudioPath,
          previewText: languageConfig.previewText,
          userId,
        })
      } finally {
        unlinkTempFile(finalAudioPath, '[VoiceClone] Failed to delete MiniMax clone temp file')
      }

      if (!result) {
        throw new BadRequestException(
          'MiniMax voice cloning failed: no response from clone service',
        )
      }

      if (result.status === 'error') {
        throw new BadRequestException(`MiniMax voice cloning failed: ${result.message}`)
      }

      if (result.voiceId && result.previewAudio) {
        await uploadVoiceClonePreview(result.previewAudio, result.voiceId, userId)
        logger.info('MiniMax voice clone created on fal with preview uploaded to storage')
      }

      const voiceProfile = result.voiceId ? await voiceProfilePromise : null
      if (result.voiceId && voiceProfile) {
        await this.writeTemporaryVoiceProfile(userId, result.voiceId, 'fal', voiceProfile)
      }
      return {
        previewPath:
          result.voiceId && result.previewAudio
            ? `voice-clones/${userId}/previews/preview-${result.voiceId}.mp3`
            : null,
        provider: 'fal' as const,
        requestedProvider: 'minimax' as const,
        voiceId: result.voiceId,
        voiceProfile: voiceProfile || undefined,
      }
    } finally {
      await this.releaseVoiceCloneSource(voiceProfilePromise, userId, fileId)
    }
  }

  /** A temporary Qwen3-TTS voice cloned from an uploaded sample. */
  async createTemporaryQwen3VoiceClone(fileId: string, userId: string, referenceText?: string) {
    // On Gemini, Qwen3 clones only on this computer (never billed to fal); on fal, FAL_KEY will do.
    const qwen3 = qwen3CloneStatus(await currentVoiceContext())
    if (!qwen3.available) throw new BadRequestException(qwen3.reason)

    return createQwen3VoiceFromSample({ fileId, referenceText, userId })
  }

  async delete(id: string) {
    try {
      const deletedVoiceClone = await this.prisma.userVoiceClone.delete({
        where: { id },
      })
      // The row was the only thing that made this voice's stored files
      // reachable, so drop them with it. Never throws, so it cannot be mistaken for a
      // Prisma failure by the catch below.
      await this.deleteVoiceCloneArtifacts(deletedVoiceClone)
      return deletedVoiceClone
    } catch (e) {
      const error = ensureError<PrismaClientKnownRequestError>(e)
      if (error.code === 'P2025') {
        throw new NotFoundException('Voice clone not found')
      }
      throw error
    }
  }

  /** A temporary Qwen3-TTS voice designed from a written description. */
  async designTemporaryQwen3Voice(
    userId: string,
    request: { description: string; sampleText?: string },
  ) {
    return createQwen3VoiceFromDescription({ ...request, userId })
  }

  async findById(id: string) {
    const voiceClone = await this.prisma.userVoiceClone.findFirst({
      where: {
        id,
        orgId: getReqContext().org_id,
      },
    })
    return voiceClone ? this.attachVoiceProfile(voiceClone) : voiceClone
  }

  async findByUserIdAndProvider(orgId: string, provider?: VoiceCloneProvider) {
    // If no provider is specified, return all voice clones for the user
    const whereClause: { orgId: string; provider?: VoiceCloneProvider } = { orgId }
    if (provider) {
      whereClause.provider = provider
    }

    const voiceClones = await this.prisma.userVoiceClone.findMany({
      orderBy: { createdAt: 'desc' },
      where: whereClause,
    })

    return Promise.all(voiceClones.map((voiceClone) => this.attachVoiceProfile(voiceClone)))
  }

  async generatePlaybackUrl(id: string) {
    const voiceClone = await this.findById(id)
    if (!voiceClone) {
      throw new NotFoundException('Voice clone not found or access denied')
    }

    const result = await generateSignedUrl(voiceClone.voiceId)
    return {
      ...result,
      voiceCloneId: id,
    }
  }

  async generateTemporaryPlaybackUrl(voiceId: string) {
    return generateSignedUrl(voiceId)
  }

  async saveTemporaryElevenLabsVoiceClone(
    voiceId: string,
    name: string,
    userId: string,
    userEmail: string,
    fileId?: string,
  ) {
    this.warnIfSourceUnrecorded(fileId, userId, voiceId)
    // Saved on the service it was cloned with (see createTemporaryElevenLabsVoiceClone).
    if (standardCloneBackend() === 'minimax') {
      return await this.activateAndSaveMiniMax(voiceId, name, userId, fileId)
    }

    // ElevenLabs: voice is already activated at the temp creation step, just persist it
    logger.info({ voiceId, userId }, 'ElevenLabs voice clone activated successfully')
    const savedVoiceClone = await this.create({
      name,
      userId,
      voiceId,
      provider: 'elevenlabs',
      originalSource: fileId,
    })
    await this.persistVoiceProfileForSavedClone({
      provider: 'elevenlabs',
      userId,
      voiceId,
    })
    return await this.attachVoiceProfile(savedVoiceClone)
  }

  // Provider-specific save methods
  async saveTemporaryMiniMaxVoiceClone(
    voiceId: string,
    name: string,
    userId: string,
    fileId?: string,
  ) {
    this.warnIfSourceUnrecorded(fileId, userId, voiceId)
    return await this.activateAndSaveMiniMax(voiceId, name, userId, fileId)
  }

  /** Saves a temporary Qwen3-TTS voice (its reference audio and, once made, its speaker embedding). */
  async saveTemporaryQwen3Voice(voiceId: string, name: string, userId: string, fileId?: string) {
    const meta = await readQwen3TemporaryVoice(userId, voiceId)
    const saved = await this.create({
      name,
      originalSource: fileId,
      provider: 'qwen3',
      referenceText: meta.referenceText,
      speakerEmbeddingPath: meta.speakerEmbeddingPath,
      userId,
      voiceId,
    })
    return await this.attachVoiceProfile(saved)
  }

  async saveTemporaryVoiceClone(
    voiceId: string,
    name: string,
    userId: string,
    provider: VoiceCloneProvider,
    fileId?: string,
  ) {
    let activationResult: TTSResult | undefined
    try {
      // Activates MiniMax voices on fal, which also keeps the clone past fal's 7-day expiry.
      activationResult = await falMinimaxTextToSpeech({
        text: 'Voice clone activated successfully.',
        voiceId,
        outputDirectory: '/tmp', // Use system temp directory - files are temporary and auto-cleaned
      })
      if (activationResult.status !== 'success') {
        throw new Error(activationResult.message)
      }

      logger.info(
        {
          voiceId,
          userId,
          traceId: activationResult.traceId,
        },
        'Voice clone activated successfully',
      )
    } catch (e) {
      const activationError = ensureError(e)
      logger.error(
        {
          voiceId,
          userId,
          err: activationError,
          traceId: activationResult?.traceId || 'unknown',
        },
        '[VoiceClone] Voice clone activation failed:',
      )
      throw new BadRequestException(
        `Voice clone activation failed: ${activationError.message || 'Unknown error'}`,
      )
    }

    const savedVoiceClone = await this.create({
      name,
      userId,
      voiceId,
      provider,
      originalSource: fileId,
    })
    await this.persistVoiceProfileForSavedClone({ provider, userId, voiceId })
    return await this.attachVoiceProfile(savedVoiceClone)
  }

  async update(id: string, updateVoiceCloneDto: UpdateVoiceCloneDto) {
    try {
      const updatedVoiceClone = await this.prisma.userVoiceClone.update({
        data: updateVoiceCloneDto,
        where: { id },
      })
      return await this.attachVoiceProfile(updatedVoiceClone)
    } catch (e) {
      const error = ensureError<PrismaClientKnownRequestError>(e)
      if (error.code === 'P2025') {
        throw new NotFoundException('Voice clone not found')
      }
      throw error
    }
  }

  async uploadFile(fileBuffer: Buffer, userId: string, originalFileName: string) {
    return uploadVoiceCloneFile(fileBuffer, userId, originalFileName)
  }

  async validateAudioFile(fileBuffer: Buffer, originalFileName: string) {
    return validateVoiceCloneAudioFile(fileBuffer, originalFileName)
  }

  private async activateAndSaveMiniMax(
    voiceId: string,
    name: string,
    userId: string,
    fileId?: string,
  ) {
    let activationResult: TTSResult | undefined
    try {
      // One real TTS call on fal. Besides proving the voice works, it keeps the clone:
      // fal deletes a voice that isn't used for TTS within 7 days of cloning.
      activationResult = await falMinimaxTextToSpeech({
        text: 'Voice clone activated successfully.',
        voiceId,
        outputDirectory: '/tmp',
      })

      // The TTS client RETURNS { status: 'error' } rather than throwing, so check it:
      // otherwise a failed activation is logged as success and the row persisted anyway.
      if (activationResult.status !== 'success') {
        throw new Error(activationResult.message)
      }

      logger.info(
        { voiceId, userId, traceId: activationResult.traceId },
        'MiniMax voice clone activated successfully',
      )
    } catch (activationError) {
      logger.error(
        {
          voiceId,
          userId,
          err: activationError,
          traceId: activationResult?.traceId || 'unknown',
        },
        '[VoiceClone] MiniMax voice clone activation failed:',
      )
      throw new BadRequestException(
        `MiniMax voice clone activation failed: ${activationError instanceof Error ? activationError.message : 'Unknown error'}`,
      )
    }

    const savedVoiceClone = await this.create({
      name,
      userId,
      voiceId,
      provider: 'fal',
      cloneSource: 'sample',
      originalSource: fileId,
    })
    await this.persistVoiceProfileForSavedClone({
      provider: 'fal',
      userId,
      voiceId,
    })
    return await this.attachVoiceProfile(savedVoiceClone)
  }

  private async attachVoiceProfile<
    TVoiceClone extends { provider?: null | string; userId: string; voiceId: string },
  >(voiceClone: TVoiceClone): Promise<TVoiceClone & { voiceProfile?: VoiceProfile }> {
    const voiceProfile = await this.readVoiceProfile(
      voiceClone.userId,
      voiceClone.voiceId,
      voiceClone.provider,
    )

    return voiceProfile ? { ...voiceClone, voiceProfile } : voiceClone
  }

  // Internal: activate MiniMax voice and persist to DB.
  /**
   * Remove the stored files a deleted voice clone leaves behind. Deleting the row
   * makes all of them unreachable - `generatePlaybackUrl` goes through `findById` and
   * `attachVoiceProfile` only runs for existing rows - so keeping them serves nothing.
   *
   * The source sample is included for completeness. Since the BytePlus clone path was
   * removed, no provider is exempt from clone-time deletion, so in practice the sample is
   * already gone by the time a voice is deleted; this stays as a backstop for rows written
   * before that change.
   *
   * MUST NOT throw - see the invariant the caller relies on in `delete`.
   */
  private async deleteVoiceCloneArtifacts(voiceClone: {
    originalSource?: null | string
    provider?: null | string
    speakerEmbeddingPath?: null | string
    userId: string
    voiceId: string
  }): Promise<void> {
    const { originalSource, provider, speakerEmbeddingPath, userId, voiceId } = voiceClone
    const context = { userId, voiceId }

    const fileUris = [
      storeUri(`voice-clones/${userId}/previews/preview-${voiceId}.mp3`),
      this.getVoiceProfileUri(userId, voiceId, provider),
      // Normally consumed at save time, but persistVoiceProfileForSavedClone swallows a
      // failed copy or delete, so a saved clone can still own one. This is the last
      // chance to clean it up.
      this.getTemporaryVoiceProfileUri(userId, voiceId, provider),
    ]

    if (speakerEmbeddingPath) {
      fileUris.push(
        speakerEmbeddingPath,
        speakerEmbeddingPath.replace(/\.safetensors$/, '.json'),
        qwen3ReferenceAudioPath(speakerEmbeddingPath),
      )
    }

    const sourceStoreUri = originalSource
      ? resolveVoiceCloneSourceUri(userId, originalSource)
      : null
    if (sourceStoreUri) {
      // One production object sits under a `processed/` sibling of the raw sample
      // (voice-clones/{userId}/processed/{sameFilename}) and no current code path writes
      // there, so its provenance is unknown. Same filename, so derive the sibling and try
      // it: deleteVoiceCloneArtifact checks existence first, making this a silent no-op
      // for every other row rather than a warning per delete.
      fileUris.push(sourceStoreUri, sourceStoreUri.replace(/\/([^/]+)$/, '/processed/$1'))
    }

    await Promise.all(fileUris.map((fileUri) => deleteVoiceCloneArtifact(fileUri, context)))
  }

  private getTemporaryVoiceProfileUri(
    userId: string,
    voiceId: string,
    provider?: null | string,
  ): string {
    const providerKey = provider?.trim() || 'unknown'
    return storeUri(
      `voice-clones/${userId}/temp-profiles/${providerKey}/profile-${encodeURIComponent(voiceId)}.json`,
    )
  }

  private getVoiceProfileUri(userId: string, voiceId: string, provider?: null | string): string {
    const providerKey = provider?.trim() || 'unknown'
    return storeUri(
      `voice-clones/${userId}/profiles/${providerKey}/profile-${encodeURIComponent(voiceId)}.json`,
    )
  }

  private async persistVoiceProfileForSavedClone(params: {
    provider: VoiceCloneProvider
    userId: string
    voiceId: string
  }): Promise<void> {
    const { provider, userId, voiceId } = params
    const temporaryUri = this.getTemporaryVoiceProfileUri(userId, voiceId, provider)
    const officialUri = this.getVoiceProfileUri(userId, voiceId, provider)

    try {
      if (await storedFileExists(temporaryUri)) {
        await copyStoredFile(temporaryUri, officialUri)
        await deleteStoredFile(temporaryUri)
        return
      }
    } catch (error) {
      logger.warn(
        { err: ensureError(error), officialUri, temporaryUri, userId, voiceId, provider },
        '[VoiceClone] Failed to promote temporary voice profile to saved profile',
      )
    }

    // There used to be a fallback here that re-analyzed the raw uploaded sample. It was
    // guarded to `provider === 'byteplus'`, so it is now permanently unreachable: no
    // save path can supply that provider any more (legacy byteplus rows exist, but nothing
    // saves new ones). Removed rather than left as dead code -- because it
    // cannot be reached, not because the object is missing. With clone-time deletion resumed
    // the sample is gone by save time anyway, so it could not have worked regardless.
    // A voice whose temporary profile could not be written or promoted is saved without
    // metadata; the profile is only display metadata.
  }

  private async readVoiceProfile(
    userId: string,
    voiceId: string,
    provider?: null | string,
  ): Promise<undefined | VoiceProfile> {
    const fileUri = this.getVoiceProfileUri(userId, voiceId, provider)
    if (!(await storedFileExists(fileUri))) {
      return undefined
    }

    const tempFilePath = `/tmp/voice-profile-${Date.now()}-${encodeURIComponent(voiceId)}.json`

    try {
      await downloadStoredFile(fileUri, tempFilePath)
      const raw = await readFile(tempFilePath, 'utf8')
      return JSON.parse(raw) as VoiceProfile
    } catch (error) {
      logger.warn(
        { err: ensureError(error), fileUri, userId, voiceId, provider },
        '[VoiceClone] Failed to read voice profile from storage',
      )
      return undefined
    } finally {
      if (fs.existsSync(tempFilePath)) {
        fs.unlinkSync(tempFilePath)
      }
    }
  }

  /**
   * Runs in the `finally` of every temporary-clone path to settle the voice-profile
   * analysis, which is started before the download and is otherwise never awaited on the
   * paths that return no voiceId or throw early. Without this, a rejected analysis would
   * surface as an unhandled promise rejection.
   *
   * It also deletes the raw uploaded sample: it is user biometric data and must
   * not outlive the clone attempt. The provider holds the voice from here, so the audio it
   * was made from has no further use.
   *
   * Deletion was once suspended because migrating a voice to another provider had to
   * re-submit the original audio. Voices made here are already on their final provider,
   * so nothing depends on retaining the sample and clone-time deletion applies.
   *
   * Order matters: settle the profile analysis FIRST. It reads the stored file directly via
   * `audio_url`, so deleting while it is still in flight would lose the profile. Settling
   * it is not the same as it SUCCEEDING, though -- the delete runs either way, in its own
   * try block, or a Gemini outage would leave biometric data behind.
   *
   * Scope is CLONE time only. Every stored file for a voice is deleted separately when
   * the user deletes that voice, via `deleteVoiceCloneArtifacts`.
   *
   * MUST NOT throw: this runs in a `finally`, where a rejection would replace the real
   * return value or mask the real error.
   */
  private async releaseVoiceCloneSource(
    voiceProfilePromise: Promise<null | VoiceProfile>,
    userId: string,
    fileId: string,
  ): Promise<void> {
    // Two try blocks, deliberately. Sharing one would let a rejected analysis skip the
    // delete: control would jump straight to the catch and the sample would survive. The
    // analysis is a Gemini call, so that is a routine provider blip turning into biometric
    // data retained forever -- exactly what deleting the sample exists to prevent. This was
    // latent in the first version of this cleanup.
    try {
      await voiceProfilePromise
    } catch (error) {
      logger.warn(
        { fileId, userId, err: ensureError(error).message },
        '[VoiceClone] Voice profile analysis failed before releasing the uploaded sample',
      )
    }

    try {
      await deleteVoiceCloneSourceAudio(userId, fileId)
    } catch (error) {
      logger.warn(
        { fileId, userId, err: ensureError(error).message },
        '[VoiceClone] Failed to release uploaded voice sample',
      )
    }
  }

  /**
   * Resolves the language config for a MiniMax clone, or rejects the request when the
   * detected language is outside MiniMax's supported set. ASR failures (kind 'undetected')
   * keep the English fallback rather than blocking the user.
   */
  private resolveMiniMaxLanguageConfig(
    detection: VoiceLanguageDetection,
    onUnsupported?: () => void,
  ): VoiceLanguageConfig {
    if (detection.kind === 'unsupported') {
      // Clean up the downloaded sample before rejecting so repeated unsupported-language
      // attempts do not leak temp files.
      onUnsupported?.()
      // 422 + a stable `code` let the web client show the dedicated "language
      // not supported" dialog. The code must stay in sync with
      // VOICE_CLONE_LANGUAGE_UNSUPPORTED_CODE in apps/web's VoiceCreateDialog.tsx.
      // The message is a fallback for other clients.
      throw new UnprocessableEntityException({
        code: 'VOICE_CLONE_LANGUAGE_UNSUPPORTED',
        message: `Voice cloning doesn't support the detected language (${detection.langCode}) yet.`,
      })
    }
    return detection.config
  }

  /**
   * A save without a `fileId` writes `originalSource: undefined`, so the row holds no pointer
   * to the uploaded sample. That used to be harmless because the sample was deleted at clone
   * time anyway. Now that clone-time deletion is suspended, such a row leaves the raw
   * biometric in storage with nothing referencing it: it cannot be used for the provider
   * migration, and `deleteVoiceCloneArtifacts` cannot remove it when the voice is deleted,
   * because that path only deletes a source when `originalSource` is set.
   *
   * Every first-party client passes `fileId`. This is a tripwire for one that stops doing so,
   * since the failure is otherwise completely silent. Logs only; never blocks the save.
   */
  private warnIfSourceUnrecorded(fileId: string | undefined, userId: string, voiceId: string) {
    if (fileId) {
      return
    }
    logger.warn(
      { userId, voiceId },
      '[VoiceClone] Saved without a fileId: the retained upload will have no originalSource, so it cannot be migrated or cleaned up',
    )
  }

  private async writeTemporaryVoiceProfile(
    userId: string,
    voiceId: string,
    provider: VoiceCloneProvider,
    voiceProfile: VoiceProfile,
  ): Promise<void> {
    const fileUri = this.getTemporaryVoiceProfileUri(userId, voiceId, provider)
    try {
      await uploadBufferToStore(Buffer.from(JSON.stringify(voiceProfile), 'utf8'), fileUri, {
        contentType: 'application/json',
      })
    } catch (error) {
      logger.warn(
        { err: ensureError(error), fileUri, userId, voiceId, provider },
        '[VoiceClone] Failed to write temporary voice profile to storage',
      )
    }
  }
}
