import type { ImageAdapter } from './types'
import { endpointFor, withEntryInput } from './types'

/** Pixel budget per resolution tier; 1K matches Nano Banana's 1K (768x1360 at 9:16). */
const PIXELS = { '1K': 1024 * 1024, '2K': 2048 * 2048, '4K': 8_294_400 } as const
const MIN_PIXELS = 655_360
const MAX_EDGE = 3840

/**
 * Pixel size for a tier and aspect ratio. GPT Image takes explicit sizes: both
 * edges multiples of 16, at most 3840 px, with 655,360 to 8,294,400 pixels.
 */
export function gptImageSize(
  resolution: keyof typeof PIXELS,
  aspectRatio: string,
): { height: number; width: number } {
  const [w, h] = aspectRatio.split(':').map(Number)
  const ratio = w && h ? w / h : 1
  const pixels = Math.max(PIXELS[resolution], MIN_PIXELS)
  const width = Math.sqrt(pixels * ratio)
  const height = Math.sqrt(pixels / ratio)
  // Shrink both edges together past the edge cap, then round down so the
  // pixel count stays inside the limit.
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height))
  const floor16 = (n: number) => Math.max(16, Math.floor((n * scale) / 16) * 16)
  return { height: floor16(height), width: floor16(width) }
}

/**
 * OpenAI GPT Image on fal. Reference images go to the `/edit` endpoint, which
 * also generates new scenes from them. The size is always explicit: `/edit`
 * otherwise copies the size of the first reference image.
 */
export const gptImage: ImageAdapter = {
  buildRequest(model, mode, o) {
    const refs = o.referenceImageUrls ?? []
    const edit = mode === 'edit' && refs.length > 0 ? model.endpoints['edit'] : undefined
    return {
      endpoint: edit ?? endpointFor(model, 'generate'),
      input: withEntryInput(model, {
        image_size: gptImageSize(o.resolution ?? '1K', o.aspectRatio ?? '1:1'),
        num_images: 1,
        output_format: 'png',
        prompt: o.prompt,
        ...(edit ? { image_urls: refs } : {}),
      }),
    }
  },
}
