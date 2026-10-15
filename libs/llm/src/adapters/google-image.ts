import { type GenerateContentResponse, inlineDataFromUri, inlineParts } from '../google'
import type { ResolvedModel } from '../registry/resolve'
import type { ImageCaps } from '../registry/schema'

import type { GoogleRequest, ImageRequestOptions } from './types'
import { endpointFor, withEntryInput } from './types'

/**
 * Nano Banana on the Gemini API: the prompt and up to `maxReferenceImages`
 * reference pictures as inline parts, answered with one picture. Aspect ratio
 * and size are sent only when the model lists them (Lite takes no size).
 */
export function buildGeminiImageRequest(
  model: ResolvedModel,
  o: ImageRequestOptions,
): GoogleRequest {
  const caps = model.capabilities as ImageCaps
  const refs = (o.referenceImageUrls ?? []).slice(0, caps.maxReferenceImages)
  const aspectRatio =
    o.aspectRatio && caps.aspectRatios.includes(o.aspectRatio) ? o.aspectRatio : undefined
  const imageSize =
    o.resolution && caps.resolutions.length > 1 && caps.resolutions.includes(o.resolution)
      ? o.resolution
      : undefined
  const imageConfig = {
    ...(aspectRatio ? { aspectRatio } : {}),
    ...(imageSize ? { imageSize } : {}),
  }
  const edit = refs.length ? model.endpoints['edit'] : undefined
  return {
    body: withEntryInput(model, {
      contents: [
        {
          parts: [
            { text: o.prompt },
            ...refs.map((uri) => ({ inlineData: inlineDataFromUri(uri) })),
          ],
          role: 'user',
        },
      ],
      generationConfig: {
        responseModalities: ['IMAGE'],
        ...(Object.keys(imageConfig).length ? { imageConfig } : {}),
      },
    }),
    model: edit ?? endpointFor(model, 'generate'),
  }
}

/** The picture in a Nano Banana answer, base64 (the last one; earlier ones are drafts). */
export function geminiImageBase64(res: GenerateContentResponse): string {
  const images = inlineParts(res, 'image')
  return images[images.length - 1]?.data ?? ''
}
