import type {
  RankingFontId,
  RankingProject,
  RankingSticker,
  RankingTitleWord,
} from '@shared/types/api/ranking'

import { isMovingSticker, type StickerPose } from './ranking-motion'
import { RANKING_HEIGHT, RANKING_WIDTH, transitionOf, transitionText } from './ranking-project'
import { rankingFontFamily, rankMark } from './ranking-type'

/**
 * The ranking short's overlay, drawn on a 2D canvas: the title band and the rank list. The same
 * function draws the studio's live preview and the PNG each rendered segment is overlaid with,
 * so what the studio shows is what renders. Works with a browser canvas or node-canvas: only the
 * calls below are used.
 */
export interface RankingCanvas {
  clearRect(x: number, y: number, w: number, h: number): void
  drawImage(image: never, x: number, y: number, w: number, h: number): void
  fillRect(x: number, y: number, w: number, h: number): void
  fillStyle: unknown
  fillText(text: string, x: number, y: number): void
  font: string
  globalAlpha: number
  lineJoin: string
  lineWidth: number
  measureText(text: string): { width: number }
  miterLimit: number
  restore(): void
  rotate(angle: number): void
  save(): void
  scale(x: number, y: number): void
  strokeStyle: unknown
  strokeText(text: string, x: number, y: number): void
  textAlign: string
  textBaseline: string
  transform(a: number, b: number, c: number, d: number, e: number, f: number): void
  translate(x: number, y: number): void
}

/** A loaded picture for a picture sticker: what the canvas draws, and its natural size. */
export type StickerImage = { height: number; source: unknown; width: number }

/** The font families the overlay draws with (loaded by the caller). */
export type RankingFonts = { label: string; number: string; title: string }

/** The heavy sans the trend uses, with system fallbacks. */
export const RANKING_FONT_FAMILY = 'Montserrat'
export const DEFAULT_RANKING_FONTS: RankingFonts = {
  label: `${RANKING_FONT_FAMILY}, "Arial Black", sans-serif`,
  number: `${RANKING_FONT_FAMILY}, "Arial Black", sans-serif`,
  title: `${RANKING_FONT_FAMILY}, "Arial Black", sans-serif`,
}

const W = RANKING_WIDTH
const H = RANKING_HEIGHT
const SIDE = 44
const TITLE_MAX_SIZE = 86
const TITLE_MIN_SIZE = 40
const BAND_PAD = 42
const BAND_MIN = 220
const LIST_LEFT = 64
const ROW_MAX_GAP = 178
const NUMBER_MAX_SIZE = 86
const WORD_GAP = 0.28

export type RankingLayout = {
  bandHeight: number
  numberSize: number
  /** Where each rank's row sits (its text's middle), by rank. */
  rowY: Map<number, number>
  titleLineHeight: number
  titleSize: number
}

const fontOf = (size: number, family: string, weight = 800) => `${weight} ${size}px ${family}`

/** A part's family: its chosen pack font first (loaded as `RME <id>`), then the default's. */
export const familyFor = (id: RankingFontId | undefined, fallback: string) =>
  id && id !== 'montserrat' ? `"${rankingFontFamily(id)}", ${fallback}` : fallback

/** The project's fonts with its style's choices applied. */
export function projectFonts(project: RankingProject, fonts: RankingFonts): RankingFonts {
  const { labelFont, numberFont, titleFont } = project.style
  return {
    label: familyFor(labelFont, fonts.label),
    number: familyFor(numberFont, fonts.number),
    title: familyFor(titleFont, fonts.title),
  }
}

function lineWidth(
  ctx: RankingCanvas,
  line: RankingTitleWord[],
  size: number,
  family: string,
): number {
  ctx.font = fontOf(size, family)
  const words = line.filter((w) => w.text.trim())
  const gap = size * WORD_GAP
  return (
    words.reduce((sum, w) => sum + ctx.measureText(w.text.trim()).width, 0) +
    gap * Math.max(0, words.length - 1)
  )
}

/** Sizes and positions for a project: the title shrinks to fit the width, rows spread to fit. */
export function rankingLayout(
  ctx: RankingCanvas,
  project: RankingProject,
  base: RankingFonts = DEFAULT_RANKING_FONTS,
): RankingLayout {
  const fonts = projectFonts(project, base)
  const lines = project.title.lines.filter((line) => line.some((w) => w.text.trim()))
  let titleSize = TITLE_MAX_SIZE
  while (
    titleSize > TITLE_MIN_SIZE &&
    lines.some((line) => lineWidth(ctx, line, titleSize, fonts.title) > W - SIDE * 2)
  )
    titleSize -= 2
  const titleLineHeight = Math.round(titleSize * 1.16)
  const bandHeight = Math.max(BAND_MIN, BAND_PAD * 2 + titleLineHeight * Math.max(1, lines.length))

  const count = project.items.length
  const area = H - bandHeight
  const top = bandHeight + area * 0.24
  const span = area * 0.6
  const gap = count > 1 ? Math.min(ROW_MAX_GAP, span / (count - 1)) : 0
  const numberSize = Math.round(Math.min(NUMBER_MAX_SIZE, gap ? gap * 0.6 : NUMBER_MAX_SIZE))
  const rowY = new Map<number, number>()
  const ranks = project.items.map((item) => item.rank).toSorted((a, b) => a - b)
  ranks.forEach((rank, i) => rowY.set(rank, Math.round(top + gap * i)))
  return { bandHeight, numberSize, rowY, titleLineHeight, titleSize }
}

function outlined(
  ctx: RankingCanvas,
  text: string,
  x: number,
  y: number,
  fill: string,
  outline: string,
  size: number,
) {
  ctx.lineJoin = 'round'
  ctx.miterLimit = 2
  ctx.lineWidth = Math.max(4, size * 0.16)
  ctx.strokeStyle = outline
  ctx.strokeText(text, x, y)
  ctx.fillStyle = fill
  ctx.fillText(text, x, y)
}

/** A label that fits the space after its number: shrunk down to 70%, then cut with an ellipsis. */
function fitLabel(ctx: RankingCanvas, text: string, size: number, family: string, room: number) {
  let s = size
  ctx.font = fontOf(s, family)
  while (ctx.measureText(text).width > room && s > size * 0.7) {
    s -= 2
    ctx.font = fontOf(s, family)
  }
  let out = text
  while (out.length > 1 && ctx.measureText(out).width > room) {
    out = out.slice(0, -2).trimEnd() + '…'
    if (out === '…') break
  }
  return { size: s, text: out }
}

/**
 * Draws the overlay for a moment of the short: the band and title, every rank number, and the
 * labels of `revealed` ranks. The rest of the frame stays clear (the clip shows through), unless
 * `background` paints it (the studio's empty preview).
 */
export function drawRankingOverlay(
  ctx: RankingCanvas,
  project: RankingProject,
  revealed: readonly number[] | ReadonlySet<number>,
  opts: {
    background?: string
    fonts?: RankingFonts
    /** Pictures for picture stickers, by their URL (one not loaded yet is skipped). */
    images?: ReadonlyMap<string, StickerImage>
    /** Moving stickers (animated or timed): `still` draws them at rest (the studio while
     *  stopped), `skip` leaves them out (the export animates them itself), or a function gives
     *  each one's pose now (null: not shown). Default `still`. */
    moving?: 'skip' | 'still' | ((sticker: RankingSticker) => null | StickerPose)
    /** The rank playing now: its stickers show, with the whole short's (undefined: none of a rank's). */
    rank?: null | number
  } = {},
): RankingLayout {
  const base = opts.fonts ?? DEFAULT_RANKING_FONTS
  const fonts = projectFonts(project, base)
  const shown = new Set(revealed)
  const layout = rankingLayout(ctx, project, base)
  ctx.save()
  ctx.clearRect(0, 0, W, H)
  if (opts.background) {
    ctx.fillStyle = opts.background
    ctx.fillRect(0, 0, W, H)
  }

  // The title band, each line centred, word by word in its own colour.
  ctx.fillStyle = project.title.band
  ctx.fillRect(0, 0, W, layout.bandHeight)
  const lines = project.title.lines.filter((line) => line.some((w) => w.text.trim()))
  const blockTop = (layout.bandHeight - layout.titleLineHeight * lines.length) / 2
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  lines.forEach((line, i) => {
    const words = line.filter((w) => w.text.trim())
    const width = lineWidth(ctx, words, layout.titleSize, fonts.title)
    let x = (W - width) / 2
    const y = blockTop + layout.titleLineHeight * (i + 0.5)
    ctx.font = fontOf(layout.titleSize, fonts.title)
    for (const word of words) {
      ctx.fillStyle = word.color
      ctx.fillText(word.text.trim(), x, y)
      x += ctx.measureText(word.text.trim()).width + layout.titleSize * WORD_GAP
    }
  })

  // The ranks: every number, and the labels revealed so far.
  const [c1, c2, c3, rest] = project.style.numberColors
  const numberColor = (rank: number) => (rank === 1 ? c1 : rank === 2 ? c2 : rank === 3 ? c3 : rest)
  for (const item of project.items) {
    const y = layout.rowY.get(item.rank)
    if (y === undefined) continue
    ctx.font = fontOf(layout.numberSize, fonts.number, 900)
    const number = rankMark(project.style, item.rank)
    outlined(
      ctx,
      number,
      LIST_LEFT,
      y,
      numberColor(item.rank),
      project.style.outlineColor,
      layout.numberSize,
    )
    if (!shown.has(item.rank) || !item.label.trim()) continue
    const labelX = LIST_LEFT + ctx.measureText(number).width + layout.numberSize * 0.12
    const label = fitLabel(
      ctx,
      item.label.trim(),
      Math.round(layout.numberSize * 0.8),
      fonts.label,
      W - labelX - SIDE,
    )
    ctx.font = fontOf(label.size, fonts.label)
    outlined(
      ctx,
      label.text,
      labelX,
      y,
      project.style.labelColor,
      project.style.outlineColor,
      label.size,
    )
  }

  // Stickers on top: the whole short's, and the playing rank's.
  for (const sticker of project.stickers ?? []) {
    if (sticker.rank !== null && sticker.rank !== opts.rank) continue
    const moving = opts.moving ?? 'still'
    let pose: null | StickerPose | undefined
    if (isMovingSticker(sticker) && moving !== 'still') {
      if (moving === 'skip') continue
      pose = moving(sticker)
      if (!pose) continue
    }
    drawSticker(ctx, sticker, project.style.outlineColor, fonts, opts.images, pose ?? undefined)
  }
  ctx.restore()
  return layout
}

/** One sticker at its place, size and angle: text or emoji outlined like the labels, or a picture. */
export function drawSticker(
  ctx: RankingCanvas,
  sticker: RankingSticker,
  outline: string,
  fonts: RankingFonts = DEFAULT_RANKING_FONTS,
  images?: ReadonlyMap<string, StickerImage>,
  /** Where it is in its animation (missing: at rest). */
  pose?: StickerPose,
): void {
  if (pose && (pose.alpha <= 0 || pose.scale <= 0)) return
  ctx.save()
  ctx.translate((sticker.x + (pose?.dx ?? 0)) * W, (sticker.y + (pose?.dy ?? 0)) * H)
  if (pose) {
    ctx.globalAlpha = pose.alpha
    ctx.scale(pose.scale, pose.scale)
  }
  if (sticker.rotation) ctx.rotate((sticker.rotation * Math.PI) / 180)
  if (sticker.kind === 'text' && sticker.text) {
    const size = Math.round(sticker.size * H)
    // Slanted like comic lettering: a shear, so every font can do it.
    if (sticker.italic) ctx.transform(1, 0, -0.2, 1, 0, 0)
    ctx.font = fontOf(size, familyFor(sticker.font, fonts.label), 900)
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    outlined(ctx, sticker.text, 0, 0, sticker.color, outline, size)
  } else if (sticker.kind === 'image' && sticker.imageUrl) {
    const image = images?.get(sticker.imageUrl)
    if (image && image.width > 0) {
      const w = sticker.size * W
      const h = (w * image.height) / image.width
      ctx.drawImage(image.source as never, -w / 2, -h / 2, w, h)
    }
  }
  ctx.restore()
}

/**
 * A sticker's size at rest, before its angle, as fractions of the frame's width and height: the
 * box to select and drag it by. A picture not loaded yet is taken as 16:9.
 */
export function stickerBox(
  ctx: RankingCanvas,
  sticker: RankingSticker,
  fonts: RankingFonts = DEFAULT_RANKING_FONTS,
  images?: ReadonlyMap<string, StickerImage>,
): { h: number; w: number } {
  if (sticker.kind === 'image') {
    const image = sticker.imageUrl ? images?.get(sticker.imageUrl) : undefined
    const ratio = image && image.width > 0 ? image.height / image.width : 9 / 16
    return { h: (sticker.size * W * ratio) / H, w: sticker.size }
  }
  const size = Math.round(sticker.size * H)
  ctx.save()
  ctx.font = fontOf(size, familyFor(sticker.font, fonts.label), 900)
  // The outline adds about a tenth of the size on each side; a slant leans the top out.
  const width = ctx.measureText(sticker.text ?? '').width + size * (sticker.italic ? 0.45 : 0.25)
  ctx.restore()
  return { h: (size * 1.25) / H, w: width / W }
}

/**
 * A transition slide: the whole frame in the slide's colour, its text big and centred (shrunk to
 * fit, outlined like the labels). Drawn into the same 1080x1920 frame as the overlay.
 */
export function drawRankingTransition(
  ctx: RankingCanvas,
  project: RankingProject,
  nextRank: number,
  base: RankingFonts = DEFAULT_RANKING_FONTS,
): void {
  const fonts = projectFonts(project, base)
  const transition = transitionOf(project)
  const text = transitionText(transition, nextRank)
  ctx.save()
  ctx.clearRect(0, 0, W, H)
  ctx.fillStyle = transition.background
  ctx.fillRect(0, 0, W, H)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  let size = 150
  ctx.font = fontOf(size, fonts.title, 900)
  while (size > 48 && ctx.measureText(text).width > W - SIDE * 2) {
    size -= 4
    ctx.font = fontOf(size, fonts.title, 900)
  }
  if (text)
    outlined(ctx, text, W / 2, H / 2, transition.textColor, project.style.outlineColor, size)
  ctx.restore()
}
