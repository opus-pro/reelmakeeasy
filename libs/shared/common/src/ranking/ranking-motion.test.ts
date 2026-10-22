import type { RankingSticker, RankingStickerAnimation } from '@shared/types/api/ranking'

import {
  isMovingSticker,
  STICKER_INS,
  STICKER_LOOPS,
  STICKER_OUTS,
  stickerMotionExpr,
  stickerPose,
  stickerWindow,
} from './ranking-motion'
import { rankMark } from './ranking-type'

const sticker = (over: Partial<RankingSticker> = {}): RankingSticker => ({
  color: '#ffffff',
  id: 's',
  kind: 'text',
  rank: 1,
  rotation: 0,
  size: 0.06,
  text: 'MAMA!',
  x: 0.5,
  y: 0.4,
  ...over,
})

/** Evaluates an FFmpeg expression of `t` the way FFmpeg does, for the functions the motion uses. */
function evalExpr(expr: string, t: number): number {
  const js = expr.replaceAll('PI', 'Math.PI')
  const fn = new Function('t', 'sin', 'pow', 'clip', `return ${js}`) as (
    t: number,
    sin: (x: number) => number,
    pow: (a: number, b: number) => number,
    clip: (x: number, lo: number, hi: number) => number,
  ) => number
  return fn(t, Math.sin, Math.pow, (x, lo, hi) => Math.min(hi, Math.max(lo, x)))
}

describe('sticker motion', () => {
  it('shows a still sticker the whole time, and a timed one only in its window', () => {
    expect(isMovingSticker(sticker())).toBe(false)
    expect(stickerPose(sticker(), 2, 4)).toEqual({ alpha: 1, dx: 0, dy: 0, scale: 1 })
    const timed = sticker({ endSec: 3, startSec: 1 })
    expect(isMovingSticker(timed)).toBe(true)
    expect(stickerWindow(timed, 4)).toEqual({ end: 3, start: 1 })
    expect(stickerPose(timed, 0.5, 4)).toBeNull()
    expect(stickerPose(timed, 3.1, 4)).toBeNull()
    expect(stickerWindow(sticker({ startSec: 5 }), 4)).toBeNull()
  })

  it('pops in past full size and settles, fades in and out, slides in from its side', () => {
    const pop = sticker({ animation: { in: 'pop', loop: 'none', out: 'fade' } })
    expect(stickerPose(pop, 0, 4)?.scale).toBeCloseTo(0, 5)
    expect(stickerPose(pop, 0.25, 4)!.scale).toBeGreaterThan(1)
    expect(stickerPose(pop, 1, 4)?.scale).toBe(1)
    expect(stickerPose(pop, 3.85, 4)?.alpha).toBeCloseTo(0.5, 5)
    const slide = sticker({ animation: { in: 'slide-left', loop: 'none', out: 'none' } })
    expect(stickerPose(slide, 0, 4)?.dx).toBeCloseTo(-0.8)
    expect(stickerPose(slide, 1, 4)?.dx).toBe(0)
  })

  it('writes FFmpeg expressions that move it exactly as the preview does', () => {
    const at = (a: RankingStickerAnimation) => sticker({ animation: a, endSec: 3.5, startSec: 0.7 })
    for (const inn of STICKER_INS)
      for (const loop of STICKER_LOOPS)
        for (const out of STICKER_OUTS) {
          const s = at({ in: inn, loop, out })
          const expr = stickerMotionExpr(s, '(t-0.7)', 2.8)
          for (const t of [0.7, 0.8, 0.95, 1.4, 2.2, 3.3, 3.45]) {
            const pose = stickerPose(s, t, 5)!
            expect(evalExpr(expr.scale, t)).toBeCloseTo(pose.scale, 6)
            expect(evalExpr(expr.dx, t)).toBeCloseTo(pose.dx, 6)
            expect(evalExpr(expr.dy, t)).toBeCloseTo(pose.dy, 6)
          }
        }
  })
})

describe('rank marks', () => {
  it('marks ranks with numbers, keycaps, medals or the user’s own marks', () => {
    expect(rankMark({}, 2)).toBe('2.')
    expect(rankMark({ numberFormat: 'hash' }, 2)).toBe('#2')
    expect(rankMark({ numberFormat: 'plain' }, 2)).toBe('2')
    expect(rankMark({ numberFormat: 'keycap' }, 10)).toBe('🔟')
    expect(rankMark({ numberFormat: 'medal' }, 1)).toBe('🥇')
    expect(rankMark({ numberFormat: 'medal' }, 4)).toBe('4.')
    expect(rankMark({ numberFormat: 'custom', numberMarks: ['👑', ' '] }, 1)).toBe('👑')
    expect(rankMark({ numberFormat: 'custom', numberMarks: ['👑', ' '] }, 2)).toBe('2.')
  })
})
