import { writeFile } from 'node:fs/promises'

import { createStorage } from '@reelmakeeasy/common/agent-v2/storage/storage'
import { generateASRTranscription } from '@reelmakeeasy/common/asr/elevenlabs'
import {
  CharacterAlignmentResponseModel,
  SpeechToTextChunkResponseModel,
} from '@reelmakeeasy/common/elevenlabs/client'
import { logger } from '@reelmakeeasy/common/logger'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'

import { removeAudioPausesInPlace } from './audio-pause-removal.util'
import { normalizeAudioVolume, processWithLocalFile } from './common.util'
import { getElevenLabsClient, isolateVoiceFromAudio, saveTTSTimestamps } from './elevenlabs.util'
import { validateAudioQualityWithScript } from './tts-quality-validation.util'

// ============ Atomic Post-Processing Functions (exported for all providers) ============

/**
 * Save TTS timestamps (only ElevenLabs provides timestamps)
 */
export async function saveTimestampsIfAvailable(
  timestamps: undefined | { alignment?: CharacterAlignmentResponseModel },
  projectId: string,
  text: string,
): Promise<string[]> {
  const issues: string[] = []
  if (timestamps) {
    try {
      await saveTTSTimestamps(timestamps, projectId, text)
    } catch (error) {
      const errorMsg = `Failed to save TTS timestamps: ${ensureError(error).message}`
      logger.warn(`[Audio] ${errorMsg}`)
      issues.push(errorMsg)
    }
  }
  return issues
}

/**
 * Apply volume normalization
 */
export async function applyVolumeNormalization(
  projectId: string,
  voiceOverPath: string,
): Promise<string[]> {
  const issues: string[] = []
  logger.info('[Audio] Applying volume normalization')
  const result = await normalizeAudioVolume(projectId, voiceOverPath)
  if (result.success) {
    logger.info('[Audio] Volume normalization completed')
  } else {
    const errorMsg = `Volume normalization failed: ${result.message}`
    logger.warn(`[Audio] ${errorMsg}`)
    issues.push(errorMsg)
  }
  return issues
}

// TTS silence holes carry a faint noise floor (~-45..-49dB after loudnorm) that the
// default -50dB threshold misses, leaving multi-second dead air in the voice-over.
const TTS_PAUSE_SILENCE_THRESHOLD_DB = -40

/**
 * Remove long pauses
 */
export async function removeAudioPausesStep(
  projectId: string,
  voiceOverPath: string,
): Promise<string[]> {
  const issues: string[] = []
  try {
    const storage = await createStorage(projectId)
    const pauseRemoved = await processWithLocalFile(projectId, voiceOverPath, async (localPath) => {
      const changed = await removeAudioPausesInPlace(localPath, 0.8, TTS_PAUSE_SILENCE_THRESHOLD_DB)
      if (changed) {
        await storage.uploadFile(localPath, voiceOverPath)
      }
      return changed
    })

    if (pauseRemoved) {
      logger.info('[Audio] Removed audio pauses')
    }
  } catch (error) {
    const errorMsg = `Failed to remove audio pauses: ${ensureError(error).message}`
    logger.warn(`[Audio] ${errorMsg}`)
    issues.push(errorMsg)
  }
  return issues
}

/**
 * Apply voice isolation
 */
export async function applyVoiceIsolationStep(
  projectId: string,
  voiceOverPath: string,
): Promise<string[]> {
  const issues: string[] = []
  try {
    const storage = await createStorage(projectId)
    await processWithLocalFile(projectId, voiceOverPath, async (localPath) => {
      await applyVoiceIsolation(localPath)
      // Voice isolation overwrites the input file, so we need to upload it back
      await storage.uploadFile(localPath, voiceOverPath)
    })
    logger.info('[Audio] Voice isolation completed')
  } catch (error) {
    const errorMsg = `Voice isolation failed: ${ensureError(error).message}`
    logger.warn(`[Audio] ${errorMsg}`)
    issues.push(errorMsg)
  }
  return issues
}

/**
 * Generate ASR transcription
 */
export async function generateTranscriptionStep(
  projectId: string,
  voiceOverPath: string,
): Promise<{ issues: string[]; transcription: null | SpeechToTextChunkResponseModel }> {
  const issues: string[] = []
  try {
    const transcription = await processWithLocalFile(
      projectId,
      voiceOverPath,
      async (localPath) => {
        return await generateASRTranscription(localPath)
      },
    )
    return { transcription, issues }
  } catch (error) {
    const errorMsg = `ASR transcription failed: ${ensureError(error).message}`
    logger.error(`[Audio] ${errorMsg}`)
    issues.push(errorMsg)
    return { transcription: null, issues }
  }
}

/**
 * Validate transcript quality
 */
export async function validateTranscriptQualityStep(
  transcription: null | SpeechToTextChunkResponseModel,
  originalText: string,
  ttsInputText?: string,
  useRelaxedLlmTtsQualityCheck = false,
): Promise<{ explanation: string; hasTagLeakage: boolean; issues: string[]; isValid: boolean }> {
  if (!transcription) {
    return {
      isValid: false,
      explanation: '',
      hasTagLeakage: false,
      issues: ['No transcription available for validation'],
    }
  }
  const validationResult = await validateAudioQualityWithScript(
    transcription,
    originalText,
    ttsInputText,
    useRelaxedLlmTtsQualityCheck,
  )
  return {
    isValid: validationResult.isValid,
    explanation: validationResult.explanation,
    hasTagLeakage: validationResult.hasTagLeakage,
    issues: validationResult.issues,
  }
}

/**
 * Saves quality issues to a simple text file for troubleshooting
 */
export async function saveQualityIssuesToDebugFile(
  projectId: string,
  qualityIssues: string[],
  finalAttempt: number,
  finalModel: string,
): Promise<void> {
  try {
    const storage = await createStorage(projectId)
    const debugRelPath = 'story_loader/audio/debug' // Unified path
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const debugFile = `${debugRelPath}/quality_issues_${timestamp}.txt`

    const content = [
      'Quality Issues Debug Report',
      `Generated: ${new Date().toISOString()}`,
      `Project ID: ${projectId}`,
      `Final Attempt: ${finalAttempt}`,
      `Final Model: ${finalModel}`,
      `Total Issues: ${qualityIssues.length}`,
      '',
      'Issues:',
      ...qualityIssues.map((issue, index) => `${index + 1}. ${issue}`),
    ].join('\n')

    await storage.writeJsonFile(debugFile, content)
    logger.info(`[TTS] Quality issues saved to debug file: ${debugFile}`)
  } catch (error) {
    logger.warn(`[TTS] Failed to save quality issues debug file: ${ensureError(error).message}`)
  }
}

async function applyVoiceIsolation(audioFilePath: string): Promise<void> {
  logger.info('[TTS] Applying voice isolation to generated audio...')
  const isolationResult = await isolateVoiceFromAudio(audioFilePath)
  if (isolationResult.status === 'success') {
    logger.info(`[TTS] Voice isolation completed: ${audioFilePath}`)
  } else {
    logger.warn(`[TTS] Voice isolation failed: ${isolationResult.message}`)
  }
}

/**
 * Generates TTS audio using ElevenLabs API
 *
 * Attempts to generate audio with character-level timestamps for precise timing data.
 * If timestamp generation fails, falls back to regular TTS without timing information.
 */
export async function generateTTSAudio(
  text: string,
  voiceId: string,
  modelId: string,
  // BCP-47 script language. multilingual_v2 auto-detects, but passing it makes
  // language selection explicit. undefined leaves ElevenLabs to infer from the text.
  languageCode?: string,
): Promise<{
  audioBuffer: Buffer
  timestamps?: {
    alignment?: CharacterAlignmentResponseModel
  }
}> {
  const elevenlabs = getElevenLabsClient()

  try {
    // Use convertWithTimestamps to get precise character-level timing information
    const audioResultWithTimestamps = await elevenlabs.textToSpeech.convertWithTimestamps(voiceId, {
      languageCode,
      modelId,
      outputFormat: 'mp3_44100_128',
      text,
      voiceSettings: {
        speed: 1,
        stability: 0.5,
        useSpeakerBoost: true,
      },
    })

    const audioBuffer = Buffer.from(audioResultWithTimestamps.audioBase64, 'base64')

    return {
      audioBuffer,
      timestamps: {
        alignment: audioResultWithTimestamps.alignment,
      },
    }
  } catch (error) {
    logger.warn(
      `[TTS] Failed to get timestamps, falling back to regular TTS: ${ensureError(error).message}`,
    )

    const audioResult = await elevenlabs.textToSpeech.convert(voiceId, {
      languageCode,
      modelId,
      outputFormat: 'mp3_44100_128',
      text,
      voiceSettings: {
        speed: 1,
        stability: 0.5,
        useSpeakerBoost: true,
      },
    })

    const audioBuffer = await streamToBuffer(audioResult)
    return { audioBuffer }
  }
}

/**
 * Generates a preview audio file for a voice clone using the v2 multilingual TTS model
 */
export async function generateVoiceClonePreview(
  voiceId: string,
  previewText = 'Hello! This is a preview of my voice clone. I can speak naturally and clearly.',
  outputPath: string,
): Promise<{
  message: string
  previewPath?: string
  status: 'error' | 'success'
}> {
  try {
    const elevenlabs = getElevenLabsClient()

    // Use the v2 multilingual model for preview generation
    const audioResult = await elevenlabs.textToSpeech.convert(voiceId, {
      modelId: 'eleven_multilingual_v2',
      outputFormat: 'mp3_44100_128',
      text: previewText,
      voiceSettings: {
        speed: 1,
        stability: 0.7,
        similarityBoost: 0.75,
        style: 0.5,
        useSpeakerBoost: true,
      },
    })

    const audioBuffer = await streamToBuffer(audioResult)
    await writeFile(outputPath, audioBuffer)

    logger.info(`[ElevenLabs] Preview audio generated successfully: ${outputPath}`)

    return {
      message: 'Preview audio generated successfully for voice clone',
      status: 'success',
      previewPath: outputPath,
    }
  } catch (error: unknown) {
    logger.error(`[ElevenLabs] Error generating voice clone preview: ${error}`)
    return {
      message: ensureError(error).message,
      status: 'error',
    }
  }
}

async function streamToBuffer(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const reader = stream.getReader()
  const chunks: Buffer[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }
    chunks.push(Buffer.from(value))
  }
  return Buffer.concat(chunks)
}
