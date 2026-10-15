import { getByPos } from '../utils'

import { CaptionRenderReferenceSchema } from './caption-render-preference.zod'
import {
  CAPTION_PRESETS,
  captionSlotPositions,
  CaptionStyleSettingsError,
  DEFAULT_CAPTION_ACCENT,
  normalizeCaptionStyleSettings,
  readableInk,
  readCaptionStyleSettings,
  resolveCaptionRenderPref,
} from './caption-style'
import { getDefaultCaptionRenderPref } from './default-caption-render-pref'

const VIDEO_9_16 = { aspectRatio: '9:16', kind: 'video' } as const
const LOOP_9_16 = { aspectRatio: '9:16', kind: 'loop' } as const

/** Where the engine puts a pref's caption centre, as % of the frame height from the top. */
function centrePct(pref: ReturnType<typeof resolveCaptionRenderPref>): number {
  const y =
    pref.captionPosition === 'custom'
      ? (pref.captionCustomStyle?.rect?.yPct ?? 0)
      : getByPos(pref.captionPosition as 'bottom', pref.layoutAspectRatio).position[1]
  return ((1 - y) / 2) * 100
}

describe('resolveCaptionRenderPref', () => {
  it("gives today's caption look, unchanged, to a video nobody styled", () => {
    expect(resolveCaptionRenderPref(null, VIDEO_9_16)).toStrictEqual(getDefaultCaptionRenderPref())
    expect(resolveCaptionRenderPref(undefined, VIDEO_9_16)).toStrictEqual(
      getDefaultCaptionRenderPref(),
    )
    expect(
      resolveCaptionRenderPref(
        { accent: null, position: null, preset: null, size: null },
        VIDEO_9_16,
      ),
    ).toStrictEqual(getDefaultCaptionRenderPref())
  })

  it('starts a loop in Punch: big heavy uppercase, the whole chunk on screen, the accent word lit', () => {
    const pref = resolveCaptionRenderPref(null, LOOP_9_16)
    expect(pref.captionAnimation).toEqual({
      highlightColor: '#04f827',
      name: 'word-level_highlight_color',
    })
    expect(pref.highlightColor.primary).toBe('#04f827')
    expect(pref.enableHighlight).toBe(true)
    expect(pref.enableUppercase).toBe(true)
    expect(pref.lineCount).toBe(3)
    expect(pref.chunking).toBe('short')
    expect(pref.captionPosition).toBe('bottom')
    expect(pref.font).toMatchObject({
      color: '#ffffff',
      family: 'Montserrat',
      numericalSize: 45,
      stroke: { color: '#000000', enabled: true, width: 15 },
      style: ['900'],
    })
  })

  it('lets a picked preset win over the video kind', () => {
    expect(resolveCaptionRenderPref({ preset: 'classic' }, LOOP_9_16)).toStrictEqual(
      getDefaultCaptionRenderPref(),
    )
    expect(resolveCaptionRenderPref({ preset: 'punch' }, VIDEO_9_16).captionAnimation?.name).toBe(
      'word-level_highlight_color',
    )
  })

  it('draws Explainer as dark sentence-case text on a tilted paper strip, the accent word boxed', () => {
    const pref = resolveCaptionRenderPref({ preset: 'explainer' }, VIDEO_9_16)
    expect(pref.captionAnimation).toEqual({
      bgColor: '#04f827',
      highlightColor: '#111111',
      name: 'word-level_simple_bg-highlight',
    })
    expect(pref.highlightColor.primary).toBe('#111111')
    expect(pref.enableUppercase).toBe(false)
    expect(pref.lineCount).toBe(3)
    expect(pref.chunking).toBe('short')
    expect(pref.strip).toEqual({ color: '#F6F2E7', ink: '#111111', tiltDeg: 1.2 })
    expect(pref.font).toMatchObject({
      color: '#111111',
      family: 'Montserrat',
      numericalSize: 40,
      shadow: { enabled: false },
      stroke: { enabled: false },
      style: ['700'],
    })
  })

  it("keeps Classic free of the short-chunk and strip fields (today's track is built as before)", () => {
    const pref = resolveCaptionRenderPref({ preset: 'classic' }, VIDEO_9_16)
    expect('chunking' in pref).toBe(false)
    expect('strip' in pref).toBe(false)
  })

  it('puts the default caption in the bottom slot of the frame it is drawn on', () => {
    const portrait = resolveCaptionRenderPref(null, VIDEO_9_16)
    expect(portrait.layoutAspectRatio).toBe('portrait')
    expect(centrePct(portrait)).toBeCloseTo(80.9, 1)

    const landscape = resolveCaptionRenderPref(null, { aspectRatio: '16:9', kind: 'video' })
    expect(landscape.layoutAspectRatio).toBe('landscape')
    expect(landscape.captionPosition).toBe('bottom')
    expect(centrePct(landscape)).toBeCloseTo(88.1, 1)

    expect(
      resolveCaptionRenderPref(null, { aspectRatio: '1:1', kind: 'video' }).layoutAspectRatio,
    ).toBe('square')
    expect(
      resolveCaptionRenderPref({ preset: 'punch' }, { aspectRatio: '16:9', kind: 'loop' })
        .layoutAspectRatio,
    ).toBe('landscape')
  })

  it('places a chosen height as a custom centre in engine coordinates', () => {
    const pref = resolveCaptionRenderPref({ position: 66 }, VIDEO_9_16)
    expect(pref.captionPosition).toBe('custom')
    expect(pref.captionCustomStyle?.rect).toEqual({
      hPct: 1,
      type: 'CPct',
      wPct: 1,
      xPct: 0,
      yPct: -0.32,
    })
    expect(centrePct(pref)).toBeCloseTo(66, 6)
    expect(
      resolveCaptionRenderPref({ position: 50 }, VIDEO_9_16).captionCustomStyle?.rect?.yPct,
    ).toBe(0)
  })

  it('keeps the height and size inside their ranges', () => {
    expect(centrePct(resolveCaptionRenderPref({ position: 2 }, VIDEO_9_16))).toBeCloseTo(10, 6)
    expect(centrePct(resolveCaptionRenderPref({ position: 99 }, VIDEO_9_16))).toBeCloseTo(90, 6)
    expect(resolveCaptionRenderPref({ size: 10 }, VIDEO_9_16).font.numericalSize).toBe(21)
    expect(resolveCaptionRenderPref({ size: 400 }, VIDEO_9_16).font.numericalSize).toBe(56)
  })

  it("scales the preset's base font size, and its outline with it", () => {
    const classic = resolveCaptionRenderPref({ size: 120 }, VIDEO_9_16)
    expect(classic.font.numericalSize).toBe(42)
    expect(classic.font.stroke.width).toBe(10)
    const punch = resolveCaptionRenderPref({ size: 80 }, LOOP_9_16)
    expect(punch.font.numericalSize).toBe(36)
    expect(punch.font.stroke.width).toBe(12)
    expect(
      resolveCaptionRenderPref({ preset: 'explainer', size: 150 }, VIDEO_9_16).font.numericalSize,
    ).toBe(60)
  })

  it('colours the karaoke word in Classic and the accent word in Punch with the chosen highlight', () => {
    const classic = resolveCaptionRenderPref({ accent: '#FFE500' }, VIDEO_9_16)
    expect(classic.captionAnimation?.highlightColor).toBe('#ffe500')
    expect(classic.highlightColor).toEqual({ primary: '#ffe500', secondary: '#FFFD03' })

    const punch = resolveCaptionRenderPref({ accent: '#FF3EA5' }, LOOP_9_16)
    expect(punch.captionAnimation?.highlightColor).toBe('#ff3ea5')
    expect(punch.highlightColor.primary).toBe('#ff3ea5')
  })

  it("boxes Explainer's accent word in the highlight, with ink that stays readable on it", () => {
    const light = resolveCaptionRenderPref({ accent: '#FFE500', preset: 'explainer' }, VIDEO_9_16)
    expect(light.captionAnimation).toMatchObject({ bgColor: '#ffe500', highlightColor: '#111111' })
    const dark = resolveCaptionRenderPref({ accent: '#1A237E', preset: 'explainer' }, VIDEO_9_16)
    expect(dark.captionAnimation).toMatchObject({ bgColor: '#1a237e', highlightColor: '#ffffff' })
    expect(dark.highlightColor.primary).toBe('#ffffff')
  })

  it('refuses a near-white highlight in Punch, whose words are white, and uses the default', () => {
    for (const accent of ['#FFFFFF', '#F4F4F4', '#FFF8E7']) {
      const pref = resolveCaptionRenderPref({ accent }, LOOP_9_16)
      expect(pref.captionAnimation?.highlightColor).toBe(DEFAULT_CAPTION_ACCENT.toLowerCase())
      expect(pref.highlightColor.primary).toBe(DEFAULT_CAPTION_ACCENT.toLowerCase())
    }
    // Yellow is light but not white: it stays.
    expect(resolveCaptionRenderPref({ accent: '#FFE500' }, LOOP_9_16).highlightColor.primary).toBe(
      '#ffe500',
    )
  })

  it('reads a malformed saved value field by field, falling back to the defaults', () => {
    const garbage = { accent: 'green', position: 'high', preset: 'fancy', size: Number.NaN }
    expect(resolveCaptionRenderPref(garbage as never, VIDEO_9_16)).toStrictEqual(
      getDefaultCaptionRenderPref(),
    )
    expect(resolveCaptionRenderPref('punch' as never, VIDEO_9_16)).toStrictEqual(
      getDefaultCaptionRenderPref(),
    )
  })

  it('never hands out a shared preset object', () => {
    const pref = resolveCaptionRenderPref({ preset: 'punch' }, VIDEO_9_16)
    pref.font.stroke.width = 99
    pref.highlightColor.primary = '#000000'
    const again = resolveCaptionRenderPref({ preset: 'punch' }, VIDEO_9_16)
    expect(again.font.stroke.width).toBe(15)
    expect(again.highlightColor.primary).toBe('#04f827')
    expect(CAPTION_PRESETS.punch.pref().font.stroke.width).toBe(15)
  })
})

describe('resolveCaptionRenderPref with a chosen font', () => {
  const PRESETS = ['classic', 'punch', 'explainer'] as const
  const RATIOS = ['9:16', '16:9', '1:1', '4:5']

  it('changes nothing with the style default font, for every style and frame', () => {
    for (const preset of PRESETS) {
      for (const aspectRatio of RATIOS) {
        for (const kind of ['loop', 'video'] as const) {
          const opts = { aspectRatio, kind }
          const plain = resolveCaptionRenderPref({ preset, size: 120 }, opts)
          expect(resolveCaptionRenderPref({ font: null, preset, size: 120 }, opts)).toStrictEqual(
            plain,
          )
          expect(plain).not.toHaveProperty('fontFace')
        }
      }
    }
    expect(resolveCaptionRenderPref({ font: null }, VIDEO_9_16)).toStrictEqual(
      getDefaultCaptionRenderPref(),
    )
  })

  it.each([
    // Punch and Classic ask for 900, Explainer for 700: each snaps to a weight the family has.
    ['punch', 'Anton', '400'],
    ['punch', 'Dela Gothic One', '400'],
    ['punch', 'DM Sans', '700'],
    ['punch', 'PT Serif', '700'],
    ['punch', 'Roboto Serif', '600'],
    ['punch', 'Roboto', '900'],
    ['punch', 'Alegreya', '900'],
    ['classic', 'Roboto', '900'],
    ['classic', 'Anton', '400'],
    ['explainer', 'Roboto', '700'],
    ['explainer', 'Alegreya', '700'],
    ['explainer', 'Roboto Serif', '600'],
    ['explainer', 'Anton', '400'],
  ] as const)('draws %s in %s at weight %s, upright', (preset, family, weight) => {
    const pref = resolveCaptionRenderPref({ font: { family, source: 'pack' }, preset }, VIDEO_9_16)
    expect(pref.font.family).toBe(family)
    expect(pref.font.style).toEqual([weight])
    expect(pref.fontFace).toEqual({ file: expect.stringMatching(/\.ttf$/), source: 'pack' })
  })

  it('names the face it snapped to', () => {
    const pref = resolveCaptionRenderPref({ font: { family: 'Anton', source: 'pack' } }, LOOP_9_16)
    expect(pref.fontFace).toEqual({ file: 'Anton-Regular.ttf', source: 'pack' })
  })

  it('evens out the capital height: the size and the outline scale together', () => {
    // Anton's capitals are 0.859 em against Montserrat's 0.7: 0.8145 x.
    const anton = resolveCaptionRenderPref({ font: { family: 'Anton', source: 'pack' } }, LOOP_9_16)
    expect(anton.font.numericalSize).toBe(37) // 45 x 0.8145 = 36.65
    expect(anton.font.stroke.width).toBe(12) // 15 x 0.8145 = 12.2
    // Alegreya's are 0.637 em: 1.0989 x, on top of the chosen size.
    const alegreya = resolveCaptionRenderPref(
      { font: { family: 'Alegreya', source: 'pack' }, size: 120 },
      LOOP_9_16,
    )
    expect(alegreya.font.numericalSize).toBe(59) // 45 x 1.2 x 1.0989 = 59.3
    expect(alegreya.font.stroke.width).toBe(20) // 15 x 1.2 x 1.0989 = 19.8
    // DM Sans shares Montserrat's capital height: unchanged.
    const dmSans = resolveCaptionRenderPref(
      { font: { family: 'DM Sans', source: 'pack' }, preset: 'classic' },
      VIDEO_9_16,
    )
    expect(dmSans.font.numericalSize).toBe(35)
    expect(dmSans.font.stroke.width).toBe(8)
  })

  it('keeps everything but the face and the size as the style has it', () => {
    const plain = resolveCaptionRenderPref({ accent: '#FFE500', preset: 'explainer' }, VIDEO_9_16)
    const roboto = resolveCaptionRenderPref(
      { accent: '#FFE500', font: { family: 'Roboto', source: 'pack' }, preset: 'explainer' },
      VIDEO_9_16,
    )
    const { font: plainFont, ...plainRest } = plain
    const { font: robotoFont, fontFace: _face, ...robotoRest } = roboto
    expect(robotoRest).toStrictEqual(plainRest)
    expect({ ...robotoFont, family: 'Montserrat', numericalSize: 40 }).toStrictEqual(plainFont)
  })

  it('gives prefs the caption render schema accepts', () => {
    const pref = resolveCaptionRenderPref(
      { font: { family: 'PT Serif', source: 'pack' } },
      LOOP_9_16,
    )
    expect(CaptionRenderReferenceSchema.safeParse(pref).success).toBe(true)
  })
})

describe('normalizeCaptionStyleSettings', () => {
  it('keeps only the fields sent, tidied', () => {
    expect(
      normalizeCaptionStyleSettings({
        accent: '#ffe500',
        position: 66.66,
        preset: 'punch',
        size: 119.6,
      }),
    ).toEqual({ accent: '#FFE500', position: 66.7, preset: 'punch', size: 120 })
    expect(normalizeCaptionStyleSettings({ size: 90 })).toEqual({ size: 90 })
    expect(normalizeCaptionStyleSettings({})).toEqual({})
  })

  it('takes null as "back to the default"', () => {
    expect(
      normalizeCaptionStyleSettings({ accent: null, position: null, preset: null, size: null }),
    ).toEqual({ accent: null, position: null, preset: null, size: null })
  })

  it('clamps the height to 10-90 and the size to 60-160', () => {
    expect(normalizeCaptionStyleSettings({ position: 0, size: 1000 })).toEqual({
      position: 10,
      size: 160,
    })
    expect(normalizeCaptionStyleSettings({ position: 120, size: -5 })).toEqual({
      position: 90,
      size: 60,
    })
  })

  it.each([
    [{ preset: 'fancy' }, /classic, punch or explainer/],
    [{ accent: 'green' }, /#04F827/],
    [{ accent: '#fff' }, /#04F827/],
    [{ position: '50' }, /height/],
    [{ size: true }, /size/],
    [{ positionY: 50 }, /positionY/],
  ])('rejects %j in plain words', (input, message) => {
    expect(() => normalizeCaptionStyleSettings(input)).toThrow(CaptionStyleSettingsError)
    expect(() => normalizeCaptionStyleSettings(input)).toThrow(message)
  })

  it('saves a pack font, and the style default (Montserrat) as null', () => {
    expect(normalizeCaptionStyleSettings({ font: { family: 'Anton', source: 'pack' } })).toEqual({
      font: { family: 'Anton', source: 'pack' },
    })
    expect(
      normalizeCaptionStyleSettings({ font: { family: 'Montserrat', source: 'pack' } }),
    ).toEqual({ font: null })
    expect(normalizeCaptionStyleSettings({ font: null })).toEqual({ font: null })
  })

  it.each([
    [{ font: { family: 'Comic Sans', source: 'pack' } }],
    [{ font: { family: 'Inter', source: 'pack' } }],
    [{ font: { family: 'anton', source: 'pack' } }],
    [{ font: { family: 'Anton', source: 'upload' } }],
    [{ font: { family: 'Anton' } }],
    [{ font: 'Anton' }],
  ])('rejects the font %j in plain words', (input) => {
    expect(() => normalizeCaptionStyleSettings(input)).toThrow(CaptionStyleSettingsError)
    expect(() => normalizeCaptionStyleSettings(input)).toThrow(
      'Caption font must be one of Montserrat, Anton, DM Sans, Dela Gothic One, Roboto, Alegreya, PT Serif or Roboto Serif',
    )
  })

  it('rejects a body that is not an object', () => {
    for (const input of [null, undefined, 'punch', 5, ['punch']]) {
      expect(() => normalizeCaptionStyleSettings(input)).toThrow(CaptionStyleSettingsError)
    }
  })
})

describe('readCaptionStyleSettings', () => {
  it('reads a saved value, dropping anything malformed', () => {
    expect(readCaptionStyleSettings(null)).toBeNull()
    expect(readCaptionStyleSettings(undefined)).toBeNull()
    expect(readCaptionStyleSettings('punch')).toBeNull()
    expect(
      readCaptionStyleSettings({
        accent: 'green',
        extra: 1,
        position: 40,
        preset: 'punch',
        size: 'big',
      }),
    ).toEqual({ position: 40, preset: 'punch' })
    expect(readCaptionStyleSettings({ position: 3, size: 900 })).toEqual({
      position: 10,
      size: 160,
    })
    expect(readCaptionStyleSettings({ accent: null, preset: null })).toEqual({
      accent: null,
      preset: null,
    })
  })
})

describe('readCaptionStyleSettings with a font', () => {
  it('reads a saved pack font, and anything else as the style default', () => {
    expect(readCaptionStyleSettings({ font: { family: 'Roboto', source: 'pack' } })).toEqual({
      font: { family: 'Roboto', source: 'pack' },
    })
    expect(readCaptionStyleSettings({ font: null, preset: 'punch' })).toEqual({
      font: null,
      preset: 'punch',
    })
    for (const font of [
      { family: 'Comic Sans', source: 'pack' },
      { family: 'Montserrat', source: 'pack' },
      { family: 'Anton', source: 'upload' },
      'Anton',
      5,
    ]) {
      expect(readCaptionStyleSettings({ font, preset: 'punch' })).toEqual({
        font: null,
        preset: 'punch',
      })
    }
  })
})

describe('captionSlotPositions', () => {
  it("names today's top, middle and bottom heights for the frame", () => {
    expect(captionSlotPositions('9:16')).toEqual({ bottom: 80.9, middle: 50, top: 25.5 })
    expect(captionSlotPositions('16:9').bottom).toBe(88.1)
  })

  it('matches where the resolver puts the default caption', () => {
    for (const aspectRatio of ['9:16', '16:9']) {
      const pref = resolveCaptionRenderPref(null, { aspectRatio, kind: 'video' })
      expect(centrePct(pref)).toBeCloseTo(captionSlotPositions(aspectRatio).bottom, 1)
    }
  })
})

describe('CAPTION_PRESETS', () => {
  it("gives prefs the caption render schema accepts, Punch's highlight animation included", () => {
    for (const preset of Object.keys(CAPTION_PRESETS) as Array<keyof typeof CAPTION_PRESETS>) {
      for (const kind of ['loop', 'video'] as const) {
        const pref = resolveCaptionRenderPref({ preset }, { aspectRatio: '9:16', kind })
        expect(CaptionRenderReferenceSchema.safeParse(pref).success).toBe(true)
      }
    }
    expect(CAPTION_PRESETS.punch.pref().captionAnimation?.name).toBe('word-level_highlight_color')
  })
})

describe('readableInk', () => {
  it('picks near-black or white, whichever reads better on the colour', () => {
    expect(readableInk('#04F827')).toBe('#111111')
    expect(readableInk('#FFE500')).toBe('#111111')
    expect(readableInk('#FF9500')).toBe('#111111')
    expect(readableInk('#1A237E')).toBe('#FFFFFF')
    expect(readableInk('#000000')).toBe('#FFFFFF')
  })
})
