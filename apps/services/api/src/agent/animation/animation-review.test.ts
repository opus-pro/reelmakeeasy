import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { animationReviewBlocker, reviewAnimation } from './animation-review'

/** A 6 s 1080×1920 video: a big panel sliding for 3 s, then a still frame for 3 s (a stall). */
function makeVideo(file: string): void {
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'color=c=0x223344:s=1080x1920:d=6:r=30',
    '-f',
    'lavfi',
    '-i',
    'color=c=yellow:s=540x1500:d=6:r=30',
    '-filter_complex',
    "[0][1]overlay=x='if(lt(t,3),t*180,540)':y=200:shortest=1",
    '-pix_fmt',
    'yuv420p',
    file,
  ])
}

describe('reviewing an animation', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'animation-review-'))
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'src', 'Animation.tsx'), '// scene')
  })
  afterEach(() => fs.rmSync(dir, { force: true, recursive: true }))

  it('needs a render first, and a render newer than the scenes', () => {
    expect(animationReviewBlocker(dir)).toMatch(
      /^Nothing to review yet: render .* animation_render/,
    )
    fs.mkdirSync(path.join(dir, 'out'))
    fs.writeFileSync(path.join(dir, 'out', 'animation.mp4'), 'mp4')
    expect(animationReviewBlocker(dir)).toBeNull()
    const later = new Date(Date.now() + 60_000)
    fs.utimesSync(path.join(dir, 'src', 'Animation.tsx'), later, later)
    expect(animationReviewBlocker(dir)).toMatch(/src\/Animation\.tsx changed after the last render/)
  })

  it('lays the render out as contact sheets and finds where nothing moves', async () => {
    fs.mkdirSync(path.join(dir, 'out'))
    makeVideo(path.join(dir, 'out', 'animation.mp4'))
    const result = await reviewAnimation(dir, {})
    expect(result.sheets.length).toBe(1)
    expect(fs.existsSync(result.sheets[0] as string)).toBe(true)
    expect(result.text).toMatch(/^Made 1 contact sheet of the render/)
    expect(result.text).toMatch(/animation\/out\/review\/\d+\/sheet-1\.png: rows start at 0 s, 4 s/)
    // The still second half is a stall (the last moments before the end card aside).
    expect(result.stalls.length).toBeGreaterThan(0)
    expect(result.text).toMatch(
      /Stalls \(0\.5 s or more where nothing moves\): 1, at 3(\.\d)?-4 s\./,
    )
    expect(result.text).toMatch(/write what you find in animation\/review\.md/i)
  })
})
