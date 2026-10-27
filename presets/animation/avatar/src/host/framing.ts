import { voiceLines } from '../clock'

/**
 * Shots for a talking head, one per voice line, cut on the line's start:
 * - `medium`: waist up, centred, the head in the lower middle; pictures go above it.
 * - `close`: the face fills the frame (for the hook and the big moments).
 * - `left` / `right`: the host on that side, smaller; pictures go on the other side.
 * - `wide`: the host small at the bottom, more of the set; a big picture above.
 * - `corner`: the host small in the bottom-right corner, the frame left for the pictures and a
 *   headline (the editorial explainer: UI cards, stamps and a big caption at the top).
 */
export type Shot = 'close' | 'corner' | 'left' | 'medium' | 'right' | 'wide'

/** Where pictures can go in a shot without covering the host, in screen pixels (1080×1920),
 *  inside the 6% margin. */
export type Area = { h: number; w: number; x: number; y: number }

export const BOARD: Record<Shot, Area> = {
  close: { h: 330, w: 950, x: 65, y: 150 },
  corner: { h: 1150, w: 950, x: 65, y: 380 },
  left: { h: 1150, w: 460, x: 555, y: 300 },
  medium: { h: 640, w: 950, x: 65, y: 150 },
  right: { h: 1150, w: 460, x: 65, y: 300 },
  wide: { h: 900, w: 950, x: 65, y: 150 },
}

/** Shot cut points: just before each line; the last runs to the end. */
export function shotIndex(t: number): number {
  let i = 0
  while (i < voiceLines.length - 1 && t >= (voiceLines[i + 1]?.start ?? Infinity) - 0.12) i++
  return i
}

/** Seconds into the current shot, and its length (for a slow push-in). */
export function shotProgress(t: number, end: number): number {
  const i = shotIndex(t)
  const a = i === 0 ? 0 : (voiceLines[i]?.start ?? 0) - 0.12
  const b = (voiceLines[i + 1]?.start ?? end) - 0.12
  return Math.min(1, Math.max(0, (t - a) / Math.max(0.5, b - a)))
}
