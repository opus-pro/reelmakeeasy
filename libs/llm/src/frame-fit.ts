import sharp from 'sharp'

/** Aspect ratios further apart than this are not the same shape (15%). */
const MAX_ASPECT_DRIFT = Math.log(1.15)

function decodeDataUri(uri: string): Buffer {
  const comma = uri.indexOf(',')
  if (!uri.startsWith('data:') || comma === -1) throw new Error('Expected a base64 data URI')
  return Buffer.from(uri.slice(comma + 1), 'base64')
}

/** Width and height of a data-URI image. */
export async function imageSizeOf(uri: string): Promise<{ height: number; width: number }> {
  const { height, width } = await sharp(decodeDataUri(uri)).metadata()
  if (!width || !height) throw new Error('Could not read the image size')
  return { height, width }
}

/**
 * Scales a data-URI image to cover exactly `width` x `height` and crops the
 * overflow evenly from both sides. Returns the input unchanged when it is
 * already that size.
 */
export async function fitImageToSize(uri: string, width: number, height: number): Promise<string> {
  const input = decodeDataUri(uri)
  const meta = await sharp(input).metadata()
  if (meta.width === width && meta.height === height) return uri
  const png = await sharp(input)
    .resize(width, height, { fit: 'cover', kernel: 'lanczos3', position: 'centre' })
    .png()
    .toBuffer()
  return `data:image/png;base64,${png.toString('base64')}`
}

/**
 * The frame size in `sizes` ({"9:16": [768, 1344], ...}) closest in shape to
 * `width` x `height`, or undefined when none is within 15%.
 */
export function nearestFrameSize(
  sizes: Record<string, [number, number]>,
  width: number,
  height: number,
): [number, number] | undefined {
  const target = Math.log(width / height)
  let best: undefined | { drift: number; size: [number, number] }
  for (const size of Object.values(sizes)) {
    const drift = Math.abs(Math.log(size[0] / size[1]) - target)
    if (!best || drift < best.drift) best = { drift, size }
  }
  return best && best.drift <= MAX_ASPECT_DRIFT ? best.size : undefined
}
