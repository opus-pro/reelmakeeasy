import type { ImageAdapter, MusicAdapter, VideoAdapter } from './types'
import { endpointFor, withEntryInput } from './types'

/** The first media URL in a fal response: images, video, then audio. */
export function falOutputUrl(output: unknown): string | undefined {
  const o = (output ?? {}) as {
    audio?: { url?: string }
    audio_file?: { url?: string }
    images?: { url?: string }[]
    video?: { url?: string }
  }
  return o.images?.[0]?.url ?? o.video?.url ?? o.audio?.url ?? o.audio_file?.url
}

/** Any fal image endpoint that takes the common `prompt` / `image_urls` / `aspect_ratio` fields. */
export const genericImage: ImageAdapter = {
  buildRequest(model, mode, o) {
    const refs = o.referenceImageUrls ?? []
    return {
      endpoint:
        mode === 'edit' && model.endpoints['edit']
          ? model.endpoints['edit']
          : endpointFor(model, 'generate'),
      input: withEntryInput(model, {
        aspect_ratio: o.aspectRatio ?? '1:1',
        prompt: o.prompt,
        ...(refs.length ? { image_urls: refs } : {}),
      }),
    }
  },
  parseOutput: falOutputUrl,
}

/** Any fal video endpoint; sends both common spellings of the start frame. */
export const genericVideo: VideoAdapter = {
  buildRequest(model, mode, o) {
    return {
      endpoint: endpointFor(model, mode),
      input: withEntryInput(model, {
        duration: String(Math.round(o.durationSeconds ?? 5)),
        prompt: o.prompt,
        ...(o.aspectRatio ? { aspect_ratio: o.aspectRatio } : {}),
        ...(o.startImageUrl
          ? { image_url: o.startImageUrl, start_image_url: o.startImageUrl }
          : {}),
        ...(o.endImageUrl ? { end_image_url: o.endImageUrl } : {}),
        ...(o.referenceImageUrls?.length ? { image_urls: o.referenceImageUrls } : {}),
      }),
    }
  },
  parseOutput: falOutputUrl,
}

export const genericMusic: MusicAdapter = {
  buildRequest(model, _mode, o) {
    return {
      endpoint: endpointFor(model, 'generate'),
      input: withEntryInput(model, {
        prompt: o.prompt,
        ...(o.negativePrompt ? { negative_prompt: o.negativePrompt } : {}),
      }),
    }
  },
  parseOutput: falOutputUrl,
}
