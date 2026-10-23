import { alignmentReport, analyseBeatGrid, ANALYSIS_SAMPLE_RATE, fitReel } from './beat-grid'

const SR = ANALYSIS_SAMPLE_RATE

/** A click track: a short noise burst on every beat, a louder low thump on each bar start. */
function clickTrack(
  bpm: number,
  seconds: number,
  opts: { noise?: number; offsetSec?: number } = {},
) {
  const samples = new Float32Array(Math.round(seconds * SR))
  let seed = 7
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648 - 0.5
  }
  for (let i = 0; i < samples.length; i++) samples[i] = (opts.noise ?? 0) * random()
  const beat = 60 / bpm
  const offset = opts.offsetSec ?? 0
  for (let k = 0; offset + k * beat < seconds; k++) {
    const start = Math.round((offset + k * beat) * SR)
    const downbeat = k % 4 === 0
    for (let i = 0; i < SR * 0.04 && start + i < samples.length; i++) {
      const decay = Math.exp(-i / (SR * 0.01))
      const hat = 0.4 * random() * decay
      const thump = downbeat ? 0.9 * Math.sin((2 * Math.PI * 60 * i) / SR) * decay : 0
      samples[start + i] = (samples[start + i] ?? 0) + hat + thump
    }
  }
  return samples
}

describe('analyseBeatGrid', () => {
  it.each([96, 120, 128, 144])('finds %i BPM and beats on the clicks', (bpm) => {
    const grid = analyseBeatGrid(clickTrack(bpm, 20, { noise: 0.02 }))
    expect(Math.abs(grid.bpm - bpm)).toBeLessThan(1.5)
    const beat = 60 / bpm
    const spacings = grid.beats.slice(1).map((t, i) => t - (grid.beats[i] ?? 0))
    const median = [...spacings].sort((a, b) => a - b)[Math.floor(spacings.length / 2)] ?? 0
    expect(Math.abs(median - beat)).toBeLessThan(0.02)
    // Every tracked beat sits on a click (within ~2 frames at 30 fps).
    for (const t of grid.beats.slice(1, -1)) {
      const k = Math.round(t / beat)
      expect(Math.abs(t - k * beat)).toBeLessThan(0.06)
    }
  })

  it('puts bar starts on the low thumps, also when the track starts mid-bar', () => {
    const bpm = 120
    const offset = 0.25
    const grid = analyseBeatGrid(clickTrack(bpm, 16, { offsetSec: offset }))
    const bar = (60 / bpm) * 4
    expect(grid.downbeats.length).toBeGreaterThan(5)
    for (const d of grid.downbeats.slice(0, -1)) {
      const k = Math.round((d - offset) / bar)
      expect(Math.abs(d - offset - k * bar)).toBeLessThan(0.06)
    }
  })

  it('handles silence and very short audio without throwing', () => {
    expect(analyseBeatGrid(new Float32Array(SR * 2)).beats.length).toBeGreaterThanOrEqual(0)
    expect(analyseBeatGrid(new Float32Array(100)).beats).toEqual([])
  })
})

describe('fitReel', () => {
  const grid = analyseBeatGrid(clickTrack(120, 40))

  it('picks whole bars close to the target length, starting on a bar start', () => {
    const fit = fitReel(grid, 15)
    expect(fit.lengthSec).toBeCloseTo(16, 1) // 8 bars of 2 s at 120 BPM
    expect(fit.bars).toBe(8)
    expect(grid.downbeats).toContain(fit.startSec)
    expect(fit.reelDownbeats[0]).toBe(0)
    expect(fit.reelBeats.length).toBe(32)
    expect(fit.fadeOutSec).toBeCloseTo(1, 1)
  })

  it('prefers the most energetic window', () => {
    const fit = fitReel(grid, 8, (from) => (from >= 20 ? 10 : 1))
    expect(fit.startSec).toBeGreaterThanOrEqual(20)
  })

  it('starts at the first bar when the track is shorter than the reel', () => {
    const short = analyseBeatGrid(clickTrack(120, 6))
    const fit = fitReel(short, 30)
    expect(fit.startSec).toBe(short.downbeats[0])
    expect(fit.bars).toBe(15)
  })
})

describe('alignmentReport', () => {
  it('counts cuts within the tolerance of a beat', () => {
    expect(alignmentReport([0.5, 1.02, 1.6], [0, 0.5, 1, 1.5], 0.067)).toEqual({
      cuts: 3,
      onBeat: 2,
      worstOffSec: 0.1,
    })
    expect(alignmentReport([], [0, 1], 0.05)).toEqual({ cuts: 0, onBeat: 0, worstOffSec: 0 })
  })
})
