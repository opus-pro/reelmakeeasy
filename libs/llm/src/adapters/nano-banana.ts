import type { ImageAdapter } from './types'
import { endpointFor, withEntryInput } from './types'

/** Nano Banana (Pro) on fal: `/edit` takes the reference images. */
export const nanoBanana: ImageAdapter = {
  buildRequest(model, mode, o) {
    const refs = o.referenceImageUrls ?? []
    const edit = mode === 'edit' && refs.length > 0 ? model.endpoints['edit'] : undefined
    return {
      endpoint: edit ?? endpointFor(model, 'generate'),
      input: withEntryInput(model, {
        aspect_ratio: o.aspectRatio ?? '1:1',
        output_format: 'png',
        prompt: o.prompt,
        ...(o.resolution ? { resolution: o.resolution } : {}),
        ...(refs.length ? { image_urls: refs } : {}),
      }),
    }
  },
}
