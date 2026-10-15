import type { LongTakeAdmissionTier } from '@reelmakeeasy/common/long-take/types'
import type { AspectRatio, GenerationResolution } from '@reelmakeeasy/common/media/types'
import { ApplicationFailure } from '@reelmakeeasy/workflow-engine/workflow'

import type { LongTakePromptRoute } from '../../long-take-prompt-router'

import { generateLongTakeKeyframe } from './activity-proxies'
import type { LongTakeKeyframeItem, LongTakeShotPlanItem } from './types'
import { isPoisonedReferenceFailure } from './workflow-error-helpers'
import type { LongTakeWorkflowLogFn } from './workflow-runtime'
import { mapWithConcurrencySettled } from './workflow-utils'

const MAX_KEYFRAME_FALLBACK_ABSOLUTE = 2
const MAX_KEYFRAME_FALLBACK_RATIO = 0.2

export type KeyframeRetryFallbackResult = KeyframeGenerationResult

/**
 * Serializable params for driving generateKeyframesWithRetryFallback from a top-level
 * workflow (logInfo is reconstructed inside the workflow, not passed across the boundary).
 * Used by keyframe-retry-fallback.test-workflow.ts.
 */
export type KeyframeRetryFallbackWorkflowParams = Omit<KeyframeGenerationParams, 'logInfo'>

type IndexedKeyframe = {
  index: number
  keyframe: LongTakeKeyframeItem
}

type KeyframeFailure = {
  errorMessage: string
  index: number
  poisonedReference: boolean
  shot: LongTakeShotPlanItem
}

type KeyframeGenerationParams = {
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
  shotPlan: LongTakeShotPlanItem[]
  styleName?: string
  styleText?: string
  stylizeKeyframes: boolean
  userId: string
}

type KeyframeGenerationResult = {
  fallbackCount: number
  keyframes: LongTakeKeyframeItem[]
  retryFailureCount: number
}

export async function generateKeyframesWithRetryFallback(
  params: KeyframeGenerationParams,
): Promise<KeyframeGenerationResult> {
  const firstRound = await runKeyframeRound(params, params.shotPlan)
  const firstRoundFailures = getKeyframeFailures(params.shotPlan, firstRound)
  if (firstRoundFailures.length === 0) {
    return {
      fallbackCount: 0,
      keyframes: firstRound.map((result) => getFulfilledKeyframe(result)),
      retryFailureCount: 0,
    }
  }

  // A shot whose reference image the provider could not fetch fails the same
  // way on every retry, so retrying it only spends provider quota and time.
  const poisonedFailures = firstRoundFailures.filter((failure) => failure.poisonedReference)
  const retryFailures = firstRoundFailures.filter((failure) => !failure.poisonedReference)

  params.logInfo('longTakeWorkflow keyframe generation retrying failed shots', {
    failedCount: firstRoundFailures.length,
    failedShotIds: firstRoundFailures.map((failure) => failure.shot.shot_id),
    poisonedReferenceShotIds: poisonedFailures.map((failure) => failure.shot.shot_id),
    totalShots: params.shotPlan.length,
  })

  const retryShotPlan = retryFailures.map((failure) => failure.shot)
  const retryRound = await runKeyframeRound(params, retryShotPlan)
  const finalKeyframes: Array<LongTakeKeyframeItem | undefined> = firstRound.map((result) =>
    result.status === 'fulfilled' ? result.value : undefined,
  )
  const remainingFailures: KeyframeFailure[] = [...poisonedFailures]

  retryRound.forEach((result, retryIndex) => {
    const firstRoundFailure = retryFailures[retryIndex]
    if (result.status === 'fulfilled') {
      finalKeyframes[firstRoundFailure.index] = result.value
      return
    }
    remainingFailures.push({
      errorMessage: getErrorMessage(result.reason),
      index: firstRoundFailure.index,
      poisonedReference: isPoisonedReferenceFailure(result.reason),
      shot: firstRoundFailure.shot,
    })
  })

  if (remainingFailures.length === 0) {
    params.logInfo('longTakeWorkflow keyframe retry recovered all failed shots', {
      retriedCount: firstRoundFailures.length,
      totalShots: params.shotPlan.length,
    })
    return {
      fallbackCount: 0,
      keyframes: assertCompleteKeyframes(finalKeyframes),
      retryFailureCount: 0,
    }
  }

  const successfulKeyframes = finalKeyframes.flatMap((keyframe, index) =>
    keyframe ? [{ index, keyframe }] : [],
  )
  if (!canFallbackKeyframeFailures(params.shotPlan.length, remainingFailures.length)) {
    params.logInfo('longTakeWorkflow keyframe failure threshold exceeded', {
      failedCount: remainingFailures.length,
      failedShotIds: remainingFailures.map((failure) => failure.shot.shot_id),
      maxAbsolute: MAX_KEYFRAME_FALLBACK_ABSOLUTE,
      maxRatio: MAX_KEYFRAME_FALLBACK_RATIO,
      totalShots: params.shotPlan.length,
    })
    throw ApplicationFailure.nonRetryable(
      `Too many keyframe failures after retry: ${remainingFailures.length}/${params.shotPlan.length}. ` +
        `Max fallback allowed: ${MAX_KEYFRAME_FALLBACK_ABSOLUTE} shots and ${MAX_KEYFRAME_FALLBACK_RATIO * 100}% ratio.`,
      'KEYFRAME_FALLBACK_THRESHOLD_EXCEEDED',
    )
  }
  if (successfulKeyframes.length === 0) {
    throw ApplicationFailure.nonRetryable(
      `All keyframe generations failed after retry (${remainingFailures.length}/${params.shotPlan.length}).`,
      'KEYFRAME_GENERATION_ALL_FAILED',
    )
  }

  for (const failure of remainingFailures) {
    const fallback = findNearestSuccessfulKeyframe(failure.index, successfulKeyframes)
    finalKeyframes[failure.index] = {
      ...fallback.keyframe,
      fallbackFromShotId: fallback.keyframe.shotId,
      shotId: failure.shot.shot_id,
      usedFallback: true,
    }
    params.logInfo('longTakeWorkflow keyframe fallback applied', {
      fallbackFromShotId: fallback.keyframe.shotId,
      originalError: failure.errorMessage,
      shotId: failure.shot.shot_id,
    })
  }

  return {
    fallbackCount: remainingFailures.length,
    keyframes: assertCompleteKeyframes(finalKeyframes),
    retryFailureCount: remainingFailures.length,
  }
}

function assertCompleteKeyframes(
  keyframes: Array<LongTakeKeyframeItem | undefined>,
): LongTakeKeyframeItem[] {
  const missingIndex = keyframes.findIndex((keyframe) => !keyframe)
  if (missingIndex !== -1) {
    throw ApplicationFailure.nonRetryable(
      `Missing keyframe result at index ${missingIndex}.`,
      'KEYFRAME_GENERATION_INVARIANT',
    )
  }
  return keyframes as LongTakeKeyframeItem[]
}

function canFallbackKeyframeFailures(totalShots: number, failedCount: number): boolean {
  if (failedCount === 0) {
    return true
  }
  if (failedCount === 1) {
    return true
  }
  return (
    failedCount <= MAX_KEYFRAME_FALLBACK_ABSOLUTE &&
    failedCount / Math.max(1, totalShots) <= MAX_KEYFRAME_FALLBACK_RATIO
  )
}

function findNearestSuccessfulKeyframe(
  failedIndex: number,
  successfulKeyframes: IndexedKeyframe[],
): IndexedKeyframe {
  return successfulKeyframes.reduce((nearest, candidate) => {
    const nearestDistance = Math.abs(nearest.index - failedIndex)
    const candidateDistance = Math.abs(candidate.index - failedIndex)
    if (candidateDistance < nearestDistance) {
      return candidate
    }
    if (candidateDistance === nearestDistance && candidate.index < nearest.index) {
      return candidate
    }
    return nearest
  })
}

async function generateKeyframeForShot(
  params: KeyframeGenerationParams,
  shot: LongTakeShotPlanItem,
): Promise<LongTakeKeyframeItem> {
  return generateLongTakeKeyframe({
    admissionTier: params.admissionTier,
    aspectRatio: params.aspectRatio,
    generationResolution: params.generationResolution,
    humanPresence: shot.human_presence,
    imageModel: params.imageModel,
    keyframeImageModel: params.keyframeImageModel,
    orgId: params.orgId,
    projectId: params.projectId,
    prompt: shot.keyframe_prompt,
    promptRoute: params.promptRoute,
    shotId: shot.shot_id,
    styleName: params.styleName,
    styleText: params.styleText,
    stylizeKeyframes: params.stylizeKeyframes,
    usedAssetIds: shot.used_asset_id || [],
    userId: params.userId,
  })
}

function getErrorMessage(reason: unknown): string {
  return reason instanceof Error ? reason.message : String(reason)
}

function getFulfilledKeyframe(
  result: PromiseSettledResult<LongTakeKeyframeItem>,
): LongTakeKeyframeItem {
  if (result.status === 'fulfilled') {
    return result.value
  }
  throw ApplicationFailure.nonRetryable(
    'Unexpected keyframe failure after successful all-settled check.',
    'KEYFRAME_GENERATION_INVARIANT',
  )
}

function getKeyframeFailures(
  shotPlan: LongTakeShotPlanItem[],
  results: PromiseSettledResult<LongTakeKeyframeItem>[],
): KeyframeFailure[] {
  return results.flatMap((result, index) =>
    result.status === 'rejected'
      ? [
          {
            errorMessage: getErrorMessage(result.reason),
            index,
            poisonedReference: isPoisonedReferenceFailure(result.reason),
            shot: shotPlan[index],
          },
        ]
      : [],
  )
}

async function runKeyframeRound(
  params: KeyframeGenerationParams,
  shotPlan: LongTakeShotPlanItem[],
): Promise<PromiseSettledResult<LongTakeKeyframeItem>[]> {
  return mapWithConcurrencySettled(shotPlan, params.imageConcurrency, (shot) =>
    generateKeyframeForShot(params, shot),
  )
}
