import { fitImageToSize, imageSizeOf, nearestFrameSize } from '../frame-fit'
import { exactDuration, snapDuration } from '../registry/capabilities'
import type { VideoCaps } from '../registry/schema'

import type { VideoAdapter } from './types'
import { endpointFor, withEntryInput } from './types'

/** fal's resolution names. 720p, the pipeline's old default, maps to 768P. */
const RESOLUTIONS: Record<string, string> = {
  '1080p': '1080P',
  '480p': '480P',
  '720p': '768P',
  '768p': '768P',
}
const DEFAULT_RESOLUTION = '768P'

/**
 * MiniMax Hailuo 3 on fal (`minimax/h3-max-turbo/*`). Text-to-video takes an
 * aspect ratio; image-to-video takes the first frame as `image_url` (the output
 * follows its shape), and first-last adds `end_image_url`. Clips snap to whole
 * seconds from 5 to 15 (`durationsSec`); a caller that needs an exact length
 * (a loop's 4 s clip) gets any length from 0.92 to 15 s (`durationRangeSec`).
 * fal bills the seconds asked for; the clip runs up to about 0.5 s longer.
 * Prompts arrive already rewritten for the model, so fal's own prompt
 * expansion is off.
 */
export const minimaxVideo: VideoAdapter = {
  /**
   * The output canvas follows the first frame, so a first and last frame of
   * different sizes make the model reframe (shift or zoom) one of them. Both
   * are fitted to the exact frame size it renders at this resolution
   * (`capabilities.frameSizes`), or the last frame to the first's size when
   * the shape isn't listed.
   */
  async prepareFrames(model, frames, { resolution }) {
    const first = frames.startImageUrl ?? frames.endImageUrl
    if (!first) return frames
    const caps = model.capabilities as VideoCaps
    const fal = RESOLUTIONS[resolution ?? ''] ?? DEFAULT_RESOLUTION
    const source = await imageSizeOf(first)
    const [width, height] = nearestFrameSize(
      caps.frameSizes?.[fal.toLowerCase()] ?? {},
      source.width,
      source.height,
    ) ?? [source.width, source.height]
    const fit = (uri?: string) => (uri ? fitImageToSize(uri, width, height) : undefined)
    const [startImageUrl, endImageUrl] = await Promise.all([
      fit(frames.startImageUrl),
      fit(frames.endImageUrl),
    ])
    return { endImageUrl, startImageUrl }
  },

  buildRequest(model, mode, o) {
    if (mode === 'reference')
      throw new Error(`Model "${model.key}" (minimax-video adapter) has no reference-image mode`)
    const caps = model.capabilities as VideoCaps
    const start = mode === 'text' ? undefined : o.startImageUrl
    const end = mode === 'firstLast' ? o.endImageUrl : undefined
    return {
      endpoint: endpointFor(model, mode),
      input: withEntryInput(model, {
        duration:
          o.exactDurationSeconds === undefined
            ? snapDuration(caps, o.durationSeconds ?? 5)
            : exactDuration(caps, o.exactDurationSeconds, model.key),
        prompt: o.prompt,
        prompt_expansion_mode: 'disabled',
        resolution: RESOLUTIONS[o.resolution ?? ''] ?? DEFAULT_RESOLUTION,
        ...(start ? { image_url: start } : { aspect_ratio: o.aspectRatio ?? '16:9' }),
        ...(end ? { end_image_url: end } : {}),
      }),
    }
  },
}
