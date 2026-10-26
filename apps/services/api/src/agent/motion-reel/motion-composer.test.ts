import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  composerScore,
  composerSourceDir,
  ensureComposer,
  installComposer,
  readComposedMusic,
  reelBarsAt,
  renderComposerConfig,
} from './motion-composer'

/** A real composer render's build/music.json (34 bars at 136 BPM, F# dorian, 60 s), trimmed:
 *  hits, motif and chords before 20 s, no control signals. */
const FIXTURE = path.join(__dirname, 'fixtures', 'composer-music.json')
const musicJson = () => JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as Record<string, unknown>

/** The checks a composer run wrote to qc/score-report.json. */
const REPORT = {
  checks: [
    { id: 'loudness', msg: 'integrated -13.9 LUFS (target -14), LRA 9.7 LU', status: 'PASS' },
    { id: 'truepeak', msg: 'true peak -1 dBTP (ceiling -1)', status: 'PASS' },
    { id: 'linear', msg: 'loudnorm pass 2 ran dynamic', status: 'WARN' },
  ],
}

/** A real, tiny WAV `seconds` long (100 Hz mono 8-bit silence): the length is what is checked. */
function silentWav(seconds: number): Buffer {
  const data = Buffer.alloc(Math.round(seconds * 100), 128)
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(100, 24)
  header.writeUInt32LE(100, 28)
  header.writeUInt16LE(1, 32)
  header.writeUInt16LE(8, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

/** What a composer run leaves in reel/music/: music.mjs, then (later) its score, music.json and QC. */
function writeComposerRun(
  projectDir: string,
  o: { json?: unknown; report?: unknown; stale?: boolean; wavSec?: number } = {},
): void {
  const dir = path.join(projectDir, 'music')
  for (const sub of ['audio', 'build', 'qc']) fs.mkdirSync(path.join(dir, sub), { recursive: true })
  fs.writeFileSync(path.join(dir, 'music.mjs'), 'export default {}\n')
  fs.writeFileSync(path.join(dir, 'audio', 'score.wav'), silentWav(o.wavSec ?? 60))
  fs.writeFileSync(path.join(dir, 'build', 'music.json'), JSON.stringify(o.json ?? musicJson()))
  fs.writeFileSync(path.join(dir, 'qc', 'score-report.json'), JSON.stringify(o.report ?? REPORT))
  // The score is written after music.mjs, unless it is stale (music.mjs edited since).
  const now = Date.now() / 1000
  const [source, made] = o.stale ? [now, now - 60] : [now - 60, now]
  fs.utimesSync(path.join(dir, 'music.mjs'), source, source)
  for (const file of ['audio/score.wav', 'build/music.json', 'qc/score-report.json'])
    fs.utimesSync(path.join(dir, file), made, made)
}

describe('composerScore (build/music.json as the reel grid)', () => {
  const score = composerScore(musicJson())
  if (typeof score === 'string') throw new Error(score)
  const { grid } = score

  it('puts a beat every 60/bpm seconds from 0 and a downbeat every bar', () => {
    expect(grid).toMatchObject({ beatsPerBar: 4, bpm: 136, durationSec: 60 })
    expect(grid.beats).toHaveLength(136)
    expect(grid.beats.slice(0, 3)).toEqual([0, 0.441, 0.882])
    expect(grid.downbeats).toHaveLength(34)
    expect(grid.downbeats.slice(0, 3)).toEqual([0, 1.765, 3.529])
  })

  it('takes the kicks, snares, motif, chords and sections exactly as written', () => {
    const events = grid.events
    if (!events) throw new Error('no events')
    // The kick voice (inst kick), not the sub or bass.
    expect(events.kicks.slice(0, 3)).toEqual([0, 1.765, 3.529])
    // Snares and claps.
    expect(events.snares).toContain(7.5)
    expect(events.snares).toContain(14.559)
    // The motif's notes are its accents; the bell's other notes are weaker.
    expect(events.melody.slice(0, 3)).toEqual([
      { strength: 1, t: 0 },
      { strength: 1, t: 0.331 },
      { strength: 1, t: 0.662 },
    ])
    expect(events.melody.every((m) => m.strength === 1 || m.strength === 0.6)).toBe(true)
    expect(events.chords.slice(0, 3)).toEqual([0, 1.765, 3.529])
    expect(events.sections.map((s) => [s.name, s.energy])).toEqual([
      ['intro', 1],
      ['build', 2],
      ['dropA', 3],
      ['break', 1],
      ['lift', 2],
      // Energy 4 reads as 3.
      ['dropB', 3],
      ['outro', 2],
      ['final', 1],
    ])
    expect(events.sections[0]).toMatchObject({ endSec: 7.059, startSec: 0 })
  })

  it('names the score and marks the drops as its strongest moments', () => {
    expect(score.title).toBe('Composed: F# dorian, 136 BPM')
    expect(score.key).toBe('F# dorian')
    // dropB (energy 4), then dropA, then build and lift.
    expect(grid.strongHits.slice(0, 2)).toEqual([38.824, 14.118])
  })

  it('finds the kicks by name when music.json has no voices, and an 808 when there is no kick', () => {
    const { voices: _voices, ...noVoices } = musicJson()
    const named = composerScore(noVoices)
    if (typeof named === 'string') throw new Error(named)
    expect(named.grid.events?.kicks.slice(0, 2)).toEqual([0, 1.765])
    const json = musicJson()
    const hits = json['hits'] as Record<string, unknown>
    const voices = json['voices'] as Record<string, unknown>
    delete hits['kick']
    delete voices['kick']
    const subOnly = composerScore(json)
    if (typeof subOnly === 'string') throw new Error(subOnly)
    expect(subOnly.grid.events?.kicks[0]).toBe(14.118)
  })

  it('says what is wrong with a file that is not a 4/4 score', () => {
    expect(composerScore(null)).toBe('not a JSON object')
    expect(composerScore({ ...musicJson(), bpm: 'fast' })).toMatch(/bpm must be a number/)
    expect(composerScore({ ...musicJson(), beatsPerBar: 3 })).toMatch(/4\/4/)
    expect(composerScore({ ...musicJson(), sections: [] })).toBe('it has no sections')
    expect(composerScore({ ...musicJson(), hits: { kick: 'x' } })).toMatch(/voice kick/)
  })
})

describe('the composer in a reel', () => {
  let projectDir: string

  beforeEach(() => {
    projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'motion-composer-'))
  })

  afterEach(() => fs.rmSync(projectDir, { force: true, recursive: true }))

  it('copies the composer in and writes reel.config.mjs, keeping the bpm the agent set', () => {
    installComposer(projectDir, { bpm: 120, lengthSec: 15, title: 'A launch' })
    const tools = path.join(projectDir, 'music', 'tools')
    expect(fs.existsSync(path.join(tools, 'score.mjs'))).toBe(true)
    expect(fs.existsSync(path.join(tools, 'audio', 'compose.mjs'))).toBe(true)
    expect(fs.existsSync(path.join(tools, 'README.md'))).toBe(false)
    expect(fs.readdirSync(path.join(composerSourceDir(), 'audio')).sort()).toEqual(
      fs.readdirSync(path.join(tools, 'audio')).sort(),
    )
    const configFile = path.join(projectDir, 'music', 'reel.config.mjs')
    expect(fs.readFileSync(configFile, 'utf8')).toBe(
      renderComposerConfig({ bpm: 120, lengthSec: 15, title: 'A launch' }),
    )

    // The agent sets its tempo; a later setup keeps it and refreshes the rest.
    const edited = fs.readFileSync(configFile, 'utf8').replace('bpm: 120,', 'bpm: 136,')
    fs.writeFileSync(configFile, edited)
    fs.writeFileSync(path.join(tools, 'score.mjs'), 'edited')
    installComposer(projectDir, { bpm: 120, lengthSec: 30, title: 'A launch' })
    expect(fs.readFileSync(configFile, 'utf8')).toBe(
      renderComposerConfig({ bpm: 136, lengthSec: 30, title: 'A launch' }),
    )
    expect(fs.readFileSync(path.join(tools, 'score.mjs'), 'utf8')).not.toBe('edited')
  })

  it("writes the reel's length in whole bars at the tempo", () => {
    expect(reelBarsAt(15, 136)).toBe(9)
    expect(reelBarsAt(60, 136)).toBe(34)
    const config = renderComposerConfig({ bpm: 136, lengthSec: 15, title: 'It\'s "quoted"' })
    expect(config).toMatch(/^ {2}bpm: 136,$/m)
    expect(config).toMatch(/^ {2}duration: 15.882,$/m)
    expect(config).toMatch(/^ {2}title: "It's \\"quoted\\"",$/m)
    expect(config).toMatch(/audio: \{ ending: 'ring', lufs: -14, tp: -1 \}/)
  })

  it('takes a finished run: copies the score and its music.json beside it, and sums up the QC', () => {
    writeComposerRun(projectDir)
    const music = readComposedMusic(projectDir, 60)
    if (typeof music === 'string') throw new Error(music)
    expect(music.file).toMatch(/music[\\/]composer-\d+\.wav$/)
    expect(fs.statSync(music.file).size).toBe(44 + 6000)
    expect(fs.existsSync(music.file.replace(/\.wav$/, '.json'))).toBe(true)
    expect(music.qc).toEqual([
      'QC passed: loudness, truepeak.',
      'QC WARN linear: loudnorm pass 2 ran dynamic',
    ])
  })

  it('says what to do when the run is missing, stale, failed or the wrong length', () => {
    expect(readComposedMusic(projectDir, 60)).toMatch(/There is no reel\/music\/music.mjs/)
    fs.mkdirSync(path.join(projectDir, 'music'), { recursive: true })
    fs.writeFileSync(path.join(projectDir, 'music', 'music.mjs'), 'export default {}\n')
    expect(readComposedMusic(projectDir, 60)).toMatch(
      /There is no reel\/music\/audio\/score.wav: run the composer first/,
    )
    writeComposerRun(projectDir, { stale: true })
    expect(readComposedMusic(projectDir, 60)).toMatch(/is older than reel\/music\/music.mjs/)
    writeComposerRun(projectDir, {
      report: { checks: [{ id: 'truepeak', msg: 'true peak 0.4 dBTP', status: 'FAIL' }] },
    })
    expect(readComposedMusic(projectDir, 60)).toMatch(/QC failed: truepeak: true peak 0.4 dBTP/)
    writeComposerRun(projectDir)
    expect(readComposedMusic(projectDir, 15)).toMatch(
      /The score is 34 bars \(60 s\); a 15 s reel at 136 BPM is 9 bars/,
    )
    writeComposerRun(projectDir, { json: { ...musicJson(), bpm: 999 } })
    expect(readComposedMusic(projectDir, 60)).toMatch(/build\/music.json: bpm must be/)
  })

  it('refuses a slice: its report, or a score.wav that is not the length music.json says', () => {
    writeComposerRun(projectDir, {
      report: { ...REPORT, out: 'audio/score.wav', window: [14, 28] },
    })
    expect(readComposedMusic(projectDir, 60)).toMatch(/score-report.json is of a slice/)
    writeComposerRun(projectDir, { report: { ...REPORT, out: 'audio/sketch.wav', window: null } })
    expect(readComposedMusic(projectDir, 60)).toMatch(/another output \(audio\/sketch.wav\)/)
    // A full run, then a slice that overwrote score.wav (a version that allowed it): 14 s of 60.
    writeComposerRun(projectDir, {
      report: { ...REPORT, out: 'audio/score.wav', window: null },
      wavSec: 14,
    })
    expect(readComposedMusic(projectDir, 60)).toMatch(
      /audio\/score.wav is 14 s, but build\/music.json is the 60 s score: run the whole score again/,
    )
    const notWav = path.join(projectDir, 'music', 'audio', 'score.wav')
    fs.writeFileSync(notWav, Buffer.alloc(4096))
    fs.utimesSync(notWav, Date.now() / 1000, Date.now() / 1000)
    expect(readComposedMusic(projectDir, 60)).toMatch(/is not a WAV the composer wrote/)
  })

  it('never follows a link out of the reel', () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'motion-outside-'))
    try {
      // reel/music itself a link: the link goes, a real folder is made, outside is untouched.
      fs.mkdirSync(path.join(outside, 'tools'))
      fs.writeFileSync(path.join(outside, 'tools', 'keep.txt'), 'keep')
      fs.symlinkSync(outside, path.join(projectDir, 'music'))
      installComposer(projectDir, { bpm: 120, lengthSec: 15, title: 'A launch' })
      expect(fs.lstatSync(path.join(projectDir, 'music')).isSymbolicLink()).toBe(false)
      expect(fs.readFileSync(path.join(outside, 'tools', 'keep.txt'), 'utf8')).toBe('keep')
      expect(fs.existsSync(path.join(outside, 'reel.config.mjs'))).toBe(false)

      // A score linked to a file elsewhere is not read or copied.
      writeComposerRun(projectDir)
      const secret = path.join(outside, 'secret.wav')
      fs.writeFileSync(secret, silentWav(60))
      const wav = path.join(projectDir, 'music', 'audio', 'score.wav')
      fs.rmSync(wav)
      fs.symlinkSync(secret, wav)
      expect(readComposedMusic(projectDir, 60)).toMatch(/is a link to a file outside the reel/)
      expect(
        fs.readdirSync(path.join(projectDir, 'music')).some((f) => f.startsWith('composer-')),
      ).toBe(false)
    } finally {
      fs.rmSync(outside, { force: true, recursive: true })
    }
  })

  it('installs the composer when a reel set up without it asks for it', () => {
    const o = { bpm: 128, lengthSec: 15, title: 'A launch' }
    expect(ensureComposer(projectDir, o)).toBe(true)
    expect(fs.existsSync(path.join(projectDir, 'music', 'tools', 'score.mjs'))).toBe(true)
    expect(ensureComposer(projectDir, o)).toBe(false)
  })
})

describe('composed scores at awkward tempos', () => {
  /** A minimal music.json: `bars` 4/4 bars at `bpm`, one kick per beat. */
  const scoreOf = (bpm: number, bars: number, extra: Record<string, unknown> = {}) => {
    const beatSec = 60 / bpm
    return {
      beatsPerBar: 4,
      bpm,
      chords: [],
      duration: bars * 4 * beatSec,
      hits: { kick: Array.from({ length: bars * 4 }, (_, i) => [i * beatSec, 1]) },
      key: 'Eb',
      motif: [],
      scale: 'lydian',
      sections: [{ at: 0, dur: bars * 4 * beatSec, energy: 2, name: 'all' }],
      voices: { kick: { inst: 'kick' } },
      ...extra,
    }
  }

  it("asks for the bars the reel's fit gives (30 s at 116 BPM is 15: fitReel rounds the same way)", () => {
    expect(reelBarsAt(30, 116)).toBe(15)
    expect(reelBarsAt(60, 226)).toBe(57)
  })

  it('keeps the last beat when the length is not a whole millisecond', () => {
    const score = composerScore(scoreOf(116, 15))
    if (typeof score === 'string') throw new Error(score)
    expect(score.grid.beats).toHaveLength(60)
    expect(score.grid.beats.at(-1)).toBe(30.517)
  })

  it('takes a found-sound kit by its voice names, and nothing after the end', () => {
    const json = scoreOf(120, 4, {
      hits: {
        clap_lid: [[0.5, 1]],
        kick_crate: [
          [0, 1],
          [1, 1],
          [8.5, 1],
        ],
      },
      voices: { clap_lid: { inst: 'ceramic' }, kick_crate: { inst: 'membrane' } },
    })
    const score = composerScore(json)
    if (typeof score === 'string') throw new Error(score)
    expect(score.grid.events?.kicks).toEqual([0, 1])
    expect(score.grid.events?.snares).toEqual([0.5])
  })

  it('reads a large file quickly (hits piled on one beat)', () => {
    const many = Array.from({ length: 20_000 }, () => [7.99, 1])
    const hits = Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`kick${i}`, many]))
    const voices = Object.fromEntries(Object.keys(hits).map((v) => [v, { inst: 'kick' }]))
    const started = Date.now()
    const score = composerScore(scoreOf(120, 4, { hits, voices }))
    if (typeof score === 'string') throw new Error(score)
    expect(Date.now() - started).toBeLessThan(2000)
    expect(score.grid.events?.kicks).toEqual([7.99])
  })
})
