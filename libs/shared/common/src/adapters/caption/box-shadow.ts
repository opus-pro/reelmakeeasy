/**
 * A soft black shadow under a box (a fact stamp's strip), as pixels both renderers draw: the
 * export painter puts them under its box, the editor bakes them into the strip image its engine
 * loads (fact-stamps.ts, `factStampStripShadowPixels`). Canvas shadows differ between node-canvas
 * and browsers (node-canvas blurs `shadowBlur` 10 to about a 6 px Gaussian, a browser to a 5 px
 * one), so neither renderer draws its own.
 */
export interface CaptionBoxShadow {
  /** How far it drops below the box, px. */
  offsetY: number
  /** How dark it is where it is solid: black at this opacity (0 to 1). */
  opacity: number
  /** How soft its edges are: the blur's standard deviation, px. */
  sigma: number
}

/** The shadow pixels around a `w` x `h` box: RGBA, `margin` px wider than the box each side. */
export interface BoxShadowPixels {
  data: Uint8ClampedArray
  height: number
  margin: number
  width: number
}

/** How far past the box its shadow can show: its drop plus three of its sigmas, and 1 px. */
export function boxShadowMargin(shadow: CaptionBoxShadow): number {
  return Math.ceil(3 * shadow.sigma + Math.abs(shadow.offsetY)) + 1
}

/**
 * `shadow` around a `w` x `h` box, the box `margin` px in from the image's top left: the box
 * moved `offsetY` down and blurred (a Gaussian, worked out at each pixel's centre), in black at
 * `opacity`. Under the box too, so the box's edges blend into it as they would over a shadow.
 */
export function boxShadowPixels(
  box: { h: number; w: number },
  shadow: CaptionBoxShadow,
): BoxShadowPixels {
  const margin = boxShadowMargin(shadow)
  const width = Math.ceil(box.w) + 2 * margin
  const height = Math.ceil(box.h) + 2 * margin
  // A blurred box is the product of its blurred edges across and down.
  const across = blurredSpan(width, margin, margin + box.w, shadow.sigma)
  const down = blurredSpan(
    height,
    margin + shadow.offsetY,
    margin + shadow.offsetY + box.h,
    shadow.sigma,
  )
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      data[(y * width + x) * 4 + 3] = Math.round(255 * shadow.opacity * across[x] * down[y])
    }
  }
  return { data, height, margin, width }
}

/** How much of [from, to] each of `size` pixels sees once blurred by `sigma`, at its centre. */
function blurredSpan(size: number, from: number, to: number, sigma: number): number[] {
  return Array.from({ length: size }, (_, i) => {
    const centre = i + 0.5
    return normalCdf((centre - from) / sigma) - normalCdf((centre - to) / sigma)
  })
}

const normalCdf = (z: number) => 0.5 * (1 + erf(z / Math.SQRT2))

/** The error function (Abramowitz and Stegun 7.1.26, within 1.5e-7). */
function erf(x: number): number {
  const sign = Math.sign(x)
  const a = Math.abs(x)
  const t = 1 / (1 + 0.3275911 * a)
  const poly =
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t
  return sign * (1 - poly * Math.exp(-a * a))
}
