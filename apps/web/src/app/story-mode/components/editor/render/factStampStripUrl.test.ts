import {
  type FactStampStripImage,
  factStampStripShadowPixels,
} from '@reelmakeeasy/common/adapters/caption/fact-stamps'

import { clearFactStampStripUrls, factStampStripUrl } from './factStampStripUrl'

const SHADOW = { offsetY: 4, opacity: 0.3, sigma: 6 }
const IMAGE: FactStampStripImage = {
  border: 23,
  color: '#04f827',
  height: 76,
  shadow: SHADOW,
  width: 308,
}

describe('factStampStripUrl', () => {
  // What each canvas drew: its size, and each rectangle filled with its colour or image put.
  let drawn: Array<
    | { at: number[]; canvas: [number, number]; pixels: Uint8ClampedArray }
    | { canvas: [number, number]; fill: string; rect: number[] }
  >
  let has2d: boolean
  let made: number

  beforeEach(() => {
    clearFactStampStripUrls()
    drawn = []
    has2d = true
    made = 0
    jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
      this: HTMLCanvasElement,
    ) {
      if (!has2d) return null
      const size: [number, number] = [this.width, this.height]
      const context = {
        createImageData: (w: number, h: number) => ({
          data: new Uint8ClampedArray(w * h * 4),
          height: h,
          width: w,
        }),
        fillRect: (...rect: number[]) =>
          drawn.push({ canvas: size, fill: context.fillStyle, rect }),
        fillStyle: '',
        putImageData: (image: { data: Uint8ClampedArray }, ...at: number[]) =>
          drawn.push({ at, canvas: size, pixels: image.data }),
      }
      return context
    } as unknown as HTMLCanvasElement['getContext'])
    jest
      .spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation((done: BlobCallback, type?: string) =>
        done(new Blob(['png'], { type: type ?? '' })),
      )
    URL.createObjectURL = jest.fn(() => `blob:http://localhost:3000/strip-${++made}`)
    URL.revokeObjectURL = jest.fn()
  })

  afterEach(() => jest.restoreAllMocks())

  it('draws the strip at 1:1 in its colour over its shadow, as a PNG blob URL', async () => {
    await expect(factStampStripUrl(IMAGE)).resolves.toBe('blob:http://localhost:3000/strip-1')
    // The shadow first (as the engine must get it to show the painter's), then the strip.
    expect(drawn).toEqual([
      { at: [0, 0], canvas: [354, 122], pixels: factStampStripShadowPixels(IMAGE)?.data },
      { canvas: [354, 122], fill: '#04f827', rect: [23, 23, 308, 76] },
    ])
    expect(HTMLCanvasElement.prototype.toBlob).toHaveBeenCalledWith(
      expect.any(Function),
      'image/png',
    )
  })

  it('makes one image per size and colour', async () => {
    const first = await factStampStripUrl(IMAGE)
    expect(await factStampStripUrl({ ...IMAGE })).toBe(first)
    expect(await factStampStripUrl({ ...IMAGE, color: '#ffe500' })).not.toBe(first)
    expect(await factStampStripUrl({ ...IMAGE, width: 310 })).not.toBe(first)
    expect(await factStampStripUrl({ ...IMAGE, shadow: { ...SHADOW, offsetY: 3 } })).not.toBe(first)
    expect(made).toBe(4)
  })

  it('draws a strip without a shadow in a clear border', async () => {
    await factStampStripUrl({ border: 1, color: '#04f827', height: 76, width: 308 })
    expect(drawn).toEqual([{ canvas: [310, 78], fill: '#04f827', rect: [1, 1, 308, 76] }])
  })

  it('makes none without a 2D canvas, and tries again next time', async () => {
    has2d = false
    await expect(factStampStripUrl(IMAGE)).resolves.toBeUndefined()
    has2d = true
    await expect(factStampStripUrl(IMAGE)).resolves.toBe('blob:http://localhost:3000/strip-1')
  })

  it('makes none when the canvas gives no PNG', async () => {
    jest.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation((done) => done(null))
    await expect(factStampStripUrl(IMAGE)).resolves.toBeUndefined()
  })
})
