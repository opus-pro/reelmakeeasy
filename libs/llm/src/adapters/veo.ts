import { clampResolution, exactDuration, snapDuration } from '../registry/capabilities'
import type { VideoCaps } from '../registry/schema'

import type { VideoAdapter } from './types'
import { endpointFor, withEntryInput } from './types'

/**
 * Google Veo on fal: text, image-to-video and first-last-frame endpoints.
 * Lengths snap to 4, 6 or 8 s, or are sent as asked with `exactDurationSeconds`
 * (4 s first-to-last works here, unlike Veo on the Gemini API). Sound only
 * when asked for (`generate_audio`, billed higher).
 */
export const veo: VideoAdapter = {
  buildRequest(model, mode, o) {
    const caps = model.capabilities as VideoCaps
    const seconds =
      o.exactDurationSeconds === undefined
        ? snapDuration(caps, o.durationSeconds ?? Math.max(...caps.durationsSec))
        : exactDuration(caps, o.exactDurationSeconds, model.key)
    const common = {
      aspect_ratio: o.aspectRatio && o.aspectRatio !== 'adaptive' ? o.aspectRatio : 'auto',
      duration: `${seconds}s`,
      generate_audio: o.generateAudio ?? false,
      prompt: o.prompt,
      ...(o.resolution && clampResolution(caps, o.resolution) === '1080p'
        ? { resolution: '1080p' }
        : {}),
    }
    const endpoint = endpointFor(model, mode)
    switch (mode) {
      case 'firstLast': {
        return {
          endpoint,
          input: withEntryInput(model, {
            ...common,
            first_frame_url: o.startImageUrl,
            last_frame_url: o.endImageUrl,
          }),
        }
      }
      case 'image': {
        return { endpoint, input: withEntryInput(model, { ...common, image_url: o.startImageUrl }) }
      }
      case 'reference': {
        return {
          endpoint,
          input: withEntryInput(model, { ...common, image_urls: o.referenceImageUrls ?? [] }),
        }
      }
      case 'text': {
        return { endpoint, input: withEntryInput(model, common) }
      }
    }
  },
}
