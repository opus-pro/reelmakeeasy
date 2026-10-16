/**
 * The beat grid a Motion Reel is built on: tempo, beats, bar starts and the strongest hits of a
 * music track, plus the part of the track that gives the reel its length in whole bars.
 *
 * Music, cuts and sound effects are all placed on this grid, so a reel's timing is never guessed.
 * Pure functions over mono samples; `decode-audio.ts` turns a file into samples.
 */

export type BeatGrid = {
  /** Every beat, in seconds from the start of the track. */
  beats: number[]
  /** Beats per bar (4: the grid assumes 4/4, which nearly all reel music is). */
  beatsPerBar: number
  /** Beats per minute, rounded to 0.1. */
  bpm: number
  /** Bar starts (the first beat of each bar), in seconds. */
  downbeats: number[]
  /** The track's length in seconds. */
  durationSec: number
  /** The loudest onsets (hits, drops), in seconds, strongest first. At most 16. */
  strongHits: number[]
}

/** The stretch of the track a reel uses: whole bars from a bar start. */
export type ReelFit = {
  bars: number
  /** Seconds of fade-out at the end of the reel (half a bar, at most 1 s). */
  fadeOutSec: number
  lengthSec: number
  /** The reel's beats and bar starts, in seconds from `startSec` (so 0 is the reel's first frame). */
  reelBeats: number[]
  reelDownbeats: number[]
  startSec: number
}

export const ANALYSIS_SAMPLE_RATE = 22050
const FFT_SIZE = 1024
const HOP = 256
const MIN_BPM = 60
const MAX_BPM = 200
const BEATS_PER_BAR = 4

/** Onset strength per frame (spectral flux on a log magnitude spectrum), and its frame rate. */
export function onsetEnvelope(
  samples: Float32Array,
  sampleRate = ANALYSIS_SAMPLE_RATE,
): { envelope: Float32Array; frameRate: number; lowBand: Float32Array } {
  const frameRate = sampleRate / HOP
  const frames = samples.length < FFT_SIZE ? 0 : Math.floor((samples.length - FFT_SIZE) / HOP) + 1
  const envelope = new Float32Array(frames)
  const lowBand = new Float32Array(frames)
  if (frames === 0) return { envelope, frameRate, lowBand }

  const window = hann(FFT_SIZE)
  const bins = FFT_SIZE / 2
  // Below ~150 Hz: kicks and bass, which mark bar starts more reliably than the hats.
  const lowBins = Math.max(2, Math.round((150 / sampleRate) * FFT_SIZE))
  const re = new Float64Array(FFT_SIZE)
  const im = new Float64Array(FFT_SIZE)
  let previous = new Float64Array(bins)
  let current = new Float64Array(bins)
  for (let f = 0; f < frames; f++) {
    const offset = f * HOP
    for (let i = 0; i < FFT_SIZE; i++) {
      re[i] = (samples[offset + i] ?? 0) * (window[i] ?? 0)
      im[i] = 0
    }
    fft(re, im)
    let flux = 0
    let low = 0
    for (let k = 0; k < bins; k++) {
      const magnitude = Math.log1p(10 * Math.hypot(re[k] ?? 0, im[k] ?? 0))
      current[k] = magnitude
      const rise = magnitude - (previous[k] ?? 0)
      if (f > 0 && rise > 0) {
        flux += rise
        if (k < lowBins) low += rise
      }
    }
    envelope[f] = flux
    lowBand[f] = low
    ;[previous, current] = [current, previous]
  }
  return {
    envelope: normalise(subtractLocalMean(envelope, Math.round(frameRate * 0.1))),
    frameRate,
    lowBand,
  }
}

/** The tempo (BPM) that best explains the onsets: autocorrelation with a prior around 120 BPM. */
export function estimateTempo(envelope: Float32Array, frameRate: number): number {
  const minLag = Math.max(1, Math.floor((60 / MAX_BPM) * frameRate))
  const maxLag = Math.min(envelope.length - 1, Math.ceil((60 / MIN_BPM) * frameRate))
  if (maxLag <= minLag) return 120
  const mean = average(envelope)
  let bestLag = minLag
  let bestScore = -Infinity
  const scores = new Float64Array(maxLag + 2)
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0
    for (let i = lag; i < envelope.length; i++)
      sum += ((envelope[i] ?? 0) - mean) * ((envelope[i - lag] ?? 0) - mean)
    const bpm = (60 * frameRate) / lag
    // A gentle preference for tempos near 120 BPM (log-normal, one octave wide), so a track's
    // half or double time only wins when it is clearly stronger.
    const prior = Math.exp(-0.5 * Math.log2(bpm / 120) ** 2)
    const score = (sum / (envelope.length - lag)) * prior
    scores[lag] = score
    if (score > bestScore) {
      bestScore = score
      bestLag = lag
    }
  }
  // Parabolic interpolation around the best lag for a finer tempo than one frame allows.
  const a = scores[bestLag - 1] ?? bestScore
  const b = bestScore
  const c = scores[bestLag + 1] ?? bestScore
  const denominator = a - 2 * b + c
  const shift = denominator === 0 ? 0 : Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / denominator))
  return (60 * frameRate) / (bestLag + shift)
}

/** Beat times (seconds) by dynamic programming: onsets, kept close to the tempo's spacing. */
export function trackBeats(envelope: Float32Array, frameRate: number, bpm: number): number[] {
  const period = (60 / bpm) * frameRate
  const n = envelope.length
  if (n === 0) return []
  const score = new Float64Array(n)
  const backlink = new Int32Array(n).fill(-1)
  const tightness = 100
  for (let t = 0; t < n; t++) {
    let best = 0
    let bestPrevious = -1
    const from = Math.max(0, Math.floor(t - 2 * period))
    const to = Math.floor(t - period / 2)
    for (let p = from; p <= to; p++) {
      const deviation = Math.log((t - p) / period)
      const candidate = (score[p] ?? 0) - tightness * deviation * deviation
      if (bestPrevious === -1 || candidate > best) {
        best = candidate
        bestPrevious = p
      }
    }
    score[t] = (envelope[t] ?? 0) + (bestPrevious === -1 ? 0 : best)
    backlink[t] = bestPrevious
  }
  // End on the best-scoring frame within the last beat period, then walk back.
  let end = n - 1
  for (let t = Math.max(0, Math.floor(n - period)); t < n; t++)
    if ((score[t] ?? 0) > (score[end] ?? 0)) end = t
  const frames: number[] = []
  for (let t = end; t >= 0; t = backlink[t] ?? -1) frames.push(t)
  return frames.toReversed().map((frame) => frame / frameRate)
}

/** Which beat in each group of four starts the bar: the phase with the most low-end energy. */
export function findDownbeats(
  beats: number[],
  lowBand: Float32Array,
  frameRate: number,
  beatsPerBar = BEATS_PER_BAR,
): number[] {
  if (beats.length === 0) return []
  const energyAt = (time: number) => {
    const centre = Math.round(time * frameRate)
    let peak = 0
    for (let f = centre - 2; f <= centre + 2; f++) peak = Math.max(peak, lowBand[f] ?? 0)
    return peak
  }
  let bestPhase = 0
  let bestEnergy = -Infinity
  for (let phase = 0; phase < beatsPerBar; phase++) {
    let sum = 0
    let count = 0
    for (let i = phase; i < beats.length; i += beatsPerBar) {
      sum += energyAt(beats[i] ?? 0)
      count++
    }
    const energy = count ? sum / count : 0
    if (energy > bestEnergy) {
      bestEnergy = energy
      bestPhase = phase
    }
  }
  return beats.filter((_, i) => i >= bestPhase && (i - bestPhase) % beatsPerBar === 0)
}

/** The strongest onsets, strongest first: local peaks well above the track's usual level. */
export function findStrongHits(envelope: Float32Array, frameRate: number, max = 16): number[] {
  const mean = average(envelope)
  const deviation = Math.sqrt(average(envelope.map((v) => (v - mean) ** 2)))
  const threshold = mean + 2 * deviation
  const radius = Math.max(1, Math.round(frameRate * 0.1))
  const peaks: { strength: number; time: number }[] = []
  for (let f = 0; f < envelope.length; f++) {
    const value = envelope[f] ?? 0
    if (value < threshold) continue
    let isPeak = true
    for (let g = Math.max(0, f - radius); g <= Math.min(envelope.length - 1, f + radius); g++) {
      if ((envelope[g] ?? 0) > value) {
        isPeak = false
        break
      }
    }
    if (isPeak) peaks.push({ strength: value, time: f / frameRate })
  }
  return peaks
    .sort((a, b) => b.strength - a.strength)
    .slice(0, max)
    .map((p) => round3(p.time))
}

/** The whole grid for a track. */
export function analyseBeatGrid(
  samples: Float32Array,
  sampleRate = ANALYSIS_SAMPLE_RATE,
): BeatGrid {
  const { envelope, frameRate, lowBand } = onsetEnvelope(samples, sampleRate)
  const bpm = estimateTempo(envelope, frameRate)
  const beats = trackBeats(envelope, frameRate, bpm)
  return {
    beats: beats.map(round3),
    beatsPerBar: BEATS_PER_BAR,
    bpm: Math.round(bpm * 10) / 10,
    downbeats: findDownbeats(beats, lowBand, frameRate).map(round3),
    durationSec: round3(samples.length / sampleRate),
    strongHits: findStrongHits(envelope, frameRate),
  }
}

/**
 * The part of the track a reel of about `targetSec` uses: a whole number of bars starting on a bar
 * start. Prefers the most energetic window among the bar starts that fit (a drop beats an intro),
 * and the earliest one among near-equals. A track shorter than the reel starts at its first bar.
 */
export function fitReel(
  grid: BeatGrid,
  targetSec: number,
  energy?: (from: number, to: number) => number,
): ReelFit {
  const beatSec = 60 / grid.bpm
  const barSec = beatSec * grid.beatsPerBar
  const bars = Math.max(1, Math.round(targetSec / barSec))
  const lengthSec = bars * barSec
  const starts = grid.downbeats.filter((d) => d + lengthSec <= grid.durationSec + 0.05)
  const candidates = starts.length ? starts : grid.downbeats.slice(0, 1)
  let startSec = candidates[0] ?? 0
  if (energy && candidates.length > 1) {
    const scored = candidates.map((start) => ({ score: energy(start, start + lengthSec), start }))
    const top = Math.max(...scored.map((s) => s.score))
    startSec = scored.find((s) => s.score >= top * 0.9)?.start ?? startSec
  }
  // The beat that ends the last bar is the next bar's start, not part of this reel.
  const inReel = (t: number) => t >= startSec - 0.001 && t < startSec + lengthSec - beatSec / 2
  return {
    bars,
    fadeOutSec: round3(Math.min(1, barSec / 2)),
    lengthSec: round3(lengthSec),
    reelBeats: grid.beats.filter(inReel).map((t) => round3(t - startSec)),
    reelDownbeats: grid.downbeats.filter(inReel).map((t) => round3(t - startSec)),
    startSec: round3(startSec),
  }
}

/** How well cuts follow the grid: each cut's distance to the nearest beat, and how many land on one. */
export function alignmentReport(
  cuts: number[],
  beats: number[],
  toleranceSec: number,
): { cuts: number; onBeat: number; worstOffSec: number } {
  let onBeat = 0
  let worst = 0
  for (const cut of cuts) {
    const off = beats.length ? Math.min(...beats.map((b) => Math.abs(b - cut))) : Infinity
    if (off <= toleranceSec) onBeat++
    worst = Math.max(worst, off)
  }
  return { cuts: cuts.length, onBeat, worstOffSec: cuts.length ? round3(worst) : 0 }
}

function hann(size: number): Float64Array {
  const window = new Float64Array(size)
  for (let i = 0; i < size; i++) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1))
  return window
}

function average(values: ArrayLike<number>): number {
  let sum = 0
  for (let i = 0; i < values.length; i++) sum += values[i] ?? 0
  return values.length ? sum / values.length : 0
}

/** In-place iterative radix-2 FFT (size must be a power of two). */
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) {
      ;[re[i], re[j]] = [re[j] ?? 0, re[i] ?? 0]
      ;[im[i], im[j]] = [im[j] ?? 0, im[i] ?? 0]
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const angle = (-2 * Math.PI) / size
    const wr = Math.cos(angle)
    const wi = Math.sin(angle)
    for (let start = 0; start < n; start += size) {
      let cr = 1
      let ci = 0
      for (let k = 0; k < size / 2; k++) {
        const a = start + k
        const b = a + size / 2
        const tr = (re[b] ?? 0) * cr - (im[b] ?? 0) * ci
        const ti = (re[b] ?? 0) * ci + (im[b] ?? 0) * cr
        re[b] = (re[a] ?? 0) - tr
        im[b] = (im[a] ?? 0) - ti
        re[a] = (re[a] ?? 0) + tr
        im[a] = (im[a] ?? 0) + ti
        const next = cr * wr - ci * wi
        ci = cr * wi + ci * wr
        cr = next
      }
    }
  }
}

function normalise(values: Float32Array): Float32Array {
  let max = 0
  for (const v of values) max = Math.max(max, v)
  return max > 0 ? values.map((v) => v / max) : values
}

function subtractLocalMean(values: Float32Array, radius: number): Float32Array {
  const out = new Float32Array(values.length)
  let sum = 0
  let count = 0
  let left = 0
  let right = -1
  for (let i = 0; i < values.length; i++) {
    while (right < Math.min(values.length - 1, i + radius)) sum += values[++right] ?? 0
    while (left < i - radius) sum -= values[left++] ?? 0
    count = right - left + 1
    out[i] = Math.max(0, (values[i] ?? 0) - sum / count)
  }
  return out
}

const round3 = (value: number) => Math.round(value * 1000) / 1000
