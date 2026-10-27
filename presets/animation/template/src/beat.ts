import grid from '../public/music.json'

/**
 * The music's beat grid, so the picture can move with it. ReelMakeEasy writes `public/music.json`
 * from the music under the video (measured on a track, exact for a score Claude composed): every
 * beat, bar start (downbeat), kick, snare and loud hit, and the music's sections, in seconds from
 * the first frame. With no music, `music.bpm` is null and every helper returns 0 or null.
 */
export type MusicGrid = {
  /** The loudest hits, in time order. */
  accents: number[]
  beats: number[]
  beatsPerBar: number
  bpm: null | number
  downbeats: number[]
  kicks: number[]
  sections: { endSec: number; energy: number; name: string; startSec: number }[]
  snares: number[]
}

export const music = grid as MusicGrid

export type BeatKind = 'accents' | 'beats' | 'downbeats' | 'kicks' | 'snares'

/** The last `kind` at or before t (seconds), or null. */
export function lastBeat(t: number, kind: BeatKind = 'beats'): null | number {
  let found: null | number = null
  for (const b of music[kind]) {
    if (b > t) break
    found = b
  }
  return found
}

/** The first `kind` after t, or null. */
export function nextBeat(t: number, kind: BeatKind = 'beats'): null | number {
  return music[kind].find((b) => b > t) ?? null
}

/** 1 on each `kind` (a beat, a bar start, a kick…), easing back to 0 over `decay` seconds. For a
 *  gentle pulse of something already on screen: a glow, a bounce of 2-4%, a background shape. */
export function beatPulse(t: number, kind: BeatKind = 'beats', decay = 0.25): number {
  const b = lastBeat(t, kind)
  if (b === null) return 0
  const k = (t - b) / decay
  return k >= 1 ? 0 : (1 - k) ** 2
}

/** Where t is inside the current beat, 0..1 (0 on the beat). 0 with no music. */
export function beatPhase(t: number): number {
  const b = lastBeat(t)
  if (b === null || !music.bpm) return 0
  return Math.min(1, (t - b) / (60 / music.bpm))
}

/** How many beats have passed at t (0 before the first). */
export function beatIndex(t: number): number {
  let n = 0
  for (const b of music.beats) {
    if (b > t) break
    n++
  }
  return n
}

/** t moved onto the nearest `kind` when one is within `within` seconds (else t itself): to land an
 *  entrance that is free to move (not tied to a word) on the music. */
export function onBeat(t: number, kind: BeatKind = 'beats', within = 0.25): number {
  let best = t
  let gap = within
  for (const b of music[kind]) {
    const d = Math.abs(b - t)
    if (d <= gap) {
      best = b
      gap = d
    }
  }
  return best
}

/** The music's section at t (its name and energy 0-3), or null. */
export function sectionAt(t: number): MusicGrid['sections'][number] | null {
  return music.sections.find((s) => t >= s.startSec && t < s.endSec) ?? null
}
