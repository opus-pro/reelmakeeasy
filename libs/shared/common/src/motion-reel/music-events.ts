/**
 * What a reel's music plays when: kicks, snares, melody notes, chord changes and sections. A score
 * the agent wrote knows them exactly (`score.ts`); any other track has them found by ear here, from
 * the spectrum, and snapped onto its beat grid. The reel's picture is then driven by them: the kick
 * pulses the background, the melody brings elements in, the sections change the world.
 *
 * Pure functions over mono samples and plain data; `music-map.md` (`renderMusicMap`) is how the
 * agent reads them.
 */

import type { BeatGrid, MusicEvents } from './beat-grid'
import type { ReelJson } from './reel-config'
import { fft, hann, ONSET_LAG_SEC } from './spectrum'

/** One music section: name, span (seconds) and energy (0 ambient .. 3 peak). */
export type MusicSection = MusicEvents['sections'][number]

/** A found hit before it is tidied: its time and how strong it was. */
type Hit = { s: number; t: number }

/** Per-frame features of a track, from one pass over its spectrum. */
type Features = {
  /** 12 pitch classes per frame (frame-major), from the mid range. */
  chroma: Float32Array
  /** Spectral flatness of 150 Hz-5 kHz (1 = noise, 0 = pure tones). */
  flatness: Float32Array
  frameRate: number
  frames: number
  /** Spectral flux below 120 Hz: kicks and bass (higher, a snare's body leaks in). */
  low: Float32Array
  /** Power below 120 Hz (how a low hit decays: a kick fast, a bass note slowly). */
  lowPower: Float32Array
  /** Spectral flux of the clear spectral peaks between 300 Hz and 3 kHz: pitched note starts. */
  melodic: Float32Array
  /** Spectral flux of 150 Hz-5 kHz: snares, claps and everything else. */
  mid: Float32Array
  /** Power in each of the `TEXTURE_EDGES` bands per frame (frame-major): the sound's colour. */
  texture: Float32Array
  /** Spectral flatness of 300 Hz-3 kHz, a few frames on (low = a note rings). */
  tonal: Float32Array
}

/** The bands (Hz) a track's texture is measured in: how its sound is spread from bass to air. */
const TEXTURE_EDGES = [40, 120, 250, 500, 1000, 2000, 4000, 8000]
const TEXTURE_BANDS = TEXTURE_EDGES.length - 1

/** Snap a found event onto the grid's nearest sixteenth when it is this close (seconds). */
const SNAP_SEC = 0.035
/** At most this many melody notes per second of music, on average (the strongest kept). */
const MELODY_PER_SEC = 8
/** At most this many kicks (or snares) per beat (the strongest kept). */
const DRUMS_PER_BEAT = 2
const FFT_SIZE = 1024
const HOP = 256

/** Events when nothing is known: no hits, one groove section over the span. */
export function emptyEvents(lengthSec: number): MusicEvents {
  return {
    chords: [],
    kicks: [],
    melody: [],
    sections: [{ endSec: round3(lengthSec), energy: 2, name: 'groove', startSec: 0 }],
    snares: [],
  }
}

/** Events for a reel without music: a kick on every beat, a chord change on every bar start. */
export function steadyEvents(beats: number[], downbeats: number[], lengthSec: number): MusicEvents {
  return { ...emptyEvents(lengthSec), chords: [...downbeats], kicks: [...beats] }
}

/**
 * The events inside a reel's window of the track, shifted so 0 is the reel's first frame, and the
 * sections clipped to the reel. No events: the empty set (one groove section).
 */
export function eventsInWindow(
  events: MusicEvents | undefined,
  startSec: number,
  lengthSec: number,
): MusicEvents {
  if (!events) return emptyEvents(lengthSec)
  const end = startSec + lengthSec
  const inside = (t: number) => t >= startSec - 0.001 && t < end - 0.001
  const shift = (t: number) => round3(Math.max(0, t - startSec))
  const sections = events.sections
    .filter((s) => s.endSec > startSec + 0.001 && s.startSec < end - 0.001)
    .map((s) => ({
      ...s,
      endSec: round3(Math.min(lengthSec, s.endSec - startSec)),
      startSec: shift(s.startSec),
    }))
  if (sections.length) {
    // Cover the whole reel, even where the track's sections stopped short.
    ;(sections[0] as MusicSection).startSec = 0
    ;(sections.at(-1) as MusicSection).endSec = round3(lengthSec)
  }
  return {
    chords: events.chords.filter(inside).map(shift),
    kicks: events.kicks.filter(inside).map(shift),
    melody: events.melody.filter((m) => inside(m.t)).map((m) => ({ ...m, t: shift(m.t) })),
    sections: sections.length ? sections : emptyEvents(lengthSec).sections,
    snares: events.snares.filter(inside).map(shift),
  }
}

/**
 * Tidies found or written events into the contract's shape: times to the millisecond, sorted,
 * at most two kicks and two snares per beat and eight melody notes a second (the strongest kept).
 */
export function tidyEvents(
  o: {
    chords: number[]
    kicks: Hit[]
    melody: { strength: number; t: number }[]
    sections: MusicSection[]
    snares: Hit[]
  },
  beats: number[],
  durationSec: number,
): MusicEvents {
  const maxMelody = Math.max(1, Math.round(MELODY_PER_SEC * durationSec))
  const melody = [...o.melody]
    .sort((a, b) => b.strength - a.strength || a.t - b.t)
    .slice(0, maxMelody)
    .map((m) => ({ strength: Math.round(m.strength * 100) / 100, t: round3(m.t) }))
    .sort((a, b) => a.t - b.t)
  return {
    chords: [...new Set(o.chords.map(round3))].sort((a, b) => a - b),
    kicks: capPerBeat(o.kicks, beats),
    melody: dedupeMelody(melody),
    sections: o.sections.map((s) => ({
      ...s,
      endSec: round3(s.endSec),
      startSec: round3(s.startSec),
    })),
    snares: capPerBeat(o.snares, beats),
  }
}

/**
 * The music's events found by ear, on the track's beat grid: kicks (low-band onsets), snares
 * (broadband, noisy onsets that aren't kicks), melody (pitched onsets in the lead's range),
 * chord changes (the pitch-class profile moving between half bars) and sections (bar loudness in
 * four levels, merged into runs and named by their shape).
 */
export function analyseMusicEvents(
  samples: Float32Array,
  sampleRate: number,
  grid: Pick<BeatGrid, 'beats' | 'bpm' | 'downbeats' | 'durationSec'>,
): MusicEvents {
  const features = spectralFeatures(samples, sampleRate)
  const beatSec = 60 / (grid.bpm || 120)
  const steps = sixteenths(grid.beats, grid.durationSec)
  const toHits = (picked: { f: number; s: number }[]) =>
    picked.map((p) => ({ s: p.s, t: snapNear(steps, p.f / features.frameRate + ONSET_LAG_SEC) }))

  // A snare's attack is noisier than the track's usual texture (how noisy that is varies a lot).
  const noisy = Math.max(
    SNARE_FLATNESS,
    SNARE_OVER_MEDIAN *
      percentile(
        [...features.flatness].sort((a, b) => a - b),
        0.5,
      ),
  )
  const kickOnsets = loudLowHits(
    features,
    4 * beatSec,
    pickOnsets(features.low, features.frameRate, { gapSec: beatSec / 4, k: 1.5 }),
  )
  const kickFrames = kickOnsets.map((k) => k.f)
  const kicks = toHits(kickOnsets)
  const snares = toHits(findSnares(features, kickFrames, beatSec, noisy))
  const sections = findSections(samples, sampleRate, features, grid, kicks)
  const melody = findMelody(features, steps, sections, beatSec)
  return tidyEvents(
    {
      chords: findChordChanges(features, grid, samples, sampleRate),
      kicks,
      melody,
      sections,
      snares,
    },
    grid.beats,
    grid.durationSec,
  )
}

/**
 * `reel/music-map.md`: the music bar by bar, in the reel's beat numbers (what `beat(n)` takes),
 * so the agent plans its worlds on the sections and its pops on the melody.
 */
export function renderMusicMap(
  reel: Pick<
    ReelJson,
    'bars' | 'beats' | 'beatsPerBar' | 'bpm' | 'downbeats' | 'events' | 'lengthSec' | 'music'
  >,
  key?: string,
): string {
  const { events } = reel
  const at = (t: number) => fmt(beatNumber(reel.beats, reel.bpm, t))
  const keyText = key ? `, key ${key}` : ''
  const sectionText = (s: MusicSection) =>
    `${s.name} beats ${at(s.startSec)}-${at(s.endSec)} (energy ${s.energy})`
  const lines = [
    '# Music map',
    '',
    `${reel.bpm} BPM, ${reel.bars} bars of ${reel.beatsPerBar} beats, ${reel.lengthSec} s${keyText}${reel.music ? '' : ' (no music: a steady grid)'}.`,
    'Beats are reel beat numbers (what `beat(n)` takes; fractions are parts of a beat). Accents: melody notes of strength 0.8 and up.',
    `Sections: ${events.sections.map(sectionText).join(', ')}.`,
    '',
  ]
  const starts = new Set<MusicSection>()
  for (let b = 0; b < reel.bars; b++) {
    const from = reel.downbeats[b] ?? b * reel.beatsPerBar * (60 / reel.bpm)
    const to = reel.downbeats[b + 1] ?? reel.lengthSec
    for (const s of events.sections)
      if (!starts.has(s) && s.startSec < to - 0.001) {
        starts.add(s)
        lines.push(`== ${s.name} starts ==`)
      }
    lines.push(barLine(reel, b, from, to))
  }
  return `${lines.join('\n')}\n`
}

/** One bar of the music map. */
function barLine(
  reel: Pick<ReelJson, 'beats' | 'beatsPerBar' | 'bpm' | 'events'>,
  b: number,
  from: number,
  to: number,
): string {
  const { events } = reel
  const inBar = (t: number) => t >= from - 0.001 && t < to - 0.001
  const at = (t: number) => fmt(beatNumber(reel.beats, reel.bpm, t))
  const section = events.sections.find((s) => s.startSec <= from + 0.001 && from < s.endSec - 0.001)
  const first = b * reel.beatsPerBar
  const parts = [
    `bar ${b + 1} (beats ${first}-${first + reel.beatsPerBar - 1}) ${section?.name ?? 'groove'}, energy ${section?.energy ?? 2}`,
  ]
  const list = (label: string, times: number[]) => {
    if (times.length) parts.push(`${label} ${times.map(at).join(' ')}`)
  }
  list('kicks', events.kicks.filter(inBar))
  list('snares', events.snares.filter(inBar))
  const melody = events.melody.filter((m) => inBar(m.t))
  if (melody.length) {
    const accents = melody.filter((m) => m.strength >= 0.8).map((m) => at(m.t))
    const accentText = accents.length ? ` (accents ${accents.join(' ')})` : ''
    parts.push(`melody ${melody.map((m) => at(m.t)).join(' ')}${accentText}`)
  }
  const chords = events.chords.filter(inBar)
  if (chords.length === 1 && Math.abs((chords[0] ?? 0) - from) < 0.02) parts.push('chord change')
  else if (chords.length) parts.push(`chord changes ${chords.map(at).join(' ')}`)
  return parts.join(' | ')
}

/** The reel beat number of a time: between detected beats by interpolation, past them at the tempo. */
function beatNumber(beats: number[], bpm: number, t: number): number {
  const beatSec = 60 / bpm
  const first = beats[0]
  const last = beats.at(-1)
  if (first === undefined || last === undefined) return t / beatSec
  if (t < first) return (t - first) / beatSec
  if (t >= last) return beats.length - 1 + (t - last) / beatSec
  let i = 0
  while ((beats[i + 1] ?? Infinity) <= t) i++
  const a = beats[i] ?? 0
  const span = (beats[i + 1] ?? a + beatSec) - a
  return i + (t - a) / span
}

/** The strongest `DRUMS_PER_BEAT` hits of each beat, as sorted, unique times. */
function capPerBeat(hits: Hit[], beats: number[]): number[] {
  const byBeat = new Map<number, Hit[]>()
  for (const h of hits) {
    const index = beatIndex(beats, h.t)
    byBeat.set(index, [...(byBeat.get(index) ?? []), h])
  }
  const kept = [...byBeat.values()].flatMap((group) =>
    group.sort((a, b) => b.s - a.s).slice(0, DRUMS_PER_BEAT),
  )
  return [...new Set(kept.map((h) => round3(h.t)))].sort((a, b) => a - b)
}

/** Which beat a time falls in (a little early counts as the beat: hits lead it slightly). */
function beatIndex(beats: number[], t: number): number {
  let lo = 0
  let hi = beats.length - 1
  if (hi < 0 || t < (beats[0] ?? 0) - 0.01) return -1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if ((beats[mid] ?? 0) - 0.01 <= t) lo = mid
    else hi = mid - 1
  }
  return lo
}

/** One melody note per time (the strongest). */
function dedupeMelody(
  melody: { strength: number; t: number }[],
): { strength: number; t: number }[] {
  const out: { strength: number; t: number }[] = []
  for (const m of melody) {
    const last = out.at(-1)
    if (last && last.t === m.t) last.strength = Math.max(last.strength, m.strength)
    else out.push({ ...m })
  }
  return out
}

/**
 * Where the harmony moves: each half bar's pitch-class profile matched against the 24 major and
 * minor triads; a change where the best triad differs from the last one and fits clearly better
 * than it (so a melody passing over one chord doesn't read as a change). The first sounding half
 * bar starts the first chord.
 */
function findChordChanges(
  features: Features,
  grid: Pick<BeatGrid, 'beats' | 'downbeats' | 'durationSec'>,
  samples: Float32Array,
  sampleRate: number,
): number[] {
  const halves = halfBars(grid)
  const loud = rmsDb(samples, 0, samples.length)
  const changes: number[] = []
  let chord = -1
  for (let i = 0; i < halves.length; i++) {
    const from = halves[i] ?? 0
    const to = halves[i + 1] ?? grid.durationSec
    const quiet =
      rmsDb(samples, Math.floor(from * sampleRate), Math.floor(to * sampleRate)) < loud - 30
    const profile = quiet ? null : chromaProfile(features, from, to)
    if (!profile) {
      chord = -1
      continue
    }
    const fits = TRIADS.map((t) => cosine(profile, t))
    const best = fits.indexOf(Math.max(...fits))
    if (chord < 0 || (best !== chord && (fits[best] ?? 0) - (fits[chord] ?? 0) >= CHORD_MARGIN)) {
      changes.push(from)
      chord = best
    }
  }
  return changes
}

/** How much better (cosine) a half bar must fit a new triad than the current one to change chord. */
const CHORD_MARGIN = 0.08

/** The 24 triads as pitch-class templates: 12 major (root, major third, fifth), then 12 minor. */
const TRIADS: Float64Array[] = Array.from({ length: 24 }, (_, i) => {
  const root = i % 12
  const template = new Float64Array(12)
  for (const step of [0, i < 12 ? 4 : 3, 7]) template[(root + step) % 12] = 1
  return template
})

/**
 * Melody note starts: pitched onsets in the lead's range at least an eighth apart (a sixteenth at
 * peak energy), strength from the onset's size against the track's own strong notes.
 */
function findMelody(
  features: Features,
  steps: number[],
  sections: MusicSection[],
  beatSec: number,
): { strength: number; t: number }[] {
  const picked = pickOnsets(features.melodic, features.frameRate, { gapSec: beatSec / 4, k: 1.2 })
    .filter((p) => isTonal(features, p.f))
    .map((p) => ({ s: p.s, t: snapNear(steps, p.f / features.frameRate + ONSET_LAG_SEC) }))
  // Thin to an eighth apart outside peak sections (the stronger note of a close pair wins).
  const kept: Hit[] = []
  for (const p of picked) {
    const energy = sections.find((s) => p.t >= s.startSec && p.t < s.endSec)?.energy ?? 2
    const gap = (energy >= 3 ? beatSec / 4 : beatSec / 2) - 0.01
    const last = kept.at(-1)
    if (last && p.t - last.t < gap) {
      if (p.s > last.s) kept[kept.length - 1] = p
    } else kept.push(p)
  }
  // Strength against the strong notes of the same phrase (the section, two bars either side), not
  // the whole track: a sparse, loud intro must not leave a busy drop without accents.
  const sectionOf = (t: number) => sections.findIndex((s) => t >= s.startSec && t < s.endSec)
  return kept.map((p) => {
    const section = sectionOf(p.t)
    const same = kept.filter((q) => sectionOf(q.t) === section)
    const near = same.filter((q) => Math.abs(q.t - p.t) <= MELODY_PHRASE_BEATS * beatSec)
    const phrase = near.length >= 4 ? near : same
    const top =
      percentile(
        phrase.map((q) => q.s).sort((a, b) => a - b),
        0.9,
      ) || 1
    return { strength: Math.min(1, p.s / top), t: p.t }
  })
}

/** How far either side (beats) a melody note's phrase reaches when its strength is measured. */
const MELODY_PHRASE_BEATS = 8

/**
 * The music's sections from bar loudness: each bar's level in dB against the track's loud bars
 * (four levels), merged into runs of two bars or more (a one-bar run stays when it stands two
 * levels apart from its neighbours, like a stop), then named by shape. A run longer than eight
 * bars is split where its texture changes most (a new part at the same loudness).
 */
function findSections(
  samples: Float32Array,
  sampleRate: number,
  features: Features,
  grid: Pick<BeatGrid, 'downbeats' | 'durationSec'>,
  kicks: Hit[],
): MusicSection[] {
  const bars = barSpans(grid)
  if (!bars.length) return emptyEvents(grid.durationSec).sections
  const db = bars.map(([from, to]) =>
    rmsDb(samples, Math.floor(from * sampleRate), Math.floor(to * sampleRate)),
  )
  const sorted = [...db].sort((a, b) => a - b)
  const high = percentile(sorted, 0.9)
  const step = Math.max(SECTION_MIN_SPREAD_DB, high - percentile(sorted, 0.1)) / 4
  const levels = db.map((v) => clampLevel(3 - Math.floor(Math.max(0, high - v) / step)))
  const runs = mergeRuns(levels)
  const profiles = bars.map(([from, to]) => textureProfile(features, from, to))
  return runs.flatMap((run, i) => {
    const runStart = (bars[run.from] as [number, number])[0]
    const runEnd = (bars[run.to - 1] as [number, number])[1]
    const drums = kicks.some((k) => k.t >= runStart && k.t < runEnd)
    const name = sectionName(runs, i, db, drums)
    // The later parts of a long drop are the groove it settles into.
    return splitLongRun(run, profiles).map(([from, to], k) => ({
      endSec: (bars[to - 1] as [number, number])[1],
      energy: run.level,
      name: k > 0 && name === 'drop' ? 'groove' : name,
      startSec: (bars[from] as [number, number])[0],
    }))
  })
}

/** The longest a section runs (bars) before it is split where its texture changes. */
const SECTION_MAX_BARS = 8
/** The fewest bars each side of a texture split. */
const SECTION_SPLIT_BARS = 4

/**
 * A run's bar spans `[from, to)`, split while longer than `SECTION_MAX_BARS`: at the bar (at
 * least four from either end) where the four bars after it sound most unlike the four before,
 * a four-bar phrase boundary winning a near tie.
 */
function splitLongRun(run: Run, profiles: number[][]): [number, number][] {
  if (run.to - run.from <= SECTION_MAX_BARS) return [[run.from, run.to]]
  let best = -1
  let bestScore = -Infinity
  for (let b = run.from + SECTION_SPLIT_BARS; b <= run.to - SECTION_SPLIT_BARS; b++) {
    const change = textureDistance(
      profiles.slice(b - SECTION_SPLIT_BARS, b),
      profiles.slice(b, b + SECTION_SPLIT_BARS),
    )
    const score = change + ((b - run.from) % SECTION_SPLIT_BARS === 0 ? 0.3 : 0)
    if (score > bestScore) {
      best = b
      bestScore = score
    }
  }
  return [
    ...splitLongRun({ ...run, to: best }, profiles),
    ...splitLongRun({ ...run, from: best }, profiles),
  ]
}

/** A stretch's texture: each band's level (dB) less the stretch's mean level, so loudness is out. */
function textureProfile(features: Features, from: number, to: number): number[] {
  const a = Math.max(0, Math.floor(from * features.frameRate))
  const b = Math.min(features.frames, Math.ceil(to * features.frameRate))
  const levels = Array.from({ length: TEXTURE_BANDS }, (_, band) => {
    let sum = 0
    for (let f = a; f < b; f++) sum += features.texture[f * TEXTURE_BANDS + band] ?? 0
    return 10 * Math.log10(sum / Math.max(1, b - a) + 1e-9)
  })
  const mean = levels.reduce((total, v) => total + v, 0) / TEXTURE_BANDS
  return levels.map((v) => v - mean)
}

/** How unlike two runs of bars sound: the RMS difference (dB) of their mean textures. */
function textureDistance(a: number[][], b: number[][]): number {
  const mean = (rows: number[][], band: number) =>
    rows.reduce((total, row) => total + (row[band] ?? 0), 0) / Math.max(1, rows.length)
  let sum = 0
  for (let band = 0; band < TEXTURE_BANDS; band++) sum += (mean(a, band) - mean(b, band)) ** 2
  return Math.sqrt(sum / TEXTURE_BANDS)
}

/** The least spread (dB) the four energy levels are cut from, so a level track isn't over-split. */
const SECTION_MIN_SPREAD_DB = 8

type Run = { from: number; level: 0 | 1 | 2 | 3; to: number }

/** Runs of equal level, short ones folded into their nearest neighbour. */
function mergeRuns(levels: (0 | 1 | 2 | 3)[]): Run[] {
  let runs: Run[] = []
  levels.forEach((level, i) => {
    const last = runs.at(-1)
    if (last && last.level === level) last.to = i + 1
    else runs.push({ from: i, level, to: i + 1 })
  })
  // A one-bar run stays when it is a dip of two levels or more (a stop, a one-bar intro), or the
  // final hit: the last bar two levels above the one before.
  const keeps = (r: Run, i: number) => {
    if (r.to - r.from >= 2) return true
    const before = runs[i - 1]
    const after = runs[i + 1]
    if (before && !after && r.level - before.level >= 2) return true
    const around = [before, after].filter((n): n is Run => !!n)
    return around.length > 0 && around.every((n) => n.level - r.level >= 2)
  }
  for (;;) {
    const i = runs.findIndex((r, k) => !keeps(r, k))
    if (i === -1 || runs.length < 2) break
    const r = runs[i] as Run
    const before = runs[i - 1]
    const after = runs[i + 1]
    const into =
      before && (!after || Math.abs(before.level - r.level) <= Math.abs(after.level - r.level))
        ? before
        : (after as Run)
    into.from = Math.min(into.from, r.from)
    into.to = Math.max(into.to, r.to)
    runs.splice(i, 1)
    // Neighbours that now share a level are one run.
    runs = runs.reduce<Run[]>((out, x) => {
      const last = out.at(-1)
      if (last && last.level === x.level) last.to = x.to
      else out.push({ ...x })
      return out
    }, [])
  }
  return runs
}

/** A section's name from its shape: intro, drop (or the final hit), break/stop (a stop is one
 *  bar, or has no kick), outro, build or groove. */
function sectionName(runs: Run[], i: number, db: number[], kicks: boolean): string {
  const r = runs[i] as Run
  const before = runs[i - 1]
  const after = runs[i + 1]
  const bars = r.to - r.from
  if (!before && after && r.level < after.level) return 'intro'
  if (before && r.level - before.level >= 2) return !after && bars === 1 ? 'final hit' : 'drop'
  if (before && after && r.level < before.level && r.level < after.level && bars <= 4)
    return bars === 1 || !kicks ? 'stop' : 'break'
  if (before && !after && r.level < before.level) return 'outro'
  // A build climbs: bar by bar inside the run, or a step between a lower run and a higher one.
  const rising =
    (bars >= 2 && db.slice(r.from + 1, r.to).every((v, k) => v > (db[r.from + k] ?? 0) + 0.5)) ||
    (before !== undefined && before.level < r.level && bars <= 4)
  return rising && after && after.level > r.level ? 'build' : 'groove'
}

/** Bar spans (seconds) from the bar starts; a pickup before the first one joins the first bar. */
function barSpans(grid: Pick<BeatGrid, 'downbeats' | 'durationSec'>): [number, number][] {
  const starts = grid.downbeats.filter((d) => d < grid.durationSec - 0.05)
  if (!starts.length) return grid.durationSec > 0 ? [[0, grid.durationSec]] : []
  const spans = starts.map((d, i): [number, number] => [d, starts[i + 1] ?? grid.durationSec])
  ;(spans[0] as [number, number])[0] = 0
  return spans
}

/** The half-bar starts: each bar start and the beat halfway through its bar. */
function halfBars(grid: Pick<BeatGrid, 'beats' | 'downbeats' | 'durationSec'>): number[] {
  const out: number[] = []
  for (const d of grid.downbeats) {
    out.push(d)
    const i = grid.beats.findIndex((b) => Math.abs(b - d) < 0.002)
    const middle = i === -1 ? undefined : grid.beats[i + 2]
    if (middle !== undefined) out.push(middle)
  }
  return out.filter((t) => t < grid.durationSec).sort((a, b) => a - b)
}

/** The mean pitch-class profile between two times, with its common floor taken off; null when flat. */
function chromaProfile(features: Features, from: number, to: number): Float64Array | null {
  const a = Math.max(0, Math.floor(from * features.frameRate))
  const b = Math.min(features.frames, Math.ceil(to * features.frameRate))
  const profile = new Float64Array(12)
  for (let f = a; f < b; f++)
    for (let pc = 0; pc < 12; pc++)
      profile[pc] = (profile[pc] ?? 0) + (features.chroma[f * 12 + pc] ?? 0)
  const floor = Math.min(...profile)
  let size = 0
  for (let pc = 0; pc < 12; pc++) {
    profile[pc] = (profile[pc] ?? 0) - floor
    size += (profile[pc] ?? 0) ** 2
  }
  return size > 0 ? profile : null
}

function cosine(a: Float64Array, b: Float64Array): number {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += (a[i] ?? 0) * (b[i] ?? 0)
    na += (a[i] ?? 0) ** 2
    nb += (b[i] ?? 0) ** 2
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}

/**
 * The low onsets that are kicks: the ones whose low-end power is near the loudest low hit in the
 * bar before (looking back only, so the quiet kicks before a drop still count). A bass note under
 * the groove starts quieter than the kick; a snare's body hardly reaches the low band. Their
 * strength is that power.
 */
function loudLowHits(
  features: Features,
  lookBackSec: number,
  onsets: { f: number; s: number }[],
): { f: number; s: number }[] {
  const power = onsets.map(({ f }) => {
    let peak = 0
    for (let g = f; g <= f + 3; g++) peak = Math.max(peak, features.lowPower[g] ?? 0)
    return peak
  })
  const radius = lookBackSec * features.frameRate
  return onsets.flatMap((o, i) => {
    let top = 0
    onsets.forEach((p, j) => {
      if (p.f <= o.f && o.f - p.f <= radius) top = Math.max(top, power[j] ?? 0)
    })
    return (power[i] ?? 0) >= KICK_OF_LOUDEST * top ? [{ f: o.f, s: power[i] ?? 0 }] : []
  })
}

/** How loud (low-end power, against the loudest low hit nearby) a low onset must be to be a kick. */
const KICK_OF_LOUDEST = 0.3

/**
 * Snares and claps: noisy onsets in 150 Hz-5 kHz. A kick's own attack is a click that is noisy
 * too, so an onset on a kick counts only when it is as noisy as the track's snares away from the
 * kicks (a clap layered on the kick), not just the kick's click.
 */
function findSnares(
  features: Features,
  kickFrames: number[],
  beatSec: number,
  threshold: number,
): { f: number; s: number }[] {
  const noisy = pickOnsets(features.mid, features.frameRate, { gapSec: beatSec / 4, k: 1.5 })
    .map((p) => ({ ...p, flat: peakFlatness(features, p.f) }))
    .filter((p) => p.flat >= threshold)
  const onKick = (f: number) => kickFrames.some((k) => Math.abs(k - f) <= KICK_FRAMES)
  const away = noisy.filter((p) => !onKick(p.f))
  const flat = percentile(
    away.map((p) => p.flat).sort((a, b) => a - b),
    0.5,
  )
  return noisy.filter((p) => !onKick(p.f) || p.flat >= flat).map(({ f, s }) => ({ f, s }))
}

/** A mid-band onset this many frames (about 12 ms each) from a kick is on the kick. */
const KICK_FRAMES = 2

/** The highest spectral flatness (150 Hz-5 kHz) in the frames of an onset's attack. */
function peakFlatness(features: Features, f: number): number {
  let flat = 0
  for (let g = f; g <= f + 2; g++) flat = Math.max(flat, features.flatness[g] ?? 0)
  return flat
}

/** The least spectral flatness (150 Hz-5 kHz) a snare's attack reaches, and how far above the
 *  track's median flatness it must be. */
const SNARE_FLATNESS = 0.08
const SNARE_OVER_MEDIAN = 1.3

/** Does a clear note ring just after frame `f` (the lead's range is tonal, not noise)? */
function isTonal(features: Features, f: number): boolean {
  let flat = 1
  for (let g = f; g <= f + 4; g++) flat = Math.min(flat, features.tonal[g] ?? 1)
  return flat <= MELODY_FLATNESS
}

/** The most spectral flatness (300 Hz-3 kHz) a melody note's ring may have. */
const MELODY_FLATNESS = 0.25

function isLocalPeak(curve: Float32Array, f: number, radius: number): boolean {
  const value = curve[f] ?? 0
  for (let g = Math.max(0, f - radius); g <= Math.min(curve.length - 1, f + radius); g++)
    if (g !== f && ((curve[g] ?? 0) > value || ((curve[g] ?? 0) === value && g < f))) return false
  return true
}

/**
 * Onsets in a flux curve: local peaks above an adaptive threshold (the local median plus `k`
 * times the local spread, and a floor against silence), at least `gapSec` apart (the stronger of
 * a close pair wins).
 */
function pickOnsets(
  curve: Float32Array,
  frameRate: number,
  o: { gapSec: number; k: number },
): { f: number; s: number }[] {
  const radius = Math.max(4, Math.round(frameRate * 0.5))
  let max = 0
  for (const v of curve) max = Math.max(max, v)
  const floor = max * 0.06
  const gap = Math.max(1, Math.round(o.gapSec * frameRate) - 1)
  const out: { f: number; s: number }[] = []
  const window: number[] = []
  for (let f = 0; f < curve.length; f++) {
    const value = curve[f] ?? 0
    if (value <= floor || !isLocalPeak(curve, f, 2)) continue
    window.length = 0
    for (let g = Math.max(0, f - radius); g <= Math.min(curve.length - 1, f + radius); g++)
      window.push(curve[g] ?? 0)
    window.sort((a, b) => a - b)
    const median = percentile(window, 0.5)
    const spread = percentile(window, 0.8) - percentile(window, 0.2)
    if (value < median + o.k * spread) continue
    const last = out.at(-1)
    if (last && f - last.f <= gap) {
      if (value > last.s) out[out.length - 1] = { f, s: value }
    } else out.push({ f, s: value })
  }
  return out
}

/** One STFT pass over the track: the per-frame features every finder above uses. */
function spectralFeatures(samples: Float32Array, sampleRate: number): Features {
  const frameRate = sampleRate / HOP
  const frames = samples.length < FFT_SIZE ? 0 : Math.floor((samples.length - FFT_SIZE) / HOP) + 1
  const bin = (hz: number) => Math.max(1, Math.round((hz / sampleRate) * FFT_SIZE))
  const bands = {
    low: bin(120),
    mid: bin(150),
    melodyHi: bin(3000),
    melodyLo: bin(300),
    midHi: Math.min(FFT_SIZE / 2 - 1, bin(5000)),
    texture: TEXTURE_EDGES.map((hz) => Math.min(FFT_SIZE / 2, bin(hz))),
  }
  const features: Features = {
    chroma: new Float32Array(frames * 12),
    flatness: new Float32Array(frames),
    frameRate,
    frames,
    low: new Float32Array(frames),
    lowPower: new Float32Array(frames),
    melodic: new Float32Array(frames),
    mid: new Float32Array(frames),
    texture: new Float32Array(frames * TEXTURE_BANDS),
    tonal: new Float32Array(frames),
  }
  const pitchClass = chromaBins(sampleRate)
  const window = hann(FFT_SIZE)
  const re = new Float64Array(FFT_SIZE)
  const im = new Float64Array(FFT_SIZE)
  const magnitude = new Float64Array(FFT_SIZE / 2)
  let previous = new Float64Array(FFT_SIZE / 2)
  let current = new Float64Array(FFT_SIZE / 2)
  for (let f = 0; f < frames; f++) {
    const offset = f * HOP
    for (let i = 0; i < FFT_SIZE; i++) {
      re[i] = (samples[offset + i] ?? 0) * (window[i] ?? 0)
      im[i] = 0
    }
    fft(re, im)
    for (let k = 0; k < FFT_SIZE / 2; k++) {
      magnitude[k] = Math.hypot(re[k] ?? 0, im[k] ?? 0)
      current[k] = Math.log1p(10 * (magnitude[k] ?? 0))
    }
    frameFeatures(features, f, { bands, current, magnitude, pitchClass, previous })
    ;[previous, current] = [current, previous]
  }
  return features
}

/** One frame's features (fluxes against the frame before, flatness, chroma). */
function frameFeatures(
  features: Features,
  f: number,
  o: {
    bands: {
      low: number
      melodyHi: number
      melodyLo: number
      mid: number
      midHi: number
      texture: number[]
    }
    current: Float64Array
    magnitude: Float64Array
    pitchClass: Int8Array
    previous: Float64Array
  },
): void {
  const { bands, current, magnitude, pitchClass, previous } = o
  // The first frame rises from silence, so a hit on the track's first sample counts.
  const rise = (k: number) => Math.max(0, (current[k] ?? 0) - (previous[k] ?? 0))
  let low = 0
  let lowPower = 0
  for (let k = 1; k < bands.low; k++) {
    low += rise(k)
    lowPower += (magnitude[k] ?? 0) ** 2
  }
  features.lowPower[f] = lowPower
  let mid = 0
  for (let k = bands.mid; k <= bands.midHi; k++) mid += rise(k)
  // Pitched starts: only the bins that stand out as clear peaks in this frame.
  let bandMean = 0
  for (let k = bands.melodyLo; k <= bands.melodyHi; k++) bandMean += magnitude[k] ?? 0
  bandMean /= bands.melodyHi - bands.melodyLo + 1
  let melodic = 0
  for (let k = bands.melodyLo; k <= bands.melodyHi; k++) {
    const m = magnitude[k] ?? 0
    if (m > 3 * bandMean && m >= (magnitude[k - 1] ?? 0) && m >= (magnitude[k + 1] ?? 0))
      melodic += rise(k) + rise(k - 1) + rise(k + 1)
  }
  for (let k = 0; k < pitchClass.length; k++) {
    const pc = pitchClass[k] ?? -1
    if (pc >= 0)
      features.chroma[f * 12 + pc] = (features.chroma[f * 12 + pc] ?? 0) + (magnitude[k] ?? 0)
  }
  for (let band = 0; band < TEXTURE_BANDS; band++) {
    let power = 0
    for (let k = bands.texture[band] ?? 0; k < (bands.texture[band + 1] ?? 0); k++)
      power += (magnitude[k] ?? 0) ** 2
    features.texture[f * TEXTURE_BANDS + band] = power
  }
  features.low[f] = low
  features.mid[f] = mid
  features.melodic[f] = melodic
  features.flatness[f] = flatnessOf(magnitude, bands.mid, bands.midHi)
  features.tonal[f] = flatnessOf(magnitude, bands.melodyLo, bands.melodyHi)
}

/** Spectral flatness (geometric over arithmetic mean of the power) of bins `from..to`. */
function flatnessOf(magnitude: Float64Array, from: number, to: number): number {
  let logSum = 0
  let sum = 0
  for (let k = from; k <= to; k++) {
    const power = (magnitude[k] ?? 0) ** 2 + 1e-12
    logSum += Math.log(power)
    sum += power
  }
  const n = to - from + 1
  return sum > n * 1e-11 ? Math.exp(logSum / n) / (sum / n) : 1
}

/** Each FFT bin's pitch class between 200 Hz and 2.5 kHz (-1 outside it). */
function chromaBins(sampleRate: number): Int8Array {
  const out = new Int8Array(FFT_SIZE / 2).fill(-1)
  for (let k = 1; k < FFT_SIZE / 2; k++) {
    const hz = (k * sampleRate) / FFT_SIZE
    if (hz < 200 || hz > 2500) continue
    const midi = 69 + 12 * Math.log2(hz / 440)
    out[k] = ((Math.round(midi) % 12) + 12) % 12
  }
  return out
}

function nearest(sorted: number[], t: number): number | undefined {
  let best: number | undefined
  for (const v of sorted) if (best === undefined || Math.abs(v - t) < Math.abs(best - t)) best = v
  return best
}

function percentile(sorted: ArrayLike<number>, p: number): number {
  if (!sorted.length) return 0
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))))] ?? 0
}

function rmsDb(samples: Float32Array, from: number, to: number): number {
  let sum = 0
  const a = Math.max(0, from)
  const b = Math.min(samples.length, to)
  for (let i = a; i < b; i++) sum += (samples[i] ?? 0) ** 2
  return 10 * Math.log10((b > a ? sum / (b - a) : 0) + 1e-12)
}

/** Every sixteenth of the grid: four per beat, continued at the tempo before and after the beats. */
function sixteenths(beats: number[], durationSec: number): number[] {
  if (beats.length < 2) return []
  const period = ((beats.at(-1) ?? 0) - (beats[0] ?? 0)) / (beats.length - 1)
  const out: number[] = []
  for (let t = (beats[0] ?? 0) - period; t > -period / 4; t -= period / 4) out.unshift(t)
  for (let i = 0; i < beats.length; i++) {
    const a = beats[i] ?? 0
    const span = (beats[i + 1] ?? a + period) - a
    for (let q = 0; q < 4; q++) out.push(a + (q * span) / 4)
  }
  for (let t = (beats.at(-1) ?? 0) + period; t <= durationSec; t += period / 4) out.push(t)
  return out.filter((t) => t >= 0)
}

/** A time on the nearest sixteenth when it is within `SNAP_SEC` of one. */
function snapNear(steps: number[], t: number): number {
  const step = nearest(steps, t)
  return step !== undefined && Math.abs(step - t) <= SNAP_SEC ? step : t
}

const clampLevel = (v: number) => Math.max(0, Math.min(3, v)) as 0 | 1 | 2 | 3

/** A beat number for the map: at most two decimals, no trailing zeros. */
const fmt = (v: number) => String(Math.round(v * 100) / 100)

const round3 = (value: number) => Math.round(value * 1000) / 1000
