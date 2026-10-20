import type { RankingProject } from '@shared/types/api/ranking'

import {
  DEFAULT_RANKING_TRANSITION,
  isPermutation,
  newRankingProject,
  rankingProblems,
  rankingSegments,
  rankingTimeline,
  revealOrder,
  transitionText,
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
    p.items = p.items.slice(0, 3).map((item, i) => ({ ...item, clip: clip(10, 1, 1 + 2 + i), label: `L${i + 1}` }))
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
    p.items = [{ ...p.items[0]!, clip: clip(60) }, { ...p.items[1]!, clip: null }]
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
      clip: { durationSec: 5, name: 'c', trimEndSec: 2, trimStartSec: 0, url: 'store://ranking/p/c.mp4' },
    }))
    p.reveal = { mode: 'countdown', order: [3, 2, 1] }
    p.transition = { ...p.transition!, durationSec: 1, enabled: true }
    expect(rankingTimeline(p).map((t) => [t.kind, t.startSec, t.durSec, t.kind === 'transition' ? t.nextRank : t.segment.item.rank])).toEqual([
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
    expect(transitionText({ ...DEFAULT_RANKING_TRANSITION, text: 'Next: #{rank} ' }, 4)).toBe('Next: #4')
  })
})
