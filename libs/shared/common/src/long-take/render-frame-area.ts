import type { AspectRatio } from '../media/types'
import { resolveVideoResolutionDimensions } from '../veo3/video-resolution'

import { computeCoverCropArea } from './cover-crop'

// 9:16 1080p, the story-mode default. Used only if an aspect ratio somehow has
// no dimension entry (unreachable for the 1:1/9:16/16:9 AspectRatio union).
const DEFAULT_DELIVERY_CANVAS = { height: 1920, width: 1080 }

/**
 * The delivered video dimensions for an aspect ratio: the 1080p canvas. It must
 * equal the render service's `OUTPUT_SIZE_BY_RATIO`; sourced from
 * `VIDEO_RESOLUTION_DIMENSIONS['1080p']`, which matches it for 1:1 / 9:16 / 16:9.
 */
export function getDeliveryCanvasSize(aspectRatio?: AspectRatio): {
  height: number
  width: number
} {
  return resolveVideoResolutionDimensions('1080p', aspectRatio ?? '9:16') ?? DEFAULT_DELIVERY_CANVAS
}

export function buildFullFrameArea() {
  return {
    frameTime: 0,
    mode: 'linear' as const,
    position: {
      hPct: 1,
      wPct: 1,
      xPct: 0,
      yPct: 0,
    },
  }
}

/**
 * Crop area for a transition clip: center-crop to the target canvas
 * aspect ratio (crop-to-fill) when the clip dims and canvas are known, else
 * full frame. Keeps off-9:16 model output from being letterboxed.
 */
export function buildClipCropArea(
  segment: { videoHeight?: number; videoWidth?: number },
  targetCanvas?: { height: number; width: number },
) {
  if (segment.videoWidth && segment.videoHeight && targetCanvas) {
    return computeCoverCropArea(
      segment.videoWidth,
      segment.videoHeight,
      targetCanvas.width,
      targetCanvas.height,
    )
  }
  return buildFullFrameArea()
}

/**
 * ffmpeg `-vf` that center-crops a frame to the `canvas` aspect ratio, then
 * scales it to 360px wide. Keeps an off-9:16 source clip
 * from producing an off-ratio poster that the 9:16 UI letterboxes; a frame
 * already at the ratio is a no-op crop.
 */
export function buildThumbnailVf(canvas: { height: number; width: number }): string {
  const r = canvas.width / canvas.height
  return `crop='if(gt(a,${r}),ih*${r},iw)':'if(gt(a,${r}),ih,iw/${r})',scale=360:-1`
}
