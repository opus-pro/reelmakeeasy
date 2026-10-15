import {
  activeOnImageTextJudge,
  GeminiVisionV1Runner,
  type JudgeContext,
} from '@reelmakeeasy/story-mode-judges'

import { formatError, formatLogFields, logger } from './common'

const geminiRunner = new GeminiVisionV1Runner()

export interface KeyframeTextCheckResult {
  reason: string
  textIssue: boolean
}

export async function checkKeyframeText(params: {
  context: JudgeContext
  keyframeUrl: string
  projectId: string
  shotId: string
}): Promise<KeyframeTextCheckResult | null> {
  const { context, keyframeUrl, projectId, shotId } = params
  try {
    const result = await geminiRunner.run(keyframeUrl, activeOnImageTextJudge, context)
    const textIssue = !result.pass

    if (textIssue) {
      logger.warn(
        `[long-take] Keyframe text check failed the shot ${formatLogFields({
          projectId,
          shotId,
          reason: result.reason,
        })}`,
      )
    }
    return { reason: result.reason, textIssue }
  } catch (error) {
    logger.warn(
      `[long-take] Keyframe text check failed ${formatLogFields({
        projectId,
        shotId,
        err: formatError(error),
      })}`,
    )
    return null
  }
}
