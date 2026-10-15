// Regenerate a finished long-take into a NEW project under a DIFFERENT
// visual style, reusing everything the style does not touch (script, voiceover,
// transcript, visual script, shot-plan timing, BGM bed) and re-running only the
// style-carrying tail: keyframe prompts -> keyframe images -> transition videos
// -> render. The source project's transition video model rides through
// unchanged; restyle changes style, not model.
//
// A sibling workflow rather than a branch inside LongTakeRegenerateWorkflow (see
// that file's header). Same precedent as LongTakeBgmRegenerateWorkflow /
// LongTakeBgmRemuxWorkflow.
//
// The two silent-no-op traps this path has to defuse (style lives in ARTIFACTS,
// not params) are documented on the activities in
// activities/long-take/restyle.ts -- read that before changing the stage order.
//
// KNOWN SCOPE LIMIT -- anchors are reused, not restyled. The copied
// long_take/anchors/{raw,styled} indices still carry the source style, and
// keyframe generation feeds those images in as identity references, so a shot
// built on a generated character / prop gets an old-style reference alongside the
// new-style prompt. Regenerating them here is NOT a matter of re-running the
// long-take anchor stage: on a UIP-created project (the usual case) the
// anchors were produced by the planner at confirm time and
// only converted into the long-take indices, with `source_passthrough` markers
// for logos and icons. Re-running the long-take stage would drop those markers
// and regenerate real brand logos from a prompt -- the logo
// hallucination class, which is strictly worse than an under-restyled prop.
// Restyling anchors properly means driving the UIP anchor pipeline with the new
// style while preserving passthrough, tracked separately.

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
import { generateAndTrackKeyframePrompts, generateKeyframes } from './stages/visual-sequence'
import {
  applyLongTakeRestyleKeyframePrompts,
  copyLongTakeSourceArtifacts,
  getLongTakeConcurrencyConfig,
  loadLongTakeRegenerateInputs,
  prepareLongTakeRestyleTarget,
  recordLongTakeRuntimeMetadata,
  renderLongTakeVideo,
} from './activity-proxies'
import { buildRenderTransitionVideos } from './render-transition-payload'
import type {
  LoadLongTakeRegenerateInputsActivityResult,
  LongTakeKeyframeItem,
  LongTakeRestyleWorkflowParams,
  LongTakeShotPlanItem,
} from './types'
import { handleWorkflowError } from './workflow-error-helpers'
import { resolveEffectiveTransitionVideoModel } from './workflow-helpers'
import {
  createLongTakeWorkflowRuntime,
  type LongTakeWorkflowLogFn,
  type LongTakeWorkflowRuntime,
} from './workflow-runtime'

const storyModeAdmissionStartSignal = defineSignal(STORY_MODE_ADMISSION_START_SIGNAL)

export async function LongTakeRestyleWorkflow(
  params: LongTakeRestyleWorkflowParams,
): Promise<{ status: 'completed'; videoUri?: string }> {
  const {
    admissionTier,
    aspectRatio,
    generationResolution,
    imageModel,
    keyframeImageModel,
    orgId,
    projectId,
    queuedAtMs,
    sourceProjectId,
    startPaused,
    styleName,
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
    logInfo('longTakeRestyleWorkflow waiting for admission', { queuedAtMs })
    await condition(() => admissionReleased)
  }

  logInfo('longTakeRestyleWorkflow started', {
    aspectRatio,
    sourceProjectId,
    styleName: styleName ?? 'none',
    transitionVideoModel,
  })

  const workflowStartedAt = Date.now()

  try {
    await recordLongTakeRuntimeMetadata({ projectId, userEmail, userId })
  } catch (error) {
    const err = error instanceof Error ? error : new Error(String(error))
    logError('longTakeRestyleWorkflow runtime metadata recording failed', {
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
    // Trap 1: the copy cloned the SOURCE style_source.json, which the keyframe
    // prompt activity reads (it takes no styleText argument). Overwriting it is
    // what actually makes this a restyle. Also repairs a visual script the bulk
    // copy dropped, which would otherwise surface two stages later as
    // "no regenerated prompt for any shot" on an already-paid run.
    await prepareLongTakeRestyleTarget({ projectId, sourceProjectId, styleText, userId })
    const inputs = await loadLongTakeRegenerateInputs({ projectId, userId })

    const concurrencyConfig = await getLongTakeConcurrencyConfig({ projectId, userId })
    const imageConcurrency = Math.max(1, concurrencyConfig.imageConcurrency || 1)
    const videoConcurrency = Math.max(1, concurrencyConfig.videoConcurrency || 1)

    // The source project's classified route, re-resolved against the carried
    // transition model (same handling as the regenerate workflow).
    const promptRoute: LongTakePromptRoute | undefined = inputs.promptRoute
      ? resolveLongTakeGenerationPromptRoute({
          promptRoute: inputs.promptRoute,
          transitionVideoModel,
        })
      : undefined
    logInfo('longTakeRestyleWorkflow inputs loaded', {
      audioDurationSeconds: inputs.audioDurationSeconds,
      promptRoute: promptRoute ?? 'none',
      shotCount: inputs.shotPlan.length,
      videoConcurrency,
    })

    const { keyframeReframeCount, keyframes, keyframeUpsideDownCount, shotPlan } =
      await runRestyleKeyframeStages({
        admissionTier,
        aspectRatio,
        generationResolution,
        imageConcurrency,
        imageModel,
        keyframeImageModel,
        logInfo,
        orgId,
        pipelineContext: inputs.pipelineContext,
        projectId,
        promptRoute,
        runtime,
        sourceProjectId,
        styleName,
        styleText,
        userId,
      })

    const { transitionPlan, transitionVideos } = await runTransitionsStage({
      admissionTier,
      aspectRatio,
      audioDurationSeconds: inputs.audioDurationSeconds,
      debugSettings: params.debugSettings,
      generationResolution,
      globalScript: inputs.globalScript,
      improvedVisualScriptEnabled: false,
      keyframes,
      logInfo,
      orgId,
      perfectLoop: params.perfectLoop,
      pipelineContext: inputs.pipelineContext,
      projectId,
      ...(promptRoute && { promptRoute }),
      runtime,
      shotPlan,
      styleText,
      transitionVideoModel,
      userEmail,
      userId,
      videoConcurrency,
    })

    const videoUri = await runRestyleRenderTail({
      inputs,
      keyframeReframeCount,
      keyframes,
      keyframeUpsideDownCount,
      logInfo,
      params,
      runtime,
      shotPlan,
      transitionCount: transitionPlan.length || transitionVideos.length,
      transitionVideos,
      workflowStartedAt,
    })

    logInfo('longTakeRestyleWorkflow completed', { videoUri })

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

/**
 * Re-bake the style into the keyframes: new keyframe prompts from the reused
 * visual script, pushed onto the reused shot plan (trap 2), then new keyframe
 * images. runVisualSequenceStages is deliberately NOT used -- it would also
 * rebuild the visual script and shot plan, which this path reuses.
 */
async function runRestyleKeyframeStages(params: {
  admissionTier?: LongTakeRestyleWorkflowParams['admissionTier']
  aspectRatio?: LongTakeRestyleWorkflowParams['aspectRatio']
  generationResolution?: LongTakeRestyleWorkflowParams['generationResolution']
  imageConcurrency: number
  imageModel?: string
  keyframeImageModel?: string
  logInfo: LongTakeWorkflowLogFn
  orgId?: string
  pipelineContext?: LoadLongTakeRegenerateInputsActivityResult['pipelineContext']
  projectId: string
  promptRoute?: LongTakePromptRoute
  runtime: LongTakeWorkflowRuntime
  sourceProjectId: string
  styleName?: string
  styleText?: string
  userId: string
}): Promise<{
  keyframeReframeCount: number
  keyframes: LongTakeKeyframeItem[]
  keyframeUpsideDownCount: number
  shotPlan: LongTakeShotPlanItem[]
}> {
  const {
    admissionTier,
    aspectRatio,
    generationResolution,
    imageConcurrency,
    imageModel,
    keyframeImageModel,
    logInfo,
    orgId,
    pipelineContext,
    projectId,
    promptRoute,
    runtime,
    sourceProjectId,
    styleName,
    styleText,
    userId,
  } = params

  const stylizeKeyframes = await generateAndTrackKeyframePrompts({
    logInfo,
    orgId,
    pipelineContext,
    promptRoute,
    projectId,
    runtime,
    userId,
  })

  // Trap 2: keyframe generation takes its prompt from shot_plan.json, so the
  // freshly generated prompts have to be written onto the reused plan or the
  // source's style-baked prompts render again.
  const promptApplication = await applyLongTakeRestyleKeyframePrompts({
    projectId,
    sourceProjectId,
    userId,
  })
  logInfo('longTakeRestyleWorkflow keyframe prompts applied to reused shot plan', {
    matchedShotCount: promptApplication.matchedShotCount,
    shotCount: promptApplication.shotPlan.length,
    updatedShotCount: promptApplication.updatedShotCount,
  })

  const { keyframeReframeCount, keyframeUpsideDownCount, keyframes } = await generateKeyframes({
    admissionTier,
    aspectRatio,
    generationResolution,
    imageConcurrency,
    imageModel,
    keyframeImageModel,
    logInfo,
    orgId,
    projectId,
    promptRoute,
    runtime,
    shotPlanResult: {
      shotCount: promptApplication.shotPlan.length,
      shotPlan: promptApplication.shotPlan,
    },
    styleName,
    styleText,
    stylizeKeyframes,
    userId,
  })

  return {
    keyframeReframeCount,
    keyframes,
    keyframeUpsideDownCount,
    shotPlan: promptApplication.shotPlan,
  }
}

/**
 * Render, emit the terminal `project.long_take.completed` event, then write the
 * final status blob. The completed event is emitted from day one on purpose:
 * the slim regenerate workflow never emits it, so a restyle cohort
 * would otherwise have a start with no matching terminal event.
 */
async function runRestyleRenderTail(params: {
  inputs: LoadLongTakeRegenerateInputsActivityResult
  keyframeReframeCount: number
  keyframes: LongTakeKeyframeItem[]
  keyframeUpsideDownCount: number
  logInfo: LongTakeWorkflowLogFn
  params: LongTakeRestyleWorkflowParams
  runtime: LongTakeWorkflowRuntime
  shotPlan: LongTakeShotPlanItem[]
  transitionCount: number
  transitionVideos: Parameters<typeof buildRenderTransitionVideos>[0]
  workflowStartedAt: number
}): Promise<string | undefined> {
  const { logInfo, runtime, transitionVideos } = params
  const {
    aspectRatio,
    bgmBedUri,
    enableCaption,
    projectId,
    sourceProjectId,
    styleName,
    transitionVideoModel,
    userEmail,
    userId,
  } = params.params

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
  logInfo('longTakeRestyleWorkflow render completed', {
    renderDurationMs: renderResult.renderDurationMs,
    thumbnailFallbackUsed: renderResult.thumbnailFallbackUsed,
    videoUri: renderResult.videoUri,
  })
  await runtime.setStageCompleted({ stage: 'render' })

  const effectiveTransitionVideoModel = resolveEffectiveTransitionVideoModel(
    transitionVideos,
    transitionVideoModel,
  )

  await runtime.releaseSlot({
    admissionTier: params.params.admissionTier,
    projectId,
    workflowId: workflowInfo().workflowId,
  })

  // The stored status blob is overwritten on each write, so anything the viewer
  // reads post-completion must ride on this final 'completed' write.
  await runtime.setStageCompleted({
    detail: renderResult.videoUri ? 'Render complete' : undefined,
    meta: {
      regenerateSourceProjectId: sourceProjectId,
      ...(styleName ? { styleName } : {}),
      ...(effectiveTransitionVideoModel
        ? { transitionVideoModel: effectiveTransitionVideoModel }
        : {}),
    },
    stage: 'completed',
  })

  return renderResult.videoUri
}
