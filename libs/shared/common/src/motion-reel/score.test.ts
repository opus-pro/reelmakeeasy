import { parseScore, renderScore, type Score, scoreBars, wavBytes } from './score'

const SCORE: Score = {
  bpm: 120,
  groove: 'backbeat',
  hits: [
    { bar: 5, beat: 1, kind: 'crash' },
    { bar: 12, beat: 3, kind: 'stab' },
  ],
  key: 'A',
  mode: 'minor',
  sections: [
    { bars: 2, energy: 1, name: 'intro' },
    { bars: 6, energy: 2, name: 'groove' },
    { bars: 2, energy: 0, name: 'stop' },
    { bars: 5, energy: 3, name: 'drop' },
  ],
}

describe('a written score', () => {
  it('renders its bars, then the final hit on the next downbeat, with no harmony clash', () => {
    const out = renderScore(SCORE, { tailSec: 2.5 })
    expect(out.issues).toEqual({ clash: [], offbeat: [], triad: [] })
    expect(out.plan.finalHitSec).toBe(30)
    expect(out.plan.downbeats.slice(0, 3)).toEqual([0, 2, 4])
    expect(out.plan.durationSec).toBe(32.5)
    expect(out.left.length).toBe(32.5 * 48000)
    // Section entries and hits are the strongest moments; the final hit first.
    expect(out.plan.strongHits[0]).toBe(30)
    expect([...out.plan.strongHits].sort((a, b) => a - b)).toEqual([4, 8, 20, 23, 30])
    // Loud enough, never clipped.
    const peak = out.left.reduce((top, v) => Math.max(top, Math.abs(v)), 0)
    expect(peak).toBeGreaterThan(0.5)
    expect(peak).toBeLessThanOrEqual(0.9)
  }, 30000)

  it('is the same every time', () => {
    const short = { ...SCORE, hits: [], sections: [{ bars: 2, energy: 3 as const, name: 'drop' }] }
    const a = renderScore(short, { tailSec: 1 })
    const b = renderScore(short, { tailSec: 1 })
    expect(Buffer.from(a.left.buffer).equals(Buffer.from(b.left.buffer))).toBe(true)
  }, 30000)

  it('passes the harmony rules in every key, mode and groove', () => {
    for (const [key, mode, groove] of [
      ['C', 'major', 'half'],
      ['F#', 'minor', 'four'],
      ['Bb', 'major', 'backbeat'],
      ['E', 'minor', 'half'],
    ] as const) {
      const out = renderScore(
        { ...SCORE, groove, hits: [], key, mode, sections: [{ bars: 2, energy: 3, name: 'drop' }] },
        { tailSec: 1 },
      )
      expect(out.issues).toEqual({ clash: [], offbeat: [], triad: [] })
    }
  }, 60000)

  it('checks what the agent wrote, and says what to fix', () => {
    expect(parseScore(SCORE, 15)).toEqual(SCORE)
    expect(scoreBars(SCORE)).toBe(15)
    expect(parseScore(SCORE, 16)).toMatch(/add up to 15 bars; at 120 BPM they must add up to 16/)
    expect(parseScore({ ...SCORE, bpm: 300 }, 15)).toMatch(/bpm/)
    expect(parseScore({ ...SCORE, key: 'H' }, 15)).toMatch(/key/)
    expect(parseScore({ ...SCORE, hits: [{ bar: 16, beat: 1, kind: 'hit' }] }, 15)).toMatch(
      /bar is 1 to 15/,
    )
    expect(parseScore({ ...SCORE, groove: undefined }, 15)).toMatchObject({ groove: 'four' })
  })

  it('writes a playable WAV', () => {
    const bytes = wavBytes(new Float32Array([0, 1]), new Float32Array([0, -1]), 48000)
    expect(Buffer.from(bytes.subarray(0, 4)).toString()).toBe('RIFF')
    expect(bytes.length).toBe(44 + 8)
  })
})
