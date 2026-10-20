import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { decodeAudioMono } from '@reelmakeeasy/common/audio/decode-audio'
import { printOfSound, spectrogram } from '@reelmakeeasy/common/audio/sound-analysis'

import { analyzeVideo, clipMoments, ReferenceError, youtubeUrl } from './reference-video'

const BOOM = 'if(between(t,1,1.6),0.6*sin(2*PI*(70-30*(t-1))*(t-1))*exp(-5*(t-1)),0)'
const HIT = 'if(between(t,3,3.2),0.5*sin(2*PI*3000*t)*exp(-25*(t-3)),0)'

describe('reference video analysis', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ref-'))
  const video = path.join(dir, 'ref.mp4')
  const boomFile = path.join(dir, 'boom.wav')

  beforeAll(() => {
    // Two shots (red, then blue at 2 s), a quiet chord, a boom at 1 s and a bright hit at 3 s.
    execFileSync('ffmpeg', [
      '-v', 'error', '-y',
      '-f', 'lavfi', '-i', 'color=c=red:s=320x568:d=2:r=30',
      '-f', 'lavfi', '-i', 'color=c=blue:s=320x568:d=2:r=30',
      '-f', 'lavfi', '-i', `aevalsrc='0.04*sin(2*PI*220*t)+${BOOM}+${HIT}':s=44100:d=4`,
      '-filter_complex', '[0:v][1:v]concat=n=2:v=1:a=0[v]',
      '-map', '[v]', '-map', '2:a', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', video,
    ])
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `aevalsrc='${BOOM.replaceAll('t,1', 't,0').replaceAll('(t-1)', 't')}':s=44100:d=0.8`, boomFile])
  })
  afterAll(() => fs.rmSync(dir, { force: true, recursive: true }))

  it('finds its shots and sound effects, names the library sound and describes the other', async () => {
    const print = printOfSound(spectrogram(await decodeAudioMono(boomFile)))
    const library = print ? [{ id: 'boom-id', name: 'Vine boom', print }] : []
    const out = path.join(dir, 'analysis')
    const a = await analyzeVideo(video, out, library, { title: 'Test', url: null })
    expect(a.shots.map((s) => s.startSec)).toEqual([0, expect.closeTo(2, 0)])
    const boom = a.sounds.find((s) => Math.abs(s.atSec - 1) < 0.06)
    const hit = a.sounds.find((s) => Math.abs(s.atSec - 3) < 0.06)
    expect(boom?.match?.name).toBe('Vine boom')
    expect(boom?.inShot).toEqual({ index: 1, secIntoShot: expect.closeTo(1, 1) })
    expect(hit?.match).toBeNull()
    expect(hit?.description).toMatch(/bright/)
    expect(hit?.inShot?.index).toBe(2)
    for (const file of [a.files.titleFrame, a.files.contactSheet, ...a.shots.map((s) => s.frame), boom?.frame ?? ''])
      expect(fs.existsSync(path.join(out, file))).toBe(true)
    expect(JSON.parse(fs.readFileSync(path.join(out, 'analysis.json'), 'utf8')).durationSec).toBeCloseTo(4, 0)
  }, 60_000)

  it("finds a clip's action moments", async () => {
    const m = await clipMoments(video)
    expect(m.sounds.some((s) => Math.abs(s.atSec - 1) < 0.06)).toBe(true)
    expect(m.cuts[0]).toBeCloseTo(2, 0)
  }, 60_000)
})

describe('youtubeUrl', () => {
  it('takes YouTube links and explains the rest', () => {
    expect(youtubeUrl(' https://www.youtube.com/shorts/abc123 ')).toBe('https://www.youtube.com/shorts/abc123')
    expect(youtubeUrl('https://youtu.be/abc')).toBe('https://youtu.be/abc')
    expect(() => youtubeUrl('https://www.tiktok.com/@x/video/1')).toThrow(/TikTok/)
    expect(() => youtubeUrl('http://www.youtube.com/watch?v=1')).toThrow(ReferenceError)
    expect(() => youtubeUrl('file:///etc/passwd')).toThrow(ReferenceError)
    expect(() => youtubeUrl('not a link')).toThrow(/isn't a link/)
  })
})
