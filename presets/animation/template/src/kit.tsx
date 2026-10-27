import type { CSSProperties } from 'react'
import {
  Audio,
  Easing,
  interpolate,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion'

import { sec, spec, type VoiceLine, voiceLines } from './clock'

/**
 * Small building blocks for a Claude Animation: the voice, the music under it, captions, and the
 * hooks that tie the picture to what is being said. Remotion's own APIs (and its skills) do the
 * rest. Frames here are the video's own frames (0 = its first frame).
 */

/** How loud the music plays under speech, and between lines. */
const DUCKED = 0.22
const FULL = 0.6
/** Seconds the music takes to dip before a line and to come back after it. */
const RAMP_SEC = 0.25
/** Seconds the music fades out over at the end. */
const FADE_OUT_SEC = 2

/** The voice: every line, joined (absent until animation_voice has recorded them). */
export function Voice() {
  if (!spec.voiceFile) return null
  return <Audio src={staticFile(spec.voiceFile)} />
}

/** How loud the music is on frame `f`: low under any line, up between them, faded at the end. */
export function musicLevel(f: number, durationInFrames: number, volume = 1): number {
  const ramp = sec(RAMP_SEC)
  let level = FULL
  for (const line of voiceLines) {
    const from = sec(line.start)
    const to = sec(line.end)
    const dip = interpolate(f, [from - ramp, from, to, to + ramp], [FULL, DUCKED, DUCKED, FULL], {
      extrapolateLeft: 'clamp',
      extrapolateRight: 'clamp',
    })
    level = Math.min(level, dip)
  }
  const fade = interpolate(f, [durationInFrames - sec(FADE_OUT_SEC), durationInFrames], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
  return volume * level * fade
}

/** The music bed, under the voice (ducked while anyone speaks) and faded out at the end. */
export function Music({ volume = 1 }: { volume?: number }) {
  const { durationInFrames } = useVideoConfig()
  if (!spec.musicFile) return null
  return (
    <Audio
      src={staticFile(spec.musicFile)}
      volume={(f) => musicLevel(f, durationInFrames, volume)}
    />
  )
}

/** A mouth shape for a word: its last vowel sound, or closed (M) for none. */
export type Vowel = 'A' | 'E' | 'I' | 'M' | 'O' | 'U'

export function vowelOf(word: string): Vowel {
  const letters = word.toLowerCase().replace(/[^a-z]/g, '')
  const match = /(oo|ou|ow|ee|ea|ai|ay|a|e|i|o|u|y)(?!.*[aeiouy])/.exec(letters)
  if (!match) return 'M'
  const v = match[1] as string
  if (v === 'oo' || v === 'u') return 'U'
  if (v === 'ou' || v === 'ow' || v === 'o') return 'O'
  if (v === 'ee' || v === 'ea' || v === 'y') return 'E'
  if (v === 'i') return 'I'
  if (v === 'e') return 'E'
  return 'A'
}

export type Speaking = {
  /** The line being said. */
  index: number
  line: VoiceLine
  /** How open the mouth is now, 0..1 (the line's loudness on this frame). */
  mouth: number
  /** The mouth's shape: the current word's vowel. */
  vowel: Vowel
  /** The word being said (-1 between words). */
  wordIndex: number
}

/** Who is speaking on frame `frame` (default: now), or null between lines. */
export function speakingAt(frame: number): null | Speaking {
  const t = frame / spec.fps
  const index = voiceLines.findIndex((l) => t >= l.start && t < l.end)
  if (index === -1) return null
  const line = voiceLines[index] as VoiceLine
  const wordIndex = line.words.findIndex((w) => t >= w.start && t < w.end)
  const level = line.envelope[frame - sec(line.start)] ?? 0
  const word = line.words[wordIndex]
  return {
    index,
    line,
    mouth: word ? Math.min(1, level * 1.6) : 0,
    vowel: word ? vowelOf(word.text) : 'M',
    wordIndex,
  }
}

/** `speakingAt` for the current frame. */
export function useSpeaking(): null | Speaking {
  return speakingAt(useCurrentFrame())
}

/** Whether `who` is speaking now (mouth open by `mouth`), or 0 when someone else is. */
export function useMouth(who: string): { mouth: number; vowel: Vowel } {
  const now = useSpeaking()
  if (!now || now.line.who !== who) return { mouth: 0, vowel: 'M' }
  return { mouth: now.mouth, vowel: now.vowel }
}

/**
 * Captions: the line being said, the current word lit in `accent`. Sits in the lower third, inside
 * the safe margin, at least 3% of the frame's height. Up to `maxWords` words around the current one.
 */
export function Captions({
  accent = '#FFD166',
  color = '#FFFFFF',
  fontFamily = 'Inter, Helvetica, Arial, sans-serif',
  maxWords = 6,
  style,
}: {
  accent?: string
  color?: string
  fontFamily?: string
  maxWords?: number
  style?: CSSProperties
}) {
  const { height, width } = useVideoConfig()
  const now = useSpeaking()
  if (!now) return null
  const words = now.line.words
  const at = Math.max(0, now.wordIndex)
  const first = Math.max(0, Math.min(at - Math.floor(maxWords / 2), words.length - maxWords))
  const shown = words.slice(first, first + maxWords)
  return (
    <div
      style={{
        bottom: height * 0.16,
        color,
        fontFamily,
        fontSize: Math.max(height * 0.034, 40),
        fontWeight: 800,
        left: width * 0.06,
        lineHeight: 1.15,
        position: 'absolute',
        right: width * 0.06,
        textAlign: 'center',
        textShadow: '0 4px 14px rgba(0,0,0,0.55)',
        ...style,
      }}
    >
      {shown.map((w, i) => (
        <span
          key={`${now.index}-${first + i}`}
          style={{ color: first + i === at ? accent : color }}
        >
          {w.text}{' '}
        </span>
      ))}
    </div>
  )
}

/** Easings: `snap` for things arriving, `glide` for camera moves. Nothing moves linearly except a
 *  constant drift. */
export const ease = {
  glide: Easing.bezier(0.45, 0, 0.2, 1),
  snap: Easing.bezier(0.2, 0.9, 0.1, 1),
}

/** 0..1 from frame `from` over `frames` frames, eased. */
export function useProgressAt(from: number, frames: number, easing = ease.glide): number {
  const f = useCurrentFrame()
  return interpolate(f, [from, from + Math.max(1, frames)], [0, 1], {
    easing,
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
}

/** A springy 0..1 (overshooting a little) from frame `from`: for things popping in. */
export function usePopAt(from: number): number {
  const f = useCurrentFrame()
  const { fps } = useVideoConfig()
  return spring({ config: { damping: 11, mass: 0.6 }, fps, frame: f - from })
}
