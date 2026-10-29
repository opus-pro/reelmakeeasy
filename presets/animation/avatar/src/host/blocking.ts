import { voiceLines } from '../clock'

import type { Shot } from './framing'
import type { Cue } from './pose'

/**
 * Blocking: where the host stands over time, and how the picture changes between lines.
 *
 * The host walks from spot to spot (a shot change, or a `move` cue mid-line) instead of jumping:
 * a couple of steps, leaning into the walk, the board following. A line can also change the whole
 * scene on its way in, the way a Motion Reel cuts:
 * - `move` (the default): the set stays, the host walks to the line's spot.
 * - `cut`: a hard cut to the line's shot, nothing travels.
 * - `slide`: the camera slides to the next stop, set and board moving as one strip, while the
 *   host walks across; give each stop its own set.
 * - `whip`: the whole frame, host and all, whips off sideways with motion blur; the next scene
 *   follows right behind.
 * - `zoom`: the camera flies through the old scene into the new one.
 * - `iris`: the new scene opens as a growing circle from the host's face (or `irisAt`).
 * - `flip`: the set and board turn over like a card, the host standing in front.
 * - `drop`: the next page falls in from the top and lands on the old one with a bounce.
 * - `blinds`: diagonal stripes sweep across and close into the new scene.
 */
export type Transition =
  | 'blinds'
  | 'cut'
  | 'drop'
  | 'flip'
  | 'iris'
  | 'move'
  | 'slide'
  | 'whip'
  | 'zoom'

/** Seconds a walk from one spot to another takes. */
export const MOVE_SEC = 0.7
/** Seconds a scene transition takes, from the cut. */
export const TRANSITION_SEC = 0.55
/** The cut sits this long before a line's first word. */
const LEAD = 0.12

/** A place the host goes, from `at` (a line's cut or a `move` cue). `jump`: no walk. */
export type Stop = { at: number; jump: boolean; shot: Shot }

/** When line i's shot and transition begin. */
export function cutAt(i: number): number {
  return i === 0 ? -1 : (voiceLines[i]?.start ?? 0) - LEAD
}

/** The host's stops, in time order: each line's shot from its cut, and the `move` cues. A whip,
 *  a zoom or a cut carries the host along with the frame, so those lines jump. */
export function hostStops(shots: Shot[], cues: Cue[], transitions: Transition[] = []): Stop[] {
  const stops: Stop[] = voiceLines.map((_, i) => ({
    at: cutAt(i),
    jump: i === 0 || ['cut', 'whip', 'zoom'].includes(transitions[i] ?? 'move'),
    shot: shots[i] ?? 'medium',
  }))
  for (const c of cues) if (c.move) stops.push({ at: c.at, jump: false, shot: c.move })
  return stops.sort((a, b) => a.at - b.at)
}

/** Where the walk is at t: from which shot to which, `k` 0 to 1 along it (1: arrived). */
export function walkAt(stops: Stop[], t: number): { from: Shot; k: number; to: Shot } {
  let i = 0
  while (i < stops.length - 1 && (stops[i + 1] as Stop).at <= t) i++
  const stop = stops[i] as Stop
  const before = stops[i - 1]
  if (!before || stop.jump || before.shot === stop.shot)
    return { from: stop.shot, k: 1, to: stop.shot }
  const k = Math.min(1, Math.max(0, (t - stop.at) / MOVE_SEC))
  return { from: before.shot, k, to: stop.shot }
}

/** Line i's transition at t: its kind and `k` 0 to 1 across it, or null outside one. */
export function transitionAt(
  transitions: Transition[],
  i: number,
  t: number,
): null | { k: number; kind: Exclude<Transition, 'cut' | 'move'> } {
  const kind = transitions[i]
  if (i === 0 || !kind || kind === 'cut' || kind === 'move') return null
  const k = (t - cutAt(i)) / TRANSITION_SEC
  return k >= 0 && k < 1 ? { k, kind } : null
}

const clamp = (v: number) => Math.min(1, Math.max(0, v))

/** How far a transition has gone: fastest at the cut, easing to 1. */
export const travel = (k: number): number => 1 - (1 - clamp(k)) ** 3
/** How fast it is moving (1 at the cut, 0 settled): the motion blur. */
export const speedOf = (k: number): number => (1 - clamp(k)) ** 2

/**
 * How much the host is pointing at a spot right now, 0 to 1: for the board, so the thing pointed at
 * reacts (grows a little, wiggles, lights up). `spot` is in screen pixels; a `point` cue whose
 * `target` lies within `radius` of it counts.
 */
export function pointedAt(cues: Cue[], t: number, spot: [number, number], radius = 180): number {
  let most = 0
  for (const c of cues) {
    if (c.gesture !== 'point' || !c.target) continue
    const d = Math.hypot(c.target[0] - spot[0], c.target[1] - spot[1])
    if (d > radius) continue
    const hold = c.hold ?? 1.4
    const p = t - c.at
    const k = clamp((p + 0.15) / 0.3) * (1 - clamp((p - hold) / 0.35))
    most = Math.max(most, k)
  }
  return most
}
