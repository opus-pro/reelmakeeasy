import type { RankingSticker, RankingStickerAnimation } from '@shared/types/api/ranking'

/**
 * How stickers move: when each shows (its window, on its own clock: its rank's clip, or the whole
 * short) and where it is at a moment of it (its pose). The studio's preview draws `stickerPose`;
 * the export animates the same motion in FFmpeg from `stickerMotionExpr`, which writes the very
 * same formulas as FFmpeg expressions (the tests check they agree).
 */

/** How long an entrance and an exit take. */
export const STICKER_IN_SEC = 0.35
export const STICKER_OUT_SEC = 0.3

export const STICKER_INS: RankingStickerAnimation['in'][] = [
  'none',
  'fade',
  'pop',
  'slide-left',
  'slide-right',
  'slide-up',
  'slide-down',
]
export const STICKER_LOOPS: RankingStickerAnimation['loop'][] = ['none', 'shake', 'pulse', 'float']
export const STICKER_OUTS: RankingStickerAnimation['out'][] = ['none', 'fade', 'pop']

const STILL: RankingStickerAnimation = { in: 'none', loop: 'none', out: 'none' }

export const animationOf = (sticker: RankingSticker): RankingStickerAnimation =>
  sticker.animation ?? STILL

/** A sticker that moves or comes and goes: drawn per frame, not baked into the overlay. */
export function isMovingSticker(sticker: RankingSticker): boolean {
  const a = animationOf(sticker)
  return (
    a.in !== 'none' ||
    a.loop !== 'none' ||
    a.out !== 'none' ||
    (sticker.startSec ?? 0) > 0 ||
    sticker.endSec != null
  )
}

/** When it shows on its clock, which ends at `clockEnd`; null when it never does. */
export function stickerWindow(
  sticker: RankingSticker,
  clockEnd: number,
): null | { end: number; start: number } {
  const start = Math.max(0, sticker.startSec ?? 0)
  const end = Math.min(clockEnd, sticker.endSec ?? clockEnd)
  return end > start ? { end, start } : null
}

/** Where a sticker is: its opacity, its offset (fractions of the frame's width and height) and scale. */
export type StickerPose = { alpha: number; dx: number; dy: number; scale: number }

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))
const easeOut = (p: number) => 1 - (1 - p) ** 3
const easeOutBack = (p: number) => 1 + 2.70158 * (p - 1) ** 3 + 1.70158 * (p - 1) ** 2
const TAU = 2 * Math.PI

/** Slides travel this far (fractions of the frame). */
const SLIDE_X = 0.8
const SLIDE_Y = 0.6

/**
 * The sticker's pose `clockSec` into its clock (which ends at `clockEnd`); null while it isn't
 * shown.
 */
export function stickerPose(
  sticker: RankingSticker,
  clockSec: number,
  clockEnd: number,
): null | StickerPose {
  const window = stickerWindow(sticker, clockEnd)
  if (!window || clockSec < window.start || clockSec >= window.end) return null
  const a = animationOf(sticker)
  const u = clockSec - window.start
  const v = window.end - window.start
  const p = clamp01(u / STICKER_IN_SEC)
  const q = clamp01((u - (v - STICKER_OUT_SEC)) / STICKER_OUT_SEC)
  const pose: StickerPose = { alpha: 1, dx: 0, dy: 0, scale: 1 }
  if (a.in === 'fade') pose.alpha *= p
  if (a.in === 'pop') pose.scale *= easeOutBack(p)
  if (a.in === 'slide-left') pose.dx -= (1 - easeOut(p)) * SLIDE_X
  if (a.in === 'slide-right') pose.dx += (1 - easeOut(p)) * SLIDE_X
  if (a.in === 'slide-up') pose.dy += (1 - easeOut(p)) * SLIDE_Y
  if (a.in === 'slide-down') pose.dy -= (1 - easeOut(p)) * SLIDE_Y
  if (a.loop === 'shake') {
    pose.dx += 0.008 * Math.sin(TAU * 13 * u) + 0.004 * Math.sin(TAU * 29 * u)
    pose.dy += 0.004 * Math.sin(TAU * 17 * u)
  }
  if (a.loop === 'pulse') pose.scale *= 1 + 0.08 * Math.sin(TAU * 2 * u)
  if (a.loop === 'float') pose.dy += 0.012 * Math.sin(TAU * 0.8 * u)
  if (a.out === 'fade') pose.alpha *= 1 - q
  if (a.out === 'pop') pose.scale *= 1 - q * q
  return pose
}

/**
 * The same motion as FFmpeg expressions of `u` (an expression for the seconds since the sticker
 * showed, e.g. `(t-1.2)`), for a window `v` seconds long: its scale, and its offset in fractions
 * of the frame. Opacity is the caller's (FFmpeg's `fade` filter, linear like `stickerPose`).
 */
export function stickerMotionExpr(
  sticker: RankingSticker,
  u: string,
  v: number,
): { dx: string; dy: string; scale: string } {
  const a = animationOf(sticker)
  const p = `clip(${u}/${STICKER_IN_SEC},0,1)`
  const q = `clip((${u}-${round(v - STICKER_OUT_SEC)})/${STICKER_OUT_SEC},0,1)`
  const eased = `(1-pow(1-${p},3))`
  const scale: string[] = []
  const dx: string[] = []
  const dy: string[] = []
  if (a.in === 'pop') scale.push(`(1+2.70158*pow(${p}-1,3)+1.70158*pow(${p}-1,2))`)
  if (a.in === 'slide-left') dx.push(`-(1-${eased})*${SLIDE_X}`)
  if (a.in === 'slide-right') dx.push(`(1-${eased})*${SLIDE_X}`)
  if (a.in === 'slide-up') dy.push(`(1-${eased})*${SLIDE_Y}`)
  if (a.in === 'slide-down') dy.push(`-(1-${eased})*${SLIDE_Y}`)
  if (a.loop === 'shake') {
    dx.push(`0.008*sin(2*PI*13*${u})+0.004*sin(2*PI*29*${u})`)
    dy.push(`0.004*sin(2*PI*17*${u})`)
  }
  if (a.loop === 'pulse') scale.push(`(1+0.08*sin(2*PI*2*${u}))`)
  if (a.loop === 'float') dy.push(`0.012*sin(2*PI*0.8*${u})`)
  if (a.out === 'pop') scale.push(`(1-pow(${q},2))`)
  return {
    dx: dx.length ? dx.join('+') : '0',
    dy: dy.length ? dy.join('+') : '0',
    scale: scale.length ? scale.join('*') : '1',
  }
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000
}
