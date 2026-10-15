import { createStorage } from '@reelmakeeasy/common/agent-v2/storage/storage'
import { SpeechToTextChunkResponseModel } from '@reelmakeeasy/common/elevenlabs/client'
import { logger } from '@reelmakeeasy/common/logger'
import { optimizeScriptForSpeech } from '@reelmakeeasy/common/tts/minimax-text'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'

import {
  countWords,
  generateChunkedAudioAndTranscriptWithRetries,
  MIN_LONG_TTS_WORDS,
} from './chunked-tts.util'
import {
  applyVolumeNormalization,
  generateTranscriptionStep,
  removeAudioPausesStep,
  saveQualityIssuesToDebugFile,
  saveTimestampsIfAvailable,
  validateTranscriptQualityStep,
} from './elevenlabs-audio-pipeline.util'
import {
  localCaptionTranscription,
  resolveBestEffortTranscription,
} from './forced-alignment-transcription.util'
import {
  generateTTSAudio,
  resolveTtsModel,
  resolveVoiceRoute,
  type TtsProvider,
  type VoiceRoute,
} from './provider-tts.util'
import {
  buildTranscriptQualityScore,
  emptyTranscriptQualityScore,
  type TranscriptQualityScore,
} from './transcript-quality-score.util'

export { getProviderForVoice, isGeminiPresetVoiceId, resolveVoiceRoute } from './provider-tts.util'

export type AudioAndTranscriptGenerationResult = {
  attempt: number
  isValid: boolean
  llmTtsQualityCheckEnabled: boolean
  llmTtsQualityCheckVariant: LlmTtsQualityCheckVariant
  provider: TtsProvider
  qualityIssues: string[]
  tagLeakageDetected: boolean
  transcription: null | SpeechToTextChunkResponseModel
  ttsModel: string
  usedUntaggedFallback: boolean
}

export type LlmTtsQualityCheckVariant = 'legacy_strict' | 'relaxed_asr_drift'

const DEFAULT_VOICE_OVER_PATH = 'story_loader/audio/voice_over.mp3'

type GenerateAudioOptions = {
  disablePauseRemoval?: boolean
  // A chunk of a long voiceover: its captions aren't timed, the stitched audio is timed once.
  isChunk?: boolean
  // BCP-47 script language, forwarded provider-agnostically to generateTTSAudio.
  languageCode?: string
  // Invoked once with the effective provider, before any synthesis attempt.
  onProviderResolved?: (provider: TtsProvider) => void
  providerOverride?: TtsProvider
  skipMiniMaxScriptOptimization?: boolean
  ttsModelOverride?: string
}

function buildDebugAttemptSuffix(outputPath: string | undefined, attemptNumber: number): string {
  const base = attemptNumber.toString()
  if (!outputPath) {
    return base
  }
  // Use the basename without extension as a chunk-unique tag.
  const filename = outputPath.split('/').pop() ?? outputPath
  const stem = filename.replace(/\.[^.]+$/, '')
  return stem ? `${stem}_${base}` : base
}

function getLlmTtsQualityCheckMetadata(
  useRelaxedLlmTtsQualityCheck: boolean,
): Pick<
  AudioAndTranscriptGenerationResult,
  'llmTtsQualityCheckEnabled' | 'llmTtsQualityCheckVariant'
> {
  return {
    llmTtsQualityCheckEnabled: useRelaxedLlmTtsQualityCheck,
    llmTtsQualityCheckVariant: useRelaxedLlmTtsQualityCheck ? 'relaxed_asr_drift' : 'legacy_strict',
  }
}

const PROVIDER_LABELS: Record<TtsProvider, string> = {
  elevenlabs: 'ElevenLabs',
  fal: 'MiniMax (fal)',
  gemini: 'Gemini TTS',
  // Local or fal, decided per request; [LocalTTS] / [FalTTS] lines say which.
  kokoro: 'Kokoro',
  qwen3: 'Qwen3-TTS',
}

function getProviderLabel(provider: TtsProvider): string {
  return PROVIDER_LABELS[provider]
}

async function handleBestEffortResult(
  selectedResult: {
    attemptNumber: number
    preprocessedText?: string
    processedAudioBuffer: Buffer
    qualityScore: TranscriptQualityScore
    transcription: null | SpeechToTextChunkResponseModel
  },
  projectId: string,
  providerLabel: string,
  qualityIssues: string[],
  ttsModel: string,
  alignmentText: string,
  languageCode?: string,
  outputPath?: string,
  allAttempts?: Pick<GenerationAttemptOutcome, 'attemptNumber' | 'isValid' | 'qualityScore'>[],
  localTiming = true,
): Promise<SpeechToTextChunkResponseModel> {
  const attemptNumber = selectedResult.attemptNumber
  // Every attempt errored out, so the "best" candidate is an empty buffer. Saving it writes a
  // 0-byte voice_over.mp3 that later stages read as a silent voiceover; fail with the vendor
  // errors instead, so the user-visible failure names the real cause.
  if (selectedResult.processedAudioBuffer.length === 0) {
    throw new Error(
      `All ${providerLabel} generation attempts produced no audio: ${qualityIssues.join('; ')}`,
    )
  }

  logger.info(
    `[${providerLabel}] All attempts had quality issues, using best-scored voiceover candidate ` +
      `attempt=${attemptNumber + 1} coverage=${selectedResult.qualityScore.coverage.toFixed(3)} ` +
      `tailCoverage=${selectedResult.qualityScore.tailCoverage.toFixed(3)} ` +
      `similarity=${selectedResult.qualityScore.similarity.toFixed(3)}`,
  )

  const finalPath = outputPath || DEFAULT_VOICE_OVER_PATH
  await saveAudioFile(projectId, selectedResult.processedAudioBuffer, outputPath)

  // Save best-effort selection summary so it's clear which attempt was chosen and why
  try {
    const storage = await createStorage(projectId)
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const selectionFile = `story_loader/audio/debug/best_effort_selection_${timestamp}.json`
    await storage.writeJsonFile(selectionFile, {
      timestamp: new Date().toISOString(),
      selectedAttempt: attemptNumber + 1,
      selectedScore: selectedResult.qualityScore,
      allAttempts: (allAttempts ?? []).map((a) => ({
        attempt: a.attemptNumber + 1,
        isValid: a.isValid,
        coverage: a.qualityScore.coverage,
        tailCoverage: a.qualityScore.tailCoverage,
        similarity: a.qualityScore.similarity,
      })),
    })
    logger.info(`[ProviderRouter] Best-effort selection summary saved: ${selectionFile}`)
  } catch (err) {
    logger.warn(
      { error: err },
      '[ProviderRouter] Failed to save best-effort selection file (non-blocking)',
    )
  }

  // Save quality issues to debug file for troubleshooting
  await saveQualityIssuesToDebugFile(projectId, qualityIssues, attemptNumber, ttsModel)

  return resolveBestEffortTranscription({
    alignmentText: selectedResult.preprocessedText?.trim() || alignmentText,
    audioPath: finalPath,
    initialTranscription: selectedResult.transcription,
    languageCode,
    localTiming,
    projectId,
    providerLabel,
  })
}

/**
 * The saved voiceover's transcript for the captions: its spoken text timed on this computer
 * when local caption timing is on (`localCaptionTranscription`), else the ASR transcript the
 * quality checks read. A chunk of a long voiceover keeps its ASR transcript.
 */
async function captionTranscription(params: {
  options: GenerateAudioOptions
  outputPath?: string
  projectId: string
  providerLabel: string
  spokenText: string
  transcription: null | SpeechToTextChunkResponseModel
}): Promise<null | SpeechToTextChunkResponseModel> {
  if (params.options.isChunk) {
    return params.transcription
  }
  return localCaptionTranscription({
    audioPath: params.outputPath || DEFAULT_VOICE_OVER_PATH,
    projectId: params.projectId,
    providerLabel: params.providerLabel,
    text: params.spokenText,
    transcription: params.transcription,
  })
}

async function performSingleGenerationAttempt(
  text: string,
  voiceId: string,
  ttsModel: string,
  projectId: string,
  attemptNumber: number,
  provider: TtsProvider,
  userContext?: { orgId?: string; userEmail: string; userId: string },
  originalText?: string,
  useRelaxedLlmTtsQualityCheck = false,
  outputPath?: string,
  options: GenerateAudioOptions = {},
): Promise<{
  hasTagLeakage: boolean
  isValid: boolean
  preprocessedText?: string
  processedAudioBuffer: Buffer
  qualityIssues: string[]
  qualityScore: TranscriptQualityScore
  transcription: null | SpeechToTextChunkResponseModel
  ttsResult: {
    audioBuffer: Buffer
    timestamps?: {
      alignment?: {
        characterEndTimesSeconds: number[]
        characters: string[]
        characterStartTimesSeconds: number[]
      }
    }
  }
}> {
  const qualityIssues: string[] = []
  const providerLabel = getProviderLabel(provider)

  try {
    const storage = await createStorage(projectId)
    // Debug path must be unique per parallel chunk: chunked TTS runs N chunks
    // concurrently with the same attemptNumber, so a path keyed only on
    // attemptNumber lets one chunk's TTS overwrite another's debug audio
    // before postProcessAudio reads it back (read-after-write race producing
    // duplicated/scrambled chunks in the stitched voice_over.mp3). Derive a
    // stable, chunk-unique suffix from outputPath when present.
    const debugSuffix = buildDebugAttemptSuffix(outputPath, attemptNumber)
    const debugRelPath = `story_loader/audio/debug/voice_over_attempt_${debugSuffix}.mp3`

    logger.info(
      `[${providerLabel}] Attempt ${attemptNumber + 1}: Starting TTS generation - model=${ttsModel} voiceId=${voiceId}`,
    )

    // 1. TTS generation (route to appropriate provider)
    // Note: generateTTSAudio no longer writes to file, just returns buffer
    const ttsResult = await generateTTSAudio(text, voiceId, ttsModel, provider, userContext, {
      languageCode: options.languageCode,
      // Attribute the provider spend to this project (`audioCostUsd`).
      projectId,
      skipMiniMaxScriptOptimization: options.skipMiniMaxScriptOptimization,
    })

    // Write initial TTS output to storage (for debugging and post-processing)
    await storage.writeFile(debugRelPath, ttsResult.audioBuffer)

    // 2. Post-processing (shared by all providers)
    const postProcessResult = await postProcessAudio(
      debugRelPath,
      text,
      projectId,
      provider,
      ttsResult.timestamps,
      originalText,
      attemptNumber,
      useRelaxedLlmTtsQualityCheck,
      options.disablePauseRemoval,
    )
    const validationText = originalText ?? text

    if (postProcessResult.hasTagLeakage) {
      logger.warn(
        `[${providerLabel}] Attempt ${attemptNumber + 1}: emotion tag leakage detected in ASR transcript`,
      )
    }

    // 3. Return result
    return {
      hasTagLeakage: postProcessResult.hasTagLeakage,
      isValid: postProcessResult.isValid,
      preprocessedText: ttsResult.preprocessedText,
      qualityScore: buildTranscriptQualityScore(
        validationText,
        postProcessResult.transcription?.text,
      ),
      qualityIssues: [...qualityIssues, ...postProcessResult.qualityIssues],
      transcription: postProcessResult.transcription,
      ttsResult,
      processedAudioBuffer: postProcessResult.processedAudioBuffer,
    }
  } catch (error) {
    const errorMsg = `${providerLabel} attempt ${attemptNumber + 1} error: ${ensureError(error).message}`
    logger.error(`[${providerLabel}] ${errorMsg}`)
    return {
      hasTagLeakage: false,
      isValid: false,
      qualityScore: emptyTranscriptQualityScore(),
      qualityIssues: [...qualityIssues, errorMsg],
      transcription: null,
      ttsResult: { audioBuffer: Buffer.alloc(0) },
      processedAudioBuffer: Buffer.alloc(0),
    }
  }
}

async function postProcessAudio(
  voiceOverRelPath: string,
  text: string,
  projectId: string,
  provider: TtsProvider,
  timestamps?: {
    alignment?: {
      characterEndTimesSeconds: number[]
      characters: string[]
      characterStartTimesSeconds: number[]
    }
  },
  // The ASR validation reference when it differs from the TTS input. Defaults to `text`.
  originalText?: string,
  attemptNumber?: number,
  useRelaxedLlmTtsQualityCheck = false,
  disablePauseRemoval = false,
): Promise<{
  hasTagLeakage: boolean
  isValid: boolean
  processedAudioBuffer: Buffer
  qualityIssues: string[]
  transcription: null | SpeechToTextChunkResponseModel
}> {
  const allIssues: string[] = []

  allIssues.push(
    ...(await saveTimestampsIfAvailable(timestamps, projectId, text)),
    ...(await applyVolumeNormalization(projectId, voiceOverRelPath)),
    ...(disablePauseRemoval ? [] : await removeAudioPausesStep(projectId, voiceOverRelPath)),
  )

  const { transcription, issues: transIssues } = await generateTranscriptionStep(
    projectId,
    voiceOverRelPath,
  )
  allIssues.push(...transIssues)

  const validationText = originalText ?? text
  const {
    isValid,
    issues: validIssues,
    explanation,
    hasTagLeakage,
  } = await validateTranscriptQualityStep(
    transcription,
    validationText,
    text,
    useRelaxedLlmTtsQualityCheck,
  )
  allIssues.push(...validIssues)

  // Save detailed ASR debug file so mismatches can be inspected in storage.
  // Includes both scripts, the raw ASR transcript, and the full LLM analysis side-by-side.
  try {
    const storage = await createStorage(projectId)
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
    const attemptSuffix = attemptNumber === undefined ? '' : `_attempt${attemptNumber}`
    const debugFile = `story_loader/audio/debug/asr_check${attemptSuffix}_${timestamp}.json`
    const debugPayload = {
      timestamp: new Date().toISOString(),
      provider,
      attemptNumber: attemptNumber ?? 0,
      isValid,
      llmExplanation: explanation || null,
      issues: [...validIssues, ...transIssues],
      originalScript: originalText ?? text,
      // Only set emotionTaggedScript when it genuinely differs from the original
      emotionTaggedScript: originalText && originalText !== text ? text : null,
      asrTranscript: transcription?.text ?? null,
    }
    await storage.writeJsonFile(debugFile, debugPayload)
    logger.info(`[ProviderRouter] ASR debug file saved: ${debugFile}`)
  } catch (err) {
    logger.warn({ error: err }, '[ProviderRouter] Failed to save ASR debug file (non-blocking)')
  }

  const storage = await createStorage(projectId)
  const processedAudioBuffer = await storage.readFile(voiceOverRelPath)

  return { hasTagLeakage, isValid, qualityIssues: allIssues, transcription, processedAudioBuffer }
}

async function prepareChunkedTtsText(
  text: string,
  provider: TtsProvider,
  projectId: string,
  options: GenerateAudioOptions,
): Promise<string> {
  // The fal MiniMax client runs `optimizeScriptForSpeech` itself, so a
  // long script is optimized once up front; otherwise every chunk re-optimizes
  // independently, which both normalizes numbers/dates inconsistently across chunk
  // boundaries and fires N concurrent LLM calls.
  const shouldOptimizeMiniMaxBeforeChunking =
    provider === 'fal' && !options.skipMiniMaxScriptOptimization
  if (!shouldOptimizeMiniMaxBeforeChunking) {
    return text
  }

  try {
    const optimizedText = await optimizeScriptForSpeech(text)
    await savePreprocessedScriptIfPresent(projectId, optimizedText)
    return optimizedText
  } catch (error) {
    logger.warn(
      { error: ensureError(error), projectId },
      '[ProviderRouter] Failed to optimize MiniMax script before chunking; using original script',
    )
    return text
  }
}

async function saveAudioFile(
  projectId: string,
  audioBuffer: Buffer,
  outputPath?: string,
): Promise<void> {
  const storage = await createStorage(projectId)
  // Writes to file store (with local cache if enabled).
  const voiceOverPath = outputPath || DEFAULT_VOICE_OVER_PATH
  await storage.writeFile(voiceOverPath, audioBuffer)
}

async function savePreprocessedScriptForAttempt(
  projectId: string,
  preprocessedText: string | undefined,
  options: GenerateAudioOptions,
): Promise<void> {
  if (options.skipMiniMaxScriptOptimization) {
    return
  }
  await savePreprocessedScriptIfPresent(projectId, preprocessedText)
}

async function savePreprocessedScriptIfPresent(
  projectId: string,
  preprocessedText: string | undefined,
): Promise<void> {
  if (!preprocessedText || preprocessedText.trim().length === 0) {
    return
  }
  try {
    const storage = await createStorage(projectId)
    await storage.writeFile('story_loader/audio/preprocessed_script.txt', preprocessedText)
  } catch (error) {
    logger.warn(
      { projectId, error: ensureError(error) },
      '[ProviderRouter] Failed to save preprocessed script to storage (non-blocking)',
    )
  }
}

// Shared shape for a completed generation attempt (used by retry helpers below).
type GenerationAttemptOutcome = Awaited<ReturnType<typeof performSingleGenerationAttempt>> & {
  attemptNumber: number
  isUntaggedFallbackAttempt: boolean
}

function compareNumericScore(left: number, right: number): number {
  if (left > right) {
    return 1
  }
  if (left < right) {
    return -1
  }
  return 0
}

function isBetterAttemptOutcome(
  candidate: GenerationAttemptOutcome,
  currentBest: GenerationAttemptOutcome | null,
): boolean {
  if (!currentBest) {
    return true
  }

  const candidateHasAudio = candidate.processedAudioBuffer.length > 0
  const currentHasAudio = currentBest.processedAudioBuffer.length > 0
  if (candidateHasAudio !== currentHasAudio) {
    return candidateHasAudio
  }

  // Emotion tag leakage is a hard disqualifier: a non-leaked attempt always beats a leaked one
  if (candidate.hasTagLeakage !== currentBest.hasTagLeakage) {
    return !candidate.hasTagLeakage
  }

  const orderedComparisons = [
    compareNumericScore(candidate.qualityScore.coverage, currentBest.qualityScore.coverage),
    compareNumericScore(candidate.qualityScore.tailCoverage, currentBest.qualityScore.tailCoverage),
    compareNumericScore(candidate.qualityScore.similarity, currentBest.qualityScore.similarity),
  ]

  for (const comparison of orderedComparisons) {
    if (comparison !== 0) {
      return comparison > 0
    }
  }

  const candidateHasTranscript = Boolean(candidate.transcription?.text?.trim())
  const currentHasTranscript = Boolean(currentBest.transcription?.text?.trim())
  if (candidateHasTranscript !== currentHasTranscript) {
    return candidateHasTranscript
  }

  return candidate.attemptNumber > currentBest.attemptNumber
}

function selectBestAvailableOutcome(
  candidates: GenerationAttemptOutcome[],
): GenerationAttemptOutcome | null {
  let best: GenerationAttemptOutcome | null = null
  for (const candidate of candidates) {
    if (isBetterAttemptOutcome(candidate, best)) {
      best = candidate
    }
  }
  return best
}

function selectWinnerFromSettledResults(
  allResults: PromiseSettledResult<GenerationAttemptOutcome>[],
  qualityIssues: string[],
): { availableResults: GenerationAttemptOutcome[]; winner: GenerationAttemptOutcome | null } {
  let winner: GenerationAttemptOutcome | null = null
  const availableResults: GenerationAttemptOutcome[] = []

  for (const result of allResults) {
    if (result.status === 'fulfilled') {
      qualityIssues.push(...result.value.qualityIssues)
      availableResults.push(result.value)
      if (result.value.isValid && !winner) {
        winner = result.value
      }
    } else {
      qualityIssues.push(`Parallel attempt failed: ${result.reason}`)
    }
  }

  return { winner, availableResults }
}

/**
 * Generate audio and transcription with retry logic
 * 1 initial attempt, followed by 2 parallel retries on failure.
 * @param outputPath - Optional custom output path for audio file (defaults to 'story_loader/audio/voice_over.mp3')
 */
export async function generateAudioAndTranscriptWithRetries(
  text: string,
  voiceId: string,
  projectId: string,
  userContext?: { orgId?: string; userEmail: string; userId: string },
  outputPath?: string,
  options: GenerateAudioOptions = {},
): Promise<AudioAndTranscriptGenerationResult> {
  // A chunk call passes the already-resolved provider and voice, so it skips routing.
  const route: VoiceRoute = options.providerOverride
    ? { provider: options.providerOverride, voiceId }
    : await resolveVoiceRoute(voiceId)
  const provider = route.provider
  const effectiveVoiceId = route.voiceId
  const useRelaxedLlmTtsQualityCheck = false
  const llmTtsQualityCheckMetadata = getLlmTtsQualityCheckMetadata(useRelaxedLlmTtsQualityCheck)
  const textWordCount = countWords(text)

  // Report the EFFECTIVE provider, after legacy voices are remapped. The caller
  // needs it to tag `tts.provider_failed` when generation throws, and a failure loses the
  // return value that would otherwise carry it. Reported rather than recomputed by the
  // caller: re-deriving this would duplicate the routing rules.
  options.onProviderResolved?.(provider)

  const providerLabel = getProviderLabel(provider)
  const ttsModel = options.ttsModelOverride ?? resolveTtsModel(provider)

  if (textWordCount >= MIN_LONG_TTS_WORDS) {
    const chunkingText = await prepareChunkedTtsText(text, provider, projectId, options)

    const chunked = await generateChunkedAudioAndTranscriptWithRetries({
      generateChunk: (chunkText, chunkOutputPath) =>
        generateAudioAndTranscriptWithRetries(
          chunkText,
          effectiveVoiceId,
          projectId,
          userContext,
          chunkOutputPath,
          {
            disablePauseRemoval: true,
            isChunk: true,
            languageCode: options.languageCode,
            providerOverride: provider,
            skipMiniMaxScriptOptimization: provider === 'fal',
            ttsModelOverride: ttsModel,
          },
        ),
      languageCode: options.languageCode,
      llmTtsQualityCheckMetadata,
      outputPath,
      projectId,
      provider,
      routing: route.substitutedFrom
        ? { originalVoiceId: route.substitutedFrom, reason: 'voice_substituted' }
        : undefined,
      text: chunkingText,
      ttsModel,
      voiceId: effectiveVoiceId,
    })
    return {
      ...chunked,
      transcription: await captionTranscription({
        options,
        outputPath,
        projectId,
        providerLabel,
        spokenText: chunkingText,
        transcription: chunked.transcription,
      }),
    }
  }

  // Attempt 0: first try
  logger.info(`[${providerLabel}] Starting first generation attempt`)
  const firstAttempt = await performSingleGenerationAttempt(
    text,
    effectiveVoiceId,
    ttsModel,
    projectId,
    0,
    provider,
    userContext,
    undefined,
    useRelaxedLlmTtsQualityCheck,
    outputPath,
    options,
  )
  const qualityIssues = firstAttempt.qualityIssues
  const firstAttemptOutcome = {
    ...firstAttempt,
    attemptNumber: 0,
    isUntaggedFallbackAttempt: false,
  }
  let bestAvailableResult = selectBestAvailableOutcome([firstAttemptOutcome])
  const allAttemptOutcomes: GenerationAttemptOutcome[] = [firstAttemptOutcome]

  if (firstAttempt.isValid) {
    await saveAudioFile(projectId, firstAttempt.processedAudioBuffer, outputPath)
    await savePreprocessedScriptForAttempt(projectId, firstAttempt.preprocessedText, options)
    logger.info(`[${providerLabel}] Quality check passed on attempt 1`)
    return {
      isValid: true,
      transcription: await captionTranscription({
        options,
        outputPath,
        projectId,
        providerLabel,
        spokenText: firstAttempt.preprocessedText?.trim() || text,
        transcription: firstAttempt.transcription,
      }),
      ttsModel,
      attempt: 0,
      qualityIssues,
      provider,
      tagLeakageDetected: firstAttempt.hasTagLeakage,
      usedUntaggedFallback: false,
      ...llmTtsQualityCheckMetadata,
    }
  }

  // Attempts 1 and 2: parallel retries
  logger.info(`[${providerLabel}] First attempt failed, running 2 parallel retries...`)
  const makeAttempt = (attemptNum: number) =>
    performSingleGenerationAttempt(
      text,
      effectiveVoiceId,
      ttsModel,
      projectId,
      attemptNum,
      provider,
      userContext,
      undefined,
      useRelaxedLlmTtsQualityCheck,
      outputPath,
      options,
    ).then(
      (result) =>
        ({
          ...result,
          attemptNumber: attemptNum,
          isUntaggedFallbackAttempt: false,
        }) as GenerationAttemptOutcome,
    )

  const settled = await Promise.allSettled([makeAttempt(1), makeAttempt(2)])
  const { winner, availableResults } = selectWinnerFromSettledResults(settled, qualityIssues)
  allAttemptOutcomes.push(...availableResults)
  bestAvailableResult = selectBestAvailableOutcome(
    [bestAvailableResult, ...availableResults].filter(
      (result): result is GenerationAttemptOutcome => result !== null,
    ),
  )

  if (winner) {
    await saveAudioFile(projectId, winner.processedAudioBuffer, outputPath)
    await savePreprocessedScriptForAttempt(projectId, winner.preprocessedText, options)
    logger.info(`[${providerLabel}] Quality check passed on attempt ${winner.attemptNumber + 1}`)
    return {
      isValid: true,
      transcription: await captionTranscription({
        options,
        outputPath,
        projectId,
        providerLabel,
        spokenText: winner.preprocessedText?.trim() || text,
        transcription: winner.transcription,
      }),
      ttsModel,
      attempt: winner.attemptNumber,
      qualityIssues,
      provider,
      tagLeakageDetected: allAttemptOutcomes.some((a) => a.hasTagLeakage),
      usedUntaggedFallback: false,
      ...llmTtsQualityCheckMetadata,
    }
  }

  // Best-effort fallback: use the strongest available result
  if (bestAvailableResult) {
    const finalTranscription = await handleBestEffortResult(
      bestAvailableResult,
      projectId,
      providerLabel,
      qualityIssues,
      ttsModel,
      text,
      options.languageCode,
      outputPath,
      allAttemptOutcomes,
      !options.isChunk,
    )
    await savePreprocessedScriptForAttempt(projectId, bestAvailableResult.preprocessedText, options)
    const tagLeakageDetected = allAttemptOutcomes.some((a) => a.hasTagLeakage)
    return {
      isValid: false,
      transcription: finalTranscription,
      ttsModel,
      attempt: bestAvailableResult.attemptNumber,
      qualityIssues,
      provider,
      tagLeakageDetected,
      usedUntaggedFallback: bestAvailableResult.isUntaggedFallbackAttempt,
      ...llmTtsQualityCheckMetadata,
    }
  }

  // All attempts failed completely (no audio produced at all)
  throw new Error(`All ${providerLabel} generation attempts failed`)
}
