import * as fs from 'node:fs'
import * as path from 'node:path'

import { type Canvas, type CanvasRenderingContext2D, createCanvas, registerFont } from 'canvas'

import { logger } from '../../logger'

import { boxShadowPixels } from './box-shadow'
import {
  type CaptionBox,
  type CaptionFrame,
  captionFrameAt,
  captionFrameKey,
  type CaptionLayoutSegment,
  type CaptionMeasureText,
  type CaptionSegmentLayout,
  FILL_POP,
  layoutCaptionSegment,
} from './caption-layout'

/**
 * Burns Story Mode captions without libass: ffmpeg builds commonly ship without
 * any text filter, so the caption states are drawn with node-canvas and fed to
 * ffmpeg as one image-sequence stream (concat demuxer) to overlay.
 *
 * Layout and animation come from the shared caption-layout module, which follows
 * the editor engine: the caption is sampled once per output frame, and frames
 * whose caption is unchanged share one image. A word's fill-pop pulse therefore
 * costs a few images (160 ms of frames), the rest of the word one. A preset's boxes
 * are filled under the text, and a turned caption is drawn turned about its centre.
 */

export interface CaptionOverlay {
  /** ffmpeg input args for the caption stream. */
  inputArgs: string[]
  /** Top edge of the caption strip in the output frame. */
  y: number
}

export type CaptionSegment = CaptionLayoutSegment

/** Weights by the suffix the render font pack names its files with (`PTSerif-Bold.ttf`). */
const FONT_FILE_WEIGHT: Record<string, number> = {
  Black: 900,
  Bold: 700,
  ExtraBold: 800,
  ExtraLight: 200,
  Light: 300,
  Medium: 500,
  Regular: 400,
  SemiBold: 600,
  Thin: 100,
}
const FONT_FILE_STYLE = new RegExp(`^(${Object.keys(FONT_FILE_WEIGHT).join('|')})?(Italic)?$`)

/** A face file in a font folder. */
export interface CaptionFontFace {
  file: string
  italic: boolean
  weight: number
}

/** Each registered font file and the family it was registered under (node-canvas keeps one). */
const registered = new Map<string, string>()

export interface CaptionPainter {
  /** Draws one segment's caption texture (unscaled, unturned) for `frame`. */
  drawTexture(layout: CaptionSegmentLayout, frame: CaptionFrame): Canvas
  measure: CaptionMeasureText
  /**
   * Composites a texture onto `ctx`, whose origin is `originY` px below the frame top: turned
   * by the frame's rotation (degrees, clockwise) about the caption centre, then scaled.
   */
  place(
    ctx: CanvasRenderingContext2D,
    layout: CaptionSegmentLayout,
    frame: CaptionFrame,
    originY: number,
  ): void
}

/** A font file name's family (spaces dropped), weight and style, as the render pack names them. */
function parseFontFile(file: string) {
  const stem = file.match(/^(.+)\.(?:otf|ttf)$/i)?.[1]
  if (!stem) return undefined
  const dash = stem.lastIndexOf('-')
  const style = dash > 0 ? stem.slice(dash + 1).match(FONT_FILE_STYLE) : null
  if (!style?.[0]) {
    // No weight in the name: a variable font (`Inter.ttf`) or a lone face.
    return { family: compactFamily(stem), italic: false, named: false, weight: 400 }
  }
  return {
    family: compactFamily(stem.slice(0, dash)),
    italic: Boolean(style[2]),
    named: true,
    weight: FONT_FILE_WEIGHT[style[1] ?? 'Regular'],
  }
}

const compactFamily = (family: string) => family.replaceAll(/\s+/g, '').toLowerCase()

/**
 * The file in `files` (a font folder's listing) for a family, weight and style: the family's name
 * without spaces ("PT Serif" 700 is `PTSerif-Bold.ttf`), the italic face when there is one, and the
 * nearest weight the folder has, the heavier one on a tie (Montserrat has no Regular, so 400 gets
 * Light). Undefined when the folder has no face of the family.
 */
export function captionFontFile(
  files: readonly string[],
  font: { family: string; italic: boolean; weight: number },
): CaptionFontFace | undefined {
  const family = compactFamily(font.family)
  const faces = files.flatMap((file) => {
    const face = parseFontFile(file)
    return face?.family === family ? [{ ...face, file }] : []
  })
  const styled = faces.filter((f) => f.italic === font.italic)
  const best = (styled.length ? styled : faces).sort(
    (a, b) =>
      Math.abs(a.weight - font.weight) - Math.abs(b.weight - font.weight) ||
      b.weight - a.weight ||
      Number(b.named) - Number(a.named) ||
      a.file.localeCompare(b.file),
  )[0]
  return best && { file: best.file, italic: best.italic, weight: best.weight }
}

/**
 * Registers the font folder's face for `font` once (see `captionFontFile`) and returns the family
 * to draw with, or the system sans-serif when the folder has no face of it. A face is registered
 * under its own weight and style, so node-canvas picks the nearest registered face for any other
 * weight of the family, as it would for a missing one. Another spelling of a registered family
 * ("ptserif" after "PT Serif") draws with the name the face was registered under.
 */
function registerPlanFont(
  fontsDir: string,
  files: readonly string[],
  font: { family: string; italic: boolean; weight: number },
): string {
  const face = captionFontFile(files, font)
  if (!face) {
    logger.warn(
      `[render] Caption font not found: ${font.family} ${font.weight} in ${fontsDir}; using the system sans-serif`,
    )
    return 'sans-serif'
  }
  const file = path.join(fontsDir, face.file)
  const family = registered.get(file)
  if (family) return family
  registerFont(file, {
    family: font.family,
    style: face.italic ? 'italic' : 'normal',
    weight: String(face.weight),
  })
  registered.set(file, font.family)
  return font.family
}

/** node-canvas measuring and drawing for the caption layout, with the plan's fonts. */
export function createCaptionPainter(fontsDir: string): CaptionPainter {
  let files: string[] | undefined
  const families = new Map<string, string>()
  const familyOf = (font: { family: string; italic: boolean; weight: number }) => {
    const key = `${font.family}|${font.weight}|${font.italic}`
    let resolved = families.get(key)
    if (!resolved) {
      files ??= fs.existsSync(fontsDir) ? fs.readdirSync(fontsDir) : []
      resolved = registerPlanFont(fontsDir, files, font)
      families.set(key, resolved)
    }
    return resolved
  }
  const cssFont = (font: { family: string; italic: boolean; px: number; weight: number }) =>
    `${font.italic ? 'italic ' : ''}${font.weight} ${font.px}px "${familyOf(font)}"`

  const measureCtx = createCanvas(1, 1).getContext('2d')
  measureCtx.textBaseline = 'top'
  const metrics = new Map<string, ReturnType<CaptionMeasureText>>()
  const measure: CaptionMeasureText = (text, font) => {
    const css = cssFont(font)
    const key = `${css}\n${text}`
    let m = metrics.get(key)
    if (!m) {
      measureCtx.font = css
      const r = measureCtx.measureText(text)
      // With textBaseline 'top', node-canvas reports the line box bottom as emHeightDescent and
      // minus the font ascent as alphabeticBaseline.
      m = { ascent: -r.alphabeticBaseline, height: r.emHeightDescent, width: r.width }
      metrics.set(key, m)
    }
    return m
  }

  const drawTexture = (layout: CaptionSegmentLayout, frame: CaptionFrame): Canvas => {
    const { paint, texture } = layout
    const canvas = createCanvas(texture.width, texture.height)
    const ctx = canvas.getContext('2d')
    // The boxes go under the text, without the text's shadow (the engine draws none on them); a
    // fact stamp's strip over its own.
    for (const box of frame.boxes) {
      if (box.shadow) drawBoxShadow(ctx, box)
      ctx.fillStyle = box.color
      roundedRect(ctx, box)
      ctx.fill()
    }
    ctx.textAlign = 'left'
    ctx.textBaseline = 'top'
    ctx.lineJoin = 'round'
    for (const word of frame.words) {
      ctx.font = cssFont({ ...layout.font, px: word.px })
      // The engine shadows both the outline and the fill.
      ctx.shadowColor = paint.shadow?.color ?? 'transparent'
      ctx.shadowBlur = paint.shadow?.blur ?? 0
      ctx.shadowOffsetX = paint.shadow?.offsetX ?? 0
      ctx.shadowOffsetY = paint.shadow?.offsetY ?? 0
      if (paint.stroke) {
        ctx.strokeStyle = paint.stroke.color
        ctx.lineWidth = paint.stroke.width
        ctx.strokeText(word.text, word.x, word.y)
      }
      ctx.fillStyle = word.color
      ctx.fillText(word.text, word.x, word.y)
    }
    return canvas
  }

  // The pulse frames of a word differ only in scale (a turn only in angle): draw their texture
  // once.
  let last: undefined | { canvas: Canvas; key: string; layout: CaptionSegmentLayout }
  const textureFor = (layout: CaptionSegmentLayout, frame: CaptionFrame) => {
    const key = captionFrameKey({ ...frame, rotate: 0, scaleX: 1, scaleY: 1 })
    if (last?.layout !== layout || last.key !== key) {
      last = { canvas: drawTexture(layout, frame), key, layout }
    }
    return last.canvas
  }

  const place: CaptionPainter['place'] = (ctx, layout, frame, originY) => {
    const { texture } = layout
    if (frame.rotate) {
      ctx.save()
      ctx.translate(texture.centerX, texture.centerY - originY)
      ctx.rotate((frame.rotate * Math.PI) / 180)
      ctx.scale(frame.scaleX, frame.scaleY)
      ctx.drawImage(textureFor(layout, frame), -texture.width / 2, -texture.height / 2)
      ctx.restore()
      return
    }
    const width = texture.width * frame.scaleX
    const height = texture.height * frame.scaleY
    ctx.drawImage(
      textureFor(layout, frame),
      Math.round(texture.centerX - width / 2),
      Math.round(texture.centerY - height / 2) - originY,
      width,
      height,
    )
  }

  return { drawTexture, measure, place }
}

/**
 * The segment as the engine keeps it: loading a caption, it ends each word where the next one
 * starts and drops a word that is left with no time, one the next word starts with (checked on
 * the editor engine). The last word is held past its end, so it always stays.
 */
export function withoutZeroDurationWords(segment: CaptionSegment): CaptionSegment {
  const { texts } = segment
  const kept = texts.filter((word, i) => i === texts.length - 1 || texts[i + 1].in !== word.in)
  return kept.length === texts.length ? segment : { ...segment, texts: kept }
}

/**
 * `box`'s shadow under it (boxShadowPixels, which the editor's strip image is made from too), put
 * where the box is, so it moves with it as the image's does.
 */
function drawBoxShadow(ctx: CanvasRenderingContext2D, box: CaptionBox): void {
  if (!box.shadow) return
  const pixels = boxShadowPixels(box, box.shadow)
  const image = createCanvas(pixels.width, pixels.height)
  const imageCtx = image.getContext('2d')
  const data = imageCtx.createImageData(pixels.width, pixels.height)
  data.data.set(pixels.data)
  imageCtx.putImageData(data, 0, 0)
  ctx.drawImage(image, box.x - pixels.margin, box.y - pixels.margin)
}

/** A rounded rectangle path (cairo's arcs, as the engine's `fillRectRounded`). */
function roundedRect(ctx: CanvasRenderingContext2D, { h, radius, w, x, y }: CaptionBox): void {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arc(x + w - r, y + r, r, -Math.PI / 2, 0)
  ctx.arc(x + w - r, y + h - r, r, 0, Math.PI / 2)
  ctx.arc(x + r, y + h - r, r, Math.PI / 2, Math.PI)
  ctx.arc(x + r, y + r, r, Math.PI, (3 * Math.PI) / 2)
  ctx.closePath()
}

/**
 * Half the height a texture can cover: scaled, and for a turned caption the rotated extent
 * (w sin + h cos, at most w sin + h) up to its largest turn.
 */
function reachY({ preset, scale, texture, turn }: CaptionSegmentLayout): number {
  const scaleY = Math.max(1, scale[1])
  if (!turn) return (texture.height * scaleY) / 2
  const scaleX = Math.max(1, scale[0]) * (preset === 'fill-pop' ? FILL_POP.lineStretchFrom : 1)
  const sin = Math.sin((Math.min(turn, 90) * Math.PI) / 180)
  return (texture.width * scaleX * sin + texture.height * scaleY) / 2
}

/** The rows of the frame any caption can cover, so every image shares one strip. */
export function captionStripBounds(layouts: CaptionSegmentLayout[], frameHeight: number) {
  let top = frameHeight
  let bottom = 0
  for (const layout of layouts) {
    const { texture } = layout
    const half = reachY(layout)
    top = Math.min(top, Math.floor(texture.centerY - half))
    bottom = Math.max(bottom, Math.ceil(texture.centerY + half))
  }
  top = Math.max(0, top)
  bottom = Math.min(frameHeight, bottom)
  return bottom > top ? { height: bottom - top, top } : undefined
}

/** `fps` as an exact ffmpeg rational: 30 -> "30", 29.97... -> "30000/1001". */
export function frameRateRational(fps: number): string {
  if (Number.isInteger(fps)) return String(fps)
  const ntsc = Math.round(fps * 1.001)
  if (Math.abs(fps * 1.001 - ntsc) < 1e-6) return `${ntsc * 1000}/1001`
  return `${Math.round(fps * 1e6)}/1000000`
}

// PNG encodes run on the libuv pool; this many may be in flight at once.
const MAX_PENDING_WRITES = 4

/**
 * Draws every caption state into `workDir` and returns the ffmpeg input for the
 * resulting caption stream, or undefined when there is nothing to draw.
 *
 * Asynchronous so a long caption track does not block the API process (workflows run in it):
 * PNG encoding and file writes run off the event loop, and the loop yields between frames.
 */
export async function buildCaptionOverlay(options: {
  fontsDir: string
  /** Output frame rate: the caption is sampled once per frame. */
  fps: number
  frame: { height: number; width: number }
  /**
   * Drawn in order of `in`, and segments that start together in the order given: a backing
   * strip (Explainer's paper) goes before the caption drawn on it.
   */
  segments: CaptionSegment[]
  /** Only [start, end] ms is rendered: frames outside it get no caption. */
  timeRangeMs?: [number, number]
  totalSec: number
  workDir: string
}): Promise<CaptionOverlay | undefined> {
  const { fps, frame, workDir } = options
  const segments = options.segments
    .filter((s) => s.texts.length > 0 && s.out > s.in)
    .map(withoutZeroDurationWords)
    .sort((a, b) => a.in - b.in)
  if (!segments.length) return undefined

  const painter = createCaptionPainter(options.fontsDir)
  const layouts = segments.map((s) => layoutCaptionSegment(s, frame, painter.measure))
  const strip = captionStripBounds(layouts, frame.height)
  if (!strip) return undefined

  await fs.promises.mkdir(workDir, { recursive: true })
  const files = new Map<string, string>()
  const pending = new Set<Promise<void>>()
  // A write that fails is recorded here, not left to Set membership: `.finally` drops a
  // settled write from `pending` before any race/all could see its rejection.
  let writeError: unknown
  const imageFor = async (key: string, visible: Array<[CaptionSegmentLayout, CaptionFrame]>) => {
    let file = files.get(key)
    if (file) return file
    file = path.join(workDir, `c${files.size}.png`)
    files.set(key, file)
    const canvas = createCanvas(frame.width, strip.height)
    const ctx = canvas.getContext('2d')
    for (const [layout, state] of visible) painter.place(ctx, layout, state, strip.top)
    const target = file
    const write: Promise<void> = encodePng(canvas)
      .then((png) => fs.promises.writeFile(target, png))
      .catch((error: unknown) => {
        writeError ??= error
      })
      .finally(() => pending.delete(write))
    pending.add(write)
    if (pending.size >= MAX_PENDING_WRITES) await Promise.race(pending)
    if (writeError) throw writeError
    return file
  }

  // One entry per run of frames showing the same caption.
  const entries: Array<{ file: string; frames: number }> = []
  const totalFrames = Math.max(1, Math.ceil(options.totalSec * fps - 1e-6))
  const [rangeStart, rangeEnd] = options.timeRangeMs ?? [0, 0]
  const inRange = (timeMs: number) =>
    rangeEnd <= rangeStart || (timeMs >= rangeStart - 1000 / fps && timeMs <= rangeEnd)
  let segFrom = 0
  for (let f = 0; f < totalFrames; f++) {
    const timeMs = (f * 1000) / fps
    while (segFrom < layouts.length && layouts[segFrom].segment.out <= timeMs) segFrom++
    const visible: Array<[CaptionSegmentLayout, CaptionFrame]> = []
    const keys: string[] = []
    const until = inRange(timeMs) ? layouts.length : segFrom
    for (let i = segFrom; i < until && layouts[i].segment.in <= timeMs; i++) {
      const state = captionFrameAt(layouts[i], timeMs, painter.measure)
      if (!state) continue
      visible.push([layouts[i], state])
      keys.push(`${i}=${captionFrameKey(state)}`)
    }
    const file = await imageFor(keys.join('\n'), visible)
    const last = entries.at(-1)
    if (last?.file === file) last.frames++
    else entries.push({ file, frames: 1 })
    // Let other work run between frames that drew nothing new.
    if (f % 256 === 255) await new Promise<void>((resolve) => setImmediate(resolve))
  }
  await Promise.all(pending)
  if (writeError) throw writeError

  // Without a per-file frame rate the concat demuxer times each image at 1/25 s and pushes
  // 30 fps entries onto that grid (duplicated or dropped steps); `option framerate` keeps the
  // durations exact. The last file is repeated so its duration is honoured.
  const rate = `option framerate ${frameRateRational(fps)}`
  const lastFile = entries[entries.length - 1].file
  const list = [
    'ffconcat version 1.0',
    ...entries.flatMap((e) => [
      `file '${e.file}'`,
      rate,
      `duration ${(e.frames / fps).toFixed(6)}`,
    ]),
    `file '${lastFile}'`,
    rate,
  ].join('\n')
  const listFile = path.join(workDir, 'captions.ffconcat')
  await fs.promises.writeFile(listFile, list)
  logger.info(
    { frames: totalFrames, images: files.size, segments: layouts.length },
    '[render] Caption images drawn',
  )
  return { inputArgs: ['-f', 'concat', '-safe', '0', '-i', listFile], y: strip.top }
}

function encodePng(canvas: Canvas): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    canvas.toBuffer((error, buffer) => (error ? reject(error) : resolve(buffer)), 'image/png', {
      compressionLevel: 3,
    })
  })
}
