/**
 * Caption layout rules of the editor engine (the AVEditorEngine WASM's text asset),
 * ported so the server's burned-in captions match what the editor preview shows.
 * Four of the engine's caption presets are drawn (`presetOf`); boxes, strips and rotation
 * were calibrated against engine captures at 1080 x 1920 (the caption calibration harness,
 * apps/services/render/scripts/caption-calibration.ts).
 *
 * The engine has no source in this repo. Each rule below cites the disassembled function it was
 * recovered from (`.reelmakeeasy/presets/<v>/editor/AVEditorEngine.wasm.gz`, name section). The
 * engine's text drawer is node-canvas's Context2d code (same shadow blur, same
 * `setTextPath`), so a node-canvas `measureText` reproduces its measurements.
 *
 * Everything here is pure: text measurement is injected, nothing is drawn.
 */

import { boxShadowMargin, type CaptionBoxShadow } from './box-shadow'

export interface CaptionFont {
  family: string
  italic: boolean
  /** CSS pixels (Pango absolute size), i.e. points x 4/3. */
  px: number
  weight: number
}

export interface CaptionFrameSize {
  height: number
  width: number
}

/** The caption style fields of a render plan `CaptionSeg`. */
export interface CaptionLayoutStyle {
  /** The box behind the active word (simple-bg) or behind the lines (deep-diver). */
  animationBgColor?: string
  animationColor?: string
  /**
   * Not used: the engine draws preset boxes with its own corner radius (checked with none, 0
   * and 20 on simple-bg and deep-diver, which drew alike), so the export does the same.
   */
  borderRadius?: number
  fontColor?: string
  fontFamily?: string
  fontSize?: number
  fontWeight?: number
  italic?: boolean
  shadowBlur?: number
  shadowColor?: string
  shadowOffsetX?: number
  shadowOffsetY?: number
  strokeColor?: string
  strokeWidth?: number
}

/** Measures `text` in `font`; injected so the layout stays pure. */
export type CaptionMeasureText = (text: string, font: CaptionFont) => CaptionTextMetrics

/** Pango metrics of a single-line layout, as node-canvas `measureText` reports them. */
export interface CaptionTextMetrics {
  /** Font ascent: from the top of the line box to the baseline. */
  ascent: number
  /** Logical height of the line box. */
  height: number
  /** Logical (advance) width. */
  width: number
}

/**
 * A render plan keyframe (`KeyFrame<number>`): `ft` in ms from the segment start; `mode` 0 holds
 * the previous value up to this key, any other mode (linear, bezier) eases linearly into it.
 */
export interface CaptionKeyFrame {
  ft: number
  mode: number
  v: number
}

/** The fields of a render plan `CaptionSeg` the layout reads. Times are in ms. */
export interface CaptionLayoutSegment {
  in: number
  lineCount?: number
  out: number
  /**
   * Centre-based ratio: [0, 0] is the frame centre, y is up, the frame spans [-1, 1]. The
   * engine centres the whole caption block on it, whatever the segment's `vAlign` (checked
   * with 'b', 'm' and 't' on a three-line caption: they drew alike).
   */
  position?: [number, number]
  /** Clockwise turn of the whole caption about its centre, in degrees (or keyframes of it). */
  rotate?: CaptionKeyFrame[] | number
  scale?: [number, number]
  /** A square-cornered strip under the text, in place of the preset's box (a fact stamp's). */
  strip?: CaptionStrip
  style: CaptionLayoutStyle
  /** Words; their `in`/`out` are relative to the segment's `in`. */
  texts: Array<{ highlightColor?: string; in: number; out: number; t: string }>
  uri?: string
}

/**
 * A strip with square corners drawn under a caption's text (a fact stamp's, fact-stamps.ts), in
 * place of its preset's box: `w` x `h` px, centred across the caption centre and `offsetY` px
 * below it, in the caption's own frame, so it turns and scales with the text, over its `shadow`.
 * The editor engine has no such box (its preset boxes are rounded, their margins fixed): it draws
 * the strip and its shadow as an image layer of the same size, place and turn
 * (`factStampStripSeg`).
 */
export interface CaptionStrip {
  color: string
  h: number
  offsetY: number
  shadow?: CaptionBoxShadow
  w: number
}

/** A filled rounded rectangle under the text, in texture coordinates, over its `shadow`. */
export interface CaptionBox {
  color: string
  h: number
  radius: number
  shadow?: CaptionBoxShadow
  w: number
  x: number
  y: number
}

/** The caption of one segment at one instant. */
export interface CaptionFrame {
  /** Drawn under the words, in order. */
  boxes: CaptionBox[]
  /** Clockwise turn of the whole texture about its centre, in degrees. */
  rotate: number
  /** Horizontal scale of the whole texture about its centre (fill-pop pulse x segment scale). */
  scaleX: number
  scaleY: number
  words: CaptionWordFrame[]
}

/**
 * The engine caption presets the export draws (`CaptionAnimationUri::GetPresetType`):
 * - fill-pop (`word-level_karaoke_fill-pop`): the active word coloured and set 1.3x, the line
 *   stretched for 160 ms from each word;
 * - highlight-color (`word-level_highlight_color`): the active word coloured, nothing moves;
 * - simple-bg (`word-level_simple_bg-highlight`): as highlight-color, on a box behind the
 *   active word;
 * - deep-diver: as highlight-color, on one box behind every visible line.
 */
export type CaptionPreset = 'deep-diver' | 'fill-pop' | 'highlight-color' | 'simple-bg'

const PRESET_BY_NAME: Readonly<Record<string, CaptionPreset>> = {
  'deep-diver': 'deep-diver',
  'word-level_highlight_color': 'highlight-color',
  'word-level_karaoke_fill-pop': 'fill-pop',
  'word-level_simple_bg-highlight': 'simple-bg',
}

/** The preset a caption `uri` names; any other preset is drawn as fill-pop, as before. */
export function presetOf(uri: string | undefined): CaptionPreset {
  const name = uri?.match(/^caption-preset:\/\/(.+)$/)?.[1]
  return (name && PRESET_BY_NAME[name]) || 'fill-pop'
}

/** One laid-out word of a segment (before the per-frame animation). */
export interface CaptionLayoutWord {
  /** End as the engine holds it: the next word's start (the last word: its end + 1.5 s). */
  endMs: number
  /** Logical height at `pt`. */
  height: number
  highlightColor?: string
  /** Line index inside the segment. */
  line: number
  /** Font size in points: the segment's, or smaller when the word alone overflows a line. */
  pt: number
  startMs: number
  text: string
  /** Width used for layout (pixel-rounded, capped at the line limit). */
  width: number
}

/** A segment measured and split into lines for one frame size. */
export interface CaptionSegmentLayout {
  basePt: number
  font: Omit<CaptionFont, 'px'>
  frame: CaptionFrameSize
  lineCount: number
  /** Max line width in px: the design width scaled to the frame, plus one space. */
  lineLimit: number
  /** Per line: its width as one string, which the deep-diver box is sized by. */
  lineWidths: number[]
  /** Top/bottom padding of the caption texture. */
  pad: number
  paint: {
    activeColor: string
    boxColor?: string
    fontColor: string
    shadow?: { blur: number; color: string; offsetX: number; offsetY: number }
    stroke?: { color: string; width: number }
  }
  preset: CaptionPreset
  scale: [number, number]
  segment: CaptionLayoutSegment
  /** Texture x = frame-wide x minus this: a turned caption's texture is cut to its text. */
  shiftX: number
  spaceHeight: number
  spaceWidth: number
  /**
   * The caption texture, centred on the segment position: frame-wide, or as wide as the text
   * block when the caption turns (a frame-wide texture tilted 3 degrees would gain 56 px).
   */
  texture: { centerX: number; centerY: number; height: number; width: number }
  /** The largest turn the segment takes, in degrees either way (0: never turns). */
  turn: number
  words: CaptionLayoutWord[]
}

/** One word as drawn in a frame. */
export interface CaptionWordFrame {
  active: boolean
  color: string
  /** Font size in CSS px. */
  px: number
  text: string
  /** Left edge, in texture coordinates. */
  x: number
  /** Top of the line box (draw with textBaseline 'top'), in texture coordinates. */
  y: number
}

/** `GetCaptionScaleRatioBySize`: 1280/1080 as an f32. */
const DESIGN_SCALE = Math.fround(1.185185194015503)
/** Pango at its default 96 dpi: one point is 4/3 px. */
const PX_PER_PT = 96 / 72
/** `GetWordsOfRenderLine`: line width in design units (portrait, landscape/square). */
const LINE_DESIGN_WIDTH = { landscape: 1380, portrait: 540 }

/**
 * `word-level_karaoke_fill-pop` (RenderTextFun, preset case 5):
 * - per word (transform slot 36): the active word is set at 1.3x its size, held for the
 *   whole word (an init value with no keys); colour key 12 (highlight or animation colour)
 *   while active, key 1 (font colour) otherwise;
 * - per line (slot 28, applied to the whole texture by `OpusLayer::Render` as scale.x):
 *   (1.05, 1.0) at t = -1 and 0, (1.0, 1.0) at 160 ms, linear keys, t = now - active word start
 *   or -1 when no word is active.
 */
export const FILL_POP = {
  activeWordScale: Math.fround(1.3),
  lineStretchFrom: 1.05,
  lineStretchMs: 160,
} as const

/**
 * The preset boxes (RenderTextFun's two `fillRectRounded` calls: factors decoded from them, the
 * strip's top and bottom margin fitted; checked on engine captures to about 2 px, and the
 * corner radii to 1 px, at 1080 x 1920):
 * - simple-bg: the active word's line box (its x, width and line height), widened on each side
 *   by trunc(0.8 x radius), radius trunc(line height / 8);
 * - deep-diver: around the visible lines, `stripPadX` x the font size (pt) on each side of the
 *   widest line (measured as one string, centred on the frame), `stripPadY` x pt above the first
 *   and below the last line, radius `stripPadY` x pt.
 * A line holding a word shrunk to fit starts both boxes at that word's drawn top, which sits
 * lower than the line's (same baseline, smaller ascent), and keeps the base line height.
 */
export const CAPTION_BOX = {
  activePadOfRadius: 0.8,
  activeRadiusOfLine: 1 / 8,
  stripPadX: 1.1,
  stripPadY: 0.3,
} as const

/** `CaptionCanvas::GetCaptionScaleRatioBySize(H, W)`: follows the frame height. */
export function captionScaleRatio(frame: CaptionFrameSize): number {
  const { height, width } = frame
  return Math.fround(Math.fround(height / (height < width ? 1080 : 1920)) * DESIGN_SCALE)
}

/** `OpusTextAsset::scalePx(int)`: design units to frame pixels, rounded. */
export function captionScalePx(value: number, frame: CaptionFrameSize): number {
  return Math.round(value * captionScaleRatio(frame))
}

/** `OpusTextAsset::scalePx(float)`: as above, unrounded (shadow offsets). */
export function captionScalePxFloat(value: number, frame: CaptionFrameSize): number {
  return Math.fround(captionScaleRatio(frame) * Math.fround(value))
}

/** The engine's caption font size for a frame, in points (`GetFontSizeForRendering`). */
export function captionFontPt(fontSize: number, frame: CaptionFrameSize): number {
  return captionScalePx(fontSize, frame)
}

export function captionPtToPx(pt: number): number {
  return pt * PX_PER_PT
}

/**
 * The fill-pop line stretch at `msSinceWordStart` (undefined: no active word, which the engine
 * evaluates at t = -1, the first key).
 */
export function fillPopStretch(msSinceWordStart: number | undefined): number {
  const t = msSinceWordStart ?? -1
  const { lineStretchFrom: from, lineStretchMs: ms } = FILL_POP
  if (t <= 0) return from
  if (t >= ms) return 1
  return from + (1 - from) * (t / ms)
}

// pango_extents_to_pixels (inclusive) on a rect at x = y = 0.
const pixelExtent = (n: number) => Math.ceil(n - 1e-6)

/**
 * Measures and splits a segment into lines (`GetWordsOfRenderLine`), and sizes its texture.
 *
 * Line split, as the engine does it: words are measured at the base size; the limit is
 * scalePx(540 | 1380) plus one space. The running width adds a space before each word and keeps
 * a trailing space after a word that stayed on the line (so later gaps count two spaces); a word
 * that does not fit starts a new line. A word wider than the limit on its own is shrunk to fit
 * (font size x limit / width), sits on its own line, and the next word starts a new one.
 */
export function layoutCaptionSegment(
  segment: CaptionLayoutSegment,
  frame: CaptionFrameSize,
  measure: CaptionMeasureText,
): CaptionSegmentLayout {
  const { style } = segment
  const font = {
    family: style.fontFamily ?? 'Montserrat',
    italic: Boolean(style.italic),
    weight: style.fontWeight ?? 400,
  }
  const at = (pt: number): CaptionFont => ({ ...font, px: captionPtToPx(pt) })
  const basePt = captionFontPt(style.fontSize ?? 35, frame)

  const space = measure(' ', at(basePt))
  const spaceWidth = pixelExtent(space.width)
  const spaceHeight = pixelExtent(space.height) || basePt
  const lineLimit =
    captionScalePx(
      frame.height > frame.width ? LINE_DESIGN_WIDTH.portrait : LINE_DESIGN_WIDTH.landscape,
      frame,
    ) + spaceWidth

  const words: CaptionLayoutWord[] = []
  let line = 0
  let running = 0
  for (const word of segment.texts) {
    const metrics = measure(word.t, at(basePt))
    const measured = pixelExtent(metrics.width)
    const fits = lineLimit >= measured
    const width = fits ? measured : lineLimit
    const pt = fits
      ? basePt
      : Math.trunc(Math.fround(basePt) / Math.fround(Math.fround(measured) / lineLimit))
    const next = width + running + (running ? spaceWidth : 0)
    const newLine = !fits || next > lineLimit
    if (newLine) line++
    words.push({
      endMs: word.out,
      height: pixelExtent(metrics.height),
      highlightColor: word.highlightColor,
      line,
      pt,
      startMs: word.in,
      text: word.t,
      width,
    })
    // Decoded from GetWordsOfRenderLine: `select(width, next + space, newLine)`. A word that stays
    // on its line leaves a trailing space in the running width (so line 0, which starts empty,
    // counts two spaces from its first gap on); a word that wraps restarts it at its own width
    // with no trailing space, so a wrapped line's first gap counts one space.
    if (fits) {
      running = newLine ? width : next + spaceWidth
    } else {
      line++
      running = 0
    }
  }

  holdWordsUntilNext(words)

  const preset = presetOf(segment.uri)
  const lineWidths = measureLines(preset, words, (text) => measure(text, at(basePt)))
  const lineCount = Math.max(1, segment.lineCount ?? 1)
  const lineHeight = words[0]?.height ?? spaceHeight
  // With lineCount >= 2 the engine shows every line of the segment at once, one line height
  // apart (checked: 67, 77, 87 and 123 px at 1080 x 1920, Pango's line height of each size).
  const textHeight =
    lineCount >= 2 ? lineHeight * new Set(words.map((w) => w.line)).size : lineHeight

  const shadow =
    style.shadowColor && (style.shadowBlur || style.shadowOffsetX || style.shadowOffsetY)
      ? {
          blur: captionScalePx(2 * (style.shadowBlur ?? 0), frame),
          color: style.shadowColor,
          offsetX: captionScalePxFloat(style.shadowOffsetX ?? 0, frame),
          offsetY: captionScalePxFloat(style.shadowOffsetY ?? 0, frame),
        }
      : undefined
  // Padding above and below the text: room for the shadow, at least a line height, the
  // deep-diver box's margin above and below the lines, and a strip's reach past them.
  const shadowPad = Math.max(shadow?.offsetX ?? 0, shadow?.offsetY ?? 0) + 2 * (shadow?.blur ?? 0)
  const pad = Math.trunc(
    Math.max(
      shadowPad,
      spaceHeight,
      stripMarginY(preset, basePt),
      stripReachY(segment.strip, textHeight),
    ),
  )

  const turn = maxTurn(segment.rotate)
  const shiftX = textureCut(words, lineWidths, {
    frame,
    pad,
    preset,
    pt: basePt,
    spaceHeight,
    spaceWidth,
    stripWidth: stripReachX(segment.strip),
    turn,
  })

  const [posX, posY] = segment.position ?? [0, 0]
  const fontColor = style.fontColor ?? '#ffffff'
  return {
    basePt,
    font,
    frame,
    lineCount,
    lineLimit,
    lineWidths,
    pad,
    paint: {
      activeColor: style.animationColor ?? fontColor,
      boxColor: style.animationBgColor,
      fontColor,
      shadow,
      stroke: style.strokeWidth
        ? {
            color: style.strokeColor ?? '#000000',
            width: captionScalePx(style.strokeWidth, frame),
          }
        : undefined,
    },
    preset,
    scale: segment.scale ?? [1, 1],
    segment,
    shiftX,
    spaceHeight,
    spaceWidth,
    texture: {
      // The texture is centred on the segment position (`FetchCurrentLayoutInfo` reports the
      // layer centre and the texture size), multi-line blocks included.
      centerX: (frame.width / 2) * (1 + posX),
      centerY: (frame.height / 2) * (1 - posY),
      height: textHeight + 2 * pad,
      width: frame.width - 2 * shiftX,
    },
    turn,
    words,
  }
}

/** The deep-diver box's margin above and below the lines, in px (0 for other presets). */
function stripMarginY(preset: CaptionPreset, pt: number): number {
  return preset === 'deep-diver' ? Math.ceil(CAPTION_BOX.stripPadY * pt) : 0
}

/**
 * How far a `strip` and its shadow reach above or below the text block (`textHeight` px tall),
 * in px.
 */
function stripReachY(strip: CaptionStrip | undefined, textHeight: number): number {
  if (!strip) return 0
  const reach = Math.abs(strip.offsetY) + strip.h / 2 + stripShadowMargin(strip)
  return Math.ceil(reach - textHeight / 2) + 1
}

/** How wide a `strip` and its shadow are, in px (0 without a strip). */
function stripReachX(strip: CaptionStrip | undefined): number {
  return strip ? strip.w + 2 * stripShadowMargin(strip) : 0
}

/** How far a strip's shadow shows past the strip, in px (0 without one). */
function stripShadowMargin(strip: CaptionStrip): number {
  return strip.shadow ? boxShadowMargin(strip.shadow) : 0
}

/**
 * How much a turned caption's texture is cut from each side (0 when it never turns): down to its
 * widest line as it can grow (the fill-pop word, the boxes, a strip) plus the padding, evenly so
 * it stays centred and every x stays a whole pixel.
 */
function textureCut(
  words: CaptionLayoutWord[],
  lineWidths: number[],
  at: {
    frame: CaptionFrameSize
    pad: number
    preset: CaptionPreset
    pt: number
    spaceHeight: number
    spaceWidth: number
    stripWidth: number
    turn: number
  },
): number {
  if (!at.turn) return 0
  const grow = at.preset === 'fill-pop' ? FILL_POP.activeWordScale - 1 : 0
  let widest = at.stripWidth
  for (const line of new Set(words.map((w) => w.line))) {
    const onLine = words.filter((w) => w.line === line)
    const width =
      onLine.reduce((sum, w) => sum + w.width, 0) +
      at.spaceWidth * (onLine.length - 1) +
      grow * Math.max(...onLine.map((w) => w.width))
    widest = Math.max(widest, width, lineWidths[line] ?? 0)
  }
  const side = at.preset === 'deep-diver' ? CAPTION_BOX.stripPadX * at.pt : at.spaceHeight / 2
  return Math.max(0, Math.floor((at.frame.width - widest) / 2 - side) - at.pad)
}

/**
 * Each line's width as the engine sizes the deep-diver box: the line's words as one string at
 * the base size (a lone word shrunk to fit keeps its capped width). None for other presets.
 */
function measureLines(
  preset: CaptionPreset,
  words: CaptionLayoutWord[],
  measureAtBase: (text: string) => CaptionTextMetrics,
): number[] {
  const widths: number[] = []
  if (preset !== 'deep-diver') return widths
  for (const line of new Set(words.map((w) => w.line))) {
    const onLine = words.filter((w) => w.line === line)
    widths[line] =
      onLine.length === 1
        ? onLine[0].width
        : pixelExtent(measureAtBase(onLine.map((w) => w.text).join(' ')).width)
  }
  return widths
}

/** The largest turn of a segment, in degrees either way. */
function maxTurn(rotate: CaptionLayoutSegment['rotate']): number {
  if (rotate === undefined) return 0
  if (typeof rotate === 'number') return Math.abs(rotate)
  return Math.max(0, ...rotate.map((k) => Math.abs(k.v)))
}

/** The segment's turn at `now` ms from its start (see `CaptionKeyFrame`). */
export function captionRotationAt(rotate: CaptionLayoutSegment['rotate'], now: number): number {
  if (rotate === undefined) return 0
  if (typeof rotate === 'number') return rotate
  const keys = [...rotate].sort((a, b) => a.ft - b.ft)
  if (!keys.length) return 0
  if (now <= keys[0].ft) return keys[0].v
  for (let i = 1; i < keys.length; i++) {
    const [prev, next] = [keys[i - 1], keys[i]]
    if (now >= next.ft) continue
    if (next.mode === 0) return prev.v
    return prev.v + ((next.v - prev.v) * (now - prev.ft)) / (next.ft - prev.ft)
  }
  return keys[keys.length - 1].v
}

/** Hold extension of a word past its own end, for the last word (`AVEditTextInfo::Load`). */
const LAST_WORD_HOLD_MS = 1500

/**
 * Word timing as the engine loads it (`AVEditTextInfo::Load`, func 1367): each word ends where the
 * next one starts (`words[i - 1].end = words[i].start`), and the last word's end is pushed out by
 * 1.5 s. So a word stays active, green and enlarged, through the gap after it until the next word
 * starts; the last one until the segment leaves the screen. Before the first word nothing is
 * active.
 *
 * CALIBRATE: Load then groups very short words (running duration <= 199 ms) and rewrites their
 * times from index tables; that decode is not certain and is not ported.
 */
function holdWordsUntilNext(words: CaptionLayoutWord[]): void {
  for (let i = 1; i < words.length; i++) words[i - 1].endMs = words[i].startMs
  const last = words.at(-1)
  if (last) last.endMs += LAST_WORD_HOLD_MS
}

/** `NumberUtil::inRange(now, start, end - 1)`: the one "active word" test, on integer ms. */
const isActiveAt = (word: CaptionLayoutWord, now: number) =>
  now >= word.startMs && now <= word.endMs - 1

/** The words on screen at `now` (segment-relative): one line, or all of them for lineCount >= 2. */
function visibleWords(layout: CaptionSegmentLayout, now: number): CaptionLayoutWord[] {
  const { words } = layout
  if (layout.lineCount >= 2 || !words.length) return words
  // The engine keeps the line of the last active word between words; before the first word it
  // shows the first line.
  const current = words.find((w) => isActiveAt(w, now)) ?? words.findLast((w) => w.startMs <= now)
  const line = (current ?? words[0]).line
  return words.filter((w) => w.line === line)
}

/**
 * The caption of `layout` at timeline time `timeMs`, or undefined when the segment is off screen.
 *
 * Per word (RenderTextFun): the active word is drawn in its highlight colour. Under fill-pop it
 * is also set at round(1.3 x pt) and its layout width becomes trunc(1.3 x width); each line is
 * centred on its total width (words plus one space between them), so the neighbours of the
 * active word move outward and the gaps stay one space. A word set at another size moves up by
 * the difference in ascent, keeping one baseline. Then the preset's boxes (`CAPTION_BOX`).
 */
export function captionFrameAt(
  layout: CaptionSegmentLayout,
  timeMs: number,
  measure: CaptionMeasureText,
): CaptionFrame | undefined {
  const { segment } = layout
  // The engine's clock is integer milliseconds.
  const time = Math.floor(timeMs)
  if (time < segment.in || time >= segment.out) return undefined
  const now = time - segment.in
  const words = visibleWords(layout, now)
  const ascent = (pt: number) =>
    Math.round(measure(' ', { ...layout.font, px: captionPtToPx(pt) }).ascent)
  const baseAscent = ascent(layout.basePt)

  const pops = layout.preset === 'fill-pop'
  const states = words.map((word): CaptionWordState => {
    const active = isActiveAt(word, now)
    const scale = active && pops ? FILL_POP.activeWordScale : 1
    return {
      active,
      color: active ? (word.highlightColor ?? layout.paint.activeColor) : layout.paint.fontColor,
      height: word.height,
      line: word.line,
      pt: active ? Math.round(Math.fround(scale * word.pt)) : word.pt,
      text: word.text,
      width: active ? Math.trunc(Math.fround(scale * word.width)) : word.width,
    }
  })

  const lines = [...new Set(states.map((s) => s.line))]
  const shiftOf = (pt: number) => (pt === layout.basePt ? 0 : ascent(pt) - baseAscent)
  const out: CaptionWordFrame[] = []
  const boxes: CaptionBox[] = []
  const tops: number[] = []
  let lineTop = layout.pad
  for (const [index, line] of lines.entries()) {
    if (index > 0) lineTop += layout.spaceHeight
    const placed = placeLine(
      layout,
      states.filter((s) => s.line === line),
      lineTop,
      shiftOf,
    )
    out.push(...placed.words)
    boxes.push(...placed.boxes)
    tops.push(placed.boxTop)
  }
  if (segment.strip) {
    boxes.unshift(squareStrip(layout, segment.strip))
  } else if (layout.preset === 'deep-diver' && layout.paint.boxColor && tops.length) {
    boxes.push(stripBox(layout, layout.paint.boxColor, lines, tops))
  }

  const active = words.find((w) => isActiveAt(w, now))
  const stretch = pops ? fillPopStretch(active ? now - active.startMs : undefined) : 1
  return {
    boxes,
    rotate: captionRotationAt(layout.segment.rotate, now),
    scaleX: stretch * layout.scale[0],
    scaleY: layout.scale[1],
    words: out,
  }
}

/** A visible word as drawn at one moment: lit or not, its size and colour. */
interface CaptionWordState {
  active: boolean
  color: string
  height: number
  line: number
  pt: number
  text: string
  width: number
}

/**
 * One line's words (`onLine`) placed at `lineTop`, centred on the frame, each moved down by
 * `shiftOf` its size (a smaller word keeps the baseline), with simple-bg's box behind the
 * active word. `boxTop` is where the line's boxes start: its top, or the drawn top of a word
 * set at another size (a word shrunk to fit, alone on its line), as the engine boxes it.
 */
function placeLine(
  layout: CaptionSegmentLayout,
  onLine: CaptionWordState[],
  lineTop: number,
  shiftOf: (pt: number) => number,
): { boxes: CaptionBox[]; boxTop: number; words: CaptionWordFrame[] } {
  const words: CaptionWordFrame[] = []
  const boxes: CaptionBox[] = []
  let boxTop = lineTop
  const lineWidth =
    onLine.reduce((sum, s) => sum + s.width, 0) + layout.spaceWidth * (onLine.length - 1)
  let x = Math.fround((layout.frame.width - lineWidth) * 0.5)
  for (const s of onLine) {
    const shift = shiftOf(s.pt)
    const wordX = Math.trunc(x) - layout.shiftX
    const wordY = Math.trunc(lineTop - shift)
    if (shift) boxTop = wordY
    words.push({
      active: s.active,
      color: s.color,
      px: captionPtToPx(s.pt),
      text: s.text,
      x: wordX,
      y: wordY,
    })
    const box = activeWordBox(layout, s, wordX, wordY)
    if (box) boxes.push(box)
    x += s.width + layout.spaceWidth
  }
  return { boxes, boxTop, words }
}

/**
 * simple-bg's box behind the active word drawn at (`x`, `y`): at the word's drawn top and the
 * base line height, so a shrunk word's box hangs below it, as the engine draws it
 * (`CAPTION_BOX`). Other presets, and words not lit, have none.
 */
function activeWordBox(
  layout: CaptionSegmentLayout,
  word: CaptionWordState,
  x: number,
  y: number,
): CaptionBox | undefined {
  if (!word.active || layout.preset !== 'simple-bg' || !layout.paint.boxColor) return undefined
  const radius = Math.trunc(word.height * CAPTION_BOX.activeRadiusOfLine)
  const padX = Math.trunc(CAPTION_BOX.activePadOfRadius * radius)
  return {
    color: layout.paint.boxColor,
    h: word.height,
    radius,
    w: word.width + 2 * padX,
    x: x - padX,
    y,
  }
}

/** The deep-diver box behind the visible `lines`, whose boxes start at `tops` (see `CAPTION_BOX`). */
function stripBox(
  layout: CaptionSegmentLayout,
  color: string,
  lines: number[],
  tops: number[],
): CaptionBox {
  const widest = Math.max(...lines.map((line) => layout.lineWidths[line] ?? 0))
  const padX = CAPTION_BOX.stripPadX * layout.basePt
  const padY = CAPTION_BOX.stripPadY * layout.basePt
  const top = tops[0]
  const bottom = tops[tops.length - 1] + layout.spaceHeight
  return {
    color,
    h: bottom - top + 2 * padY,
    radius: padY,
    w: Math.trunc(widest + 2 * padX),
    x: Math.trunc((layout.frame.width - widest) / 2) - padX - layout.shiftX,
    y: top - padY,
  }
}

/**
 * A segment's `strip` in its texture: centred across, `offsetY` below the centre, square, over
 * its shadow.
 */
function squareStrip(layout: CaptionSegmentLayout, strip: CaptionStrip): CaptionBox {
  const { texture } = layout
  return {
    color: strip.color,
    h: strip.h,
    radius: 0,
    ...(strip.shadow ? { shadow: strip.shadow } : {}),
    w: strip.w,
    x: texture.width / 2 - strip.w / 2,
    y: texture.height / 2 + strip.offsetY - strip.h / 2,
  }
}

/** A stable key for a frame, so identical caption images can be drawn once. */
export function captionFrameKey(frame: CaptionFrame | undefined): string {
  if (!frame) return ''
  const words = frame.words.map((w) => `${w.text}|${w.x}|${w.y}|${w.px}|${w.color}`).join(';')
  const boxes = frame.boxes.map((b) => {
    const shadow = b.shadow ? `~${b.shadow.offsetY},${b.shadow.opacity},${b.shadow.sigma}` : ''
    return `${b.x}|${b.y}|${b.w}|${b.h}|${b.radius}|${b.color}${shadow}`
  })
  const turn = frame.rotate ? `@${frame.rotate.toFixed(4)}` : ''
  const under = boxes.length ? `[${boxes.join(';')}]` : ''
  return `${frame.scaleX.toFixed(4)}x${frame.scaleY.toFixed(4)}${turn}:${under}${words}`
}
