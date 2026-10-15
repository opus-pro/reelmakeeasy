import { Logger } from '@reelmakeeasy/common/logger'
import type { GenVideoOutput } from '@reelmakeeasy/common/veo3/gen-video'
import { resolveModel } from '@reelmakeeasy/llm/registry'

import {
  isValidTransitionVideoModel,
  resolveDefaultTransitionVideoModel,
  type TransitionModelSource,
} from './long-take-generation-record-staging'

const logger = new Logger('story-mode:long-take-transition-video-request')

export function requireTransitionVideoOutput(
  outputs: GenVideoOutput[],
  transitionId: string,
): GenVideoOutput {
  const output = outputs[0]
  if (!output?.path) {
    throw new Error(`No transition video generated for ${transitionId}`)
  }
  return output
}

/**
 * Resolves the API/debug transition model override to a registry key. Legacy
 * ids (Seedance, Veo 3.0, ...) map onto the `video.firstLast` role; an unknown
 * id falls through to the default.
 */
export function resolveTransitionVideoModelForRequest(params: { transitionVideoModel?: string }): {
  configuredModel?: string
  model: string
  modelSource: TransitionModelSource
} {
  const transitionVideoModel = params.transitionVideoModel?.trim()
  if (transitionVideoModel && isValidTransitionVideoModel(transitionVideoModel)) {
    const resolved = resolveModel('video', transitionVideoModel, { role: 'video.firstLast' })
    if (resolved.key === transitionVideoModel) {
      logger.info(
        `[long-take] Using API-provided transition video model override: ${transitionVideoModel}`,
      )
    } else {
      logger.info(
        `[long-take] API-provided transition video model '${transitionVideoModel}' resolves to '${resolved.key}' (${resolved.source})`,
      )
    }
    return {
      configuredModel: transitionVideoModel,
      model: resolved.key,
      modelSource: 'api-override',
    }
  }
  if (transitionVideoModel) {
    logger.warn(
      `[long-take] Invalid API-provided transition video model '${transitionVideoModel}', falling through to the default`,
    )
  }
  return resolveDefaultTransitionVideoModel()
}
