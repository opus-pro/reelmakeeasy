import reel from '../public/reel.json'

/**
 * The reel's clock. ReelMakeEasy writes `public/reel.json` from the setup card and the music's beat
 * grid: size, frame rate, length (whole bars), tempo, and the beats, bar starts and strongest hits
 * of the music, in seconds from the reel's first frame. Time everything with these helpers, in
 * beats and bars, never in hand-picked frames: then every cut, move and sound lands on the music.
 */
export type Reel = {
  bars: number
  beats: number[]
  beatsPerBar: number
  bpm: number
  downbeats: number[]
  durationInFrames: number
  fadeOutSec: number
  fps: number
  height: number
  lengthSec: number
  /** File in public/ (the trimmed music), or null for a reel without music. */
  music: null | string
  ratio: '1:1' | '16:9' | '9:16'
  strongHits: number[]
  /** What the reel is about, from the setup card. */
  subject: string
  width: number
}

export const grid = reel as Reel

/** Seconds per beat. */
export const beatSec = 60 / grid.bpm

/** The frame for a time in seconds. */
export const frameAt = (seconds: number): number => Math.round(seconds * grid.fps)

/**
 * The frame of beat `n` (0 = the reel's first frame). Fractions work: `beat(2.5)` is the half-beat
 * after beat 2. Uses the music's detected beats, so it follows the real track; past the last one it
 * continues at the tempo.
 */
export function beat(n: number): number {
  const whole = Math.floor(n)
  const at = (i: number): number => {
    const detected = grid.beats[i]
    if (detected !== undefined) return detected
    const last = grid.beats.length - 1
    return last >= 0 ? (grid.beats[last] ?? 0) + (i - last) * beatSec : i * beatSec
  }
  const seconds = at(whole) + (n - whole) * (at(whole + 1) - at(whole))
  return frameAt(seconds)
}

/** The frame bar `n` starts on (0 = the first bar). */
export const bar = (n: number): number => beat(n * grid.beatsPerBar)

/** A length of `count` beats, in frames (from the tempo). */
export const beats = (count: number): number => Math.round(count * beatSec * grid.fps)

/** A length of `count` bars, in frames. */
export const bars = (count: number): number => beats(count * grid.beatsPerBar)

/** The strongest hits in the music, as frames, earliest first (good places for the biggest moments). */
export const hitFrames = (): number[] => grid.strongHits.map(frameAt).sort((a, b) => a - b)

/** True for a vertical reel, so layouts can stack instead of sitting side by side. */
export const isVertical = grid.height > grid.width
