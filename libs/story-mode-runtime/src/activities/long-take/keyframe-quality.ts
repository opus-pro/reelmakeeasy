import {
  activeOrientationJudge,
  activeReframeJudge,
  GeminiVisionV1Runner,
} from '@reelmakeeasy/story-mode-judges'

import { formatError, formatLogFields, logger } from './common'

const geminiRunner = new GeminiVisionV1Runner()

// ---------------------------------------------------------------------------
// Style category mapping (metric tag: 'none' when no style, else 'custom')
// ---------------------------------------------------------------------------

export function normalizeStyleToCategory(styleText?: string): string {
  return styleText?.trim() ? 'custom' : 'none'
}

// ---------------------------------------------------------------------------
// Quality result type
// ---------------------------------------------------------------------------

export interface KeyframeQualityResult {
  reframe: boolean | null
  upsideDown: boolean | null
}

// ---------------------------------------------------------------------------
// Orientation check (refactored from common.ts)
// ---------------------------------------------------------------------------

export async function checkKeyframeOrientation(params: {
  keyframeUrl: string
  projectId: string
  shotId: string
  styleText?: string
}): Promise<null | { upsideDown: boolean }> {
  const { keyframeUrl, projectId, shotId, styleText } = params
  const style = normalizeStyleToCategory(styleText)
  try {
    const result = await geminiRunner.run(keyframeUrl, activeOrientationJudge)
    const upsideDown = !result.pass

    if (upsideDown) {
      logger.warn(
        `[long-take] Keyframe detected as upside down ${formatLogFields({ projectId, shotId, style })}`,
      )
    }
    return { upsideDown }
  } catch (error) {
    logger.warn(
      `[long-take] Keyframe orientation check failed ${formatLogFields({
        projectId,
        shotId,
        err: formatError(error),
      })}`,
    )
    return null
  }
}

// ---------------------------------------------------------------------------
// Reframe check
// ---------------------------------------------------------------------------

export async function checkKeyframeReframe(params: {
  keyframeUrl: string
  projectId: string
  shotId: string
  styleText?: string
}): Promise<null | { reframe: boolean }> {
  const { keyframeUrl, projectId, shotId, styleText } = params
  const style = normalizeStyleToCategory(styleText)
  try {
    const result = await geminiRunner.run(keyframeUrl, activeReframeJudge)
    const reframe = !result.pass

    if (reframe) {
      logger.warn(
        `[long-take] Keyframe detected as reframed ${formatLogFields({ projectId, shotId, style })}`,
      )
    }
    return { reframe }
  } catch (error) {
    logger.warn(
      `[long-take] Keyframe reframe check failed ${formatLogFields({
        projectId,
        shotId,
        err: formatError(error),
      })}`,
    )
    return null
  }
}

// ---------------------------------------------------------------------------
// Combined quality check (runs both in parallel)
// ---------------------------------------------------------------------------

export async function checkKeyframeQuality(params: {
  keyframeUrl: string
  projectId: string
  shotId: string
  styleText?: string
}): Promise<KeyframeQualityResult> {
  try {
    const [orientationResult, reframeResult] = await Promise.all([
      checkKeyframeOrientation(params),
      checkKeyframeReframe(params),
    ])

    return {
      reframe: reframeResult?.reframe ?? null,
      upsideDown: orientationResult?.upsideDown ?? null,
    }
  } catch (error) {
    logger.warn(
      `[long-take] Keyframe quality check failed ${formatLogFields({
        projectId: params.projectId,
        shotId: params.shotId,
        err: formatError(error),
      })}`,
    )
    return { reframe: null, upsideDown: null }
  }
}
