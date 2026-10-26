/**
 * A Motion Reel's music written as a score, rendered here in plain TypeScript (no audio library):
 * the agent plans the reel in bars, so it writes the music in bars too and every hit lands where
 * it put it. One electronic voice set (kick, snare, hats, crash, sub bass, triad pad, pluck lead,
 * arpeggio, riser, sub boom) played from the score's sections, groove and hits.
 *
 * Harmony rules, enforced and checked (`checkHarmony`): every chord is a major or minor triad
 * from a diatonic loop; every pitched note that starts on a beat is a chord tone; no two sounding
 * notes form a minor second, a major seventh or a tritone. Passing tones only off the beat, from
 * the key's pentatonic. Deterministic: the same score and seed give the same samples.
 *
 * Ported from the motion-designer skill's synth_score.py (numpy), with biquad filters and an
 * algorithmic reverb in place of its FFT filtering and convolution.
 */

import type { MusicEvents } from './beat-grid'
import { tidyEvents } from './music-events'

export const SCORE_SAMPLE_RATE = 48000
const SR = SCORE_SAMPLE_RATE

export type ScoreGroove = 'backbeat' | 'four' | 'half'
export type ScoreHitKind = 'crash' | 'hit' | 'stab'
export type ScoreMode = 'major' | 'minor'

/** A stretch of bars at one energy: 0 ambient, 1 light, 2 full, 3 peak. "stop" drops drums and
 *  bass (a held chord), "break" is light texture, "drop" brings the band back after a riser. */
export type ScoreSection = { bars: number; energy: 0 | 1 | 2 | 3; name: string }

/** A Motion Reel's music as the agent writes it: tempo, key, groove, sections and hits. */
export type Score = {
  bpm: number
  groove: ScoreGroove
  hits: ScoreHit[]
  /** The key's root: C, C#, Db ... B. */
  key: string
  mode: ScoreMode
  sections: ScoreSection[]
}

/** An accent on a beat: `bar` and `beat` 1-based (beat may be fractional, e.g. 2.5). */
export type ScoreHit = { bar: number; beat: number; kind: ScoreHitKind }

/** What breaks the harmony rules (none, for a score that renders). */
export type HarmonyIssues = { clash: string[]; offbeat: string[]; triad: string[] }

/** What the rendered score is, in time: everything the reel's grid needs. */
export type ScorePlan = {
  /** Every beat to the end of the music (seconds). */
  beats: number[]
  /** Bar starts, the final hit's bar included (seconds). */
  downbeats: number[]
  durationSec: number
  /** What the music plays when, exactly as written (seconds from the first bar). */
  events: MusicEvents
  /** The final hit: the tonic chord on the downbeat after the score's bars. */
  finalHitSec: number
  /** Section starts, crashes, hits and the final hit, strongest first. */
  strongHits: number[]
}

const PCS: Record<string, number> = {
  A: 9,
  'A#': 10,
  AB: 8,
  B: 11,
  BB: 10,
  C: 0,
  'C#': 1,
  D: 2,
  'D#': 3,
  DB: 1,
  E: 4,
  EB: 3,
  F: 5,
  'F#': 6,
  G: 7,
  'G#': 8,
  GB: 6,
}
const NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B']
/** Diatonic triad loops (semitones above the root, quality): i VI III VII and I V vi IV. */
const PROG: Record<ScoreMode, [number, 'maj' | 'min'][]> = {
  major: [
    [0, 'maj'],
    [7, 'maj'],
    [9, 'min'],
    [5, 'maj'],
  ],
  minor: [
    [0, 'min'],
    [8, 'maj'],
    [3, 'maj'],
    [10, 'maj'],
  ],
}
const PENTA: Record<ScoreMode, number[]> = { major: [0, 2, 4, 7, 9], minor: [0, 3, 5, 7, 10] }

/** The pitch class of a key name (`A`, `F#`, `Bb`), or null. */
export function keyRoot(name: string): null | number {
  const m = /^([A-Ga-g])([#b♯♭]?)$/.exec(name.trim())
  if (!m) return null
  const acc = { '#': '#', '♯': '#', b: 'B', '♭': 'B', '': '' }[m[2] ?? ''] ?? ''
  return PCS[`${(m[1] ?? '').toUpperCase()}${acc}`] ?? null
}

/** Bar-sized pieces of a score, the reel's way of counting: the score's bars, then one more bar
 *  for the final hit and its ring-out. */
export function scoreBars(score: Pick<Score, 'sections'>): number {
  return score.sections.reduce((sum, s) => sum + s.bars, 0)
}

const hz = (midi: number) => 440 * 2 ** ((midi - 69) / 12)

type Rng = ReturnType<typeof rng>
/** A deterministic random source (mulberry32), with normal samples by Box-Muller. */
function rng(seed: number) {
  let a = seed >>> 0
  const uniform = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  return {
    normal: () => {
      const u = Math.max(uniform(), 1e-12)
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * uniform())
    },
  }
}

const samplesOf = (sec: number) => Math.max(1, Math.round(sec * SR))

/** A second-order section (RBJ cookbook), run in place. */
function biquad(x: Float32Array, kind: 'high' | 'low', freq: number): void {
  const w = (2 * Math.PI * Math.min(freq, SR * 0.45)) / SR
  const cos = Math.cos(w)
  const alpha = Math.sin(w) / (2 * Math.SQRT1_2)
  const b0 = kind === 'low' ? (1 - cos) / 2 : (1 + cos) / 2
  const b1 = kind === 'low' ? 1 - cos : -(1 + cos)
  const a0 = 1 + alpha
  const a1 = -2 * cos
  const a2 = 1 - alpha
  let x1 = 0
  let x2 = 0
  let y1 = 0
  let y2 = 0
  for (let i = 0; i < x.length; i++) {
    const x0 = x[i] as number
    const y0 = (b0 * x0 + b1 * x1 + b0 * x2 - a1 * y1 - a2 * y2) / a0
    x2 = x1
    x1 = x0
    y2 = y1
    y1 = y0
    x[i] = y0
  }
}

/** A sound to mix: mono, or a stereo pair. */
type Sound = [Float32Array, Float32Array] | Float32Array

class Mix {
  readonly dry: [Float32Array, Float32Array]
  level = 1
  readonly send: [Float32Array, Float32Array]
  constructor(
    readonly n: number,
    readonly r: Rng,
  ) {
    this.dry = [new Float32Array(n), new Float32Array(n)]
    this.send = [new Float32Array(n), new Float32Array(n)]
  }
  add(x: Sound, t: number, o: { gain?: number; pan?: number; verb?: number } = {}): void {
    const gain = (o.gain ?? 1) * this.level
    const a = ((o.pan ?? 0) + 1) * (Math.PI / 4)
    const [l, rr] = Array.isArray(x) ? x : [x, x]
    const [gl, gr] = Array.isArray(x) ? [gain, gain] : [gain * Math.cos(a), gain * Math.sin(a)]
    let pos = Math.round(t * SR)
    let from = 0
    if (pos < 0) {
      from = -pos
      pos = 0
    }
    const len = Math.min(l.length - from, this.n - pos)
    for (let i = 0; i < len; i++) {
      const vl = (l[from + i] as number) * gl
      const vr = (rr[from + i] as number) * gr
      this.dry[0][pos + i] = (this.dry[0][pos + i] as number) + vl
      this.dry[1][pos + i] = (this.dry[1][pos + i] as number) + vr
      if (o.verb) {
        this.send[0][pos + i] = (this.send[0][pos + i] as number) + vl * o.verb
        this.send[1][pos + i] = (this.send[1][pos + i] as number) + vr * o.verb
      }
    }
  }
}

/** Noise band-passed to [lo, hi] Hz, at unit RMS. */
function band(r: Rng, n: number, lo: number, hi: number): Float32Array {
  const x = new Float32Array(n)
  for (let i = 0; i < n; i++) x[i] = r.normal()
  biquad(x, 'high', lo)
  biquad(x, 'high', lo)
  biquad(x, 'low', hi)
  biquad(x, 'low', hi)
  let sum = 0
  for (let i = 0; i < n; i++) sum += (x[i] as number) ** 2
  const rms = Math.sqrt(sum / n) + 1e-9
  for (let i = 0; i < n; i++) x[i] = (x[i] as number) / rms
  return x
}

function bassNote(midi: number, d: number, energy: number): Float32Array {
  const x = tone(midi, d, {
    attack: 0.006,
    bright: 0.7 + 0.2 * energy,
    decay: 1.5,
    harm: 7,
    release: 0.04,
  })
  for (let i = 0; i < x.length; i++) x[i] = Math.tanh(1.3 * (x[i] as number)) * 0.32
  return x
}

function crash(m: Mix, d = 2.2): Float32Array {
  const n = samplesOf(d)
  const x = band(m.r, n, 3500, 16000)
  for (let i = 0; i < n; i++) {
    const t = i / SR
    x[i] = 0.07 * (x[i] as number) * Math.exp(-t * 2.2) * (1 - Math.exp(-t * 900))
  }
  return x
}

function hat(m: Mix, open = false, vel = 1): Float32Array {
  const n = samplesOf(open ? 0.28 : 0.06)
  const x = band(m.r, n, 7000, 18000)
  for (let i = 0; i < n; i++)
    x[i] = 0.045 * (x[i] as number) * Math.exp(-(i / SR) * (open ? 16 : 85)) * vel
  return x
}

function kick(m: Mix, kickHz: number, accent = 1): Float32Array {
  const n = samplesOf(0.45)
  const out = new Float32Array(n)
  let phase = 0
  for (let i = 0; i < n; i++) {
    const t = i / SR
    phase += (kickHz + 110 * Math.exp(-t * 42) + 10 * Math.exp(-t * 8)) / SR
    const body = Math.sin(2 * Math.PI * phase) * Math.exp(-t * 8.5)
    const click = m.r.normal() * Math.exp(-t * 300) * 0.15
    out[i] = Math.tanh((body + click) * 1.6) * 0.62 * accent
  }
  return out
}

function padChord(notes: number[], d: number, bright: number): [Float32Array, Float32Array] {
  const n = samplesOf(d + 0.25)
  const l = new Float32Array(n)
  const r = new Float32Array(n)
  notes.forEach((midi, k) => {
    const x = tone(midi, d, { attack: 0.08, bright, decay: 0, harm: 6, release: 0.25 })
    const g = 0.07 / Math.sqrt(notes.length)
    const shift = 37 + 11 * k
    for (let i = 0; i < n; i++) {
      l[i] = (l[i] as number) + (x[i] as number) * g
      r[i] = (r[i] as number) + (x[(i - shift + n) % n] as number) * g
    }
  })
  return [l, r]
}

function snare(m: Mix, ghost = false): Float32Array {
  const n = samplesOf(0.25)
  const nz = band(m.r, n, 1500, 12000)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const noise = (nz[i] as number) * Math.exp(-t * 22) * (1 - Math.exp(-t * 2000))
    const body =
      (Math.sin(2 * Math.PI * 185 * t) + 0.35 * Math.sin(2 * Math.PI * 330 * t)) * Math.exp(-t * 32)
    out[i] = (0.22 * noise + 0.16 * body) * (ghost ? 0.35 : 1)
  }
  return out
}

function tone(
  midi: number,
  d: number,
  o: { attack?: number; bright?: number; decay?: number; harm?: number; release?: number } = {},
): Float32Array {
  const { attack = 0.004, bright = 1, decay = 0, harm = 6, release = 0.05 } = o
  const n = samplesOf(d + release)
  const f = hz(midi)
  const out = new Float32Array(n)
  for (let h = 1; h <= harm && f * h <= 16000; h++) {
    // A sine rotated sample by sample (no sin per sample), its decay a constant factor.
    const w = (2 * Math.PI * f * h) / SR
    const step = Math.exp(-(decay + (h * 1.2) / bright) / SR)
    const cw = Math.cos(w)
    const sw = Math.sin(w)
    let s = Math.sin(0.3 * h)
    let c = Math.cos(0.3 * h)
    let amp = 1 / h ** 1.6
    for (let i = 0; i < n; i++) {
      out[i] = (out[i] as number) + s * amp
      const s2 = s * cw + c * sw
      c = c * cw - s * sw
      s = s2
      amp *= step
    }
  }
  const attackN = attack * SR
  const end = (d + release) * SR
  const releaseN = release * SR
  for (let i = 0; i < n; i++)
    out[i] =
      (out[i] as number) * Math.min(1, i / attackN) * Math.max(0, Math.min(1, (end - i) / releaseN))
  return out
}

const pluck = (midi: number, d: number, bright = 1) =>
  scale(tone(midi, d, { attack: 0.002, bright, decay: 3, harm: 8, release: 0.06 }), 0.16)

type BarInfo = { energy: number; k: number; name: string }

type Chord = { pcs: number[]; q: 'maj' | 'min'; t0: number; t1: number }

type Note = { m: number; t0: number; t1: number; voice: string }

/** A drum hit as played: kick, snare (or clap) or crash, with how loud it is (for the caps). */
type DrumHit = { kind: 'crash' | 'kick' | 'snare'; s: number; t: number }

class Composer {
  readonly bar: number
  readonly bars: BarInfo[] = []
  readonly beat: number
  readonly chords: Chord[] = []
  readonly drums: DrumHit[] = []
  readonly finalT: number
  readonly notes: Note[] = []
  constructor(
    readonly score: Score,
    readonly root: number,
  ) {
    this.beat = 60 / score.bpm
    this.bar = 4 * this.beat
    for (const s of score.sections)
      for (let k = 0; k < s.bars; k++) this.bars.push({ energy: s.energy, k, name: s.name })
    this.finalT = this.bars.length * this.bar
  }
  chordOf(b: number): { pcs: number[]; q: 'maj' | 'min'; r: number } {
    const info = this.bars[b] as BarInfo
    const prog = PROG[this.score.mode]
    // Slower harmony while the texture is light.
    const light = /^(break|stop|intro)/.test(info.name) && info.energy <= 1
    const [deg, q] = prog[light ? Math.floor(info.k / 2) % 2 : info.k % 4] as [
      number,
      'maj' | 'min',
    ]
    const r = (this.root + deg) % 12
    return { pcs: [r, (r + (q === 'min' ? 3 : 4)) % 12, (r + 7) % 12], q, r }
  }
  /** A pentatonic passing tone between two notes that is consonant with the chord. */
  passing(prev: number, next: number, chord: number[], lo: number, hi: number): null | number {
    const penta = PENTA[this.score.mode].map((d) => (this.root + d) % 12)
    const good: number[] = []
    for (let m = lo; m <= hi; m++) {
      if (!penta.includes(m % 12) || chord.includes(m % 12)) continue
      if (chord.every((c) => ![1, 6, 11].includes((((m - c) % 12) + 12) % 12))) good.push(m)
    }
    if (!good.length) return null
    const target = (prev + next) / 2
    return good.reduce(
      (best, m) => (Math.abs(m - target) < Math.abs(best - target) ? m : best),
      good[0] as number,
    )
  }
  /** Each pitch class once, inside [lo, hi]. */
  voiced(pcs: number[], lo: number, hi: number): number[] {
    return pcs
      .map((pc) => {
        const m = lo + ((((pc - lo) % 12) + 12) % 12)
        return m > hi ? m - 12 : m
      })
      .sort((a, b) => a - b)
  }
}
function riser(m: Mix, d: number): Float32Array {
  const n = samplesOf(d)
  const nz = band(m.r, n, 900, 11000)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const ramp = t / d
    const ph = ((2 * Math.PI * 220 * d) / (2 * Math.log(2))) * (2 ** ((2 * t) / d) - 1)
    out[i] = 0.05 * (nz[i] as number) * ramp ** 2.2 + 0.05 * Math.sin(ph) * ramp ** 2 * 0.25
  }
  // Stops dead on the hit.
  const tail = samplesOf(0.006)
  for (let i = 0; i < tail; i++) out[n - tail + i] = (out[n - tail + i] as number) * (1 - i / tail)
  return out
}
function scale(x: Float32Array, g: number): Float32Array {
  for (let i = 0; i < x.length; i++) x[i] = (x[i] as number) * g
  return x
}

function subBoom(midi: number, d = 1.6): Float32Array {
  const n = samplesOf(d)
  const f = hz(midi)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / SR
    const ph = 2 * Math.PI * (f * t + ((2 * f) / 12) * (1 - Math.exp(-12 * t)))
    out[i] = (Math.tanh(1.6 * Math.sin(ph) * Math.exp(-t * 2.2)) / Math.tanh(1.6)) * 0.35
  }
  return out
}

const GROOVES: Record<ScoreGroove, { kick: number[]; kick3: number[]; snare: number[] }> = {
  backbeat: { kick: [0, 8], kick3: [0, 8, 10], snare: [4, 12] },
  four: { kick: [0, 4, 8, 12], kick3: [0, 4, 8, 12], snare: [4, 12] },
  half: { kick: [0], kick3: [0, 10], snare: [8] },
}
const LEVEL = [0.45, 0.6, 0.85, 1]
const MOTIF_A: [number, number, null | number][] = [
  [0, 3, 2],
  [3, 1, null],
  [4, 2, 1],
  [6, 2, null],
  [8, 4, 0],
  [12, 2, 1],
  [14, 2, null],
]
const BASS_FULL: [number, number, number][] = [
  [0, 3, 0],
  [3, 1, 0],
  [6, 2, 7],
  [8, 3, 0],
  [11, 1, 12],
  [14, 2, 7],
]
const BASS_LIGHT: [number, number, number][] = [
  [0, 8, 0],
  [8, 8, 7],
]
const MOTIF_B: [number, number, null | number][] = [
  [0, 4, 0],
  [4, 2, 2],
  [6, 2, null],
  [8, 6, 1],
  [14, 2, null],
]

/** What every part plays with: the composer, the mix and the tuned kick and sub. */
type Band = { c: Composer; kickHz: number; mix: Mix; s16: number; subRoot: number }
/** A bar as the parts play it. */
type BarPlay = { b: number; en: number; info: BarInfo; pcs: number[]; r: number; t0: number }

/** Every voice of every bar, the section entries, the hits and the final hit; answers the strong
 *  moments (seconds), strongest first. */
function compose(c: Composer, mix: Mix, kickHz: number, tailSec: number): number[] {
  const band: Band = {
    c,
    kickHz,
    mix,
    s16: c.beat / 4,
    subRoot: 33 + ((((c.root - 33) % 12) + 12) % 12),
  }
  c.bars.forEach((info, b) => playBar(band, b, info))
  mix.level = 1
  const marks = [...sectionEntries(band), ...accents(band), finalHit(band, tailSec)]
  return marks
    .sort((x, y) => y.strength - x.strength || x.t - y.t)
    .map((m) => Math.round(m.t * 1000) / 1000)
}

/** One bar: its chord, then the drums, bass, lead and arpeggio its energy calls for. */
function playBar(band: Band, b: number, info: BarInfo): void {
  const { c, mix } = band
  const t0 = b * c.bar
  const en = info.energy
  mix.level = LEVEL[en] ?? 1
  const { pcs, q, r } = c.chordOf(b)
  c.chords.push({ pcs, q, t0, t1: t0 + c.bar })
  const stop = info.name.startsWith('stop')
  pad(band, { b, en, info, pcs, r, t0 }, stop)
  if (en === 0 || stop) return
  const bar: BarPlay = { b, en, info, pcs, r, t0 }
  drums(band, bar)
  bass(band, bar)
  if (en >= 2 || info.k % 2 === 0) lead(band, bar)
  if (en >= 3) arpeggio(band, bar)
}

/** The kick pattern of the groove, the snare and a crash on each phrase. */
function drums(band: Band, { en, info, t0 }: BarPlay): void {
  const { c, kickHz, mix, s16 } = band
  const groove = GROOVES[c.score.groove]
  const kicks = en >= 3 ? groove.kick3 : en >= 2 ? groove.kick : [0]
  for (const p of kicks) {
    mix.add(kick(mix, kickHz, p === 0 ? 1 : 0.78), t0 + p * s16, { gain: 0.95 })
    c.drums.push({ kind: 'kick', s: p === 0 ? 1 : 0.78, t: t0 + p * s16 })
  }
  if (en >= 2) {
    // A crash opens every 4-bar phrase.
    if (info.k % 4 === 0) {
      mix.add(crash(mix, 1.6), t0, { gain: 0.6, verb: 0.2 })
      c.drums.push({ kind: 'crash', s: 0.6, t: t0 })
    }
    for (const p of groove.snare) {
      mix.add(snare(mix), t0 + p * s16, { gain: 0.9, verb: 0.12 })
      c.drums.push({ kind: 'snare', s: 0.9, t: t0 + p * s16 })
    }
  }
  hats(band, en, t0)
}

/** Closed hats in eighths (sixteenths at peak), and with the full band an open hat on the and of
 *  4 leading into the next bar (and on every and with a four-on-the-floor groove). */
function hats(band: Band, en: number, t0: number): void {
  const { c, mix, s16 } = band
  if (en >= 2) mix.add(hat(mix, true, 0.7), t0 + 14 * s16, { pan: -0.2 })
  if (en >= 2 && c.score.groove === 'four')
    for (const p of [2, 6, 10, 14]) mix.add(hat(mix, true, 0.6), t0 + p * s16, { pan: -0.25 })
  for (let p = 0; p < 16; p += en >= 3 ? 1 : 2) {
    const vel = p % 4 === 2 ? 1 : p % 2 === 0 ? 0.7 : 0.4
    mix.add(hat(mix, false, vel * (en === 1 ? 0.6 : 1)), t0 + p * s16, { pan: p % 4 ? 0.3 : -0.2 })
  }
}

/** The chord as a pad, ducked on each beat while the band plays. */
function pad(band: Band, { en, pcs, t0 }: BarPlay, stop: boolean): void {
  const { c, mix } = band
  const pv = c.voiced(pcs, 57, 69)
  const chord = padChord(pv, c.bar - 0.02, 0.4 + 0.2 * en)
  if (en >= 2 && !stop)
    for (const ch of chord)
      for (let i = 0; i < ch.length; i++)
        ch[i] = (ch[i] as number) * (0.5 + 0.5 * Math.min(1, ((i / SR) % c.beat) / 0.2) ** 2)
  mix.add(chord, t0, { gain: en ? 1 : 0.8, verb: 0.25 })
  for (const m of pv) c.notes.push({ m, t0, t1: t0 + c.bar, voice: 'chord' })
}

/** Root and fifth only. */
function bass(band: Band, { en, r, t0 }: BarPlay): void {
  const { c, mix, s16 } = band
  const root = 33 + ((((r - 33) % 12) + 12) % 12)
  for (const [p, d, iv] of en >= 2 ? BASS_FULL : BASS_LIGHT) {
    const m = root + iv
    mix.add(bassNote(m, d * s16 * 0.95, en), t0 + p * s16)
    c.notes.push({ m, t0: t0 + p * s16, t1: t0 + (p + d) * s16, voice: 'bass' })
  }
}

/** The motif: chord tones on the beats, passing tones only off them; doubled at peak energy. */
function lead(band: Band, { b, en, pcs, t0 }: BarPlay): void {
  const { c, mix, s16 } = band
  const ct = c.voiced(pcs, 69, 81)
  const seq = (b % 2 === 0 ? MOTIF_A : MOTIF_B).map(([p, d, idx]) => ({
    d,
    m: idx === null ? null : (ct[idx] as number),
    p,
  }))
  seq.forEach((ev, k) => {
    if (ev.m !== null) return
    const prev = (k ? seq[k - 1]?.m : null) ?? (ct[0] as number)
    ev.m = c.passing(prev, seq[k + 1]?.m ?? (ct[0] as number), pcs, 67, 84)
  })
  for (const { d, m, p } of seq) {
    if (m === null) continue
    const at = t0 + p * s16
    const dur = Math.min(d * s16 * 0.9, c.bar - p * s16 - 0.01)
    mix.add(pluck(m, dur, en >= 3 ? 1.2 : 0.9), at, { gain: 0.9, pan: 0.15, verb: 0.3 })
    c.notes.push({ m, t0: at, t1: at + dur, voice: 'lead' })
    if (en < 3) continue
    mix.add(pluck(m + 12, dur, 1), at, { gain: 0.35, pan: -0.3, verb: 0.3 })
    c.notes.push({ m: m + 12, t0: at, t1: at + dur, voice: 'lead8va' })
  }
}

/** A strong moment of the music (seconds), with how strong it is. */
type Mark = { strength: number; t: number }

/** Chord tones in eighths at peak energy; never ringing into the next chord. */
function arpeggio(band: Band, { pcs, t0 }: BarPlay): void {
  const { c, mix, s16 } = band
  const arp = c.voiced(pcs, 76, 88)
  for (let p = 0; p < 16; p += 2) {
    const m = arp[(p / 2) % 3] as number
    const at = t0 + p * s16 + s16
    const d = Math.min(s16 * 1.6, t0 + c.bar - (at + s16) - 0.01)
    if (d <= 0) continue
    mix.add(pluck(m, d, 0.8), at, { gain: 0.28, pan: 0.45 * Math.sin(p), verb: 0.4 })
    c.notes.push({ m, t0: at, t1: at + d, voice: 'arp' })
  }
}

/** A riser, a fill, a crash and a sub boom into every climb of two levels and every drop; a
 *  crash and a sub where the full band comes back. */
function sectionEntries(band: Band): Mark[] {
  const { c, mix, s16, subRoot } = band
  const marks: Mark[] = []
  let b = 0
  let prev: null | number = null
  for (const s of c.score.sections) {
    const t = b * c.bar
    const climb =
      prev !== null && (s.energy - prev >= 2 || (s.name.startsWith('drop') && s.energy > prev))
    if (climb) {
      mix.add(riser(mix, c.bar), t - c.bar, { verb: 0.2 })
      for (let k = 0; k < 4; k++) {
        mix.add(snare(mix, k < 2), t - c.beat + k * s16, { gain: 0.6 + 0.12 * k })
        c.drums.push({ kind: 'snare', s: 0.6 + 0.12 * k, t: t - c.beat + k * s16 })
      }
    }
    if (prev !== null && (climb || (s.energy >= 2 && prev <= 1))) {
      mix.add(crash(mix), t, { verb: 0.3 })
      c.drums.push({ kind: 'crash', s: 1, t })
      mix.add(subBoom(subRoot), t, { gain: 0.8 })
      marks.push({ strength: climb ? 0.9 : 0.7, t })
    }
    prev = s.energy
    b += s.bars
  }
  return marks
}

/** The score's own hits: a crash, a slam (kick, sub and snare) or a chord stab. */
function accents(band: Band): Mark[] {
  const { c, kickHz, mix, subRoot } = band
  return c.score.hits.map((h) => {
    const t = (h.bar - 1) * c.bar + (h.beat - 1) * c.beat
    if (h.kind === 'crash') {
      mix.add(crash(mix), t, { verb: 0.3 })
      mix.add(kick(mix, kickHz), t, { gain: 0.9 })
      c.drums.push({ kind: 'crash', s: 1, t }, { kind: 'kick', s: 1, t })
    } else if (h.kind === 'hit') {
      mix.add(kick(mix, kickHz), t)
      mix.add(subBoom(subRoot, 1), t, { gain: 0.7 })
      mix.add(snare(mix), t, { gain: 0.8, verb: 0.3 })
      c.drums.push({ kind: 'kick', s: 1, t }, { kind: 'snare', s: 1, t })
    } else {
      const { pcs } = c.chordOf(Math.min(c.bars.length - 1, Math.floor(t / c.bar)))
      for (const m of c.voiced(pcs, 64, 76)) {
        const x = scale(tone(m, 0.18, { attack: 0.002, bright: 1.2, decay: 6, harm: 8 }), 0.12)
        mix.add(x, t, { verb: 0.4 })
        c.notes.push({ m, t0: t, t1: t + 0.18, voice: 'stab' })
      }
    }
    return { strength: h.kind === 'stab' ? 0.6 : 0.8, t }
  })
}

/** The tonic triad, a crash and a sub boom on the downbeat after the score, all else stopped. */
function finalHit(band: Band, tailSec: number): Mark {
  const { c, kickHz, mix, subRoot } = band
  const t = c.finalT
  const minor = c.score.mode === 'minor'
  const tonic = [c.root, (c.root + (minor ? 3 : 4)) % 12, (c.root + 7) % 12]
  const ring = Math.max(1, tailSec - 0.2)
  for (const m of [...c.voiced(tonic, 57, 69), ...c.voiced(tonic, 69, 81)]) {
    const x = tone(m, ring, { attack: 0.002, bright: 1, decay: 1.2, harm: 7, release: 0.2 })
    mix.add(scale(x, 0.09), t, { pan: m % 2 ? 0.2 : -0.2, verb: 0.8 })
    c.notes.push({ m, t0: t, t1: t + ring, voice: 'final' })
  }
  mix.add(crash(mix, Math.min(3, tailSec)), t, { gain: 1.3, verb: 0.5 })
  mix.add(kick(mix, kickHz), t)
  c.drums.push({ kind: 'crash', s: 1.3, t }, { kind: 'kick', s: 1, t })
  mix.add(subBoom(subRoot, Math.min(2.5, tailSec)), t)
  mix.add(riser(mix, c.bar / 2), t - c.bar / 2, { gain: 0.8 })
  c.chords.push({ pcs: tonic, q: minor ? 'min' : 'maj', t0: t, t1: t + ring })
  return { strength: 1, t }
}

/** The harmony rules, checked on what was composed. */
function checkHarmony(c: Composer): HarmonyIssues {
  return { clash: clashes(c.notes), offbeat: offbeatTones(c), triad: nonTriads(c.chords) }
}

/** Chords that aren't a major or minor triad. */
function nonTriads(chords: Chord[]): string[] {
  return chords.flatMap((ch) => {
    const iv = ch.pcs
      .map((p) => (((p - (ch.pcs[0] as number)) % 12) + 12) % 12)
      .sort((a, b) => a - b)
    const triad = new Set(ch.pcs).size === 3 && ['0,3,7', '0,4,7'].includes(iv.join(','))
    return triad ? [] : [`${ch.t0.toFixed(2)} s`]
  })
}

/** Notes that start on a beat but aren't a tone of the chord under them. */
function offbeatTones(c: Composer): string[] {
  return c.notes.flatMap((n) => {
    const q = n.t0 / c.beat
    if (Math.abs(q - Math.round(q)) > 1e-6 || n.voice === 'chord' || n.voice === 'final') return []
    const ch = c.chords.find((x) => x.t0 - 1e-6 <= n.t0 && n.t0 < x.t1 - 1e-6)
    return ch && !ch.pcs.includes(n.m % 12)
      ? [`${n.t0.toFixed(2)} s ${n.voice} ${NAMES[n.m % 12]}`]
      : []
  })
}

/** Sounding pairs a minor second, major seventh or tritone apart. */
function clashes(notes: Note[]): string[] {
  const ev = [...notes].sort((a, b) => a.t0 - b.t0 || a.m - b.m)
  const out: string[] = []
  ev.forEach((a, i) => {
    for (const b of ev.slice(i + 1)) {
      if (b.t0 >= a.t1 - 1e-6) break
      const overlap = Math.min(a.t1, b.t1) - Math.max(a.t0, b.t0) > 0.005
      if (overlap && [1, 6, 11].includes((((a.m - b.m) % 12) + 12) % 12))
        out.push(
          `${b.t0.toFixed(2)} s ${a.voice} ${NAMES[a.m % 12]} / ${b.voice} ${NAMES[b.m % 12]}`,
        )
    }
  })
  return out
}

/** A rendered score: its samples, what it is in time, and its harmony check. */
export type RenderedScore = {
  issues: HarmonyIssues
  left: Float32Array
  plan: ScorePlan
  right: Float32Array
  sampleRate: number
}

/** A light algorithmic room (parallel combs into allpasses, per channel). */
function reverb(send: [Float32Array, Float32Array]): [Float32Array, Float32Array] {
  const combs = [1116, 1188, 1277, 1356, 1422, 1491].map((d) => Math.round((d * SR) / 44100))
  const allpasses = [556, 441, 341].map((d) => Math.round((d * SR) / 44100))
  return send.map((x, ch) => {
    const n = x.length
    const out = new Float32Array(n)
    for (const base of combs) {
      const d = base + ch * 23
      const buf = new Float32Array(d)
      let idx = 0
      let low = 0
      for (let i = 0; i < n; i++) {
        const y = buf[idx] as number
        low = y * 0.6 + low * 0.4
        buf[idx] = (x[i] as number) + low * 0.82
        out[i] = (out[i] as number) + y / combs.length
        idx = (idx + 1) % d
      }
    }
    for (const base of allpasses) {
      const d = base + ch * 23
      const buf = new Float32Array(d)
      let idx = 0
      for (let i = 0; i < n; i++) {
        const b = buf[idx] as number
        const v = out[i] as number
        buf[idx] = v + b * 0.5
        out[i] = b - v
        idx = (idx + 1) % d
      }
    }
    return out
  }) as [Float32Array, Float32Array]
}

/**
 * Renders a score (checked with `parseScore`): its bars, then the final hit on the next downbeat
 * and `tailSec` of ring-out. Peak-normalised to -1 dBFS (the reel's render sets the loudness).
 */
export function renderScore(
  score: Score,
  o: { seed?: number; tailSec?: number } = {},
): RenderedScore {
  const root = keyRoot(score.key) ?? 9
  const tailSec = o.tailSec ?? 3
  const c = new Composer(score, root)
  const n = samplesOf(c.finalT + tailSec)
  const mix = new Mix(n, rng(o.seed ?? 7))
  const km = 28 + ((((root - 28) % 12) + 12) % 12)
  const kickHz = hz(km) >= 44 ? hz(km) : hz(km + 12)
  const strongHits = compose(c, mix, kickHz, tailSec)
  const wet = reverb(mix.send)
  const [left, right] = mix.dry
  let peak = 1e-9
  for (const [ch, w] of [
    [left, wet[0]],
    [right, wet[1]],
  ] as const)
    for (let i = 0; i < n; i++) {
      const v = Math.tanh(((ch[i] as number) + 0.35 * (w[i] as number)) * 1.1) / 1.1
      ch[i] = v
      peak = Math.max(peak, Math.abs(v))
    }
  const fade = samplesOf(0.01)
  const gain = 10 ** (-1 / 20) / peak
  for (const ch of [left, right])
    for (let i = 0; i < n; i++)
      ch[i] = (ch[i] as number) * gain * (i >= n - fade ? (n - i) / fade : 1)
  const durationSec = n / SR
  const beats: number[] = []
  for (let k = 0; k * c.beat < durationSec - 1e-6; k++)
    beats.push(Math.round(k * c.beat * 1000) / 1000)
  return {
    issues: checkHarmony(c),
    left,
    plan: {
      beats,
      downbeats: beats.filter((_, i) => i % 4 === 0),
      durationSec: Math.round(durationSec * 1000) / 1000,
      events: scoreEvents(c, beats, durationSec),
      finalHitSec: Math.round(c.finalT * 1000) / 1000,
      strongHits: strongHits.slice(0, 16),
    },
    right,
    sampleRate: SR,
  }
}

/**
 * The score's events as played: its kicks and snares (fills and hits included), the lead's note
 * starts (strength 1 on a beat, 0.6 off it) and its stabs (0.8), the chord changes, and its
 * sections in bars, then the final hit to the end.
 */
function scoreEvents(c: Composer, beats: number[], durationSec: number): MusicEvents {
  const onBeat = (t: number) => Math.abs(t / c.beat - Math.round(t / c.beat)) < 1e-6
  const melody = c.notes.flatMap((n) => {
    if (n.voice === 'lead') return [{ strength: onBeat(n.t0) ? 1 : 0.6, t: n.t0 }]
    return n.voice === 'stab' ? [{ strength: 0.8, t: n.t0 }] : []
  })
  const chords = c.chords
    .filter((ch, i) => i === 0 || ch.pcs.join(',') !== c.chords[i - 1]?.pcs.join(','))
    .map((ch) => ch.t0)
  const sections: MusicEvents['sections'] = []
  let bar = 0
  for (const s of c.score.sections) {
    sections.push({
      endSec: (bar + s.bars) * c.bar,
      energy: s.energy,
      name: s.name,
      startSec: bar * c.bar,
    })
    bar += s.bars
  }
  sections.push({ endSec: durationSec, energy: 3, name: 'final hit', startSec: c.finalT })
  const drums = (kind: DrumHit['kind']) => c.drums.filter((d) => d.kind === kind)
  return tidyEvents(
    { chords, kicks: drums('kick'), melody, sections, snares: drums('snare') },
    beats,
    durationSec,
  )
}

/** Stereo float samples as a 16-bit PCM WAV file's bytes. */
export function wavBytes(left: Float32Array, right: Float32Array, sampleRate: number): Uint8Array {
  const n = left.length
  const bytes = new Uint8Array(44 + n * 4)
  const view = new DataView(bytes.buffer)
  const ascii = (at: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(at + i, s.charCodeAt(i))
  }
  ascii(0, 'RIFF')
  view.setUint32(4, 36 + n * 4, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 2, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 4, true)
  view.setUint16(32, 4, true)
  view.setUint16(34, 16, true)
  ascii(36, 'data')
  view.setUint32(40, n * 4, true)
  for (let i = 0; i < n; i++) {
    view.setInt16(
      44 + i * 4,
      Math.round(Math.max(-1, Math.min(1, left[i] as number)) * 32767),
      true,
    )
    view.setInt16(
      46 + i * 4,
      Math.round(Math.max(-1, Math.min(1, right[i] as number)) * 32767),
      true,
    )
  }
  return bytes
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/**
 * A score the agent wrote, checked: tempo 70-180, a key, major or minor, a groove, sections whose
 * bars add up to `bars` (the reel's bars less the final hit's), energies 0-3, hits inside them.
 * Answers the score or what to fix.
 */
export function parseScore(raw: unknown, bars: number): Score | string {
  const r = isRecord(raw) ? raw : {}
  const bpm = r['bpm']
  if (typeof bpm !== 'number' || !Number.isFinite(bpm) || bpm < 70 || bpm > 180)
    return 'bpm is the tempo, 70 to 180.'
  const key = typeof r['key'] === 'string' ? r['key'] : ''
  if (keyRoot(key) === null) return 'key is a note name: C, C#, Db, D ... B.'
  const mode = r['mode'] === 'major' ? 'major' : r['mode'] === 'minor' ? 'minor' : null
  if (!mode) return 'mode is major or minor.'
  const groove = r['groove'] ?? (bpm < 90 ? 'half' : bpm <= 118 ? 'backbeat' : 'four')
  if (groove !== 'backbeat' && groove !== 'four' && groove !== 'half')
    return 'groove is backbeat, four or half.'
  const sections = parseSections(r['sections'])
  if (typeof sections === 'string') return sections
  const total = sections.reduce((sum, s) => sum + s.bars, 0)
  if (total !== bars)
    return `The sections add up to ${total} bars; at ${bpm} BPM they must add up to ${bars} (the reel's bars, less the last one, which holds the final hit).`
  const hits = parseHits(r['hits'], bars)
  if (typeof hits === 'string') return hits
  return { bpm, groove, hits, key, mode, sections }
}

/** The score's sections, checked; what to fix otherwise. */
function parseSections(raw: unknown): ScoreSection[] | string {
  const sections: ScoreSection[] = []
  for (const s of Array.isArray(raw) ? raw : []) {
    if (!isRecord(s)) return 'Each section is { name, bars, energy }.'
    const name = typeof s['name'] === 'string' ? s['name'].trim().toLowerCase() : ''
    const n = s['bars']
    const energy = s['energy']
    if (!name || typeof n !== 'number' || !Number.isInteger(n) || n < 1)
      return 'Each section has a name and a whole number of bars (1 or more).'
    if (energy !== 0 && energy !== 1 && energy !== 2 && energy !== 3)
      return 'A section energy is 0 (ambient), 1 (light), 2 (full) or 3 (peak).'
    sections.push({ bars: n, energy, name })
  }
  return sections
}

/** The score's hits inside its `bars`, checked; what to fix otherwise. */
function parseHits(raw: unknown, bars: number): ScoreHit[] | string {
  const hits: ScoreHit[] = []
  for (const h of Array.isArray(raw) ? raw : []) {
    if (!isRecord(h)) return 'Each hit is { bar, beat, kind }.'
    const bar = h['bar']
    const beat = h['beat']
    const kind = h['kind'] ?? 'hit'
    if (typeof bar !== 'number' || !Number.isInteger(bar) || bar < 1 || bar > bars)
      return `A hit's bar is 1 to ${bars}.`
    if (typeof beat !== 'number' || beat < 1 || beat >= 5)
      return "A hit's beat is 1 to 4 (4.5 for its and)."
    if (kind !== 'crash' && kind !== 'hit' && kind !== 'stab')
      return 'A hit is a crash, hit or stab.'
    hits.push({ bar, beat, kind })
  }
  return hits
}
