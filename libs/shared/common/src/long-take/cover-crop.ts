/**
 * Centered cover-crop geometry for long-take transition clips.
 *
 * Image-to-video models snap their output to a fixed resolution grid, so a
 * clip generated for a 9:16 canvas can come back slightly off-ratio (e.g.
 * Seedance at 480p returns 496x864 = 0.5741 vs 9:16 = 0.5625). When such a
 * clip is composited full-frame onto the canvas the render engine preserves
 * aspect ratio and pads the gap with black, producing top/bottom bars.
 *
 * Computing a centered crop of the SOURCE that matches the canvas aspect ratio
 * (cover / crop-to-fill) makes the cropped clip fill the frame exactly, so the
 * engine never needs to pad. The trimmed amount is the ratio mismatch only
 * (~1-2% of an edge for the Seedance case), and the subject stays centered.
 *
 * This is expressed via the existing `cropAreas` source-crop path (the same
 * mechanism hooks already use), so it needs no render-engine change.
 */

/** A crop/target area in source-fraction terms (matches VideoScript `Area`). */
export interface CoverCropArea {
  frameTime: number
  mode: 'linear'
  position: { hPct: number; wPct: number; xPct: number; yPct: number }
}

const FULL_FRAME: CoverCropArea = {
  frameTime: 0,
  mode: 'linear',
  position: { hPct: 1, wPct: 1, xPct: 0, yPct: 0 },
}

// Ratio differences below this are sub-pixel at delivery size; skip the crop.
const RATIO_EPSILON = 0.001

// Zoom factor applied when cropping (1% extra) so the cropped region always
// fully covers the canvas despite rounding in the render's crop->scale.
const OVERSCAN = 0.99

/**
 * Returns a single `cropAreas` entry that center-crops a `sourceWidth` x
 * `sourceHeight` clip to the `canvasWidth` x `canvasHeight` aspect ratio.
 *
 * - source wider than canvas  -> trim left/right (wPct < 1, centered xPct)
 * - source taller than canvas -> trim top/bottom (hPct < 1, centered yPct)
 * - ratios equal (within epsilon) or any invalid input -> full frame (no-op)
 */
export function computeCoverCropArea(
  sourceWidth: number,
  sourceHeight: number,
  canvasWidth: number,
  canvasHeight: number,
): CoverCropArea {
  if (
    !Number.isFinite(sourceWidth) ||
    !Number.isFinite(sourceHeight) ||
    !Number.isFinite(canvasWidth) ||
    !Number.isFinite(canvasHeight) ||
    sourceWidth <= 0 ||
    sourceHeight <= 0 ||
    canvasWidth <= 0 ||
    canvasHeight <= 0
  ) {
    return FULL_FRAME
  }

  const sourceRatio = sourceWidth / sourceHeight
  const canvasRatio = canvasWidth / canvasHeight

  if (Math.abs(sourceRatio - canvasRatio) / canvasRatio < RATIO_EPSILON) {
    return FULL_FRAME
  }

  // Crop ~1% extra (same factor on both axes, so the canvas aspect is preserved
  // -- no distortion, just a ~0.5%-per-edge zoom). This guarantees the cropped
  // region fully covers the canvas after the render's crop->scale, so integer /
  // sub-pixel rounding can never leave a black hairline on the trimmed edge.
  const exact =
    sourceRatio > canvasRatio
      ? { hPct: 1, wPct: canvasRatio / sourceRatio } // wider: trim sides
      : { hPct: sourceRatio / canvasRatio, wPct: 1 } // taller: trim top/bottom
  const wPct = exact.wPct * OVERSCAN
  const hPct = exact.hPct * OVERSCAN
  return {
    frameTime: 0,
    mode: 'linear',
    position: { hPct, wPct, xPct: (1 - wPct) / 2, yPct: (1 - hPct) / 2 },
  }
}
