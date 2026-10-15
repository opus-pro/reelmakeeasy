import type { PipelineContextEntry } from '@reelmakeeasy/common/job-context'
import type { CameraStyle } from '@reelmakeeasy/common/long-take/camera-craft'
import type { LongTakeAdmissionTier } from '@reelmakeeasy/common/long-take/types'
import type { AspectRatio, GenerationResolution } from '@reelmakeeasy/common/media/types'
import { ApplicationFailure } from '@reelmakeeasy/workflow-engine/workflow'

import type { LongTakePromptRoute } from '../../../long-take-prompt-router'
import {
  buildLongTakeShotPlan,
  generateLongTakeKeyframePrompts,
  generateLongTakeVisualNotes,
  generateLongTakeVisualScript,
  saveLongTakeKeyframes,
} from '../activity-proxies'
import { generateKeyframesWithRetryFallback } from '../keyframe-retry-fallback'
import {
  getShotPlanFallbackStatusDetail,
  getShotPlanFallbackStatusMeta,
} from '../shot-plan-fallback-status'
import type {
  BuildLongTakeShotPlanActivityResult,
  GenerateLongTakeVisualScriptActivityResult,
  LongTakeKeyframeItem,
} from '../types'
import type { LongTakeWorkflowLogFn, LongTakeWorkflowRuntime } from '../workflow-runtime'

export async function runVisualSequenceStages(params: {
  admissionTier?: LongTakeAdmissionTier
  aspectRatio?: AspectRatio
  audioDurationSeconds?: number
  cameraStyle?: CameraStyle
  generationResolution?: GenerationResolution
  imageConcurrency: number
  imageModel?: string
  keyframeImageModel?: string
  logInfo: LongTakeWorkflowLogFn
  orgId?: string
  perfectLoop?: boolean
  pipelineContext?: PipelineContextEntry[]
  projectId: string
  promptRoute?: LongTakePromptRoute
  runtime: LongTakeWorkflowRuntime
  styleName?: string
  styleText?: string
  transitionVideoModel?: string
  userEmail?: string
  userId: string
  userPrompt: string
  visualNotesPreRun?: boolean
  visualScriptTemperature?: number
}): Promise<{
  keyframeReframeCount: number
  keyframes: LongTakeKeyframeItem[]
  keyframeUpsideDownCount: number
  shotPlanResult: BuildLongTakeShotPlanActivityResult
  visualScriptResult: GenerateLongTakeVisualScriptActivityResult
}> {
  const {
    admissionTier,
    aspectRatio,
    audioDurationSeconds,
    cameraStyle,
    generationResolution,
    imageModel,
    imageConcurrency,
    keyframeImageModel,
    logInfo,
    orgId,
    perfectLoop,
    pipelineContext,
    promptRoute,
    projectId,
    runtime,
    styleName,
    styleText,
    transitionVideoModel,
    userEmail,
    userId,
    userPrompt,
    visualNotesPreRun,
    visualScriptTemperature,
  } = params

  if (!visualNotesPreRun) {
    const notesResult = await generateLongTakeVisualNotes({
      pipelineContext,
      projectId,
      userId,
      userPrompt,
    })
    logInfo('longTakeWorkflow visual notes ready', {
      noteCount: notesResult.noteCount,
      notesPath: notesResult.notesPath,
    })
  }

  await runtime.setStageInProgress({ stage: 'visual_script' })
  const visualScriptResult = await generateLongTakeVisualScript({
    cameraStyle,
    perfectLoop,
    pipelineContext,
    promptRoute,
    projectId,
    transitionVideoModel,
    userId,
    userPrompt,
    visualScriptTemperature,
  })
  if (visualScriptResult.itemCount === 0) {
    throw ApplicationFailure.nonRetryable(
      'Visual script generation produced no content. Prompt may be too short, too vague, or incompatible with Story Mode.',
      'invariant_violation',
    )
  }
  await runtime.setStageCompleted({
    meta: { itemCount: visualScriptResult.itemCount },
    stage: 'visual_script',
  })
  logInfo('longTakeWorkflow visual script ready', {
    itemCount: visualScriptResult.itemCount,
    visualScriptPath: visualScriptResult.visualScriptPath,
  })

  const stylizeKeyframes = await generateAndTrackKeyframePrompts({
    logInfo,
    orgId,
    pipelineContext,
    promptRoute,
    projectId,
    runtime,
    userId,
  })

  await runtime.setStageInProgress({ stage: 'shot_plan' })
  const shotPlanResult = await buildLongTakeShotPlan({
    audioDurationSeconds,
    pipelineContext,
    promptRoute,
    projectId,
    transitionVideoModel,
    userEmail,
    userId,
    visualScriptPath: visualScriptResult.visualScriptPath,
  })
  if (shotPlanResult.shotCount === 0) {
    throw ApplicationFailure.nonRetryable(
      'Shot plan generation failed: unable to align visual script with audio transcript. Visual script may not match audio content.',
      'invariant_violation',
    )
  }
  await runtime.setStageCompleted({
    detail: getShotPlanFallbackStatusDetail(shotPlanResult),
    meta: {
      shotCount: shotPlanResult.shotCount,
      ...getShotPlanFallbackStatusMeta(shotPlanResult),
    },
    stage: 'shot_plan',
  })
  logInfo('longTakeWorkflow shot plan ready', {
    fallbackCount: shotPlanResult.fallbackCount ?? 0,
    fallbackRatio: shotPlanResult.fallbackRatio ?? 0,
    shotCount: shotPlanResult.shotCount,
    shotPlanPath: shotPlanResult.shotPlanPath,
  })

  const { keyframeReframeCount, keyframeUpsideDownCount, keyframes } = await generateKeyframes({
    admissionTier,
    aspectRatio,
    generationResolution,
    imageModel,
    imageConcurrency,
    keyframeImageModel,
    logInfo,
    orgId,
    promptRoute,
    projectId,
    runtime,
    shotPlanResult,
    styleName,
    styleText,
    stylizeKeyframes,
    userId,
  })

  return {
    keyframeReframeCount,
    keyframeUpsideDownCount,
    keyframes,
    shotPlanResult,
    visualScriptResult,
  }
}

/**
 * Exported for the restyle workflow, which re-runs only the
 * style-carrying tail of this stage: it deliberately reuses the source's visual
 * script and shot plan, so it must not call runVisualSequenceStages wholesale.
 */
export async function generateAndTrackKeyframePrompts(params: {
  logInfo: LongTakeWorkflowLogFn
  orgId?: string
  pipelineContext?: PipelineContextEntry[]
  projectId: string
  promptRoute?: LongTakePromptRoute
  runtime: LongTakeWorkflowRuntime
  userId: string
}): Promise<boolean> {
  const { logInfo, orgId, pipelineContext, promptRoute, projectId, runtime, userId } = params
  await runtime.setStageInProgress({ stage: 'keyframe_prompts' })
  const keyframePromptResult = await generateLongTakeKeyframePrompts({
    orgId,
    pipelineContext,
    promptRoute,
    projectId,
    userId,
  })
  await runtime.setStageCompleted({
    meta: { shotCount: keyframePromptResult.shotCount },
    stage: 'keyframe_prompts',
  })
  logInfo('longTakeWorkflow keyframe prompts generated', {
    outputPath: keyframePromptResult.outputPath,
    shotCount: keyframePromptResult.shotCount,
  })
  // The single stylization decision, reused by keyframe generation so
  // the per-shot suffix suppression matches whether style was baked here.
  return keyframePromptResult.stylizeKeyframes
}

/** Exported for the restyle workflow; see the note above. */
export async function generateKeyframes(params: {
  admissionTier?: LongTakeAdmissionTier
  aspectRatio?: AspectRatio
  generationResolution?: GenerationResolution
  imageConcurrency: number
  imageModel?: string
  keyframeImageModel?: string
  logInfo: LongTakeWorkflowLogFn
  orgId?: string
  projectId: string
  promptRoute?: LongTakePromptRoute
  runtime: LongTakeWorkflowRuntime
  // Only the plan and its count are read, so the restyle path can pass its
  // reused plan without fabricating the rest of the build result.
  shotPlanResult: Pick<BuildLongTakeShotPlanActivityResult, 'shotCount' | 'shotPlan'>
  styleName?: string
  styleText?: string
  stylizeKeyframes: boolean
  userId: string
}): Promise<{
  keyframeReframeCount: number
  keyframes: LongTakeKeyframeItem[]
  keyframeUpsideDownCount: number
}> {
  const {
    admissionTier,
    aspectRatio,
    generationResolution,
    imageModel,
    imageConcurrency,
    keyframeImageModel,
    logInfo,
    orgId,
    promptRoute,
    projectId,
    runtime,
    shotPlanResult,
    styleName,
    styleText,
    stylizeKeyframes,
    userId,
  } = params

  await runtime.setStageInProgress({
    meta: { shotCount: shotPlanResult.shotCount },
    stage: 'keyframes',
  })
  const { fallbackCount, keyframes, retryFailureCount } = await generateKeyframesWithRetryFallback({
    admissionTier,
    aspectRatio,
    generationResolution,
    imageModel,
    imageConcurrency,
    keyframeImageModel,
    logInfo,
    orgId,
    projectId,
    promptRoute,
    shotPlan: shotPlanResult.shotPlan,
    styleName,
    styleText,
    stylizeKeyframes,
    userId,
  })
  await saveLongTakeKeyframes({ keyframes, projectId })
  await runtime.setStageCompleted({
    meta: {
      keyframeFallbackCount: fallbackCount,
      keyframeRetryFailureCount: retryFailureCount,
      shotCount: shotPlanResult.shotCount,
    },
    stage: 'keyframes',
  })
  const keyframeReframeCount = keyframes.filter((k) => k.reframe === true).length
  const keyframeUpsideDownCount = keyframes.filter((k) => k.upsideDown === true).length
  logInfo('longTakeWorkflow keyframes ready', {
    fallbackCount,
    keyframeCount: keyframes.length,
    keyframeReframeCount,
    keyframeUpsideDownCount,
    retryFailureCount,
    shotCount: shotPlanResult.shotCount,
  })
  return { keyframeReframeCount, keyframeUpsideDownCount, keyframes }
}
