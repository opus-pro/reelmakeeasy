import { nanoBananaTool } from '@agent-lib/agents/storyboard/utils/nano-banana'
import { type ClientImageGenerationOptions, type Content } from '@reelmakeeasy/common/llm'
import { Logger } from '@reelmakeeasy/common/logger'
import type { LongTakeAdmissionTier } from '@reelmakeeasy/common/long-take/types'
import type { AspectRatio, ImageSizeTier } from '@reelmakeeasy/common/media/types'
import { ApplicationFailure } from '@reelmakeeasy/workflow-engine/activity'
import { v4 as uuidV4 } from 'uuid'

import { resolveBreakerScope, storyModeBreaker } from './circuit-breaker'
import { asReferenceFetchFailure, normalizeImageError } from './long-take-generation-errors'
import {
  extractContentUris,
  formatError,
  formatLogFields,
  recordGenerationCall,
} from './long-take-generation-record-staging'

const logger = new Logger('story-mode:long-take-image-generation-record')

/**
 * Generates one long-take image on `customModel` and records the call. Model
 * fallbacks come from the registry (`reelmakeeasy.models.json`) via nanoBananaTool.
 */
export async function runImageGenerationWithRecord(params: {
  aspectRatio: AspectRatio
  contents: Content[]
  /** A registry key, fal endpoint or legacy id; legacy ids resolve to the image.edit role. */
  customModel: string
  imageOptions?: Pick<ClientImageGenerationOptions, 'grounding'>
  /** Image size tier, forwarded as the model's resolution. */
  imageSize?: ImageSizeTier
  onModelSucceeded?: (model: string) => void
  outputPath: string
  outputUri?: string
  projectId: string
  prompt: string
  shotId: string
  task: string
  taskId?: string
  tier?: LongTakeAdmissionTier
  userId?: string
}): Promise<string> {
  const {
    aspectRatio,
    contents,
    customModel,
    imageOptions,
    imageSize,
    onModelSucceeded,
    outputPath,
    outputUri,
    projectId,
    prompt,
    shotId,
    task,
    taskId = uuidV4(),
    userId,
  } = params
  const nanoImageOptions = imageSize ? { ...imageOptions, imageSize } : imageOptions
  const inputRefs = extractContentUris(contents)
  const resolvedOutputRef = outputUri || outputPath
  const imgBreakerScope = resolveBreakerScope()
  const notifyModelSucceeded = (model: string) => {
    try {
      onModelSucceeded?.(model)
    } catch (error) {
      logger.warn(
        `[long-take] onModelSucceeded callback failed ${formatLogFields({
          error: formatError(error),
          model,
          projectId,
          shotId,
        })}`,
      )
    }
  }

  // nanoBananaTool resolves the model against the registry and moves its
  // retries onto the registry fallback, reporting the model it ended on.
  let actualModel = customModel
  try {
    const resultPath = await nanoBananaTool(
      prompt,
      contents,
      outputPath,
      task,
      customModel,
      aspectRatio,
      nanoImageOptions,
      {
        breaker: storyModeBreaker,
        breakerScope: imgBreakerScope,
        onModelResolved: (m) => {
          actualModel = m
        },
      },
    )
    await recordGenerationCall({
      anchorId: shotId,
      anchorType: 'shot',
      attempt: 1,
      inputRefs,
      inputText: prompt,
      model: actualModel,
      outputRefs: [resolvedOutputRef],
      projectId,
      status: 'success',
      task,
      taskId,
      type: 'image',
      userId,
    })
    notifyModelSucceeded(actualModel)
    return resultPath
  } catch (error) {
    // Only record as real provider failure if an actual API call was made.
    // When the breaker rejects inside generateImage(), nanoBananaTool wraps the
    // error as "No image content returned (IMAGE_GEN_FAILED): All models failed
    // for image generation" with no real API call attempted.
    const isBreakerSkip =
      error instanceof Error && error.message.includes('All models failed for image generation')
    if (isBreakerSkip) {
      throw ApplicationFailure.nonRetryable(
        'Circuit breaker open for the image provider',
        'circuit_breaker_open',
      )
    }
    await recordGenerationCall({
      anchorId: shotId,
      anchorType: 'shot',
      attempt: 1,
      error: formatError(error),
      inputRefs,
      inputText: prompt,
      model: actualModel,
      projectId,
      status: 'failed',
      task,
      taskId,
      type: 'image',
      userId,
    })
    // Re-throw so the engine can retry the activity; a poisoned reference is
    // surfaced as such so the caller stops retrying it.
    throw asReferenceFetchFailure(error, inputRefs) ?? normalizeImageError(error, 'nano-banana')
  }
}
