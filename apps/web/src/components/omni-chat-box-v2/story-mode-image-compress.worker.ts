/// <reference lib="webworker" />

export type CompressionWorkerRequest = {
  file: Blob
  initialQuality: number
  maxBytes: number
  maxDimension: number
  mimeType: 'image/jpeg' | 'image/webp'
  minQuality: number
  qualityStep: number
}

type CompressionWorkerResponse = { blob: Blob } | { error: 'compression_failed' | 'unsupported' }

const respond = (message: CompressionWorkerResponse) => {
  self.postMessage(message)
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** Minimum side length when scaling down to get under maxBytes; avoids infinite loop. */
const MIN_DIMENSION = 64
/** Scale factor per downscale pass when quality reduction alone is insufficient. */
const DOWNSCALE_FACTOR = 0.75

function isValidRequest(data: unknown): data is CompressionWorkerRequest {
  if (!data || typeof data !== 'object' || !(data as Record<string, unknown>).file) {
    return false
  }
  const d = data as Record<string, unknown>
  const maxBytes = d.maxBytes as number
  const maxDimension = d.maxDimension as number
  return (
    d.file instanceof Blob &&
    typeof d.initialQuality === 'number' &&
    typeof maxBytes === 'number' &&
    maxBytes > 0 &&
    typeof maxDimension === 'number' &&
    maxDimension >= 1 &&
    (d.mimeType === 'image/jpeg' || d.mimeType === 'image/webp') &&
    typeof d.minQuality === 'number' &&
    typeof d.qualityStep === 'number'
  )
}

self.onmessage = async (event: MessageEvent<CompressionWorkerRequest>) => {
  try {
    if (typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') {
      respond({ error: 'unsupported' })
      return
    }

    if (!isValidRequest(event.data)) {
      respond({ error: 'compression_failed' })
      return
    }

    const { file, initialQuality, maxBytes, maxDimension, mimeType, minQuality, qualityStep } =
      event.data

    const imageBitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
    let width = imageBitmap.width
    let height = imageBitmap.height
    const maxSide = Math.max(width, height)
    const initialScale = maxSide > maxDimension ? maxDimension / maxSide : 1
    width = Math.max(1, Math.round(width * initialScale))
    height = Math.max(1, Math.round(height * initialScale))

    let canvas: OffscreenCanvas = new OffscreenCanvas(width, height)
    let context = canvas.getContext('2d')
    if (!context) {
      imageBitmap.close()
      respond({ error: 'compression_failed' })
      return
    }

    context.drawImage(imageBitmap, 0, 0, width, height)
    imageBitmap.close()

    let quality = clamp(initialQuality, minQuality, 1)
    let blob = await canvas.convertToBlob({ type: mimeType, quality })

    while (blob.size > maxBytes && quality > minQuality) {
      quality = clamp(quality - qualityStep, minQuality, 1)
      blob = await canvas.convertToBlob({ type: mimeType, quality })
    }

    // If still over limit, scale down and retry until under maxBytes or hit min dimension
    while (blob.size > maxBytes && width >= MIN_DIMENSION && height >= MIN_DIMENSION) {
      const nextWidth = Math.max(MIN_DIMENSION, Math.round(width * DOWNSCALE_FACTOR))
      const nextHeight = Math.max(MIN_DIMENSION, Math.round(height * DOWNSCALE_FACTOR))
      const nextCanvas = new OffscreenCanvas(nextWidth, nextHeight)
      const nextContext = nextCanvas.getContext('2d')
      if (!nextContext) {
        break
      }
      nextContext.drawImage(canvas, 0, 0, width, height, 0, 0, nextWidth, nextHeight)
      canvas = nextCanvas
      context = nextContext
      width = nextWidth
      height = nextHeight
      quality = clamp(initialQuality, minQuality, 1)
      blob = await canvas.convertToBlob({ type: mimeType, quality })
      while (blob.size > maxBytes && quality > minQuality) {
        quality = clamp(quality - qualityStep, minQuality, 1)
        blob = await canvas.convertToBlob({ type: mimeType, quality })
      }
    }

    if (blob.size > maxBytes) {
      respond({ error: 'compression_failed' })
      return
    }

    respond({ blob })
  } catch {
    respond({ error: 'compression_failed' })
  }
}
