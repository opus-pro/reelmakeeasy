import type { TranscriptData, TranscriptWord } from '@shared/types/agent/transcript'

import type { LongTakeBeatSheetOutput } from '../../long-take-experts-analysis'

import {
  buildAudioRegions,
  energyPercentile,
  flattenWords,
  isOnBeat,
  meanEnergyInRange,
  snapToBeat,
  textForRange,
} from './regions'
import {
  type AudioRegion,
  type BeatGrid,
  type BeatGridPacingOptions,
  DEFAULT_BEATGRID_PACING_OPTIONS,
  type EnergySample,
  type MusicSection,
} from './types'

// Salience weights (implementation detail; the budget knobs are the public options).
const W_ENERGY = 1 // cut where there is energy to cut on
const W_STEP = 2.4 // an energy change (build / drop / breakdown) is the strongest cut cue
const W_DOWNBEAT = 1.3 // bias cuts onto bar starts -> fewer, more musical cuts than every-beat
const W_LYRIC = 1.1 // cut on a vocal-phrase entrance
const W_ONSET = 0.4
const STEP_WINDOW_SEC = 1.5

type Candidate = {
  downbeat: boolean
  sal: number
  t: number
}

type SectionStat = MusicSection & {
  dur: number
  me: number
  weight: number
}

function energyAt(energy: EnergySample[], t: number): number {
  if (energy.length === 0) {
    return 0
  }
  let best = energy[0]?.rms ?? 0
  let bestDist = Number.POSITIVE_INFINITY
  for (const e of energy) {
    const d = Math.abs(e.t - t)
    if (d < bestDist) {
      bestDist = d
      best = e.rms
    }
  }
  return best
}

/** Magnitude of the energy level change around t (mean after vs mean before) - a build/drop edge. */
function energyStepAt(energy: EnergySample[], t: number, w: number): number {
  const before = meanEnergyInRange(energy, Math.max(0, t - w), t)
  const after = meanEnergyInRange(energy, t, t + w)
  return Math.abs(after - before)
}

function onsetCountNear(onsets: number[], t: number, half: number): number {
  let c = 0
  for (const o of onsets) {
    if (o >= t - half && o <= t + half) {
      c++
    }
  }
  return c
}

/** First word of each lyric "line" (gap from the previous word exceeds lineGapSec). */
function lyricLineStarts(words: TranscriptWord[], lineGapSec: number): number[] {
  const starts: number[] = []
  for (let i = 0; i < words.length; i++) {
    const w = words[i]
    if (!w) {
      continue
    }
    const prev = words[i - 1]
    if (i === 0 || !prev || w.start - prev.end > lineGapSec) {
      starts.push(w.start)
    }
  }
  return starts
}

function nearAny(times: number[], t: number, tol: number): boolean {
  return times.some((x) => Math.abs(x - t) <= tol)
}

/** Score every beat as a candidate cut by energy + energy-step + downbeat + lyric-entrance. */
function scoreBeatCandidates(
  beats: number[],
  downbeats: number[],
  energy: EnergySample[],
  onsets: number[],
  lineStarts: number[],
  tol: number,
): Candidate[] {
  const lyrTol = Math.max(tol, 0.15)
  return beats.map((t) => {
    const onsetD = Math.min(1, onsetCountNear(onsets, t, tol * 2) / 3)
    const downbeat = isOnBeat(downbeats, t, tol)
    const lyr = nearAny(lineStarts, t, lyrTol)
    const sal =
      W_ENERGY * energyAt(energy, t) +
      W_STEP * energyStepAt(energy, t, STEP_WINDOW_SEC) +
      W_DOWNBEAT * (downbeat ? 1 : 0) +
      W_LYRIC * (lyr ? 1 : 0) +
      W_ONSET * onsetD
    return { downbeat, sal, t }
  })
}

/** Sort, clamp, and make sections cover the full [0,duration] track without gaps. */
function normalizeSections(sections: MusicSection[], duration: number): MusicSection[] {
  if (sections.length === 0) {
    return [{ end: duration, start: 0 }]
  }
  const sorted = sections
    .map((s) => ({
      end: Math.max(0, Math.min(duration, s.end)),
      start: Math.max(0, Math.min(duration, s.start)),
    }))
    .filter((s) => s.end > s.start)
    .sort((a, b) => a.start - b.start)
  if (sorted.length === 0) {
    return [{ end: duration, start: 0 }]
  }
  const out: MusicSection[] = []
  let cursor = 0
  for (const s of sorted) {
    const start = Math.max(cursor, s.start)
    if (start > cursor + 1e-3) {
      out.push({ end: start, start: cursor }) // fill a leading gap
    }
    if (s.end > start) {
      out.push({ end: s.end, start })
    }
    cursor = Math.max(cursor, s.end)
  }
  if (cursor < duration - 1e-3) {
    out.push({ end: duration, start: cursor })
  }
  return out.length ? out : [{ end: duration, start: 0 }]
}

/** Split the shot budget across sections, weighting by duration * normalized energy. */
function computeSectionStats(
  sections: MusicSection[],
  energy: EnergySample[],
  highEnergyPercentile: number,
): SectionStat[] {
  const hiE = energyPercentile(energy, highEnergyPercentile) || 1
  return sections.map((s) => {
    const dur = s.end - s.start
    const me = meanEnergyInRange(energy, s.start, s.end)
    const weight = dur * (0.4 + 0.6 * Math.min(1, me / Math.max(1e-6, hiE)))
    return { ...s, dur, me, weight }
  })
}

/** Highest-salience candidate inside [lo,hi] that stays >= minShot from every already-chosen cut. */
function pickInWindow(
  cands: Candidate[],
  lo: number,
  hi: number,
  minShot: number,
  chosen: number[],
): null | number {
  let best: null | number = null
  let bestSal = Number.NEGATIVE_INFINITY
  for (const c of cands) {
    if (c.t < lo || c.t > hi) {
      continue
    }
    if (chosen.some((x) => Math.abs(x - c.t) < minShot)) {
      continue
    }
    if (c.sal > bestSal) {
      bestSal = c.sal
      best = c.t
    }
  }
  return best
}

/** Even-within-section spacing walk: pick `alloc` cuts, each snapped to the most salient beat. */
function selectSectionCuts(
  s: SectionStat,
  alloc: number,
  candidates: Candidate[],
  beats: number[],
  downbeats: number[],
  minShot: number,
  clamp: (t: number) => number,
): number[] {
  const b0 = clamp(snapToBeat(downbeats, s.start))
  const inSec = candidates.filter((c) => c.t >= s.start && c.t < s.end)
  const chosen: number[] = [b0]
  const spacing = s.dur / alloc
  for (let k = 1; k < alloc; k++) {
    const center = s.start + k * spacing
    const half = spacing * 0.6
    let pick = pickInWindow(inSec, center - half, center + half, minShot, chosen)
    if (pick === null) {
      const nb = clamp(snapToBeat(beats, center))
      if (nb > s.start && nb < s.end && chosen.every((x) => Math.abs(x - nb) >= minShot)) {
        pick = nb
      }
    }
    if (pick !== null) {
      chosen.push(pick)
    }
  }
  return chosen
}

/** Drop cuts closer than minShot, preferring higher-priority cuts (boundaries > downbeats > beats). */
function enforceMinGap(
  sorted: number[],
  minShot: number,
  priority: (t: number) => number,
): number[] {
  const kept: number[] = []
  for (const t of sorted) {
    const last = kept[kept.length - 1]
    if (last === undefined || t - last >= minShot) {
      kept.push(t)
      continue
    }
    if (priority(t) > priority(last)) {
      const prev = kept[kept.length - 2]
      if (prev === undefined || t - prev >= minShot) {
        kept[kept.length - 1] = t
      }
    }
  }
  return kept
}

/** Beat time strictly inside (a,b) nearest the gap midpoint, so a forced split still lands on a beat. */
function nearestCandidateInGap(candidates: Candidate[], a: number, b: number): null | number {
  const mid = (a + b) / 2
  let best: null | number = null
  let bestD = Number.POSITIVE_INFINITY
  for (const c of candidates) {
    if (c.t <= a || c.t >= b) {
      continue
    }
    const d = Math.abs(c.t - mid)
    if (d < bestD) {
      bestD = d
      best = c.t
    }
  }
  return best
}

/**
 * Split any gap longer than maxHold by inserting an on-beat cut. The cut is ALWAYS a real beat:
 * a salient one within the spacing window, else the nearest beat in the gap. If a gap contains no
 * beat at all (a pathologically sparse grid), it is left intact rather than inserting an off-beat
 * midpoint - the on-beat invariant (time_range_audited) is never violated.
 */
function enforceMaxHold(
  cuts: number[],
  candidates: Candidate[],
  duration: number,
  maxHold: number,
  minShot: number,
): number[] {
  const out = [...cuts]
  for (let guard = 0; guard < 1000; guard++) {
    const sorted = [...new Set(out)].sort((a, b) => a - b)
    let inserted = false
    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i] ?? 0
      const b = i + 1 < sorted.length ? (sorted[i + 1] ?? duration) : duration
      if (b - a > maxHold) {
        const pick =
          pickInWindow(candidates, a + minShot, b - minShot, minShot, [a, b]) ??
          nearestCandidateInGap(candidates, a, b)
        if (pick === null) {
          continue // no beat inside this gap: keep it on-beat by leaving the (longer) hold
        }
        out.push(pick)
        inserted = true
        break
      }
    }
    if (!inserted) {
      break
    }
  }
  return [...new Set(out)].sort((a, b) => a - b)
}

/** Build contiguous beat-sheet items from cut times; segment_text from the region map (sung only). */
function buildBeatSheetItems(
  cuts: number[],
  regions: AudioRegion[],
  words: TranscriptWord[],
  duration: number,
): LongTakeBeatSheetOutput['beat_sheet'] {
  const beatSheet: LongTakeBeatSheetOutput['beat_sheet'] = []
  for (let i = 0; i < cuts.length; i++) {
    const start = cuts[i] ?? 0
    const end = i + 1 < cuts.length ? (cuts[i + 1] ?? duration) : duration
    if (end - start < 1e-3) {
      continue
    }
    const mid = (start + end) / 2
    const region = regions.find((r) => mid >= r.start && mid < r.end)?.kind ?? 'sung'
    const segmentText = region === 'sung' ? textForRange(words, start, end) : ''
    beatSheet.push({
      beat_id: beatSheet.length + 1,
      duration: end - start,
      segment_text: segmentText,
      time_range: { end, start },
    })
  }
  return beatSheet
}

/**
 * Turn a musical BeatGrid + a timestamped transcript into a beat sheet whose cuts land on real
 * beats - the deterministic "Phase 1" music-pacing layer.
 *
 *  - Lyrics decide WHAT to show; music decides WHEN to cut. Cuts only ever land on real beats.
 *  - Every beat is a candidate cut scored by a SALIENCE = energy + energy-step (build/drop) +
 *    downbeat bonus + lyric-entrance bonus; each cut snaps to the most salient nearby beat
 *    instead of a blind "every K beats".
 *  - A global SHOT BUDGET (targetShotsPerMin, capped by maxShots) is split across structural
 *    sections weighted by energy: high-energy sections get denser cuts, quiet ones fewer - so the
 *    cadence is non-uniform (varied across sections) and the total shot count (=> generation cost)
 *    is bounded.
 *  - minShotSec / maxHoldSec keep every shot within Veo's ~[2,10]s bounds; region edges (vocals
 *    start/stop) force a scene-change cut.
 *
 * The output is a `LongTakeBeatSheetOutput` with `time_range_audited: true`, so it can feed the
 * existing shot-plan PATH A (`buildShotsFromBeatTimeRanges`) verbatim once wiring lands.
 */
export function buildMusicBeatSheet(
  beatGrid: BeatGrid,
  transcript: null | TranscriptData | undefined,
  options?: Partial<BeatGridPacingOptions>,
): LongTakeBeatSheetOutput {
  const opts: BeatGridPacingOptions = { ...DEFAULT_BEATGRID_PACING_OPTIONS, ...options }
  const words = flattenWords(transcript)
  const duration = beatGrid.durationSec
  const beats = beatGrid.beats
  const downbeats = beatGrid.downbeats.length >= 2 ? beatGrid.downbeats : beats
  const energy = beatGrid.energy
  const tol = opts.beatToleranceSec
  const minShot = Math.max(0.3, opts.minShotSec)
  // Keep maxHold >= 2*minShot so the [a+minShot, b-minShot] insertion window never inverts.
  const maxHold = Math.max(minShot * 2, opts.maxHoldSec)
  const regions = buildAudioRegions(
    words,
    duration,
    opts.lineGapSec,
    2.5,
    beatGrid.sections,
    energy,
  )
  const clamp = (t: number): number => Math.max(0, Math.min(duration, t))

  // Degenerate input: no usable beat grid -> one shot for the whole track.
  if (beats.length < 2) {
    return {
      beat_sheet: [
        {
          beat_id: 1,
          duration,
          segment_text: textForRange(words, 0, duration),
          time_range: { end: duration, start: 0 },
        },
      ],
      text_audited: false,
      time_range_audited: true,
    }
  }

  const lineStarts = lyricLineStarts(words, opts.lineGapSec)
  const candidates = scoreBeatCandidates(
    beats,
    downbeats,
    energy,
    beatGrid.onsets ?? [],
    lineStarts,
    tol,
  )
  const sections = normalizeSections(beatGrid.sections ?? [], duration)

  // Global shot budget (cost lever) and the floor needed to honor maxHold.
  const target = Math.round((duration / 60) * opts.targetShotsPerMin)
  const minShotsFloor = Math.max(sections.length, Math.ceil(duration / maxHold))
  const budget = Math.min(opts.maxShots, Math.max(minShotsFloor, target))

  const secStats = computeSectionStats(sections, energy, opts.highEnergyPercentile)
  const wSum = secStats.reduce((acc, s) => acc + s.weight, 0) || 1

  // Collect cut times: track start, every region edge (vocals start/stop), and per-section cuts.
  const boundarySet = new Set<string>()
  const cutSet = new Set<number>()
  cutSet.add(0)
  boundarySet.add((0).toFixed(3))
  for (const r of regions) {
    const rb = clamp(snapToBeat(downbeats, r.start))
    cutSet.add(rb)
    boundarySet.add(rb.toFixed(3))
  }
  for (const s of secStats) {
    const alloc = Math.max(1, Math.round((budget * s.weight) / wSum))
    boundarySet.add(clamp(snapToBeat(downbeats, s.start)).toFixed(3))
    for (const t of selectSectionCuts(s, alloc, candidates, beats, downbeats, minShot, clamp)) {
      cutSet.add(clamp(t))
    }
  }

  // Enforce min spacing (keep boundaries/downbeats over interior beats), then split long holds.
  const priority = (t: number): number =>
    boundarySet.has(t.toFixed(3)) ? 2 : isOnBeat(downbeats, t, tol) ? 1 : 0
  let cuts = enforceMinGap(
    [...cutSet].map(clamp).sort((a, b) => a - b),
    minShot,
    priority,
  )
  cuts = enforceMaxHold(cuts, candidates, duration, maxHold, minShot)
  if ((cuts[0] ?? 0) > 1e-3) {
    cuts.unshift(0)
  }

  return {
    beat_sheet: buildBeatSheetItems(cuts, regions, words, duration),
    text_audited: false,
    time_range_audited: true,
  }
}
