import type { ReactNode } from 'react'
import { Audio, Easing, interpolate, Sequence, spring, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'

import { beats, grid } from './grid'

/**
 * Small building blocks for a Motion Reel. Remotion's own APIs (and its skills) do the rest.
 */

/** The music bed: the trimmed track, faded out over the reel's last half bar. */
export function Music({ volume = 1 }: { volume?: number }) {
  const { durationInFrames, fps } = useVideoConfig()
  if (!grid.music) return null
  const fadeFrames = Math.max(1, Math.round(grid.fadeOutSec * fps))
  return (
    <Audio
      src={staticFile(grid.music)}
      volume={(f) =>
        volume * interpolate(f, [durationInFrames - fadeFrames, durationInFrames], [1, 0], {
          extrapolateLeft: 'clamp',
          extrapolateRight: 'clamp',
        })
      }
    />
  )
}

export type SfxName =
  | 'click'
  | 'glitch'
  | 'hit'
  | 'pop'
  | 'riser'
  | 'shimmer'
  | 'sub-drop'
  | 'swish'
  | 'tick'
  | 'whoosh'

/** Seconds a riser builds before its peak (it starts this much before `at`). */
const RISER_LEAD_SEC = 2

/**
 * A sound effect on frame `at` (use beat()/bar() for it). A riser is placed to peak on `at`: it
 * starts two seconds earlier. Keep effects under the music: 0.5 to 0.8 is usually right.
 */
export function Sfx({ at, name, volume = 0.7 }: { at: number; name: SfxName; volume?: number }) {
  const { fps } = useVideoConfig()
  const from = name === 'riser' ? at - Math.round(RISER_LEAD_SEC * fps) : at
  if (from < 0) return null
  return (
    <Sequence from={from} layout="none">
      <Audio src={staticFile(`sfx/${name}.wav`)} volume={volume} />
    </Sequence>
  )
}

/** A scene that starts on frame `from` and lasts `forBeats` beats. */
export function Scene({ children, forBeats, from }: { children: ReactNode; forBeats: number; from: number }) {
  return (
    <Sequence durationInFrames={beats(forBeats)} from={from}>
      {children}
    </Sequence>
  )
}

/** House easings: `snap` for fast settles, `glide` for calm moves, `anticipate` to wind up first. */
export const ease = {
  anticipate: Easing.bezier(0.68, -0.4, 0.32, 1.4),
  glide: Easing.bezier(0.45, 0, 0.2, 1),
  snap: Easing.bezier(0.16, 1, 0.3, 1),
}

/** 0 → 1 over `durationFrames` from `start`, with an easing (snap by default), clamped. */
export function useProgress(start: number, durationFrames: number, easing = ease.snap): number {
  const frame = useCurrentFrame()
  return interpolate(frame, [start, start + durationFrames], [0, 1], {
    easing,
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
}

/** A spring from `start` that overshoots a little and settles: the snappy pop of most reels. */
export function useOvershoot(start: number, damping = 12): number {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  return spring({ config: { damping, mass: 0.6, stiffness: 180 }, fps, frame: frame - start })
}
