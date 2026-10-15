import type {
  LongTakeTextSeverity,
  LongTakeTransitionAttemptRecord,
} from '../../workflows/long-take/transition-types'
import type {
  GenerateLongTakeTransitionVideoActivityParams,
  GenerateLongTakeTransitionVideoActivityResult,
} from '../../workflows/long-take/types'

import { formatLogFields, logger } from './common'
import { areAllAttemptsBlackScreen } from './transition-quality'
import { buildStaticHoldTransition } from './transition-static-hold'

const SEVERITY_ORDER = { none: 0, minor: 1, moderate: 2, severe: 3 }

export type TransitionQualityFallback =
  | {
      /**
       * Model that produced the SELECTED attempt. Attempts can run on different
       * models (the record layer falls back mid-flight), and selection is by
       * quality rather than recency, so the chosen clip carries its own model.
       */
      actualModel: string
      bytesPerFrame: number | undefined
      isBlackScreen: boolean
      kind: 'attempt'
      prompt: string
      qualityCheck: { hasGibberish: boolean; severity: LongTakeTextSeverity }
      videoPath: string
    }
  | { kind: 'static-hold'; result: GenerateLongTakeTransitionVideoActivityResult }

/**
 * Every quality attempt failed. Pick the least-bad clip -- or, when they are all
 * black screens, fall back to a static hold (when allowed) instead of shipping a
 * black transition.
 */
export async function resolveTransitionQualityFallback(params: {
  failedAttempts: LongTakeTransitionAttemptRecord[]
  projectId: string
  transitionId: string
  transitionParams: GenerateLongTakeTransitionVideoActivityParams
}): Promise<TransitionQualityFallback> {
  const { failedAttempts, projectId, transitionId, transitionParams } = params
  if (areAllAttemptsBlackScreen(failedAttempts)) {
    const originalError = `[long-take] All transition attempts produced black screen for ${transitionId}`
    // The static-hold fallback crossfades the first keyframe into the last, so
    // it needs both. A Story Mode 3.0 `cut` clip is i2v-only and has no last
    // frame; surface the real failure rather than inventing a hold.
    const lastFrameUri = transitionParams.lastFrameUri
    if (transitionParams.staticHoldFallbackOnAllBlack !== true || !lastFrameUri) {
      throw new Error(originalError)
    }
    return {
      kind: 'static-hold',
      result: await buildStaticHoldTransition({ ...transitionParams, lastFrameUri, originalError }),
    }
  }

  // Selection priority: non-black > non-gibberish > lowest severity > black
  failedAttempts.sort((a, b) => {
    if (a.isBlackScreen !== b.isBlackScreen) {
      return a.isBlackScreen ? 1 : -1
    }
    return SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
  })
  const bestAttempt = failedAttempts[0]
  logger.warn(
    `[long-take] All quality checks failed, using best attempt ${formatLogFields({
      projectId,
      transitionId,
      bestSeverity: bestAttempt.severity,
      isBlackScreen: bestAttempt.isBlackScreen,
    })}`,
  )
  return {
    actualModel: bestAttempt.actualModel,
    bytesPerFrame: bestAttempt.bytesPerFrame,
    isBlackScreen: bestAttempt.isBlackScreen,
    kind: 'attempt',
    prompt: bestAttempt.prompt,
    qualityCheck: { hasGibberish: true, severity: bestAttempt.severity },
    videoPath: bestAttempt.path,
  }
}
