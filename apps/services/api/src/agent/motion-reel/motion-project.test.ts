import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { BeatGrid } from '@reelmakeeasy/common/motion-reel/beat-grid'
import type { MotionReelSetup } from '@reelmakeeasy/common/motion-reel/reel-config'

import { prepareReelProject, REEL_DIR, renderBrief } from './motion-project'

const setup: MotionReelSetup = {
  lengthSec: 15,
  music: { source: 'none' },
  ratio: '16:9',
  type: 'showreel',
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

  it("finds a track's events by ear, on its beat grid", async () => {
    const file = path.join(workspace, 'kicks.wav')
    kickWav(file, 12)
    const { reel } = await prepareReelProject({
      music: { bpm: 120, file, title: 'Kicks' },
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

  it("puts a composed score under the reel from its first bar, its grid and events exactly the score's", async () => {
    const file = path.join(workspace, 'composer-1.wav')
    kickWav(file, 12)
    const beats = Array.from({ length: 24 }, (_, i) => i * 0.5)
    const grid: BeatGrid = {
      beats,
      beatsPerBar: 4,
      bpm: 120,
      downbeats: beats.filter((_, i) => i % 4 === 0),
      durationSec: 12,
      events: {
        chords: [0, 2, 4, 6, 8, 10],
        // Off the kick bursts on purpose: written events are taken as they are, not found by ear.
        kicks: [0.25, 2.25, 4.25],
        melody: [{ strength: 1, t: 1 }],
        sections: [
          { endSec: 4, energy: 1, name: 'intro', startSec: 0 },
          { endSec: 12, energy: 3, name: 'drop', startSec: 4 },
        ],
        snares: [1.5, 3.5],
      },
      strongHits: [4],
    }
    const { reel } = await prepareReelProject({
      music: { file, grid, title: 'Composed: E dorian, 120 BPM' },
      musicOnly: true,
      setup: { ...setup, lengthSec: 10 },
      workspace,
    })
    expect(reel).toMatchObject({ bars: 5, bpm: 120, lengthSec: 10 })
    expect(reel.beats.slice(0, 3)).toEqual([0, 0.5, 1])
    expect(reel.events.kicks).toEqual([0.25, 2.25, 4.25])
    expect(reel.events.snares).toEqual([1.5, 3.5])
    expect(reel.events.sections.map((s) => [s.name, s.startSec, s.endSec])).toEqual([
      ['intro', 0, 4],
      ['drop', 4, 10],
    ])
    expect(fs.existsSync(path.join(workspace, REEL_DIR, 'public', 'music.wav'))).toBe(true)
  })
})

describe('prepareReelProject (music the agent composes)', () => {
  let workspace: string

  beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'motion-composer-setup-'))
  })

  afterEach(() => fs.rmSync(workspace, { force: true, recursive: true }))

  it('copies the composer into reel/music/ and writes its config from the setup', async () => {
    const composing: MotionReelSetup = { ...setup, music: { engine: 'composer', source: 'agent' } }
    const { reel } = await prepareReelProject({
      music: null,
      musicOnly: true,
      setup: composing,
      workspace,
    })
    const dir = path.join(workspace, REEL_DIR, 'music')
    expect(fs.existsSync(path.join(dir, 'tools', 'score.mjs'))).toBe(true)
    expect(fs.existsSync(path.join(dir, 'tools', 'audio', 'instruments.mjs'))).toBe(true)
    const config = fs.readFileSync(path.join(dir, 'reel.config.mjs'), 'utf8')
    expect(config).toContain(`  bpm: ${reel.bpm},`)
    expect(config).toContain('  title: "ReelMakeEasy",')
    expect(config).toContain("  audio: { ending: 'ring', lufs: -14, tp: -1 },")
    expect(fs.readFileSync(path.join(workspace, REEL_DIR, 'brief.md'), 'utf8')).toMatch(
      /composed by you with the reelmakeeasy-music-composer skill/,
    )

    // Music made another way gets no composer.
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'motion-composer-setup-'))
    await prepareReelProject({ music: null, musicOnly: true, setup, workspace: other })
    expect(fs.existsSync(path.join(other, REEL_DIR, 'music'))).toBe(false)
    fs.rmSync(other, { force: true, recursive: true })
  })
})

describe('the brief and the type', () => {
  let workspace: string

  beforeEach(() => {
    workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'motion-brief-'))
  })

  afterEach(() => fs.rmSync(workspace, { force: true, recursive: true }))

  it('says the type with its one-line description, and names no style', async () => {
    const launch: MotionReelSetup = { ...setup, type: 'launch' }
    const { reel } = await prepareReelProject({
      music: null,
      musicOnly: true,
      setup: launch,
      workspace,
    })
    const brief = fs.readFileSync(path.join(workspace, REEL_DIR, 'brief.md'), 'utf8')
    expect(brief).toContain(
      '- **Type:** Product launch: Make one product memorable: show it working.\n',
    )
    expect(brief).not.toMatch(/style/i)
    expect(renderBrief(setup, reel, null)).toContain(
      '- **Type:** Motion reel: Pure show-off motion that looks super cool.\n',
    )
  })

  it('tells the agent the detail level: Extra high unless the user picked another', async () => {
    const { reel } = await prepareReelProject({ music: null, musicOnly: true, setup, workspace })
    const brief = renderBrief(setup, reel, null)
    expect(brief).toContain('- **Detail:** Extra high (see "Detail" below)\n')
    expect(brief).toContain('## Detail: Extra high')
    expect(brief).toContain('professional motion graphics designer')
    expect(brief).toContain('not the dimension')
    expect(renderBrief({ ...setup, detail: 'medium' }, reel, null)).toContain('## Detail: Medium')
  })

  it("runs a reel without music on its type's tempo: 120 BPM for a launch, 124 for a showreel", async () => {
    const launch = await prepareReelProject({
      music: null,
      musicOnly: true,
      setup: { ...setup, type: 'launch' },
      workspace,
    })
    expect(launch.reel.bpm).toBe(120)
    const showreel = await prepareReelProject({ music: null, musicOnly: true, setup, workspace })
    expect(showreel.reel.bpm).toBe(124)
  })
})
