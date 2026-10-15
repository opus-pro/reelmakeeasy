import {
  captionLayoutRatio,
  captionLookChanged,
  captionStampColor,
  effectiveCaptionStyle,
  readRenderedCaptionStyle,
  resolveCaptionLook,
} from './caption-look'
import { resolveCaptionRenderPref } from './caption-style'
import { getDefaultCaptionRenderPref } from './default-caption-render-pref'

const CLASSIC = { accent: '#04F827', position: null, preset: 'classic', size: 100 }
const PUNCH = { ...CLASSIC, preset: 'punch' }
const ANTON = { family: 'Anton', source: 'pack' } as const

describe('effectiveCaptionStyle', () => {
  it("fills in the kind's defaults: a loop nobody styled is Punch, any other video Classic", () => {
    expect(effectiveCaptionStyle(null, 'loop')).toEqual(PUNCH)
    expect(effectiveCaptionStyle(undefined, 'video')).toEqual(CLASSIC)
    expect(
      effectiveCaptionStyle({ accent: null, position: null, preset: null, size: null }, 'video'),
    ).toEqual(CLASSIC)
  })

  it('keeps what was chosen, tidied like the saved settings, and drops what is malformed', () => {
    expect(
      effectiveCaptionStyle(
        { accent: '#ffe500', position: 95, preset: 'explainer', size: 120 },
        'loop',
      ),
    ).toEqual({ accent: '#FFE500', position: 90, preset: 'explainer', size: 120 })
    expect(
      effectiveCaptionStyle({ accent: 'green', preset: 'fancy', size: 'big' }, 'loop'),
    ).toEqual(PUNCH)
  })

  it('records the chosen font, and nothing for the style default, as before fonts', () => {
    expect(effectiveCaptionStyle({ font: ANTON }, 'loop')).toStrictEqual({ ...PUNCH, font: ANTON })
    for (const font of [null, { family: 'Montserrat', source: 'pack' }, { family: 'Comic Sans' }]) {
      expect(effectiveCaptionStyle({ font }, 'loop')).toStrictEqual(PUNCH)
    }
  })
})

describe('resolveCaptionLook', () => {
  it('draws a 9:16 video nobody styled exactly as before', () => {
    const look = resolveCaptionLook(null, { aspectRatio: '9:16', kind: 'video' })
    expect(look.captionRenderPref).toStrictEqual(getDefaultCaptionRenderPref())
    expect(look.captionStyle).toEqual(CLASSIC)
  })

  it('lays a 16:9 video out for its own frame (the bottom slot of a landscape frame)', () => {
    const look = resolveCaptionLook(null, { aspectRatio: '16:9', kind: 'video' })
    expect(look.captionRenderPref).toStrictEqual({
      ...getDefaultCaptionRenderPref(),
      layoutAspectRatio: 'landscape',
    })
  })

  it('lays a loop out for 9:16 whatever ratio its row names, as the loop render delivers it', () => {
    for (const aspectRatio of ['16:9', '1:1', '9:16']) {
      expect(
        resolveCaptionLook({ preset: 'classic' }, { aspectRatio, kind: 'loop' }).captionRenderPref,
      ).toStrictEqual(getDefaultCaptionRenderPref())
    }
    expect(captionLayoutRatio('loop', '16:9')).toBe('9:16')
    expect(captionLayoutRatio('video', '16:9')).toBe('16:9')
    expect(captionLayoutRatio('video', null)).toBe('9:16')
  })

  it('starts a loop nobody styled in Punch', () => {
    const look = resolveCaptionLook(null, { aspectRatio: '9:16', kind: 'loop' })
    expect(look.captionRenderPref).toStrictEqual(
      resolveCaptionRenderPref(null, { aspectRatio: '9:16', kind: 'loop' }),
    )
    expect(look.captionRenderPref.captionAnimation?.name).toBe('word-level_highlight_color')
    expect(look.captionStyle).toEqual(PUNCH)
  })

  it.each([
    [null, 'video'],
    [null, 'loop'],
    [{ preset: 'classic' }, 'loop'],
    [{ accent: '#FF3EA5', size: 80 }, 'loop'],
    [{ position: 30, preset: 'explainer', size: 140 }, 'video'],
    [{ accent: '#1A237E', preset: 'punch' }, 'video'],
    [{ font: ANTON, size: 130 }, 'loop'],
    [{ font: { family: 'Roboto Serif', source: 'pack' }, preset: 'explainer' }, 'video'],
  ] as const)('records settings that draw the same look again (%j on a %s)', (settings, kind) => {
    const opts = { aspectRatio: '9:16', kind }
    const look = resolveCaptionLook(settings, opts)
    expect(resolveCaptionRenderPref(look.captionStyle, opts)).toStrictEqual(look.captionRenderPref)
  })
})

describe('captionLookChanged', () => {
  const TALL = { aspectRatio: '9:16', enableCaption: true }
  type Params = Parameters<typeof captionLookChanged>[0]
  const changed = (params: Partial<Params> & Pick<Params, 'kind'>) =>
    captionLookChanged({ ...TALL, rendered: null, wanted: null, ...params })

  it('sees no change when the wanted look resolves to the one rendered', () => {
    expect(changed({ kind: 'video', rendered: CLASSIC })).toBe(false)
    expect(changed({ kind: 'loop', rendered: PUNCH, wanted: undefined })).toBe(false)
    expect(
      changed({ kind: 'loop', rendered: PUNCH, wanted: { accent: '#04f827', size: 100 } }),
    ).toBe(false)
    // Punch draws a near-white highlight in the default green: the same captions.
    expect(changed({ kind: 'loop', rendered: PUNCH, wanted: { accent: '#F4F4F4' } })).toBe(false)
    expect(changed({ aspectRatio: '16:9', kind: 'video', rendered: CLASSIC, wanted: null })).toBe(
      false,
    )
  })

  it.each([
    [{ preset: 'explainer' }],
    [{ accent: '#FFE500' }],
    [{ position: 66 }],
    [{ size: 120 }],
    [{ font: ANTON }],
  ])('sees a change in any one setting (%j)', (wanted) => {
    expect(changed({ kind: 'video', rendered: CLASSIC, wanted })).toBe(true)
  })

  it('sees a font change, and none between the style default and no font', () => {
    const roboto = { family: 'Roboto', source: 'pack' } as const
    expect(
      changed({ kind: 'loop', rendered: { ...PUNCH, font: ANTON }, wanted: { font: roboto } }),
    ).toBe(true)
    expect(
      changed({ kind: 'loop', rendered: { ...PUNCH, font: ANTON }, wanted: { font: null } }),
    ).toBe(true)
    expect(
      changed({ kind: 'loop', rendered: { ...PUNCH, font: ANTON }, wanted: { font: ANTON } }),
    ).toBe(false)
    // A record without a font (the style's own, or from before fonts) is Montserrat.
    expect(changed({ kind: 'loop', rendered: PUNCH, wanted: { font: null } })).toBe(false)
    expect(
      changed({
        kind: 'loop',
        rendered: PUNCH,
        wanted: { font: { family: 'Montserrat', source: 'pack' } },
      }),
    ).toBe(false)
  })

  it('takes a file from before looks were recorded as the old default: Classic laid out for 9:16', () => {
    expect(changed({ kind: 'video' })).toBe(false)
    expect(changed({ kind: 'video', wanted: { preset: 'punch' } })).toBe(true)
    // Loops were drawn in it too: one nobody styled now renders into Punch.
    expect(changed({ kind: 'loop' })).toBe(true)
    expect(changed({ kind: 'loop', rendered: undefined, wanted: { preset: 'classic' } })).toBe(
      false,
    )
    // A wide or square video's captions now sit where its own frame wants them, as the
    // previews show, so its old file (laid out for 9:16) renders again.
    expect(changed({ aspectRatio: '16:9', kind: 'video' })).toBe(true)
    expect(changed({ aspectRatio: '1:1', kind: 'video' })).toBe(true)
    // A loop is laid out for 9:16 whatever ratio its row names, as its render draws it.
    expect(
      changed({ aspectRatio: '16:9', kind: 'loop', rendered: null, wanted: { preset: 'classic' } }),
    ).toBe(false)
  })

  it('with the captions off, sees only what a loop still shows: its stamps, in the highlight', () => {
    const off = { enableCaption: false }
    // A video shows no captions at all, whatever their look.
    expect(changed({ ...off, kind: 'video', rendered: CLASSIC, wanted: PUNCH })).toBe(false)
    expect(changed({ ...off, aspectRatio: '16:9', kind: 'video' })).toBe(false)
    // A loop's stamps take the highlight colour, whatever the style.
    expect(
      changed({ ...off, kind: 'loop', rendered: PUNCH, wanted: { preset: 'explainer' } }),
    ).toBe(false)
    expect(changed({ ...off, kind: 'loop', rendered: PUNCH, wanted: { accent: '#FFE500' } })).toBe(
      true,
    )
    expect(changed({ ...off, kind: 'loop' })).toBe(false)
    expect(changed({ ...off, kind: 'loop', wanted: { accent: '#FF3EA5' } })).toBe(true)
  })
})

describe('captionStampColor', () => {
  const stampOf = (settings: object) =>
    captionStampColor(resolveCaptionRenderPref(settings, { aspectRatio: '9:16', kind: 'loop' }))

  it('is the highlight colour, whatever the style', () => {
    expect(captionStampColor(getDefaultCaptionRenderPref())).toBe('#04f827')
    expect(stampOf({ accent: '#FF3EA5', preset: 'classic' })).toBe('#ff3ea5')
    expect(stampOf({ accent: '#FF3EA5', preset: 'punch' })).toBe('#ff3ea5')
    // Explainer paints the highlight as the box behind the word; its text takes a dark or white
    // ink, which is not the video's colour.
    expect(stampOf({ preset: 'explainer' })).toBe('#04f827')
    expect(stampOf({ accent: '#1A237E', preset: 'explainer' })).toBe('#1a237e')
  })

  it('follows what Punch draws: a near-white highlight shows as the default', () => {
    expect(stampOf({ accent: '#F4F4F4', preset: 'punch' })).toBe('#04f827')
    expect(stampOf({ accent: '#F4F4F4', preset: 'classic' })).toBe('#f4f4f4')
  })
})

describe('readRenderedCaptionStyle', () => {
  it("reads the look a video script was rendered with, or null when it doesn't say", () => {
    expect(readRenderedCaptionStyle({ captionStyle: PUNCH, tracks: [] })).toEqual(PUNCH)
    expect(readRenderedCaptionStyle({ captionRenderPref: {}, tracks: [] })).toBeNull()
    expect(readRenderedCaptionStyle(undefined)).toBeNull()
    expect(readRenderedCaptionStyle('not a script')).toBeNull()
    expect(readRenderedCaptionStyle({ captionStyle: { preset: 'fancy', size: 120 } })).toEqual({
      size: 120,
    })
  })
})
