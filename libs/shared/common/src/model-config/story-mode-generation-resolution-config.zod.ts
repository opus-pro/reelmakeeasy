import { z } from 'zod'

import type { GenerationResolution, ImageSizeTier, VideoResolution } from '../media/types'

export const VIDEO_RESOLUTIONS = [
  '480p',
  '720p',
  '768p',
  '1080p',
] as const satisfies readonly VideoResolution[]
export const IMAGE_SIZE_TIERS = ['1K', '2K', '4K'] as const satisfies readonly ImageSizeTier[]

// Each field degrades independently: one invalid value falls back to absent
// (= current behavior) without discarding the other axis.
const GenerationResolutionSchema = z.object({
  imageSize: z.enum(IMAGE_SIZE_TIERS).optional().catch(undefined),
  videoResolution: z.enum(VIDEO_RESOLUTIONS).optional().catch(undefined),
})

export function isValidImageSizeTier(value: unknown): value is ImageSizeTier {
  return typeof value === 'string' && (IMAGE_SIZE_TIERS as readonly string[]).includes(value)
}

export function isValidVideoResolution(value: unknown): value is VideoResolution {
  return typeof value === 'string' && (VIDEO_RESOLUTIONS as readonly string[]).includes(value)
}

/**
 * Sanitize a client-provided generation-resolution object. Never
 * trust the client: unknown fields and invalid enum values are dropped per
 * field. Returns undefined when nothing valid remains (=> default behavior).
 */
export function sanitizeGenerationResolution(input: unknown): GenerationResolution | undefined {
  if (typeof input !== 'object' || input === null) {
    return undefined
  }
  const parsed = GenerationResolutionSchema.safeParse(input)
  if (!parsed.success) {
    return undefined
  }
  const result: GenerationResolution = {}
  if (parsed.data.imageSize !== undefined) {
    result.imageSize = parsed.data.imageSize
  }
  if (parsed.data.videoResolution !== undefined) {
    result.videoResolution = parsed.data.videoResolution
  }
  return result.imageSize || result.videoResolution ? result : undefined
}

/**
 * Resolve the image size tier for an editor REGENERATION: the
 * project-configured value when valid, else undefined. An invalid persisted
 * value is never trusted.
 *
 * Regen paths must resolve the tier and pass NO explicit `size`: for provider
 * 'openai' an explicit size wins over the tier and IS the output ratio, so
 * pinning one of the three legacy OpenAI grid values gave a 16:9 project a 3:2
 * image and a 9:16 project a 2:3 one.
 *
 * @param configured - the project's persisted `generationResolution`, unknown-typed
 *   because it is a Prisma Json column.
 */
export function resolveRegenImageSizeTier(configured: unknown): ImageSizeTier | undefined {
  const persisted = (configured as GenerationResolution | null | undefined)?.imageSize
  return isValidImageSizeTier(persisted) ? persisted : undefined
}
