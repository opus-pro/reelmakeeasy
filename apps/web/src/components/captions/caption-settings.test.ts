import type { CaptionStyleSettings } from '@shared/types/api/caption-style'

import {
  CAPTION_SWATCHES,
  captionAspectRatio,
  type CaptionKind,
  captionStyleNeedsRender,
  defaultCaptionPreset,
  effectiveCaptionStyle,
  parseHexColour,
} from './caption-settings'

describe('caption settings helpers', () => {
  it('offers the five highlight colours, green first', () => {
    expect(CAPTION_SWATCHES.map((s) => [s.name, s.colour])).toEqual([
      ['Green', '#04F827'],
      ['Yellow', '#FFE500'],
      ['Cyan', '#00E5FF'],
      ['Pink', '#FF3EA5'],
      ['Orange', '#FF8A00'],
    ])
  })

  it('starts loops in Punch and every other video in Classic', () => {
    expect(defaultCaptionPreset('loop')).toBe('punch')
    expect(defaultCaptionPreset('video')).toBe('classic')
  })

  it('writes a CSS ratio the way the caption resolver reads it', () => {
    expect(captionAspectRatio('9 / 16')).toBe('9:16')
    expect(captionAspectRatio('16 / 9')).toBe('16:9')
    expect(captionAspectRatio('1:1')).toBe('1:1')
    expect(captionAspectRatio(undefined)).toBe('9:16')
  })

  it('reads a typed colour with or without the #, and refuses anything else', () => {
    expect(parseHexColour('#ff3ea5')).toBe('#FF3EA5')
    expect(parseHexColour(' 00e5ff ')).toBe('#00E5FF')
    expect(parseHexColour('#fff')).toBeNull()
    expect(parseHexColour('#GG0000')).toBeNull()
    expect(parseHexColour('')).toBeNull()
  })

  it('fills in what was never chosen with the defaults for the video kind', () => {
    expect(effectiveCaptionStyle(null, 'loop')).toEqual({
      accent: '#04F827',
      position: null,
      preset: 'punch',
      size: 100,
    })
    expect(
      effectiveCaptionStyle({ accent: '#ff3ea5', position: 40, preset: null, size: 120 }, 'video'),
    ).toEqual({ accent: '#FF3EA5', position: 40, preset: 'classic', size: 120 })
  })

  it('counts a look as the same when it draws the same captions', () => {
    const on = (kind: CaptionKind) => ({ aspectRatio: '9 / 16', captionsOn: true, kind }) as const
    // Unset fields and their defaults.
    expect(captionStyleNeedsRender({ preset: 'punch' }, {}, on('loop'))).toBe(false)
    expect(
      captionStyleNeedsRender({ accent: '#04f827', preset: 'punch', size: 100 }, null, on('loop')),
    ).toBe(false)
    // Punch draws a near-white highlight in the default green.
    expect(
      captionStyleNeedsRender(
        { accent: '#F4F4F4', preset: 'punch' },
        { preset: 'punch' },
        on('video'),
      ),
    ).toBe(false)
    expect(captionStyleNeedsRender({ preset: 'classic' }, { preset: 'punch' }, on('video'))).toBe(
      true,
    )
    expect(captionStyleNeedsRender({ accent: '#FFE500' }, { accent: '#04F827' }, on('video'))).toBe(
      true,
    )
    expect(captionStyleNeedsRender({ position: 30 }, { position: null }, on('video'))).toBe(true)
    expect(captionStyleNeedsRender({ size: 140 }, { size: 140 }, on('video'))).toBe(false)
  })

  it('renders a file again only when its look differs from the one chosen', () => {
    const portrait = { aspectRatio: '9 / 16', captionsOn: true, kind: 'video' } as const
    expect(captionStyleNeedsRender({ size: 140 }, { size: 140 }, portrait)).toBe(false)
    expect(captionStyleNeedsRender({ preset: 'punch' }, null, portrait)).toBe(true)
    // A look the last render recorded, defaults filled in, against nothing chosen since.
    expect(
      captionStyleNeedsRender(
        { accent: '#04F827', position: null, preset: 'punch', size: 100 },
        null,
        { aspectRatio: '9:16', captionsOn: true, kind: 'loop' },
      ),
    ).toBe(false)
  })

  it('takes a file rendered before saved looks as having the old default caption', () => {
    // Classic, laid out for a tall frame: what every video and loop was rendered with then.
    const needsRender = (
      latest: CaptionStyleSettings | null,
      aspectRatio: string,
      kind: CaptionKind,
    ) => captionStyleNeedsRender(null, latest, { aspectRatio, captionsOn: true, kind })
    expect(needsRender(null, '9 / 16', 'video')).toBe(false)
    expect(needsRender({ accent: '#04f827', preset: 'classic', size: 100 }, '9:16', 'video')).toBe(
      false,
    )
    // A wide or square video's captions now sit where its frame wants them.
    expect(needsRender(null, '16 / 9', 'video')).toBe(true)
    expect(needsRender(null, '1:1', 'video')).toBe(true)
    // A loop nobody styled is Punch now.
    expect(needsRender(null, '9 / 16', 'loop')).toBe(true)
    expect(needsRender({ preset: 'classic' }, '9:16', 'loop')).toBe(false)
    expect(needsRender({ accent: '#FFE500' }, '9:16', 'video')).toBe(true)
    // A loop is drawn for 9:16 whatever ratio its row names, as its render draws it.
    expect(needsRender({ preset: 'classic' }, '16 / 9', 'loop')).toBe(false)
  })

  it("with captions off, looks only at a loop's highlight: its fact stamps still show it", () => {
    const off = (aspectRatio: string, kind: CaptionKind) =>
      ({ aspectRatio, captionsOn: false, kind }) as const
    // No captions to place or style on a plain video, whatever its frame.
    expect(captionStyleNeedsRender(null, null, off('16 / 9', 'video'))).toBe(false)
    expect(captionStyleNeedsRender({ preset: 'punch' }, null, off('9:16', 'video'))).toBe(false)
    // The stamps were green before saved looks, and Punch keeps them green.
    expect(captionStyleNeedsRender(null, null, off('9:16', 'loop'))).toBe(false)
    expect(captionStyleNeedsRender(null, { accent: '#FF3EA5' }, off('9:16', 'loop'))).toBe(true)
    expect(
      captionStyleNeedsRender(
        { accent: '#FF3EA5', preset: 'punch' },
        { accent: '#ff3ea5', preset: 'explainer', size: 140 },
        off('9:16', 'loop'),
      ),
    ).toBe(false)
  })
})
