import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { BeatGrid } from '@reelmakeeasy/common/motion-reel/beat-grid'
import type { MotionReelSetup } from '@reelmakeeasy/common/motion-reel/reel-config'

import { prepareReelProject, REEL_DIR } from './motion-project'

const setup: MotionReelSetup = {
  lengthSec: 15,
  music: { source: 'none' },
  ratio: '16:9',
  styleId: 'hud-showreel',
  subject: 'ReelMakeEasy',
}

/** A mono 16-bit WAV of `seconds` at 22.05 kHz: a 60 Hz kick burst on every beat at 120 BPM. */
function kickWav(file: string, seconds: number): void {
  const rate = 22050
  const samples = Math.round(seconds * rate)
  const data = Buffer.alloc(samples * 2)
  for (let i = 0; i < samples; i++) {
    const sinceBeat = (i / rate) % 0.5
    const value =
      sinceBeat < 0.12 ? Math.sin(2 * Math.PI * 60 * sinceBeat) * (1 - sinceBeat / 0.12) : 0
    data.writeInt16LE(Math.round(value * 20000), i * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(rate, 24)
  header.writeUInt32LE(rate * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  fs.writeFileSync(file, Buffer.concat([header, data]))
}

describe('prepareReelProject (the music)', () => {
  let workspace: string

  beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'motion-music-map-'))
  })

  afterEach(() => fs.rmSync(workspace, { force: true, recursive: true }))

  it('writes the music events into reel.json and the music map beside the brief', async () => {
    const { reel } = await prepareReelProject({ music: null, musicOnly: true, setup, workspace })
    const written = JSON.parse(
      fs.readFileSync(path.join(workspace, REEL_DIR, 'public', 'reel.json'), 'utf8'),
    ) as typeof reel
    expect(written.events.kicks).toEqual(reel.beats)
    expect(written.events.sections).toEqual([
      { endSec: reel.lengthSec, energy: 2, name: 'groove', startSec: 0 },
    ])
    const map = fs.readFileSync(path.join(workspace, REEL_DIR, 'music-map.md'), 'utf8')
    expect(map).toMatch(/^# Music map\n/)
    expect(map).toMatch(/no music: a steady grid/)
    expect(map.split('\n').filter((line) => line.startsWith('bar ')).length).toBe(reel.bars)
  })

  it("finds a score's events by ear when its grid was written before they were", async () => {
    const file = path.join(workspace, 'score.wav')
    kickWav(file, 12)
    const beats = Array.from({ length: 24 }, (_, i) => i * 0.5)
    const grid: BeatGrid = {
      beats,
      beatsPerBar: 4,
      bpm: 120,
      downbeats: [0, 2, 4, 6, 8, 10],
      durationSec: 12,
      strongHits: [],
    }
    const { reel } = await prepareReelProject({
      music: { file, grid, title: 'Score' },
      musicOnly: true,
      setup: { ...setup, lengthSec: 10 },
      workspace,
    })
    expect(reel.events.kicks.length).toBeGreaterThanOrEqual(15)
    // On the reel's beats (the reel starts on one of the track's bars).
    expect(reel.events.kicks.every((t) => reel.beats.some((b) => Math.abs(b - t) < 0.03))).toBe(
      true,
    )
  })
})
