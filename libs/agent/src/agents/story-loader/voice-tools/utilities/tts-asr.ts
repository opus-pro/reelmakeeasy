import { STORY_LOADER_PATHS } from '@reelmakeeasy/common/agent-v2/paths'
import { createStorage } from '@reelmakeeasy/common/agent-v2/storage/storage'
import { logger } from '@reelmakeeasy/common/logger'
import { defaultVoiceId } from '@reelmakeeasy/common/tts/default-voice'
import { DEFAULT_VOICE_ID } from '@reelmakeeasy/common/tts/preset-voices'
import { unwrapMidSentenceLineBreaks } from '@reelmakeeasy/common/utils/tts-sanitize'
import { TranscriptData } from '@shared/types/agent/transcript'
import ffmpeg from 'fluent-ffmpeg'

import { FileHub } from '../../../common/file-hub'
import { processWithLocalFile, transformTranscriptToSegments } from '../utils/common.util'
import {
  getExistingFilesResponse,
  getSuccessResponse,
  processAndSaveTranscript,
  validateScript,
} from '../utils/elevenlabs.util'
import {
  generateAudioAndTranscriptWithRetries,
  resolveVoiceRoute,
} from '../utils/provider-router.util'
import { type TtsProvider } from '../utils/provider-tts.util'

import { TtsAndAsrResult } from './types'

export { DEFAULT_VOICE_ID }

const STORY_MODE_COMMAND_TAG_REGEX = /@(story-mode|long-take)\b\s*/gi
const STORY_MODE_META_TAG_REGEX = /@(?:vo|img|video|audio|txt|pdf|file)\[[^\]]*\]\([^)\r\n]+\)/giu
const STORY_MODE_ATTACHED_ASSET_REGEX =
  /\[Attached (?:Image|Video|Audio|File|PDF|Text):\s*[^\]]+\]/gi
// Multimodal image-attachment labels that an LLM may have echoed into the script.
// See buildUserAssetImageContents (storage-read.ts) and long-take keyframe prompt builders.
const STORY_MODE_ASSET_METADATA_LABEL_REGEX = /\[(?:file_id|asset_id|filename)\s*:[^\]\n]*\]/gi

async function restoreRound1Transcript(
  projectId: string,
  backupPath: string,
  transcriptPath: string,
): Promise<void> {
  try {
    const storage = await createStorage(projectId)
    const backupExists = await storage.exists(backupPath)
    if (!backupExists) {
      return
    }
    await storage.copyFile(backupPath, transcriptPath)
    await storage.deleteFile(backupPath).catch((cleanupErr) => {
      logger.warn(
        `[TTS-ASR] Failed to cleanup transcript backup: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`,
      )
    })
    logger.info('[TTS-ASR] Restored Round 1 transcript after Round 2 exception')
  } catch (storageErr) {
    logger.warn(`[TTS-ASR] Failed to restore transcript: ${storageErr}`)
  }
}

function sanitizeTtsScriptText(text: string): string {
  const stripped = text
    .replace(STORY_MODE_COMMAND_TAG_REGEX, ' ')
    .replace(STORY_MODE_META_TAG_REGEX, ' ')
    .replace(STORY_MODE_ATTACHED_ASSET_REGEX, ' ')
    .replace(STORY_MODE_ASSET_METADATA_LABEL_REGEX, ' ')
  return unwrapMidSentenceLineBreaks(stripped)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s+([,.;:!?])/g, '$1')
    .trim()
}

/**
 * Get audio duration in seconds using ffprobe on the final audio file
 * Uses processWithLocalFile to handle storage download/upload transparently
 * IMPORTANT: Returns 0 on failure (never rejects) to avoid breaking orchestration flow
 */
async function getAudioDurationSeconds(projectId: string, voiceOverPath: string): Promise<number> {
  try {
    return await processWithLocalFile(projectId, voiceOverPath, async (localPath) => {
      return new Promise<number>((resolve) => {
        ffmpeg.ffprobe(localPath, (err, metadata) => {
          const dur = metadata?.format?.duration
          if (err || dur == null) {
            logger.warn(
              `[TTS-ASR] ffprobe failed for ${voiceOverPath}: ${err?.message ?? 'no duration'}, returning 0`,
            )
            resolve(0)
            return
          }
          resolve(dur)
        })
      })
    })
  } catch (error) {
    // Catch processWithLocalFile failures (storage download, temp file creation, etc.)
    logger.warn(
      `[TTS-ASR] Audio file processing failed for ${voiceOverPath}: ${error instanceof Error ? error.message : String(error)}, returning 0`,
    )
    return 0
  }
}

/**
 * Compute WPM and word count from corrected transcript segments
 * Handles potential missing/undefined segments gracefully
 * Returns both WPM and word count to avoid redundant calculation
 * Note: Word count is calculated independently of audio duration for accurate metrics
 */
function computeCorrectedWpmAndWordCount(
  correctedTranscript: TranscriptData,
  audioDurationSec: number,
): { wordCount: number; wpm: number } {
  // Always calculate word count from transcript (independent of duration)
  const segments = correctedTranscript?.segments ?? []
  const wordCount = segments
    .map((s) => s.text || '')
    .join(' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length

  // Only calculate WPM if duration is valid
  if (!audioDurationSec || audioDurationSec <= 0) {
    return { wpm: 0, wordCount }
  }

  const wpm = wordCount / (audioDurationSec / 60)
  return { wpm, wordCount }
}

/**
 * Save round debug information to timestamped file (non-overwriting)
 * Path: story_loader/debug/tts_rounds_<timestamp>.json
 */
export async function checkExistingAndRespond(projectId: string): Promise<null | TtsAndAsrResult> {
  if (await checkExistingWithStorage(projectId)) {
    return getExistingFilesResponse(projectId) as TtsAndAsrResult
  }
  return null
}

// eslint-disable-next-line sonarjs/cognitive-complexity -- TODO: Refactor WPM gate logic into separate function
export async function runTtsAndAsrOrchestration(
  projectId: string,
  userId: string,
  voiceId: string,
  userEmail?: string,
  // languageCode is the BCP-47 script language; forwarded to the provider layer.
  options?: {
    languageCode?: string
    onProviderResolved?: (provider: TtsProvider) => void
    orgId?: string
    skipCorrection?: boolean
  },
): Promise<TtsAndAsrResult> {
  logger.info(
    `[TTS-ASR] Enter runTtsAndAsrOrchestration - projectId: ${projectId}, voiceId: ${voiceId}`,
  )
  const effectiveVoiceId = voiceId || defaultVoiceId()

  // User context for the TTS pipeline. Build it from userId, never from email: MCP-started
  // projects legitimately have an empty email (the AuthKit token omits the email claim), so a
  // missing email must NOT suppress the whole context; userId is always present. Email stays
  // best-effort.
  const effectiveUserEmail = userEmail || ''
  const userContext = userId
    ? { orgId: options?.orgId, userId, userEmail: effectiveUserEmail }
    : undefined
  // A retired vendor's voice (Gemini, BytePlus) or a legacy MiniMax clone fal can't
  // synthesize renders with the MiniMax default voice. That's a real substitution, so the
  // caller warns the user.
  const voiceRoute = await resolveVoiceRoute(effectiveVoiceId)
  const ttsProvider = voiceRoute.provider
  const voiceSubstituted = Boolean(voiceRoute.substitutedFrom)

  if (await checkExistingWithStorage(projectId)) {
    return {
      ...(getExistingFilesResponse(projectId) as TtsAndAsrResult),
      ttsProvider,
      voiceSubstituted,
    }
  }

  // Load script text from storage (V2 compatible)
  const storage = await createStorage(projectId)
  const scriptPath = STORY_LOADER_PATHS.scriptTxtPath

  const scriptExists = await storage.exists(scriptPath)
  if (!scriptExists) {
    throw new Error(
      `Script file ${scriptPath} not found. Please ensure the script has been created before generating voiceover.`,
    )
  }

  const text = sanitizeTtsScriptText(await storage.readTextFile(scriptPath))

  // Validate script
  const scriptValidation = validateScript(text)
  if (!scriptValidation.isValid) {
    throw new Error(scriptValidation.error)
  }

  // Generate TTS and ASR (with quality validation and retries)
  const result = await generateAudioAndTranscriptWithRetries(
    text,
    effectiveVoiceId,
    projectId,
    userContext,
    undefined,
    { languageCode: options?.languageCode, onProviderResolved: options?.onProviderResolved },
  )

  if (!result.transcription) {
    throw new Error('Audio generation failed after all attempts. Please try again later.')
  }

  // Best-effort selection can still hand back a transcript ASR produced for
  // near-silent/empty audio -- catch that here instead of shipping empty voiceover.
  if (!result.transcription.text.trim()) {
    throw new Error('Audio generation failed after all attempts. Please try again later.')
  }

  // Transform, correct, and persist (call legacy domain function to keep exact behavior)
  const transformed = transformTranscriptToSegments(result.transcription)
  await processAndSaveTranscript(transformed, text, projectId, userId, {
    skipCorrection: options?.skipCorrection,
  })

  // WPM Gate: Post-correction quality check with optional Round 2
  // Get corrected transcript for WPM calculation (reuse existing storage)
  const transcriptPath = 'story_loader/transcript/transformed_transcript.json'
  const correctedTranscript1 = (await storage.readJsonFile(transcriptPath)) as TranscriptData

  // Get audio duration via ffprobe (storage-aware path)
  const voiceOverPath = 'story_loader/audio/voice_over.mp3'
  const audioDurationSec1 = await getAudioDurationSeconds(projectId, voiceOverPath)

  // Calculate corrected WPM and word count (avoids redundant calculation)
  const { wpm: correctedWpm1, wordCount: wordCount1 } = computeCorrectedWpmAndWordCount(
    correctedTranscript1,
    audioDurationSec1,
  )

  // Prepare for potential round 2

  let finalResult = result // Track final result for return value
  let outcome: 'normal' | 'retried_recovered' | 'retried_still_bad' = 'normal'

  // WPM Gate: trigger round 2 if WPM < 80 AND duration > 300s
  if (correctedWpm1 < 80 && audioDurationSec1 > 300) {
    logger.info(
      `[TTS-ASR] Round 1 quality gate triggered - WPM: ${correctedWpm1.toFixed(1)}, Duration: ${audioDurationSec1.toFixed(1)}s. Starting Round 2...`,
    )

    // Round 2: Write to temp path to avoid overwriting Round 1 audio prematurely
    const round2TempPath = 'story_loader/audio/voice_over_round2.mp3'
    const transcriptBackupPath = 'story_loader/transcript/transformed_transcript_round1_backup.json'
    let shouldPromoteRound2 = false

    // Wrap entire Round 2 in try-catch to preserve Round 1 result if Round 2 throws
    try {
      // Backup Round 1 transcript before Round 2 processing
      const storage2 = await createStorage(projectId)
      await storage2.copyFile(transcriptPath, transcriptBackupPath)
      logger.info(`[TTS-ASR] Backed up Round 1 transcript to ${transcriptBackupPath}`)

      // Round 2: Full retry with same parameters, but write to temp path
      const result2 = await generateAudioAndTranscriptWithRetries(
        text,
        effectiveVoiceId,
        projectId,
        userContext,
        round2TempPath, // Write to temp path instead of overwriting Round 1
        // Without the script language round 2 re-resolves the provider blind and can land on a
        // vendor that cannot speak this script at all.
        { languageCode: options?.languageCode },
      )

      if (result2.transcription) {
        // Process round 2 transcript (overwrites Round 1 transcript, but we have backup)
        const transformed2 = transformTranscriptToSegments(result2.transcription)
        await processAndSaveTranscript(transformed2, text, projectId, userId, {
          skipCorrection: options?.skipCorrection,
        })

        // Get round 2 metrics (Round 2 transcript is now at transcriptPath, overwriting Round 1)
        const correctedTranscript2 = (await storage2.readJsonFile(transcriptPath)) as TranscriptData
        const audioDurationSec2 = await getAudioDurationSeconds(projectId, round2TempPath)

        const { wpm: correctedWpm2, wordCount: wordCount2 } = computeCorrectedWpmAndWordCount(
          correctedTranscript2,
          audioDurationSec2,
        )

        // Determine outcome and whether to promote Round 2
        if (correctedWpm2 >= 80) {
          // Round 2 improved quality - promote temp audio to final path and keep Round 2 transcript
          outcome = 'retried_recovered'
          shouldPromoteRound2 = true
          await storage2.renameFile(round2TempPath, voiceOverPath)
          // Delete backup since we're keeping Round 2 transcript
          await storage2.deleteFile(transcriptBackupPath).catch((cleanupErr) => {
            logger.warn(
              `[TTS-ASR] Failed to cleanup transcript backup: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`,
            )
          })
          logger.info(
            `[TTS-ASR] Round 2 recovered - WPM: ${correctedWpm2.toFixed(1)}, Duration: ${audioDurationSec2.toFixed(1)}s, promoted to final path`,
          )
          finalResult = result2
        } else {
          // Round 2 still has low WPM - restore Round 1 transcript and cleanup temp audio
          outcome = 'retried_still_bad'
          // Restore Round 1 transcript from backup
          await storage2.copyFile(transcriptBackupPath, transcriptPath)
          await storage2.deleteFile(transcriptBackupPath).catch((cleanupErr) => {
            logger.warn(
              `[TTS-ASR] Failed to cleanup transcript backup: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`,
            )
          })
          // Cleanup Round 2 temp audio
          await storage2.deleteFile(round2TempPath).catch((cleanupErr) => {
            logger.warn(
              `[TTS-ASR] Failed to cleanup Round 2 temp audio: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`,
            )
          })
          logger.warn(
            `[ttsRetryQualityLow] Round 2 still low WPM, keeping Round 1 - projectId: ${projectId}, voiceId: ${effectiveVoiceId}, ` +
              `round1Wpm: ${correctedWpm1.toFixed(1)}, round1Duration: ${audioDurationSec1.toFixed(1)}s, ` +
              `round2Wpm: ${correctedWpm2.toFixed(1)}, round2Duration: ${audioDurationSec2.toFixed(1)}s`,
          )
        }

        // Save debug info with round 2 data (non-blocking, failures logged only)
        try {
          await saveRoundsDebugInfo(
            projectId,
            {
              durationSec: audioDurationSec1,
              correctedWpm: correctedWpm1,
              wordCount: wordCount1,
            },
            {
              durationSec: audioDurationSec2,
              correctedWpm: correctedWpm2,
              wordCount: wordCount2,
            },
            outcome,
          )
        } catch (debugError) {
          logger.warn(
            `[TTS-ASR] Failed to save debug info: ${debugError instanceof Error ? debugError.message : String(debugError)}`,
          )
        }
      } else {
        // Round 2 failed to produce transcription, cleanup temp audio and transcript backup
        outcome = 'retried_still_bad'
        // Delete transcript backup (Round 1 transcript was never overwritten)
        await storage2.deleteFile(transcriptBackupPath).catch((cleanupErr) => {
          logger.warn(
            `[TTS-ASR] Failed to cleanup transcript backup: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`,
          )
        })
        // Cleanup Round 2 temp audio
        await storage2.deleteFile(round2TempPath).catch((cleanupErr) => {
          logger.warn(
            `[TTS-ASR] Failed to cleanup Round 2 temp audio: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`,
          )
        })
        logger.warn(
          `[ttsRetryQualityLow] Round 2 failed (no transcription), keeping Round 1 - projectId: ${projectId}, voiceId: ${effectiveVoiceId}, ` +
            `round1Wpm: ${correctedWpm1.toFixed(1)}, round1Duration: ${audioDurationSec1.toFixed(1)}s, round2: no transcription`,
        )

        // Save debug info without round 2 data (non-blocking, failures logged only)
        try {
          await saveRoundsDebugInfo(
            projectId,
            {
              durationSec: audioDurationSec1,
              correctedWpm: correctedWpm1,
              wordCount: wordCount1,
            },
            undefined,
            outcome,
          )
        } catch (debugError) {
          logger.warn(
            `[TTS-ASR] Failed to save debug info: ${debugError instanceof Error ? debugError.message : String(debugError)}`,
          )
        }
      }
    } catch (round2Error) {
      // Round 2 threw exception (e.g., all TTS attempts failed) - keep Round 1 result (best effort)
      // finalResult/finalTranscription/finalCorrectedTranscript remain Round 1 values
      outcome = 'retried_still_bad'

      // Restore transcript if Round 2 was not promoted
      if (!shouldPromoteRound2) {
        await restoreRound1Transcript(projectId, transcriptBackupPath, transcriptPath)
      }

      logger.warn(
        `[ttsRetryQualityLow] Round 2 failed with exception, keeping Round 1 - projectId: ${projectId}, voiceId: ${effectiveVoiceId}, ` +
          `round1Wpm: ${correctedWpm1.toFixed(1)}, round1Duration: ${audioDurationSec1.toFixed(1)}s, ` +
          `error: ${round2Error instanceof Error ? round2Error.message : String(round2Error)}`,
      )

      // Save debug info without round 2 data (non-blocking, failures logged only)
      try {
        await saveRoundsDebugInfo(
          projectId,
          {
            durationSec: audioDurationSec1,
            correctedWpm: correctedWpm1,
            wordCount: wordCount1,
          },
          undefined,
          outcome,
        )
      } catch (debugError) {
        logger.warn(
          `[TTS-ASR] Failed to save debug info: ${debugError instanceof Error ? debugError.message : String(debugError)}`,
        )
      }
      // Continue with Round 1 result (no re-throw)
    } finally {
      // CRITICAL: Always cleanup Round 2 temp audio, regardless of success/failure
      // This runs even if transcript restoration fails, preventing storage leaks
      if (!shouldPromoteRound2) {
        try {
          const storage2 = await createStorage(projectId)
          await storage2.deleteFile(round2TempPath).catch((cleanupErr) => {
            logger.warn(
              `[TTS-ASR] Failed to cleanup Round 2 temp audio: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`,
            )
          })
        } catch (storageErr) {
          // Best effort cleanup - don't fail if storage creation fails
          logger.warn(
            `[TTS-ASR] Failed to initialize storage for temp audio cleanup: ${storageErr}`,
          )
        }
      }
    }
  } else {
    // Normal case: no round 2 needed (non-blocking, failures logged only)
    try {
      await saveRoundsDebugInfo(
        projectId,
        {
          durationSec: audioDurationSec1,
          correctedWpm: correctedWpm1,
          wordCount: wordCount1,
        },
        undefined,
        outcome,
      )
    } catch (debugError) {
      logger.warn(
        `[TTS-ASR] Failed to save debug info: ${debugError instanceof Error ? debugError.message : String(debugError)}`,
      )
    }
  }

  // Return legacy-compatible structure (use final result from Round 1 or Round 2)
  return {
    ...(getSuccessResponse(
      finalResult,
      projectId,
      effectiveVoiceId,
      text,
      userId,
    ) as TtsAndAsrResult),
    ttsProvider: result.provider,
    voiceSubstituted,
  }
}

async function checkExistingWithStorage(projectId: string): Promise<boolean> {
  const storage = await createStorage(projectId)
  const voiceRel = 'story_loader/audio/voice_over.mp3'
  const transcriptRel = FileHub.transcriptJson(projectId).path
  const [hasVoice, hasTranscript] = await Promise.all([
    storage.exists(voiceRel),
    storage.exists(transcriptRel),
  ])
  return hasVoice && hasTranscript
}

async function saveRoundsDebugInfo(
  projectId: string,
  round1Data: {
    correctedWpm: number
    durationSec: number
    wordCount: number
  },
  round2Data:
    | undefined
    | {
        correctedWpm: number
        durationSec: number
        wordCount: number
      },
  outcome: 'normal' | 'retried_recovered' | 'retried_still_bad',
): Promise<void> {
  const storage = await createStorage(projectId)
  const timestamp = Date.now()
  const debugPath = `story_loader/debug/tts_rounds_${timestamp}.json`

  const debugInfo = {
    timestamp: new Date().toISOString(),
    projectId,
    round1: round1Data,
    round2: round2Data || null,
    outcome,
  }

  await storage.writeJsonFile(debugPath, debugInfo)
  logger.info(`[TTS-ASR] Debug rounds info saved: ${debugPath}`)
}
