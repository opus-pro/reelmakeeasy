import {
  drawRankingOverlay,
  drawRankingTransition,
  type RankingCanvas,
  slideTextLayout,
} from './ranking-overlay'
import { DEFAULT_RANKING_TRANSITION, newRankingProject } from './ranking-project'

/** A canvas that measures every character as 0.5 em and records what is written. */
function fakeCanvas() {
  const texts: { fill: unknown; font: string; text: string; x: number; y: number }[] = []
  const ctx: RankingCanvas = {
    clearRect: () => undefined,
    drawImage: () => undefined,
    fillRect: () => undefined,
    fillStyle: '',
    fillText(text, x, y) {
      texts.push({ fill: this.fillStyle, font: this.font, text, x, y })
    },
    font: '10px sans',
    lineJoin: 'miter',
    lineWidth: 1,
    measureText(text) {
      const size = Number(/(\d+)px/.exec(this.font)?.[1] ?? 10)
      return { width: text.length * size * 0.5 }
    },
    miterLimit: 10,
    restore: () => undefined,
    rotate: () => undefined,
    save: () => undefined,
    strokeStyle: '',
    strokeText: () => undefined,
    textAlign: 'left',
    textBaseline: 'alphabetic',
    translate: () => undefined,
  }
  return { ctx, texts }
}

describe('drawRankingOverlay', () => {
  it('draws the coloured title, every number, and only the revealed labels', () => {
    const p = newRankingProject('p', 'now')
    p.items = p.items.map((item) => ({ ...item, label: `Label ${item.rank}` }))
    const { ctx, texts } = fakeCanvas()
    const layout = drawRankingOverlay(ctx, p, [4])
    const written = texts.map((t) => t.text)
    expect(written).toEqual(expect.arrayContaining(['Ranking', 'Funniest', 'Cat Fails', 'Ever']))
    expect(texts.find((t) => t.text === 'Funniest')?.fill).toBe('#ff2a2a')
    expect(written.filter((t) => /^\d+\.$/.test(t))).toEqual(['1.', '2.', '3.', '4.', '5.'])
    expect(written).toContain('Label 4')
    expect(written).not.toContain('Label 1')
    // Rows run top to bottom by rank, below the band.
    const ys = [1, 2, 3, 4, 5].map((r) => layout.rowY.get(r) as number)
    expect(ys).toEqual(ys.toSorted((a, b) => a - b))
    expect(ys[0]).toBeGreaterThan(layout.bandHeight)
    expect(ys[4]).toBeLessThan(1920)
  })

  it('shrinks a long title to fit the width', () => {
    const p = newRankingProject('p', 'now')
    p.title.lines = [
      [{ color: '#fff', text: 'An extremely long ranking title that cannot fit at full size' }],
    ]
    const { ctx } = fakeCanvas()
    const layout = drawRankingOverlay(ctx, p, [])
    expect(layout.titleSize).toBeLessThan(86)
  })

  it("draws the whole short's stickers always, and a rank's only while it plays", () => {
    const p = newRankingProject('p', 'now')
    p.stickers = [
      {
        color: '#fff',
        id: 's1',
        kind: 'text',
        rank: null,
        rotation: 0,
        size: 0.05,
        text: '😂',
        x: 0.8,
        y: 0.2,
      },
      {
        color: '#fff',
        id: 's2',
        kind: 'text',
        rank: 3,
        rotation: 10,
        size: 0.05,
        text: 'NO WAY',
        x: 0.5,
        y: 0.5,
      },
    ]
    const drawn = (rank: null | number | undefined) => {
      const { ctx, texts } = fakeCanvas()
      drawRankingOverlay(ctx, p, [], { rank })
      return texts.map((t) => t.text).filter((t) => t === '😂' || t === 'NO WAY')
    }
    expect(drawn(1)).toEqual(['😂'])
    expect(drawn(3)).toEqual(['😂', 'NO WAY'])
  })
})

describe('slide text', () => {
  const slide = (over: Partial<typeof DEFAULT_RANKING_TRANSITION> = {}) => {
    const p = newRankingProject('p', 'now')
    p.transition = { ...DEFAULT_RANKING_TRANSITION, enabled: true, text: 'Next #{rank}', ...over }
    return p
  }

  it('sits in the middle at its default size, in the title font', () => {
    const { ctx } = fakeCanvas()
    const layout = slideTextLayout(ctx, slide(), 3)
    expect(layout).toMatchObject({ size: 150, text: 'Next #3', x: 0.5, y: 0.5 })
    expect(layout.family).toContain('Montserrat')
  })

  it('draws where it was placed, at its size and in its font', () => {
    const { ctx, texts } = fakeCanvas()
    const p = slide({ font: 'dela', textSize: 0.05, textX: 0.25, textY: 0.8 })
    drawRankingTransition(ctx, p, 2)
    const drawn = texts.find((t) => t.text === 'Next #2')
    expect(drawn).toMatchObject({ x: 0.25 * 1080, y: 0.8 * 1920 })
    expect(drawn?.font).toContain(`${Math.round(0.05 * 1920)}px`)
    expect(drawn?.font).toContain('RME dela')
  })

  it('draws in its own font even when that is Montserrat and the title has another', () => {
    const { ctx } = fakeCanvas()
    const p = slide({ font: 'montserrat' })
    p.style = { ...p.style, titleFont: 'anton' }
    expect(slideTextLayout(ctx, p, 1).family).not.toContain('RME anton')
    // No font of its own: the title's.
    expect(slideTextLayout(ctx, { ...p, transition: slide().transition }, 1).family).toContain(
      'RME anton',
    )
  })

  it('shrinks text too wide for the frame, and its box fits what it draws', () => {
    const { ctx } = fakeCanvas()
    const layout = slideTextLayout(
      ctx,
      slide({ text: 'A very long slide text that is too wide' }),
      1,
    )
    expect(layout.size).toBeLessThan(150)
    expect(layout.w).toBeLessThanOrEqual(1)
    expect(layout.h).toBeCloseTo((layout.size * 1.25) / 1920)
  })
})
