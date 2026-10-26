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

  it('knows its events exactly: kicks per groove, the lead, the chords and the sections', () => {
    const bar = (b: number, times: number[]) => times.filter((t) => t >= b * 2 && t < b * 2 + 2)
    const kicksPerBar = (groove: Score['groove']) => {
      const out = renderScore(
        {
          ...SCORE,
          groove,
          hits: [],
          sections: [
            { bars: 1, energy: 1, name: 'intro' },
            { bars: 1, energy: 2, name: 'groove' },
            { bars: 1, energy: 3, name: 'drop' },
            { bars: 1, energy: 0, name: 'stop' },
          ],
        },
        { tailSec: 1 },
      )
      const { kicks } = out.plan.events
      return [0, 1, 2, 3, 4].map((b) => bar(b, kicks).length)
    }
    // Energy 1: the bar's first beat; 2: the groove; 3: the groove's peak pattern; 0: none; then
    // the final hit.
    expect(kicksPerBar('four')).toEqual([1, 4, 4, 0, 1])
    expect(kicksPerBar('backbeat')).toEqual([1, 2, 3, 0, 1])
    expect(kicksPerBar('half')).toEqual([1, 1, 2, 0, 1])

    const { events } = renderScore(SCORE, { tailSec: 2.5 }).plan
    // Snares: two a bar in the groove and the drop, the fill into the drop capped at two a beat.
    expect(bar(2, events.snares)).toEqual([4.5, 5.5])
    expect(bar(9, events.snares)).toEqual([19.75, 19.875])
    expect(bar(3, events.kicks)).toEqual([6, 7])
    // The lead's motif: on-beat notes are the accents; a stab is one note (here on a lead note).
    const lead = events.melody.filter((m) => m.t >= 4 && m.t < 6)
    expect(lead.filter((m) => m.strength === 1).map((m) => m.t)).toEqual([4, 4.5, 5, 5.5])
    expect(lead.every((m) => m.strength === 1 || m.strength === 0.6)).toBe(true)
    expect(events.melody.filter((m) => m.t === 23)).toEqual([{ strength: 1, t: 23 }])
    const stab = renderScore(
      { ...SCORE, hits: [{ bar: 9, beat: 2, kind: 'stab' }] },
      { tailSec: 1 },
    ).plan.events.melody.filter((m) => m.t >= 16 && m.t < 20)
    expect(stab).toEqual([{ strength: 0.8, t: 16.5 }])
    // The stop has no lead; the intro plays it on every other bar.
    expect(events.melody.some((m) => m.t >= 16 && m.t < 20)).toBe(false)
    expect(events.melody.some((m) => m.t >= 2 && m.t < 4)).toBe(false)
    expect(events.chords.slice(0, 4)).toEqual([0, 6, 8, 10])
    expect(events.sections).toEqual([
      { endSec: 4, energy: 1, name: 'intro', startSec: 0 },
      { endSec: 16, energy: 2, name: 'groove', startSec: 4 },
      { endSec: 20, energy: 0, name: 'stop', startSec: 16 },
      { endSec: 30, energy: 3, name: 'drop', startSec: 20 },
      { endSec: 32.5, energy: 3, name: 'final hit', startSec: 30 },
    ])
  }, 60000)

  it('writes a playable WAV', () => {
    const bytes = wavBytes(new Float32Array([0, 1]), new Float32Array([0, -1]), 48000)
    expect(Buffer.from(bytes.subarray(0, 4)).toString()).toBe('RIFF')
    expect(bytes.length).toBe(44 + 8)
  })
})
