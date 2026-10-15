import {
  type FactStampStripImage,
  factStampStripShadowPixels,
} from '@reelmakeeasy/common/adapters/caption/fact-stamps'

/** Strip images made on this page, by size and colour; at most this many are kept. */
const urls = new Map<string, Promise<string | undefined>>()
const MAX_URLS = 64

/**
 * A fact stamp's strip as the editor engine draws it (fact-stamps.ts, `factStampStripSeg`): the
 * strip in its colour at 1:1 over its shadow (`factStampStripShadowPixels`: the export painter's,
 * as the engine must get them), in a border that holds the shadow, as a PNG blob URL the engine
 * loads like any image.
 * Made once per size, colour and shadow. Undefined without a 2D canvas or a PNG encoder: the
 * label then keeps the engine's own box.
 */
export function factStampStripUrl(image: FactStampStripImage): Promise<string | undefined> {
  const { shadow } = image
  const shadowKey = shadow ? ` ~${shadow.offsetY},${shadow.opacity},${shadow.sigma}` : ''
  const key = `${image.width}x${image.height}+${image.border} ${image.color}${shadowKey}`
  let url = urls.get(key)
  if (!url) {
    url = drawStrip(image)
    urls.set(key, url)
    // A failure is not kept: the next plan tries again.
    void url.then((made) => {
      if (!made) urls.delete(key)
    })
    forgetOldest()
  }
  return url
}

/** Forgets (and frees) the strip images made so far. */
export function clearFactStampStripUrls(): void {
  for (const url of urls.values()) void url.then((made) => made && URL.revokeObjectURL(made))
  urls.clear()
}

function drawStrip(strip: FactStampStripImage) {
  const { border, color, height, width } = strip
  const canvas = document.createElement('canvas')
  canvas.width = width + 2 * border
  canvas.height = height + 2 * border
  const ctx = canvas.getContext('2d')
  if (!ctx) return Promise.resolve(undefined)
  const pixels = factStampStripShadowPixels(strip)
  if (pixels) {
    const image = ctx.createImageData(pixels.width, pixels.height)
    image.data.set(pixels.data)
    // Centred on the strip: the border is the shadow's margin.
    ctx.putImageData(image, border - pixels.margin, border - pixels.margin)
  }
  ctx.fillStyle = color
  ctx.fillRect(border, border, width, height)
  return new Promise<string | undefined>((resolve) => {
    canvas.toBlob((blob) => resolve(blob ? URL.createObjectURL(blob) : undefined), 'image/png')
  })
}

/** Keeps the newest MAX_URLS images: a page that recolours its stamps many times stays small. */
function forgetOldest() {
  while (urls.size > MAX_URLS) {
    const [key, url] = urls.entries().next().value as [string, Promise<string | undefined>]
    urls.delete(key)
    void url.then((made) => made && URL.revokeObjectURL(made))
  }
}
