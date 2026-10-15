import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { presetPackDir, RENDER_PRESETS } from '../../storage/presets'
import { CaptionSeg } from '../../types/render-plan-struct'

import { boxShadowMargin, boxShadowPixels } from './box-shadow'
import {
  captionFontPt,
  captionFrameAt,
  type CaptionMeasureText,
  captionPtToPx,
  layoutCaptionSegment,
} from './caption-layout'
import { createCaptionPainter } from './caption-painter'
import {
  FACT_STAMP,
  type FactStampSeg,
  factStampSeg,
  factStampStripImage,
  factStampStripSeg,
  factStampStripShadowPixels,
  factStampTextWidth,
} from './fact-stamps'

const FRAME = { height: 1920, width: 1080 }
/** The drawn stamps' shadow (black at 30%, blur 10, 4 px down) on a 1080-wide frame. */
const SHADOW = { offsetY: 4, opacity: 0.3, sigma: 6 }
/** Where the stamps were drawn (PNGs, until the facts track): px of a 1080 x 1920 frame. */
const DRAWN = { maxTextWidth: 464, right: 1010, top: 170 }
/** The fact stamps of the two review loops (ampersand, honey). */
const REVIEW_LABELS = [
  '27th letter',
  'After Z: &',
  'and per se and',
  'Ampersand',
  'Latin: et = and',
  'Alphabet finale',
  'SWEET SCIENCE',
  'LOW MOISTURE',
  'NATURALLY ACIDIC',
  'STILL GOOD',
  'MOISTURE MATTERS',
  'SEAL + STORE',
]

const stamp = (text: string, over: Partial<Parameters<typeof factStampSeg>[0]> = {}) =>
  factStampSeg({
    color: '#04f827',
    frame: FRAME,
    id: 'segment-fact-0',
    index: 0,
    text,
    timeline: { in: 4300, out: 7000 },
    ...over,
  })

/** A measure that sets text as the stamp recipe estimates it (its advance table and metrics). */
const tableMeasure: CaptionMeasureText = (text, font) => ({
  ascent: FACT_STAMP.ascent * font.px,
  height: Math.ceil(FACT_STAMP.ascent * font.px) + Math.ceil(FACT_STAMP.descent * font.px),
  width: factStampTextWidth(text, font.px),
})

/** The label's size in px on `frame`. */
const pxOf = (seg: CaptionSeg, frame = FRAME) =>
  captionPtToPx(captionFontPt(seg.style.fontSize ?? 0, frame))

type Corners = Array<[number, number]>

/** The painter's strip corners in the frame (top left, top right, bottom right, bottom left). */
function painterStrip(seg: CaptionSeg, measure: CaptionMeasureText, frame = FRAME): Corners {
  const layout = layoutCaptionSegment(
    seg as unknown as Parameters<typeof layoutCaptionSegment>[0],
    frame,
    measure,
  )
  const state = captionFrameAt(layout, seg.in + 1000, measure)
  const [box] = state?.boxes ?? []
  const { texture } = layout
  const turn = ((state?.rotate ?? 0) * Math.PI) / 180
  const corners: Corners = [
    [box.x, box.y],
    [box.x + box.w, box.y],
    [box.x + box.w, box.y + box.h],
    [box.x, box.y + box.h],
  ]
  return corners.map(([x, y]) => {
    // From the texture centre, turned clockwise (y down), as `place` draws it.
    const dx = x - texture.width / 2
    const dy = y - texture.height / 2
    return [
      texture.centerX + dx * Math.cos(turn) - dy * Math.sin(turn),
      texture.centerY + dx * Math.sin(turn) + dy * Math.cos(turn),
    ]
  })
}

/**
 * The editor engine's strip corners in the frame: its image layer (factStampStripSeg) fitted to
 * the frame width, scaled, centred on its position and turned about it, less the clear border.
 */
function engineStrip(seg: FactStampSeg, frame = FRAME): Corners {
  const image = factStampStripImage(seg)
  const layer = factStampStripSeg(seg, 'blob:strip', frame)
  const [sx, sy] = layer.scale as [number, number]
  const fit = frame.width / (image.width + 2 * image.border)
  const w = image.width * fit * sx
  const h = image.height * fit * sy
  const [px, py] = layer.position as [number, number]
  const cx = (frame.width / 2) * (1 + px)
  const cy = (frame.height / 2) * (1 - py)
  const turn = ((layer.rotate as number) * Math.PI) / 180
  const corners: Corners = [
    [-w / 2, -h / 2],
    [w / 2, -h / 2],
    [w / 2, h / 2],
    [-w / 2, h / 2],
  ]
  return corners.map(([dx, dy]) => [
    cx + dx * Math.cos(turn) - dy * Math.sin(turn),
    cy + dx * Math.sin(turn) + dy * Math.cos(turn),
  ])
}

const extent = (corners: Corners) => ({
  bottom: Math.max(...corners.map(([, y]) => y)),
  left: Math.min(...corners.map(([x]) => x)),
  right: Math.max(...corners.map(([x]) => x)),
  top: Math.min(...corners.map(([, y]) => y)),
})

/** The turned strip's extent in the frame, as the export painter places it. */
const turnedStrip = (seg: CaptionSeg, measure: CaptionMeasureText) =>
  extent(painterStrip(seg, measure))

describe('factStampSeg', () => {
  it('holds the whole label in one text element for its window, on a deep-diver strip', () => {
    const seg = stamp('c. 2560 BC')
    expect(seg).toMatchObject({
      autoScale: true,
      id: 'segment-fact-0',
      in: 4300,
      lineCount: 1,
      out: 7000,
      scale: [1, 1],
      type: 't',
      uri: 'caption-preset://deep-diver',
    })
    // One element: a word the next one starts with would be dropped by the engine.
    expect(seg.texts).toEqual([{ in: 0, out: 2700, t: 'c. 2560 BC' }])
  })

  it('sets it in PT Serif Bold, ink on the strip colour, with no outline or shadow', () => {
    const { style } = stamp('c. 2560 BC', { color: '#ff3ea5' })
    expect(style).toEqual({
      animationBgColor: '#ff3ea5',
      animationColor: '#111111',
      fontColor: '#111111',
      fontFamily: 'PT Serif',
      fontId: '',
      fontSize: 33,
      fontWeight: 700,
      italic: false,
      underline: false,
    })
  })

  it('writes white on a dark strip', () => {
    const { style } = stamp('1969 AD', { color: '#1a237e' })
    expect(style).toMatchObject({ animationColor: '#FFFFFF', fontColor: '#FFFFFF' })
  })

  it('tilts even stamps anticlockwise and odd ones clockwise, 3 degrees', () => {
    expect([0, 1, 2, 3].map((index) => stamp('1969 AD', { index }).rotate)).toEqual([-3, 3, -3, 3])
  })

  it('points the editor at the face to load, and gives the export no path it does not read', () => {
    const url = 'http://localhost:5017/api/presets/v007/render/fonts.tar.gz'
    expect(stamp('1969 AD', { fontGzipPath: url }).style.fontGzipPath).toBe(url)
    expect(stamp('1969 AD').style).not.toHaveProperty('fontGzipPath')
  })

  it.each(['c. 2560 BC', '1969 AD', ...REVIEW_LABELS])(
    'puts the turned strip of %j where the drawn stamps were: right edge 70 px in, top 170 px down',
    (label) => {
      for (const index of [0, 1]) {
        const strip = turnedStrip(stamp(label, { index }), tableMeasure)
        expect(Math.abs(strip.right - DRAWN.right)).toBeLessThanOrEqual(1.5)
        expect(Math.abs(strip.top - DRAWN.top)).toBeLessThanOrEqual(1.5)
      }
    },
  )

  it('sets a label wider than the drawn stamps allowed smaller, and a short one at full size', () => {
    const textWidth = (seg: CaptionSeg) =>
      factStampTextWidth(
        'NATURALLY ACIDIC',
        captionPtToPx(captionFontPt(seg.style.fontSize ?? 0, FRAME)),
      )
    expect(stamp('1969 AD').style.fontSize).toBe(FACT_STAMP.fontSize)
    const long = stamp('NATURALLY ACIDIC')
    expect(long.style.fontSize).toBeLessThan(FACT_STAMP.fontSize)
    expect(textWidth(long)).toBeLessThanOrEqual(DRAWN.maxTextWidth)
    // The largest whole size that fits: one up would not.
    expect(
      textWidth({ ...long, style: { ...long.style, fontSize: (long.style.fontSize ?? 0) + 1 } }),
    ).toBeGreaterThan(DRAWN.maxTextWidth)
  })

  it('places a stamp for the frame it is drawn on', () => {
    const small = { height: 1280, width: 720 }
    const big = stamp('1969 AD')
    const scaled = stamp('1969 AD', { frame: small })
    const [x, y] = big.position as [number, number]
    const [sx, sy] = scaled.position as [number, number]
    // The same place in the frame, to the rounding of the font size.
    expect(Math.abs(sx - x)).toBeLessThan(0.02)
    expect(Math.abs(sy - y)).toBeLessThan(0.01)
  })
})

describe('the stamp strip (the drawn stamps look: tight, square corners)', () => {
  it('fits the strip tight around the label: 22 px beside it, 13 px above and below its ink', () => {
    const seg = stamp('27th letter', { color: '#ff3ea5' })
    const px = pxOf(seg)
    expect(px).toBe(52)
    expect(seg.strip).toEqual({
      color: '#ff3ea5',
      // The label's advance width (263.8 px) and 2 x 22.
      h: Math.round((FACT_STAMP.inkAscent + FACT_STAMP.inkDescent) * px + 2 * 13),
      offsetY: expect.any(Number),
      shadow: SHADOW,
      w: Math.round(factStampTextWidth('27th letter', px) + 2 * 22),
    })
    expect(seg.strip).toMatchObject({ h: 76, w: 308 })
  })

  it('has square corners and no deep-diver box in the export painter', () => {
    const seg = stamp('27th letter')
    const layout = layoutCaptionSegment(
      seg as unknown as Parameters<typeof layoutCaptionSegment>[0],
      FRAME,
      tableMeasure,
    )
    const boxes = captionFrameAt(layout, seg.in + 1000, tableMeasure)?.boxes
    expect(boxes).toEqual([expect.objectContaining({ h: 76, radius: 0, shadow: SHADOW, w: 308 })])
  })

  it.each(REVIEW_LABELS)(
    "puts %j's ink where the drawn stamps did: 13 px under the strip top",
    (label) => {
      const seg = stamp(label)
      const px = pxOf(seg)
      const layout = layoutCaptionSegment(
        seg as unknown as Parameters<typeof layoutCaptionSegment>[0],
        FRAME,
        tableMeasure,
      )
      const state = captionFrameAt(layout, seg.in + 1000, tableMeasure)
      const [box] = state?.boxes ?? []
      const [word] = state?.words ?? []
      // Drawn from the line top (textBaseline 'top'): the baseline is the face's ascent below it.
      const baseline = word.y + FACT_STAMP.ascent * px
      const inkTop = baseline - FACT_STAMP.inkAscent * px
      const inkBottom = baseline + FACT_STAMP.inkDescent * px
      const padY = 13
      // To the 4 decimals the strip's offset is kept to.
      expect(inkTop - box.y).toBeCloseTo(padY, 3)
      // The strip's height is whole px: the bottom margin takes the rounding.
      expect(Math.abs(box.y + box.h - inkBottom - padY)).toBeLessThanOrEqual(0.5)
      // Centred across: the label's line on the strip's middle, to its whole-px placement.
      const lineMiddle = word.x + layout.words[0].width / 2
      expect(Math.abs(lineMiddle - (box.x + box.w / 2))).toBeLessThanOrEqual(1)
    },
  )

  it('scales the margins with the frame', () => {
    const small = { height: 1280, width: 720 }
    const seg = stamp('27th letter', { frame: small })
    const px = pxOf(seg, small)
    expect(seg.strip.w).toBe(
      Math.round(factStampTextWidth('27th letter', px) + (2 * 22 * 720) / 1080),
    )
    expect(seg.strip.h).toBe(
      Math.round((FACT_STAMP.inkAscent + FACT_STAMP.inkDescent) * px + (2 * 13 * 720) / 1080),
    )
    expect(seg.strip.shadow).toEqual({ offsetY: 2.6667, opacity: 0.3, sigma: 4 })
  })

  it('drops the soft shadow the drawn stamps had: black at 30%, as soft as blur 10, 4 px down', () => {
    expect(stamp('1969 AD').strip.shadow).toEqual(SHADOW)
    expect(stamp('1969 AD', { color: '#1a237e', index: 1 }).strip.shadow).toEqual(SHADOW)
  })
})

describe("the editor engine's strip layer", () => {
  it('is the strip as an image, 1:1, with its shadow in a border wide enough to hold it', () => {
    expect(factStampStripImage(stamp('27th letter', { color: '#ffe500' }))).toEqual({
      border: boxShadowMargin(SHADOW),
      color: '#ffe500',
      height: 76,
      shadow: SHADOW,
      width: 308,
    })
    expect(boxShadowMargin(SHADOW)).toBe(23)
  })

  it('draws the same shadow as the export painter: the same numbers, so the same pixels', () => {
    for (const label of REVIEW_LABELS) {
      const seg = stamp(label)
      const layout = layoutCaptionSegment(
        seg as unknown as Parameters<typeof layoutCaptionSegment>[0],
        FRAME,
        tableMeasure,
      )
      const [box] = captionFrameAt(layout, seg.in + 1000, tableMeasure)?.boxes ?? []
      const image = factStampStripImage(seg)
      // Both draw boxShadowPixels for a box of this size and this shadow.
      expect([box.w, box.h, box.shadow]).toEqual([image.width, image.height, image.shadow])
      expect(image.border).toBe(boxShadowMargin(box.shadow ?? SHADOW))
    }
  })

  it("keeps the root of each shadow pixel's opacity: the engine shows a picture's opacity squared", () => {
    for (const label of ['27th letter', 'NATURALLY ACIDIC']) {
      const image = factStampStripImage(stamp(label))
      const painter = boxShadowPixels({ h: image.height, w: image.width }, SHADOW)
      const engine = factStampStripShadowPixels(image)
      expect(engine).toMatchObject({
        height: painter.height,
        margin: image.border,
        width: painter.width,
      })
      const pixels = engine?.data ?? new Uint8ClampedArray()
      let worst = 0
      for (let i = 0; i < painter.data.length; i += 4) {
        expect([pixels[i], pixels[i + 1], pixels[i + 2]]).toEqual([0, 0, 0])
        // The engine draws a picture pixel of opacity a as a x a (checked on it: 50% black over
        // white shows 75% white, and 10% to 90% follow a x a to within 0.5%).
        const shown = (pixels[i + 3] / 255) ** 2 * 255
        worst = Math.max(worst, Math.abs(shown - painter.data[i + 3]))
      }
      expect(worst).toBeLessThanOrEqual(1)
    }
  })

  it('has no shadow pixels for a strip without a shadow', () => {
    const seg = stamp('27th letter')
    const plain = factStampStripImage({ ...seg, strip: { ...seg.strip, shadow: undefined } })
    expect(plain.border).toBe(1)
    expect(factStampStripShadowPixels(plain)).toBeUndefined()
  })

  it('is an image segment over the stamp window, turned with the label', () => {
    const seg = stamp('27th letter', { index: 1 })
    const layer = factStampStripSeg(seg, 'blob:http://localhost:3000/strip', FRAME)
    expect(layer).toMatchObject({
      assetType: 1,
      id: 'segment-fact-0-strip',
      in: 4300,
      loop: 0,
      out: 7000,
      rotate: 3,
      trimEnd: 2700,
      trimStart: 0,
      type: 'v',
      uri: 'blob:http://localhost:3000/strip',
      volume: 0,
    })
    // The engine fits an image to the frame width: this scale draws it at 1:1.
    expect(layer.scale).toEqual([354 / 1080, 354 / 1080])
  })

  it.each(REVIEW_LABELS)(
    "draws %j's strip exactly where the export painter does (engine vs painter parity)",
    (label) => {
      for (const index of [0, 1]) {
        const seg = stamp(label, { index })
        const painter = painterStrip(seg, tableMeasure)
        const engine = engineStrip(seg)
        for (const [k, [x, y]] of engine.entries()) {
          expect(Math.abs(x - painter[k][0])).toBeLessThan(0.05)
          expect(Math.abs(y - painter[k][1])).toBeLessThan(0.05)
        }
      }
    },
  )

  it('matches the painter on another frame too', () => {
    const small = { height: 1280, width: 720 }
    const seg = stamp('Latin: et = and', { frame: small, index: 1 })
    const painter = painterStrip(seg, tableMeasure, small)
    const engine = engineStrip(seg, small)
    for (const [k, [x, y]] of engine.entries()) {
      expect(Math.abs(x - painter[k][0])).toBeLessThan(0.05)
      expect(Math.abs(y - painter[k][1])).toBeLessThan(0.05)
    }
  })
})

/**
 * The recipe's numbers for the review loops' stamps (golden): label size, strip size, and the
 * turned strip's extent in a 1080 x 1920 frame, which both renderers draw (the parity tests
 * above). The drawn stamps' strips were the label's kerned width + 44 by its ink + 26, at the
 * same extent right edge (1010) and top (170).
 */
describe('stamp recipe golden', () => {
  it('pins the review stamps', () => {
    const rows = REVIEW_LABELS.map((label, index) => {
      const seg = stamp(label, { index })
      const box = extent(engineStrip(seg))
      return [
        label,
        seg.style.fontSize,
        seg.strip.w,
        seg.strip.h,
        Math.round(box.left),
        Math.round(box.top),
        Math.round(box.right),
        Math.round(box.bottom),
      ]
    })
    expect(rows).toEqual(GOLDEN)
  })
})

// label, font size (design units), strip w x h, turned extent left, top, right, bottom (px).
// prettier-ignore
const GOLDEN: Array<[string, number, number, number, number, number, number, number]> = [
  ['27th letter', 33, 308, 76, 698, 170, 1010, 262],
  ['After Z: &', 33, 298, 76, 708, 170, 1010, 261],
  ['and per se and', 33, 407, 76, 600, 170, 1010, 267],
  ['Ampersand', 33, 329, 76, 677, 170, 1010, 263],
  ['Latin: et = and', 33, 406, 76, 601, 170, 1010, 267],
  ['Alphabet finale', 33, 431, 76, 576, 170, 1010, 268],
  ['SWEET SCIENCE', 33, 457, 76, 550, 170, 1010, 270],
  ['LOW MOISTURE', 33, 457, 76, 550, 170, 1010, 270],
  ['NATURALLY ACIDIC', 29, 495, 70, 512, 170, 1010, 266],
  ['STILL GOOD', 33, 355, 76, 652, 170, 1010, 265],
  ['MOISTURE MATTERS', 28, 502, 69, 505, 170, 1010, 265],
  ['SEAL + STORE', 33, 401, 76, 606, 170, 1010, 267],
]

// The render font pack is installed by `pnpm reelmakeeasy setup`; without it this is skipped.
const fontArchive = (() => {
  try {
    return path.join(presetPackDir(), RENDER_PRESETS.fonts)
  } catch {
    return undefined
  }
})()
const describeWithFontPack = fontArchive && fs.existsSync(fontArchive) ? describe : describe.skip

describeWithFontPack('factStampSeg with the installed render fonts', () => {
  let workDir: string
  let measure: CaptionMeasureText
  beforeAll(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fact-stamp-fonts-'))
    execFileSync('tar', ['-xzf', fontArchive as string, '-C', workDir, 'fonts/PTSerif-Bold.ttf'])
    measure = createCaptionPainter(path.join(workDir, 'fonts')).measure
  })
  afterAll(() => fs.rmSync(workDir, { force: true, recursive: true }))

  it.each(REVIEW_LABELS)(
    'keeps %j top right, at least 60 px inside the frame, set in the face itself',
    (label) => {
      for (const index of [0, 1]) {
        const strip = turnedStrip(stamp(label, { index }), measure)
        // The strip is sized from the face's own numbers whatever the measure: on the mark.
        expect(Math.abs(strip.right - DRAWN.right)).toBeLessThanOrEqual(1.5)
        expect(FRAME.width - strip.right).toBeGreaterThanOrEqual(60)
        expect(Math.abs(strip.top - DRAWN.top)).toBeLessThanOrEqual(1.5)
      }
    },
  )

  it.each(REVIEW_LABELS)(
    'leaves the drawn margin beside %j set in the face: 22 px, a few more where it kerns',
    (label) => {
      const seg = stamp(label)
      const px = pxOf(seg)
      const kerned = measure(label, { family: 'PT Serif', italic: false, px, weight: 700 }).width
      const margin = (seg.strip.w - kerned) / 2
      expect(margin).toBeGreaterThanOrEqual(22 - 0.5)
      // The strip is sized unkerned: capitals that kern ("NATURALLY ACIDIC") get up to 6 px more.
      expect(margin).toBeLessThanOrEqual(22 + 6.5)
    },
  )

  it("sets the face's line as the recipe's metrics say: ascent, and line box ceil + ceil", () => {
    for (const pt of [19, 26, 33, 39]) {
      const px = captionPtToPx(pt)
      const line = measure(' ', { family: 'PT Serif', italic: false, px, weight: 700 })
      expect(line.ascent).toBeCloseTo(FACT_STAMP.ascent * px, 1)
      expect(line.height).toBe(
        Math.ceil(FACT_STAMP.ascent * px) + Math.ceil(FACT_STAMP.descent * px),
      )
    }
  })
})
