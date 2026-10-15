import type { VideoResolution } from '../media/types'

// Per-model resolution caps live in the model registry; clamp with
// `clampVideoResolution` from `../video-models/registry`.

/**
 * Nominal output dimensions per resolution and aspect ratio. Used for
 * ffmpeg-synthesized clips (static-hold) and reported metadata; actual
 * provider output dims may differ slightly.
 */
export const VIDEO_RESOLUTION_DIMENSIONS: Record<
  VideoResolution,
  Record<string, { height: number; width: number }> & {
    '9:16': { height: number; width: number }
  }
> = {
  '480p': {
    '16:9': { height: 480, width: 854 },
    '9:16': { height: 854, width: 480 },
    '1:1': { height: 480, width: 480 },
    '4:3': { height: 480, width: 640 },
    '3:4': { height: 640, width: 480 },
    '21:9': { height: 480, width: 1120 },
  },
  '720p': {
    '16:9': { height: 720, width: 1280 },
    '9:16': { height: 1280, width: 720 },
    '1:1': { height: 720, width: 720 },
    '4:3': { height: 720, width: 960 },
    '3:4': { height: 960, width: 720 },
    '21:9': { height: 720, width: 1680 },
  },
  // Hailuo 3 (768P): measured 768x1344 for 9:16.
  '768p': {
    '16:9': { height: 768, width: 1344 },
    '9:16': { height: 1344, width: 768 },
    '1:1': { height: 768, width: 768 },
    '4:3': { height: 768, width: 1024 },
    '3:4': { height: 1024, width: 768 },
    '21:9': { height: 768, width: 1792 },
  },
  '1080p': {
    '16:9': { height: 1080, width: 1920 },
    '9:16': { height: 1920, width: 1080 },
    '1:1': { height: 1080, width: 1080 },
    '4:3': { height: 1080, width: 1440 },
    '3:4': { height: 1440, width: 1080 },
    '21:9': { height: 1080, width: 2520 },
  },
}

export function resolveVideoResolutionDimensions(
  resolution: VideoResolution,
  aspectRatio: string,
): undefined | { height: number; width: number } {
  return VIDEO_RESOLUTION_DIMENSIONS[resolution][aspectRatio]
}
