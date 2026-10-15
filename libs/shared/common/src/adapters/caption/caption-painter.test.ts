import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { type Canvas, type CanvasRenderingContext2D, createCanvas, loadImage } from 'canvas'

import { presetPackDir, RENDER_PRESETS } from '../../storage/presets'

import { boxShadowPixels } from './box-shadow'
import { CAPTION_PACK_FAMILIES, CAPTION_PACK_FONTS } from './caption-fonts'
import {
  captionFrameAt,
  captionFrameKey,
  type CaptionMeasureText,
  layoutCaptionSegment,
} from './caption-layout'
import {
  buildCaptionOverlay,
  captionFontFile,
  type CaptionOverlay,
  type CaptionSegment,
  captionStripBounds,
  createCaptionPainter,
  frameRateRational,
  withoutZeroDurationWords,
} from './caption-painter'
import { resolveCaptionRenderPref } from './caption-style'

const STYLE: CaptionSegment['style'] = {
  animationColor: '#04f827',
  fontColor: '#ffffff',
  fontFamily: 'Montserrat',
  fontSize: 35,
  fontWeight: 900,
  shadowBlur: 2,
  shadowColor: '#000000',
  shadowOffsetX: 2,
  shadowOffsetY: 2,
  strokeColor: '#000000',
  strokeWidth: 8,
}

const TWO_WORDS: CaptionSegment = {
  in: 1000,
  out: 2000,
  position: [0, -0.617],
  style: STYLE,
  texts: [
    { in: 0, out: 500, t: 'HELLO' },
    { in: 500, out: 1000, t: 'WORLD' },
  ],
}

function listOf(overlay: CaptionOverlay | undefined): string {
  const listFile = overlay?.inputArgs.at(-1)
  if (!listFile) throw new Error('no caption overlay')
  return listFile
}

/** Parses the ffconcat list into entries: file, its frame-rate option and duration. */
function readList(listFile: string) {
  const lines = fs.readFileSync(listFile, 'utf8').split('\n')
  expect(lines[0]).toBe('ffconcat version 1.0')
  const entries: Array<{ durationSec?: number; file: string; rate?: string }> = []
  for (const line of lines.slice(1)) {
    if (line.startsWith('file ')) entries.push({ file: line.replace(/^file '|'$/g, '') })
    else if (line.startsWith('option framerate ')) {
      const last = entries.at(-1)
      if (last) last.rate = line.replace('option framerate ', '')
    } else if (line.startsWith('duration ')) {
      const last = entries.at(-1)
      if (last) last.durationSec = Number(line.replace('duration ', ''))
    }
  }
  // The last file is repeated without a duration so the demuxer honours the one before it.
  const tail = entries.pop()
  expect(tail?.durationSec).toBeUndefined()
  expect(tail?.file).toBe(entries.at(-1)?.file)
  return { entries, tailRate: tail?.rate }
}

/** A stamp label short enough to sit inside a 308 px strip in any fallback face. */
const SHORT_LABEL = '1969'

describe('buildCaptionOverlay', () => {
  let workDir: string
  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'captions-'))
  })
  afterEach(() => fs.rmSync(workDir, { force: true, recursive: true }))

  const build = (
    segments: CaptionSegment[],
    extra: { fps?: number; timeRangeMs?: [number, number] } = {},
  ) =>
    buildCaptionOverlay({
      // No font bundle here: the system sans-serif stands in for Montserrat.
      fontsDir: path.join(workDir, 'no-fonts'),
      fps: extra.fps ?? 25,
      frame: { height: 1920, width: 1080 },
      segments,
      timeRangeMs: extra.timeRangeMs,
      totalSec: 3,
      workDir,
    })

  it('samples the caption once per frame and reuses unchanged images', async () => {
    const overlay = await build([TWO_WORDS])
    const { entries } = readList(listOf(overlay))
    const total = entries.reduce((sum, e) => sum + (e.durationSec ?? 0), 0)
    expect(total).toBeCloseTo(3, 6)

    // Blank until 1 s, then each word: 160 ms of pulse at 40 ms a frame is 4 images, then one
    // image held for the rest of the word; blank again after 2 s.
    const files = entries.map((e) => path.basename(e.file))
    expect(files[0]).toBe(files.at(-1))
    expect(entries[0].durationSec).toBeCloseTo(1, 6)
    const word = entries.slice(1, -1)
    expect(word).toHaveLength(10)
    expect(word.slice(0, 4).every((e) => e.durationSec === 0.04)).toBe(true)
    expect(word[4].durationSec).toBeCloseTo(0.36, 6)
    expect(new Set(files).size).toBe(11)
    for (const file of new Set(entries.map((e) => e.file))) expect(fs.existsSync(file)).toBe(true)

    // The strip covers the caption texture centred 19% above the bottom.
    expect(overlay?.y).toBeGreaterThan(1400)
    expect(overlay?.y).toBeLessThan(1552)
  })

  it.each([
    [30, '30'],
    [30000 / 1001, '30000/1001'],
  ])('pins every image to the %s fps grid', async (fps, rational) => {
    const { entries, tailRate } = readList(listOf(await build([TWO_WORDS], { fps })))
    // Every file carries the frame rate, or the demuxer falls back to a 1/25 s time base.
    expect(entries.every((e) => e.rate === rational)).toBe(true)
    expect(tailRate).toBe(rational)
    // Each duration is a whole number of frames and they add up to the whole timeline.
    const frames = entries.map((e) => (e.durationSec ?? 0) * fps)
    for (const n of frames) expect(Math.abs(n - Math.round(n))).toBeLessThan(1e-4)
    const total = frames.reduce((sum, n) => sum + Math.round(n), 0)
    expect(total).toBe(Math.ceil(3 * fps - 1e-6))
    // At 30 fps the 160 ms pulse spans frames 0..4 of the word (t = 0, 33, 67, 100, 133 ms).
    expect(entries.slice(1, 6).every((e) => Math.round((e.durationSec ?? 0) * fps) === 1)).toBe(
      true,
    )
  })

  it('leaves frames outside a requested range blank', async () => {
    const overlay = await build(
      [
        {
          in: 0,
          out: 3000,
          position: [0, -0.617],
          style: STYLE,
          texts: [{ in: 0, out: 3000, t: 'HELLO' }],
        },
      ],
      { timeRangeMs: [2000, 2040] },
    )
    const { entries } = readList(listOf(overlay))
    expect(new Set(entries.map((e) => e.file)).size).toBe(2)
  })

  it('returns nothing without words', async () => {
    expect(await build([{ in: 0, out: 1000, style: STYLE, texts: [] }])).toBeUndefined()
  })

  it('draws no word the next one starts with, as the engine drops it', async () => {
    const pngs = async (texts: CaptionSegment['texts']) => {
      const dir = fs.mkdtempSync(path.join(workDir, 'run-'))
      const overlay = await buildCaptionOverlay({
        fontsDir: path.join(workDir, 'no-fonts'),
        fps: 25,
        frame: { height: 1920, width: 1080 },
        segments: [{ ...TWO_WORDS, texts }],
        totalSec: 3,
        workDir: dir,
      })
      return readList(listOf(overlay)).entries.map((e) => [
        e.durationSec,
        fs.readFileSync(e.file).toString('base64'),
      ])
    }
    const kept = TWO_WORDS.texts
    const withGhost = [{ in: 0, out: 0, t: 'GHOST' }, ...kept]
    expect(await pngs(withGhost)).toEqual(await pngs(kept))
  })

  it('fails the build when an image cannot be written', async () => {
    // The first image (blank) fails while it is the only write in flight. Over 256 unchanged
    // frames follow before the caption starts, so the loop yields, the failed write settles
    // and leaves the pending set; the build must still fail rather than leave a missing image
    // in the concat list.
    const realWrite = fs.promises.writeFile
    let calls = 0
    const spy = jest.spyOn(fs.promises, 'writeFile').mockImplementation((...args) => {
      calls += 1
      if (calls === 1) return Promise.reject(new Error('disk full'))
      return realWrite(...(args as Parameters<typeof realWrite>))
    })
    try {
      const late = buildCaptionOverlay({
        fontsDir: path.join(workDir, 'no-fonts'),
        fps: 25,
        frame: { height: 1920, width: 1080 },
        segments: [{ ...TWO_WORDS, in: 12_000, out: 13_000 }],
        totalSec: 15,
        workDir,
      })
      await expect(late).rejects.toThrow('disk full')
    } finally {
      spy.mockRestore()
    }
  })
})

describe('preset boxes and rotation', () => {
  let workDir: string
  beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'caption-boxes-'))
  })
  afterEach(() => fs.rmSync(workDir, { force: true, recursive: true }))

  const PAPER = '#f6f2e7'
  const FRAME = { height: 1920, width: 1080 }
  // An Explainer strip: dark text on a paper box, no stroke, a text shadow to keep off the box.
  const strip = (extra: Partial<CaptionSegment> = {}): CaptionSegment => ({
    in: 0,
    lineCount: 3,
    out: 2000,
    position: [0, -0.617],
    style: {
      animationBgColor: PAPER,
      animationColor: '#111111',
      fontColor: '#111111',
      fontSize: 40,
      fontWeight: 700,
      shadowBlur: 2,
      shadowColor: '#000000',
      shadowOffsetX: 2,
      shadowOffsetY: 2,
    },
    texts: [
      { in: 0, out: 400, t: 'Sealed' },
      { in: 2500, out: 2900, t: 'in' },
      { in: 3000, out: 3400, t: 'tombs' },
    ],
    uri: 'caption-preset://deep-diver',
    ...extra,
  })
  const painterAt = () => createCaptionPainter(path.join(workDir, 'no-fonts'))
  const rgba = (canvas: Canvas, x: number, y: number) => [
    ...canvas.getContext('2d').getImageData(Math.round(x), Math.round(y), 1, 1).data,
  ]
  const PAPER_RGBA = [0xf6, 0xf2, 0xe7, 255]
  const INK_RGBA = [0x11, 0x11, 0x11, 255]

  it('fills a rounded box under the text, without the text shadow', () => {
    const painter = painterAt()
    const layout = layoutCaptionSegment(strip(), FRAME, painter.measure)
    const frame = captionFrameAt(layout, 500, painter.measure)
    if (!frame) throw new Error('no caption')
    const [box] = frame.boxes
    const texture = painter.drawTexture(layout, frame)
    // Inside, in the margin beside the text.
    expect(rgba(texture, box.x + 4, box.y + box.h / 2)).toEqual(PAPER_RGBA)
    expect(rgba(texture, box.x + box.w - 4, box.y + box.h / 2)).toEqual(PAPER_RGBA)
    // The words are drawn over it: across the first word, on its line's middle row, there is ink.
    const [sealed] = frame.words
    const row = sealed.y + layout.words[0].height / 2
    const across = Array.from({ length: layout.words[0].width }, (_, i) =>
      rgba(texture, sealed.x + i, row),
    )
    expect(across).toContainEqual(INK_RGBA)
    // The corners are rounded off; nothing outside the box, no shadow under it.
    expect(rgba(texture, box.x + 1, box.y + 1)[3]).toBe(0)
    expect(rgba(texture, box.x + box.w - 2, box.y + box.h - 2)[3]).toBe(0)
    expect(rgba(texture, box.x - 2, box.y + box.h / 2)[3]).toBe(0)
    expect(rgba(texture, box.x + box.w - 4, box.y + box.h + 2)[3]).toBe(0)
  })

  it("fills a fact stamp's strip to its square corners, under the text, with no deep-diver box", () => {
    const painter = painterAt()
    const STRIP = { color: '#04f827', h: 76, offsetY: 4.83, w: 308 }
    const layout = layoutCaptionSegment(
      strip({ lineCount: 1, strip: STRIP, texts: [{ in: 0, out: 2000, t: SHORT_LABEL }] }),
      FRAME,
      painter.measure,
    )
    const frame = captionFrameAt(layout, 500, painter.measure)
    if (!frame) throw new Error('no caption')
    const [box] = frame.boxes
    // Without the font pack (CI) the label is drawn in the system face, wider on Linux: keep it
    // well inside the strip so only the strip and its shadow are ever outside the words.
    expect(layout.words[0].width).toBeLessThan(box.w - 60)
    const texture = painter.drawTexture(layout, frame)
    const GREEN = [0x04, 0xf8, 0x27, 255]
    // Filled 2 px in from every corner: the strip's corners are square (a rounded box's 12 px
    // radius would leave them clear).
    expect(rgba(texture, box.x + 2, box.y + 2)).toEqual(GREEN)
    expect(rgba(texture, box.x + box.w - 2, box.y + 2)).toEqual(GREEN)
    expect(rgba(texture, box.x + 2, box.y + box.h - 2)).toEqual(GREEN)
    expect(rgba(texture, box.x + box.w - 2, box.y + box.h - 2)).toEqual(GREEN)
    // Nothing outside it: no paper box around it.
    expect(rgba(texture, box.x - 3, box.y + box.h / 2)[3]).toBe(0)
    expect(rgba(texture, box.x + box.w / 2, box.y - 3)[3]).toBe(0)
    expect(rgba(texture, box.x + box.w + 3, box.y + box.h / 2)[3]).toBe(0)
    // The words are drawn over it.
    const [word] = frame.words
    const row = word.y + layout.words[0].height / 2
    const across = Array.from({ length: layout.words[0].width }, (_, i) =>
      rgba(texture, word.x + i, row),
    )
    expect(across).toContainEqual(INK_RGBA)
  })

  it("draws a fact stamp's shadow under its strip, from the pixels the editor's strip image has", () => {
    const painter = painterAt()
    const SHADOW = { offsetY: 4, opacity: 0.3, sigma: 6 }
    const STRIP = { color: '#04f827', h: 76, offsetY: 4.83, shadow: SHADOW, w: 308 }
    const layout = layoutCaptionSegment(
      strip({ lineCount: 1, strip: STRIP, texts: [{ in: 0, out: 2000, t: SHORT_LABEL }] }),
      FRAME,
      painter.measure,
    )
    const frame = captionFrameAt(layout, 500, painter.measure)
    if (!frame) throw new Error('no caption')
    const [box] = frame.boxes
    // Without the font pack (CI) the label is drawn in the system face, wider on Linux: keep it
    // well inside the strip so only the strip and its shadow are ever outside the words.
    expect(layout.words[0].width).toBeLessThan(box.w - 60)
    const texture = painter.drawTexture(layout, frame)
    const pixels = boxShadowPixels(box, SHADOW)
    // The shadow image's alpha at a point of the texture: placed with the box at its margin,
    // sampled between pixel centres as drawImage does at a fractional place.
    const left = box.x - pixels.margin
    const top = box.y - pixels.margin
    const shadowAlpha = (x: number, y: number) => {
      const u = x - left
      const v = y - top
      const x0 = Math.floor(u)
      const y0 = Math.floor(v)
      const at = (i: number, j: number) =>
        i < 0 || j < 0 || i >= pixels.width || j >= pixels.height
          ? 0
          : pixels.data[(j * pixels.width + i) * 4 + 3]
      const fx = u - x0
      const fy = v - y0
      return (
        at(x0, y0) * (1 - fx) * (1 - fy) +
        at(x0 + 1, y0) * fx * (1 - fy) +
        at(x0, y0 + 1) * (1 - fx) * fy +
        at(x0 + 1, y0 + 1) * fx * fy
      )
    }
    const midX = Math.round(box.x + box.w / 2)
    const bottom = Math.ceil(box.y + box.h)
    // Below the strip: black, fading as the image does.
    for (let y = bottom + 1; y < bottom + 20; y++) {
      const [r, g, b, a] = rgba(texture, midX, y)
      expect([r, g, b]).toEqual([0, 0, 0])
      expect(Math.abs(a - shadowAlpha(midX, y))).toBeLessThanOrEqual(2)
    }
    expect(rgba(texture, midX, bottom + 2)[3]).toBeGreaterThan(35)
    // Beside it, evenly.
    const midY = Math.round(box.y + box.h / 2)
    for (let d = 2; d < 18; d++) {
      const x = Math.floor(box.x) - d
      expect(Math.abs(rgba(texture, x, midY)[3] - shadowAlpha(x, midY))).toBeLessThanOrEqual(2)
    }
    // Under the strip, the strip: its corners still square and its colour untouched.
    const GREEN = [0x04, 0xf8, 0x27, 255]
    expect(rgba(texture, box.x + 2, box.y + 2)).toEqual(GREEN)
    expect(rgba(texture, box.x + box.w - 2, box.y + box.h - 2)).toEqual(GREEN)
    // And nothing past the image's margin.
    expect(rgba(texture, midX, box.y + box.h + pixels.margin + 2)[3]).toBe(0)
  })

  /** The first row from the top where column `x` of `canvas` is paper. */
  const paperTop = (canvas: Canvas, x: number) => {
    for (let y = 0; y < canvas.height; y++) {
      const [r, g, b, a] = rgba(canvas, x, y)
      if (a === 255 && Math.abs(r - 0xf6) + Math.abs(g - 0xf2) + Math.abs(b - 0xe7) < 12) return y
    }
    return -1
  }

  it.each([
    [5, 1],
    [-5, -1],
  ])('turns the caption %s degrees about its centre (clockwise positive)', (deg, sign) => {
    const painter = painterAt()
    const layout = layoutCaptionSegment(strip({ rotate: deg }), FRAME, painter.measure)
    const frame = captionFrameAt(layout, 500, painter.measure)
    if (!frame) throw new Error('no caption')
    const canvas = createCanvas(FRAME.width, FRAME.height)
    painter.place(canvas.getContext('2d'), layout, frame, 0)
    const { centerX, centerY } = layout.texture
    const [left, right] = [paperTop(canvas, centerX - 200), paperTop(canvas, centerX + 200)]
    // 400 px apart: the top edge drops (or rises) by 400 x tan(5 deg) = 35 px.
    expect(sign * (right - left)).toBeGreaterThan(32)
    expect(sign * (right - left)).toBeLessThan(38)
    // The box stays centred on the caption centre.
    const [box] = frame.boxes
    expect(
      Math.abs((left + right) / 2 - (centerY - layout.texture.height / 2 + box.y)),
    ).toBeLessThan(3)
  })

  it('makes the strip tall enough for the turned caption', async () => {
    const overlayOf = (segment: CaptionSegment) =>
      buildCaptionOverlay({
        fontsDir: path.join(workDir, 'no-fonts'),
        fps: 25,
        frame: FRAME,
        segments: [segment],
        totalSec: 1,
        workDir: fs.mkdtempSync(path.join(workDir, 'run-')),
      })
    const flat = await overlayOf(strip())
    const turned = await overlayOf(strip({ rotate: -3 }))
    const painter = painterAt()
    const layout = layoutCaptionSegment(strip({ rotate: -3 }), FRAME, painter.measure)
    const { centerY, height, width } = layout.texture
    const sin = Math.sin((3 * Math.PI) / 180)
    const cos = Math.cos((3 * Math.PI) / 180)
    expect(turned?.y).toBeLessThanOrEqual(Math.floor(centerY - (width * sin + height * cos) / 2))
    expect(turned?.y).toBeLessThan(flat?.y ?? 0)
    // As wide as the text block, not the frame: a frame-wide texture would reach further.
    expect(width).toBeLessThan(FRAME.width * 0.8)
    expect(turned?.y).toBeGreaterThan(centerY - (FRAME.width * sin + height * cos) / 2)
  })

  it('draws segments that start together in the order given: a strip under the caption on it', async () => {
    // Explainer: the paper strip and the accent box layer carry the same words and start together;
    // the strip must be drawn first. No shadow, so the margin of the accent box is its colour.
    const flat = { ...strip().style, shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0 }
    const paper = strip({ style: flat })
    const accent = strip({
      style: { ...flat, animationBgColor: '#04f827' },
      uri: 'caption-preset://word-level_simple_bg-highlight',
    })
    const pixelAtBox = async (segments: CaptionSegment[]) => {
      const overlay = await buildCaptionOverlay({
        fontsDir: path.join(workDir, 'no-fonts'),
        fps: 25,
        frame: FRAME,
        segments,
        totalSec: 1,
        workDir: fs.mkdtempSync(path.join(workDir, 'run-')),
      })
      const painter = painterAt()
      const layout = layoutCaptionSegment(accent, FRAME, painter.measure)
      const [box] = captionFrameAt(layout, 480, painter.measure)?.boxes ?? []
      const { centerX, centerY, height, width } = layout.texture
      const image = await loadImage(fileAtFrame(readList(listOf(overlay)).entries, 12, 25))
      const canvas = createCanvas(image.width, image.height)
      canvas.getContext('2d').drawImage(image, 0, 0)
      // In the accent box's left margin, beside the active word, on the overlay image.
      const x = centerX - width / 2 + box.x + 2
      const y = centerY - height / 2 + box.y + box.h / 2 - (overlay?.y ?? 0)
      return rgba(canvas, x, y)
    }
    expect(await pixelAtBox([paper, accent])).toEqual([0x04, 0xf8, 0x27, 255])
    expect(await pixelAtBox([accent, paper])).toEqual(PAPER_RGBA)
  })

  it('draws highlight-color words at their size, with no pop', () => {
    const painter = painterAt()
    const segment: CaptionSegment = {
      ...TWO_WORDS,
      uri: 'caption-preset://word-level_highlight_color',
    }
    const layout = layoutCaptionSegment(segment, FRAME, painter.measure)
    const frame = captionFrameAt(layout, 1000, painter.measure)
    expect(frame?.words.map((w) => w.px)).toEqual([
      layout.basePt * (4 / 3),
      layout.basePt * (4 / 3),
    ])
    expect(frame?.scaleX).toBe(1)
  })
})

describe('withoutZeroDurationWords', () => {
  const word = (t: string, at: number) => ({ in: at, out: at + 100, t })

  it('drops each word the next word starts with, keeping the last of a run', () => {
    const segment: CaptionSegment = {
      in: 0,
      out: 2000,
      style: STYLE,
      texts: [word('A', 0), word('B', 0), word('C', 0), word('D', 500), word('E', 900)],
    }
    expect(withoutZeroDurationWords(segment).texts.map((w) => w.t)).toEqual(['C', 'D', 'E'])
    // The input is left alone.
    expect(segment.texts).toHaveLength(5)
  })

  it('keeps the last word, which the engine holds past its end', () => {
    const texts = [word('A', 0), word('B', 400), word('C', 400)]
    const segment: CaptionSegment = { in: 0, out: 2000, style: STYLE, texts }
    expect(withoutZeroDurationWords(segment).texts.map((w) => w.t)).toEqual(['A', 'C'])
  })

  it('returns the same segment when every word has a duration', () => {
    expect(withoutZeroDurationWords(TWO_WORDS)).toBe(TWO_WORDS)
  })
})

/** The file names of the render font pack (presets render/fonts.tar.gz, unchanged since v006). */
const PACK_FONTS = [
  'Alegreya-Black.ttf',
  'Alegreya-Bold.ttf',
  'Alegreya-ExtraBold.ttf',
  'Alegreya-Medium.ttf',
  'Alegreya-Regular.ttf',
  'Alegreya-SemiBold.ttf',
  'Anton-Regular.ttf',
  'DMSans-Bold.ttf',
  'DMSans-BoldItalic.ttf',
  'DMSans-Italic.ttf',
  'DMSans-Medium.ttf',
  'DMSans-MediumItalic.ttf',
  'DMSans-Regular.ttf',
  'Dela Gothic One.ttf',
  'DelaGothicOne-Regular.ttf',
  'Inter.ttf',
  'Montserrat-Black.ttf',
  'Montserrat-BlackItalic.ttf',
  'Montserrat-Bold.ttf',
  'Montserrat-BoldItalic.ttf',
  'Montserrat-ExtraBold.ttf',
  'Montserrat-ExtraLight.ttf',
  'Montserrat-Light.ttf',
  'PTSerif-Bold.ttf',
  'PTSerif-BoldItalic.ttf',
  'PTSerif-Italic.ttf',
  'PTSerif-Regular.ttf',
  'Roboto-Black.ttf',
  'Roboto-Bold.ttf',
  'Roboto-Light.ttf',
  'Roboto-Medium.ttf',
  'Roboto-Regular.ttf',
  'Roboto-SemiBold.ttf',
  'RobotoSerif-Medium.ttf',
  'RobotoSerif-Regular.ttf',
  'RobotoSerif-SemiBold.ttf',
]

describe('captionFontFile', () => {
  const fileOf = (family: string, weight: number, italic = false) =>
    captionFontFile(PACK_FONTS, { family, italic, weight })?.file

  it('finds the pack file of a family and weight, spaces dropped from the family', () => {
    expect(fileOf('Montserrat', 900)).toBe('Montserrat-Black.ttf')
    expect(fileOf('Montserrat', 700)).toBe('Montserrat-Bold.ttf')
    expect(fileOf('PT Serif', 700)).toBe('PTSerif-Bold.ttf')
    expect(fileOf('PT Serif', 400)).toBe('PTSerif-Regular.ttf')
    expect(fileOf('DM Sans', 500)).toBe('DMSans-Medium.ttf')
    expect(fileOf('Dela Gothic One', 400)).toBe('DelaGothicOne-Regular.ttf')
    expect(fileOf('montserrat', 900)).toBe('Montserrat-Black.ttf')
  })

  it('reports the weight and style of the face it picked', () => {
    expect(
      captionFontFile(PACK_FONTS, { family: 'Montserrat', italic: false, weight: 400 }),
    ).toEqual({ file: 'Montserrat-Light.ttf', italic: false, weight: 300 })
  })

  it('falls back to the nearest weight the pack has, the heavier one on a tie', () => {
    // Montserrat has no Regular in either pack.
    expect(fileOf('Montserrat', 400)).toBe('Montserrat-Light.ttf')
    expect(fileOf('Montserrat', 600)).toBe('Montserrat-Bold.ttf')
    expect(fileOf('PT Serif', 900)).toBe('PTSerif-Bold.ttf')
    expect(fileOf('Anton', 900)).toBe('Anton-Regular.ttf')
    expect(fileOf('Roboto Serif', 700)).toBe('RobotoSerif-SemiBold.ttf')
    // 700 and 900 are as near to 800.
    expect(fileOf('Roboto', 800)).toBe('Roboto-Black.ttf')
  })

  it('picks the italic face when one exists, and the upright one otherwise', () => {
    expect(fileOf('PT Serif', 700, true)).toBe('PTSerif-BoldItalic.ttf')
    expect(fileOf('DM Sans', 400, true)).toBe('DMSans-Italic.ttf')
    expect(fileOf('Montserrat', 900, true)).toBe('Montserrat-BlackItalic.ttf')
    expect(fileOf('Roboto', 700, true)).toBe('Roboto-Bold.ttf')
  })

  it('uses a variable font that carries no weight in its name', () => {
    expect(fileOf('Inter', 700)).toBe('Inter.ttf')
  })

  it('finds nothing for a family the pack lacks, or for other files', () => {
    expect(fileOf('Comic Sans', 400)).toBeUndefined()
    expect(
      captionFontFile(['README.md', 'fonts.tar.gz'], {
        family: 'README',
        italic: false,
        weight: 400,
      }),
    ).toBeUndefined()
  })
})

// The render font pack is installed by `pnpm reelmakeeasy setup`; without it this is skipped.
const fontArchive = (() => {
  try {
    return path.join(presetPackDir(), RENDER_PRESETS.fonts)
  } catch {
    return undefined
  }
})()
const describeWithFontPack = fontArchive && fs.existsSync(fontArchive) ? describe : describe.skip

describeWithFontPack('createCaptionPainter with the installed render fonts', () => {
  let workDir: string
  let fontsDir: string
  beforeAll(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'caption-fonts-'))
    execFileSync('tar', ['-xzf', fontArchive as string, '-C', workDir, 'fonts/PTSerif-Bold.ttf'])
    fontsDir = path.join(workDir, 'fonts')
  })
  afterAll(() => fs.rmSync(workDir, { force: true, recursive: true }))

  it('measures PT Serif Bold with the pack face, not a system stand-in', () => {
    const sample = 'c. 2560 BC'
    const painter = createCaptionPainter(fontsDir)
    const font = { family: 'PT Serif', italic: false, px: 100, weight: 700 }
    const systemWidth = (family: string) => {
      const ctx = createCanvas(1, 1).getContext('2d')
      ctx.font = `700 100px ${family}`
      return ctx.measureText(sample).width
    }
    const width = painter.measure(sample, font).width
    expect(Math.abs(width - systemWidth('sans-serif'))).toBeGreaterThan(2)
    expect(Math.abs(width - systemWidth('serif'))).toBeGreaterThan(2)
  })

  it('measures another spelling of a registered family with the same face', () => {
    const sample = 'c. 2560 BC'
    const font = { italic: false, px: 100, weight: 700 }
    const spaced = createCaptionPainter(fontsDir).measure(sample, { ...font, family: 'PT Serif' })
    const compact = createCaptionPainter(fontsDir).measure(sample, { ...font, family: 'ptserif' })
    expect(compact.width).toBeCloseTo(spaced.width, 3)
  })
})

describeWithFontPack('createCaptionPainter with a chosen caption font', () => {
  let workDir: string
  let fontsDir: string
  beforeAll(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'caption-font-choice-'))
    execFileSync('tar', ['-xzf', fontArchive as string, '-C', workDir])
    fontsDir = path.join(workDir, 'fonts')
  })
  afterAll(() => fs.rmSync(workDir, { force: true, recursive: true }))

  const SAMPLE = 'HAMBURGEFONSTIV 0123'
  const SAMPLES = [SAMPLE, 'c. 2560 BC']
  const measureAs = (css: string) => {
    const ctx = createCanvas(1, 1).getContext('2d')
    ctx.font = css
    return {
      // The ink above the baseline of a capital: the face's capital height at 100 px.
      capHeight: ctx.measureText('H').actualBoundingBoxAscent,
      widths: SAMPLES.map((text) => ctx.measureText(text).width),
    }
  }

  it.each(
    CAPTION_PACK_FAMILIES.flatMap((family) =>
      (['punch', 'explainer'] as const).map((preset) => [family, preset] as const),
    ),
  )('draws %s in %s with the pack face the pref snapped to', (family, preset) => {
    const pref = resolveCaptionRenderPref(
      { font: { family, source: 'pack' }, preset },
      { aspectRatio: '9:16', kind: 'loop' },
    )
    const weight = Number(pref.font.style[0])
    // The file the painter registers is the one the pref names, at the pref's weight.
    expect(captionFontFile(fs.readdirSync(fontsDir), { family, italic: false, weight })).toEqual({
      file: pref.fontFace?.file,
      italic: false,
      weight,
    })
    const painter = createCaptionPainter(fontsDir)
    const layout = layoutCaptionSegment(
      {
        ...TWO_WORDS,
        style: {
          ...STYLE,
          fontFamily: pref.font.family,
          fontSize: pref.font.numericalSize,
          fontWeight: weight,
        },
      },
      { height: 1920, width: 1080 },
      painter.measure,
    )
    expect(layout.font).toEqual({ family, italic: false, weight })
    // Drawn with the pack face, not a system stand-in: its own capital height and widths.
    const drawn = measureAs(`${weight} 100px "${family}"`)
    expect(Math.abs(drawn.capHeight - CAPTION_PACK_FONTS[family].capHeight * 100)).toBeLessThan(2.5)
    for (const fallback of ['sans-serif', 'serif']) {
      const system = measureAs(`${weight} 100px ${fallback}`)
      const apart = drawn.widths.map((w, i) => Math.abs(w - (system.widths[i] as number)))
      expect(Math.max(...apart)).toBeGreaterThan(2)
    }
  })

  it("draws each of a family's snapped weights with its own face", () => {
    const painter = createCaptionPainter(fontsDir)
    const widthAt = (weight: number) =>
      painter.measure(SAMPLE, { family: 'Roboto', italic: false, px: 100, weight }).width
    // Punch's Roboto Black and Explainer's Roboto Bold.
    expect(widthAt(900)).toBeGreaterThan(widthAt(700) + 2)
  })
})

/**
 * Classic (fill-pop) must stay exactly as it was drawn before the other presets were added
 * (28d5e9de). Two goldens hold it there, on the same cases (25 fps, 2 s):
 * - the layout golden runs everywhere, CI included: with the monospaced measure stand-in, what
 *   every output frame shows (each caption's frame key: words, positions, sizes, colours, scale),
 *   where `place` puts it and the strip it is drawn in (`<case>-layout.json`);
 * - the image golden compares the images (`<case>-<frame>.png`), drawn with the pack's
 *   Montserrat. Glyph rasterising differs between node-canvas builds, so it runs on macOS with
 *   the render font pack installed only (where they were drawn).
 * `UPDATE_CAPTION_GOLDENS=1` records them again; only do that for an intended change.
 */
const GOLDEN_DIR = path.join(__dirname, '__fixtures__', 'classic-golden')
const UPDATE_GOLDENS = process.env['UPDATE_CAPTION_GOLDENS'] === '1'
const describeClassicGolden = process.platform === 'darwin' ? describeWithFontPack : describe.skip

interface ClassicCase {
  frame: { height: number; width: number }
  /** Output frame indexes (25 fps) the image golden compares. */
  frames: number[]
  name: string
  segments: CaptionSegment[]
}

const goldenWords = (list: string[], stepMs = 500) =>
  list.map((t, i) => ({ in: i * stepMs, out: (i + 1) * stepMs, t }))
const CLASSIC_CASES: ClassicCase[] = [
  {
    // Pulse start, mid pulse, settled, the next word and the held last word.
    frame: { height: 1920, width: 1080 },
    frames: [25, 27, 30, 38, 49],
    name: 'one-line',
    segments: [
      {
        in: 1000,
        out: 2500,
        position: [0, -0.617],
        style: STYLE,
        texts: goldenWords(['THE', 'PLANET', 'IS']),
      },
    ],
  },
  {
    // lineCount 1 pages through the lines; a word too wide for a line is shrunk.
    frame: { height: 1920, width: 1080 },
    frames: [5, 20, 33, 45],
    name: 'paging',
    segments: [
      {
        in: 0,
        out: 2000,
        position: [0, -0.617],
        style: STYLE,
        texts: goldenWords(['AND', 'THEN', 'SUPERCALIFRAGILISTIC', 'EVERYONE', 'LEFT'], 400),
      },
    ],
  },
  {
    // A custom height, a bigger size (the size slider) and a segment scale.
    frame: { height: 1920, width: 1080 },
    frames: [2, 14],
    name: 'custom-height',
    segments: [
      {
        in: 0,
        out: 2000,
        position: [0, 0.2],
        scale: [1.2, 1.2],
        style: { ...STYLE, fontSize: 45, strokeWidth: 15 },
        texts: goldenWords(['HONEY', 'NEVER', 'SPOILS'], 400),
      },
    ],
  },
  {
    // 16:9, and two segments on screen at once.
    frame: { height: 1080, width: 1920 },
    frames: [3, 12],
    name: 'landscape',
    segments: [
      {
        in: 0,
        out: 1000,
        position: [0, -0.76],
        style: STYLE,
        texts: goldenWords(['WIDE', 'FRAME', 'CAPTION'], 300),
      },
      {
        in: 200,
        out: 1000,
        position: [0, 0.5],
        style: { ...STYLE, animationColor: '#ffe500' },
        texts: [{ highlightColor: '#ff3ea5', in: 0, out: 800, t: 'ABOVE' }],
      },
    ],
  },
]

describe('Classic (fill-pop) layout golden', () => {
  // The monospaced stand-in for Pango of caption-layout.test.ts: every character is 0.6 em wide.
  const monospaced: CaptionMeasureText = (text, font) => ({
    ascent: font.px * 0.95,
    height: font.px * 1.2,
    width: text.length * font.px * 0.6,
  })
  let workDir: string
  beforeAll(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'caption-layout-golden-'))
  })
  afterAll(() => fs.rmSync(workDir, { force: true, recursive: true }))

  /** Every output frame of a case, runs of identical frames merged as the overlay merges them. */
  const traceOf = ({ frame, segments }: ClassicCase) => {
    // Only `place` is used; the texture it draws (with the system sans-serif) is not compared.
    const painter = createCaptionPainter(path.join(workDir, 'no-fonts'))
    const layouts = segments
      .map(withoutZeroDurationWords)
      .sort((a, b) => a.in - b.in)
      .map((segment) => layoutCaptionSegment(segment, frame, monospaced))
    const strip = captionStripBounds(layouts, frame.height)
    if (!strip) throw new Error('no caption strip')
    // Classic never turns, so `place` only calls drawImage: keep where it puts the texture.
    let placed: number[][] = []
    const ctx = {
      drawImage: (_texture: unknown, ...at: number[]) => placed.push(at),
    } as unknown as CanvasRenderingContext2D
    const runs: Array<{ frames: number; shown: unknown[] }> = []
    for (let f = 0; f < 2 * 25; f++) {
      const shown = layouts.flatMap((layout) => {
        const state = captionFrameAt(layout, f * 40, monospaced)
        if (!state) return []
        placed = []
        painter.place(ctx, layout, state, strip.top)
        const { scaleX, scaleY } = state
        return [{ at: placed, key: captionFrameKey(state), scaleX, scaleY }]
      })
      const last = runs.at(-1)
      if (last && JSON.stringify(last.shown) === JSON.stringify(shown)) last.frames++
      else runs.push({ frames: 1, shown })
    }
    return { runs, strip, textures: layouts.map(({ pad, texture }) => ({ pad, texture })) }
  }

  it.each(CLASSIC_CASES)('lays out and places $name as before', (classic) => {
    const golden = path.join(GOLDEN_DIR, `${classic.name}-layout.json`)
    const traced = traceOf(classic)
    if (UPDATE_GOLDENS) fs.writeFileSync(golden, `${JSON.stringify(traced, null, 2)}\n`)
    expect(traced).toEqual(JSON.parse(fs.readFileSync(golden, 'utf8')))
  })
})

describeClassicGolden('Classic (fill-pop) golden frames', () => {
  let workDir: string
  let fontsDir: string
  beforeAll(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'caption-golden-'))
    execFileSync('tar', [
      '-xzf',
      fontArchive as string,
      '-C',
      workDir,
      'fonts/Montserrat-Black.ttf',
    ])
    fontsDir = path.join(workDir, 'fonts')
    if (UPDATE_GOLDENS) fs.mkdirSync(GOLDEN_DIR, { recursive: true })
  })
  afterAll(() => fs.rmSync(workDir, { force: true, recursive: true }))

  it.each(CLASSIC_CASES)('draws $name as before', async ({ frame, frames, name, segments }) => {
    const dir = fs.mkdtempSync(path.join(workDir, `${name}-`))
    const overlay = await buildCaptionOverlay({
      fontsDir,
      fps: 25,
      frame,
      segments,
      totalSec: 2,
      workDir: dir,
    })
    const { entries } = readList(listOf(overlay))
    const meta = path.join(GOLDEN_DIR, `${name}.json`)
    const golden = (index: number) => path.join(GOLDEN_DIR, `${name}-${index}.png`)
    if (UPDATE_GOLDENS) {
      fs.writeFileSync(meta, `${JSON.stringify({ y: overlay?.y }, null, 2)}\n`)
      for (const index of frames) fs.copyFileSync(fileAtFrame(entries, index, 25), golden(index))
    }
    const drawn = {
      frames: await Promise.all(frames.map((i) => pixelsOf(fileAtFrame(entries, i, 25)))),
      y: overlay?.y,
    }
    expect(drawn).toEqual({
      frames: await Promise.all(frames.map((i) => pixelsOf(golden(i)))),
      y: JSON.parse(fs.readFileSync(meta, 'utf8')).y,
    })
  })
})

/** The image an ffconcat list shows at output frame `index`. */
function fileAtFrame(
  entries: Array<{ durationSec?: number; file: string }>,
  index: number,
  fps: number,
) {
  let end = 0
  for (const entry of entries) {
    end += Math.round((entry.durationSec ?? 0) * fps)
    if (index < end) return entry.file
  }
  throw new Error(`no frame ${index}`)
}

/** Decoded RGBA, so PNG encoder settings don't matter; hashed to keep failures readable. */
async function pixelsOf(file: string) {
  const image = await loadImage(file)
  const canvas = createCanvas(image.width, image.height)
  const ctx = canvas.getContext('2d')
  ctx.drawImage(image, 0, 0)
  const { data } = ctx.getImageData(0, 0, image.width, image.height)
  return `${image.width}x${image.height}:${createHash('sha256').update(data).digest('hex')}`
}

describe('frameRateRational', () => {
  it('writes integer rates as is and NTSC rates over 1001', () => {
    expect(frameRateRational(30)).toBe('30')
    expect(frameRateRational(25)).toBe('25')
    expect(frameRateRational(30000 / 1001)).toBe('30000/1001')
    expect(frameRateRational(24000 / 1001)).toBe('24000/1001')
    expect(frameRateRational(60000 / 1001)).toBe('60000/1001')
    expect(frameRateRational(12.5)).toBe('12500000/1000000')
  })
})
