import fs from 'node:fs'
import path from 'node:path'

import type { MusicEvents } from '@reelmakeeasy/common/motion-reel/beat-grid'
import type { ReelJson } from '@reelmakeeasy/common/motion-reel/reel-config'

import { run } from './motion-runtime'

/**
 * The sync check: after a render, how the picture moves with the music. Each frame's visual change
 * (the mean grey-level difference from the frame before, on a small grey copy of the reel) is set
 * against the reel's music events: do the section starts get a cut or a big change, do the accented
 * melody notes make something happen, does it ever stall (half a second in which the picture goes
 * nowhere) and does any shot run too long. Whether the picture pulses on the kick is reported but
 * never required. Pure functions over the change lists; only `measureMotion` (and
 * `measureChanges`, which calls it) runs FFmpeg.
 */

/** The small grey copy the change is measured on: enough to see a shape move, cheap to decode. */
export const SYNC_FRAME_WIDTH = 96
export const SYNC_FRAME_HEIGHT = 54

/**
 * Pass marks, set a little under what two reference films score (a 15 s showreel and a 30 s launch
 * film, both at 120 BPM, measured at 30 fps against their own audio's grid and music events): 8 and
 * 11 shot changes (2 and 5 needed), cuts on the grid 100% and 91%, accented melody notes answered
 * 25% and 24% (0% and 21% when the same notes are moved half a beat: the chance level), kick pulse
 * 1.42x and 1.45x (1.8 and 0.56 grey levels over the change between kicks), every section start
 * where the energy changes marked, and no stills. Reels that only drift fail. A reel that moves
 * with its music like the films do passes. The kick pulse marks only label the report's
 * information line (a pulse on every kick in every reel reads as repetitive, so it isn't required).
 */
export const SYNC_THRESHOLDS = {
  /** Shot changes (cuts, or a big change on a section start) needed: one per this many bars. */
  barsPerChange: 3,
  /** Share of the cuts that sit on a beat or half beat. */
  cutsOnGrid: 0.8,
  /** Median change just after a kick over the median change between kicks... */
  kickPulse: 1.15,
  /** ...and at least this many grey levels (0-255) more, so a pulse nobody can see doesn't count. */
  kickPulseLevels: 0.4,
  /** Share of the accented melody notes (in the energetic sections) that get a visual event; it
   *  must also beat the share the same notes get half a beat off (what any busy picture scores). */
  melodyHit: 0.2,
}

/** An event lands on a note, cut or section start within this many frames either side. */
const TOLERANCE_FRAMES = 2
/** A visual event is a local peak at least this many times the local median change... */
const PEAK_RATIO = 2
/** ...and at least this many grey levels (0-255) above it (a one-level flicker is not an event). */
const PEAK_FLOOR = 1
/** A big change (a section start without a cut) is this many times the median change of the half
 *  second before it... */
const BIG_RATIO = 3
/** ...and at least this many grey levels (a new picture, not a slight shift of the ground). */
const BIG_FLOOR = 8
/** With only the frame-to-frame change to go on (no `moves`), a frame changing less than this
 *  (grey levels) is still. */
const STILL_LEVEL = 0.15

/** Half a second in which the picture goes nowhere is a stall (the end card's hold aside). */
export const STALL_SEC = 0.5
/** A shot (between cuts or big changes) over this is long (information)... */
export const LONG_SHOT_SEC = 4
/** ...and over this, too long: it fails (an idea that needs this long is two shots). */
export const MAX_SHOT_SEC = 8
/** The end card may hold: the last shot, when it starts this close to the end (and in the
 *  reel's last fifth)... */
export const END_CARD_MAX_SEC = 6
const END_CARD_SHARE = 0.2
/** ...else only the last bar or the last 1.5 s, whichever is longer. */
const END_HOLD_MIN_SEC = 1.5
/** A pixel's first this many grey levels of change are left out (grain, compression). */
const MOVE_NOISE = 2
/** The picture is cut into this grid of cells; a cell that does something is enough (a counter,
 *  a word typing in), so a small visible change is not diluted by a still frame around it. */
const MOVE_CELLS_X = 8
const MOVE_CELLS_Y = 6
/** A cell whose change, once explained by a move of some pixels, leaves less than this (grey
 *  levels, the mean over the cell) is explained by that move. */
const MOVE_RESIDUE = 1.5
/** The largest move (pixels on the small grey copy) tried; a change no move this small explains
 *  is a change of content (a new element, a word, a digit, a fast move) and scores above it. */
const MOVE_RADIUS = 2
/** Frames compared inside each half second: every frame with the next (a pop on the beat), and
 *  frames this many apart (a wobble or a bounce that comes back within the half second). */
const MOVE_STEP = 5
/** A half second in which every cell moved less than this many pixels on the small grey copy (a
 *  move of 1 px there, 20 px of a 1920 px frame: a drift of 2% of the width a second) went
 *  nowhere. Calibrated on the owner's in-app reel of 2026-10-26, which he found stopping all the
 *  time (rows of scores sitting after they land under a slowly drifting glow, a caption block
 *  waiting for its last word: stalls), and the reference he gave (word-by-word captions, a ring
 *  ripple, a badge popping in: moving). Size and contrast do not count: a big bright card
 *  drifting slowly goes nowhere as much as a small dim one. */
const MOVE_STILL = 2
/** One hold mid-reel of at most this long is the payoff beat (the reference holds its dial on
 *  99 for 1.2 s after it lands): reported, not failed. Any other stall fails. */
export const PAYOFF_HOLD_SEC = 1.5
/** Starts of shots closer than this (seconds) are one transition (a cut and its flash). */
const SHOT_MERGE_SEC = 0.25
/** Melody notes at least this strong are the accented ones the picture must answer. */
const ACCENT = 0.8
/** At most this many missed beats are listed per check. */
const LIST_MAX = 8

/** What the sync check found: its numbers, and one line per check plus the verdict. */
export type SyncReport = {
  /** Shot changes (distinct cuts, and section starts marked by a big change), and how many the
   *  reel's length needs. */
  changes: { count: number; needed: number }
  /** Share of the inside cuts on a beat or half beat (1 with no cuts). */
  cutsOnGrid: number
  /** Median change after kicks over the median change between them (null with no kicks), and
   *  their difference in grey levels. */
  kickPulse: null | number
  kickPulseLevels: number
  /** The report the agent reads: one line per check, then the verdict. */
  lines: string[]
  /** Accented melody notes in energetic sections, how many got a visual event, and the share they
   *  would get half a beat off (chance). */
  melody: { chance: number; hit: number; missedBeats: number[]; total: number }
  passes: boolean
  /** Section starts (after 0) where the energy changes, without a cut or a big change, by beat. */
  sectionMisses: { beat: number; name: string }[]
  /** Section starts at the same energy (a new part) without one: worth marking, not required. */
  sectionSoftMisses: { beat: number; name: string }[]
  /** Shots (between cuts and big changes), each with its start (seconds and beat) and length. */
  shots: Shot[]
  /** Stalls: half a second or more in which the picture goes nowhere, before the end card's
   *  hold (seconds and beats). */
  stalls: Stall[]
}

/** A shot: where it starts (seconds, beat) and how long it runs (seconds). */
export type Shot = { from: number; fromBeat: number; length: number }

/** A stall: from and to, in seconds and beats. */
export type Stall = { from: number; fromBeat: number; to: number; toBeat: number }

/** What the pace checks found: the shots, the stalls, the one payoff hold let through (the
 *  longest stall of at most PAYOFF_HOLD_SEC, not among the stalls) and where the end card may
 *  start to hold. */
export type PaceFindings = {
  endHoldFrom: number
  hold: null | Stall
  shots: Shot[]
  stalls: Stall[]
}

/** The reel facts the pace checks read. */
export type PaceReel = Pick<ReelJson, 'beats' | 'beatsPerBar' | 'bpm' | 'fps' | 'lengthSec'>

/**
 * Each frame's visual change from the frame before: the mean absolute grey-level difference over a
 * frame of `frameSize` bytes. Frame 0 has no frame before it and changes by 0.
 */
export function frameChanges(gray: Uint8Array, frameSize: number): number[] {
  const frames = Math.floor(gray.length / frameSize)
  const changes = Array.from({ length: frames }, () => 0)
  for (let f = 1; f < frames; f++) {
    let sum = 0
    const at = f * frameSize
    for (let i = 0; i < frameSize; i++)
      sum += Math.abs((gray[at + i] as number) - (gray[at - frameSize + i] as number))
    changes[f] = sum / frameSize
  }
  return changes
}

/**
 * How far the picture moved in the `window` frames up to each frame, in pixels of the small grey
 * copy: the most any cell of the picture moved between any two of the frames compared in that
 * window (each frame and the next; frames MOVE_STEP, 2 and 3 steps apart). Between two frames, a
 * cell moved by the smallest shift (0 to MOVE_RADIUS px) that explains its change, once the cell's
 * own shift in brightness is taken out (a fade, a glow or a pulse of the ground is light, not
 * movement); a change no such shift explains (new content, a fast move) scores MOVE_RADIUS + 1
 * and more. Frames before the first full window read as moving (Infinity).
 */
export function frameMoves(
  gray: Uint8Array,
  width: number,
  height: number,
  window: number,
): number[] {
  const size = width * height
  const frames = Math.floor(gray.length / size)
  const step = Math.max(1, Math.min(MOVE_STEP, Math.floor(window / 3)))
  const lags = [...new Set([1, 2 * step, 3 * step, step])].filter((l) => l <= window)
  const envelopes = new Map<number, Envelope[]>()
  const envelope = (f: number) => {
    let e = envelopes.get(f)
    if (!e) {
      e = frameEnvelopes(gray.subarray(f * size, (f + 1) * size), width, height)
      envelopes.set(f, e)
      envelopes.delete(f - window - 1)
    }
    return e
  }
  const cells = cellIndex(width, height)
  const pair: Record<number, number[]> = {}
  for (const lag of lags) pair[lag] = Array.from({ length: frames }, () => Infinity)
  for (let f = 1; f < frames; f++)
    for (const lag of lags)
      if (f - lag >= 0)
        (pair[lag] as number[])[f] = pairMove(
          gray,
          size,
          cells,
          envelope(f - lag),
          envelope(f),
          f - lag,
          f,
        )
  const moves = Array.from({ length: frames }, () => Infinity)
  for (let f = window; f < frames; f++) {
    let most = 0
    for (const lag of lags)
      for (let end = f; end - lag >= f - window; end -= lag === 1 ? 1 : step)
        most = Math.max(most, (pair[lag] as number[])[end] as number)
    moves[f] = most
  }
  return moves
}

/** A frame's grey levels, and their minimum and maximum within 1..MOVE_RADIUS px of each pixel. */
type Envelope = { max: Float32Array; min: Float32Array }

function frameEnvelopes(frame: Uint8Array, width: number, height: number): Envelope[] {
  const plain = Float32Array.from(frame)
  const out: Envelope[] = [{ max: plain, min: plain }]
  for (let r = 1; r <= MOVE_RADIUS; r++)
    out.push({
      max: spread(frame, width, height, r, Math.max),
      min: spread(frame, width, height, r, Math.min),
    })
  return out
}

/** The max (or min) of each pixel's square neighbourhood of radius `r`. */
function spread(
  frame: Uint8Array,
  width: number,
  height: number,
  r: number,
  pick: (a: number, b: number) => number,
): Float32Array {
  const rows = new Float32Array(frame.length)
  const out = new Float32Array(frame.length)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let v = frame[y * width + x] as number
      for (let k = Math.max(0, x - r); k <= Math.min(width - 1, x + r); k++)
        v = pick(v, frame[y * width + k] as number)
      rows[y * width + x] = v
    }
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      let v = rows[y * width + x] as number
      for (let k = Math.max(0, y - r); k <= Math.min(height - 1, y + r); k++)
        v = pick(v, rows[k * width + x] as number)
      out[y * width + x] = v
    }
  return out
}

/** Each pixel's cell, and each cell's pixel count. */
function cellIndex(width: number, height: number): { count: number[]; of: Uint16Array } {
  const of = new Uint16Array(width * height)
  const count = Array.from({ length: MOVE_CELLS_X * MOVE_CELLS_Y }, () => 0)
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const cx = Math.min(MOVE_CELLS_X - 1, Math.floor((x * MOVE_CELLS_X) / width))
      const cy = Math.min(MOVE_CELLS_Y - 1, Math.floor((y * MOVE_CELLS_Y) / height))
      const cell = cy * MOVE_CELLS_X + cx
      of[y * width + x] = cell
      count[cell]++
    }
  return { count, of }
}

/** How far the picture moved from frame `a` to frame `b`: the most any cell moved (see `frameMoves`). */
function pairMove(
  gray: Uint8Array,
  size: number,
  cells: { count: number[]; of: Uint16Array },
  envA: Envelope[],
  envB: Envelope[],
  a: number,
  b: number,
): number {
  const n = cells.count.length
  // Each cell's shift in brightness: the median difference over its pixels.
  const diffs = Array.from({ length: n }, () => [] as number[])
  for (let i = 0; i < size; i++)
    diffs[cells.of[i] as number]?.push(
      (gray[b * size + i] as number) - (gray[a * size + i] as number),
    )
  const shift = diffs.map((d) => medianOf(d))
  let most = 0
  const residue = new Float64Array(n)
  const settled = Array.from({ length: n }, () => false)
  for (let r = 0; r <= MOVE_RADIUS; r++) {
    residue.fill(0)
    const ea = envA[r] as Envelope
    const eb = envB[r] as Envelope
    for (let i = 0; i < size; i++) {
      const cell = cells.of[i] as number
      if (settled[cell]) continue
      const lift = shift[cell] as number
      const vb = (gray[b * size + i] as number) - lift
      const va = (gray[a * size + i] as number) + lift
      // Outside what a move of r px from the other frame could give, both ways (an element
      // appearing and one disappearing).
      const out = Math.max(
        vb - (ea.max[i] as number),
        (ea.min[i] as number) - vb,
        va - (eb.max[i] as number),
        (eb.min[i] as number) - va,
      )
      if (out > MOVE_NOISE) residue[cell] += out - MOVE_NOISE
    }
    for (let c = 0; c < n; c++) {
      if (settled[c]) continue
      const mean = (residue[c] as number) / (cells.count[c] as number)
      if (mean < MOVE_RESIDUE) {
        settled[c] = true
        most = Math.max(most, r)
      } else if (r === MOVE_RADIUS) most = Math.max(most, MOVE_RADIUS + mean / MOVE_RESIDUE)
    }
  }
  return most
}

/** The median change in a window of `radius` frames either side of each frame. */
export function localMedians(changes: number[], radius: number): number[] {
  return changes.map((_, f) => medianOf(changes.slice(Math.max(1, f - radius), f + radius + 1)))
}

/**
 * The frames where the picture clearly does something: local peaks of the change well above its
 * local median (over half a second either side). `ratio` and `floor` set how clear.
 */
export function visualEvents(
  changes: number[],
  fps: number,
  ratio = PEAK_RATIO,
  floor = PEAK_FLOOR,
): number[] {
  const medians = localMedians(changes, Math.max(2, Math.round(fps / 2)))
  const events: number[] = []
  for (let f = 1; f < changes.length; f++) {
    const value = changes[f] as number
    const isPeak = value > (changes[f - 1] as number) && value >= (changes[f + 1] ?? 0)
    const median = medians[f] as number
    if (isPeak && value >= median * ratio && value >= median + floor) events.push(f)
  }
  return events
}

/** The time of beat `n` (fractions allowed), as grid.ts's `beat()` reckons it. */
export function beatTime(reel: ReelJson, n: number): number {
  const beatSec = 60 / reel.bpm
  const whole = Math.floor(n)
  const at = (i: number) => {
    const beats = reel.beats
    if (i < beats.length) return beats[i] as number
    const last = beats.length - 1
    return (last >= 0 ? (beats[last] as number) : 0) + (i - Math.max(last, 0)) * beatSec
  }
  return at(whole) + (n - whole) * (at(whole + 1) - at(whole))
}

/** Beat number of a time (the inverse of `beatTime`, to two decimals). */
export function beatAt(reel: Pick<ReelJson, 'beats' | 'bpm'>, seconds: number): number {
  const { beats } = reel
  const beatSec = 60 / reel.bpm
  if (!beats.length) return Math.round((seconds / beatSec) * 100) / 100
  let i = 0
  while (i + 1 < beats.length && (beats[i + 1] as number) <= seconds) i++
  const next = i + 1 < beats.length ? (beats[i + 1] as number) : (beats[i] as number) + beatSec
  const from = beats[i] as number
  return Math.round((i + (seconds - from) / (next - from)) * 100) / 100
}

/**
 * The cuts, one per shot change: a cut the scene detector also reports on the next frame or two (a
 * two-frame transition, a flash) is the same cut, kept at its first frame.
 */
export function distinctCuts(cuts: number[], fps: number): number[] {
  const sorted = [...cuts].sort((a, b) => a - b)
  return sorted.filter((t, i) => i === 0 || t - (sorted[i - 1] as number) > 2.5 / fps)
}

/**
 * How a render's cuts sit on the grid, in one line: on a beat, on a half beat, or off it (with the
 * beat numbers of those, so the agent can fix them). A cut is on the grid within a frame and a half.
 */
export function gridReport(reel: ReelJson, allCuts: number[]): string {
  const cuts = distinctCuts(allCuts, reel.fps)
  const tolerance = 1.5 / reel.fps
  const beatSec = 60 / reel.bpm
  const total = Math.ceil(reel.lengthSec / beatSec) + 1
  const beats = Array.from({ length: total }, (_, i) => beatTime(reel, i))
  const halves = beats.map((b, i) => (b + (beats[i + 1] ?? b + beatSec)) / 2)
  const near = (t: number, grid: number[]) => grid.some((g) => Math.abs(g - t) <= tolerance)
  const inside = cuts.filter((t) => t > tolerance && t < reel.lengthSec - tolerance)
  const onBeat = inside.filter((t) => near(t, beats))
  const onHalf = inside.filter((t) => !near(t, beats) && near(t, halves))
  const off = inside.filter((t) => !near(t, beats) && !near(t, halves))
  if (!inside.length)
    return 'No hard cuts found (only moves and fades): nothing to check against the beat.'
  const parts = [`${inside.length} cuts: ${onBeat.length} on a beat`]
  if (onHalf.length) parts.push(`${onHalf.length} on a half beat`)
  parts.push(
    off.length
      ? `${off.length} off the grid (at beats ${off.map((t) => beatAt(reel, t)).join(', ')})`
      : 'none off the grid',
  )
  return `${parts.join(', ')}.`
}

/**
 * Whether the picture changes a lot at `frame` (within the tolerance): a spike well above how much it
 * was changing in the half second before (a flash, a whip, a new scene), or a shift in how much it
 * moves, from the half second before to the half second after (a busy scene stopping dead, or a
 * still one bursting into motion).
 */
export function bigChangeAt(changes: number[], frame: number, fps: number): boolean {
  const half = Math.max(2, Math.round(fps / 2))
  const from = Math.max(1, frame - TOLERANCE_FRAMES)
  const to = frame + TOLERANCE_FRAMES + 1
  const peak = Math.max(0, ...changes.slice(from, to))
  const before = medianOf(changes.slice(Math.max(1, from - half), from))
  const after = medianOf(changes.slice(to, to + half))
  const spike = peak >= BIG_FLOOR && peak >= before * BIG_RATIO
  const shift =
    Math.max(before, after) >= BIG_FLOOR &&
    Math.max(before, after) >= BIG_RATIO * Math.min(before, after)
  return spike || shift
}

function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted.length ? (sorted[Math.floor(sorted.length / 2)] as number) : 0
}

/** The reel's music events; a reel made before they were written gets the no-music defaults. */
export function reelEvents(reel: ReelJson): MusicEvents {
  const events = (reel as Partial<ReelJson>).events
  if (events) return events
  return {
    chords: reel.downbeats,
    kicks: reel.beats,
    melody: [],
    sections: [{ endSec: reel.lengthSec, energy: 2, name: 'groove', startSec: 0 }],
    snares: [],
  }
}

/**
 * The sync report for a render: the reel's grid and music events against the per-frame change, the
 * half-second moves (`frameMoves`; those `measureChanges` measured with the changes by default)
 * and the cut times (seconds). Every miss is named by its beat number (and a stall or a long shot
 * by its time too), so the agent can find and fix it.
 */
export function syncReport(
  reel: ReelJson,
  changes: number[],
  cuts: number[],
  moves: number[] | undefined = movesOf(changes),
): SyncReport {
  const fps = reel.fps
  const toFrame = (t: number) => Math.round(t * fps)
  const events = reelEvents(reel)
  const cutFrames = distinctCuts(cuts, fps)
    .map(toFrame)
    .filter((f) => f > 0 && f < changes.length)
  const near = (frames: number[], frame: number) =>
    frames.some((f) => Math.abs(f - frame) <= TOLERANCE_FRAMES)

  const pace = paceFindings(reel, changes, cuts, moves)
  const lastBar = toFrame(reel.downbeats[reel.downbeats.length - 1] ?? reel.lengthSec)
  // The end card holds (from its shot, or the last bar), so a section starting in that hold (a
  // stop, the final hit) needs no cut.
  const holdFrame = Math.min(lastBar, toFrame(pace.endHoldFrom))
  const starts = events.sections
    .map((s, i) => ({ ...s, before: events.sections[i - 1] }))
    .filter((s) => s.before && toFrame(s.startSec) < holdFrame)
  const unmarked = starts.filter(
    (s) => !near(cutFrames, toFrame(s.startSec)) && !bigChangeAt(changes, toFrame(s.startSec), fps),
  )
  const named = (list: typeof starts) =>
    list.map((s) => ({ beat: beatAt(reel, s.startSec), name: s.name }))
  const sectionMisses = named(unmarked.filter((s) => s.energy !== s.before?.energy))
  const sectionSoftMisses = named(unmarked.filter((s) => s.energy === s.before?.energy))
  const markedByChange = starts.filter(
    (s) => !near(cutFrames, toFrame(s.startSec)) && !unmarked.includes(s),
  ).length

  const melody = melodyHits(reel, events, changes, cutFrames)
  const pulse = pulseRatio(changes, events.kicks.map(toFrame), cutFrames)

  return describe({
    changes: {
      count: cutFrames.length + markedByChange,
      needed: Math.max(1, Math.floor(reel.bars / SYNC_THRESHOLDS.barsPerChange)),
    },
    cuts,
    cutsOnGrid: gridShare(reel, cuts),
    kickPulse: pulse?.ratio ?? null,
    kickPulseLevels: pulse?.levels ?? 0,
    melody,
    reel,
    pace,
    sectionMisses,
    sectionSoftMisses,
  })
}

/**
 * Where each shot starts (frames, from 0): the distinct cuts, and the big changes the scene
 * detector does not call a cut (a whip, a flash, a new scene that moves in): a peak of the change
 * at least BIG_FLOOR grey levels and BIG_RATIO times the median of the half second before it.
 * Starts closer than SHOT_MERGE_SEC are one transition, kept at the first.
 */
export function shotStarts(changes: number[], cuts: number[], fps: number): number[] {
  const half = Math.max(2, Math.round(fps / 2))
  const spikes: number[] = []
  for (let f = 1; f < changes.length; f++) {
    const value = changes[f] as number
    const isPeak = value > (changes[f - 1] as number) && value >= (changes[f + 1] ?? 0)
    const before = medianOf(changes.slice(Math.max(1, f - half), f))
    if (isPeak && value >= BIG_FLOOR && value >= before * BIG_RATIO) spikes.push(f)
  }
  const cutFrames = distinctCuts(cuts, fps)
    .map((t) => Math.round(t * fps))
    .filter((f) => f > 0 && f < changes.length)
  const merge = SHOT_MERGE_SEC * fps
  return [0, ...cutFrames, ...spikes]
    .sort((a, b) => a - b)
    .reduce<number[]>((kept, f) => {
      if (!kept.length || f - (kept[kept.length - 1] as number) > merge) kept.push(f)
      return kept
    }, [])
}

/**
 * Where the end card may start to hold (seconds): where the last shot starts, when that is within
 * END_CARD_MAX_SEC of the end and in the reel's last fifth (the end card is that shot: the
 * reference's lands on a cut 5 s from the end and holds from 26.3 s); otherwise only the last bar
 * or the last END_HOLD_MIN_SEC, whichever is longer. A hold before it is a stall.
 */
export function endHoldFrom(reel: PaceReel, starts: number[]): number {
  const barSec = (reel.beatsPerBar * 60) / reel.bpm
  const latest = reel.lengthSec - Math.max(barSec, END_HOLD_MIN_SEC)
  const lastShot = (starts[starts.length - 1] ?? 0) / reel.fps
  const endCard = Math.min(END_CARD_MAX_SEC, reel.lengthSec * END_CARD_SHARE)
  return round2(reel.lengthSec - lastShot <= endCard ? Math.min(lastShot, latest) : latest)
}

/**
 * Stretches of STALL_SEC or more in which the picture goes nowhere, before `endFrame`, as
 * [from, to] frames. With the half-second moves, every half second that moved less than
 * MOVE_STILL is still (a slow drift on a flat ground included); without them, every frame that
 * changes less than STILL_LEVEL.
 */
export function stallRuns(
  changes: number[],
  moves: number[] | undefined,
  fps: number,
  endFrame: number,
): [number, number][] {
  const window = Math.round(STALL_SEC * fps)
  const still = Array.from({ length: changes.length }, () => false)
  if (moves)
    moves.forEach((m, f) => {
      if (m < MOVE_STILL) for (let g = Math.max(0, f - window); g <= f; g++) still[g] = true
    })
  else changes.forEach((c, f) => (still[f] = f > 0 && c < STILL_LEVEL))
  const runs: [number, number][] = []
  let start = -1
  for (let f = 0; f <= still.length; f++) {
    if (f < still.length && still[f]) {
      if (start < 0) start = f
      continue
    }
    if (start < 0) continue
    // A still window of moves spans its frames [f - window, f]: `window` frames of time.
    const to = Math.min(moves ? f - 1 : f, endFrame)
    if (start < endFrame && to - start >= window) runs.push([start, to])
    start = -1
  }
  return runs
}

/**
 * The pace of a render: its shots (`shotStarts`), where the end card may hold, and the stalls
 * before that. `moves` are the half-second moves (`frameMoves`); without them, stalls are judged
 * on the frame-to-frame change alone.
 */
export function paceFindings(
  reel: PaceReel,
  changes: number[],
  cuts: number[],
  moves?: number[],
): PaceFindings {
  const fps = reel.fps
  const starts = shotStarts(changes, cuts, fps)
  const end = Math.max(changes.length, 1)
  const at = (frame: number) => round2(frame / fps)
  const beatOf = (seconds: number) => beatAt(reel, seconds)
  const shots = starts.map((f, i) => ({
    from: at(f),
    fromBeat: beatOf(f / fps),
    length: round2(((starts[i + 1] ?? end) - f) / fps),
  }))
  const holdFrom = endHoldFrom(reel, starts)
  const runs = stallRuns(changes, moves, fps, Math.round(holdFrom * fps))
  // The payoff hold: the longest stall short enough, once per reel.
  const payoff = runs
    .filter(([from, to]) => (to - from) / fps <= PAYOFF_HOLD_SEC)
    .sort((a, b) => b[1] - b[0] - (a[1] - a[0]))[0]
  const stall = ([from, to]: [number, number]) => ({
    from: at(from),
    fromBeat: beatOf(from / fps),
    to: at(to),
    toBeat: beatOf(to / fps),
  })
  return {
    endHoldFrom: holdFrom,
    hold: payoff ? stall(payoff) : null,
    shots,
    stalls: runs.filter((r) => r !== payoff).map(stall),
  }
}

/** One line on the shots: how many, and those that run long (over 4 s) or too long (over 8 s). */
export function shotsLine(shots: Shot[]): { fails: boolean; line: string } {
  const list = (s: Shot[]) =>
    s.map((x) => `${x.from} s for ${x.length} s (beat ${x.fromBeat})`).join(', ')
  const tooLong = shots.filter((s) => s.length > MAX_SHOT_SEC)
  const long = shots.filter((s) => s.length > LONG_SHOT_SEC && s.length <= MAX_SHOT_SEC)
  const longest = Math.max(0, ...shots.map((s) => s.length))
  const parts = [`${shots.length} shot${shots.length === 1 ? '' : 's'}, the longest ${longest} s`]
  if (tooLong.length)
    parts.push(
      `${tooLong.length} too long (over ${MAX_SHOT_SEC} s: ${list(tooLong)}): split each into different shots of at most ${LONG_SHOT_SEC} s`,
    )
  if (long.length)
    parts.push(
      `${long.length} long (over ${LONG_SHOT_SEC} s, information: ${list(long)}): one idea is at most ${LONG_SHOT_SEC} s`,
    )
  return { fails: tooLong.length > 0, line: `Scenes: ${parts.join('; ')}.` }
}

/** One line on the stalls, each by time and beat (the first `max`). */
export function stallsLine(
  stalls: Stall[],
  holdFrom: number,
  max = LIST_MAX,
  hold: null | Stall = null,
): string {
  const payoff = hold
    ? ` One hold let through as the payoff beat (at most ${PAYOFF_HOLD_SEC} s, once a reel): ${hold.from}-${hold.to} s (beats ${hold.fromBeat}-${hold.toBeat}).`
    : ''
  if (!stalls.length)
    return `Stalls: none (nothing stands still for ${STALL_SEC} s before the end card at ${holdFrom} s).${payoff}`
  const shown = stalls
    .slice(0, max)
    .map((s) => `${s.from}-${s.to} s (beats ${s.fromBeat}-${s.toBeat})`)
  const more = stalls.length > max ? ` and ${stalls.length - max} more` : ''
  return `Stalls: ${stalls.length} where nothing visibly moves for ${STALL_SEC} s or more before the end card at ${holdFrom} s: ${shown.join(', ')}${more}. Keep something moving through each, big enough to see: a camera push, an element sliding or turning, a large counter, the next element coming in (a slow drift of 2% a second, or a glow, does not count).${payoff}`
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

/**
 * The accented melody notes in the energetic sections, how many get a visual event or a cut, and
 * the share the same notes get moved half a beat either way: what a picture busy at random scores.
 */
function melodyHits(
  reel: ReelJson,
  events: MusicEvents,
  changes: number[],
  cutFrames: number[],
): SyncReport['melody'] {
  const fps = reel.fps
  const toFrame = (t: number) => Math.round(t * fps)
  const marks = [...visualEvents(changes, fps), ...cutFrames]
  const answered = (frame: number) => marks.some((f) => Math.abs(f - frame) <= TOLERANCE_FRAMES)
  const energetic = (t: number) =>
    events.sections.some((s) => s.energy >= 2 && t >= s.startSec - 0.001 && t < s.endSec)
  const accents = events.melody
    .filter((m) => m.strength >= ACCENT && energetic(m.t) && toFrame(m.t) < changes.length)
    .sort((a, b) => a.t - b.t)
  const missed = accents.filter((m) => !answered(toFrame(m.t)))
  const half = Math.round((30 / reel.bpm) * fps)
  const offBeat = accents.flatMap((m) => [toFrame(m.t) - half, toFrame(m.t) + half])
  const inside = offBeat.filter((f) => f > 0 && f < changes.length)
  return {
    chance: inside.length ? inside.filter(answered).length / inside.length : 0,
    hit: accents.length - missed.length,
    missedBeats: missed.map((m) => beatAt(reel, m.t)),
    total: accents.length,
  }
}

/** Share of the cuts inside the reel that sit on a beat or half beat (a frame and a half). */
function gridShare(reel: ReelJson, cuts: number[]): number {
  const tolerance = 1.5 / reel.fps
  const inside = distinctCuts(cuts, reel.fps).filter(
    (t) => t > tolerance && t < reel.lengthSec - tolerance,
  )
  if (!inside.length) return 1
  const halfBeats = Math.ceil((reel.lengthSec * reel.bpm) / 30) + 2
  const grid = Array.from({ length: halfBeats }, (_, i) => beatTime(reel, i / 2))
  const on = inside.filter((t) => grid.some((g) => Math.abs(g - t) <= tolerance))
  return on.length / inside.length
}

/**
 * The median change in the three frames from each kick on, over the median change in the other
 * frames. Medians, not means: a few big moves would swamp a mean, and the pulse is the typical frame
 * moving more on the kick. Frames around a cut are left out of both: a cut is a cut, not a pulse.
 */
function pulseRatio(
  changes: number[],
  kicks: number[],
  cuts: number[],
): null | { levels: number; ratio: number } {
  const afterKick = new Set<number>()
  for (const k of kicks) for (let f = k; f < k + 3; f++) afterKick.add(f)
  const on: number[] = []
  const off: number[] = []
  for (let f = 1; f < changes.length; f++) {
    if (cuts.some((c) => Math.abs(c - f) <= 1)) continue
    ;(afterKick.has(f) ? on : off).push(changes[f] as number)
  }
  if (!on.length || !off.length) return null
  const between = medianOf(off)
  const levels = medianOf(on) - between
  if (between <= 0) return { levels, ratio: medianOf(on) > 0 ? Infinity : 1 }
  return { levels, ratio: medianOf(on) / between }
}

/** Beat numbers for a report line: the first few, then how many more. */
function listed(beats: number[]): string {
  const more = beats.length - LIST_MAX
  return beats.slice(0, LIST_MAX).join(', ') + (more > 0 ? ` and ${more} more` : '')
}

/** What `describe` reads. */
type Findings = Omit<SyncReport, 'lines' | 'passes' | 'shots' | 'stalls'> & {
  cuts: number[]
  pace: PaceFindings
  reel: ReelJson
}

/** The report's lines and verdict from its numbers. */
function describe(o: Findings): SyncReport {
  const fixes: string[] = []
  const lines = [cutsLine(o, fixes), sectionLine(o, fixes), melodyLine(o, fixes), pulseLine(o)]
  const scenes = shotsLine(o.pace.shots)
  lines.push(scenes.line)
  if (scenes.fails) fixes.push('scenes over 8 s')
  lines.push(stallsLine(o.pace.stalls, o.pace.endHoldFrom, LIST_MAX, o.pace.hold))
  if (o.pace.stalls.length) fixes.push('stalls')

  const passes = !fixes.length
  lines.push(passes ? 'Sync: passes.' : `Sync: ${fixes.length} to fix: ${fixes.join(', ')}.`)
  const { cuts: _cuts, pace, reel: _reel, ...numbers } = o
  return { ...numbers, lines, passes, shots: pace.shots, stalls: pace.stalls }
}

/** The cuts line: how they sit on the grid, and whether there are enough shot changes. */
function cutsLine(o: Findings, fixes: string[]): string {
  const { count, needed } = o.changes
  if (o.cutsOnGrid < SYNC_THRESHOLDS.cutsOnGrid) fixes.push('cuts off the grid')
  if (count >= needed) return `Cuts: ${gridReport(o.reel, o.cuts)}`
  fixes.push('too few cuts')
  const changes = count === 1 ? '1 shot change' : `${count} shot changes`
  return `Cuts: ${gridReport(o.reel, o.cuts)} Only ${changes} in ${o.reel.bars} bars: it needs at least ${needed} shot changes (cuts on beats or downbeats, or a big change on a section start).`
}

/** The section starts line: the energy changes must be marked, a new part at the same energy
 *  should be. */
function sectionLine(o: Findings, fixes: string[]): string {
  const list = (misses: SyncReport['sectionMisses']) =>
    misses.map((s) => s.name + ' at beat ' + s.beat).join(', ')
  const soft = o.sectionSoftMisses.length
    ? ` Worth marking too (a new part at the same energy): ${list(o.sectionSoftMisses)}.`
    : ''
  if (!o.sectionMisses.length)
    return `Section starts: every energy change has a cut or a big change.${soft}`
  fixes.push('section starts')
  return `Section starts: ${o.sectionMisses.length} without a cut or a big change (${list(o.sectionMisses)}).${soft}`
}

/** The melody line: the share of accents answered against the chance level (misses listed only
 *  when it fails). */
function melodyLine(o: Findings, fixes: string[]): string {
  const { chance, hit, missedBeats, total } = o.melody
  if (!total) return 'Melody: no accented notes in the energetic sections to check.'
  const share = hit / total
  const percent = (v: number) => `${Math.round(v * 100)}%`
  const head = `Melody: ${hit} of ${total} accented notes get a visual event (${percent(share)}; ${percent(chance)} half a beat off them, by chance)`
  if (share >= SYNC_THRESHOLDS.melodyHit && share > chance) return `${head}.`
  fixes.push('melody notes')
  const misses = missedBeats.length ? `; pop something on beats ${listed(missedBeats)}` : ''
  return `${head}: the picture doesn't answer the melody${misses}.`
}

/**
 * The kick pulse line, for information only: it never fails the check. A pulse on every kick in
 * every reel reads as repetitive, so whether the picture pulses with the kick is a creative choice.
 */
function pulseLine(o: Findings): string {
  const { kickPulse, kickPulseLevels } = o
  if (kickPulse === null) return 'Kick pulse (information only): no kicks to check.'
  const ratio = Number.isFinite(kickPulse) ? Math.round(kickPulse * 100) / 100 : kickPulse
  const levels = Math.round(kickPulseLevels * 100) / 100
  const pulses =
    kickPulse >= SYNC_THRESHOLDS.kickPulse && kickPulseLevels >= SYNC_THRESHOLDS.kickPulseLevels
  return `Kick pulse (information only): ${ratio}x the change after a kick as between kicks, ${levels} grey levels more (${pulses ? 'the picture pulses with the kick' : 'no visible pulse on the kick'}).`
}

/** The half-second moves `measureChanges` measured with each change list it returned. */
const MEASURED_MOVES = new WeakMap<number[], number[]>()

/** The half-second moves measured with a change list from `measureChanges`, if it was one. */
export function movesOf(changes: number[]): number[] | undefined {
  return MEASURED_MOVES.get(changes)
}

/**
 * Each frame's visual change in a rendered video, at the reel's frame rate: FFmpeg decodes it small
 * and grey into `cwd`, and the raw frames are compared there. The half-second moves measured on the
 * same frames go with the list (`movesOf`), so the sync report judges stalls on them.
 */
export async function measureChanges(file: string, cwd: string, fps: number): Promise<number[]> {
  const { changes, moves } = await measureMotion(file, cwd, fps)
  MEASURED_MOVES.set(changes, moves)
  return changes
}

/**
 * A rendered video's frame-to-frame changes (`frameChanges`) and half-second moves
 * (`frameMoves`), at `fps`, from one small grey decode into `cwd`.
 */
export async function measureMotion(
  file: string,
  cwd: string,
  fps: number,
): Promise<{ changes: number[]; moves: number[] }> {
  const raw = path.join(cwd, `sync-${process.pid}-${Date.now()}.gray`)
  try {
    await run(
      'ffmpeg',
      [
        '-v',
        'error',
        '-y',
        '-i',
        file,
        '-an',
        '-vf',
        `fps=${fps},scale=${SYNC_FRAME_WIDTH}:${SYNC_FRAME_HEIGHT},format=gray`,
        '-f',
        'rawvideo',
        raw,
      ],
      cwd,
      10 * 60_000,
    )
    const gray = fs.readFileSync(raw)
    const size = SYNC_FRAME_WIDTH * SYNC_FRAME_HEIGHT
    return {
      changes: frameChanges(gray, size),
      moves: frameMoves(gray, SYNC_FRAME_WIDTH, SYNC_FRAME_HEIGHT, Math.round(STALL_SEC * fps)),
    }
  } finally {
    fs.rmSync(raw, { force: true })
  }
}
