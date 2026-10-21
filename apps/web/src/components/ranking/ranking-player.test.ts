import { rankingTimeline } from '@reelmakeeasy/common/ranking/ranking-project'
import type { RankingItem, RankingProject } from '@shared/types/api/ranking'

import {
  activeCues,
  cueWindows,
  formatTime,
  jumpTarget,
  partIndexAt,
  rankStarts,
} from './ranking-player'

const clip = (sec: number) => ({
  durationSec: sec,
  fileName: 'c.mp4',
  trimEndSec: sec,
  trimStartSec: 0,
  url: 'u',
})
const item = (
  rank: number,
  sec: number,
  cues: { atSec: number; soundId: string }[] = [],
): RankingItem =>
  ({
    clip: clip(sec),
    cues: cues.map((c, i) => ({ ...c, id: `c${rank}-${i}` })),
    id: `i${rank}`,
    label: `L${rank}`,
    rank,
  }) as unknown as RankingItem

function project(over: Partial<RankingProject> = {}): RankingProject {
  return {
    createdAt: '',
    id: 'p',
    items: [
      item(1, 4, [{ atSec: 1, soundId: 'boom' }]),
      item(2, 3),
      item(3, 2, [{ atSec: 1.5, soundId: 'long' }]),
    ],
    name: 'x',
    reveal: { mode: 'countdown', order: [3, 2, 1] },
    sounds: { music: null, musicVolume: 0.3, reveal: 'ding' },
    title: { lines: [] },
    transition: {
      background: '#000',
      durationSec: 0.5,
      enabled: false,
      sound: 'swoosh',
      text: '',
      textColor: '#fff',
    },
    updatedAt: '',
    ...over,
  } as unknown as RankingProject
}

const lengths: Record<string, number> = { boom: 1, ding: 0.4, long: 5, swoosh: 2 }
const lengthOf = (id: string) => lengths[id] ?? null

describe('ranking player', () => {
  it('finds the part on screen at any moment', () => {
    const parts = rankingTimeline(project()) // #3 0-2, #2 2-5, #1 5-9
    expect([0, 1.99, 2, 4.5, 5, 8.9, 20, -1].map((t) => partIndexAt(parts, t))).toEqual([
      0, 0, 1, 1, 2, 2, 2, 0,
    ])
  })

  it('cuts every sound at the end of its part, like the export', () => {
    const p = project()
    const windows = cueWindows(p, rankingTimeline(p), lengthOf)
    // The 5 s sound on #3 (1.5 s into a 2 s clip) stops when #3 ends, at 2 s.
    expect(windows.find((w) => w.soundId === 'long')).toMatchObject({ endSec: 2, startSec: 1.5 })
    // Each clip's reveal sound at its start; #1's boom 1 s in.
    expect(windows.filter((w) => w.soundId === 'ding').map((w) => w.startSec)).toEqual([0, 2, 5])
    expect(windows.find((w) => w.soundId === 'boom')).toMatchObject({ endSec: 7, startSec: 6 })
  })

  it('stops rank 4 style bleed: nothing from a rank plays once the next one is on', () => {
    const p = project()
    const windows = cueWindows(p, rankingTimeline(p), lengthOf)
    expect(activeCues(windows, 1.9).map((c) => c.soundId)).toEqual(['long'])
    expect(activeCues(windows, 2.1).map((c) => c.soundId)).toEqual(['ding'])
    // Jumping into the middle of a sound starts it that far in.
    expect(activeCues(windows, 6.25)).toEqual([
      expect.objectContaining({ offsetSec: 0.25, soundId: 'boom' }),
    ])
  })

  it('plays a transition sound only during the slide, and drops cues past a clip', () => {
    const p = project({
      items: [item(1, 4), item(2, 3, [{ atSec: 9, soundId: 'boom' }])],
    } as Partial<RankingProject>)
    p.reveal.order = [2, 1]
    if (p.transition) p.transition.enabled = true
    const parts = rankingTimeline(p) // #2 0-3, slide 3-3.5, #1 3.5-7.5
    const windows = cueWindows(p, parts, lengthOf)
    expect(windows.find((w) => w.soundId === 'swoosh')).toMatchObject({ endSec: 3.5, startSec: 3 })
    expect(windows.some((w) => w.soundId === 'boom')).toBe(false)
    expect(rankStarts(parts)).toEqual([
      { rank: 2, startSec: 0 },
      { rank: 1, startSec: 3.5 },
    ])
  })

  it('keys each sound by what plays and when, so a changed sound restarts', () => {
    const p = project()
    const before = cueWindows(p, rankingTimeline(p), lengthOf).find((w) => w.soundId === 'boom')
    const swapped = project({
      items: [
        item(1, 4, [{ atSec: 1, soundId: 'ding' }]),
        item(2, 3),
        item(3, 2, [{ atSec: 1.5, soundId: 'long' }]),
      ],
    } as Partial<RankingProject>)
    const after = cueWindows(swapped, rankingTimeline(swapped), lengthOf).find(
      (w) => w.startSec === 6 && w.key.includes(':cue'),
    )
    expect(after?.soundId).toBe('ding')
    expect(after?.key).not.toBe(before?.key)
  })

  it('jumps rank to rank', () => {
    const parts = rankingTimeline(project()) // starts 0, 2, 5
    expect(jumpTarget(parts, 0, 1)).toBe(2)
    expect(jumpTarget(parts, 2.5, 1)).toBe(5)
    expect(jumpTarget(parts, 6, 1)).toBeNull()
    expect(jumpTarget(parts, 6, -1)).toBe(5) // well into #1: back to its start
    expect(jumpTarget(parts, 5.2, -1)).toBe(2) // right at #1's start: the rank before
    expect(jumpTarget(parts, 0.3, -1)).toBe(0)
  })

  it('formats the time', () => {
    expect(formatTime(7.34)).toBe('0:07.3')
    expect(formatTime(65)).toBe('1:05.0')
    expect(formatTime(9.96)).toBe('0:10.0')
    expect(formatTime(59.97)).toBe('1:00.0')
  })
})
