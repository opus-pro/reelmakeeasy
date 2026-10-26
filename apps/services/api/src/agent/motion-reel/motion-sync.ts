import fs from 'node:fs'
import path from 'node:path'

import type { MusicEvents } from '@reelmakeeasy/common/motion-reel/beat-grid'
import type { ReelJson } from '@reelmakeeasy/common/motion-reel/reel-config'

import { run } from './motion-runtime'

/**
 * The sync check: after a render, how the picture moves with the music. Each frame's visual change
 * (the mean grey-level difference from the frame before, on a small grey copy of the reel) is set
 * against the reel's music events: do the section starts get a cut or a big change, do the accented
 * melody notes make something happen, does the picture pulse on the kick, and does it ever stand
 * still. Pure functions over the change list; only `measureChanges` runs FFmpeg.
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
 * where the energy changes marked, and no stills. Reels that only drift, or flicker the background
 * a grey level on the kick, fail. A reel that moves with its music like the films do passes.
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
/** ...and at least this many grey levels (a world change, not a slight shift of the ground). */
const BIG_FLOOR = 8
/** A frame changing less than this (grey levels) is still. */
const STILL_LEVEL = 0.15
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
  /** Still stretches longer than a beat outside the last bar, as beat spans. */
  stills: { fromBeat: number; toBeat: number }[]
}

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
export function beatAt(reel: ReelJson, seconds: number): number {
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
 * was changing in the half second before (a flash, a whip, a new world), or a shift in how much it
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
 * The sync report for a render: the reel's grid and music events against the per-frame change and
 * the cut times (seconds). Every miss is named by its beat number, so the agent can find and fix it.
 */
export function syncReport(reel: ReelJson, changes: number[], cuts: number[]): SyncReport {
  const fps = reel.fps
  const beatFrames = (60 / reel.bpm) * fps
  const toFrame = (t: number) => Math.round(t * fps)
  const beatOf = (frame: number) => beatAt(reel, frame / fps)
  const events = reelEvents(reel)
  const cutFrames = distinctCuts(cuts, fps)
    .map(toFrame)
    .filter((f) => f > 0 && f < changes.length)
  const near = (frames: number[], frame: number) =>
    frames.some((f) => Math.abs(f - frame) <= TOLERANCE_FRAMES)

  const lastBar = toFrame(reel.downbeats[reel.downbeats.length - 1] ?? reel.lengthSec)
  // The end card holds the last bar, so a section starting there (the final hit) needs no cut.
  const starts = events.sections
    .map((s, i) => ({ ...s, before: events.sections[i - 1] }))
    .filter((s) => s.before && toFrame(s.startSec) < lastBar)
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
  const stills = stillRuns(changes, Math.ceil(beatFrames), lastBar).map(([from, to]) => ({
    fromBeat: beatOf(from),
    toBeat: beatOf(to),
  }))

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
    sectionMisses,
    sectionSoftMisses,
    stills,
  })
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

/** Runs of still frames longer than `minFrames` that start before `endFrame`, as [from, to] frames. */
function stillRuns(changes: number[], minFrames: number, endFrame: number): [number, number][] {
  const runs: [number, number][] = []
  let start = -1
  for (let f = 1; f <= changes.length; f++) {
    const still = f < changes.length && (changes[f] as number) < STILL_LEVEL
    if (still && start < 0) start = f
    if (!still && start >= 0) {
      const to = Math.min(f, endFrame)
      if (start < endFrame && to - start > minFrames) runs.push([start, to])
      start = -1
    }
  }
  return runs
}

/** Beat numbers for a report line: the first few, then how many more. */
function listed(beats: number[]): string {
  const more = beats.length - LIST_MAX
  return beats.slice(0, LIST_MAX).join(', ') + (more > 0 ? ` and ${more} more` : '')
}

/** What `describe` reads. */
type Findings = Omit<SyncReport, 'lines' | 'passes'> & { cuts: number[]; reel: ReelJson }

/** The report's lines and verdict from its numbers. */
function describe(o: Findings): SyncReport {
  const fixes: string[] = []
  const lines = [
    cutsLine(o, fixes),
    sectionLine(o, fixes),
    melodyLine(o, fixes),
    pulseLine(o, fixes),
  ]
  const stillList = o.stills.map((s) => s.fromBeat + '-' + s.toBeat).join(', ')
  lines.push(
    o.stills.length
      ? `Stills: ${o.stills.length} longer than a beat (beats ${stillList}).`
      : 'Stills: none longer than a beat.',
  )
  if (o.stills.length) fixes.push('stills')

  const passes = !fixes.length
  lines.push(passes ? 'Sync: passes.' : `Sync: ${fixes.length} to fix: ${fixes.join(', ')}.`)
  const { cuts: _cuts, reel: _reel, ...numbers } = o
  return { ...numbers, lines, passes }
}

/** The cuts line: how they sit on the grid, and whether there are enough shot changes. */
function cutsLine(o: Findings, fixes: string[]): string {
  const { count, needed } = o.changes
  if (o.cutsOnGrid < SYNC_THRESHOLDS.cutsOnGrid) fixes.push('cuts off the grid')
  if (count >= needed) return `Cuts: ${gridReport(o.reel, o.cuts)}`
  fixes.push('too few cuts')
  const changes = count === 1 ? '1 shot change' : `${count} shot changes`
  return `Cuts: ${gridReport(o.reel, o.cuts)} Only ${changes} in ${o.reel.bars} bars: it needs at least ${needed} (a new world on each section start, hard cuts on downbeats inside a section).`
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

/** The kick pulse line: the ratio, and a pulse big enough to see. */
function pulseLine(o: Findings, fixes: string[]): string {
  const { kickPulse, kickPulseLevels } = o
  if (kickPulse === null) return 'Kick pulse: no kicks to check.'
  const ratio = Number.isFinite(kickPulse) ? Math.round(kickPulse * 100) / 100 : kickPulse
  const levels = Math.round(kickPulseLevels * 100) / 100
  const head = `Kick pulse: ${ratio}x the change after a kick as between kicks, ${levels} grey levels more`
  if (kickPulse < SYNC_THRESHOLDS.kickPulse) {
    fixes.push('kick pulse')
    return `${head} (under ${SYNC_THRESHOLDS.kickPulse}x: the background does not pulse on the kick).`
  }
  if (kickPulseLevels < SYNC_THRESHOLDS.kickPulseLevels) {
    fixes.push('kick pulse')
    return `${head} (under ${SYNC_THRESHOLDS.kickPulseLevels}: too faint to see; make the pulse bigger).`
  }
  return `${head} (the picture pulses with the kick).`
}

/**
 * Each frame's visual change in a rendered video, at the reel's frame rate: FFmpeg decodes it small
 * and grey into `cwd`, and the raw frames are compared there.
 */
export async function measureChanges(file: string, cwd: string, fps: number): Promise<number[]> {
  const raw = path.join(cwd, 'sync.gray')
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
    return frameChanges(fs.readFileSync(raw), SYNC_FRAME_WIDTH * SYNC_FRAME_HEIGHT)
  } finally {
    fs.rmSync(raw, { force: true })
  }
}
