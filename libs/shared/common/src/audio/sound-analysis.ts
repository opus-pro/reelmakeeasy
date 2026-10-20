/**
 * Sound-effect analysis for ranking shorts: where sounds start in a soundtrack (onsets), what a
 * sound added at that moment looks like (a fingerprint that ignores what was already playing),
 * and how close it is to the sounds in the user's library. Pure maths on mono samples; decode
 * with `decodeAudioMono`.
 */

import { SOUND_ANALYSIS_RATE } from './decode-audio'

const FFT_SIZE = 1024
const HOP = 256
const BANDS = 32
const MIN_HZ = 40
/** The fingerprint covers this long after the start, in this many slices (its shape in time). */
const PRINT_SEC = 0.36
const PRINT_SLICES = 4
/** What was playing before a sound: this stretch just before its start. */
const BEFORE_SEC = 0.15
const BEFORE_GAP_SEC = 0.02
/** Fingerprints keep 30 dB below their loudest band: quieter than that is noise. */
const RANGE_DB = 30

/** Band energies over time: `frames[t][b]`, linear power, one frame every `hopSec`. */
export type Spectrogram = { frames: Float64Array[]; hopSec: number }

export type Onset = {
  atSec: number
  /** 0..1, against the strongest onset in the soundtrack. */
  strength: number
}

/** A sound's fingerprint: its spectrum's shape in a few slices, gain-free (z-normalized dB). */
export type SoundPrint = Float64Array

export type SoundCharacter = {
  /** How it sounds, in words a person can search for: "short low boom", "bright hit"... */
  description: string
  /** About how long it rings, in seconds. */
  durationSec: number
}

let bandCache: { edges: number[]; window: Float64Array } | null = null

/** Hann window and the FFT bins where each log-spaced band starts (BANDS + 1 edges). */
function bands(sampleRate: number): { edges: number[]; window: Float64Array } {
  if (bandCache && sampleRate === SOUND_ANALYSIS_RATE) return bandCache
  const window = new Float64Array(FFT_SIZE)
  for (let i = 0; i < FFT_SIZE; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FFT_SIZE)
  const nyquist = sampleRate / 2
  const binHz = sampleRate / FFT_SIZE
  const edges: number[] = []
  for (let b = 0; b <= BANDS; b++) {
    const hz = MIN_HZ * (nyquist / MIN_HZ) ** (b / BANDS)
    edges.push(Math.min(FFT_SIZE / 2, Math.max(1, Math.round(hz / binHz))))
  }
  // Low bands narrower than a bin: give each at least one bin, in order.
  for (let b = 1; b <= BANDS; b++) edges[b] = Math.max(edges[b] as number, (edges[b - 1] as number) + 1)
  const out = { edges: edges.map((e) => Math.min(FFT_SIZE / 2, e)), window }
  if (sampleRate === SOUND_ANALYSIS_RATE) bandCache = out
  return out
}

/** In-place radix-2 FFT. */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j] as number, re[i] as number]
      ;[im[i], im[j]] = [im[j] as number, im[i] as number]
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len
    const wr = Math.cos(angle)
    const wi = Math.sin(angle)
    for (let i = 0; i < n; i += len) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < len / 2; k++) {
        const a = i + k
        const b = a + len / 2
        const tr = (re[b] as number) * cr - (im[b] as number) * ci
        const ti = (re[b] as number) * ci + (im[b] as number) * cr
        re[b] = (re[a] as number) - tr
        im[b] = (im[a] as number) - ti
        re[a] = (re[a] as number) + tr
        im[a] = (im[a] as number) + ti
        const next = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = next
      }
    }
  }
}

/** Band energies every 256 samples (about 12 ms at the analysis rate). */
export function spectrogram(samples: Float32Array, sampleRate = SOUND_ANALYSIS_RATE): Spectrogram {
  const { edges, window } = bands(sampleRate)
  const frames: Float64Array[] = []
  const re = new Float64Array(FFT_SIZE)
  const im = new Float64Array(FFT_SIZE)
  for (let start = 0; start + FFT_SIZE <= samples.length; start += HOP) {
    for (let i = 0; i < FFT_SIZE; i++) {
      re[i] = (samples[start + i] as number) * (window[i] as number)
      im[i] = 0
    }
    fft(re, im)
    const frame = new Float64Array(BANDS)
    for (let b = 0; b < BANDS; b++) {
      let sum = 0
      for (let k = edges[b] as number; k < (edges[b + 1] as number); k++)
        sum += (re[k] as number) ** 2 + (im[k] as number) ** 2
      frame[b] = sum
    }
    frames.push(frame)
  }
  return { frames, hopSec: HOP / sampleRate }
}

/**
 * Where sounds start: peaks of the spectral flux (how much louder each band got than a moment
 * before), over a local median so steady music doesn't count. At most one every `minGapSec`.
 */
export function detectOnsets(
  spec: Spectrogram,
  { minGapSec = 0.2, minStrength = 0.15 }: { minGapSec?: number; minStrength?: number } = {},
): Onset[] {
  const { frames, hopSec } = spec
  const logs = frames.map((f) => f.map((p) => Math.log1p(p * 1000)))
  const flux = new Float64Array(frames.length)
  for (let t = 1; t < frames.length; t++) {
    let sum = 0
    const now = logs[t] as Float64Array
    const before = logs[Math.max(0, t - 2)] as Float64Array
    for (let b = 0; b < BANDS; b++) sum += Math.max(0, (now[b] as number) - (before[b] as number))
    flux[t] = sum
  }
  const radius = Math.round(0.5 / hopSec)
  const peaks: { strength: number; t: number }[] = []
  for (let t = 1; t < flux.length - 1; t++) {
    const value = flux[t] as number
    if (value <= (flux[t - 1] as number) || value < (flux[t + 1] as number)) continue
    const local = Array.from(flux.subarray(Math.max(0, t - radius), t + radius + 1)).sort((a, b) => a - b)
    const median = local[Math.floor(local.length / 2)] as number
    if (value > median * 1.5 + 1) peaks.push({ strength: value - median, t })
  }
  const top = Math.max(0, ...peaks.map((p) => p.strength))
  if (!top) return []
  // Strongest first, so a weak peak next to a strong one gives way.
  const gap = Math.round(minGapSec / hopSec)
  const kept: { strength: number; t: number }[] = []
  for (const peak of [...peaks].sort((a, b) => b.strength - a.strength)) {
    if (peak.strength / top < minStrength) break
    if (kept.every((k) => Math.abs(k.t - peak.t) >= gap)) kept.push(peak)
  }
  return kept
    .sort((a, b) => a.t - b.t)
    .map((k) => ({ atSec: round3(k.t * hopSec), strength: Math.round((k.strength / top) * 100) / 100 }))
}

/** The mean band power over frames [from, to). */
function meanFrames(frames: Float64Array[], from: number, to: number): Float64Array {
  const out = new Float64Array(BANDS)
  const a = Math.max(0, from)
  const b = Math.min(frames.length, to)
  for (let t = a; t < b; t++) for (let k = 0; k < BANDS; k++) out[k] = (out[k] as number) + ((frames[t] as Float64Array)[k] as number)
  if (b > a) for (let k = 0; k < BANDS; k++) out[k] = (out[k] as number) / (b - a)
  return out
}

/** What was added at frame `t`: each slice's power minus what played just before (never below 0). */
function addedSlices(spec: Spectrogram, t: number, subtractBefore: boolean): Float64Array[] {
  const { frames, hopSec } = spec
  const before = subtractBefore
    ? meanFrames(frames, t - Math.round((BEFORE_SEC + BEFORE_GAP_SEC) / hopSec), t - Math.round(BEFORE_GAP_SEC / hopSec))
    : new Float64Array(BANDS)
  const slice = Math.max(1, Math.round(PRINT_SEC / PRINT_SLICES / hopSec))
  const out: Float64Array[] = []
  for (let s = 0; s < PRINT_SLICES; s++) {
    const mean = meanFrames(frames, t + s * slice, t + (s + 1) * slice)
    out.push(mean.map((p, k) => Math.max(0, p - (before[k] as number))))
  }
  return out
}

/** A gain-free fingerprint of the slices: dB within RANGE_DB of the loudest, z-normalized. */
function printOf(slices: Float64Array[]): SoundPrint | null {
  const flat = new Float64Array(slices.length * BANDS)
  slices.forEach((s, i) => flat.set(s, i * BANDS))
  const max = Math.max(...flat)
  if (!(max > 0)) return null
  const floor = max * 10 ** (-RANGE_DB / 10)
  const db = flat.map((p) => 10 * Math.log10(Math.max(p, floor)))
  const mean = db.reduce((a, b) => a + b, 0) / db.length
  const sd = Math.sqrt(db.reduce((a, b) => a + (b - mean) ** 2, 0) / db.length)
  if (sd < 1e-6) return null
  return db.map((v) => (v - mean) / sd)
}

/** The fingerprint of whatever was added at `atSec` (the music or speech before it subtracted). */
export function printAt(spec: Spectrogram, atSec: number): SoundPrint | null {
  return printOf(addedSlices(spec, Math.round(atSec / spec.hopSec), true))
}

/** Where a sound file really starts: its first frame within 20 dB of its loudest. */
export function soundStartSec(spec: Spectrogram): number {
  const energy = spec.frames.map((f) => f.reduce((a, b) => a + b, 0))
  const max = Math.max(0, ...energy)
  const t = energy.findIndex((e) => e >= max * 0.01)
  return t < 0 ? 0 : t * spec.hopSec
}

/** A library sound's fingerprint, from where it starts (nothing to subtract: it plays alone). */
export function printOfSound(spec: Spectrogram): SoundPrint | null {
  return printOf(addedSlices(spec, Math.round(soundStartSec(spec) / spec.hopSec), false))
}

/** Pearson correlation of two fingerprints (they are z-normalized): 1 is the same shape. */
export function similarity(a: SoundPrint, b: SoundPrint): number {
  if (a.length !== b.length) return 0
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += (a[i] as number) * (b[i] as number)
  return sum / a.length
}

/** A match good enough to name: the same sound, re-encoded and mixed over a clip. */
export const MATCH_THRESHOLD = 0.72

export type LibraryPrint = { id: string; name: string; print: SoundPrint }

/**
 * The library sound closest to what starts at `atSec`, trying a few frames either side (onset
 * timing wobbles); null when none clears `MATCH_THRESHOLD`. `runnerUp` is the next best score.
 */
export function matchSound(
  spec: Spectrogram,
  atSec: number,
  library: LibraryPrint[],
): { id: string; name: string; score: number } | null {
  if (!library.length) return null
  const t0 = Math.round(atSec / spec.hopSec)
  let best: { id: string; name: string; score: number } | null = null
  for (let dt = -3; dt <= 3; dt++) {
    const print = printOf(addedSlices(spec, t0 + dt, true))
    if (!print) continue
    for (const sound of library) {
      const score = similarity(print, sound.print)
      if (!best || score > best.score) best = { id: sound.id, name: sound.name, score }
    }
  }
  if (!best || best.score < MATCH_THRESHOLD) return null
  return { ...best, score: Math.round(best.score * 100) / 100 }
}

/**
 * What the sound added at `atSec` is like, in words for finding it elsewhere: how long it rings,
 * how low or bright it is, and whether it is tonal or noise.
 */
export function describeSound(spec: Spectrogram, atSec: number, sampleRate = SOUND_ANALYSIS_RATE): SoundCharacter {
  const { frames, hopSec } = spec
  const t0 = Math.round(atSec / hopSec)
  const before = meanFrames(frames, t0 - Math.round((BEFORE_SEC + BEFORE_GAP_SEC) / hopSec), t0 - 1)
  const added = (t: number) =>
    (frames[t] ?? new Float64Array(BANDS)).reduce((a, p, k) => a + Math.max(0, p - (before[k] as number)), 0)
  // A sound may swell (a whoosh): its peak is within half a second, and it rings from its start
  // until it falls below a tenth of that peak after it.
  let peak = 0
  let peakAt = t0
  for (let t = t0; t < t0 + Math.round(0.5 / hopSec); t++) {
    const value = added(t)
    if (value > peak) [peak, peakAt] = [value, t]
  }
  let end = peakAt
  const limit = t0 + Math.round(4 / hopSec)
  while (end < limit && end < frames.length && added(end) > peak * 0.1) end++
  const durationSec = Math.max(hopSec, (end - t0) * hopSec)
  // Its spectrum around its peak, minus what played before it started.
  const spectrum = meanFrames(frames, peakAt - 3, peakAt + 4).map((p, k) => Math.max(0, p - (before[k] as number)))
  const { edges } = bands(sampleRate)
  const binHz = sampleRate / FFT_SIZE
  let total = 0
  let weighted = 0
  for (let b = 0; b < BANDS; b++) {
    const hz = (((edges[b] as number) + (edges[b + 1] as number)) / 2) * binHz
    total += spectrum[b] as number
    weighted += (spectrum[b] as number) * hz
  }
  const centroid = total ? weighted / total : 0
  // Flatness of the power per bin: near 1 for noise (whoosh, crash), near 0 for a tone or a voice.
  // Over bands of 4 bins or more: a band of one or two bins swings too much to say.
  const density = Array.from(spectrum)
    .map((p, b) => ({ bins: (edges[b + 1] as number) - (edges[b] as number), p }))
    .filter((band) => band.bins >= 4)
    .map((band) => band.p / band.bins)
  // Floored 30 dB under the densest band: a band the music already filled counts as quiet, not as silence.
  const floor = Math.max(...density) * 1e-3
  const positive = density.map((p) => Math.max(p, floor) + 1e-12)
  const geo = Math.exp(positive.reduce((a, p) => a + Math.log(p), 0) / positive.length)
  const flatness = geo / (positive.reduce((a, p) => a + p, 0) / positive.length)
  const pitch = centroid < 350 ? 'low' : centroid < 2000 ? 'mid' : 'bright'
  const length = durationSec < 0.35 ? 'short' : durationSec < 1.2 ? '' : 'long'
  const kind =
    flatness > 0.35
      ? durationSec < 0.35
        ? 'crack'
        : 'whoosh or crash'
      : pitch === 'low'
        ? 'boom'
        : durationSec < 0.35
          ? 'hit'
          : 'tone, voice or sting'
  return {
    description: [length, pitch, kind].filter(Boolean).join(' '),
    durationSec: Math.round(durationSec * 100) / 100,
  }
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000
}
