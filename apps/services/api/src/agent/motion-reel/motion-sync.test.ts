import type { ReelJson } from '@reelmakeeasy/common/motion-reel/reel-config'

import {
  bigChangeAt,
  distinctCuts,
  endHoldFrom,
  frameChanges,
  frameMoves,
  paceFindings,
  reelEvents,
  shotStarts,
  stallRuns,
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

/** A reel whose picture changes with its music: busy on every kick and every melody note (the sync
 *  check no longer asks for either: both lines are information), a cut into the drop. */
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
  it('passes a reel that cuts into the drop (its melody and kick pulse reported as information)', () => {
    const report = syncReport(reel(), goodReel(), [2])
    expect(report.lines).toEqual([
      'Cuts: 1 cuts: 1 on a beat, none off the grid.',
      'Section starts: every energy change has a cut or a big change.',
      'Melody (information only): 4 of 4 accented notes get a visual event (100%; 38% half a beat off them, by chance). A low share is fine: never answer the notes by bumping or flashing the same element on each; bring in something new on the few that matter.',
      'Kick pulse (information only): 2x the change after a kick as between kicks, 1 grey levels more (the picture pulses with the kick).',
      'Scenes: 8 shots, the longest 2.7 s.',
      'Stalls: none (nothing stands still for 0.5 s before the end card at 6 s).',
      'Sync: passes.',
    ])
    expect(report.passes).toBe(true)
  })

  it('reports a faint kick pulse and a picture busy at random on the melody, failing neither', () => {
    // A tenth of a grey level more on every kick, and a pop on every eighth note.
    const list = changes(1)
    for (let k = 0; k < 240; k += 15) for (let f = k; f < k + 3; f++) list[f] = 1.3
    for (let f = 4; f < 240; f += 8) list[f] = 9
    list[0] = 0
    const report = syncReport(reel(), list, [2])
    expect(report.kickPulseLevels).toBeCloseTo(0.3)
    expect(report.melody.chance).toBeGreaterThanOrEqual(report.melody.hit / report.melody.total)
    expect(report.lines[2]).toMatch(
      /^Melody \(information only\): .*by chance\)\. A low share is fine: never answer the notes by bumping or flashing/,
    )
    expect(report.lines.at(-1)).toBe('Sync: passes.')
    // A low share is no shortcoming: the line never says the picture fails to follow the notes.
    expect(report.lines.join('\n')).not.toMatch(/follow the notes|does not follow/)
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
    // No half-second moves measured: the frame-to-frame change says the frames are still. One
    // hold of at most 1.5 s is let through as the payoff beat.
    expect(report.stalls).toEqual([])
    expect(report.lines).toEqual([
      'Cuts: 1 cuts: 0 on a beat, 1 off the grid (at beats 6.2).',
      'Section starts: 1 without a cut or a big change (drop at beat 4).',
      'Melody (information only): 0 of 4 accented notes get a visual event (0%; 0% half a beat off them, by chance). A low share is fine: never answer the notes by bumping or flashing the same element on each; bring in something new on the few that matter.',
      'Kick pulse (information only): 1x the change after a kick as between kicks, 0 grey levels more (no visible pulse on the kick).',
      'Scenes: 2 shots, the longest 4.9 s; 1 long (over 4 s, information: 3.1 s for 4.9 s (beat 6.2)): one idea is at most 4 s.',
      'Stalls: none (nothing stands still for 0.5 s before the end card at 6 s). One hold let through as the payoff beat (at most 1.5 s, once a reel): 3.33-4.37 s (beats 6.67-8.73).',
      'Sync: 2 to fix: cuts off the grid, section starts.',
    ])
  })

  it('never lists the melody notes or the kick pulse among the fixes (an agent bumped and flashed a card on every note to pass)', () => {
    // No pop on any note and no pulse on any kick, with a cut into the drop: passes, both lines information.
    const quiet = changes(1)
    quiet[0] = 0
    quiet[61] = 30
    const passes = syncReport(reel(), quiet, [2])
    expect(passes.melody.hit).toBe(0)
    expect(passes.lines.at(-1)).toBe('Sync: passes.')
    // Every reel the other tests fail: the fixes never name the melody or the kick.
    for (const report of [
      passes,
      syncReport(reel(), changes(1, [100, 130, 0]), [3.1]),
      syncReport(reel(), changes(1), []),
    ]) {
      const verdict = report.lines.at(-1) ?? ''
      expect(verdict).not.toMatch(/melody|kick|pulse|notes/i)
      expect(
        report.lines
          .filter((l) => /^(Melody|Kick pulse) /.test(l))
          .every((l) => /\(information only\)/.test(l)),
      ).toBe(true)
      expect(report.lines.join('\n')).not.toMatch(/pop something on beats/)
    }
  })

  it('lets the end card hold the last bar', () => {
    const list = goodReel()
    for (let f = 180; f < 240; f++) list[f] = 0
    const report = syncReport(reel(), list, [2])
    expect(report.stalls).toEqual([])
    expect(report.sectionMisses).toEqual([])
  })

  it('checks a reel made before music events with the plain grid', () => {
    const { events: _events, ...old } = reel()
    expect(reelEvents(old as ReelJson).kicks).toEqual(beats)
    expect(syncReport(old as ReelJson, goodReel(), [2]).lines[2]).toBe(
      'Melody (information only): no accented notes in the energetic sections to check.',
    )
  })
})

/** A reel `seconds` long at 120 BPM and 30 fps, no music events to check. */
function longReel(seconds: number): ReelJson {
  const n = seconds * 2
  const grid = Array.from({ length: n }, (_, i) => i * 0.5)
  const { events: _events, ...rest } = reel({
    bars: seconds / 2,
    beats: grid,
    downbeats: grid.filter((_, i) => i % 4 === 0),
    durationInFrames: seconds * 30,
    lengthSec: seconds,
  })
  return rest as ReelJson
}

/** `frames` frames of `base` change, a cut-like spike at each frame in `spikes`. */
const busy = (frames: number, spikes: number[] = [], base = 2) => {
  const list = Array.from({ length: frames }, (_, f) => (f === 0 ? 0 : base))
  for (const f of spikes) list[f] = 60
  return list
}

describe('pace: stalls', () => {
  const W = 96
  const H = 54
  /** Frames drawn by `draw(frame, x, y)`, as one grey buffer. */
  const video = (frames: number, draw: (f: number, x: number, y: number) => number) => {
    const gray = new Uint8Array(frames * W * H)
    for (let f = 0; f < frames; f++)
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++)
          gray[f * W * H + y * W + x] = Math.max(0, Math.min(255, Math.round(draw(f, x, y))))
    return gray
  }

  it("measures how far the picture moved over half a second, not light: a pulse of the ground or a fade isn't movement", () => {
    // The whole ground brightening by 12 levels and back.
    const pulse = frameMoves(
      video(31, (f) => 40 + (f % 15 < 5 ? 12 : 0)),
      W,
      H,
      15,
    )
    expect(pulse.slice(0, 15).every((m) => m === Infinity)).toBe(true)
    expect(Math.max(...pulse.slice(15))).toBe(0)
    // A bright card sliding 2 px a frame across a dark ground.
    const slide = frameMoves(
      video(31, (f, x, y) => (x >= 10 + 2 * f && x < 30 + 2 * f && y > 15 && y < 40 ? 220 : 20)),
      W,
      H,
      15,
    )
    expect(Math.min(...slide.slice(15))).toBeGreaterThan(3)
  })

  it('sees motion that comes back within the half second: a wobble, a bounce on the beat', () => {
    // A card wobbling 6 px either way at 2 Hz: it is back where it was every 15 frames.
    const wobble = frameMoves(
      video(60, (f, x, y) => {
        const left = 30 + 6 * Math.sin((2 * Math.PI * f) / 15)
        return x >= left && x < left + 16 && y > 15 && y < 40 ? 220 : 20
      }),
      W,
      H,
      15,
    )
    expect(Math.min(...wobble.slice(15))).toBeGreaterThanOrEqual(2)
    // A card that jumps 3 px up on each beat and is back two frames later.
    const bounce = frameMoves(
      video(60, (f, x, y) => {
        const top = 15 - (f % 15 < 2 ? 3 : 0)
        return x >= 30 && x < 60 && y > top && y < top + 20 ? 220 : 20
      }),
      W,
      H,
      15,
    )
    expect(Math.min(...bounce.slice(15))).toBeGreaterThanOrEqual(2)
  })

  it('judges how far things move, not how big or bright they are: a big bright card drifting 2% a second goes nowhere', () => {
    const big = frameMoves(
      video(45, (f, x, y) => {
        const left = 10 + (0.02 * W * f) / 30
        return x >= left && x < left + 60 && y > 8 && y < 46 ? 245 : 20
      }),
      W,
      H,
      15,
    )
    expect(Math.max(...big.slice(15))).toBeLessThan(2)
  })

  it('sees a small change of content: a digit ticking in one corner of a still frame', () => {
    // A 3x5 px digit-sized block whose top half toggles every 5 frames, on a busy still frame.
    const ticking = frameMoves(
      video(45, (f, x, y) => {
        if (x >= 80 && x < 83 && y >= 40 && y < 45)
          return y < 42 && Math.floor(f / 5) % 2 ? 20 : 230
        return (x * 7 + y * 13) % 40 < 20 ? 60 : 120
      }),
      W,
      H,
      15,
    )
    expect(Math.min(...ticking.slice(15))).toBeGreaterThanOrEqual(2)
  })

  it('counts a slow 2% drift of a soft glow on a flat ground as going nowhere', () => {
    // A soft glow drifting 2% of the frame width a second (about 1 px in half a second).
    const glow = (f: number, x: number, y: number) =>
      20 + 60 * Math.exp(-((x - 48 - (0.02 * W * f) / 30) ** 2 + (y - 27) ** 2) / (2 * 20 ** 2))
    const moves = frameMoves(video(45, glow), W, H, 15)
    expect(Math.max(...moves.slice(15))).toBeLessThan(2)
  })

  it('a stall is half a second (15 frames at 30 fps) that goes nowhere; less is not', () => {
    const changes = busy(300)
    const moves = changes.map((_, f) => (f < 15 ? Infinity : 3))
    // Frames 100-115 went nowhere: the window ending on frame 115.
    moves[115] = 0.4
    expect(stallRuns(changes, moves, 30, 300)).toEqual([[100, 115]])
    // A longer stretch, ending before the end card's hold.
    for (let f = 200; f <= 240; f++) moves[f] = 0.2
    expect(stallRuns(changes, moves, 30, 300)).toEqual([
      [100, 115],
      [185, 240],
    ])
    expect(stallRuns(changes, moves, 30, 210)).toEqual([
      [100, 115],
      [185, 210],
    ])
    // Without the moves, still frames by their change: 14 frames is not half a second.
    const flat = busy(300)
    for (let f = 50; f < 64; f++) flat[f] = 0.1
    for (let f = 150; f < 165; f++) flat[f] = 0.1
    expect(stallRuns(flat, undefined, 30, 300)).toEqual([[150, 165]])
  })

  it('names each stall by time and beat, and lets the end card hold', () => {
    const r = longReel(20)
    const changes = busy(600)
    const moves = changes.map((_, f) => (f < 15 ? Infinity : 3))
    for (let f = 135; f <= 180; f++) moves[f] = 0.5
    // One short hold, the payoff beat: let through once.
    for (let f = 315; f <= 330; f++) moves[f] = 1
    // The end card (from the cut at 16 s) holds still to the end.
    for (let f = 500; f < 600; f++) moves[f] = 0
    const report = syncReport(r, changes, [3, 6, 9, 12, 16], moves)
    expect(report.stalls).toEqual([{ from: 4, fromBeat: 8, to: 6, toBeat: 12 }])
    expect(report.lines.at(-2)).toBe(
      'Stalls: 1 where nothing visibly moves for 0.5 s or more before the end card at 16 s: 4-6 s (beats 8-12). Keep something moving through each, big enough to see: a camera push, an element sliding or turning, a large counter, the next element coming in (a slow drift of 2% a second, or a glow, does not count). One hold let through as the payoff beat (at most 1.5 s, once a reel): 10-11 s (beats 20-22).',
    )
    expect(report.lines.at(-1)).toBe('Sync: 1 to fix: stalls.')
  })
})

describe('pace: scene length', () => {
  it('starts a shot on each cut and on each big change, a cut and its flash as one', () => {
    // A cut at 2 s with the detector also seeing the next frame, a whip at 5 s, a flash at 5.1 s.
    expect(shotStarts(busy(300, [150, 153]), [2, 2.033], 30)).toEqual([0, 60, 150])
  })

  it('the end card is the last shot when it is in the last fifth (at most 6 s); else the last bar or 1.5 s', () => {
    const r = longReel(30)
    expect(endHoldFrom(r, [0, 30 * 25])).toBe(25)
    expect(endHoldFrom(r, [0, 30 * 20])).toBe(28)
    const fast = { ...r, bpm: 176 }
    expect(endHoldFrom(fast, [0, 30 * 20])).toBe(28.5)
    expect(endHoldFrom(longReel(10), [0, 30 * 5])).toBe(8)
  })

  it('needs no cut for a section that starts inside the end card hold', () => {
    const r = {
      ...longReel(20),
      events: {
        chords: [],
        kicks: [],
        melody: [],
        sections: [
          { endSec: 17, energy: 3, name: 'drop', startSec: 0 },
          { endSec: 20, energy: 1, name: 'stop', startSec: 17 },
        ],
        snares: [],
      },
    } as ReelJson
    // The end card starts on the cut at 16 s; the stop at 17 s (before the last bar at 18 s)
    // falls in its hold.
    const report = syncReport(
      r,
      busy(600),
      [4, 8, 12, 16],
      busy(600).map(() => 5),
    )
    expect(report.sectionMisses).toEqual([])
    // Without the end card's cut the hold starts at the last bar, and the stop needs marking.
    const early = syncReport(
      r,
      busy(600),
      [4, 8, 12],
      busy(600).map(() => 5),
    )
    expect(early.sectionMisses).toEqual([{ beat: 34, name: 'stop' }])
  })

  it('fails a shot over 8 s, and reports one over 4 s as long', () => {
    const r = longReel(20)
    // Shots: 0-3 s, 3-12 s (9 s), 12-17 s (5 s), 17-20 s.
    const report = syncReport(
      r,
      busy(600),
      [3, 12, 17],
      busy(600).map(() => 5),
    )
    expect(paceFindings(r, busy(600), [3, 12, 17]).shots.map((s) => s.length)).toEqual([3, 9, 5, 3])
    expect(report.lines.at(-3)).toBe(
      'Scenes: 4 shots, the longest 9 s; 1 too long (over 8 s: 3 s for 9 s (beat 6)): split each into different shots of at most 4 s; 1 long (over 4 s, information: 12 s for 5 s (beat 24)): one idea is at most 4 s.',
    )
    expect(report.lines.at(-1)).toBe('Sync: 1 to fix: scenes over 8 s.')
  })
})
