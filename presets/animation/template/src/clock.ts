import spec from '../public/animation.json'
import lines from '../public/voice/lines.json'

/**
 * The animation's clock. ReelMakeEasy writes `public/animation.json` from the setup (size, frame
 * rate, length, the music and voice files) and `public/voice/lines.json` from animation_voice:
 * every line's start and end, its words with their times, and its loudness per frame, in seconds
 * from the first frame. Time scenes to the lines (`lineStart(i)`, `wordAt(i, w)`), never to
 * hand-picked frames: then the picture follows the voice when a line is recorded again.
 */
export type Spec = {
  fps: number
  height: number
  lengthSec: number
  lookId: '2d' | '3d' | '8bit' | 'avatar'
  /** File in public/ (the trimmed music), or null. */
  musicFile: null | string
  /** What it is about, or null when Claude picks a fun fact. */
  subject: null | string
  /** File in public/ (every line, joined), or null before animation_voice. */
  voiceFile: null | string
  width: number
}

export type VoiceLine = {
  end: number
  /** Loudness per frame from the line's start, 0..1: drives a mouth. */
  envelope: number[]
  start: number
  text: string
  who: string
  words: { end: number; start: number; text: string }[]
}

export { spec }
export const voiceLines = lines as VoiceLine[]

/** Seconds as frames. */
export const sec = (seconds: number): number => Math.round(seconds * spec.fps)

/** The whole video: its length, or the voice plus a second to land, whichever is longer. */
export const durationInFrames = sec(Math.max(spec.lengthSec, (voiceLines.at(-1)?.end ?? 0) + 1))

/** The frame line `i` starts on (0 before any voice exists). */
export const lineStart = (i: number): number => sec(voiceLines[i]?.start ?? 0)

/** The frame line `i` ends on. */
export const lineEnd = (i: number): number => sec(voiceLines[i]?.end ?? 0)

/** The frame word `w` of line `i` starts on. */
export const wordAt = (i: number, w: number): number =>
  sec(voiceLines[i]?.words[w]?.start ?? voiceLines[i]?.start ?? 0)

/** Whether the video is upright (9:16). */
export const isVertical = spec.height > spec.width
