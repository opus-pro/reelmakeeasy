import { drawRankingOverlay, type RankingCanvas } from './ranking-overlay'
import { newRankingProject } from './ranking-project'

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
