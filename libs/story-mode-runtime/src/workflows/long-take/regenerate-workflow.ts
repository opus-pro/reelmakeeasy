// Regenerate a finished long-take into a NEW project with a different
// transition video model, reusing every artifact through keyframes (script,
// voiceover, shot plan, keyframe images, BGM bed) from the source project.
// Only transition-video generation and the final render re-run; the planning
// stages of LongTakeWorkflow are skipped entirely. Kept as a separate slim
// workflow on purpose: LongTakeWorkflow is large and should not grow a
// start-at-transitions branch.

import { resolveLongTakeGenerationPromptRoute } from '@reelmakeeasy/common/long-take/prompt-route-generation'
import { STORY_MODE_ADMISSION_START_SIGNAL } from '@reelmakeeasy/common/long-take/story-mode-routing-constants'
import { setWorkflowScopedContext } from '@reelmakeeasy/common/workflow-runtime/workflow-tracer'
import {
  condition,
  defineSignal,
  setHandler,
  workflowInfo,
} from '@reelmakeeasy/workflow-engine/workflow'

import type { LongTakePromptRoute } from '../../long-take-prompt-router'
import { createWorkflowLogger } from '../../utilities/workflow-logger'

import { runTransitionsStage } from './stages/transitions'
import {
  copyLongTakeSourceArtifacts,
  getLongTakeConcurrencyConfig,
  loadLongTakeRegenerateInputs,
  recordLongTakeRuntimeMetadata,
  renderLongTakeVideo,
} from './activity-proxies'
import { buildRenderTransitionVideos } from './render-transition-payload'
import type { LongTakeRegenerateWorkflowParams } from './types'
import { handleWorkflowError } from './workflow-error-helpers'
import { resolveEffectiveTransitionVideoModel } from './workflow-helpers'
import {
  createLongTakeWorkflowRuntime,
  type LongTakeWorkflowLogFn,
  type LongTakeWorkflowRuntime,
} from './workflow-runtime'

const storyModeAdmissionStartSignal = defineSignal(STORY_MODE_ADMISSION_START_SIGNAL)

export async function LongTakeRegenerateWorkflow(
  params: LongTakeRegenerateWorkflowParams,
): Promise<{ status: 'completed'; videoUri?: string }> {
  const {
    admissionTier,
    aspectRatio,
    bgmBedUri,
    cameraStyle,
    debugSettings,
    enableCaption,
    generationResolution,
    orgId,
    perfectLoop,
    projectId,
    queuedAtMs,
    sourceProjectId,
    startPaused,
    styleText,
    transitionVideoModel,
    userEmail,
    userId,
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

  let admissionReleased = !startPaused
  setHandler(storyModeAdmissionStartSignal, () => {
    admissionReleased = true
  })
  if (startPaused) {
    logInfo('longTakeRegenerateWorkflow waiting for admission', { queuedAtMs })
    await condition(() => admissionReleased)
  }

  logInfo('longTakeRegenerateWorkflow started', {
    aspectRatio,
    sourceProjectId,
    transitionVideoModel,
  })

  const workflowStartedAt = Date.now()

  try {
    await recordLongTakeRuntimeMetadata({ projectId, userEmail, userId })
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logError('longTakeRegenerateWorkflow runtime metadata recording failed', {
      error: { message: err.message, name: err.name },
    })
  }

  const runtime = await createLongTakeWorkflowRuntime({
    projectId,
    userEmail,
    userId,
  })

  try {
    await copyLongTakeSourceArtifacts({ projectId, sourceProjectId, userId })
    const inputs = await loadLongTakeRegenerateInputs({ projectId, userId })

    const concurrencyConfig = await getLongTakeConcurrencyConfig({ projectId, userId })
    const videoConcurrency = Math.max(1, concurrencyConfig.videoConcurrency || 1)

    // The source project's classified route, re-resolved against the NEW
    // transition model (abstract stays abstract on Seedance 2.0 but folds to
    // general on 1.x, matching LongTakeWorkflow's generation-route handling).
    const promptRoute: LongTakePromptRoute | undefined = inputs.promptRoute
      ? resolveLongTakeGenerationPromptRoute({
          promptRoute: inputs.promptRoute,
          transitionVideoModel,
        })
      : undefined
    logInfo('longTakeRegenerateWorkflow inputs loaded', {
      audioDurationSeconds: inputs.audioDurationSeconds,
      keyframeCount: inputs.keyframes.length,
      promptRoute: promptRoute ?? 'none',
      shotCount: inputs.shotPlan.length,
      videoConcurrency,
    })

    const { transitionVideos } = await runTransitionsStage({
      admissionTier,
      aspectRatio,
      audioDurationSeconds: inputs.audioDurationSeconds,
      cameraStyle,
      debugSettings,
      generationResolution,
      globalScript: inputs.globalScript,
      improvedVisualScriptEnabled: false,
      keyframes: inputs.keyframes,
      logInfo,
      orgId,
      perfectLoop,
      pipelineContext: inputs.pipelineContext,
      projectId,
      ...(promptRoute && { promptRoute }),
      runtime,
      shotPlan: inputs.shotPlan,
      styleText,
      transitionVideoModel,
      userEmail,
      userId,
      videoConcurrency,
    })

    const renderResult = await runRegenerateRenderTail({
      aspectRatio,
      bgmBedUri,
      enableCaption,
      logInfo,
      projectId,
      runtime,
      sourceProjectId,
      transitionVideoModel,
      transitionVideos,
      userEmail,
      userId,
    })

    logInfo('longTakeRegenerateWorkflow completed', { videoUri: renderResult.videoUri })

    await runtime.releaseSlot({ admissionTier, projectId, workflowId: workflowInfo().workflowId })

    return { status: 'completed', videoUri: renderResult.videoUri }
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

async function runRegenerateRenderTail(params: {
  aspectRatio?: LongTakeRegenerateWorkflowParams['aspectRatio']
  bgmBedUri?: string
  enableCaption?: boolean | null
  logInfo: LongTakeWorkflowLogFn
  projectId: string
  runtime: LongTakeWorkflowRuntime
  sourceProjectId: string
  transitionVideoModel?: string
  transitionVideos: Parameters<typeof buildRenderTransitionVideos>[0]
  userEmail?: string
  userId: string
}): Promise<{
  renderDurationMs: number
  thumbnailFallbackUsed: boolean
  videoUri?: string
}> {
  const {
    aspectRatio,
    bgmBedUri,
    enableCaption,
    logInfo,
    projectId,
    runtime,
    sourceProjectId,
    transitionVideoModel,
    transitionVideos,
    userEmail,
    userId,
  } = params

  await runtime.setStageInProgress({ stage: 'render' })
  const renderResult = await renderLongTakeVideo({
    aspectRatio,
    bgmBedUri,
    enableCaption,
    projectId,
    transitionVideos: buildRenderTransitionVideos(transitionVideos),
    userEmail,
    userId,
  })
  logInfo('longTakeRegenerateWorkflow render completed', {
    renderDurationMs: renderResult.renderDurationMs,
    thumbnailFallbackUsed: renderResult.thumbnailFallbackUsed,
    videoUri: renderResult.videoUri,
  })
  await runtime.setStageCompleted({ stage: 'render' })

  const effectiveTransitionVideoModel = resolveEffectiveTransitionVideoModel(
    transitionVideos,
    transitionVideoModel,
  )
  // The stored status blob is overwritten on each write, so anything the viewer
  // reads post-completion must ride on this final 'completed' write.
  await runtime.setStageCompleted({
    detail: renderResult.videoUri ? 'Render complete' : undefined,
    meta: {
      regenerateSourceProjectId: sourceProjectId,
      ...(effectiveTransitionVideoModel
        ? { transitionVideoModel: effectiveTransitionVideoModel }
        : {}),
    },
    stage: 'completed',
  })

  return {
    renderDurationMs: renderResult.renderDurationMs,
    thumbnailFallbackUsed: renderResult.thumbnailFallbackUsed,
    videoUri: renderResult.videoUri,
  }
}
