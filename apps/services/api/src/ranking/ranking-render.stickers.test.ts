import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { stickerMotionExpr } from '@reelmakeeasy/common/ranking/ranking-motion'
import type { RankingSticker } from '@shared/types/api/ranking'

import { newRankingProject, rankingTimeline } from '@reelmakeeasy/common/ranking/ranking-project'

import { run, segmentArgs } from './ranking-render'
import { stickerLayers } from './ranking.service'

/** How many bright yellow pixels a frame has inside a box (the sticker is yellow on blue). */
function yellowAt(video: string, atSec: number, box: { h: number; w: number; x: number; y: number }): number {
  const raw = execFileSync('ffmpeg', [
    '-v', 'error', '-ss', String(atSec), '-i', video, '-frames:v', '1',
    '-vf', `crop=${box.w}:${box.h}:${box.x}:${box.y}`, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
  ])
  let n = 0
  for (let i = 0; i < raw.length; i += 3) if ((raw[i] as number) > 180 && (raw[i + 1] as number) > 180 && (raw[i + 2] as number) < 120) n++
  return n
}

describe('moving stickers in a segment', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stk-'))
  afterAll(() => fs.rmSync(dir, { force: true, recursive: true }))

  it('shows a sticker only in its window, popping in, and moves a sliding one into place', async () => {
    const clip = path.join(dir, 'clip.mp4')
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=1080x1920:d=3:r=30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clip])
    const overlay = path.join(dir, 'overlay.png')
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=black@0.0:s=1080x1920,format=rgba', '-frames:v', '1', overlay])
    const png = path.join(dir, 'sticker.png')
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=yellow:s=200x100', '-frames:v', '1', '-pix_fmt', 'rgba', png])
    const pop: RankingSticker = { animation: { in: 'pop', loop: 'none', out: 'none' }, color: '#fff', id: 'a', kind: 'text', rank: 1, rotation: 0, size: 0.05, startSec: 1, x: 0.5, y: 0.5 }
    const slide: RankingSticker = { ...pop, animation: { in: 'slide-left', loop: 'none', out: 'none' }, id: 'b', y: 0.25 }
    const out = path.join(dir, 'seg.mp4')
    await run(
      'ffmpeg',
      segmentArgs({
        bandHeight: 0,
        clipFile: clip,
        durSec: 3,
        hasAudio: false,
        out,
        overlay,
        startSec: 0,
        stickers: [
          { cx: 540, cy: 960, from: 1, motion: stickerMotionExpr(pop, '(t-1)', 2), png, to: 3 },
          { cx: 540, cy: 480, from: 1, motion: stickerMotionExpr(slide, '(t-1)', 2), png, to: 3 },
        ],
      }),
      dir,
    )
    const centre = { h: 100, w: 200, x: 440, y: 910 }
    expect(yellowAt(out, 0.5, centre)).toBe(0)
    // Popping in: smaller than its full 200x100 just after it shows, full size once settled.
    const early = yellowAt(out, 1.02, centre)
    expect(early).toBeGreaterThan(0)
    expect(early).toBeLessThan(20000 * 0.6)
    expect(yellowAt(out, 2, centre)).toBeGreaterThan(20000 * 0.9)
    // Sliding in from the left: off its place at first, in place once settled.
    const place = { h: 100, w: 200, x: 440, y: 430 }
    expect(yellowAt(out, 1.04, place)).toBeLessThan(2000)
    expect(yellowAt(out, 2, place)).toBeGreaterThan(20000 * 0.9)
  }, 60_000)
})

describe('stickerLayers', () => {
  it("times a rank's sticker on its clip and a whole-short one on the short's clock", () => {
    const project = newRankingProject('11111111-1111-1111-1111-111111111111', 'now')
    project.items = project.items.map((item) => ({
      ...item,
      clip: { durationSec: 10, name: 'c.mp4', trimEndSec: 4, trimStartSec: 0, url: 'store://x' },
      label: 'x',
    }))
    project.stickers = [
      { animation: { in: 'pop', loop: 'none', out: 'fade' }, color: '#ffffff', id: 'own', kind: 'text', rank: 1, rotation: 0, size: 0.05, startSec: 1, text: 'A', x: 0.5, y: 0.5 },
      { color: '#ffffff', endSec: 9, id: 'all', kind: 'text', rank: null, rotation: 0, size: 0.05, startSec: 6, text: 'B', x: 0.5, y: 0.5 },
      { color: '#ffffff', id: 'still', kind: 'text', rank: null, rotation: 0, size: 0.05, text: 'C', x: 0.5, y: 0.5 },
    ]
    const parts = rankingTimeline(project).filter((p) => p.kind === 'clip')
    const total = rankingTimeline(project).reduce((sum, p) => sum + p.durSec, 0)
    const rankOne = parts.find((p) => p.segment.item.rank === 1)!
    const layers = stickerLayers(project, rankOne, total, (s) => `${s.id}.png`)
    const own = layers.find((l) => l.png === 'own.png')!
    expect(own).toMatchObject({ fadeOut: 3.7, from: 1, to: 4 })
    expect(own.motion.scale).toContain('(t-1)')
    expect(layers.some((l) => l.png === 'still.png')).toBe(false)
    // The whole-short sticker shows 6-9 s into the short: in the second part, from 2 s to its end.
    const second = parts[1]!
    const all = stickerLayers(project, second, total, (s) => `${s.id}.png`).find((l) => l.png === 'all.png')!
    expect(all).toMatchObject({ from: 6 - second.startSec, to: Math.min(second.durSec, 9 - second.startSec) })
    expect(stickerLayers(project, rankOne, total, () => undefined)).toEqual([])
  })
})

