import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { createStorage } from '@reelmakeeasy/common/agent-v2/storage/storage'
import { ElevenLabsClient } from '@reelmakeeasy/common/elevenlabs/client'
import {
  CharacterAlignmentResponseModel,
  SpeechToTextChunkResponseModel,
} from '@reelmakeeasy/common/elevenlabs/client'
import { elevenLabsApiKey } from '@reelmakeeasy/common/elevenlabs/key'
import { completion } from '@reelmakeeasy/common/llm'
import { logger } from '@reelmakeeasy/common/logger'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import { countWords } from '@reelmakeeasy/common/utils/text'
import { TranscriptData } from '@shared/types/agent/transcript'
import ffmpeg from 'fluent-ffmpeg'
import { z } from 'zod'

import { FileHub } from '../../../common/file-hub'

import { checkTranscriptFidelity } from './transcript-fidelity.util'

export const getElevenLabsClient = () => {
  const apiKey = process.env['ELEVENLABS_API_KEY']
  if (!apiKey) {
    throw new Error('ELEVENLABS_API_KEY is not set in environment')
  }
  return new ElevenLabsClient({ apiKey })
}

// Define response schemas for LLM calls
const CorrectedTranscriptSchema = z.object({
  correctedTranscript: z.object({
    language: z.string(),
    segments: z.array(
      z.object({
        end: z.number(),
        start: z.number(),
        text: z.string(),
        words: z.array(
          z.object({
            end: z.number(),
            speaker: z.string().nullable(),
            start: z.number(),
            word: z.string(),
          }),
        ),
      }),
    ),
  }),
})

const ScriptValidationSchema = z.object({
  confidence: z.number().min(0).max(1),
  explanation: z.string(),
  issues: z.array(z.string()),
  isValid: z.boolean(),
})

const MIN_AUDIO_DURATION_SECONDS = 10
const MIN_BITRATE_KBPS = 128
// Supported audio formats for voice cloning
const SUPPORTED_AUDIO_FORMATS = ['mp3', 'wav']

// Helper functions for TTS and ASR tool
export async function checkExistingFiles(projectId: string): Promise<boolean> {
  const storage = await createStorage(projectId)
  const voiceOverPath = 'story_loader/audio/voice_over.mp3'
  const transcriptPath = FileHub.transcriptJson(projectId).path
  const [hasVoice, hasTranscript] = await Promise.all([
    storage.exists(voiceOverPath),
    storage.exists(transcriptPath),
  ])
  return hasVoice && hasTranscript
}

/**
 * Corrects an entire transcript JSON by comparing with original script and fixing spelling mistakes.
 * Lets the LLM handle the correction directly by providing the full JSON structure.
 */
export async function correctTranscriptJson(
  transcriptData: TranscriptData,
  originalScript: string,
  debugDir?: string,
  projectId?: string,
): Promise<{
  correctedTranscript: TranscriptData
  hasCorrections: boolean
}> {
  try {
    const originalText = transcriptData.segments.map((segment) => segment.text).join(' ')
    logger.info(
      `[ElevenLabs] Starting transcript correction - originalTextLength: ${originalText.length}, segmentsCount: ${transcriptData.segments.length}, originalScriptLength: ${originalScript.length}`,
    )
    const prompt = `You are correcting a transcript JSON that may have spelling mistakes from TTS/ASR processing.

ORIGINAL SCRIPT:
${originalScript}

TRANSCRIPT JSON TO CORRECT:
${JSON.stringify(transcriptData, null, 2)}

INSTRUCTIONS:
1. Focus ONLY on correcting spelling mistakes that differ from the original script
2. IGNORE extra words that may have been added by TTS (these are acceptable)
3. IGNORE minor word substitutions that preserve meaning, EXCEPT proper nouns and brand names (see rule 5)
4. IGNORE punctuation and capitalization differences
5. Correct clear spelling errors (e.g., "zibouboule" → "zibubu"). ALWAYS restore proper nouns and brand names to the exact spelling used in the original script when the ASR word sounds like the script's word, even if the ASR word is a valid English word (e.g., ASR wrote "Meridian" but the original script says "Merydian" → correct it to "Merydian"). Respell existing words in place; NEVER merge, split, add, or remove words to do this
6. Keep all timing information (start, end) exactly the same
7. Keep all speaker information exactly the same
8. Only change the "word" field and corresponding "text" field when correcting spelling

Return the corrected transcript JSON with the exact same structure, only correcting spelling mistakes in the "word" fields and updating the corresponding "text" fields to match.`

    const parsedResult = await completion({
      models: 'pro',
      responseFormat: CorrectedTranscriptSchema,
      prompt,
      task: 'correct-transcript-json',
      temperature: 0.1,
    })

    if (!parsedResult.correctedTranscript || !parsedResult.correctedTranscript.segments) {
      logger.warn('[ElevenLabs] LLM returned unexpected structure, using original')
      return {
        correctedTranscript: transcriptData,
        hasCorrections: false,
      }
    }

    const correctedText = parsedResult.correctedTranscript.segments
      .map((segment: { text: string }) => segment.text)
      .join(' ')

    const hasChanges = originalText !== correctedText

    if (debugDir) {
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const originalFile = path.join(debugDir, `original-${timestamp}.json`)
      const correctedFile = path.join(debugDir, `corrected-${timestamp}.json`)

      if (projectId) {
        const debugStorage = await createStorage(projectId)
        await debugStorage.writeJsonFile(originalFile, transcriptData)
        await debugStorage.writeJsonFile(correctedFile, parsedResult.correctedTranscript)
        logger.info(
          `[ElevenLabs] Transcript correction completed (storage) - originalSegments: ${transcriptData.segments.length}, correctedSegments: ${parsedResult.correctedTranscript.segments.length}, hasChanges: ${hasChanges}, originalFile: ${originalFile}, correctedFile: ${correctedFile}`,
        )
      } else {
        await mkdir(debugDir, { recursive: true })

        await writeFile(originalFile, JSON.stringify(transcriptData, null, 2))
        await writeFile(correctedFile, JSON.stringify(parsedResult.correctedTranscript, null, 2))

        logger.info(
          `[ElevenLabs] Transcript correction completed - originalSegments: ${transcriptData.segments.length}, correctedSegments: ${parsedResult.correctedTranscript.segments.length}, hasChanges: ${hasChanges}, originalFile: ${originalFile}, correctedFile: ${correctedFile}`,
        )
      }
    } else {
      logger.info(
        `[ElevenLabs] Transcript correction completed - originalSegments: ${transcriptData.segments.length}, correctedSegments: ${parsedResult.correctedTranscript.segments.length}, hasChanges: ${hasChanges}`,
      )
    }

    const hasCorrections = originalText !== correctedText

    return {
      correctedTranscript: parsedResult.correctedTranscript,
      hasCorrections,
    }
  } catch (error) {
    logger.error(`[ElevenLabs] Error in transcript JSON correction: ${ensureError(error).message}`)
    return {
      correctedTranscript: transcriptData,
      hasCorrections: false,
    }
  }
}

/**
 * Core voice cloning function that can be called independently of the tool system.
 * Creates a voice clone using ElevenLabs Instant Voice Cloning (IVC) API.
 *
 * @param name - The name for the voice clone
 * @param audioFilePath - File path to audio file for voice cloning
 * @param description - Optional description for the voice clone that will be displayed in the ElevenLabs UI
 * @returns Promise resolving to an object with status, voice_id (if successful), and message
 */
export async function createVoiceClone(
  name: string,
  audioFilePath: string,
  description: string,
): Promise<{
  message: string
  status: 'error' | 'success'
  voice_id?: string
}> {
  try {
    const removeBackgroundNoise = false // Optional by default for now
    const elevenlabs = getElevenLabsClient()

    const validationErrors: string[] = []
    const totalDuration = { seconds: 0 }

    try {
      // NOTE: This assumes audioFilePath is a valid local path.
      // If createVoiceClone is used in V2 context, the caller must ensure the file is available locally
      // or we need to update this to accept Buffer/Storage.
      // For now, validation remains local-FS based as it's an external tool entry point.
      const audioInfo = await validateAudioFile(audioFilePath)
      totalDuration.seconds += audioInfo.duration

      // Check duration
      if (audioInfo.duration < MIN_AUDIO_DURATION_SECONDS) {
        validationErrors.push(
          `Duration ${audioInfo.duration.toFixed(1)}s is below minimum ${MIN_AUDIO_DURATION_SECONDS}s`,
        )
      }

      // Check bitrate
      if (audioInfo.bitrate < MIN_BITRATE_KBPS) {
        validationErrors.push(
          `Bitrate ${audioInfo.bitrate}kbps is below minimum ${MIN_BITRATE_KBPS}kbps`,
        )
      }

      // Check format
      if (!SUPPORTED_AUDIO_FORMATS.includes(audioInfo.format.toLowerCase())) {
        validationErrors.push(
          `Format "${audioInfo.format}" is not supported. Supported formats: ${SUPPORTED_AUDIO_FORMATS.join(', ')}`,
        )
      }
    } catch (error) {
      validationErrors.push(`${ensureError(error).message}`)
    }

    if (validationErrors.length > 0) {
      logger.info(
        `[ElevenLabs] voice clone failed, ${audioFilePath}: ${validationErrors.join('\n')}`,
      )
      return {
        message: `Audio validation failed: ${validationErrors.join('\n')}\n\nRequirements:\n- Each audio file must be at least ${MIN_AUDIO_DURATION_SECONDS} seconds\n- Minimum bitrate: ${MIN_BITRATE_KBPS}kbps\n- Supported formats: ${SUPPORTED_AUDIO_FORMATS.join(', ')}\n- For best results, use 1-2 minutes of clear audio without reverb, artifacts, or background noise.`,
        status: 'error',
      }
    }

    const fileBuffer = await readFile(audioFilePath)

    const audioInfo = await validateAudioFile(audioFilePath)
    const fileName = path.basename(audioFilePath) || `audio.${audioInfo.format.toLowerCase()}`

    const mimeType = getMimeType(audioInfo.format)

    const file = new File([new Uint8Array(fileBuffer)], fileName, { type: mimeType })

    // Create voice clone using IVC API
    const voiceClone = await elevenlabs.voices.ivc.create({
      description: description || undefined,
      files: [file],
      name,
      removeBackgroundNoise,
    })

    if (voiceClone.requiresVerification) {
      return {
        message: `Voice clone "${name}" requires verification and cannot be used. Please try again with a different audio file`,
        status: 'error',
      }
    }

    return {
      message: `Voice clone "${name}" created successfully with ID: ${voiceClone.voiceId}.`,
      status: 'success',
      voice_id: voiceClone.voiceId,
    }
  } catch (error: unknown) {
    logger.error(`[ElevenLabs] Error in createVoiceClone: ${error}`)
    return {
      message: ensureError(error).message,
      status: 'error',
    }
  }
}

/**
 * Evaluates the quality of transcript correction by comparing timing data
 * between original and corrected transcripts
 */
// eslint-disable-next-line sonarjs/cognitive-complexity
export function evaluateCorrectionQuality(
  original: TranscriptData,
  corrected: TranscriptData,
): {
  averageSegmentDrift: number
  averageWordDrift: number
  correctedWords: number
  correctionType: 'structure_changed' | 'timing_altered' | 'timing_preserved'
  maxSegmentDrift: number
  maxWordDrift: number
  segmentCountPreserved: boolean
  timingPreserved: boolean
  totalWords: number
  wordsWithTimingIssues: number
} {
  const TIMING_THRESHOLD = 0.1 // 100ms threshold for significant timing changes

  // Check if segment count is preserved
  const segmentCountPreserved = Math.abs(original.segments.length - corrected.segments.length) <= 1

  // Calculate timing drift for segments and words
  const segmentTimingDrifts: number[] = []
  const wordTimingDrifts: number[] = []
  let totalWords = 0
  let correctedWords = 0
  let wordsWithTimingIssues = 0

  for (let i = 0; i < Math.min(original.segments.length, corrected.segments.length); i++) {
    const origSegment = original.segments[i]
    const corrSegment = corrected.segments[i]

    // Check segment-level timing drift
    if (origSegment.start != null && corrSegment.start != null) {
      const startDrift = Math.abs(origSegment.start - corrSegment.start)
      segmentTimingDrifts.push(startDrift)
    }

    if (origSegment.end != null && corrSegment.end != null) {
      const endDrift = Math.abs(origSegment.end - corrSegment.end)
      segmentTimingDrifts.push(endDrift)
    }

    // Check word-level timing drift
    const minWordCount = Math.min(origSegment.words.length, corrSegment.words.length)
    for (let j = 0; j < minWordCount; j++) {
      const origWord = origSegment.words[j]
      const corrWord = corrSegment.words[j]

      if (origWord.start != null && corrWord.start != null) {
        const wordStartDrift = Math.abs(origWord.start - corrWord.start)
        wordTimingDrifts.push(wordStartDrift)

        if (wordStartDrift > TIMING_THRESHOLD) {
          wordsWithTimingIssues += 1
        }
      }

      if (origWord.end != null && corrWord.end != null) {
        const wordEndDrift = Math.abs(origWord.end - corrWord.end)
        wordTimingDrifts.push(wordEndDrift)

        if (wordEndDrift > TIMING_THRESHOLD) {
          wordsWithTimingIssues += 1
        }
      }
    }

    // Count words and check for corrections
    totalWords += origSegment.words.length
    if (origSegment.text !== corrSegment.text) {
      correctedWords += 1
    }
  }

  // Calculate timing statistics for both segments and words
  const averageSegmentDrift =
    segmentTimingDrifts.length > 0
      ? segmentTimingDrifts.reduce((a, b) => a + b, 0) / segmentTimingDrifts.length
      : 0
  const maxSegmentDrift = segmentTimingDrifts.length > 0 ? Math.max(...segmentTimingDrifts) : 0

  const averageWordDrift =
    wordTimingDrifts.length > 0
      ? wordTimingDrifts.reduce((a, b) => a + b, 0) / wordTimingDrifts.length
      : 0
  const maxWordDrift = wordTimingDrifts.length > 0 ? Math.max(...wordTimingDrifts) : 0

  const timingPreserved =
    averageWordDrift <= TIMING_THRESHOLD && maxWordDrift <= TIMING_THRESHOLD * 2

  // Determine correction type
  let correctionType: 'structure_changed' | 'timing_altered' | 'timing_preserved'
  if (!segmentCountPreserved) {
    correctionType = 'structure_changed'
  } else if (timingPreserved) {
    correctionType = 'timing_preserved'
  } else {
    correctionType = 'timing_altered'
  }

  return {
    averageSegmentDrift,
    averageWordDrift,
    correctedWords,
    correctionType,
    maxSegmentDrift,
    maxWordDrift,
    segmentCountPreserved,
    timingPreserved,
    totalWords,
    wordsWithTimingIssues,
  }
}

export function getExistingFilesResponse(projectId: string) {
  // Use relative paths for consistency with V2
  const voiceOverPath = 'story_loader/audio/voice_over.mp3'
  const transcriptPath = FileHub.transcriptJson(projectId).path

  return {
    message: 'Voiceover and transcript already exists, skipping generation',
    status: 'success',
    voice_over_path: voiceOverPath,
    transcript_path: transcriptPath,
  }
}
export function getSuccessResponse(
  result: {
    attempt: number
    qualityIssues: string[]
    transcription: null | SpeechToTextChunkResponseModel
    ttsModel: string
  },
  projectId: string,
  voiceId: string,
  text: string,
  userId: string,
) {
  const voiceOverPath = 'story_loader/audio/voice_over.mp3'
  const transcriptPath = FileHub.transcriptJson(projectId).path

  return {
    message: `TTS generated and ASR completed successfully on attempt ${result.attempt + 1} using ${result.ttsModel} model (voiceId=${voiceId}) with voice isolation`,
    status: 'success',
    transcript: result.transcription?.text || '',
    transcript_path: transcriptPath,
    voice_over_path: voiceOverPath,
  }
}

/**
 * Isolates voice from an audio file using ElevenLabs Voice Isolation API
 */
export async function isolateVoiceFromAudio(
  audioFilePath: string,
  fileFormat: 'other' | 'pcm_s16le_16' = 'other',
): Promise<{
  isolatedAudioPath?: string
  message: string
  status: 'error' | 'success'
}> {
  // Isolation only cleans up a clone sample; without the key the sample is used as recorded.
  const apiKey = elevenLabsApiKey()
  if (!apiKey) {
    const message = 'Voice isolation skipped: it needs ELEVENLABS_API_KEY'
    logger.info(`[TTS] ${message}`)
    return { message, status: 'error' }
  }

  try {
    const audioBuffer = await readFile(audioFilePath)
    const fileName = path.basename(audioFilePath)

    const formData = new FormData()
    formData.append('audio', new Blob([new Uint8Array(audioBuffer)]), fileName)
    formData.append('file_format', fileFormat)

    const response = await fetch('https://api.elevenlabs.io/v1/audio-isolation', {
      body: formData,
      headers: {
        'xi-api-key': apiKey,
      },
      method: 'POST',
    })

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Voice isolation API error: ${response.status} - ${errorText}`)
    }

    const isolatedAudioBuffer = await response.arrayBuffer()
    if (isolatedAudioBuffer.byteLength === 0) {
      throw new Error('Voice isolation API returned empty audio buffer')
    }
    await writeFile(audioFilePath, Buffer.from(isolatedAudioBuffer))

    return {
      isolatedAudioPath: audioFilePath,
      message: `Voice isolation completed successfully. Original file replaced with isolated audio: ${audioFilePath}`,
      status: 'success',
    }
  } catch (error: unknown) {
    logger.error({ error }, '[TTS] Error in voice isolation:')
    return {
      message: ensureError(error).message,
      status: 'error',
    }
  }
}
export async function processAndSaveTranscript(
  transformed: TranscriptData,
  text: string,
  projectId: string,
  userId: string,
  options?: { skipCorrection?: boolean },
): Promise<void> {
  const storage = await createStorage(projectId)
  let correctedTranscript = transformed
  let hasCorrections = false
  if (options?.skipCorrection) {
    // Split-activity path: TTS+ASR-only activity writes raw transcript; a
    // separate correctLongTakeTranscript activity owns the LLM correction.
    // Lets us see correction failures as a distinct activity instead
    // of buried inside generateLongTakeVoiceover.
    const transcriptRelPath = 'story_loader/transcript/transformed_transcript.json'
    await storage.writeJsonFile(transcriptRelPath, transformed)
    logger.info(
      `[ElevenLabs] Raw transcript saved (correction deferred to separate activity) - transcriptPath: ${transcriptRelPath}, segments: ${transformed.segments.length}`,
    )
    return
  }
  try {
    logger.info('[ElevenLabs] Applying transcript correction using original text as script')
    const debugRelPath = 'story_loader/transcript/debug'
    const debugDir = debugRelPath
    const result = await correctTranscriptJson(transformed, text, debugDir, projectId)
    correctedTranscript = result.correctedTranscript
    hasCorrections = result.hasCorrections

    logger.info(
      `[ElevenLabs] TTS transcript correction completed - segmentsCount: ${correctedTranscript.segments.length}`,
    )
  } catch (error) {
    logger.warn(
      `[ElevenLabs] Transcript correction failed, using uncorrected transcript: ${ensureError(error).message}`,
    )
  }

  // Use the corrected transcript as the final output
  // V2: Write to storage; V1: Write to local filesystem
  const transcriptRelPath = 'story_loader/transcript/transformed_transcript.json'

  await storage.writeJsonFile(transcriptRelPath, correctedTranscript)

  logger.info(
    `[ElevenLabs] Transcript processing completed - using corrected version, transcriptPath: ${transcriptRelPath}, hasCorrections: ${hasCorrections}`,
  )
}

/**
 * Saves TTS timestamps to a file for debugging purposes
 */
export async function saveTTSTimestamps(
  timestamps: {
    alignment?: CharacterAlignmentResponseModel
  },
  projectId: string,
  text: string,
): Promise<string> {
  try {
    const storage = await createStorage(projectId)
    const debugRelPath = 'story_loader/transcript/debug'
    const debugDir = debugRelPath
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const fileName = `tts_timestamps_${timestamp}.json`
    const filePath = path.join(debugDir, fileName)

    const timestampData = {
      text,
      projectId,
      timestamp: new Date().toISOString(),
      alignment: timestamps.alignment,
      analysis: (() => {
        if (
          !timestamps.alignment ||
          timestamps.alignment.characters.length === 0 ||
          timestamps.alignment.characterStartTimesSeconds.length === 0 ||
          timestamps.alignment.characterEndTimesSeconds.length === 0
        ) {
          return null
        }

        const startTime = timestamps.alignment.characterStartTimesSeconds[0]
        const endTime =
          timestamps.alignment.characterEndTimesSeconds[
            timestamps.alignment.characterEndTimesSeconds.length - 1
          ]

        // Validate that we have valid numeric values
        if (
          typeof startTime !== 'number' ||
          typeof endTime !== 'number' ||
          Number.isNaN(startTime) ||
          Number.isNaN(endTime) ||
          endTime <= startTime
        ) {
          return null
        }

        const duration = endTime - startTime
        const characterCount = timestamps.alignment.characters.length

        // Use accurate articulation rate calculation (words per minute when actually speaking)
        const articulationRate = timestamps.alignment
          ? calculateArticulationRateFromAlignment(timestamps.alignment)
          : 0

        return {
          characterCount,
          duration,
          articulationRate: Math.round(articulationRate),
        }
      })(),
    }

    await storage.writeJsonFile(filePath, timestampData)

    return filePath
  } catch (error) {
    logger.error(`[ElevenLabs] Failed to save TTS timestamps: ${ensureError(error).message}`)
    throw error
  }
}

// This function does the following:
// 1. Checks for multiple speakers (should only be one)
// 2. Checks for audio events (hallucinations)
// 3. Checks for long pauses between consecutive words
// 4. Returns issues and isValid flag (issues are empty if the audio quality is good)
// eslint-disable-next-line sonarjs/cognitive-complexity
export function validateAudioQuality(asrResult: SpeechToTextChunkResponseModel): {
  issues: string[]
  isValid: boolean
} {
  const issues: string[] = []

  if (asrResult.words && Array.isArray(asrResult.words)) {
    // Check for multiple speakers (should only be one)
    const wordEvents = asrResult.words.filter((word) => word.type === 'word')
    const speakerIds = new Set(
      wordEvents
        .map((word) => word.speakerId)
        .filter((speaker) => speaker != null && speaker !== ''),
    )

    if (speakerIds.size > 1) {
      issues.push(
        `Multiple speakers detected (${speakerIds.size}): ${Array.from(speakerIds).join(', ')}. Only one speaker should be present.`,
      )
    }

    // Check for audio events (hallucinations)
    const audioEvents = asrResult.words.filter((word) => word.type === 'audio_event')

    for (const event of audioEvents) {
      if (event.start != null && event.end != null) {
        const duration = event.end - event.start

        if (duration > 1) {
          issues.push('Long audio event detected')
          break
        }
      }
    }

    // Check for long pauses between consecutive words
    for (let i = 1; i < wordEvents.length; i++) {
      const prev = wordEvents[i - 1]
      const curr = wordEvents[i]

      if (prev.end != null && curr.start != null) {
        const gap = curr.start - prev.end

        // Flag pauses longer than 1.5 seconds risk losing user's attention
        if (gap > 1.5) {
          issues.push('Long pause detected between words')
          break
        }
      }
    }
  }

  return { issues, isValid: issues.length === 0 }
}

/**
 * Enhanced audio quality validation that includes both audio quality checks and LLM-based script accuracy validation
 */
export async function validateAudioQualityWithScript(
  asrResult: SpeechToTextChunkResponseModel,
  originalScript: string,
): Promise<{ issues: string[]; isValid: boolean }> {
  // Skip audio quality validation for non-English languages as our validation logic is designed for English
  let audioQualityIssues: string[] = []
  if (asrResult.languageCode === 'eng') {
    const basicAudioValid = validateAudioQuality(asrResult)
    if (!basicAudioValid.isValid) {
      audioQualityIssues = basicAudioValid.issues
    }
  }

  const scriptValidation = await validateScriptAccuracy(originalScript, asrResult.text || '')

  return {
    issues: [...audioQualityIssues, ...scriptValidation.issues],
    isValid: audioQualityIssues.length === 0 && scriptValidation.isValid,
  }
}
export function validateScript(text: string): { error?: string; isValid: boolean } {
  if (!text || text.trim().length === 0) {
    return {
      isValid: false,
      error: 'Script file story_loader/script.txt is empty or does not contain valid text.',
    }
  }

  return { isValid: true }
}

// spellchecker: off
/**
 * LLM-based quality checker that compares original script with ASR transcript
 * to detect word substitutions, dropped words, and hallucinations.
 */
export async function validateScriptAccuracy(
  originalScript: string,
  asrTranscript: string,
): Promise<{ confidence: number; issues: string[]; isValid: boolean }> {
  // Deterministic fidelity check first - no LLM needed for obvious truncation or
  // inserted speech. Shares one implementation with tts-quality-validation.util
  // so the two copies of this gate cannot drift apart again.
  const fidelityCheck = checkTranscriptFidelity(originalScript, asrTranscript)
  if (!fidelityCheck.isValid) {
    return { confidence: 1, issues: fidelityCheck.issues, isValid: false }
  }

  try {
    const prompt = `You are an expert audio quality validator. Compare the original script with the ASR transcript and flag any word-level deviations — substitutions, dropped words, added words, or reorderings that are not in the original.

FLAG these as issues:
- Any word substituted for a different word, even if meaning seems similar (e.g. "product" vs "project", "build" vs "create")
- Words dropped from the original that are not present in the ASR
- Words added in the ASR that do not appear in the original (hallucinations)
- Sentences or clauses reordered relative to the original

DO NOT flag these as issues:
- Punctuation differences (commas, colons, dashes)
- Capitalization differences
- Filler words like "um", "uh" that are natural in speech
- Spelling variations of proper nouns where pronunciation is identical (e.g. "Jon" vs "John")
- Number formatting differences where the spoken form is identical (e.g. "$500" vs "five hundred dollars", "7" vs "seven")
- Parenthetical expansions or clarifications the ASR adds when vocalizing abbreviations or symbols (e.g. original "(NREM)" spoken as ", or NREM,")
- Phonetically near-identical word variants or common misspellings that sound the same when spoken (e.g. "pretension" vs "pretention", "centre" vs "center", "realise" vs "realize")

Respond with a JSON object:
{
  "isValid": boolean (true only if no deviations found),
  "issues": [list each deviation as a short string, e.g. "word substitution: 'product' → 'project'"],
  "confidence": number (0-1),
  "explanation": "brief summary of findings"
}
ORIGINAL SCRIPT:
${originalScript}

ASR TRANSCRIPT:
${asrTranscript}
`

    const parsedResult = await completion({
      models: 'flash',
      responseFormat: ScriptValidationSchema,
      prompt,
      task: 'validate-script-accuracy',
      temperature: 0.1,
    })

    logger.info(
      `[TTS] LLM validation response - confidence: ${parsedResult.confidence}, explanation: ${parsedResult.explanation}, issues: ${parsedResult.issues}, isValid: ${parsedResult.isValid}`,
    )

    return {
      confidence: parsedResult.confidence || 0.5,
      issues: parsedResult.issues || [],
      isValid: parsedResult.isValid || false,
    }
  } catch (error) {
    logger.error(`[TTS] Error in LLM-based script validation: ${error}`)
    // Fail CLOSED: a validator that could not run has not cleared this take, so
    // defaulting to valid just promotes an unvalidated voiceover. The
    // deterministic fidelity check above already passed; callers retry and still
    // fall back to the best available take, so this costs re-renders, not a block.
    return {
      confidence: 0,
      issues: [`LLM validation failed: ${ensureError(error).message}`],
      isValid: false,
    }
  }
}

/**
 * Calculates actual speaking duration excluding silent gaps between words
 * This gives us the articulation duration for true articulation rate calculation
 */
function calculateArticulationDuration(
  characters: string[],
  startTimes: number[],
  endTimes: number[],
): number {
  if (characters.length === 0 || startTimes.length === 0 || endTimes.length === 0) {
    return 0
  }

  let totalSpeakingDuration = 0
  let wordStartTime: null | number = null
  let wordEndTime: null | number = null

  for (let i = 0; i < characters.length; i++) {
    const char = characters[i]
    const charStart = startTimes[i]
    const charEnd = endTimes[i]

    // Skip invalid timing data
    if (
      typeof charStart !== 'number' ||
      typeof charEnd !== 'number' ||
      Number.isNaN(charStart) ||
      Number.isNaN(charEnd)
    ) {
      continue
    }

    if (char === ' ') {
      // End of word - add the word duration if we have a complete word
      if (wordStartTime !== null && wordEndTime !== null) {
        totalSpeakingDuration += wordEndTime - wordStartTime
      }
      wordStartTime = null
      wordEndTime = null
    } else {
      // Character is part of a word
      if (wordStartTime === null) {
        wordStartTime = charStart // Start of new word
      }
      wordEndTime = charEnd // Update end of current word
    }
  }

  // Handle the last word if it doesn't end with a space
  if (wordStartTime !== null && wordEndTime !== null) {
    totalSpeakingDuration += wordEndTime - wordStartTime
  }

  return totalSpeakingDuration
}

/**
 * Calculates articulation rate (words/min) from character alignment data
 * Uses actual speaking time excluding silent gaps for true articulation rate
 */
function calculateArticulationRateFromAlignment(
  alignment: CharacterAlignmentResponseModel,
): number {
  const { characters, characterStartTimesSeconds, characterEndTimesSeconds } = alignment

  if (characterStartTimesSeconds.length === 0 || characterEndTimesSeconds.length === 0) {
    logger.warn('[TTS] Articulation rate calculation failed: no timing data available')
    return 0
  }

  // Extract text and find word boundaries (use shared countWords for consistency)
  const alignmentText = characters.join('')
  const wordCount = countWords(alignmentText)

  if (wordCount === 0) {
    logger.warn('[TTS] Articulation rate calculation failed: no words found in alignment text')
    return 0
  }

  // Calculate actual speaking duration by finding word segments and excluding gaps
  const articulationDuration = calculateArticulationDuration(
    characters,
    characterStartTimesSeconds,
    characterEndTimesSeconds,
  )

  if (articulationDuration <= 0) {
    logger.warn(
      `[TTS] Articulation rate calculation failed: invalid articulation duration (${articulationDuration.toFixed(3)}s)`,
    )
    return 0
  }

  const articulationRate = wordCount / (articulationDuration / 60)

  // Sanity check for unrealistic articulation rate values
  if (articulationRate > 500 || articulationRate < 10) {
    logger.warn(
      `[TTS] Articulation rate seems unrealistic: ${articulationRate.toFixed(1)} words/min (speaking duration: ${articulationDuration.toFixed(3)}s, words: ${wordCount})`,
    )
    return 0
  }

  logger.info(
    `[TTS] Articulation rate: ${articulationRate.toFixed(1)} words/min (speaking duration: ${articulationDuration.toFixed(3)}s)`,
  )

  return articulationRate
}

/**
 * Maps audio format to MIME type
 */
function getMimeType(format: string): string {
  const formatLower = format.toLowerCase()
  switch (formatLower) {
    case 'aac': {
      return 'audio/aac'
    }
    case 'm4a': {
      return 'audio/mp4'
    }
    case 'mp3': {
      return 'audio/mpeg'
    }
    case 'ogg': {
      return 'audio/ogg'
    }
    case 'wav': {
      return 'audio/wav'
    }
    default: {
      return 'audio/wav'
    } // fallback
  }
}

/**
 * Validates audio file using ffmpeg
 */
async function validateAudioFile(filePath: string): Promise<{
  bitrate: number
  duration: number
  format: string
}> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        reject(new Error(`Failed to analyze audio file: ${err.message}`))
        return
      }

      const format = metadata.format
      if (!format) {
        reject(new Error('Could not determine audio format'))
        return
      }

      const duration = format.duration
      if (duration == null) {
        reject(new Error('Could not determine audio duration'))
        return
      }

      const bitrate = format.bit_rate
      if (bitrate == null) {
        reject(new Error('Could not determine audio bitrate'))
        return
      }

      const bitrateKbps = Math.round(bitrate / 1000)
      const fileExtension = format.format_name?.split(',')[0] || ''

      resolve({
        bitrate: bitrateKbps,
        duration,
        format: fileExtension,
      })
    })
  })
}

// Re-export from split module for backward compatibility
export * from './elevenlabs-audio-pipeline.util'
