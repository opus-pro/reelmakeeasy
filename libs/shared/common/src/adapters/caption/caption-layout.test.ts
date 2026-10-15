import { boxShadowMargin } from './box-shadow'
import {
  captionFontPt,
  type CaptionFrame,
  captionFrameAt,
  captionFrameKey,
  type CaptionLayoutSegment,
  type CaptionMeasureText,
  captionPtToPx,
  captionScalePx,
  type CaptionSegmentLayout,
  fillPopStretch,
  layoutCaptionSegment,
  presetOf,
} from './caption-layout'

// A monospaced stand-in for Pango: every character is 0.6 em wide.
const measure: CaptionMeasureText = (text, font) => ({
  ascent: font.px * 0.95,
  height: font.px * 1.2,
  width: text.length * font.px * 0.6,
})

const PORTRAIT = { height: 1920, width: 1080 }

function frameAt(layout: CaptionSegmentLayout, ms: number): CaptionFrame {
  const frame = captionFrameAt(layout, ms, measure)
  if (!frame) throw new Error(`no caption at ${ms} ms`)
  return frame
}

function segment(words: string[], extra: Partial<CaptionLayoutSegment> = {}): CaptionLayoutSegment {
  return {
    in: 1000,
    out: 1000 + words.length * 500,
    position: [0, -0.617],
    style: {
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
    },
    texts: words.map((t, i) => ({ in: i * 500, out: (i + 1) * 500, t })),
    ...extra,
  }
}

describe('caption font size', () => {
  it('follows the frame height, normalised to 1080p, in Pango points at 96 dpi', () => {
    // 35 x 1920/1920 x 1.185185 = 41.48 -> 41 pt -> 54.67 px.
    expect(captionFontPt(35, PORTRAIT)).toBe(41)
    expect(captionPtToPx(captionFontPt(35, PORTRAIT))).toBeCloseTo(54.67, 2)
    // Landscape: 35 x 1080/1080 x 1.185185 -> the same 41 pt.
    expect(captionPtToPx(captionFontPt(35, { height: 1080, width: 1920 }))).toBeCloseTo(54.67, 2)
    // Square uses the portrait divisor: 35 x 1080/1920 x 1.185185 = 23.3 -> 23 pt -> 30.67 px.
    expect(captionFontPt(35, { height: 1080, width: 1080 })).toBe(23)
    expect(captionPtToPx(23)).toBeCloseTo(30.67, 2)
    // The editor preview canvas (720 x 1280) keeps the same proportion.
    expect(captionFontPt(35, { height: 1280, width: 720 })).toBe(28)
  })

  it('scales the line limit, stroke and shadow the same way', () => {
    const layout = layoutCaptionSegment(segment(['A']), PORTRAIT, measure)
    expect(captionScalePx(540, PORTRAIT)).toBe(640)
    const space = Math.ceil(0.6 * captionPtToPx(41))
    expect(layout.spaceWidth).toBe(space)
    expect(layout.lineLimit).toBe(640 + space)
    expect(layout.lineLimit).toBeLessThan(PORTRAIT.width)
    expect(layout.paint.stroke).toEqual({ color: '#000000', width: 9 })
    expect(layout.paint.shadow?.blur).toBe(5)
    expect(layout.paint.shadow?.offsetX).toBeCloseTo(2.37, 2)
    expect(
      layoutCaptionSegment(segment(['A']), { height: 1080, width: 1920 }, measure).lineLimit,
    ).toBe(captionScalePx(1380, { height: 1080, width: 1920 }) + space)
  })
})

describe('caption frame layout', () => {
  const layout = layoutCaptionSegment(segment(['THE', 'PLANET', 'IS']), PORTRAIT, measure)
  const at = (ms: number) => frameAt(layout, ms)

  it('enlarges the active word and pushes its neighbours out, keeping one space between words', () => {
    const before = at(999 + 1) // first word active
    const middle = at(1000 + 500) // "PLANET" active
    const [the, planet, is] = middle.words
    expect(planet.active).toBe(true)
    expect(planet.color).toBe('#04f827')
    expect(the.color).toBe('#ffffff')
    expect(planet.px).toBeCloseTo(captionPtToPx(Math.round(1.3 * 41)), 5)

    const width = (text: string, px: number) => Math.ceil(text.length * px * 0.6 - 1e-6)
    const base = captionPtToPx(41)
    const theWidth = width('THE', base)
    const planetWidth = Math.trunc(1.3 * width('PLANET', base))
    // The gaps after the enlarged word equal the gap before it: one space (up to 1 px of truncation).
    expect(planet.x - (the.x + theWidth)).toBeCloseTo(layout.spaceWidth, -0.5)
    expect(is.x - (planet.x + planetWidth)).toBeCloseTo(layout.spaceWidth, -0.5)
    // The line stays centred.
    const right = is.x + width('IS', base)
    expect((the.x + right) / 2).toBeCloseTo(PORTRAIT.width / 2, -0.5)

    // Compared with the frame where "THE" is active, "IS" moved right and "THE" moved left.
    expect(middle.words[0].x).toBeLessThan(before.words[0].x + 1)
    expect(middle.words[2].x).toBeGreaterThan(before.words[2].x)
  })

  it('keeps the enlarged word on the line baseline', () => {
    const [the, planet] = at(1500).words
    const ascent = (pt: number) => Math.round(captionPtToPx(pt) * 0.95)
    expect(the.y).toBe(layout.pad)
    expect(planet.y).toBe(Math.trunc(layout.pad - (ascent(53) - ascent(41))))
  })

  it('pulses the line from 1.05 to 1.0 over 160 ms from each word start', () => {
    expect(fillPopStretch(undefined)).toBe(1.05)
    expect(fillPopStretch(0)).toBe(1.05)
    expect(fillPopStretch(80)).toBeCloseTo(1.025, 6)
    expect(fillPopStretch(160)).toBe(1)
    expect(fillPopStretch(400)).toBe(1)
    expect(at(1500).scaleX).toBe(1.05)
    expect(at(1540).scaleX).toBeCloseTo(1.0375, 6)
    expect(at(1580).scaleX).toBeCloseTo(1.025, 6)
    expect(at(1660).scaleX).toBe(1)
    expect(at(1900).scaleX).toBe(1)
  })

  it('holds the last word active through the gap until the next word starts', () => {
    // Words at 0-300 and 500-800 ms with a 200 ms gap; the segment runs to 1200 ms.
    const gapped = layoutCaptionSegment(
      segment(['MOON', 'ENCELADUS'], {
        out: 2200,
        texts: [
          { in: 0, out: 300, t: 'MOON' },
          { in: 500, out: 800, t: 'ENCELADUS' },
        ],
      }),
      PORTRAIT,
      measure,
    )
    const activeAt = (ms: number) => frameAt(gapped, ms).words.filter((w) => w.active)
    const enlarged = captionPtToPx(Math.round(1.3 * 41))

    // In the gap (1400 ms is 400 ms in): MOON is still green at 1.3x, its pulse long settled.
    expect(activeAt(1400).map((w) => [w.text, w.color, w.px])).toEqual([
      ['MOON', '#04f827', enlarged],
    ])
    expect(frameAt(gapped, 1400).scaleX).toBe(1)
    // The switch happens exactly at the next word's start.
    expect(activeAt(1499).map((w) => w.text)).toEqual(['MOON'])
    expect(activeAt(1500).map((w) => w.text)).toEqual(['ENCELADUS'])
    expect(frameAt(gapped, 1500).scaleX).toBe(1.05)
    // The last word holds past its own end until the segment leaves the screen.
    expect(activeAt(2199).map((w) => w.text)).toEqual(['ENCELADUS'])
    expect(captionFrameAt(gapped, 2200, measure)).toBeUndefined()
  })

  it('has no active word before the first word starts', () => {
    const late = layoutCaptionSegment(
      segment(['LATE'], { out: 2000, texts: [{ in: 300, out: 800, t: 'LATE' }] }),
      PORTRAIT,
      measure,
    )
    expect(frameAt(late, 1100).words.map((w) => w.active)).toEqual([false])
    expect(frameAt(late, 1100).scaleX).toBe(1.05)
    expect(frameAt(late, 1300).words.map((w) => w.active)).toEqual([true])
  })

  it('reads time as integer ms, like the engine clock', () => {
    // 1499.9 ms is 1499: still the first word, the second starts at 1500.
    expect(at(1499.9).words[0].active).toBe(true)
    expect(at(1499.9).words[1].active).toBe(false)
    expect(at(1499.9).scaleX).toBe(1)
  })

  it('is off screen outside the segment and gives identical frames the same key', () => {
    expect(captionFrameAt(layout, 999, measure)).toBeUndefined()
    expect(captionFrameAt(layout, 2500, measure)).toBeUndefined()
    expect(captionFrameKey(at(1700))).toBe(captionFrameKey(at(1800)))
    expect(captionFrameKey(at(1500))).not.toBe(captionFrameKey(at(1540)))
  })

  it('centres the frame-wide texture on the segment position', () => {
    expect(layout.texture.width).toBe(PORTRAIT.width)
    expect(layout.texture.centerX).toBe(540)
    expect(layout.texture.centerY).toBeCloseTo(960 * 1.617, 6)
    expect(layout.texture.height).toBe(layout.words[0].height + 2 * layout.pad)
  })
})

describe('caption paging', () => {
  it('splits words into lines by measured width and shows the line of the active word', () => {
    // Each 6-letter word is 197 px at 54.67 px; the limit is 640 + 33 = 673.
    const words = ['AAAAAA', 'BBBBBB', 'CCCCCC', 'DDDDDD', 'EEEEEE']
    const layout = layoutCaptionSegment(segment(words), PORTRAIT, measure)
    // Running width: 197 (+33 kept) = 230, then 230+33+197 (+33) = 493, then 493+33+197 > 673.
    expect(layout.words.map((w) => w.line)).toEqual([0, 0, 1, 1, 2])
    const textsAt = (ms: number) => frameAt(layout, ms).words.map((w) => w.text)
    expect(textsAt(1000)).toEqual(['AAAAAA', 'BBBBBB'])
    expect(textsAt(2100)).toEqual(['CCCCCC', 'DDDDDD'])
    expect(textsAt(3200)).toEqual(['EEEEEE'])
  })

  it('shrinks only a single over-long word, on a line of its own', () => {
    const layout = layoutCaptionSegment(
      segment(['GO', 'SUPERCALIFRAGILISTICEXPI', 'NOW']),
      PORTRAIT,
      measure,
    )
    const [go, long, now] = layout.words
    expect(go.pt).toBe(41)
    expect(now.pt).toBe(41)
    expect(long.width).toBe(layout.lineLimit)
    // 24 chars are 788 px against a 673 px limit: trunc(41 / (788 / 673)) = 35 pt.
    expect(long.pt).toBe(35)
    expect(new Set([go.line, long.line, now.line]).size).toBe(3)
  })

  it('counts two spaces for the first gap of line 0 but one for a wrapped line', () => {
    // 9 and 10 letters are 296 and 328 px (624 together), the space 33 px, the limit 673.
    // Line 0: 296 + 33 (kept) + 33 + 328 = 690 > 673, so B wraps. Line 1 starts at 328 with no
    // trailing space: 328 + 33 + 296 = 657 fits, so the same two widths share a line there.
    const words = ['AAAAAAAAA', 'BBBBBBBBBB', 'CCCCCCCCC', 'DDDDDDDDDD']
    const layout = layoutCaptionSegment(segment(words), PORTRAIT, measure)
    expect(layout.words.map((w) => w.line)).toEqual([0, 1, 1, 2])
  })

  it('pins lineCount >= 2 (TextAdapter defaults to 3): every word, one line height per line', () => {
    const words = ['AAAAAA', 'BBBBBB', 'CCCCCC', 'DDDDDD', 'EEEEEE']
    const layout = layoutCaptionSegment(segment(words, { lineCount: 3 }), PORTRAIT, measure)
    expect(frameAt(layout, 3400).words.map((w) => w.text)).toEqual(words)
    expect(layout.texture.height).toBe(3 * layout.words[0].height + 2 * layout.pad)
  })

  it('shows every line at once when the segment asks for more than one', () => {
    const words = ['AAAAAA', 'BBBBBB', 'CCCCCC', 'DDDDDD']
    const layout = layoutCaptionSegment(segment(words, { lineCount: 2 }), PORTRAIT, measure)
    const frame = frameAt(layout, 1000)
    expect(frame.words).toHaveLength(4)
    expect(frame.words[3].y).toBe(frame.words[1].y + layout.spaceHeight)
  })
})

/** The adapter's static-accent remap: word `accent` is the active one for the whole caption. */
function staticAccent(words: string[], accent: number, color = '#04f827', duration = 2000) {
  return words.map((t, i) => {
    const start =
      i < accent ? -500 * (accent - i) : i === accent ? 0 : duration + 500 * (i - accent)
    return { in: start, out: start + 400, t, ...(i === accent ? { highlightColor: color } : {}) }
  })
}

describe('caption presets', () => {
  it('reads the preset from the uri, falling back to fill-pop as before', () => {
    expect(presetOf('caption-preset://word-level_karaoke_fill-pop')).toBe('fill-pop')
    expect(presetOf('caption-preset://word-level_highlight_color')).toBe('highlight-color')
    expect(presetOf('caption-preset://word-level_simple_bg-highlight')).toBe('simple-bg')
    expect(presetOf('caption-preset://deep-diver')).toBe('deep-diver')
    expect(presetOf('caption-preset://word-level_karaoke_bg-highlight')).toBe('fill-pop')
    expect(presetOf('caption-preset://glitch-1')).toBe('fill-pop')
    expect(presetOf(undefined)).toBe('fill-pop')
  })

  const punch = (extra: Partial<CaptionLayoutSegment> = {}) =>
    segment(['HONEY', 'NEVER', 'SPOILS'], {
      in: 0,
      lineCount: 3,
      out: 2000,
      position: [0, 0],
      texts: staticAccent(['HONEY', 'NEVER', 'SPOILS'], 1),
      uri: 'caption-preset://word-level_highlight_color',
      ...extra,
    })

  describe('highlight-color (Punch)', () => {
    const layout = layoutCaptionSegment(punch(), PORTRAIT, measure)

    it('colours the active word at its own size, with no pop and no line stretch', () => {
      const frame = frameAt(layout, 0)
      expect(frame.words.map((w) => [w.text, w.active, w.color])).toEqual([
        ['HONEY', false, '#ffffff'],
        ['NEVER', true, '#04f827'],
        ['SPOILS', false, '#ffffff'],
      ])
      expect(new Set(frame.words.map((w) => w.px))).toEqual(new Set([captionPtToPx(layout.basePt)]))
      expect(frame.scaleX).toBe(1)
      expect(frame.boxes).toEqual([])
      expect(frame.rotate).toBe(0)
    })

    it('keeps the accent lit and the words still for the whole caption', () => {
      const first = frameAt(layout, 0)
      const last = frameAt(layout, 1999)
      expect(last).toEqual(first)
      expect(captionFrameKey(last)).toBe(captionFrameKey(first))
    })

    it('scales by the segment scale only', () => {
      const scaled = layoutCaptionSegment(punch({ scale: [1.2, 1.2] }), PORTRAIT, measure)
      expect(frameAt(scaled, 0)).toMatchObject({ scaleX: 1.2, scaleY: 1.2 })
    })
  })

  describe('simple-bg (Explainer accent box)', () => {
    const layout = layoutCaptionSegment(
      segment([], {
        in: 0,
        out: 2000,
        position: [0, -0.617],
        style: {
          animationBgColor: '#04f827',
          animationColor: '#111111',
          fontColor: '#111111',
          fontSize: 40,
          fontWeight: 700,
        },
        texts: staticAccent(['Sealed', 'in', 'tombs'], 2, '#111111'),
        uri: 'caption-preset://word-level_simple_bg-highlight',
      }),
      PORTRAIT,
      measure,
    )

    it('boxes the active word: the line box, widened by 0.8 x its radius, radius 1/8 of the line', () => {
      const frame = frameAt(layout, 500)
      const tombs = frame.words[2]
      const lineHeight = layout.words[2].height
      const radius = Math.trunc(lineHeight / 8)
      const padX = Math.trunc(0.8 * radius)
      expect(frame.boxes).toEqual([
        {
          color: '#04f827',
          h: lineHeight,
          radius,
          w: layout.words[2].width + 2 * padX,
          x: tombs.x - padX,
          y: tombs.y,
        },
      ])
      expect(tombs.color).toBe('#111111')
      expect(tombs.px).toBe(captionPtToPx(layout.basePt))
      expect(frame.scaleX).toBe(1)
    })

    it('boxes a word shrunk to fit where it is drawn, below its line top, as the engine does', () => {
      const long = layoutCaptionSegment(
        {
          ...layout.segment,
          texts: staticAccent(['Sealed', 'Pneumonoultramicroscopic', 'tombs'], 1, '#111111'),
        },
        PORTRAIT,
        measure,
      )
      const shrunk = long.words[1]
      expect(shrunk.pt).toBeLessThan(long.basePt)
      const frame = frameAt(long, 100)
      const word = frame.words.find((w) => w.text === shrunk.text)
      // A smaller word keeps the line's baseline, so its top is lower than the line's.
      expect(word?.y).toBeGreaterThan(long.pad)
      expect(frame.boxes).toHaveLength(1)
      expect(frame.boxes[0].y).toBe(word?.y)
      expect(frame.boxes[0].h).toBe(shrunk.height)
    })

    it('draws no box while no word is active', () => {
      const early = layoutCaptionSegment(
        { ...layout.segment, texts: [{ in: 300, out: 800, t: 'Later' }] },
        PORTRAIT,
        measure,
      )
      expect(frameAt(early, 100).boxes).toEqual([])
      expect(frameAt(early, 400).boxes).toHaveLength(1)
    })
  })

  describe('deep-diver (Explainer strip, stamps)', () => {
    const strip = (words: string[], extra: Partial<CaptionLayoutSegment> = {}) =>
      layoutCaptionSegment(
        segment([], {
          in: 0,
          lineCount: 3,
          out: 2000,
          position: [0, -0.617],
          style: {
            animationBgColor: '#f6f2e7',
            animationColor: '#111111',
            fontColor: '#111111',
            fontSize: 40,
            fontWeight: 700,
          },
          texts: staticAccent(words, 0, '#111111'),
          uri: 'caption-preset://deep-diver',
          ...extra,
        }),
        PORTRAIT,
        measure,
      )

    it('backs every visible line with one box: 1.1 x the font size beside, 0.3 x above and below', () => {
      // 6 and 11 letters (226 and 414 px, 0.6 em each at 62.67 px) overflow the 678 px line.
      const layout = strip(['Sealed', 'hieroglyphs'])
      expect(new Set(layout.words.map((w) => w.line)).size).toBe(2)
      const frame = frameAt(layout, 500)
      const pt = layout.basePt
      const lineHeight = layout.words[0].height
      // The wider line, measured as one string.
      const widest = Math.ceil('hieroglyphs'.length * 0.6 * captionPtToPx(pt))
      const [box] = frame.boxes
      expect(frame.boxes).toHaveLength(1)
      expect(box.color).toBe('#f6f2e7')
      expect(box.radius).toBeCloseTo(0.3 * pt, 6)
      expect(box.w).toBe(Math.trunc(widest + 2.2 * pt))
      expect(Math.abs(box.x + box.w / 2 - layout.texture.width / 2)).toBeLessThanOrEqual(1)
      expect(box.h).toBeCloseTo(2 * lineHeight + 0.6 * pt, 6)
      expect(box.y).toBeCloseTo(frame.words[0].y - 0.3 * pt, 6)
      expect(box.y + box.h / 2).toBeCloseTo(layout.texture.height / 2, 6)
    })

    it('starts the box at the drawn top of a word shrunk to fit on the first or last line', () => {
      const LONG = 'Pneumonoultramicroscopic'
      const boxOf = (layout: CaptionSegmentLayout) => frameAt(layout, 500).boxes[0]
      const padY = (layout: CaptionSegmentLayout) => 0.3 * layout.basePt
      const lineTops = (layout: CaptionSegmentLayout) => {
        const words = frameAt(layout, 500).words
        return [...new Set(layout.words.map((w) => w.line))].map((line) =>
          Math.min(...words.filter((_, i) => layout.words[i].line === line).map((w) => w.y)),
        )
      }

      // Alone: the box moves down with the word and keeps its height.
      const alone = strip([LONG])
      expect(alone.words[0].pt).toBeLessThan(alone.basePt)
      const [top] = lineTops(alone)
      expect(top).toBeGreaterThan(alone.pad)
      expect(boxOf(alone).y).toBeCloseTo(top - padY(alone), 6)
      expect(boxOf(alone).h).toBeCloseTo(alone.spaceHeight + 2 * padY(alone), 6)

      // First of two lines: the top follows the word, the bottom stays under the second line.
      const first = strip([LONG, 'tombs'])
      const [firstTop, secondTop] = lineTops(first)
      expect(boxOf(first).y).toBeCloseTo(firstTop - padY(first), 6)
      expect(boxOf(first).y + boxOf(first).h).toBeCloseTo(
        secondTop + first.spaceHeight + padY(first),
        6,
      )

      // In the middle: the box is the plain lines' box.
      const middle = strip(['Sealed', LONG, 'tombstones'])
      const plain = strip(['Sealed', 'hieroglyphics', 'tombstones'])
      expect(new Set(plain.words.map((w) => w.line)).size).toBe(3)
      expect(boxOf(middle).y).toBe(boxOf(plain).y)
      expect(boxOf(middle).h).toBe(boxOf(plain).h)
    })

    it('grows the texture padding so the box fits', () => {
      const layout = strip(['GO'], {
        style: { animationBgColor: '#f6f2e7', fontSize: 120, fontWeight: 700 },
      })
      const [box] = frameAt(layout, 500).boxes
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.y + box.h).toBeLessThanOrEqual(layout.texture.height)
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.x + box.w).toBeLessThanOrEqual(layout.texture.width)
    })

    it('colours the active word', () => {
      const layout = strip(['c.', '2560', 'BC'], {
        style: {
          animationBgColor: '#04f827',
          animationColor: '#ff0000',
          fontColor: '#111111',
          fontSize: 33,
        },
        texts: [{ in: 0, out: 2700, t: 'c. 2560 BC' }],
      })
      expect(frameAt(layout, 100).words.map((w) => w.color)).toEqual(['#ff0000'])
    })
  })

  describe('strip (fact stamps)', () => {
    const STRIP = { color: '#04f827', h: 76, offsetY: 4.83, w: 308 }
    const SHADOW = { offsetY: 4, opacity: 0.3, sigma: 6 }
    const stamp = (extra: Partial<CaptionLayoutSegment> = {}) =>
      layoutCaptionSegment(
        segment([], {
          in: 0,
          lineCount: 1,
          out: 2700,
          position: [0.5814, 0.78],
          rotate: -3,
          strip: STRIP,
          style: {
            animationBgColor: '#04f827',
            animationColor: '#111111',
            fontColor: '#111111',
            fontSize: 33,
            fontWeight: 700,
          },
          texts: [{ in: 0, out: 2700, t: '27th letter' }],
          uri: 'caption-preset://deep-diver',
          ...extra,
        }),
        PORTRAIT,
        measure,
      )

    it('draws its strip under the text with square corners, in place of the deep-diver box', () => {
      const layout = stamp()
      const { texture } = layout
      expect(frameAt(layout, 500).boxes).toEqual([
        {
          color: '#04f827',
          h: 76,
          radius: 0,
          w: 308,
          x: texture.width / 2 - 154,
          y: texture.height / 2 + 4.83 - 38,
        },
      ])
    })

    it('centres the strip on the caption centre, offsetY below it, so it turns with the text', () => {
      const layout = stamp({ strip: { ...STRIP, offsetY: -6 } })
      const [box] = frameAt(layout, 500).boxes
      expect(box.x + box.w / 2).toBe(layout.texture.width / 2)
      expect(box.y + box.h / 2).toBe(layout.texture.height / 2 - 6)
      expect(frameAt(layout, 500).rotate).toBe(-3)
    })

    it('keeps the deep-diver box for a stamp without a strip', () => {
      const [box] = frameAt(stamp({ strip: undefined }), 500).boxes
      expect(box.radius).toBeGreaterThan(0)
    })

    it('grows the texture so a strip wider and taller than the text fits', () => {
      const layout = stamp({ strip: { ...STRIP, h: 300, offsetY: 40, w: 900 } })
      const [box] = frameAt(layout, 500).boxes
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.x + box.w).toBeLessThanOrEqual(layout.texture.width)
      expect(box.y + box.h).toBeLessThanOrEqual(layout.texture.height)
    })

    it('puts the strip in the frame key', () => {
      const key = (strip: CaptionLayoutSegment['strip']) =>
        captionFrameKey(frameAt(stamp({ strip }), 500))
      expect(key(STRIP)).not.toBe(key({ ...STRIP, w: 310 }))
      expect(key(STRIP)).not.toBe(key({ ...STRIP, color: '#ffe500' }))
      expect(key(STRIP)).not.toBe(key({ ...STRIP, shadow: SHADOW }))
      expect(key({ ...STRIP, shadow: SHADOW })).not.toBe(
        key({ ...STRIP, shadow: { ...SHADOW, offsetY: 6 } }),
      )
    })

    describe('with its shadow', () => {
      it('gives the strip box its shadow, for the painter to draw under it', () => {
        const [box] = frameAt(stamp({ strip: { ...STRIP, shadow: SHADOW } }), 500).boxes
        expect(box).toMatchObject({ h: 76, radius: 0, shadow: SHADOW, w: 308 })
      })

      it('has no shadow on a strip without one', () => {
        const [box] = frameAt(stamp(), 500).boxes
        expect(box).not.toHaveProperty('shadow')
      })

      it('grows the texture so the shadow fits around the strip', () => {
        for (const strip of [
          { ...STRIP, shadow: SHADOW },
          { ...STRIP, h: 300, offsetY: 40, shadow: SHADOW, w: 900 },
          { ...STRIP, offsetY: -30, shadow: { ...SHADOW, offsetY: 12, sigma: 10 } },
        ]) {
          const layout = stamp({ strip })
          const [box] = frameAt(layout, 500).boxes
          const margin = boxShadowMargin(strip.shadow)
          expect(box.x - margin).toBeGreaterThanOrEqual(0)
          expect(box.y - margin).toBeGreaterThanOrEqual(0)
          expect(box.x + box.w + margin).toBeLessThanOrEqual(layout.texture.width)
          expect(box.y + box.h + margin).toBeLessThanOrEqual(layout.texture.height)
        }
      })
    })
  })

  describe('rotation', () => {
    const turned = (rotate: CaptionLayoutSegment['rotate']) =>
      layoutCaptionSegment(punch({ rotate }), PORTRAIT, measure)

    it('turns the frame by the segment rotate, in degrees clockwise', () => {
      expect(frameAt(turned(1.2), 0).rotate).toBe(1.2)
      expect(frameAt(turned(-3), 0).rotate).toBe(-3)
    })

    it('follows rotate keyframes, timed from the segment start', () => {
      const layout = turned([
        { ft: 0, mode: 0, v: 0 },
        { ft: 1000, mode: 1, v: 10 },
      ])
      expect(frameAt(layout, 0).rotate).toBe(0)
      expect(frameAt(layout, 500).rotate).toBeCloseTo(5, 6)
      expect(frameAt(layout, 1500).rotate).toBe(10)
      const held = turned([
        { ft: 0, mode: 0, v: 2 },
        { ft: 1000, mode: 0, v: -2 },
      ])
      expect(frameAt(held, 999).rotate).toBe(2)
      expect(frameAt(held, 1000).rotate).toBe(-2)
    })

    it('puts the rotation in the frame key', () => {
      expect(captionFrameKey(frameAt(turned(1.2), 0))).not.toBe(
        captionFrameKey(frameAt(turned(-1.2), 0)),
      )
    })

    it('draws a turned caption on a texture as wide as its text, centred where it was', () => {
      const flat = layoutCaptionSegment(punch(), PORTRAIT, measure)
      const layout = turned(1.2)
      expect(layout.texture.width).toBeLessThan(PORTRAIT.width)
      expect(layout.texture.centerX).toBe(flat.texture.centerX)
      // Every word lands on the same frame pixel as without the turn.
      const onFrame = (l: CaptionSegmentLayout) =>
        frameAt(l, 0).words.map((w) => w.x + l.texture.centerX - l.texture.width / 2)
      expect(onFrame(layout)).toEqual(onFrame(flat))
      // Room for the whole line, its stroke and shadow.
      const words = frameAt(layout, 0).words
      expect(Math.min(...words.map((w) => w.x))).toBeGreaterThanOrEqual(layout.pad)
    })
  })

  it('leaves fill-pop frames without boxes or rotation', () => {
    const layout = layoutCaptionSegment(segment(['THE', 'PLANET']), PORTRAIT, measure)
    expect(frameAt(layout, 1000)).toMatchObject({ boxes: [], rotate: 0 })
    expect(layout.texture.width).toBe(PORTRAIT.width)
  })
})
