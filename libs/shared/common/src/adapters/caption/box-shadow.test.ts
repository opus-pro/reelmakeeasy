import { createCanvas } from 'canvas'

import { boxShadowMargin, boxShadowPixels } from './box-shadow'

/** The fact stamps' shadow on a 1080-wide frame, and a stamp strip ('27th letter'). */
const SHADOW = { offsetY: 4, opacity: 0.3, sigma: 6 }
const BOX = { h: 76, w: 308 }

const alphaAt = (pixels: ReturnType<typeof boxShadowPixels>, x: number, y: number) =>
  pixels.data[(y * pixels.width + x) * 4 + 3]

describe('boxShadowPixels', () => {
  it('is the box with room for its shadow on every side: the drop plus three sigmas', () => {
    expect(boxShadowMargin(SHADOW)).toBe(23)
    const pixels = boxShadowPixels(BOX, SHADOW)
    expect(pixels).toMatchObject({ height: 76 + 2 * 23, margin: 23, width: 308 + 2 * 23 })
    expect(pixels.data).toHaveLength(354 * 122 * 4)
  })

  it('is black, at its opacity where it is solid, and clear at the image edges', () => {
    const pixels = boxShadowPixels(BOX, SHADOW)
    const { data, height, width } = pixels
    const colours = new Set<string>()
    for (let i = 0; i < data.length; i += 4) colours.add(`${data[i]},${data[i + 1]},${data[i + 2]}`)
    expect([...colours]).toEqual(['0,0,0'])
    // Under the middle of the box: 30% black (76.5 of 255).
    expect(Math.abs(alphaAt(pixels, width / 2, height / 2) - 0.3 * 255)).toBeLessThanOrEqual(0.5)
    const edges = new Set<number>()
    for (let x = 0; x < width; x++) {
      edges.add(alphaAt(pixels, x, 0)).add(alphaAt(pixels, x, height - 1))
    }
    for (let y = 0; y < height; y++) {
      edges.add(alphaAt(pixels, 0, y)).add(alphaAt(pixels, width - 1, y))
    }
    expect([...edges]).toEqual([0])
  })

  it('is even left and right, and reaches further below the box than above it', () => {
    const pixels = boxShadowPixels(BOX, SHADOW)
    const { margin, width } = pixels
    for (let d = 0; d < margin; d++) {
      const y = margin + BOX.h / 2
      expect(alphaAt(pixels, margin - 1 - d, y)).toBe(alphaAt(pixels, width - margin + d, y))
      const x = width / 2
      expect(alphaAt(pixels, x, margin + BOX.h + d)).toBeGreaterThanOrEqual(
        alphaAt(pixels, x, margin - 1 - d),
      )
    }
    // 4 px down: a few px below the box it is still dark, above it nearly gone.
    expect(alphaAt(pixels, width / 2, margin + BOX.h + 2)).toBeGreaterThan(35)
    expect(alphaAt(pixels, width / 2, margin - 3)).toBeLessThan(25)
  })

  it.each([
    [308, 76],
    [495, 70],
    [200, 50],
  ])(
    'falls off around a %i x %i strip as the drawn stamps shadow did (node-canvas: black at 30%%, blur 10, 4 px down)',
    (w, h) => {
      const pixels = boxShadowPixels({ h, w }, SHADOW)
      const { margin } = pixels
      // The PNG stamps' shadow alone: the strip drawn off the canvas, its shadow moved back in.
      const canvas = createCanvas(pixels.width, pixels.height)
      const ctx = canvas.getContext('2d')
      ctx.shadowColor = 'rgba(0, 0, 0, 0.3)'
      ctx.shadowBlur = 10
      ctx.shadowOffsetX = 4000
      ctx.shadowOffsetY = 4
      ctx.fillRect(margin - 4000, margin, w, h)
      const drawn = ctx.getImageData(0, 0, canvas.width, canvas.height).data
      let worst = 0
      for (let y = 0; y < pixels.height; y++) {
        for (let x = 0; x < pixels.width; x++) {
          // Under the strip the shadow is hidden.
          const under = x >= margin && x < margin + w && y >= margin && y < margin + h
          if (under) continue
          const i = (y * pixels.width + x) * 4 + 3
          worst = Math.max(worst, Math.abs(pixels.data[i] - drawn[i]))
        }
      }
      // Out of 255: at most 2% black apart, where the shadow meets the strip's corners.
      expect(worst).toBeLessThanOrEqual(6)
    },
  )

  it('scales with the frame: smaller and softer on a 720-wide one', () => {
    const scale = 720 / 1080
    const shadow = { offsetY: 4 * scale, opacity: 0.3, sigma: 6 * scale }
    expect(boxShadowMargin(shadow)).toBe(Math.ceil(3 * 4 + 4 * scale) + 1)
    const pixels = boxShadowPixels({ h: 50, w: 205 }, shadow)
    expect(pixels.width).toBe(205 + 2 * pixels.margin)
  })
})
