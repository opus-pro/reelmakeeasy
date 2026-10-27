import type { CSSProperties } from 'react'
import {
  Audio,
  Easing,
  interpolate,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion'

import { captionChunks, chunkAt } from './caption-chunks'
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

/** The sound effects in `public/sfx/` (ReelMakeEasy puts them there). */
export const SFX = [
  'whoosh',
  'swish',
  'riser',
  'tick',
  'click',
  'pop',
  'hit',
  'sub-drop',
  'glitch',
  'shimmer',
  'boing',
  'boop',
  'bubble',
  'chime',
  'coin',
  'ding',
  'shutter',
  'slide-down',
  'slide-up',
  'tada',
  'twinkle',
  'typing',
  'zip',
] as const
export type SfxName = (typeof SFX)[number]

/** A sound effect at `at` seconds (put it on the word or entrance it belongs to). `volume` 0..1:
 *  0.3-0.6 sits under the voice. A riser builds for 2 s and peaks on `at`. */
export function Sfx({ at, name, volume = 0.45 }: { at: number; name: SfxName; volume?: number }) {
  const from = name === 'riser' ? at - 2 : at
  return (
    <Sequence from={Math.max(0, sec(from))} layout="none" name={`sfx ${name}`}>
      <Audio src={staticFile(`sfx/${name}.wav`)} volume={volume} />
    </Sequence>
  )
}

/** A sound cue: what plays when. */
export type SoundCue = { at: number; name: SfxName; volume?: number }

/** Every sound cue of a list (`<Sounds cues={SOUNDS} />` in `Animation.tsx`). */
export function Sounds({ cues }: { cues: SoundCue[] }) {
  return (
    <>
      {cues.map((c, i) => (
        <Sfx at={c.at} key={`${c.name}-${c.at}-${i}`} name={c.name} volume={c.volume} />
      ))}
    </>
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
 * Captions: the line being said, a phrase at a time as the app's captions page (1 to `maxWords`
 * words, a phrase ending after punctuation; see `caption-chunks.ts`), the word being said lit in
 * `accent`. A phrase stays whole until the next one: never a window sliding a word at a time.
 * Sits in the lower third by default (`bottom`, a share of the height), inside the safe margin,
 * at least 3% of the frame's height. `box` puts a soft dark plate behind it (over a busy picture
 * or a face).
 */
export function Captions({
  accent = '#FFD166',
  bottom = 0.16,
  box = false,
  color = '#FFFFFF',
  fontFamily = 'Inter, Helvetica, Arial, sans-serif',
  maxWords = 3,
  style,
}: {
  accent?: string
  bottom?: number
  box?: boolean
  color?: string
  fontFamily?: string
  maxWords?: number
  style?: CSSProperties
}) {
  const { height, width } = useVideoConfig()
  const t = useCurrentFrame() / spec.fps
  const line = voiceLines.find((l) => t >= l.start - 0.1 && t <= l.end + 0.4)
  const chunk = line ? chunkAt(captionChunks(line.words, maxWords), t) : null
  if (!chunk) return null
  const fontSize = Math.max(height * 0.034, 40)
  return (
    <div
      style={{
        bottom: height * bottom,
        display: 'flex',
        justifyContent: 'center',
        left: width * 0.06,
        position: 'absolute',
        right: width * 0.06,
        ...style,
      }}
    >
      <div
        style={{
          ...(box
            ? {
                background: 'rgba(10,12,20,0.62)',
                borderRadius: fontSize * 0.4,
                padding: `${fontSize * 0.18}px ${fontSize * 0.45}px`,
              }
            : {}),
          color,
          fontFamily,
          fontSize,
          fontWeight: 800,
          lineHeight: 1.15,
          textAlign: 'center',
          textShadow: '0 4px 14px rgba(0,0,0,0.55)',
        }}
      >
        {chunk.words.map((w, i) => (
          <span
            key={`${chunk.from}-${i}`}
            style={{ color: t >= w.start && t < w.end + 0.08 ? accent : color }}
          >
            {w.text}
            {i < chunk.words.length - 1 ? ' ' : ''}
          </span>
        ))}
      </div>
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
