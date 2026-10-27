import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { ReelJson } from '@reelmakeeasy/common/motion-reel/reel-config'

import {
  frameSize,
  paceReport,
  parseReviewArgs,
  REVIEW_SHEET_WIDTH,
  reviewBlocker,
  reviewTimes,
  sheetLayout,
} from './motion-review'
import { MotionSetupError } from './motion-setup'
import { paceFindings } from './motion-sync'

describe('motion_review: the contact sheets', () => {
  it('lays a 30 s reel out at a frame every half second as 3 sheets of 8-frame rows (4 s a row)', () => {
    const sheets = sheetLayout({ every: 0.5, from: 0, to: 30 })
    expect(sheets.map((s) => s.rows.length)).toEqual([3, 3, 2])
    expect(sheets.map((s) => s.frames)).toEqual([24, 24, 12])
    expect(sheets.map((s) => s.rows.map((r) => r.start))).toEqual([
      [0, 4, 8],
      [12, 16, 20],
      [24, 28],
    ])
  })

  it('at a frame a second, 2 sheets of 2 rows; a part of the reel, only that part', () => {
    expect(sheetLayout({ every: 1, from: 0, to: 30 }).map((s) => s.rows.length)).toEqual([2, 2])
    const part = sheetLayout({ every: 0.5, from: 10, to: 15 })
    expect(part).toEqual([
      {
        frames: 10,
        rows: [
          { frames: 8, start: 10 },
          { frames: 2, start: 14 },
        ],
        start: 10,
      },
    ])
    expect(reviewTimes({ every: 0.5, from: 10, to: 15 }).at(-1)).toBe(14.5)
  })

  it('keeps a sheet at most 1600 px wide, in the reel’s shape', () => {
    expect(frameSize(1920, 1080)).toEqual({ height: 110, width: 196 })
    expect(frameSize(1080, 1920)).toEqual({ height: 348, width: 196 })
    expect(8 * 196 + 7 * 4).toBeLessThanOrEqual(REVIEW_SHEET_WIDTH)
  })

  it('takes every as 0.5 or 1, and from and to inside the reel', () => {
    expect(parseReviewArgs({}, 30)).toEqual({ every: 0.5, from: 0, to: 30 })
    expect(parseReviewArgs({ every: 1, from: 4, to: 99 }, 30)).toEqual({
      every: 1,
      from: 4,
      to: 30,
    })
    expect(() => parseReviewArgs({ every: 2 }, 30)).toThrow(MotionSetupError)
    expect(() => parseReviewArgs({ from: 20, to: 10 }, 30)).toThrow(/from must come before to/)
    expect(() => parseReviewArgs({ from: -1 }, 30)).toThrow(MotionSetupError)
  })
})

describe('motion_review: the pace report', () => {
  const reel = {
    beats: Array.from({ length: 60 }, (_, i) => i * 0.5),
    beatsPerBar: 4,
    bpm: 120,
    fps: 30,
    lengthSec: 30,
  } as unknown as ReelJson

  it('lists every shot with its length, the long and too long ones, every stall and a verdict', () => {
    const changes = Array.from({ length: 900 }, (_, f) => (f ? 2 : 0))
    const moves = changes.map((_, f) => (f < 15 ? Infinity : 3))
    for (let f = 120; f <= 170; f++) moves[f] = 0.3
    // The end card, from the cut at 26 s, holds.
    for (let f = 790; f < 900; f++) moves[f] = 0
    const pace = paceFindings(reel, changes, [3, 12, 17, 20, 23, 26], moves)
    expect(paceReport(pace)).toEqual([
      'Shots (from the cuts and big changes; one idea is at most 4 s, a shot over 8 s fails):',
      '- 0 s (beat 0): 3 s',
      '- 3 s (beat 6): 9 s TOO LONG (over 8 s)',
      '- 12 s (beat 24): 5 s long (over 4 s)',
      '- 17 s (beat 34): 3 s',
      '- 20 s (beat 40): 3 s',
      '- 23 s (beat 46): 3 s',
      '- 26 s (beat 52): 4 s',
      'Scenes: 7 shots, the longest 9 s; 1 too long (over 8 s: 3 s for 9 s (beat 6)): split each into different shots of at most 4 s; 1 long (over 4 s, information: 12 s for 5 s (beat 24)): one idea is at most 4 s.',
      'Stalls: 1 where nothing visibly moves for 0.5 s or more before the end card at 26 s: 3.5-5.67 s (beats 7-11.33). Keep something moving through each, big enough to see: a camera push, an element sliding or turning, a large counter, the next element coming in (a slow drift of 2% a second, or a glow, does not count).',
      'Repeated pulsing/flashing: none (no element bumps or flashes at the beat or note rate for over 2 s).',
      'Pace: 1 shot over 8 s and 1 stall to fix (1 shot over 4 s to consider splitting).',
    ])
  })

  it('says so when the pace is right', () => {
    const changes = Array.from({ length: 900 }, (_, f) => (f ? 2 : 0))
    const pace = paceFindings(
      reel,
      changes,
      [3, 6, 9, 12, 15, 18, 21, 24, 27],
      changes.map(() => 3),
    )
    expect(paceReport(pace).at(-1)).toBe(
      'Pace: no stalls, no shot over 8 s and no repeated pulsing/flashing.',
    )
  })

  /** A busy picture (change 2 a frame) with a cut every 3 s, and `bump` peaks on the frames given. */
  const busyWith = (peaks: [number, number][]) => {
    const changes = Array.from({ length: 900 }, (_, f): number => (f ? 2 : 0))
    for (const [f, value] of peaks) changes[f] = value
    return paceFindings(
      reel,
      changes,
      [3, 6, 9, 12, 15, 18, 21, 24, 27],
      changes.map(() => 3),
    )
  }

  it('flags repeated pulsing/flashing: the same bump on every note for over 2 s (the rejected card)', () => {
    // A bump and flash of the same size about every half beat, from 3.5 s to 8.5 s (a cut at 6 s
    // in between is not a bump): the melody(0.8) pulse an agent put on its main card.
    const notes = [3.5, 3.75, 4, 4.5, 4.75, 5, 5.5, 5.75, 6.5, 6.75, 7, 7.5, 7.75, 8, 8.5]
    const pace = busyWith(notes.map((t) => [Math.round(t * 30), 12]))
    expect(pace.pulsing).toEqual([
      { count: 15, every: 0.27, from: 3.5, fromBeat: 7, to: 8.5, toBeat: 17 },
    ])
    const report = paceReport(pace)
    expect(report.at(-2)).toMatch(
      /^Repeated pulsing\/flashing: 1 stretch where the picture bumps or flashes alike at the beat or note rate for over 2 s: 3\.5-8\.5 s \(beats 7-17, 15 times, every 0\.27 s\)\. Check the sheets: if it is the same element scaling, shaking or flashing on every beat, kick or note, take that out and answer the music with new things/,
    )
    expect(report.at(-1)).toBe('Pace: 1 stretch of repeated pulsing/flashing to fix.')
  })

  it('flags the per-note bump while other elements move too (peaks of other sizes in between)', () => {
    // The same bump on every note, two of them on a frame where another element also lands
    // (a bigger change), and arrivals of their own between the notes: the run goes on.
    const notes = [3.5, 3.75, 4, 4.5, 4.75, 5, 5.5, 5.75, 6.5, 6.75, 7, 7.5, 7.75, 8, 8.5]
    const peaks: [number, number][] = notes.map((t, i) => [
      Math.round(t * 30),
      i === 3 || i === 9 ? 22 : 12,
    ])
    peaks.push([Math.round(4.25 * 30) + 1, 35], [Math.round(7.25 * 30) + 1, 5])
    const pace = busyWith(peaks)
    expect(pace.pulsing).toHaveLength(1)
    expect(pace.pulsing[0]).toMatchObject({ from: 3.5, to: 8.5 })
    expect(pace.pulsing[0]?.count).toBeGreaterThanOrEqual(13)
  })

  it('does not flag new elements arriving, a few accents, or a bump only every 2 beats', () => {
    // Elements of different sizes arriving on the beat: changes of other sizes, not the same bump.
    const sizes = [8, 30, 11, 45, 9, 26]
    const arrivals = busyWith(
      [4, 4.5, 5, 5.5, 6.5, 7].map((t, i) => [Math.round(t * 30) + 1, sizes[i] as number]),
    )
    expect(arrivals.pulsing).toEqual([])
    // Three accents (the drop, a reveal, the payoff).
    expect(
      busyWith([
        [130, 12],
        [400, 12],
        [700, 12],
      ]).pulsing,
    ).toEqual([])
    // The same bump every 2 beats (1 s): slower than the beat.
    const slow = busyWith([4, 5, 7, 8, 10, 11, 13].map((t) => [Math.round(t * 30) + 4, 12]))
    expect(slow.pulsing).toEqual([])
  })
})

describe('motion_review: before a render', () => {
  const project = () => {
    const dir = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'motion-review-')), 'reel')
    fs.mkdirSync(path.join(dir, 'src', 'scenes'), { recursive: true })
    fs.mkdirSync(path.join(dir, 'public'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'src', 'scenes', 'A.tsx'), 'x')
    fs.writeFileSync(path.join(dir, 'public', 'reel.json'), '{}')
    return dir
  }
  const age = (file: string, ms: number) => {
    const at = new Date(Date.now() - ms)
    fs.utimesSync(file, at, at)
  }

  it('asks for a render first, and again when a scene changed after it', () => {
    const dir = project()
    expect(reviewBlocker(dir)).toMatch(/^Nothing to review yet: render the reel with motion_render/)
    fs.mkdirSync(path.join(dir, 'out'))
    const video = path.join(dir, 'out', 'reel.mp4')
    fs.writeFileSync(video, 'mp4')
    age(path.join(dir, 'src', 'scenes', 'A.tsx'), 60_000)
    age(path.join(dir, 'public', 'reel.json'), 60_000)
    expect(reviewBlocker(dir)).toBeNull()
    age(video, 120_000)
    expect(reviewBlocker(dir)).toBe(
      'src/scenes/A.tsx changed after the last render: render again with motion_render, then review that render.',
    )
  })
})
