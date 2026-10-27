import type { CSSProperties, ReactNode } from 'react'
import { AbsoluteFill, Sequence, useCurrentFrame } from 'remotion'

import { beats } from './grid'
import { useReelFrame } from './kit'

/**
 * Beat-locked transitions that start on the cut: from the cut's frame, over half a beat, the
 * outgoing scene leaves and the incoming one takes its place, each drawing only its own part of
 * the frame (a whip moves them side by side like one strip, a wipe's edge splits them), so the
 * frame is never empty and the biggest move lands on the beat. Each style function takes `t`,
 * 0 → 1 across the transition (both sides the same `t`), and returns that side's style. `<Shot>`
 * applies them for you; use the functions directly for anything custom.
 */

/** Which way a transition travels across the frame. */
export type Direction = 'down' | 'left' | 'right' | 'up'

/** A designed transition: a whip pan, a zoom through, or a mask wipe. */
export type TransitionKind = 'whip' | 'wipe' | 'zoom'

const VECTORS: Record<Direction, [number, number]> = {
  down: [0, 1],
  left: [-1, 0],
  right: [1, 0],
  up: [0, -1],
}

const OPPOSITE: Record<Direction, Direction> = {
  down: 'up',
  left: 'right',
  right: 'left',
  up: 'down',
}

/** How far the transition has gone: fastest on the cut, easing to 1. */
const travel = (t: number): number => 1 - (1 - clamp(t)) ** 3

/** How fast it is moving (1 on the cut, 0 settled): the motion blur. */
const speed = (t: number): number => (1 - clamp(t)) ** 2

function clamp(t: number): number {
  return Math.min(1, Math.max(0, t))
}

/** A whip pan's move: sit `offset` frames along `direction`, blurred and stretched with `blur`. */
function whipStyle(offset: number, blur: number, direction: Direction): CSSProperties {
  const [x, y] = VECTORS[direction]
  const stretch = 1 + 0.2 * blur
  return {
    filter: `blur(${(28 * blur).toFixed(2)}px)`,
    transform: `translate(${(x * offset * 100).toFixed(2)}%, ${(y * offset * 100).toFixed(2)}%) scale(${x ? stretch : 1}, ${y ? stretch : 1})`,
  }
}

/** The outgoing side of a whip pan: the scene shoots off in `direction`, blurring. */
export function whipOut(t: number, direction: Direction = 'left'): CSSProperties {
  return whipStyle(travel(t), speed(t), direction)
}

/** The incoming side of a whip pan: the scene follows right behind the outgoing one and settles. */
export function whipIn(t: number, direction: Direction = 'left'): CSSProperties {
  return whipStyle(travel(t) - 1, speed(t), direction)
}

/** Flying through the cut: the outgoing scene scales up past the camera and fades, the incoming
 *  one grows into place in front of it. */
export function zoomThrough(t: number, side: 'in' | 'out'): CSSProperties {
  const m = travel(t)
  const blur = (16 * speed(t)).toFixed(2)
  if (side === 'out') return { filter: `blur(${blur}px)`, opacity: 1 - m, transform: `scale(${1 + 3 * m})` }
  return { filter: `blur(${blur}px)`, opacity: 0.5 + 0.5 * m, transform: `scale(${0.5 + 0.5 * m})` }
}

/** A clip-path inset that hides `amount` (0-1) of the frame from `side`. */
function insetFrom(side: Direction, amount: number): string {
  const p = `${(amount * 100).toFixed(2)}%`
  const edges = { down: '0', left: '0', right: '0', up: '0' }
  // An inset's order is top, right, bottom, left; `up` is the top edge, `down` the bottom.
  edges[side] = p
  return `inset(${edges.up} ${edges.right} ${edges.down} ${edges.left})`
}

/**
 * A mask wipe travelling in `direction`: one edge crosses the frame, the outgoing scene on its far
 * side and the incoming one revealed behind it.
 */
export function maskWipe(
  t: number,
  side: 'in' | 'out',
  direction: Direction = 'left',
): CSSProperties {
  const m = travel(t)
  if (side === 'out') return { clipPath: insetFrom(OPPOSITE[direction], m) }
  return { clipPath: insetFrom(direction, 1 - m) }
}

/** The style of `kind` on its `side` of the cut, `t` 0 → 1 across the transition. */
export function transitionStyle(
  kind: TransitionKind,
  side: 'in' | 'out',
  t: number,
  direction: Direction = 'left',
): CSSProperties {
  if (kind === 'whip') return side === 'out' ? whipOut(t, direction) : whipIn(t, direction)
  if (kind === 'zoom') return zoomThrough(t, side)
  return maskWipe(t, side, direction)
}

/**
 * A light flash on reel frame `at` (put it on a cut: `<Flash at={bar(8)} />`): full on that frame,
 * gone `frames` frames later (2-4 reads as a flash, not a fade). A rare accent: a few per reel at
 * most, never on every beat, kick or note.
 */
export function Flash({
  at,
  color = '#ffffff',
  frames = 3,
  strength = 0.9,
}: {
  at: number
  color?: string
  frames?: number
  strength?: number
}) {
  const frame = useReelFrame()
  if (frame < at || frame >= at + frames) return null
  return (
    <AbsoluteFill
      style={{
        backgroundColor: color,
        opacity: strength * (1 - (frame - at) / frames),
        pointerEvents: 'none',
      }}
    />
  )
}

/**
 * A scene from reel frame `from` up to `to` (the next cut), with an optional designed transition
 * on each side and a flash on its first frame. Give the outgoing shot `exit` and the incoming one
 * the same `enter` and `direction`, and put the incoming shot after it, so the move reads as one:
 * `<Shot from={bar(0)} to={bar(4)} exit="whip">…</Shot><Shot from={bar(4)} to={bar(8)} enter="whip" flash>…</Shot>`.
 * The transition starts on the cut (`to`): a shot with `exit` keeps drawing its leaving part for
 * `transitionBeats` after it, under the incoming shot, so the frame is never empty. Inside a shot,
 * `useCurrentFrame()` counts from its first frame.
 */
export function Shot({
  children,
  direction = 'left',
  enter,
  exit,
  flash = false,
  from,
  to,
  transitionBeats = 0.5,
}: {
  children: ReactNode
  direction?: Direction
  enter?: TransitionKind
  exit?: TransitionKind
  flash?: boolean
  from: number
  to: number
  /** How long a transition lasts from the cut, in beats (half a beat by default). */
  transitionBeats?: number
}) {
  const window = Math.max(1, beats(transitionBeats))
  return (
    <>
      <Sequence durationInFrames={Math.max(1, to - from) + (exit ? window : 0)} from={from}>
        <ShotFrame
          direction={direction}
          enter={enter}
          exit={exit}
          length={to - from}
          window={window}
        >
          {children}
        </ShotFrame>
      </Sequence>
      {flash ? <Flash at={from} /> : null}
    </>
  )
}

/** The shot's frame, moved by its transitions: from its first frame, and past its last one. */
function ShotFrame({
  children,
  direction,
  enter,
  exit,
  length,
  window,
}: {
  children: ReactNode
  direction: Direction
  enter?: TransitionKind
  exit?: TransitionKind
  length: number
  window: number
}) {
  const frame = useCurrentFrame()
  // Both sides are already moving on the cut's frame and settled on the window's last one.
  let style: CSSProperties = {}
  if (exit && frame >= length)
    style = transitionStyle(exit, 'out', (frame - length + 1) / window, direction)
  else if (enter && frame < window)
    style = transitionStyle(enter, 'in', (frame + 1) / window, direction)
  return <AbsoluteFill style={style}>{children}</AbsoluteFill>
}
