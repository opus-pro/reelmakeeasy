import type { ReactNode } from 'react'
import {
  Audio,
  Easing,
  Internals,
  interpolate,
  Sequence,
  spring,
  staticFile,
  useCurrentFrame,
  useVideoConfig,
} from 'remotion'

import { beats, grid } from './grid'

/**
 * Small building blocks for a Motion Reel. Remotion's own APIs (and its skills) do the rest.
 * Two clocks: the `…At` hooks and the music hooks (`useProgressAt`, `useOvershootAt`, `usePulse`,
 * `useHitIndex`, `usePopOn`) take reel frames, straight from `beat()`, `bar()`, `kicks()` or
 * `melody()`, and work the same inside any scene; `useProgress` and `useOvershoot` count in the
 * scene's own frames (0 = its first frame), for moves timed from the scene's start.
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
        volume *
        interpolate(f, [durationInFrames - fadeFrames, durationInFrames], [1, 0], {
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
export function Scene({
  children,
  forBeats,
  from,
}: {
  children: ReactNode
  forBeats: number
  from: number
}) {
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

/** 0 → 1 over `durationFrames` from `frame` `start`, with an easing (snap by default), clamped. */
function progressAt(frame: number, start: number, durationFrames: number, easing: Easer): number {
  return interpolate(frame, [start, start + durationFrames], [0, 1], {
    easing,
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  })
}

/** An easing: 0 → 1 in, 0 → 1 out. */
type Easer = (t: number) => number

/** 0 → 1 over `durationFrames` from scene frame `start` (0 = the scene's first frame), eased. */
export function useProgress(start: number, durationFrames: number, easing = ease.snap): number {
  return progressAt(useCurrentFrame(), start, durationFrames, easing)
}

/** 0 → 1 over `durationFrames` from reel frame `at` (`beat(17)`, `bar(4)`), eased: the same in
 *  any scene. */
export function useProgressAt(at: number, durationFrames: number, easing = ease.snap): number {
  return progressAt(useReelFrame(), at, durationFrames, easing)
}

/** A spring from scene frame `start` that overshoots a little and settles: the snappy pop of most
 *  reels. */
export function useOvershoot(start: number, damping = 12): number {
  const frame = useCurrentFrame()
  const { fps } = useVideoConfig()
  return spring({ config: { damping, mass: 0.6, stiffness: 180 }, fps, frame: frame - start })
}

/** `useOvershoot` from reel frame `at` (`beat(17)`): 0 before it. */
export function useOvershootAt(at: number, damping = 12): number {
  return usePopOn([at], 0, damping)
}

/** The reel's frame (0 = its first frame), also inside a `<Sequence>` (whose `useCurrentFrame`
 *  counts from the scene's start). */
export function useReelFrame(): number {
  return Internals.useTimelinePosition()
}

/** The index of the last frame in `frames` at or before `frame` (-1 before the first). */
function lastAtOrBefore(frames: number[], frame: number): number {
  let index = -1
  for (const [i, at] of frames.entries()) {
    if (at > frame) break
    index = i
  }
  return index
}

/**
 * The music's pulse: 1 on each event's frame, easing to 0 over `decayBeats`. Drive the background
 * with the kick (`usePulse(kicks())`): a scale of `1 + 0.02 * pulse`, a glow, a grid flash.
 * `frames` are reel frames, earliest first.
 */
export function usePulse(frames: number[], decayBeats = 0.5): number {
  const frame = useReelFrame()
  const last = frames[lastAtOrBefore(frames, frame)]
  if (last === undefined) return 0
  const t = (frame - last) / Math.max(1, beats(decayBeats))
  return t >= 1 ? 0 : (1 - t) * (1 - t)
}

/**
 * Which event of `frames` the reel is past (`index`, -1 before the first) and how far it has
 * settled (`progress`, 0 → 1 over `settleBeats`, snap-eased). The nth melody note can bring in the
 * nth element: show element i when `index >= i`.
 */
export function useHitIndex(
  frames: number[],
  settleBeats = 0.5,
): { index: number; progress: number } {
  const frame = useReelFrame()
  const index = lastAtOrBefore(frames, frame)
  const at = frames[index]
  if (at === undefined) return { index, progress: 0 }
  const t = Math.min(1, (frame - at) / Math.max(1, beats(settleBeats)))
  return { index, progress: ease.snap(t) }
}

/**
 * A pop for element `index`, on the frame of event `index` in `frames`: 0 before it, then a spring
 * that overshoots a little and settles (as `useOvershoot`). `frames` are reel frames and `index`
 * counts from the first of them, so give it the scene's own events:
 * `usePopOn(eventsBetween(melody(0.8), bar(8), bar(12)), i)` pops the scene's element i on its
 * i-th accented note (with all of `melody(0.8)`, a later scene's notes 0, 1, 2 are long gone).
 */
export function usePopOn(frames: number[], index: number, damping = 12): number {
  const frame = useReelFrame()
  const { fps } = useVideoConfig()
  const at = frames[index]
  if (at === undefined || frame < at) return 0
  return spring({ config: { damping, mass: 0.6, stiffness: 180 }, fps, frame: frame - at })
}
