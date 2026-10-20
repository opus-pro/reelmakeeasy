import { SOUND_ANALYSIS_RATE as SR } from './decode-audio'
import {
  describeSound,
  detectOnsets,
  findPulse,
  type LibraryPrint,
  matchSound,
  printOfSound,
  spectrogram,
} from './sound-analysis'

/** A seeded noise source, so the tests never flake. */
function noise(seed: number): () => number {
  let s = seed
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296
    return s / 2147483648 - 1
  }
}

function make(sec: number, fn: (t: number, i: number) => number): Float32Array {
  const out = new Float32Array(Math.round(sec * SR))
  for (let i = 0; i < out.length; i++) out[i] = fn(i / SR, i)
  return out
}

const rnd = noise(7)
const SOUNDS: Record<string, Float32Array> = {
  bell: make(1.2, (t) => Math.sin(2 * Math.PI * 880 * t) * Math.exp(-t * 3)),
  boom: make(0.8, (t) => Math.sin(2 * Math.PI * (70 - 30 * t) * t) * Math.exp(-t * 5)),
  chirp: make(0.5, (t) => Math.sin(2 * Math.PI * (600 * t + 800 * t * t)) * (t < 0.45 ? 1 : 0)),
  hit: make(0.2, (t) =>
    (Math.sin(2 * Math.PI * 2100 * t) + Math.sin(2 * Math.PI * 3300 * t) + Math.sin(2 * Math.PI * 4900 * t)) *
    Math.exp(-t * 25) / 3,
  ),
  whoosh: make(0.8, (t) => rnd() * Math.sin((Math.PI * t) / 0.8) ** 2),
}

/** A clip's soundtrack: a chord that swells, and hiss. */
const bed = (sec: number) => {
  const hiss = noise(3)
  return make(sec, (t) => {
    const swell = 0.5 + 0.5 * Math.sin(2 * Math.PI * 0.3 * t)
    return (
      0.08 * swell * (Math.sin(2 * Math.PI * 220 * t) + Math.sin(2 * Math.PI * 277 * t) + Math.sin(2 * Math.PI * 330 * t)) +
      0.01 * hiss()
    )
  })
}

function mix(base: Float32Array, sound: Float32Array, atSec: number, gain: number): void {
  const at = Math.round(atSec * SR)
  for (let i = 0; i < sound.length && at + i < base.length; i++) base[at + i] = (base[at + i] as number) + gain * (sound[i] as number)
}

const PLACED = [
  { atSec: 1, name: 'boom' },
  { atSec: 2.3, name: 'hit' },
  { atSec: 3.6, name: 'chirp' },
  { atSec: 5, name: 'whoosh' },
]

const library: LibraryPrint[] = Object.entries(SOUNDS).map(([name, samples]) => ({
  id: name,
  name,
  print: printOfSound(spectrogram(samples)) as Float64Array,
}))

describe('sound analysis', () => {
  const track = bed(6.5)
  for (const p of PLACED) mix(track, SOUNDS[p.name] as Float32Array, p.atSec, 0.5)
  const spec = spectrogram(track)
  const onsets = detectOnsets(spec)

  it('finds where each sound effect starts, over a swelling bed', () => {
    for (const p of PLACED) expect(onsets.some((o) => Math.abs(o.atSec - p.atSec) < 0.04)).toBe(true)
    expect(onsets.length).toBeLessThanOrEqual(PLACED.length + 2)
  })

  it('names the library sound that plays at each one, and only that one', () => {
    for (const p of PLACED) {
      const onset = onsets.find((o) => Math.abs(o.atSec - p.atSec) < 0.04)
      expect(matchSound(spec, onset?.atSec ?? p.atSec, library).match?.name).toBe(p.name)
    }
  })

  it('names nothing when the sound is not in the library', () => {
    const without = library.filter((s) => s.name !== 'hit')
    expect(matchSound(spec, 2.3, without).match).toBeNull()
  })

  it('still matches a quieter, louder or re-encoded copy (gain does not matter)', () => {
    const quiet = bed(3)
    mix(quiet, SOUNDS['boom'] as Float32Array, 1, 0.2)
    expect(matchSound(spectrogram(quiet), 1, library).match?.name).toBe('boom')
  })

  it('describes a sound so the user can look for it', () => {
    expect(describeSound(spec, 1).description).toMatch(/low boom/)
    expect(describeSound(spec, 2.3).description).toMatch(/short bright hit/)
    expect(describeSound(spec, 5).description).toMatch(/whoosh/)
  })

  it('finds nothing in silence', () => {
    expect(detectOnsets(spectrogram(new Float32Array(SR * 2)))).toEqual([])
  })

  it("doesn't name a sound when two library sounds are just as close", () => {
    const twin = [...library, { id: 'boom2', name: 'boom copy', print: library.find((s) => s.name === 'boom')!.print }]
    const result = matchSound(spec, 1, twin)
    expect(result.match).toBeNull()
    expect(result.maybe.map((m) => m.name).toSorted()).toEqual(['boom', 'boom copy'])
  })

  it('finds a steady music beat and the onsets on it, apart from a sound effect between beats', () => {
    const kick = make(0.15, (t) => Math.sin(2 * Math.PI * 55 * t) * Math.exp(-t * 30))
    const beat = bed(8)
    for (let t = 0.25; t < 8; t += 0.5) mix(beat, kick, t, 0.6)
    mix(beat, SOUNDS['hit'] as Float32Array, 3.62, 0.6)
    const onsets = detectOnsets(spectrogram(beat))
    const pulse = findPulse(onsets)
    expect(pulse?.bpm).toBe(120)
    const hit = onsets.findIndex((o) => Math.abs(o.atSec - 3.62) < 0.04)
    expect(hit).toBeGreaterThanOrEqual(0)
    expect(pulse?.onPulse.has(hit)).toBe(false)
    expect(pulse?.onPulse.size).toBeGreaterThanOrEqual(10)
  })

  it('finds no beat in a few scattered sounds', () => {
    expect(findPulse(onsets)).toBeNull()
  })
})

