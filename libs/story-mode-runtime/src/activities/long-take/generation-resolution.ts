import { Logger } from '@reelmakeeasy/common/logger'
import type {
  GenerationResolution,
  ImageSizeTier,
  VideoResolution,
} from '@reelmakeeasy/common/media/types'
import {
  isValidImageSizeTier,
  isValidVideoResolution,
} from '@reelmakeeasy/common/model-config/story-mode-generation-resolution-config.zod'

const logger = new Logger('story-mode:long-take-generation-resolution')

export type GenerationResolutionSource = 'api-override' | 'default' | 'fallback-invalid'

export interface ResolvedGenerationResolution {
  imageSize?: ImageSizeTier
  imageSizeSource: GenerationResolutionSource
  videoResolution?: VideoResolution
  videoResolutionSource: GenerationResolutionSource
}

/**
 * Resolve the effective generation resolution for a story-mode project.
 * Per axis: the API/workflow-configured value (validated; invalid =>
 * warn + fall through) > default (undefined = current behavior: video 720p,
 * image the model adapter's default). Projects that need a pin set the API value,
 * which is persisted and carried via workflow params.
 */
export function resolveGenerationResolution(params: {
  configured?: GenerationResolution
  projectId: string
}): ResolvedGenerationResolution {
  const { configured, projectId } = params
  const image = resolveAxis('imageSize', configured?.imageSize, isValidImageSizeTier, projectId)
  const video = resolveAxis(
    'videoResolution',
    configured?.videoResolution,
    isValidVideoResolution,
    projectId,
  )
  return {
    imageSize: image.value,
    imageSizeSource: image.source,
    videoResolution: video.value,
    videoResolutionSource: video.source,
  }
}

function resolveAxis<T>(
  axis: string,
  configured: T | undefined,
  isValid: (value: unknown) => value is T,
  projectId: string,
): { source: GenerationResolutionSource; value?: T } {
  if (configured === undefined) {
    return { source: 'default' }
  }
  if (isValid(configured)) {
    return { source: 'api-override', value: configured }
  }
  logger.warn(
    `[long-take] Invalid configured ${axis} '${String(configured)}' for project ${projectId}, falling through to default`,
  )
  return { source: 'fallback-invalid' }
}
