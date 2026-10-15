import { LLM } from '@reelmakeeasy/llm'

import type { CircuitBreakerInstance } from '../circuit-breaker'
import { getLogger } from '../logger'

import {
  ClientImageGenerationOptions,
  ClientImageGenerationResult,
  Content,
} from './clients/client'
import { normalizeContentsForDevCache, tryReadBinary, tryWriteBinary } from './llm-cache'
import { ModelTier, normalizeImageModelId } from './models'

const logger = getLogger('generate-image')

export type GenerateImageOptions = Omit<ClientImageGenerationOptions, 'model'> & {
  /** Optional circuit breaker. When provided, models with open breakers are skipped. */
  breaker?: CircuitBreakerInstance
  /** Scope for breaker key isolation. Auto-resolved from JobContext if omitted. */
  breakerScope?: string
  /** Previous conversation turns for multi-turn image generation. */
  history?: ImageConversationTurn[]
  /**
   * Registry keys, fal endpoint ids or legacy ids; libs/llm resolves the first
   * against reelmakeeasy.models.json. Loop at the call site for fallbacks.
   */
  models: ModelTier | string[]
  responseValidator?: (response: ClientImageGenerationResult) => boolean
}

// One turn of a multi-turn image edit: the user's prompt or contents, or
// the model's previous output.
interface ImageConversationTurn {
  contents?: Content[]
  prompt?: string
  role: 'model' | 'user'
}

export async function generateImage(
  options: GenerateImageOptions,
): Promise<ClientImageGenerationResult> {
  const { imageBase64 } = await generateImageWithMeta(options)
  return { imageBase64 }
}

export async function generateImageWithMeta(
  options: GenerateImageOptions,
): Promise<{ imageBase64: string; model?: string }> {
  // Normalize retired -preview image ids to their GA id before anything else
  // (cache key + provider call), so the boundary is fully consistent.
  const normalizedOptions = Array.isArray(options.models)
    ? { ...options, models: options.models.map((m) => normalizeImageModelId(m)) }
    : options
  // === DEV CACHE: check ===
  const imageCacheParams = extractImageCacheParams(normalizedOptions)
  const imageCacheHit = await tryReadBinary<Record<string, never>>(imageCacheParams)
  if (imageCacheHit && imageCacheHit.buffers.length > 0) {
    logger.info(`[generateImage] dev-cache hit task=${normalizedOptions.task}`)
    return { imageBase64: imageCacheHit.buffers[0].toString('base64') }
  }
  const result = (await LLM.generateImageWithMeta(
    normalizedOptions,
  )) as ClientImageGenerationResult & {
    model?: string
  }
  writeImageToCache(imageCacheParams, result)
  return { imageBase64: result.imageBase64, model: result.model }
}

/**
 * Resolve the provider name for a given image model.
 * Used by circuit breaker to track health per provider. Every image model runs
 * on fal (via libs/llm), so this is 'fal' for any id and breaker keys stay the
 * same whichever model a project picked.
 */
/**
 * Every image model runs on fal. Kept distinct from the video 'fal' key so image and
 * video failures trip separate circuit breakers under their own policies.
 */
export function resolveImageProvider(_model: string): string {
  return 'fal-image'
}

// --- Dev cache helpers ---

function extractImageCacheParams(options: GenerateImageOptions): Record<string, unknown> {
  return {
    aspectRatio: options.aspectRatio,
    background: options.background,
    contents: normalizeContentsForDevCache(options.contents),
    imageSize: options.imageSize,
    models: options.models,
    n: options.n,
    prompt: options.prompt,
    quality: options.quality,
    size: options.size,
    task: options.task,
  }
}

function writeImageToCache(
  params: Record<string, unknown>,
  result: ClientImageGenerationResult,
): void {
  tryWriteBinary(params, {}, [
    { data: Buffer.from(result.imageBase64, 'base64'), ext: 'png', index: 0 },
  ])
}
