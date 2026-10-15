import { execFileSync, spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import { normalizeDeliveredAudioToAac } from './aac-normalize'
import { BEAT_LOOP_LOUDNESS, finishBeatLoopVideo, parseLoudnormStats } from './beat-loop-finish'
import { BEAT_LOOP_SOUND_SOURCES, masterBeatLoopSound } from './beat-loop-music'
import { remuxBgmVariant } from './bgm-remux'

describe('BEAT_LOOP_SOUND_SOURCES', () => {
  it("names the files the finish pass mixes: the voice-over and the loop's joined clips", () => {
    expect(BEAT_LOOP_SOUND_SOURCES).toEqual({
      clips: 'long_take/beat_loop_clips.mp4',
      voice: 'story_loader/audio/voice_over.mp3',
    })
  })
})

const ffmpegAvailable = spawnSync('ffmpeg', ['-version']).status === 0
// Skipped on a computer without FFmpeg, never on CI: there a missing FFmpeg fails the run.
const describeWithFfmpeg = ffmpegAvailable || process.env['CI'] ? describe : describe.skip

describeWithFfmpeg('music on a delivered loop (ffmpeg)', () => {
  jest.setTimeout(180_000)
  let dir: string
  const ffmpeg = (...args: string[]) =>
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args])
  const at = (name: string) => path.join(dir, name)
  /** Decoded audio as a hash: equal hashes sound exactly the same. */
  const pcm = (file: string) =>
    execFileSync('ffmpeg', ['-loglevel', 'error', '-i', file, '-map', '0:a:0', '-f', 'md5', '-'], {
      encoding: 'utf8',
    }).trim()
  /** Decoded picture as a hash. */
  const picture = (file: string) =>
    execFileSync('ffmpeg', ['-loglevel', 'error', '-i', file, '-map', '0:v:0', '-f', 'md5', '-'], {
      encoding: 'utf8',
    }).trim()
  const loudness = (file: string) =>
    parseLoudnormStats(
      spawnSync(
        'ffmpeg',
        ['-hide_banner', '-nostats', '-i', file, '-vn', '-af', 'loudnorm=print_format=json'].concat(
          ['-f', 'null', '-'],
        ),
        { encoding: 'utf8' },
      ).stderr,
    )
  const frames = (file: string) =>
    execFileSync(
      'ffprobe',
      ['-v', 'error', '-count_frames', '-select_streams', 'v:0'].concat([
        '-show_entries',
        'stream=nb_read_frames',
        '-of',
        'csv=p=0',
        file,
      ]),
      { encoding: 'utf8' },
    ).trim()

  /** A music change on the delivered loop, as the remux activity makes it. */
  const changeMusic = async (videoPath: string, name: string, bed?: { volume: number }) => {
    const sound = await masterBeatLoopSound({
      ...(bed ? { bedPath: at('bed.wav') } : {}),
      bgmVolume: bed?.volume ?? 60,
      clipsPath: at('clips.mp4'),
      durationS: 8,
      outputPath: at(`${name}.m4a`),
      voicePath: at('voice.wav'),
    })
    const { outputPath } = await remuxBgmVariant({
      copyAudio: true,
      outputBaseName: name,
      videoPath,
      voiceoverPath: sound.audioPath,
      withBed: false,
      workDir: dir,
    })
    return { ...sound, outputPath }
  }

  beforeAll(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'beat-loop-music-'))
    // Two 4 s clips at 24 fps with their own sound: pink noise hitting at each clip's start.
    ffmpeg(
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=540x960:rate=24:duration=8',
      '-f',
      'lavfi',
      '-i',
      'anoisesrc=color=pink:amplitude=0.5:duration=8:sample_rate=48000',
      '-af',
      "volume='if(lt(mod(t,4),0.25),1,0.12)':eval=frame",
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-c:a',
      'aac',
      '-shortest',
      at('clips.mp4'),
    )
    const line = 'between(mod(t,4),0.15,3.2)*(0.55+0.45*sin(2*PI*5*t))'
    ffmpeg(
      '-f',
      'lavfi',
      '-i',
      `aevalsrc='0.25*(sin(2*PI*190*t)+0.5*sin(2*PI*380*t))*${line}':s=48000:d=8`,
      at('voice.wav'),
    )
    // The music: a chord pad, longer than the loop.
    ffmpeg(
      '-f',
      'lavfi',
      '-i',
      "aevalsrc='0.4*(sin(2*PI*220*t)+sin(2*PI*277*t)+sin(2*PI*330*t))/3':s=44100:d=12",
      at('bed.wav'),
    )
    // The loop as delivered, without music: as finalizeRender makes it, the clips' sound
    // re-encoded to AAC first, then the finish pass.
    await finishBeatLoopVideo({
      durationS: 8,
      outputPath: at('delivered.mp4'),
      videoPath: await normalizeDeliveredAudioToAac(at('clips.mp4'), dir, 'deliver_aac.mp4'),
      voicePath: at('voice.wav'),
    })
  })
  afterAll(() => fs.rmSync(dir, { force: true, recursive: true }))

  it("puts the music under the loop's own sound on the same picture: -14 LUFS, -1.5 dBTP, 192 frames", async () => {
    const on = await changeMusic(at('delivered.mp4'), 'music-on', { volume: 60 })

    expect(pcm(on.outputPath)).toBe(pcm(on.audioPath))
    expect(pcm(on.outputPath)).not.toBe(pcm(at('delivered.mp4')))
    expect(picture(on.outputPath)).toBe(picture(at('delivered.mp4')))
    expect(frames(on.outputPath)).toBe('192')
    const out = loudness(on.outputPath)
    expect(Math.abs(out.inputI - BEAT_LOOP_LOUDNESS.lufs)).toBeLessThanOrEqual(0.5)
    expect(out.inputTp).toBeLessThanOrEqual(BEAT_LOOP_LOUDNESS.truePeakDb)
    // What the live preview's music level is tuned by: the bed against the voice it plays.
    expect(on.bedToVoiceGainDb).toBeCloseTo(
      (on.result.levels.voice?.lufs ?? 0) - (on.result.levels.music?.lufs ?? 0),
      5,
    )
  })

  it('changes the level, and turning music off puts back the exact sound delivered without it', async () => {
    const loud = await changeMusic(at('delivered.mp4'), 'music-60', { volume: 60 })
    const quiet = await changeMusic(loud.outputPath, 'music-20', { volume: 20 })
    expect(pcm(quiet.outputPath)).not.toBe(pcm(loud.outputPath))
    expect(
      (quiet.result.levels.music?.gainDb ?? 0) - (loud.result.levels.music?.gainDb ?? 0),
    ).toBeLessThan(0)

    const off = await changeMusic(quiet.outputPath, 'music-off')
    expect(off.result.levels.music).toBeUndefined()
    expect(off.bedToVoiceGainDb).toBeUndefined()
    expect(pcm(off.outputPath)).toBe(pcm(at('delivered.mp4')))
    expect(picture(off.outputPath)).toBe(picture(at('delivered.mp4')))
  })

  it('mixes no music at 0%', async () => {
    const zero = await changeMusic(at('delivered.mp4'), 'music-zero', { volume: 0 })
    expect(zero.result.levels.music).toBeUndefined()
    expect(pcm(zero.outputPath)).toBe(pcm(at('delivered.mp4')))
  })
})
