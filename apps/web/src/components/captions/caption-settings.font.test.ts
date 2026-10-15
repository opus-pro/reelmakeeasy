const mockCaptionLookChanged = jest.fn()
jest.mock('@reelmakeeasy/common/adapters/caption/caption-look', () => {
  const actual = jest.requireActual('@reelmakeeasy/common/adapters/caption/caption-look')
  return {
    ...actual,
    captionLookChanged: (...args: unknown[]) => {
      mockCaptionLookChanged(...args)
      return actual.captionLookChanged(...args)
    },
  }
})

import { captionStyleRenderChanged } from '@/atom/longtake-history.store'

import { captionStyleNeedsRender } from './caption-settings'

describe('the Download check and the caption font', () => {
  beforeEach(() => mockCaptionLookChanged.mockReset())

  it("compares the font on screen with the delivered file's, through the shared rule", () => {
    const rendered = {
      accent: '#04F827',
      font: { family: 'Anton', source: 'pack' },
      position: null,
      preset: 'classic',
      size: 100,
    } as const
    const latest = { font: { family: 'PT Serif', source: 'pack' } } as const

    captionStyleNeedsRender(rendered, latest, {
      aspectRatio: '9 / 16',
      captionsOn: true,
      kind: 'video',
    })
    expect(mockCaptionLookChanged).toHaveBeenCalledWith({
      aspectRatio: '9:16',
      enableCaption: true,
      kind: 'video',
      rendered,
      wanted: latest,
    })
  })

  it('asks for a new render when only the font changed, and not when it is the same', () => {
    const opts = { aspectRatio: '9 / 16', captionsOn: true, kind: 'video' } as const
    const rendered = {
      accent: '#04F827',
      font: { family: 'Anton', source: 'pack' },
      position: null,
      preset: 'classic',
      size: 100,
    } as const

    expect(
      captionStyleNeedsRender(rendered, { font: { family: 'PT Serif', source: 'pack' } }, opts),
    ).toBe(true)
    expect(captionStyleNeedsRender(rendered, { font: null }, opts)).toBe(true)
    expect(
      captionStyleNeedsRender(rendered, { font: { family: 'Anton', source: 'pack' } }, opts),
    ).toBe(false)
  })

  it("passes the editor's font to the same rule when Download decides", () => {
    const latest = { font: { family: 'Roboto', source: 'pack' } } as const
    captionStyleRenderChanged(
      { aspectRatio: '16:9', kind: 'loop', known: true, latest, original: null },
      true,
    )
    expect(mockCaptionLookChanged).toHaveBeenCalledWith(
      expect.objectContaining({
        enableCaption: true,
        kind: 'loop',
        rendered: null,
        wanted: latest,
      }),
    )
  })
})
