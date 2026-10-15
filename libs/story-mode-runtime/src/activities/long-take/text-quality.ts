import type { TextQualityAnalysis } from '@reelmakeeasy/story-mode-judges'
import { analyzeTextQuality, extractMiddleFrame } from '@reelmakeeasy/story-mode-judges'

import type {
  LongTakeKeyframeItem,
  LongTakeTransitionVideoItem,
} from '../../workflows/long-take/types'

import {
  formatError,
  formatLogFields,
  logger,
  mapWithConcurrency,
  withActivityHeartbeat,
} from './common'
import { normalizeStyleToCategory } from './keyframe-quality'

export type { TextQualityAnalysis }
export { analyzeTextQuality, extractMiddleFrame }

// ---------------------------------------------------------------------------
// Activity types
// ---------------------------------------------------------------------------

export interface DetectLongTakeGibberishTextActivityParams {
  keyframes: LongTakeKeyframeItem[]
  projectId: string
  styleText?: string
  transitionVideos: LongTakeTransitionVideoItem[]
  userId: string
}

export interface DetectLongTakeGibberishTextActivityResult {
  keyframeGibberishCount: number
  keyframesChecked: number
  transitionBlackScreenCount: number
  transitionGibberishCount: number
  transitionsChecked: number
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

const DETECTION_CONCURRENCY = 5

export async function detectLongTakeGibberishText(
  params: DetectLongTakeGibberishTextActivityParams,
): Promise<DetectLongTakeGibberishTextActivityResult> {
  return withActivityHeartbeat(async () => detectLongTakeGibberishTextImpl(params))
}

async function detectLongTakeGibberishTextImpl(
  params: DetectLongTakeGibberishTextActivityParams,
): Promise<DetectLongTakeGibberishTextActivityResult> {
  const { keyframes, projectId, styleText, transitionVideos, userId } = params
  const style = normalizeStyleToCategory(styleText)

  let keyframeGibberishCount = 0
  let transitionGibberishCount = 0

  // Analyze keyframes - pass URL directly (HTTP CDN URLs are supported by the LLM client)
  await mapWithConcurrency(keyframes, DETECTION_CONCURRENCY, async (keyframe) => {
    try {
      const analysis = await analyzeTextQuality(keyframe.keyframeUrl)
      if (analysis.hasGibberish) {
        keyframeGibberishCount++
        logger.warn(
          `[long-take] Gibberish text detected in keyframe ${formatLogFields({
            projectId,
            shotId: keyframe.shotId,
            severity: analysis.severity,
            distortionTypes: analysis.distortionTypes.join(','),
            style,
          })}`,
        )
      }
    } catch (error) {
      logger.warn(
        `[long-take] Keyframe text quality check failed ${formatLogFields({
          projectId,
          shotId: keyframe.shotId,
          err: formatError(error),
        })}`,
      )
    }
  })

  // Tally transition quality results cached from generation-time checks
  let transitionBlackScreenCount = 0
  for (const transition of transitionVideos) {
    const { hasGibberish, severity } = transition.qualityCheck
    if (hasGibberish) {
      transitionGibberishCount++
      logger.warn(
        `[long-take] Gibberish text detected in transition ${formatLogFields({
          projectId,
          transitionId: transition.transitionId,
          severity,
          style,
        })}`,
      )
    }
    if (transition.isBlackScreen) {
      transitionBlackScreenCount++
      logger.warn(
        `[long-take] Black screen transition in final video ${formatLogFields({
          projectId,
          transitionId: transition.transitionId,
          bytesPerFrame: transition.bytesPerFrame,
          style,
        })}`,
      )
    }
  }

  logger.info(
    `[long-take] Gibberish text detection completed ${formatLogFields({
      projectId,
      userId,
      keyframesChecked: keyframes.length,
      keyframeGibberishCount,
      transitionsChecked: transitionVideos.length,
      transitionGibberishCount,
      transitionBlackScreenCount,
    })}`,
  )

  return {
    keyframeGibberishCount,
    keyframesChecked: keyframes.length,
    transitionBlackScreenCount,
    transitionGibberishCount,
    transitionsChecked: transitionVideos.length,
  }
}
