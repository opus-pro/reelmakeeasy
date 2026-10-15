import { execFileSync, spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { STORY_LOADER_PATHS } from '../agent-v2/paths'
import { computeSfxMixGainDb } from '../utils/beat-lock'

import {
  BEAT_LOOP_VOICE_LUFS,
  type BeatLoopMixLevels,
  measureBeatLoopMix,
  parseLoudnormStats,
} from './beat-loop-finish'
import {
  BEAT_LOOP_SFX_BED_PATH,
  BEAT_LOOP_SFX_BED_PEAK_DB,
  BEAT_LOOP_SFX_BED_RECORD_PATH,
  type BeatLoopSfxBedRecord,
  makeBeatLoopSfxBed,
  parseBeatLoopSfxBedRecord,
  planBeatLoopSfxBed,
  readBeatLoopSfxBed,
  rebuildBeatLoopSfxBed,
  storeBeatLoopSfxBed,
} from './beat-loop-sfx-bed'

const CLIPS_PATH = 'long_take/beat_loop_clips.mp4'
const VOICE_PATH = STORY_LOADER_PATHS.audioVoiceoverPath

/** A voice-over measured at -18 LUFS: the mix turns it down 5 dB to -23. */
const VOICE = { gainDb: -5, lufs: -18, peakDb: -2 }

/** The clips' sound as the mix measures it, with the mix's own gain for it. */
const sfx = (lufs: number, peakDb: number, voice = true) => ({
  gainDb: voice ? computeSfxMixGainDb({ clipLufs: lufs, voiceLufs: BEAT_LOOP_VOICE_LUFS }) : 0,
  lufs,
  peakDb,
})

/** dB of a 0-100 % volume. */
const volumeDb = (volume: number) => 20 * Math.log10(volume / 100)

describe('planBeatLoopSfxBed', () => {
  it("puts the clips' sound at the voice-over's loudness, played at the mix's 35% under it", () => {
    const levels = { sfx: sfx(-20, -12), voice: VOICE }
    const plan = planBeatLoopSfxBed(levels)
    // As loud as the voice-over: -20 LUFS up 2 dB to -18.
    expect(plan.gainDb).toBe(2)
    // 9.1 LU under the voice, as in the mix: 35%.
    expect(plan.volume).toBe(35.1)
    // The file and its volume together carry the mix's gain over the voice's.
    expect(Number(plan.gainDb) + volumeDb(plan.volume)).toBeCloseTo(
      levels.sfx.gainDb - levels.voice.gainDb,
      1,
    )
  })

  it('keeps the peaks under the ceiling, and plays the file louder to make up', () => {
    const levels = { sfx: sfx(-20, -1), voice: VOICE }
    const plan = planBeatLoopSfxBed(levels)
    expect(plan.gainDb).toBe(BEAT_LOOP_SFX_BED_PEAK_DB + 1)
    expect(plan.volume).toBe(49.5)
    expect(Number(plan.gainDb) + volumeDb(plan.volume)).toBeCloseTo(
      levels.sfx.gainDb - levels.voice.gainDb,
      1,
    )
  })

  it('follows the mix where it caps the boost of very quiet clips', () => {
    // The mix would lift these clips 12.9 dB but stops at +6: they sit 16 LU under the voice.
    const levels = { sfx: sfx(-45, -30), voice: VOICE }
    expect(levels.sfx.gainDb).toBe(6)
    const plan = planBeatLoopSfxBed(levels)
    expect(plan.gainDb).toBe(27)
    expect(plan.volume).toBe(15.8)
  })

  it('never asks for more than 100%: a sparse, peaky bed then plays a little under the mix', () => {
    const plan = planBeatLoopSfxBed({ sfx: sfx(-40, -1), voice: VOICE })
    expect(plan.gainDb).toBe(BEAT_LOOP_SFX_BED_PEAK_DB + 1)
    expect(plan.volume).toBe(100)
  })

  it("plays the clips' sound at its own level when there is no voice", () => {
    expect(planBeatLoopSfxBed({ sfx: sfx(-20, -6, false) })).toEqual({ gainDb: 0, volume: 100 })
    // Peaks over the ceiling are still brought under it.
    expect(planBeatLoopSfxBed({ sfx: sfx(-12, 1, false) })).toEqual({ gainDb: -3, volume: 100 })
  })

  it('is silence at 0% when the clips make no sound', () => {
    expect(planBeatLoopSfxBed({ voice: VOICE })).toEqual({ gainDb: null, volume: 0 })
    expect(planBeatLoopSfxBed({})).toEqual({ gainDb: null, volume: 0 })
  })
})

describe('parseBeatLoopSfxBedRecord', () => {
  const record: BeatLoopSfxBedRecord = {
    durationS: 32,
    gainDb: 2,
    sfxGainDb: -12.1,
    version: 1,
    voiceGainDb: -5,
    volume: 35.1,
  }

  it('reads a record the bed was stored with', () => {
    expect(parseBeatLoopSfxBedRecord(record)).toEqual(record)
    expect(parseBeatLoopSfxBedRecord({ ...record, gainDb: null, volume: 0 })).toMatchObject({
      gainDb: null,
      volume: 0,
    })
  })

  it('reads anything without a usable volume, or from another recipe, as no record', () => {
    for (const raw of [
      undefined,
      null,
      'x',
      [],
      { ...record, volume: undefined },
      { ...record, volume: '35' },
      { ...record, volume: 120 },
      { ...record, volume: -1 },
      { ...record, volume: Number.NaN },
      { ...record, version: undefined },
      { ...record, version: 2 },
    ]) {
      expect(parseBeatLoopSfxBedRecord(raw)).toBeNull()
    }
  })
})

describe('storeBeatLoopSfxBed', () => {
  it('uploads the bed, then writes its record, so a record always names a bed that is there', async () => {
    const calls: string[] = []
    const storage = {
      uploadFile: jest.fn(async (_local: string, storagePath: string) => {
        calls.push(`upload ${storagePath}`)
      }),
      writeJsonFile: jest.fn(async (pathName: string) => {
        calls.push(`record ${pathName}`)
      }),
    }
    const record: BeatLoopSfxBedRecord = {
      durationS: 8,
      gainDb: 0,
      sfxGainDb: 0,
      version: 1,
      voiceGainDb: null,
      volume: 100,
    }
    await storeBeatLoopSfxBed(storage, { file: '/tmp/bed.m4a', record })
    expect(calls).toEqual([
      `upload ${BEAT_LOOP_SFX_BED_PATH}`,
      `record ${BEAT_LOOP_SFX_BED_RECORD_PATH}`,
    ])
    expect(storage.uploadFile).toHaveBeenCalledWith('/tmp/bed.m4a', BEAT_LOOP_SFX_BED_PATH)
    expect(storage.writeJsonFile).toHaveBeenCalledWith(BEAT_LOOP_SFX_BED_RECORD_PATH, record)
  })
})

describe('readBeatLoopSfxBed', () => {
  const RECORD = {
    durationS: 8,
    gainDb: 2,
    sfxGainDb: -12.1,
    version: 1,
    voiceGainDb: -5,
    volume: 35.1,
  }

  /** A project folder: each file with its version (undefined: the backend reports none). */
  function folder(files: Record<string, { body?: unknown; version?: string }>) {
    return {
      exists: async (p: string) => p in files,
      getObjectMetadata: async (p: string) => {
        const version = files[p]?.version
        return version === undefined ? undefined : { custom: {}, version }
      },
      readJsonFile: async <T>(p: string): Promise<T> => {
        if (!(p in files)) throw new Error(`No such object: ${p}`)
        return structuredClone(files[p].body) as T
      },
    }
  }

  it('is current when the bed and its record are newer than the clips and the voice-over', async () => {
    const state = await readBeatLoopSfxBed(
      folder({
        [BEAT_LOOP_SFX_BED_PATH]: { version: '1700000000000300' },
        [BEAT_LOOP_SFX_BED_RECORD_PATH]: { body: RECORD, version: '1700000000000400' },
        [CLIPS_PATH]: { version: '1700000000000100' },
        [VOICE_PATH]: { version: '1700000000000050' },
      }),
      { clipsPath: CLIPS_PATH },
    )
    // `clipsVersion`: the joined clips the bed was made from, which the preview plays with it.
    expect(state).toEqual({
      clipsVersion: '1700000000000100',
      record: RECORD,
      state: 'current',
      version: '1700000000000300',
    })
  })

  it('is missing without a record, with a record that is not one, or without the file', async () => {
    const cases: Array<Parameters<typeof folder>[0]> = [
      { [BEAT_LOOP_SFX_BED_PATH]: { version: '2' }, [CLIPS_PATH]: { version: '1' } },
      {
        [BEAT_LOOP_SFX_BED_PATH]: { version: '2' },
        [BEAT_LOOP_SFX_BED_RECORD_PATH]: { body: { volume: 'loud' }, version: '3' },
        [CLIPS_PATH]: { version: '1' },
      },
      {
        [BEAT_LOOP_SFX_BED_RECORD_PATH]: { body: RECORD, version: '3' },
        [CLIPS_PATH]: { version: '1' },
      },
    ]
    for (const files of cases) {
      expect(await readBeatLoopSfxBed(folder(files), { clipsPath: CLIPS_PATH })).toEqual({
        state: 'missing',
      })
    }
  })

  it('is stale when the clips or the voice-over changed after it was made', async () => {
    // A render joined new clips, then failed before its finish wrote a new bed.
    const newClips = folder({
      [BEAT_LOOP_SFX_BED_PATH]: { version: '2' },
      [BEAT_LOOP_SFX_BED_RECORD_PATH]: { body: RECORD, version: '3' },
      [CLIPS_PATH]: { version: '10' },
    })
    expect(await readBeatLoopSfxBed(newClips, { clipsPath: CLIPS_PATH })).toEqual({
      state: 'stale',
    })
    const newVoice = folder({
      [BEAT_LOOP_SFX_BED_PATH]: { version: '2' },
      [BEAT_LOOP_SFX_BED_RECORD_PATH]: { body: RECORD, version: '3' },
      [CLIPS_PATH]: { version: '1' },
      [VOICE_PATH]: { version: '10' },
    })
    expect(await readBeatLoopSfxBed(newVoice, { clipsPath: CLIPS_PATH })).toEqual({
      state: 'stale',
    })
  })

  it('trusts the record when the storage reports no versions', async () => {
    const state = await readBeatLoopSfxBed(
      folder({
        [BEAT_LOOP_SFX_BED_PATH]: {},
        [BEAT_LOOP_SFX_BED_RECORD_PATH]: { body: RECORD },
        [CLIPS_PATH]: {},
      }),
      { clipsPath: CLIPS_PATH },
    )
    expect(state).toEqual({ record: RECORD, state: 'current' })
  })
})

const ffmpegAvailable = spawnSync('ffmpeg', ['-version']).status === 0
// Skipped on a computer without FFmpeg, never on CI: there a missing FFmpeg fails the run.
const describeWithFfmpeg = ffmpegAvailable || process.env['CI'] ? describe : describe.skip

describeWithFfmpeg('the clip sound bed (ffmpeg)', () => {
  jest.setTimeout(120_000)
  let dir: string

  const ffmpeg = (...args: string[]) =>
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args])

  /** Integrated loudness and true peak of a file, as loudnorm measures them. */
  const loudness = (file: string) => {
    const run = spawnSync(
      'ffmpeg',
      ['-hide_banner', '-nostats', '-i', file, '-vn', '-af', 'loudnorm=print_format=json'] //
        .concat(['-f', 'null', '-']),
      { encoding: 'utf8' },
    )
    return parseLoudnormStats(run.stderr)
  }

  const probe = (file: string) =>
    JSON.parse(
      execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', file], {
        encoding: 'utf8',
      }),
    ) as {
      streams: Array<{
        channels?: number
        codec_name: string
        codec_type: string
        duration?: string
        sample_rate?: string
      }>
    }

  /**
   * How far the clips' sound sits under the voice-over, LU: in the delivered mix (each source at
   * its mix gain), and in the preview (the bed at its volume beside the voice at its own level).
   */
  const gaps = (levels: BeatLoopMixLevels, bedFile: string, record: BeatLoopSfxBedRecord) => {
    const { sfx: clip, voice } = levels
    if (!clip || !voice) throw new Error('Measure the clips and the voice first')
    return {
      mix: clip.lufs + clip.gainDb - (voice.lufs + voice.gainDb),
      preview: loudness(bedFile).inputI + volumeDb(record.volume) - voice.lufs,
    }
  }

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'beat-loop-sfx-bed-'))
    // The joined clips, half a second longer than the loop: a dark picture over pink noise that
    // hits hard for the first 0.25 s of each 4 s clip.
    ffmpeg(
      '-f',
      'lavfi',
      '-i',
      'color=c=0x203040:size=270x480:rate=24:duration=8.5',
      '-f',
      'lavfi',
      '-i',
      'anoisesrc=color=pink:amplitude=0.5:duration=8.5:sample_rate=48000:seed=1',
      '-af',
      "volume='if(lt(mod(t,4),0.25),1,0.12)':eval=frame",
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-c:a',
      'aac',
      '-shortest',
      path.join(dir, 'clips.mp4'),
    )
    ffmpeg(
      '-f',
      'lavfi',
      '-i',
      'color=c=0x203040:size=270x480:rate=24:duration=8',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      path.join(dir, 'silent.mp4'),
    )
    // A voice-like line per clip from 0.15 s to 3.2 s: a buzzy tone with syllable-rate swells.
    const line = 'between(mod(t,4),0.15,3.2)*(0.55+0.45*sin(2*PI*5*t))'
    ffmpeg(
      '-f',
      'lavfi',
      '-i',
      `aevalsrc='0.25*(sin(2*PI*190*t)+0.5*sin(2*PI*380*t)+0.25*sin(2*PI*570*t))*${line}':s=48000:d=8`,
      path.join(dir, 'voice.wav'),
    )
  })
  afterAll(() => fs.rmSync(dir, { force: true, recursive: true }))

  it("levels the clips' sound as the finish mixes it: at its volume it sits 9.1 LU under the voice", async () => {
    const clips = path.join(dir, 'clips.mp4')
    const levels = await measureBeatLoopMix({
      durationS: 8,
      sfxPath: clips,
      voicePath: path.join(dir, 'voice.wav'),
    })
    const outputPath = path.join(dir, 'bed.m4a')
    const record = await makeBeatLoopSfxBed({ durationS: 8, levels, outputPath, sfxPath: clips })

    expect(record.durationS).toBe(8)
    expect(record.sfxGainDb).toBeCloseTo(levels.sfx?.gainDb ?? Number.NaN, 2)
    expect(record.voiceGainDb).toBeCloseTo(levels.voice?.gainDb ?? Number.NaN, 2)
    expect(record.volume).toBeGreaterThan(0)
    expect(record.volume).toBeLessThanOrEqual(100)
    // The preview hears the mix's balance: the clips 9.1 LU under the voice.
    const { mix, preview } = gaps(levels, outputPath, record)
    expect(mix).toBeCloseTo(-9.1, 1)
    expect(Math.abs(preview - mix)).toBeLessThanOrEqual(0.3)
    // Never clipped, though the clips hit near full scale.
    expect(loudness(outputPath).inputTp).toBeLessThan(0)

    // AAC at 48 kHz stereo, trimmed to the loop although the clips run half a second over.
    const [audio, ...others] = probe(outputPath).streams
    expect(others).toEqual([])
    expect(audio).toMatchObject({ channels: 2, codec_name: 'aac', sample_rate: '48000' })
    expect(Number(audio.duration)).toBeCloseTo(8, 1)
  })

  it("measures the mix's levels itself when the finish's are not handed over", async () => {
    const clips = path.join(dir, 'clips.mp4')
    const voicePath = path.join(dir, 'voice.wav')
    const levels = await measureBeatLoopMix({ durationS: 8, sfxPath: clips, voicePath })
    const handed = await makeBeatLoopSfxBed({
      durationS: 8,
      levels,
      outputPath: path.join(dir, 'handed.m4a'),
      sfxPath: clips,
    })
    const measured = await makeBeatLoopSfxBed({
      durationS: 8,
      outputPath: path.join(dir, 'measured.m4a'),
      sfxPath: clips,
      voicePath,
    })
    expect(measured).toEqual(handed)
  })

  it('makes a silent bed, played at 0%, when the clips make no sound', async () => {
    const outputPath = path.join(dir, 'silent.m4a')
    const record = await makeBeatLoopSfxBed({
      durationS: 8,
      outputPath,
      sfxPath: path.join(dir, 'silent.mp4'),
      voicePath: path.join(dir, 'voice.wav'),
    })
    expect(record).toMatchObject({ gainDb: null, sfxGainDb: null, volume: 0 })
    const [audio] = probe(outputPath).streams
    expect(audio).toMatchObject({ codec_name: 'aac' })
    expect(Number(audio.duration)).toBeCloseTo(8, 1)
    expect(loudness(outputPath).inputI).toBeLessThan(-70)
  })

  describe('rebuildBeatLoopSfxBed', () => {
    /** A project folder on disk; every write takes a newer version. */
    function folder(root: string) {
      let clock = 1_000
      const versions = new Map<string, number>()
      const put = (p: string) => versions.set(p, (clock += 1))
      return {
        downloadFile: async (p: string, local: string) => {
          await fs.promises.mkdir(path.dirname(local), { recursive: true })
          await fs.promises.copyFile(path.join(root, p), local)
        },
        exists: async (p: string) => fs.existsSync(path.join(root, p)),
        getObjectMetadata: async (p: string) =>
          versions.has(p) ? { custom: {}, version: String(versions.get(p)) } : undefined,
        put: async (local: string, p: string) => {
          await fs.promises.mkdir(path.dirname(path.join(root, p)), { recursive: true })
          await fs.promises.copyFile(local, path.join(root, p))
          put(p)
        },
        readJsonFile: async <T>(p: string): Promise<T> =>
          JSON.parse(await fs.promises.readFile(path.join(root, p), 'utf8')) as T,
        uploadFile: jest.fn(async (local: string, p: string) => {
          await fs.promises.mkdir(path.dirname(path.join(root, p)), { recursive: true })
          await fs.promises.copyFile(local, path.join(root, p))
          put(p)
          return p
        }),
        writeJsonFile: jest.fn(async (p: string, data: unknown) => {
          await fs.promises.mkdir(path.dirname(path.join(root, p)), { recursive: true })
          await fs.promises.writeFile(path.join(root, p), JSON.stringify(data))
          put(p)
          return path.join(root, p)
        }),
      }
    }

    it('builds a finished loop its bed from the stored clips and voice-over, as the finish would', async () => {
      const storage = folder(path.join(dir, 'project'))
      await storage.put(path.join(dir, 'clips.mp4'), CLIPS_PATH)
      await storage.put(path.join(dir, 'voice.wav'), VOICE_PATH)

      const record = await rebuildBeatLoopSfxBed(storage, { clipsPath: CLIPS_PATH, durationS: 8 })

      const expected = await makeBeatLoopSfxBed({
        durationS: 8,
        outputPath: path.join(dir, 'expected.m4a'),
        sfxPath: path.join(dir, 'clips.mp4'),
        voicePath: path.join(dir, 'voice.wav'),
      })
      expect(record).toEqual(expected)
      expect(await readBeatLoopSfxBed(storage, { clipsPath: CLIPS_PATH })).toMatchObject({
        record: expected,
        state: 'current',
      })
      const stored = path.join(dir, 'project', BEAT_LOOP_SFX_BED_PATH)
      expect(Number(probe(stored).streams[0].duration)).toBeCloseTo(8, 1)
    })

    it("plays a loop with no voice-over at the clips' own level", async () => {
      const storage = folder(path.join(dir, 'no-voice'))
      await storage.put(path.join(dir, 'clips.mp4'), CLIPS_PATH)
      const record = await rebuildBeatLoopSfxBed(storage, { clipsPath: CLIPS_PATH, durationS: 8 })
      expect(record).toMatchObject({ sfxGainDb: 0, voiceGainDb: null, volume: 100 })
    })

    it('stores nothing when the clips change while it works: a render writes its own bed', async () => {
      const storage = folder(path.join(dir, 'raced'))
      await storage.put(path.join(dir, 'clips.mp4'), CLIPS_PATH)
      await storage.put(path.join(dir, 'voice.wav'), VOICE_PATH)
      const download = storage.downloadFile
      storage.downloadFile = async (p, local) => {
        await download(p, local)
        // A render joins its clips again while the bed is made from the ones downloaded.
        if (p === VOICE_PATH) await storage.put(path.join(dir, 'clips.mp4'), CLIPS_PATH)
      }

      await expect(
        rebuildBeatLoopSfxBed(storage, { clipsPath: CLIPS_PATH, durationS: 8 }),
      ).resolves.toBeUndefined()
      expect(storage.uploadFile).not.toHaveBeenCalled()
      expect(storage.writeJsonFile).not.toHaveBeenCalled()
    })
  })
})
