import type { CameraStyle } from '@reelmakeeasy/common/long-take/camera-craft'
import { resolveLongTakeGenerationPromptRoute } from '@reelmakeeasy/common/long-take/prompt-route-generation'
import { STORY_MODE_ADMISSION_START_SIGNAL } from '@reelmakeeasy/common/long-take/story-mode-routing-constants'
import type { LongTakeAdmissionTier } from '@reelmakeeasy/common/long-take/types'
import type { AspectRatio, GenerationResolution } from '@reelmakeeasy/common/media/types'
import {
  type LongVideoAttemptSource,
  resolveClassicLongVideoAttemptSource,
} from '@reelmakeeasy/common/story-mode/long-video-attribution'
import { setWorkflowScopedContext } from '@reelmakeeasy/common/workflow-runtime/workflow-tracer'
import {
  condition,
  defineSignal,
  setHandler,
  workflowInfo,
} from '@reelmakeeasy/workflow-engine/workflow'
import type { LongTakeScriptGeneratorPath } from '@shared/types/api/long-take'
import { DebugSettings } from '@shared/types/project/debug-settings'

import type { LongTakePromptRoute } from '../../long-take-prompt-router'
import { createWorkflowLogger } from '../../utilities/workflow-logger'

import { runPrepareInputsStage } from './stages/prepare-inputs'
import { runTransitionsStage } from './stages/transitions'
import {
  type GeneratedAnchorCounts,
  runUserAssetPreStage,
  runVideoConsistencyStages,
} from './stages/video-consistency'
import { runVisualSequenceStages } from './stages/visual-sequence'
import {
  detectLongTakeGibberishText,
  fitLongTakeBgmTrack,
  generateLongTakeBgmBed,
  getLongTakeConcurrencyConfig,
  persistLongTakeBgmBed,
  recordLongTakeRuntimeMetadata,
  renderLongTakeVideo,
  reserveLongTakeSlot,
  saveLongTakePipelineContext,
} from './activity-proxies'
import { bgmBedStep, runBgmBedStep } from './bgm-bed-params'
import { isAgentHarnessRun } from './codex-run'
import { buildRenderTransitionVideos } from './render-transition-payload'
import {
  appendShotPlanFallbackStatusDetail,
  getShotPlanFallbackStatusMeta,
} from './shot-plan-fallback-status'
import { type TransitionPlanSeed } from './transition-planning'
import type {
  BgmTrackArg,
  GenerateLongTakeBgmBedActivityResult,
  LongTakeKeyframeItem,
  LongTakePromptClassification,
  LongTakeShotPlanItem,
  LongTakeTransitionVideoItem,
  LongTakeUserAssetCatalogItem,
  LongTakeWorkflowParams,
} from './types'
import { handleWorkflowError } from './workflow-error-helpers'
import { buildLongVideoMeta, resolveGlobalScript } from './workflow-helpers'
import {
  applyStyleResultToPipelineContext,
  buildAssetLibraryTrackingProperties,
  buildFasterTtsStatusMeta,
  resolveEffectiveTransitionVideoModel,
  runContextEnrichmentStages,
} from './workflow-helpers'
import {
  createLongTakeWorkflowRuntime,
  type LongTakeWorkflowLogFn,
  type LongTakeWorkflowRuntime,
} from './workflow-runtime'

type CoreStagesPipelineParams = {
  admissionTier?: LongTakeAdmissionTier
  aspectRatio?: AspectRatio
  audioPath?: string
  bgmEnabled?: boolean | null
  bgmNote?: null | string
  bgmTrack?: BgmTrackArg | null
  cameraStyle?: CameraStyle
  debugSettings?: DebugSettings
  generationResolution?: GenerationResolution
  imageModel?: string
  keyframeImageModel?: string
  logError: LongTakeWorkflowLogFn
  logInfo: LongTakeWorkflowLogFn
  orgId?: string
  perfectLoop?: boolean
  projectId: string
  runtime: LongTakeWorkflowRuntime
  script: string
  styleName?: string
  styleReferenceImageUrls?: string[]
  styleText?: string
  transitionVideoModel?: string
  userAssetCatalog?: LongTakeUserAssetCatalogItem[]
  userEmail?: string
  userId: string
  userPrompt: string
  visualScriptTemperature?: number
  voiceId?: string
}

type CoreStagesPipelineResult = {
  /**
   * The settled BGM bed (null on skip/failure). Settled before the
   * pipeline returns so the render stage can bake the bed into the delivered
   * videos at finalize.
   */
  bgmBed: GenerateLongTakeBgmBedActivityResult | null
  generatedAnchorCounts: GeneratedAnchorCounts
  keyframeReframeCount: number
  keyframes: LongTakeKeyframeItem[]
  keyframeUpsideDownCount: number
  pipelineContext: Array<{ name: string; value: string }>
  promptClassification: LongTakePromptClassification | null
  promptRoute: LongTakePromptRoute
  shotPlanResult: { shotCount: number; shotPlan: LongTakeShotPlanItem[] }
  transitionPlan: TransitionPlanSeed[]
  transitionVideos: LongTakeTransitionVideoItem[]
  voiceoverResult: CoreStagesPipelineResultVoiceover
}

type CoreStagesPipelineResultVoiceover = Awaited<
  ReturnType<typeof runPrepareInputsStage>
>['voiceoverResult']

const storyModeAdmissionStartSignal = defineSignal(STORY_MODE_ADMISSION_START_SIGNAL)

export async function LongTakeWorkflow(
  params: LongTakeWorkflowParams,
): Promise<{ status: 'completed'; videoUri?: string }> {
  const {
    admissionTier,
    aspectRatio,
    audioPath,
    bgmEnabled,
    bgmNote,
    bgmTrack,
    cameraStyle,
    customStyle,
    debugSettings,
    enableCaption,
    generationResolution,
    imageModel,
    isStyleCopy,
    keyframeImageModel,
    modelSelectorTier,
    orgId,
    v4Category,
    v4Track,
    perfectLoop,
    projectId,
    queuedAtMs,
    remixProjectId,
    requestedDurationSeconds,
    script,
    scriptGeneratorPath,
    source,
    startPaused,
    styleName,
    styleReferenceImageUrls,
    styleText,
    transitionVideoModel,
    userAssetCatalog,
    userEmail,
    userId,
    userPrompt,
    visualScriptTemperature,
    voiceId,
  } = params

  setWorkflowScopedContext({
    projectId,
    storyModeAdmissionTier: admissionTier,
    userId,
    userEmail,
  })

  const logger = createWorkflowLogger({ projectId, userId })
  const logInfo: LongTakeWorkflowLogFn = (message, fields = {}) => logger.info(message, fields)
  const logError: LongTakeWorkflowLogFn = (message, fields = {}) => logger.error(message, fields)
  const resolvedCustomStyle = Boolean(customStyle)
  let admissionReleased = !startPaused

  setHandler(storyModeAdmissionStartSignal, () => {
    admissionReleased = true
  })

  if (startPaused) {
    logInfo('longTakeWorkflow waiting for admission', {
      queuedAtMs,
    })
    await condition(() => admissionReleased)
  }

  logInfo('longTakeWorkflow started', {
    aspectRatio,
    hasAudioUpload: Boolean(audioPath),
    perfectLoop,
  })

  const workflowStartedAt = Date.now()
  const workflowId = workflowInfo().workflowId
  const queueElapsedMs = queuedAtMs ? Math.max(0, workflowStartedAt - queuedAtMs) : 0
  const longVideoAttemptSource = resolveClassicLongVideoAttemptSource({
    requestedDurationSeconds,
    script,
  })

  try {
    await recordLongTakeRuntimeMetadata({
      projectId,
      userEmail,
      userId,
    })
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logError('longTakeWorkflow runtime metadata recording failed', {
      error: { message: err.message, name: err.name },
    })
  }

  await reserveLongTakeSlot({ projectId })

  const runtime = await createLongTakeWorkflowRuntime({
    projectId,
    userEmail,
    userId,
  })

  try {
    const pipeline = await runCoreStagesPipeline({
      admissionTier,
      aspectRatio,
      audioPath,
      bgmEnabled,
      bgmNote,
      bgmTrack,
      cameraStyle,
      debugSettings,
      generationResolution,
      imageModel,
      keyframeImageModel,
      logError,
      logInfo,
      orgId,
      perfectLoop,
      projectId,
      runtime,
      script,
      styleName,
      styleReferenceImageUrls,
      styleText,
      transitionVideoModel,
      userAssetCatalog,
      userEmail,
      userId,
      userPrompt,
      visualScriptTemperature,
      voiceId,
    })
    // Save pipeline context to storage for debugging
    await saveLongTakePipelineContext({
      pipelineContext: pipeline.pipelineContext,
      projectId,
      userId,
    })

    const videoUri = await handleWorkflowCompletion({
      admissionTier,
      aspectRatio,
      audioPath,
      bgmEnabled,
      enableCaption,
      imageModel,
      isStyleCopy,
      keyframeImageModel,
      logError,
      logInfo,
      longVideoAttemptSource,
      modelSelectorTier,
      orgId,
      projectId,
      queueElapsedMs,
      remixProjectId,
      requestedDurationSeconds,
      resolvedCustomStyle,
      runtime,
      scriptGeneratorPath,
      source,
      styleName,
      styleText,
      transitionVideoModel,
      userAssetCatalog,
      userEmail,
      userId,
      userPrompt,
      v4Category,
      v4Track,
      voiceId,
      workflowId,
      workflowStartedAt,
      ...pipeline,
    })
    return { status: 'completed', videoUri }
  } catch (error) {
    await handleWorkflowError({
      admissionTier,
      error,
      logError,
      projectId,
      runtime,
      workflowStartedAt,
    })
    throw error
  }
}

async function handleWorkflowCompletion(
  params: CoreStagesPipelineResult & {
    admissionTier?: LongTakeAdmissionTier
    aspectRatio?: AspectRatio
    audioPath?: string
    bgmEnabled?: boolean | null
    enableCaption?: boolean | null
    imageModel?: string
    isStyleCopy?: boolean
    keyframeImageModel?: string
    logError: LongTakeWorkflowLogFn
    logInfo: LongTakeWorkflowLogFn
    longVideoAttemptSource?: LongVideoAttemptSource
    modelSelectorTier?: LongTakeWorkflowParams['modelSelectorTier']
    orgId?: string
    projectId: string
    queueElapsedMs: number
    remixProjectId?: string
    requestedDurationSeconds?: number
    resolvedCustomStyle: boolean
    runtime: LongTakeWorkflowRuntime
    scriptGeneratorPath?: LongTakeScriptGeneratorPath
    source?: 'mcp' | 'web'
    styleName?: string
    styleText?: string
    transitionVideoModel?: string
    userAssetCatalog?: LongTakeUserAssetCatalogItem[]
    userEmail?: string
    userId: string
    userPrompt: string
    v4Category?: string
    v4Track?: string
    voiceId?: string
    workflowId: string
    workflowStartedAt: number
  },
): Promise<string | undefined> {
  const {
    admissionTier,
    aspectRatio,
    audioPath,
    bgmBed,
    enableCaption,
    generatedAnchorCounts,
    keyframes,
    logError,
    logInfo,
    longVideoAttemptSource,
    projectId,
    promptClassification,
    requestedDurationSeconds,
    runtime,
    scriptGeneratorPath,
    shotPlanResult,
    styleText,
    transitionVideoModel,
    transitionVideos,
    userEmail,
    userId,
    voiceoverResult,
    workflowId,
  } = params
  const renderTransitionVideos = buildRenderTransitionVideos(transitionVideos)
  // Resolved here (pure helper, no activity command); used for
  // trackCompleted.
  const effectiveTransitionVideoModel = resolveEffectiveTransitionVideoModel(
    transitionVideos,
    transitionVideoModel,
  )

  await runtime.setStageInProgress({ stage: 'render' })
  const renderResult = await renderLongTakeVideo({
    aspectRatio,
    // The settled bed's URI rides into render finalize, which
    // bakes it under the voiceover before the final video uploads.
    bgmBedUri: bgmBed?.fileUri,
    enableCaption,
    projectId,
    transitionVideos: renderTransitionVideos,
    userEmail,
    userId,
  })
  const outputDurationSec =
    transitionVideos.reduce((acc, video) => Math.max(acc, video.endMs), 0) / 1000
  logInfo('longTakeWorkflow render completed', {
    outputDurationSec,
    renderDurationMs: renderResult.renderDurationMs,
    thumbnailFallbackUsed: renderResult.thumbnailFallbackUsed,
    videoUri: renderResult.videoUri,
  })
  await runtime.setStageCompleted({ stage: 'render' })

  const longVideoSource =
    resolveClassicLongVideoAttemptSource({
      audioDurationSeconds: audioPath ? voiceoverResult.audioDurationSeconds : undefined,
      requestedDurationSeconds,
    }) ?? longVideoAttemptSource
  const assetLibraryTracking = buildAssetLibraryTrackingProperties(transitionVideos)
  await runtime.releaseSlot({ admissionTier, projectId, workflowId })

  await runtime.setStageCompleted({
    detail: appendShotPlanFallbackStatusDetail(
      renderResult.videoUri ? 'Render complete' : undefined,
      shotPlanResult,
    ),
    meta: {
      numActorAssetsGenerated: generatedAnchorCounts.numActorAssetsGenerated,
      numAssetsGenerated: generatedAnchorCounts.numAssetsGenerated,
      numLogoAssetsGenerated: generatedAnchorCounts.numLogoAssetsGenerated,
      numObjectAssetsGenerated: generatedAnchorCounts.numObjectAssetsGenerated,
      numOtherAssetsGenerated: generatedAnchorCounts.numOtherAssetsGenerated,
      ...getShotPlanFallbackStatusMeta(shotPlanResult),
      promptRoute: 'legacy',
      // The stored status blob is overwritten (not merged) on each setLongTakeStatus
      // call, so scriptGeneratorPath has to ride on this final 'completed' write to be
      // readable by /api/project/:id/metadata when the survey component asks.
      ...(scriptGeneratorPath ? { scriptGeneratorPath } : {}),
      // Same reason: persist the actually-used transition model + asset-library usage so the
      // story-mode survey can segment Seedance 2.0 satisfaction. debugSettings only carries
      // these when a user explicitly overrides, which the server-side rollout does not.
      assetLibraryTransitionsCount: assetLibraryTracking.assetLibraryTransitionsCount,
      ...(effectiveTransitionVideoModel
        ? { transitionVideoModel: effectiveTransitionVideoModel }
        : {}),
      ...buildFasterTtsStatusMeta(voiceoverResult),
      ...buildLongVideoMeta(outputDurationSec, longVideoSource, promptClassification?.use_case),
      ...(voiceoverResult.voiceSubstituted ? { voiceSubstituted: true } : {}),
    },
    stage: 'completed',
  })
  logInfo('longTakeWorkflow completed', { videoUri: renderResult.videoUri })

  try {
    await detectLongTakeGibberishText({ keyframes, projectId, styleText, transitionVideos, userId })
  } catch (error) {
    logError('longTakeWorkflow gibberish text detection failed', {
      errorMessage: error instanceof Error ? error.message : String(error),
    })
  }

  return renderResult.videoUri
}

async function runCoreStagesPipeline(
  params: CoreStagesPipelineParams,
): Promise<CoreStagesPipelineResult> {
  const {
    admissionTier,
    aspectRatio,
    audioPath,
    bgmEnabled,
    bgmNote,
    bgmTrack,
    cameraStyle,
    debugSettings,
    generationResolution,
    imageModel,
    keyframeImageModel,
    logError,
    logInfo,
    orgId,
    perfectLoop,
    projectId,
    runtime,
    script,
    styleName,
    styleReferenceImageUrls,
    styleText,
    transitionVideoModel,
    userAssetCatalog,
    userEmail,
    userId,
    userPrompt,
    visualScriptTemperature,
    voiceId,
  } = params

  const concurrencyConfig = await getLongTakeConcurrencyConfig({ projectId, userId })
  const imageConcurrency = Math.max(1, concurrencyConfig.imageConcurrency || 1)
  const videoConcurrency = Math.max(1, concurrencyConfig.videoConcurrency || 1)
  logInfo('longTakeWorkflow concurrency resolved', { imageConcurrency, videoConcurrency })

  // Pipeline context: accumulate key-value entries for LLM context injection.
  // The first entry is a system-level context block explaining what Story Mode is,
  // followed by user-specific state that grows as the pipeline progresses.
  const hasAssets = Boolean(userAssetCatalog?.length)
  const pipelineContext: Array<{ name: string; value: string }> = [
    {
      name: 'System',
      value: [
        'You are part of Story Mode, an AI video generation pipeline that converts a user prompt and optional uploaded assets into a short-form video.',
        `Inputs: user prompt${hasAssets ? ', user-uploaded reference images' : ''}, voice-over script${styleText ? ', artistic style directive' : ''}.`,
        'Pipeline: script → voiceover → asset understanding → asset analysis → experts (world bible, asset manifest, beat sheet) → visual script → keyframe prompts → shot plan → keyframes → transitions → render.',
        "Your task is one step in this pipeline. Use the context below to stay consistent with prior steps and the user's original intent.",
      ].join(' '),
    },
    { name: 'User initial prompt(Their intent)', value: userPrompt || '' },
    ...(hasAssets
      ? [
          {
            name: 'User Assets',
            value: (userAssetCatalog || [])
              .map((a) => `${a.fileId}: ${a.shortname} (${a.mime})`)
              .join(', '),
          },
        ]
      : []),
    { name: 'Script', value: script },
    ...(styleText ? [{ name: 'Style', value: styleText }] : []),
  ]

  const {
    genreAnalysis,
    intentAnalysis,
    promptClassification,
    styleAnalysis,
    voiceCharacter,
    visualNotesPreRun,
    voiceoverResult,
  } = await runPrepareInputsStage({
    orgId,
    audioPath,
    isNewStyleTransfer: true,
    logError,
    logInfo,
    projectId,
    runtime,
    script,
    agentHarnessRun: isAgentHarnessRun(debugSettings),
    styleReferenceImageUrls,
    styleText,
    userEmail,
    userId,
    userPrompt,
    voiceId,
  })

  const promptRoute: LongTakePromptRoute = 'general'
  const generationPromptRoute = resolveLongTakeGenerationPromptRoute({
    promptRoute,
    transitionVideoModel,
  })
  logInfo('longTakeWorkflow prompt route resolved', {
    generationPromptRoute,
    promptRoute,
    routeSource: voiceoverResult.scriptText?.trim() ? 'confirmed_transcript' : 'workflow_script',
  })
  pipelineContext.push({ name: 'Prompt Route', value: promptRoute })

  // Resolve style text: prefer image-derived style prompt over raw styleText
  const resolvedStyleText = styleAnalysis?.reusableStylePrompt ?? styleText

  applyStyleResultToPipelineContext(pipelineContext, styleAnalysis)
  if (intentAnalysis) {
    pipelineContext.push({ name: 'Intent Analysis', value: intentAnalysis })
  }
  if (genreAnalysis) {
    pipelineContext.push({ name: 'Genre Analysis', value: JSON.stringify(genreAnalysis) })
  }

  const userAssetPreStageResult = await runUserAssetPreStage({
    logInfo,
    pipelineContext,
    projectId,
    runtime,
    script,
    userAssetCatalog,
    userId,
    userPrompt,
  })

  // Accumulate context from prepare-inputs and user asset stages
  if (voiceCharacter) {
    pipelineContext.push({ name: 'Voice Character', value: voiceCharacter })
  }
  if (userAssetPreStageResult?.userAssetUnderstandingResult.contextSummary) {
    pipelineContext.push({
      name: 'Asset Understanding',
      value: userAssetPreStageResult.userAssetUnderstandingResult.contextSummary,
    })
  }

  const videoConsistencyResult = await runVideoConsistencyStages({
    cameraStyle,
    generationResolution,
    imageModel,
    imageConcurrency,
    logInfo,
    orgId,
    pipelineContext,
    promptRoute: generationPromptRoute,
    projectId,
    runtime,
    script,
    styleText: resolvedStyleText,
    transitionVideoModel,
    userAssetCatalog,
    userEmail,
    userId,
    userPrompt,
    userAssetPreStageResult,
  })
  const generatedAnchorCounts = videoConsistencyResult

  // generateLongTakeBgmBed's first step reads world_bible.json (+
  // global_constraints.json) from storage, which runExpertsAnalysisStage writes
  // inside runVideoConsistencyStages above, so the bed starts only now. Best-effort
  // floating promise that overlaps the remaining generation stages (no serial
  // latency) and is awaited before the pipeline returns; startLongTakeBgmBed never
  // rejects, so it can never fail the project.
  const bgmBedPromise = startLongTakeBgmBed({
    bgmEnabled,
    bgmNote,
    bgmTrack,
    cameraStyle,
    durationSec: voiceoverResult.audioDurationSeconds,
    logError,
    orgId,
    projectId,
    styleName,
    styleText: resolvedStyleText,
    userEmail,
    userId,
  })

  const { keyframeReframeCount, keyframeUpsideDownCount, keyframes, shotPlanResult } =
    await runVisualSequenceStages({
      admissionTier,
      aspectRatio,
      audioDurationSeconds: voiceoverResult.audioDurationSeconds,
      cameraStyle,
      generationResolution,
      imageModel,
      imageConcurrency,
      keyframeImageModel,
      logInfo,
      orgId,
      perfectLoop,
      pipelineContext,
      promptRoute: generationPromptRoute,
      projectId,
      runtime,
      styleName,
      styleText: resolvedStyleText,
      transitionVideoModel,
      userEmail,
      userId,
      userPrompt,
      visualNotesPreRun,
      visualScriptTemperature,
    })

  // Genre classification + visual treatment
  await runContextEnrichmentStages({ logError, logInfo, pipelineContext, projectId, userId })

  const { transitionPlan, transitionVideos } = await runTransitionsStage({
    admissionTier,
    aspectRatio,
    audioDurationSeconds: voiceoverResult.audioDurationSeconds,
    cameraStyle,
    debugSettings,
    generationResolution,
    globalScript: resolveGlobalScript(voiceoverResult.scriptText, script),
    improvedVisualScriptEnabled: false,
    keyframes,
    logInfo,
    orgId,
    perfectLoop,
    pipelineContext,
    projectId,
    promptRoute: generationPromptRoute,
    runtime,
    shotPlan: shotPlanResult.shotPlan,
    styleText: resolvedStyleText,
    transitionVideoModel,
    userEmail,
    userId,
    videoConcurrency,
  })

  // Settle the bed generation started after the voiceover stage and
  // persist its metadata. Fully fail-soft (see settleLongTakeBgmBed). This
  // runs BEFORE the render stage (handleWorkflowCompletion) on purpose: the
  // returned bed is threaded into the render params so finalize can bake it
  // into the delivered videos. The bed (~60-90s) overlapped the long
  // generation stages, so this await adds ~zero latency in practice.
  const bgmBed = await settleLongTakeBgmBed({
    bgmBedPromise,
    logError,
    projectId,
    userEmail,
    userId,
  })

  return {
    bgmBed,
    generatedAnchorCounts,
    keyframeReframeCount,
    keyframeUpsideDownCount,
    keyframes,
    pipelineContext,
    promptClassification,
    promptRoute,
    shotPlanResult,
    transitionPlan,
    transitionVideos,
    voiceoverResult,
  }
}

// Await the best-effort bed, persist its metadata onto the project,
// and RETURN the bed so the caller can thread its store address into the render
// stage (the export bake). Fully fail-soft: the promise resolves null on
// skip/failure (no persist then, null returned), and a persist failure is
// logged but never fails the project -- the bed object already exists in storage,
// so the bake still proceeds even when only the metadata patch failed.
async function settleLongTakeBgmBed(params: {
  bgmBedPromise: Promise<GenerateLongTakeBgmBedActivityResult | null>
  logError: LongTakeWorkflowLogFn
  projectId: string
  userEmail?: string
  userId: string
}): Promise<GenerateLongTakeBgmBedActivityResult | null> {
  const { bgmBedPromise, logError, projectId, userEmail, userId } = params
  const bed = await bgmBedPromise
  if (!bed) {
    return null
  }
  try {
    await persistLongTakeBgmBed({ bed, projectId, userEmail, userId })
  } catch (error) {
    logError('longTakeWorkflow BGM persist failed (non-fatal)', {
      error: { message: error instanceof Error ? error.message : String(error) },
    })
  }
  return bed
}

// Start best-effort BGM bed generation. Skips (resolves null) when the
// toggle is off or no sized duration is available. The generate activity may
// resolve null (no bed) and PROPAGATES failures after activity retries, so a
// .catch here keeps an exhausted BGM failure from ever failing the project.
// Returns a promise that NEVER rejects.
function startLongTakeBgmBed(params: {
  bgmEnabled?: boolean | null
  bgmNote?: null | string
  cameraStyle?: CameraStyle
  bgmTrack?: BgmTrackArg | null
  durationSec?: number
  logError: LongTakeWorkflowLogFn
  orgId?: string
  projectId: string
  styleName?: string
  styleText?: string
  userEmail?: string
  userId: string
}): Promise<GenerateLongTakeBgmBedActivityResult | null> {
  const { logError, ...input } = params
  return runBgmBedStep(bgmBedStep(input), {
    fitTrack: fitLongTakeBgmTrack,
    generateBed: generateLongTakeBgmBed,
    logError,
  })
}
