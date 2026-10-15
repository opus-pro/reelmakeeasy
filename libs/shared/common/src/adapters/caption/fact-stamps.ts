import {
  type AnimatedWordStyle,
  AssetType,
  type CaptionSeg,
  SegType,
  VerticalAlign,
  type VideoSeg,
} from '../../types/render-plan-struct'

import {
  boxShadowMargin,
  type BoxShadowPixels,
  boxShadowPixels,
  type CaptionBoxShadow,
} from './box-shadow'
import {
  captionFontPt,
  type CaptionFrameSize,
  captionPtToPx,
  type CaptionStrip,
} from './caption-layout'
import { readableInk } from './caption-style'

/**
 * Fact stamps: the short exact labels a loop short shows over its clips ("c. 2560 BC"), each on
 * a strip in the video's highlight colour, tilted like a sticker, top right, from 0.3 s to 3.0 s
 * of its clip. They look as they did when they were drawn as PNGs: a tight strip with square
 * corners, 22 px beside the label and 13 px above and below its ink on a 1080-wide frame, over a
 * soft shadow (black at 30%, 4 px down), its turned extent's right edge 70 px in from the right
 * and its top 170 px down.
 *
 * Both renderers draw it, from the same numbers:
 * - the label is one `deep-diver` caption segment holding the whole label in one text element
 *   (the engine drops a word the next one starts with), in PT Serif Bold from the render font
 *   pack (the export finds `PTSerif-Bold.ttf` by family and weight, the editor loads the pack from
 *   `style.fontGzipPath`: its own pack has Montserrat only), ink that reads on the strip, no
 *   outline or shadow, tilted 3 degrees, anticlockwise on even stamps and clockwise on odd ones;
 * - the strip is the segment's `strip`: the export's caption painter draws it under the text in
 *   place of the deep-diver box; the editor engine, whose preset boxes have rounded corners and
 *   fixed margins (1.1 x the font size beside the text, 0.3 x above and below, whatever the
 *   style says), draws it as an image layer of the same size, place and turn under the label
 *   (`factStampStripSeg`), and the label then goes without its box (`factStampLabelOnStrip`).
 *   An engine plan without the layer keeps the label's own box: the stamp shows, rounded;
 * - the shadow is the strip's `shadow`, worked out once for both (boxShadowPixels): the painter
 *   puts the pixels under its strip, the editor's strip image has them around its strip, each
 *   at the square root of its opacity, as the engine shows a picture's opacity squared
 *   (`factStampStripShadowPixels`).
 *
 * The engine places a caption by its centre, so the centres are worked out from the label's width
 * and the face's metrics: both renderers must get the same numbers, so the width comes from the
 * face's advance widths below, not from either renderer's measure. Kerning is left out: it only
 * narrows a label, which then has a few px more margin.
 */
export const FACT_STAMP = {
  /**
   * PT Serif Bold's ascent and descent per px of its size, as Pango sets a line of it: the line
   * box is ceil(ascent) + ceil(descent) px tall (68 at 52 px), the baseline `ascent` below its top.
   */
  ascent: 1.018,
  descent: 0.276,
  fontFamily: 'PT Serif',
  /** Design units: 52 px on a 1080 x 1920 frame, the size the stamps were drawn at. */
  fontSize: 33,
  fontWeight: 700,
  /** Ink per px of the size above the baseline ('H', 'd') and below it ('g', 'y'). */
  inkAscent: 0.752,
  inkDescent: 0.215,
  /** The widest a label is set, of the frame width (464 px of 1080). */
  maxTextWidth: 464 / 1080,
  /** The smallest size a long label is set at, in design units. */
  minFontSize: 16,
  /** The strip's margin beside the label, of the frame width (22 px of 1080). */
  padX: 22 / 1080,
  /** The strip's margin above and below the label's ink, of the frame width (13 px of 1080). */
  padY: 13 / 1080,
  /** The turned strip's right edge from the frame's right edge, of the frame width (70 of 1080). */
  right: 70 / 1080,
  /**
   * The strip's shadow, the drawn stamps' (black at 30%, blur 10, 4 px down): its drop and its
   * softness (6 px of 1080: node-canvas, which drew them, blurs 10 that wide) of the frame width.
   */
  shadow: { offsetY: 4 / 1080, opacity: 0.3, sigma: 6 / 1080 },
  tiltDeg: 3,
  /** The turned strip's top, of the frame height (170 px of 1920). */
  top: 170 / 1920,
} as const

/** A fact stamp's label segment, with the strip both renderers draw under it. */
export type FactStampSeg = CaptionSeg & { strip: CaptionStrip }

/**
 * The image the editor engine draws a stamp's strip from: the strip at 1:1, `width` x `height` px
 * of `color`, over its `shadow`, in a `border` px wide around it that holds the shadow (clear
 * without one, which smooths the strip's edges when it turns as the painter's are).
 */
export interface FactStampStripImage {
  border: number
  color: string
  height: number
  shadow?: CaptionBoxShadow
  width: number
}

const DEEP_DIVER_URI = 'caption-preset://deep-diver'
const STRIP_IMAGE_BORDER = 1

/**
 * PT Serif Bold's advance widths in thousandths of its size, for printable ASCII (space to `~`),
 * as Pango sets them unkerned.
 */
// prettier-ignore
const ADVANCES = [
  270, 344, 416, 565, 565, 848, 896, 240, 375, 375, 463, 565, 306, 414, 296, 344, // space to /
  565, 565, 565, 565, 565, 565, 565, 565, 565, 565, 343, 348, 565, 565, 565, 486, // 0 to ?
  1064, 729, 649, 652, 736, 604, 575, 709, 769, 372, 365, 710, 583, 930, 758, 754, // @ to O
  640, 754, 697, 558, 666, 715, 734, 1033, 728, 698, 634, 324, 382, 324, 498, 410, // P to _
  351, 557, 588, 484, 599, 537, 372, 564, 640, 332, 320, 583, 332, 924, 644, 594, // ` to o
  609, 589, 431, 452, 399, 622, 539, 784, 560, 528, 516, 354, 235, 354, 530, // p to ~
]
/** Any other character: about the face's widest lowercase, so the guess errs to the left. */
const OTHER_ADVANCE = 650

/** The label's width at `px`, from the face's advance widths (see ADVANCES). */
export function factStampTextWidth(text: string, px: number): number {
  let units = 0
  for (const char of text) {
    units += ADVANCES[(char.codePointAt(0) ?? 0) - 32] ?? OTHER_ADVANCE
  }
  return (units * px) / 1000
}

/**
 * One stamp as a caption segment for both renderers: `color` is the strip (the video's
 * highlight colour), `index` its place among the stamps (for the tilt), `frame` the frame it is
 * drawn on, and `fontGzipPath` where the editor loads the face from (the export reads none).
 */
export function factStampSeg(input: {
  color: string
  fontGzipPath?: string
  frame: CaptionFrameSize
  id: string
  index: number
  text: string
  timeline: { in: number; out: number }
}): FactStampSeg {
  const { color, frame, text, timeline } = input
  const fontSize = fittedFontSize(text, frame)
  const ink = readableInk(color)
  const style: AnimatedWordStyle = {
    // The engine's own (rounded) box, for a plan that draws no strip layer under the label.
    animationBgColor: color,
    animationColor: ink,
    fontColor: ink,
    fontFamily: FACT_STAMP.fontFamily,
    ...(input.fontGzipPath ? { fontGzipPath: input.fontGzipPath } : {}),
    fontId: '',
    fontSize,
    fontWeight: FACT_STAMP.fontWeight,
    italic: false,
    underline: false,
  }
  const tilt = input.index % 2 === 0 ? -FACT_STAMP.tiltDeg : FACT_STAMP.tiltDeg
  const strip = stampStrip(text, fontSize, color, frame)
  return {
    assetType: AssetType.Text,
    autoScale: true,
    id: input.id,
    in: timeline.in,
    lineCount: 1,
    out: timeline.out,
    position: labelCentre(strip, tilt, frame),
    rotate: tilt,
    scale: [1, 1],
    strip,
    style,
    texts: [{ in: 0, out: timeline.out - timeline.in, t: text }],
    type: SegType.Text,
    uri: DEEP_DIVER_URI,
    vAlign: VerticalAlign.middle,
  } as FactStampSeg
}

/** The image the editor engine draws `seg`'s strip from (see FactStampStripImage). */
export function factStampStripImage(seg: FactStampSeg): FactStampStripImage {
  const { color, h, shadow, w } = seg.strip
  if (!shadow) return { border: STRIP_IMAGE_BORDER, color, height: h, width: w }
  return { border: boxShadowMargin(shadow), color, height: h, shadow, width: w }
}

/**
 * The shadow pixels of the editor's strip image (`image`'s, none without a shadow): the painter's
 * (boxShadowPixels), each at the square root of its opacity. The engine draws a picture pixel of
 * opacity a as a x a (checked on it: 50% black over white shows 75% white, 10% to 90% follow
 * a x a to within 0.5%), so the shadow then shows as dark as the painter draws it.
 */
export function factStampStripShadowPixels(
  image: FactStampStripImage,
): BoxShadowPixels | undefined {
  if (!image.shadow) return undefined
  const pixels = boxShadowPixels({ h: image.height, w: image.width }, image.shadow)
  const { data } = pixels
  for (let i = 3; i < data.length; i += 4) data[i] = Math.round(Math.sqrt(data[i] / 255) * 255)
  return pixels
}

/**
 * `seg`'s strip as an editor engine layer: the strip image at `uri` (factStampStripImage), over
 * the stamp's window, centred where the painter centres the strip (the label's centre, `offsetY`
 * below it in the turned label's frame) and turned with the label. The engine fits an image layer
 * to the frame width, so its scale is the image's share of that width: drawn at 1:1.
 */
export function factStampStripSeg(
  seg: FactStampSeg,
  uri: string,
  frame: CaptionFrameSize,
): VideoSeg {
  const image = factStampStripImage(seg)
  const [x, y] = seg.position as [number, number]
  const turn = ((typeof seg.rotate === 'number' ? seg.rotate : 0) * Math.PI) / 180
  // The label's centre in px (y down), then the strip's: offsetY down the turned label.
  const labelX = (frame.width / 2) * (1 + x)
  const labelY = (frame.height / 2) * (1 - y)
  const stripX = labelX - seg.strip.offsetY * Math.sin(turn)
  const stripY = labelY + seg.strip.offsetY * Math.cos(turn)
  const scale = (image.width + 2 * image.border) / frame.width
  const duration = seg.out - seg.in
  return {
    assetType: AssetType.Image,
    cropPosition: [{ ft: 0, mode: 0, v: [0, 0] }],
    cropSize: [{ ft: 0, mode: 0, v: [1, 1] }],
    id: `${seg.id}-strip`,
    in: seg.in,
    loop: 0,
    out: seg.out,
    position: [stripX / (frame.width / 2) - 1, 1 - stripY / (frame.height / 2)],
    rotate: seg.rotate,
    scale: [scale, scale],
    trimEnd: duration,
    trimStart: 0,
    type: SegType.Video,
    uri,
    volume: 0,
  }
}

/** `seg`'s label for an engine plan that draws its strip as a layer under it: without its box. */
export function factStampLabelOnStrip(seg: FactStampSeg): FactStampSeg {
  const style: AnimatedWordStyle = { ...seg.style }
  delete style.animationBgColor
  return { ...seg, style }
}

/** The label's size: the stamps' own, or the largest whole size under it that fits. */
function fittedFontSize(text: string, frame: CaptionFrameSize): number {
  const widest = FACT_STAMP.maxTextWidth * frame.width
  let size: number = FACT_STAMP.fontSize
  while (size > FACT_STAMP.minFontSize && textWidthAt(text, size, frame) > widest) size--
  return size
}

function textWidthAt(text: string, fontSize: number, frame: CaptionFrameSize): number {
  return factStampTextWidth(text, captionPtToPx(captionFontPt(fontSize, frame)))
}

/**
 * The strip around a label, as the stamps were drawn: its width the label's plus `padX` each
 * side, its height the ink's (from the top of 'H' to the bottom of 'g') plus `padY` above and
 * below, in whole px; its centre `offsetY` below the centre of the label's line box, where that
 * puts the top of the ink `padY` under the strip's top; its shadow at the frame's scale.
 */
function stampStrip(
  text: string,
  fontSize: number,
  color: string,
  frame: CaptionFrameSize,
): CaptionStrip {
  const px = captionPtToPx(captionFontPt(fontSize, frame))
  const padX = FACT_STAMP.padX * frame.width
  const padY = FACT_STAMP.padY * frame.width
  const w = Math.round(factStampTextWidth(text, px) + 2 * padX)
  const h = Math.round((FACT_STAMP.inkAscent + FACT_STAMP.inkDescent) * px + 2 * padY)
  const lineHeight = Math.ceil(FACT_STAMP.ascent * px) + Math.ceil(FACT_STAMP.descent * px)
  const stripTop = FACT_STAMP.ascent * px - FACT_STAMP.inkAscent * px - padY
  const shadow: CaptionBoxShadow = {
    offsetY: round4(FACT_STAMP.shadow.offsetY * frame.width),
    opacity: FACT_STAMP.shadow.opacity,
    sigma: round4(FACT_STAMP.shadow.sigma * frame.width),
  }
  return { color, h, offsetY: round4(stripTop + h / 2 - lineHeight / 2), shadow, w }
}

/**
 * The label's segment position (centre-based, y up): where the turned strip's right edge and top
 * land on the stamps' marks, less the strip's offset down the turned label.
 */
function labelCentre(
  strip: CaptionStrip,
  tiltDeg: number,
  frame: CaptionFrameSize,
): [number, number] {
  const tilt = (Math.abs(tiltDeg) * Math.PI) / 180
  const halfX = (strip.w * Math.cos(tilt) + strip.h * Math.sin(tilt)) / 2
  const halfY = (strip.w * Math.sin(tilt) + strip.h * Math.cos(tilt)) / 2
  const stripX = frame.width * (1 - FACT_STAMP.right) - halfX
  const stripY = frame.height * FACT_STAMP.top + halfY
  const turn = (tiltDeg * Math.PI) / 180
  const centreX = stripX + strip.offsetY * Math.sin(turn)
  const centreY = stripY - strip.offsetY * Math.cos(turn)
  return [round4(centreX / (frame.width / 2) - 1), round4(1 - centreY / (frame.height / 2))]
}

const round4 = (n: number) => Math.round(n * 10_000) / 10_000
