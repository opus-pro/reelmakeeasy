import {
  alignmentReport,
  analyseBeatGrid,
  ANALYSIS_SAMPLE_RATE,
  type BeatGrid,
  fitReel,
  wholeBars,
} from './beat-grid'

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

  it('rounds a half bar up, whatever the float error (30 s at 116 BPM is 15 bars)', () => {
    for (const [lengthSec, bpm, bars] of [
      [30, 116, 15],
      [15, 232, 15],
      [60, 58, 15],
      [60, 226, 57],
    ] as const) {
      expect(wholeBars(lengthSec, bpm)).toBe(bars)
      const beatSec = 60 / bpm
      const beats = Array.from({ length: bars * 4 }, (_, i) => i * beatSec)
      const exact: BeatGrid = {
        beats,
        beatsPerBar: 4,
        bpm,
        downbeats: beats.filter((_, i) => i % 4 === 0),
        durationSec: bars * 4 * beatSec,
        strongHits: [],
      }
      expect(fitReel(exact, lengthSec).bars).toBe(bars)
    }
  })

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

  it('shifts the music events to the reel and clips the sections to it', () => {
    const withEvents = {
      ...grid,
      events: {
        chords: [0, 18, 20, 30],
        kicks: [1, 18, 18.5, 26, 34.5],
        melody: [{ strength: 1, t: 19.25 }],
        sections: [
          { endSec: 10, energy: 1 as const, name: 'intro', startSec: 0 },
          { endSec: 24, energy: 3 as const, name: 'drop', startSec: 10 },
          { endSec: 40, energy: 2 as const, name: 'groove', startSec: 24 },
        ],
        snares: [19],
      },
    }
    const fit = fitReel(withEvents, 8, (from) => (from >= 18 && from < 19 ? 10 : 1))
    expect(fit.startSec).toBeCloseTo(18, 1)
    const shift = fit.startSec
    const at = (t: number) => Math.round((t - shift) * 1000) / 1000
    expect(fit.reelEvents.kicks).toEqual([at(18), at(18.5)])
    expect(fit.reelEvents.snares).toEqual([at(19)])
    expect(fit.reelEvents.melody).toEqual([{ strength: 1, t: at(19.25) }])
    expect(fit.reelEvents.sections.map((s) => s.name)).toEqual(['drop', 'groove'])
    expect(fit.reelEvents.sections[0]?.startSec).toBe(0)
    expect(fit.reelEvents.sections[1]?.startSec).toBe(at(24))
    expect(fit.reelEvents.sections.at(-1)?.endSec).toBe(fit.lengthSec)
    // No events on the grid: one groove section over the reel.
    const bare = fitReel({ ...grid, events: undefined }, 8)
    expect(bare.reelEvents.kicks).toEqual([])
    expect(bare.reelEvents.sections).toEqual([
      { endSec: bare.lengthSec, energy: 2, name: 'groove', startSec: 0 },
    ])
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
