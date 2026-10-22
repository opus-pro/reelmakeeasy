import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { RANKING_HEIGHT, RANKING_WIDTH } from '@reelmakeeasy/common/ranking/ranking-project'

import { PHOTO_CLIP_SEC, photoToClip, probeClip } from './ranking-render'

describe('a photo under a rank', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'photo-'))
  afterAll(() => fs.rmSync(dir, { force: true, recursive: true }))

  it('becomes a clip at the export size that zooms in slowly', async () => {
    // A landscape photo: a white square in the middle of a blue frame.
    const photo = path.join(dir, 'dog.png')
    execFileSync('ffmpeg', [
      '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=blue:s=1600x900',
      '-vf', 'drawbox=x=700:y=350:w=200:h=200:color=white:t=fill', '-frames:v', '1', photo,
    ])
    const clip = path.join(dir, 'dog.mp4')
    await photoToClip(photo, clip)
    const probe = await probeClip(clip)
    expect(probe.durationSec).toBeCloseTo(PHOTO_CLIP_SEC, 1)
    const size = execFileSync('ffprobe', [
      '-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', clip,
    ]).toString().trim()
    expect(size).toBe(`${RANKING_WIDTH},${RANKING_HEIGHT}`)
    // The white square grows: more white in the last frame than in the first.
    const white = (atSec: number) => {
      const raw = execFileSync('ffmpeg', [
        '-v', 'error', '-ss', String(atSec), '-i', clip, '-frames:v', '1', '-vf', 'scale=108:192', '-f', 'rawvideo', '-pix_fmt', 'gray', '-',
      ])
      return raw.filter((v) => v > 200).length
    }
    expect(white(PHOTO_CLIP_SEC - 0.1)).toBeGreaterThan(white(0) * 1.15)
  }, 60_000)
})
