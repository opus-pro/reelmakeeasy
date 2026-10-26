import type { ReelJson } from '@reelmakeeasy/common/motion-reel/reel-config'

import {
  bigChangeAt,
  distinctCuts,
  frameChanges,
  reelEvents,
  syncReport,
  visualEvents,
} from './motion-sync'

// 4 bars at 120 BPM and 30 fps: a beat every 15 frames, 240 frames.
const beats = Array.from({ length: 16 }, (_, i) => i * 0.5)
const reel = (over: Partial<ReelJson> = {}): ReelJson => ({
  bars: 4,
  beats,
  beatsPerBar: 4,
  bpm: 120,
  downbeats: [0, 2, 4, 6],
  durationInFrames: 240,
  events: {
    chords: [0, 2, 4, 6],
    kicks: beats,
    melody: [
      { strength: 1, t: 0.5 },
      { strength: 1, t: 2.5 },
      { strength: 0.6, t: 2.75 },
      { strength: 1, t: 3.5 },
      { strength: 1, t: 4.5 },
      { strength: 0.8, t: 5.25 },
    ],
    sections: [
      { endSec: 2, energy: 1, name: 'intro', startSec: 0 },
      { endSec: 6, energy: 3, name: 'drop', startSec: 2 },
      { endSec: 8, energy: 1, name: 'outro', startSec: 6 },
    ],
    snares: [],
  },
  fadeOutSec: 0,
  fps: 30,
  height: 1080,
  lengthSec: 8,
  music: 'music.wav',
  ratio: '16:9',
  strongHits: [],
  subject: 'x',
  width: 1920,
  ...over,
})

/** A per-frame change list: `base` everywhere, then each edit applied. */
const changes = (base: number, ...edits: [from: number, to: number, value: number][]) => {
  const list = Array.from({ length: 240 }, (_, f) => (f === 0 ? 0 : base))
  for (const [from, to, value] of edits) for (let f = from; f <= to; f++) list[f] = value
  return list
}

/** A reel that moves with its music: pulses on every kick, pops on each melody note, a cut into
 *  the drop. */
function goodReel(): number[] {
  const list = changes(1)
  for (let k = 0; k < 240; k += 15) for (let f = k; f < k + 3; f++) list[f] = 2
  for (const t of [0.5, 2.5, 2.75, 3.5, 4.5, 5.25]) list[Math.round(t * 30) + 1] = 9
  list[0] = 0
  return list
}

describe('frameChanges', () => {
  it('is the mean grey-level difference from the frame before', () => {
    const gray = Uint8Array.from([0, 0, 0, 0, 10, 20, 30, 40, 10, 20, 30, 40])
    expect(frameChanges(gray, 4)).toEqual([0, 25, 0])
  })
})

describe('distinctCuts', () => {
  it('keeps one cut per shot change', () => {
    expect(distinctCuts([2.033, 2, 6.533, 6.567, 7.5], 30)).toEqual([2, 6.533, 7.5])
  })
})

describe('visual events and big changes', () => {
  it('finds clear peaks above the local median, not noise', () => {
    expect(visualEvents(changes(1, [40, 40, 6], [80, 80, 1.2]), 30)).toEqual([40])
  })

  it('sees a spike, or a busy picture stopping dead, as a big change', () => {
    expect(bigChangeAt(changes(1, [60, 60, 20]), 61, 30)).toBe(true)
    expect(bigChangeAt(changes(30, [60, 239, 2]), 60, 30)).toBe(true)
    expect(bigChangeAt(changes(1), 60, 30)).toBe(false)
  })
})

describe('syncReport', () => {
  it('passes a reel that pulses on the kick, pops on the melody and cuts into the drop', () => {
    const report = syncReport(reel(), goodReel(), [2])
    expect(report.lines).toEqual([
      'Cuts: 1 cuts: 1 on a beat, none off the grid.',
      'Section starts: every energy change has a cut or a big change.',
      'Melody: 4 of 4 accented notes get a visual event (100%; 38% half a beat off them, by chance).',
      'Kick pulse: 2x the change after a kick as between kicks, 1 grey levels more (the picture pulses with the kick).',
      'Stills: none longer than a beat.',
      'Sync: passes.',
    ])
    expect(report.passes).toBe(true)
  })

  it('fails a pulse too faint to see, and a picture busy at random as answering the melody', () => {
    // A tenth of a grey level more on every kick, and a pop on every eighth note.
    const list = changes(1)
    for (let k = 0; k < 240; k += 15) for (let f = k; f < k + 3; f++) list[f] = 1.3
    for (let f = 4; f < 240; f += 8) list[f] = 9
    list[0] = 0
    const report = syncReport(reel(), list, [2])
    expect(report.kickPulseLevels).toBeCloseTo(0.3)
    expect(report.melody.chance).toBeGreaterThanOrEqual(report.melody.hit / report.melody.total)
    expect(report.lines.at(-1)).toBe('Sync: 2 to fix: melody notes, kick pulse.')
  })

  it('wants a shot change every three bars, and only suggests marking a same-energy part', () => {
    const long = reel({
      bars: 8,
      events: {
        ...reel().events,
        sections: [
          { endSec: 2, energy: 1, name: 'intro', startSec: 0 },
          { endSec: 4, energy: 3, name: 'drop', startSec: 2 },
          { endSec: 8, energy: 3, name: 'groove', startSec: 4 },
        ],
      },
    })
    const report = syncReport(long, goodReel(), [2])
    expect(report.changes).toEqual({ count: 1, needed: 2 })
    expect(report.sectionMisses).toEqual([])
    expect(report.sectionSoftMisses).toEqual([{ beat: 8, name: 'groove' }])
    expect(report.lines[0]).toBe(
      'Cuts: 1 cuts: 1 on a beat, none off the grid. Only 1 shot change in 8 bars: it needs at least 2 shot changes (cuts on beats or downbeats, or a big change on a section start).',
    )
    expect(report.lines.at(-1)).toBe('Sync: 1 to fix: too few cuts.')
  })

  it('names every miss by its beat', () => {
    // Flat motion with a still stretch, no pops, no cut into the drop, one cut off the grid.
    const report = syncReport(reel(), changes(1, [100, 130, 0]), [3.1])
    expect(report.passes).toBe(false)
    expect(report.sectionMisses).toEqual([{ beat: 4, name: 'drop' }])
    expect(report.melody).toEqual({ chance: 0, hit: 0, missedBeats: [5, 7, 9, 10.5], total: 4 })
    expect(report.kickPulse).toBe(1)
    expect(report.stills).toEqual([{ fromBeat: 6.67, toBeat: 8.73 }])
    expect(report.lines).toEqual([
      'Cuts: 1 cuts: 0 on a beat, 1 off the grid (at beats 6.2).',
      'Section starts: 1 without a cut or a big change (drop at beat 4).',
      "Melody: 0 of 4 accented notes get a visual event (0%; 0% half a beat off them, by chance): the picture doesn't answer the melody; pop something on beats 5, 7, 9, 10.5.",
      'Kick pulse: 1x the change after a kick as between kicks, 0 grey levels more (under 1.15x: the background does not pulse on the kick).',
      'Stills: 1 longer than a beat (beats 6.67-8.73).',
      'Sync: 5 to fix: cuts off the grid, section starts, melody notes, kick pulse, stills.',
    ])
  })

  it('lets the end card hold the last bar', () => {
    const list = goodReel()
    for (let f = 180; f < 240; f++) list[f] = 0
    const report = syncReport(reel(), list, [2])
    expect(report.stills).toEqual([])
    expect(report.sectionMisses).toEqual([])
  })

  it('checks a reel made before music events with the plain grid', () => {
    const { events: _events, ...old } = reel()
    expect(reelEvents(old as ReelJson).kicks).toEqual(beats)
    expect(syncReport(old as ReelJson, goodReel(), [2]).lines[2]).toBe(
      'Melody: no accented notes in the energetic sections to check.',
    )
  })
})
