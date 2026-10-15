import path from 'node:path'

import sharp, { type Metadata } from 'sharp'

import { resolveImageUnder } from '../agent-files'

/** A picture fitted to a keyframe: a PNG of the keyframe's exact size. */
export interface FittedPicture {
  /** What fitting did: nothing (already that size), a scale, or a scale and a crop. */
  changed: 'cropped' | 'none' | 'resized'
  height: number
  png: Buffer
  width: number
}

/** How far apart a picture's shape and the keyframe's may be for the picture to be fitted by a
 *  crop: 6%, a sliver off two edges. Further apart, the crop cuts into what the picture shows. */
const MAX_SHAPE_DRIFT = Math.log(1.06)
/** Blown up more than twice, a picture reads as blurry next to the clips made from it. */
const MAX_UPSCALE = 2
/** A cover-fit that cuts off at most this many pixels is a plain resize. */
const RESIZE_SLACK_PX = 2
const SHAPES: [number, number][] = [
  [1, 1],
  [9, 16],
  [16, 9],
  [4, 5],
  [5, 4],
  [3, 4],
  [4, 3],
  [2, 3],
  [3, 2],
]

/**
 * The picture the agent named for a keyframe, by its real path, or null. A relative path is read
 * from the agent's working folder (`frames/fixed.png`, `project/long_take/keyframes/3.png`). It
 * must lie under one of `roots`: Codex's saved images, the chat's own folder and the video's
 * project folder, so a path the agent was talked into can't send another file out.
 */
export function resolveKeyframePicture(
  image: string,
  opts: { roots: string[]; workingDir: string },
): null | string {
  const p = path.isAbsolute(image) ? image : path.resolve(opts.workingDir, image)
  return resolveImageUnder(p, opts.roots)
}

/**
 * The picture as a PNG of the keyframe's exact size: scaled to cover it, centred, and cropped
 * when its shape is a little off (at most 6%). Another shape, or a picture under half the
 * keyframe's size, is refused with the reason in plain words.
 */
export async function fitKeyframePicture(
  input: Buffer,
  frame: { height: number; width: number },
): Promise<FittedPicture | { error: string }> {
  let size: { height: number; width: number }
  try {
    size = orientedSize(await sharp(input).metadata())
  } catch {
    return { error: NOT_A_PICTURE }
  }
  const { height, width } = size
  const drift = Math.abs(Math.log(width / height / (frame.width / frame.height)))
  if (drift > MAX_SHAPE_DRIFT) {
    return {
      error: `The picture is ${width}x${height} (${shapeOf(width, height)}), but this keyframe is ${frame.width}x${frame.height} (${shapeOf(frame.width, frame.height)}): cropping it to fit would cut part of the picture away. Make it in the keyframe's shape (start from the keyframe itself) and try again.`,
    }
  }
  const scale = Math.max(frame.width / width, frame.height / height)
  if (scale > MAX_UPSCALE) {
    return {
      error: `The picture is ${width}x${height}, too small for this ${frame.width}x${frame.height} keyframe: it would look blurry. Use a picture at least ${Math.ceil(frame.width / MAX_UPSCALE)}x${Math.ceil(frame.height / MAX_UPSCALE)}.`,
    }
  }
  const png = await sharp(input)
    .rotate()
    .resize(frame.width, frame.height, { fit: 'cover', kernel: 'lanczos3', position: 'centre' })
    .png()
    .toBuffer()
  const cut = Math.max(width * scale - frame.width, height * scale - frame.height)
  const changed =
    width === frame.width && height === frame.height
      ? 'none'
      : cut <= RESIZE_SLACK_PX
        ? 'resized'
        : 'cropped'
  return { changed, height: frame.height, png, width: frame.width }
}

const NOT_A_PICTURE = "That file isn't a picture ReelMakeEasy can read (PNG, JPEG or WebP)."

/** The picture's size as it shows, its camera orientation applied. */
function orientedSize(meta: Metadata): { height: number; width: number } {
  if (!meta.width || !meta.height) throw new Error(NOT_A_PICTURE)
  const turned = (meta.orientation ?? 1) >= 5
  return turned
    ? { height: meta.width, width: meta.height }
    : { height: meta.height, width: meta.width }
}

/** The common shape nearest to `width` x `height`, as "9:16". */
function shapeOf(width: number, height: number): string {
  const ratio = Math.log(width / height)
  let best = SHAPES[0]
  for (const shape of SHAPES) {
    if (
      Math.abs(Math.log(shape[0] / shape[1]) - ratio) <
      Math.abs(Math.log(best[0] / best[1]) - ratio)
    )
      best = shape
  }
  return `${best[0]}:${best[1]}`
}
