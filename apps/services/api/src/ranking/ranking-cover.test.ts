import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { RankingInputError, RankingService } from './ranking.service'
import { coverArgs, run } from './ranking-render'

/** The mean brightness (0-255) of a box of a picture, from ffmpeg. */
function brightness(file: string, box: { h: number; w: number; x: number; y: number }): number {
  const raw = execFileSync('ffmpeg', [
    '-v', 'error', '-i', file, '-vf', `crop=${box.w}:${box.h}:${box.x}:${box.y}`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-',
  ])
  return raw.reduce((sum, v) => sum + v, 0) / raw.length
}

describe('a ranking cover', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cover-'))
  afterAll(() => fs.rmSync(dir, { force: true, recursive: true }))
  // A white clip, and an overlay that is clear but for a red band at the top.
  const clip = path.join(dir, 'clip.mp4')
  const overlay = path.join(dir, 'overlay.png')
  beforeAll(() => {
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=white:s=720x1280:d=2', '-pix_fmt', 'yuv420p', clip])
    execFileSync('ffmpeg', [
      '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=red@0.0:s=1080x1920,format=rgba',
      '-vf', 'drawbox=x=0:y=0:w=1080:h=320:color=red:t=fill', '-frames:v', '1', overlay,
    ])
  }, 30_000)

  it('puts a frame of the clip under the band, the overlay on top, at the cover size', async () => {
    const out = path.join(dir, 'cover.jpg')
    await run('ffmpeg', coverArgs({ atSec: 1, bandHeight: 320, clipFile: clip, height: 640, out, overlay, width: 360 }), dir)
    const size = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', out])
    expect(size.toString().trim()).toBe('360,640')
    // The clip shows below the band (white), the overlay's band above it (red, darker in gray).
    expect(brightness(out, { h: 200, w: 300, x: 30, y: 300 })).toBeGreaterThan(200)
    expect(brightness(out, { h: 80, w: 300, x: 30, y: 10 })).toBeLessThan(120)
  }, 30_000)

  it('without a clip, is the overlay on the dark frame', async () => {
    const out = path.join(dir, 'empty.jpg')
    await run('ffmpeg', coverArgs({ atSec: 0, bandHeight: 320, clipFile: null, height: 640, out, overlay, width: 360 }), dir)
    expect(brightness(out, { h: 200, w: 300, x: 30, y: 300 })).toBeLessThan(40)
  }, 30_000)
})

describe('making a cover', () => {
  it('refuses one drawn for an older version of the ranking, and lists the key to draw for', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cover-svc-'))
    const service = new RankingService(null, root)
    const project = service.create('Dogs')
    const [listed] = service.list()
    expect(listed).toMatchObject({ coverStale: true, coverUrl: null })
    await expect(
      service.setCover(project.id, { bandHeight: 320, key: 'old', overlay: '' }),
    ).rejects.toBeInstanceOf(RankingInputError)
    // A new label changes what the cover shows.
    service.update(project.id, { items: project.items.map((i) => ({ ...i, label: 'Sneaky' })) })
    expect(service.list()[0]?.coverKey).not.toBe(listed?.coverKey)
    fs.rmSync(root, { force: true, recursive: true })
  })
})
