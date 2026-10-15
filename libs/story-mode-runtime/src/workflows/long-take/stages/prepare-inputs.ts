import {
  analyzeLongTakeVoiceCharacter,
  applyLongTakePreVoiceoverSpeed,
  classifyLongTakeGenre,
  classifyLongTakePrompt,
  correctLongTakeTranscript,
  generateAndUpdateLongTakeProjectName,
  generateLongTakeScript,
  generateLongTakeVisualNotes,
  generateLongTakeVoiceover,
  identifyLongTakeIntent,
  identifyLongTakeStyle,
} from '../activity-proxies'
import type {
  ClassifyLongTakeGenreActivityResult,
  GenerateLongTakeVoiceoverActivityResult,
  IdentifyLongTakeStyleActivityResult,
  LongTakePromptClassification,
} from '../types'
import type { LongTakeWorkflowLogFn, LongTakeWorkflowRuntime } from '../workflow-runtime'

export async function runPrepareInputsStage(params: {
  /** An agent-mode run (Codex or Claude Code, which can't hear audio). The voice character
   *  activity reads the env, so it decides: pin Gemini when its key is set, else skip. */
  agentHarnessRun?: boolean
  audioPath?: string
  /**
   * What produced `audioPath`. `tts_preview` (the UIP transcript-preview
   * handoff) is TTS output that is supposed to say exactly `script`, so the
   * voiceover activity holds its ASR to the fidelity gate. Omitted /
   * `user_upload` -- the classic audio-upload flow -- is the user's own
   * recording and is never gated.
   */
  audioSource?: 'tts_preview' | 'user_upload'
  isNewStyleTransfer?: boolean
  logError: LongTakeWorkflowLogFn
  logInfo: LongTakeWorkflowLogFn
  orgId?: string
  /**
   * Handoff from the UIP pre-voiceover pipeline. When present, skips the
   * entire voiceover stage -- the script, voice_over.mp3, and transcript
   * were already written to storage by UIP's pre-voiceover child workflow, so
   * we just flip the stages to completed and return a synthesized
   * voiceoverResult to feed into downstream experts / shot-plan.
   */
  preVoiceoverResult?: {
    audioDurationSeconds?: number
    scriptText: string
    speed?: number
    transcriptPath: string
    voiceOverPath: string
  }
  projectId: string
  runtime: LongTakeWorkflowRuntime
  script: string
  styleReferenceImageUrls?: string[]
  styleText?: string
  userEmail?: string
  userId: string
  userPrompt: string
  voiceId?: string
}): Promise<{
  genreAnalysis: ClassifyLongTakeGenreActivityResult | null
  intentAnalysis: null | string
  promptClassification: LongTakePromptClassification | null
  styleAnalysis: IdentifyLongTakeStyleActivityResult | null
  visualNotesPreRun: boolean
  voiceCharacter?: string
  voiceoverResult: GenerateLongTakeVoiceoverActivityResult
}> {
  const {
    audioPath,
    audioSource,
    isNewStyleTransfer,
    logError,
    logInfo,
    preVoiceoverResult,
    orgId,
    projectId,
    runtime,
    script,
    styleReferenceImageUrls,
    styleText,
    userEmail,
    userId,
    userPrompt,
    voiceId,
  } = params

  // UIP audio-mode short-circuit. All voiceover artifacts are already in
  // storage (story_loader/script.txt, audio/voice_over.mp3, transcript/...),
  // written by the pre-voiceover child workflow during the UIP session.
  if (preVoiceoverResult) {
    const preparedPreVoiceoverResult = await maybeApplyPreVoiceoverSpeed({
      preVoiceoverResult,
      projectId,
      userEmail,
      userId,
    })
    logInfo('longTakeWorkflow voiceover skipped (UIP pre-voiceover handoff)', {
      speed: preparedPreVoiceoverResult.speed,
      transcriptPath: preparedPreVoiceoverResult.transcriptPath,
      voiceOverPath: preparedPreVoiceoverResult.voiceOverPath,
    })
    await runtime.setStageInProgress({ stage: 'script' })
    await runtime.setStageCompleted({ stage: 'script' })
    await runtime.setStageInProgress({ stage: 'voiceover' })
    await runtime.setStageCompleted({ stage: 'voiceover' })
    // Classify ASR transcript for audio-mode `promptTopic` / `promptUseCase`
    // parity with text-mode. analyzeAudio set to the UIP pre-voiceover child
    // workflow's voiceOverPath so the classifier can hear the uploaded track
    // for authoritative is_music / music_genre. Best-effort: if the file is not
    // yet at that path the classifier silently falls back to text-only.
    const audioModePromptClassification = await maybeClassifyPrompt({
      analyzeAudio: preparedPreVoiceoverResult.voiceOverPath || true,
      logError,
      projectId,
      userId,
      userPrompt: preparedPreVoiceoverResult.scriptText,
    })
    return {
      genreAnalysis: null,
      intentAnalysis: null,
      promptClassification: audioModePromptClassification,
      styleAnalysis: null,
      visualNotesPreRun: false,
      voiceCharacter: undefined,
      voiceoverResult: {
        audioDurationSeconds: preparedPreVoiceoverResult.audioDurationSeconds,
        scriptText: preparedPreVoiceoverResult.scriptText,
        transcriptPath: preparedPreVoiceoverResult.transcriptPath,
        voiceOverPath: preparedPreVoiceoverResult.voiceOverPath,
      },
    }
  }

  const promptClassification = await maybeClassifyPrompt({
    audioPath,
    logError,
    projectId,
    userId,
    userPrompt: userPrompt || script,
  })

  const intentAnalysis = isNewStyleTransfer
    ? await maybeIdentifyIntent({
        logError,
        projectId,
        userId,
        userPrompt: userPrompt || script,
      })
    : null
  const styleAnalysis = isNewStyleTransfer
    ? await maybeIdentifyStyle({
        logError,
        projectId,
        userId,
        styleReferenceImageUrls,
        userPrompt: userPrompt || script,
        intentAnalysis,
        styleText,
      })
    : null
  const genreAnalysis = isNewStyleTransfer
    ? await maybeClassifyGenre({
        intentAnalysis,
        logError,
        projectId,
        styleAnalysis,
        userId,
        userPrompt: userPrompt || script,
      })
    : null

  await runtime.setStageInProgress({ stage: 'script' })

  if (audioPath) {
    await runtime.setStageCompleted({ stage: 'script' })
    const voiceoverResult = await runVoiceoverStage({
      audioPath,
      audioSource,
      confirmedScript: script,
      logError,
      logInfo,
      orgId,
      projectId,
      runtime,
      source: 'uploaded_audio',
      userEmail,
      userId,
      voiceId,
    })
    // Classify the ASR transcript so audio uploads get topic/use_case tracking.
    // analyzeAudio: true - the voiceover stage above wrote voice_over.mp3, so
    // the classifier can hear the uploaded track for authoritative is_music /
    // music_genre instead of guessing from the ASR transcript alone.
    const audioPromptClassification = await maybeClassifyPrompt({
      analyzeAudio: true,
      logError,
      projectId,
      userId,
      userPrompt: voiceoverResult.scriptText || '',
    })
    await tryUpdateProjectNameFromScript({
      logError,
      projectId,
      scriptText: voiceoverResult.scriptText,
      userId,
    })
    const voiceCharacter = await tryAnalyzeVoiceCharacter({
      agentHarnessRun: params.agentHarnessRun,
      logError,
      logInfo,
      projectId,
      userId,
    })

    return {
      genreAnalysis,
      intentAnalysis,
      promptClassification: audioPromptClassification,
      styleAnalysis,
      voiceCharacter,
      visualNotesPreRun: false,
      voiceoverResult,
    }
  }

  await generateLongTakeScript({
    projectId,
    script,
    userEmail,
    userId,
  })
  await tryUpdateProjectNameFromScript({
    logError,
    projectId,
    scriptText: script,
    userId,
  })
  await runtime.setStageCompleted({ stage: 'script' })
  logInfo('longTakeWorkflow script ready', { source: 'script' })

  // script.txt is now in storage. Voiceover then visual notes run sequentially.
  const voiceoverResult = await runVoiceoverStage({
    logError,
    logInfo,
    orgId,
    projectId,
    runtime,
    source: 'tts_asr',
    userEmail,
    userId,
    voiceId,
  })
  const visualNotesResult = await generateLongTakeVisualNotes({
    projectId,
    userId,
    userPrompt,
  }).catch((error: unknown) => {
    logError('longTakeWorkflow visual notes pre-generation failed', {
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    return null
  })
  if (visualNotesResult) {
    logInfo('longTakeWorkflow visual notes ready', {
      noteCount: visualNotesResult.noteCount,
      notesPath: visualNotesResult.notesPath,
    })
  }
  const voiceCharacter = await tryAnalyzeVoiceCharacter({
    agentHarnessRun: params.agentHarnessRun,
    logError,
    logInfo,
    projectId,
    userId,
  })

  return {
    genreAnalysis,
    intentAnalysis,
    promptClassification,
    styleAnalysis,
    voiceCharacter,
    visualNotesPreRun: visualNotesResult !== null,
    voiceoverResult,
  }
}

async function maybeApplyPreVoiceoverSpeed(params: {
  preVoiceoverResult: {
    audioDurationSeconds?: number
    scriptText: string
    speed?: number
    transcriptPath: string
    voiceOverPath: string
  }
  projectId: string
  userEmail?: string
  userId: string
}): Promise<{
  audioDurationSeconds?: number
  scriptText: string
  speed?: number
  transcriptPath: string
  voiceOverPath: string
}> {
  const speed = normalizePreVoiceoverSpeed(params.preVoiceoverResult.speed)
  if (speed === undefined || speed === 1) {
    return params.preVoiceoverResult
  }

  const result = await applyLongTakePreVoiceoverSpeed({
    audioDurationSeconds: params.preVoiceoverResult.audioDurationSeconds,
    projectId: params.projectId,
    scriptText: params.preVoiceoverResult.scriptText,
    speed,
    transcriptPath: params.preVoiceoverResult.transcriptPath,
    userEmail: params.userEmail,
    userId: params.userId,
    voiceOverPath: params.preVoiceoverResult.voiceOverPath,
  })

  return {
    audioDurationSeconds: result.audioDurationSeconds,
    scriptText: result.scriptText || params.preVoiceoverResult.scriptText,
    speed,
    transcriptPath: result.transcriptPath || params.preVoiceoverResult.transcriptPath,
    voiceOverPath: result.voiceOverPath || params.preVoiceoverResult.voiceOverPath,
  }
}

async function maybeClassifyGenre(params: {
  intentAnalysis: null | string
  logError: LongTakeWorkflowLogFn
  projectId: string
  styleAnalysis: IdentifyLongTakeStyleActivityResult | null
  userId: string
  userPrompt: string
}): Promise<ClassifyLongTakeGenreActivityResult | null> {
  const { intentAnalysis, logError, projectId, styleAnalysis, userId, userPrompt } = params
  const localContext: Array<{ name: string; value: string }> = [
    { name: 'User initial prompt(Their intent)', value: userPrompt },
  ]
  if (intentAnalysis) {
    localContext.push({ name: 'User Intent', value: intentAnalysis })
  }
  if (styleAnalysis) {
    localContext.push({ name: 'Style', value: JSON.stringify(styleAnalysis) })
  }
  try {
    return await classifyLongTakeGenre({ pipelineContext: localContext, projectId, userId })
  } catch (error) {
    logError('longTakeWorkflow genre classification failed', {
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

async function maybeClassifyPrompt(params: {
  /**
   * When true, the classifier additionally has Gemini LISTEN to the project's
   * voiceover mp3 in storage (authoritative is_music / music_genre). Only set this
   * AFTER the voiceover stage has written `story_loader/audio/voice_over.mp3`.
   * A string value is treated as an explicit `store://` / storage-relative URI to
   * the audio; `true` uses the canonical voiceover mp3 path.
   */
  analyzeAudio?: boolean | string
  audioPath?: string
  logError: LongTakeWorkflowLogFn
  projectId: string
  userId: string
  userPrompt: string
}): Promise<LongTakePromptClassification | null> {
  const { analyzeAudio, audioPath, logError, projectId, userId, userPrompt } = params
  if (audioPath) {
    return null
  }

  try {
    return await classifyLongTakePrompt({
      analyzeAudio,
      projectId,
      prompt: userPrompt,
      userId,
    })
  } catch (error) {
    logError('longTakeWorkflow prompt classification failed', {
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

async function maybeIdentifyIntent(params: {
  logError: LongTakeWorkflowLogFn
  projectId: string
  userId: string
  userPrompt: string
}): Promise<null | string> {
  const { logError, projectId, userId, userPrompt } = params
  try {
    const result = await identifyLongTakeIntent({ projectId, userId, userPrompt })
    return result?.intentAnalysis ?? null
  } catch (error) {
    logError('longTakeWorkflow intent analysis failed', {
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

async function maybeIdentifyStyle(params: {
  intentAnalysis: null | string
  logError: LongTakeWorkflowLogFn
  projectId: string
  styleReferenceImageUrls?: string[]
  styleText?: string
  userId: string
  userPrompt: string
}): Promise<IdentifyLongTakeStyleActivityResult | null> {
  const {
    logError,
    projectId,
    styleReferenceImageUrls,
    styleText,
    userId,
    userPrompt,
    intentAnalysis,
  } = params
  if (!styleReferenceImageUrls || styleReferenceImageUrls.length === 0) {
    logError('longTakeWorkflow style reference image URLs are not provided', {
      projectId,
      userId,
    })
    return null
  }
  try {
    return await identifyLongTakeStyle({
      projectId,
      styleReferenceImageUrls,
      styleText,
      userId,
      userPrompt,
      intentAnalysis,
    })
  } catch (error) {
    logError('longTakeWorkflow style analysis failed', {
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

function normalizePreVoiceoverSpeed(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined
  }
  return Number(Math.min(2, Math.max(0.5, value)).toFixed(2))
}

async function runVoiceoverStage(params: {
  audioPath?: string
  /** Forwarded to the activity's fidelity gate; see `runPrepareInputsStage`. */
  audioSource?: 'tts_preview' | 'user_upload'
  confirmedScript?: string
  logError: LongTakeWorkflowLogFn
  logInfo: LongTakeWorkflowLogFn
  orgId?: string
  projectId: string
  runtime: LongTakeWorkflowRuntime
  /** Log-only label for which branch of this stage is running. */
  source: 'tts_asr' | 'uploaded_audio'
  userEmail?: string
  userId: string
  voiceId?: string
}): Promise<GenerateLongTakeVoiceoverActivityResult> {
  const {
    audioPath,
    audioSource,
    confirmedScript,
    logError,
    logInfo,
    orgId,
    projectId,
    runtime,
    source,
    userEmail,
    userId,
    voiceId,
  } = params

  logInfo('longTakeWorkflow voiceover stage started', {
    audioPath,
    audioSource,
    source,
    voiceId,
  })
  await runtime.setStageInProgress({ stage: 'voiceover' })

  try {
    // Split-voiceover: TTS+ASR and transcript correction run as two separate
    // activities so correction failures (gemini DEADLINE_EXCEEDED /
    // segment-merging drift) surface as their own task.
    const voiceoverResult = await generateLongTakeVoiceover({
      audioPath,
      audioSource,
      confirmedScript,
      orgId,
      projectId,
      skipCorrection: true,
      userEmail,
      userId,
      voiceId,
    })
    await correctLongTakeTranscript({ projectId, userEmail, userId })
    await runtime.setStageCompleted({ stage: 'voiceover' })
    logInfo('longTakeWorkflow voiceover ready', {
      audioDurationSeconds: voiceoverResult.audioDurationSeconds,
      source,
      splitVoiceover: true,
    })
    return voiceoverResult
  } catch (error) {
    logError('longTakeWorkflow voiceover stage failed before downstream stages', {
      audioPath,
      errorMessage: error instanceof Error ? error.message : String(error),
      source,
      voiceId,
    })
    throw error
  }
}

async function tryAnalyzeVoiceCharacter(params: {
  /** An agent-mode run: the activity pins Gemini or skips (see `runPrepareInputsStage`). */
  agentHarnessRun?: boolean
  logError: LongTakeWorkflowLogFn
  logInfo: LongTakeWorkflowLogFn
  projectId: string
  userId: string
}): Promise<string | undefined> {
  const { agentHarnessRun, logError, logInfo, projectId, userId } = params
  try {
    const result = await analyzeLongTakeVoiceCharacter({ agentHarnessRun, projectId, userId })
    logInfo('longTakeWorkflow voice character analysis ready', {
      outputPath: result.outputPath,
      voiceCharacter: result.voiceCharacter,
    })
    return result.voiceCharacter || undefined
  } catch (error) {
    logError('longTakeWorkflow voice character analysis failed', {
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    return undefined
  }
}

async function tryUpdateProjectNameFromScript(params: {
  logError: LongTakeWorkflowLogFn
  projectId: string
  scriptText?: string
  userId: string
}): Promise<void> {
  const { logError, projectId, scriptText, userId } = params
  const trimmedScript = scriptText?.trim()
  if (!trimmedScript) {
    return
  }

  try {
    await generateAndUpdateLongTakeProjectName({
      projectId,
      scriptText: trimmedScript,
      userId,
    })
  } catch (error) {
    logError('longTakeWorkflow project naming failed', {
      errorMessage: error instanceof Error ? error.message : String(error),
    })
  }
}
