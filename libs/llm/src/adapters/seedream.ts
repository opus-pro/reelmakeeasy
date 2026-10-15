import type { ImageAdapter } from './types'
import { endpointFor, withEntryInput } from './types'

/** Long edge per resolution tier. Seedream takes explicit pixel sizes, not tiers. */
const LONG_EDGE = { '1K': 1024, '2K': 2048, '4K': 4096 } as const

/** Pixel size for a tier and aspect ratio, rounded to multiples of 16. */
export function seedreamImageSize(
  resolution: keyof typeof LONG_EDGE,
  aspectRatio: string,
): { height: number; width: number } {
  const [w, h] = aspectRatio.split(':').map(Number)
  const ratio = w && h ? w / h : 1
  const long = LONG_EDGE[resolution]
  const round = (n: number) => Math.max(16, Math.round(n / 16) * 16)
  return ratio >= 1
    ? { height: round(long / ratio), width: long }
    : { height: long, width: round(long * ratio) }
}

/** ByteDance Seedream on fal. */
export const seedream: ImageAdapter = {
  buildRequest(model, mode, o) {
    const refs = o.referenceImageUrls ?? []
    const edit = mode === 'edit' && refs.length > 0 ? model.endpoints['edit'] : undefined
    return {
      endpoint: edit ?? endpointFor(model, 'generate'),
      input: withEntryInput(model, {
        image_size: seedreamImageSize(o.resolution ?? '2K', o.aspectRatio ?? '1:1'),
        num_images: 1,
        prompt: o.prompt,
        ...(refs.length ? { image_urls: refs } : {}),
      }),
    }
  },
}
