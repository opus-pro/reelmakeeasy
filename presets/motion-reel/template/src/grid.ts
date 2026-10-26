import reel from '../public/reel.json'

/**
 * What the music plays when, in seconds from the reel's first frame: kicks, snares, melody notes
 * (strength 1 = the phrase's accented notes), chord changes, and its sections in order (energy 0
 * ambient .. 3 peak). `reel/music-map.md` shows the same, bar by bar.
 */
export type MusicEvents = {
  chords: number[]
  kicks: number[]
  melody: { strength: number; t: number }[]
  sections: { endSec: number; energy: 0 | 1 | 2 | 3; name: string; startSec: number }[]
  snares: number[]
}

/**
 * The reel's clock. ReelMakeEasy writes `public/reel.json` from the setup card and the music's beat
 * grid: size, frame rate, length (whole bars), tempo, and the beats, bar starts, strongest hits and
 * music events, in seconds from the reel's first frame. Time everything with these helpers, in
 * beats and bars, never in hand-picked frames: then every cut, move and sound lands on the music.
 */
export type Reel = {
  bars: number
  beats: number[]
  beatsPerBar: number
  bpm: number
  downbeats: number[]
  durationInFrames: number
  events: MusicEvents
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

/** A section of the music in frames: `from` is its first frame, `to` the first frame after it. */
export type Section = { energy: 0 | 1 | 2 | 3; from: number; name: string; to: number }

export const grid = reel as Reel

/** Seconds per beat. */
export const beatSec = 60 / grid.bpm

/** The frame for a time in seconds. */
export const frameAt = (seconds: number): number => Math.round(seconds * grid.fps)

/** The time of beat `i` in seconds: the detected beat, or past the last one, on at the tempo. */
function beatTime(i: number): number {
  const detected = grid.beats[i]
  if (detected !== undefined) return detected
  const last = grid.beats.length - 1
  return last >= 0 ? (grid.beats[last] ?? 0) + (i - last) * beatSec : i * beatSec
}

/**
 * The frame of beat `n` (0 = the reel's first frame). Fractions work: `beat(2.5)` is the half-beat
 * after beat 2. Uses the music's detected beats, so it follows the real track; past the last one it
 * continues at the tempo.
 */
export function beat(n: number): number {
  const whole = Math.floor(n)
  const seconds = beatTime(whole) + (n - whole) * (beatTime(whole + 1) - beatTime(whole))
  return frameAt(seconds)
}

/** The frame bar `n` starts on (0 = the first bar). */
export const bar = (n: number): number => beat(n * grid.beatsPerBar)

/** A length of `count` beats, in frames (from the tempo). */
export const beats = (count: number): number => Math.round(count * beatSec * grid.fps)

/** A length of `count` bars, in frames. */
export const bars = (count: number): number => beats(count * grid.beatsPerBar)

/**
 * The beat a frame sits on, with its fraction (the inverse of `beat()`): `beatOf(beat(6.5))` is
 * 6.5. Handy to read a still or a sync report frame back as a beat.
 */
export function beatOf(frame: number): number {
  const seconds = frame / grid.fps
  let i = 0
  while (beatTime(i + 1) <= seconds) i++
  const span = beatTime(i + 1) - beatTime(i)
  return Math.round((i + (seconds - beatTime(i)) / span) * 100) / 100
}

/** The strongest hits in the music, as frames, earliest first (good places for the biggest moments). */
export const hitFrames = (): number[] => grid.strongHits.map(frameAt).sort((a, b) => a - b)

/** The kick drum's hits, as frames: drive the background pulse with them (`usePulse(kicks())`). */
export const kicks = (): number[] => grid.events.kicks.map(frameAt)

/** The snare and clap hits, as frames: secondary accents (a flicker, a shake, a second element). */
export const snares = (): number[] => grid.events.snares.map(frameAt)

/**
 * The melody's note starts, as frames, over the whole reel: bring elements in on them, a scene's
 * own notes taken with `eventsBetween` (`usePopOn(eventsBetween(melody(0.8), from, to), i)`).
 * `minStrength` keeps only the stronger notes: 0.8 and up are the accents.
 */
export const melody = (minStrength = 0): number[] =>
  grid.events.melody.filter((note) => note.strength >= minStrength).map((note) => frameAt(note.t))

/** Where the harmony changes, as frames: good places for a colour or a layout change. */
export const chordChanges = (): number[] => grid.events.chords.map(frameAt)

/** The music's sections in frames, in order: one world (look and technique) per section. */
export const sections = (): Section[] =>
  grid.events.sections.map((section) => ({
    energy: section.energy,
    from: frameAt(section.startSec),
    name: section.name,
    to: frameAt(section.endSec),
  }))

/** The section a frame is in (the last one past the end, the first one before it starts). */
export function sectionAt(frame: number): Section {
  const all = sections()
  const found = all.find((section) => frame >= section.from && frame < section.to)
  const edge = frame < 0 ? all[0] : all.at(-1)
  return found ?? edge ?? { energy: 2, from: 0, name: 'groove', to: grid.durationInFrames }
}

/** The frames in `list` from `from` up to (not including) `to`: the events inside one scene. */
export const eventsBetween = (list: number[], from: number, to: number): number[] =>
  list.filter((frame) => frame >= from && frame < to)

/** True for a vertical reel, so layouts can stack instead of sitting side by side. */
export const isVertical = grid.height > grid.width
