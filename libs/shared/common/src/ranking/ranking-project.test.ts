import type { RankingProject } from '@shared/types/api/ranking'

import { rankingCoverKey, rankingCoverShot } from './ranking-cover'
import {
  clampSlideTextSize,
  DEFAULT_RANKING_TRANSITION,
  hasOwnSlideText,
  isPermutation,
  newRankingProject,
  pruneSlideTexts,
  rankingProblems,
  rankingSegments,
  rankingTimeline,
  revealOrder,
  slideTextOf,
  transitionOf,
  transitionText,
  withRankCount,
  withSlideText,
} from './ranking-project'

const clip = (dur: number, start = 0, end = dur) => ({
  durationSec: dur,
  name: 'c.mp4',
  trimEndSec: end,
  trimStartSec: start,
  url: 'store://ranking/p/clips/c.mp4',
})

describe('revealOrder', () => {
  it('counts down, counts up, and keeps a valid custom order', () => {
    expect(revealOrder('countdown', 4)).toEqual([4, 3, 2, 1])
    expect(revealOrder('countup', 3)).toEqual([1, 2, 3])
    expect(revealOrder('custom', 3, [2, 3, 1])).toEqual([2, 3, 1])
    expect(revealOrder('custom', 3, [2, 2, 1])).toEqual([3, 2, 1])
  })

  it('shuffles the same way every time, keeping rank 1 for last', () => {
    for (let n = 2; n <= 10; n++) {
      const order = revealOrder('shuffle', n)
      expect(isPermutation(order, n)).toBe(true)
      expect(order.at(-1)).toBe(1)
      expect(revealOrder('shuffle', n)).toEqual(order)
    }
  })
})

describe('rankingSegments', () => {
  it('plays clips in reveal order, each revealing its rank on top of the earlier ones', () => {
    const p: RankingProject = newRankingProject('p', '2026-10-19T00:00:00Z')
    p.items = p.items
      .slice(0, 3)
      .map((item, i) => ({ ...item, clip: clip(10, 1, 1 + 2 + i), label: `L${i + 1}` }))
    p.reveal = { mode: 'countdown', order: [3, 2, 1] }
    const segs = rankingSegments(p)
    expect(segs.map((s) => [s.item.rank, s.startSec, s.durSec, s.revealed])).toEqual([
      [3, 0, 4, [3]],
      [2, 4, 3, [3, 2]],
      [1, 7, 2, [3, 2, 1]],
    ])
  })

  it('caps a clip at 20 s and skips ranks without one', () => {
    const p = newRankingProject('p', 'now')
    p.items = [
      { ...p.items[0]!, clip: clip(60) },
      { ...p.items[1]!, clip: null },
    ]
    p.reveal = { mode: 'countup', order: [1, 2] }
    expect(rankingSegments(p).map((s) => s.durSec)).toEqual([20])
  })
})

describe('rankingProblems', () => {
  it('names the missing clips, labels and title', () => {
    const p = newRankingProject('p', 'now')
    p.title = { band: '#000', lines: [[{ color: '#fff', text: ' ' }]] }
    expect(rankingProblems(p)).toEqual([
      'Add a clip to rank 1, 2, 3, 4, 5.',
      'Write a label for rank 1, 2, 3, 4, 5.',
      'Write a title.',
    ])
  })
})

describe('rankingTimeline', () => {
  it('puts a transition slide between ranks, never before the first', () => {
    const p = newRankingProject('p', 'now')
    p.items = p.items.slice(0, 3).map((item) => ({
      ...item,
      clip: {
        durationSec: 5,
        name: 'c',
        trimEndSec: 2,
        trimStartSec: 0,
        url: 'store://ranking/p/c.mp4',
      },
    }))
    p.reveal = { mode: 'countdown', order: [3, 2, 1] }
    p.transition = { ...p.transition!, durationSec: 1, enabled: true }
    expect(
      rankingTimeline(p).map((t) => [
        t.kind,
        t.startSec,
        t.durSec,
        t.kind === 'transition' ? t.nextRank : t.segment.item.rank,
      ]),
    ).toEqual([
      ['clip', 0, 2, 3],
      ['transition', 2, 1, 2],
      ['clip', 3, 2, 2],
      ['transition', 5, 1, 1],
      ['clip', 6, 2, 1],
    ])
    p.transition = { ...p.transition, enabled: false }
    expect(rankingTimeline(p).every((t) => t.kind === 'clip')).toBe(true)
  })

  it('fills {rank} in the slide text', () => {
    expect(transitionText({ ...DEFAULT_RANKING_TRANSITION, text: 'Next: #{rank} ' }, 4)).toBe(
      'Next: #4',
    )
  })

  it("shows a slide's own text in place of the template, and puts it back", () => {
    const base = { ...DEFAULT_RANKING_TRANSITION, text: 'Number {rank}…' }
    const own = withSlideText(base, 1, 'And the guiltiest… #{rank}')
    expect(transitionText(own, 1)).toBe('And the guiltiest… #1')
    expect(transitionText(own, 2)).toBe('Number 2…')
    expect(hasOwnSlideText(own, 1)).toBe(true)
    expect(hasOwnSlideText(own, 2)).toBe(false)
    // An empty own text is a blank slide, not the template.
    expect(transitionText(withSlideText(base, 3, ''), 3)).toBe('')
    const back = withSlideText(own, 1, null)
    expect(transitionText(back, 1)).toBe('Number 1…')
    expect(back).not.toHaveProperty('texts')
  })

  it('drops the own texts of slides into ranks that are gone, and changes nothing otherwise', () => {
    const t = { ...DEFAULT_RANKING_TRANSITION, texts: { '2': 'Two', '4': 'Four' } }
    expect(pruneSlideTexts(t, 3).texts).toEqual({ '2': 'Two' })
    expect(pruneSlideTexts(t, 1)).not.toHaveProperty('texts')
    // Nothing to drop: the same object, so callers can tell.
    expect(pruneSlideTexts(t, 4)).toBe(t)
    expect(slideTextOf('  And   the\twinner… ')).toBe('And the winner…')
  })
})

describe('clampSlideTextSize', () => {
  it('keeps a size in range and no bigger than the text can be drawn', () => {
    expect(clampSlideTextSize(0.1)).toBe(0.1)
    expect(clampSlideTextSize(0.5)).toBe(0.2)
    expect(clampSlideTextSize(0.01)).toBe(0.03)
    expect(clampSlideTextSize(0.15, 0.08)).toBe(0.08)
  })

  it('keeps it to 0.001, never rounding up past what fits', () => {
    expect(clampSlideTextSize(0.0619)).toBe(0.062)
    // Fits at 120 px of 1920 (0.0625): 0.063 would be 121 px, too wide, and drawn shrunk.
    expect(clampSlideTextSize(0.07, 120 / 1920)).toBe(0.062)
    expect(clampSlideTextSize(0.07, 96 / 1920)).toBe(0.05)
  })

  it('never goes below the range, even for a text that only fits smaller (it is drawn shrunk)', () => {
    // A long slide text fits only at 48 px of 1920 (0.025): growing or shrinking keeps 0.03.
    expect(clampSlideTextSize(0.05, 0.025)).toBe(0.03)
    expect(clampSlideTextSize(0.02, 0.025)).toBe(0.03)
  })
})

describe('withRankCount', () => {
  it('adds empty ranks at the bottom or drops the last ones, with their stickers', () => {
    const project = newRankingProject('p', 'now')
    project.items[0] = { ...project.items[0]!, label: 'Top' }
    project.stickers = [
      {
        color: '#fff',
        id: 'a',
        kind: 'text',
        rank: 5,
        rotation: 0,
        size: 0.1,
        text: 'x',
        x: 0.5,
        y: 0.5,
      },
      {
        color: '#fff',
        id: 'b',
        kind: 'text',
        rank: null,
        rotation: 0,
        size: 0.1,
        text: 'y',
        x: 0.5,
        y: 0.5,
      },
    ]
    const three = withRankCount(project, 3)
    expect(three.items.map((i) => i.rank)).toEqual([1, 2, 3])
    expect(three.items[0]?.label).toBe('Top')
    expect(three.reveal.order).toEqual([3, 2, 1])
    expect(three.stickers?.map((s) => s.id)).toEqual(['b'])
    const seven = withRankCount(project, 7)
    expect(seven.items.map((i) => i.rank)).toEqual([1, 2, 3, 4, 5, 6, 7])
    expect(new Set(seven.items.map((i) => i.id)).size).toBe(7)
    expect(withRankCount(project, 40).items).toHaveLength(10)
    // The slide into a dropped rank loses its own text; the others keep theirs.
    const slides = withRankCount(
      {
        ...project,
        transition: { ...DEFAULT_RANKING_TRANSITION, texts: { '2': 'Two', '5': 'Five' } },
      },
      3,
    )
    expect(slides.transition?.texts).toEqual({ '2': 'Two' })
    expect(withRankCount(project, 1).items).toHaveLength(2)
  })
})

describe('ranking covers', () => {
  const withClips = (): RankingProject => {
    const base = newRankingProject('p1', '2026-10-21T00:00:00Z')
    return {
      ...base,
      items: base.items.map((item) => ({
        ...item,
        clip: {
          durationSec: 6,
          name: `c${item.rank}`,
          trimEndSec: 5,
          trimStartSec: 1,
          url: `store://ranking/p1/clips/c${item.rank}.mp4`,
        },
        label: `L${item.rank}`,
      })),
    }
  }

  it('shows the rank revealed last (#1 in a countdown), a little into its trim', () => {
    const shot = rankingCoverShot(withClips())
    expect(shot?.item.rank).toBe(1)
    expect(shot?.atSec).toBeCloseTo(1 + 4 * 0.4)
    // #1 without a clip: the last revealed rank that has one.
    const project = withClips()
    const noOne = {
      ...project,
      items: project.items.map((i) => (i.rank === 1 ? { ...i, clip: null } : i)),
    }
    expect(rankingCoverShot(noOne)?.item.rank).toBe(2)
    expect(rankingCoverShot(newRankingProject('p2', '2026-10-21T00:00:00Z'))).toBeNull()
  })

  it('keys what the cover shows: the same for a new name, date, sound or slide, not for a label or trim', () => {
    const project = withClips()
    const key = rankingCoverKey(project)
    expect(rankingCoverKey({ ...project, name: 'Other', updatedAt: '2027-01-01T00:00:00Z' })).toBe(
      key,
    )
    expect(
      rankingCoverKey({ ...project, transition: { ...transitionOf(project), text: 'Next' } }),
    ).toBe(key)
    expect(
      rankingCoverKey({
        ...project,
        items: project.items.map((i) => ({ ...i, cues: [{ atSec: 1, id: 'c', soundId: 's' }] })),
      }),
    ).toBe(key)
    expect(
      rankingCoverKey({
        ...project,
        items: project.items.map((i) => (i.rank === 3 ? { ...i, label: 'New' } : i)),
      }),
    ).not.toBe(key)
    expect(
      rankingCoverKey({
        ...project,
        items: project.items.map((i) =>
          i.rank === 1 && i.clip ? { ...i, clip: { ...i.clip, trimStartSec: 2 } } : i,
        ),
      }),
    ).not.toBe(key)
  })
})
