import { execFileSync, spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  alimiterHelpHasLatency,
  beatLockClip,
  buildBeatLockFilter,
  buildClipLevelFilter,
  buildJointCrossfadeFilter,
  buildLimiterFilter,
  computeSfxLevelGainDb,
  computeSfxMixGainDb,
  joinClipAudio,
  levelClipAudio,
  measureClipLoudness,
  parseEbur128Summary,
  resolveBeatLockPlan,
  SFX_LEVEL_MAX_GAIN_DB,
  SFX_REF_LUFS,
  SFX_UNDER_VOICE_LU,
} from './beat-lock'

// H3 answers a 4 s request with 107 frames at 24 fps (4.458 s) and ~22 ms of extra audio.
const H3_FRAMES = 107
const H3_DURATION_S = H3_FRAMES / 24

describe('resolveBeatLockPlan', () => {
  it('retimes the H3 tail by (D - 3) / 1', () => {
    const plan = resolveBeatLockPlan({ durationS: H3_DURATION_S, fps: 24, frames: H3_FRAMES })
    expect(plan.action).toBe('retime')
    expect(plan.multiplier).toBeCloseTo(1.4583, 4)
  })

  it('leaves an exact 4.000 s, 96-frame clip alone', () => {
    expect(resolveBeatLockPlan({ durationS: 4, fps: 24, frames: 96 })).toEqual({
      action: 'noop',
      multiplier: 1,
    })
  })

  it('retimes a 4 s clip that is not at 24 fps', () => {
    expect(resolveBeatLockPlan({ durationS: 4, fps: 30, frames: 120 }).action).toBe('retime')
  })

  it('asks for a re-roll when the tail would play faster than 2x or slower than 0.5x', () => {
    expect(resolveBeatLockPlan({ durationS: 3.4, fps: 24, frames: 82 })).toMatchObject({
      action: 'reroll',
    })
    expect(resolveBeatLockPlan({ durationS: 5.2, fps: 24, frames: 125 })).toMatchObject({
      action: 'reroll',
    })
    expect(resolveBeatLockPlan({ durationS: 2.5, fps: 24, frames: 60 }).action).toBe('reroll')
  })

  it('accepts the 0.5x and 2x edges', () => {
    expect(resolveBeatLockPlan({ durationS: 3.5, fps: 24, frames: 84 })).toEqual({
      action: 'retime',
      multiplier: 0.5,
    })
    expect(resolveBeatLockPlan({ durationS: 5, fps: 24, frames: 120 })).toEqual({
      action: 'retime',
      multiplier: 2,
    })
  })

  it('honours a custom hold and target', () => {
    const plan = resolveBeatLockPlan({ durationS: 9, fps: 24, frames: 216, holdS: 6, targetS: 8 })
    expect(plan).toEqual({ action: 'retime', multiplier: 1.5 })
  })
})

describe('buildBeatLockFilter', () => {
  it('keeps 0-3 s, retimes the tail with setpts and atempo, and ends at exactly 96 frames', () => {
    const filter = buildBeatLockFilter({
      durationS: H3_DURATION_S,
      hasAudio: true,
      multiplier: 1.458333,
    })
    expect(filter).toContain('trim=end=3,setpts=PTS-STARTPTS')
    expect(filter).toContain('trim=start=3,setpts=(PTS-STARTPTS)/1.458333')
    expect(filter).toContain('trim=end_frame=96')
    // The audio is trimmed to the video before the tail is sped up.
    expect(filter).toContain('[0:a]asetpts=PTS-STARTPTS,atrim=end=4.458333')
    expect(filter).toContain('atempo=1.458333')
    expect(filter).toContain('apad=whole_dur=4,atrim=end=4')
  })

  it('has no audio chain for a silent clip', () => {
    const filter = buildBeatLockFilter({ durationS: 4.2, hasAudio: false, multiplier: 1.2 })
    expect(filter).not.toContain('[0:a]')
    expect(filter).toContain('[v]')
  })
})

describe('clip audio levels', () => {
  it('gains each clip to the SFX reference', () => {
    expect(SFX_REF_LUFS).toBe(-17.5)
    expect(computeSfxLevelGainDb(-24.4)).toBeCloseTo(6.9, 5)
    expect(computeSfxLevelGainDb(-16)).toBeCloseTo(-1.5, 5)
    // Omni clips sit near -33 LUFS.
    expect(computeSfxLevelGainDb(-33)).toBeCloseTo(15.5, 5)
  })

  it('caps the boost at +21 dB', () => {
    expect(SFX_LEVEL_MAX_GAIN_DB).toBe(21)
    expect(computeSfxLevelGainDb(-45)).toBe(21)
  })

  it('puts the SFX about 9 LU under the voice', () => {
    expect(computeSfxMixGainDb({ clipLufs: -17.5, voiceLufs: -23 })).toBeCloseTo(-14.6, 5)
    expect(computeSfxMixGainDb({ clipLufs: -20, voiceLufs: -16 })).toBeCloseTo(-5.1, 5)
  })

  it('keeps the mix gain inside the BGM bounds', () => {
    expect(computeSfxMixGainDb({ clipLufs: -69, voiceLufs: -14 })).toBe(6)
    expect(computeSfxMixGainDb({ clipLufs: 0, voiceLufs: -40 })).toBe(-30)
  })

  it('reads the integrated loudness and true peak from an ebur128 summary', () => {
    const stderr = [
      '[Parsed_ebur128_0 @ 0x1] t: 3.9  TARGET:-23 LUFS    M: -21.9 S:-120.7     I: -21.8 LUFS',
      '[Parsed_ebur128_0 @ 0x1] Summary:',
      '',
      '  Integrated loudness:',
      '    I:         -21.8 LUFS',
      '    Threshold: -31.8 LUFS',
      '',
      '  True peak:',
      '    Peak:      -20.3 dBFS',
    ].join('\n')
    expect(parseEbur128Summary(stderr)).toEqual({ integratedLufs: -21.8, truePeakDbtp: -20.3 })
  })

  it('reports silence as unmeasurable', () => {
    const stderr =
      'Summary:\n  Integrated loudness:\n    I:         -70.0 LUFS\n  True peak:\n    Peak:       -inf dBFS'
    expect(parseEbur128Summary(stderr)).toEqual({ integratedLufs: null, truePeakDbtp: null })
  })
})

describe('the limiter', () => {
  it('takes its look-ahead back out with latency=1 where FFmpeg has it', () => {
    expect(buildLimiterFilter({ latency: true, limit: 0.5 })).toBe(
      'alimiter=limit=0.5:level=disabled:latency=1',
    )
    expect(buildLimiterFilter({ attackMs: 5, latency: true, limit: 0.5, releaseMs: 50 })).toBe(
      'alimiter=limit=0.5:attack=5:release=50:level=disabled:latency=1',
    )
  })

  it('cuts the look-ahead off the start and pads the end on FFmpeg 4 (no latency option)', () => {
    const filter = buildLimiterFilter({ latency: false, limit: 0.5 })
    expect(filter).not.toContain('latency')
    expect(filter).toBe(
      'alimiter=limit=0.5:level=disabled,atrim=start=0.005,asetpts=PTS-STARTPTS,apad=pad_dur=0.005',
    )
    expect(buildLimiterFilter({ attackMs: 8, latency: false, limit: 0.5 })).toContain(
      'atrim=start=0.008',
    )
    expect(buildClipLevelFilter(3, { latency: false })).not.toContain('latency')
    expect(buildClipLevelFilter(3)).toContain('latency=1')
  })

  it("reads whether alimiter has the latency option from FFmpeg's filter help", () => {
    const help = (options: string[]) =>
      ['Filter alimiter', '  Audio lookahead limiter.', 'alimiter AVOptions:', ...options].join(
        '\n',
      )
    const ffmpeg44 = ['   level_in <double>', '   asc_level <double>', '   level <boolean>']
    expect(alimiterHelpHasLatency(help(ffmpeg44))).toBe(false)
    expect(
      alimiterHelpHasLatency(
        help([...ffmpeg44, '   latency <boolean> ..F.A....T. compensate delay']),
      ),
    ).toBe(true)
    expect(alimiterHelpHasLatency('')).toBe(false)
  })
})

describe('mix gain', () => {
  it('is the BGM formula with the SFX 9.1 LU under the voice', () => {
    expect(SFX_UNDER_VOICE_LU).toBe(9.1)
    expect(computeSfxMixGainDb({ clipLufs: -17.5, gapLu: 6, voiceLufs: -23 })).toBeCloseTo(-11.5, 5)
  })
})

describe('buildJointCrossfadeFilter', () => {
  it('fades each joint over 15 ms without moving any clip off the 4 s grid', () => {
    const filter = buildJointCrossfadeFilter({ clipCount: 3 })
    // Outgoing clips fade out over their last 7.5 ms, incoming clips fade in over their first 7.5 ms.
    expect(filter).toContain('afade=t=out:st=3.9925:d=0.0075')
    expect(filter).toContain('afade=t=in:st=0:d=0.0075')
    expect(filter).toContain('apad=whole_dur=4,atrim=end=4')
    expect(filter).toContain('concat=n=3:v=0:a=1[sfx]')
    expect(filter).not.toContain('acrossfade')
  })

  it('leaves the file ends hard when the clips do not loop', () => {
    const filter = buildJointCrossfadeFilter({ clipCount: 2, loop: false })
    expect(filter.match(/afade=t=in/g)).toHaveLength(1)
    expect(filter.match(/afade=t=out/g)).toHaveLength(1)
  })
})

const hasFfmpeg = spawnSync('ffmpeg', ['-version']).status === 0
// CI installs FFmpeg, so there a missing one fails these tests instead of skipping them.
const describeWithFfmpeg = hasFfmpeg || process.env['CI'] ? describe : describe.skip

describeWithFfmpeg('with ffmpeg', () => {
  let dir: string

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reelmakeeasy-beat-lock-'))
  })

  afterEach(() => {
    fs.rmSync(dir, { force: true, recursive: true })
  })

  describe('beatLockClip', () => {
    it('turns a 107-frame H3 clip into exactly 96 frames with the first 72 untouched', async () => {
      const input = makeClip(dir, 'h3.mp4', { audioS: 4.48, frames: H3_FRAMES })
      const output = path.join(dir, 'locked.mp4')

      const result = await beatLockClip(input, {
        holdS: 3,
        outputPath: output,
        targetS: 4,
        videoCodecArgs: LOSSLESS,
      })

      expect(result).toMatchObject({ frames: 96, retimed: true, status: 'locked' })
      expect(result.status === 'locked' && result.multiplier).toBeCloseTo(1.4583, 3)
      const before = frameHashes(input)
      const after = frameHashes(output)
      expect(after).toHaveLength(96)
      expect(after.slice(0, 72)).toEqual(before.slice(0, 72))
      // The clip still lands on its last frame (the next keyframe).
      expect(after[95]).toBe(before[H3_FRAMES - 1])
      expect(probe(output)).toMatchObject({ audioS: 4, videoS: 4 })
    })

    it('replaces the clip in place with the default encoder', async () => {
      const input = makeClip(dir, 'h3.mp4', { audioS: 4.48, frames: H3_FRAMES })

      const result = await beatLockClip(input)

      expect(result).toMatchObject({ frames: 96, outputPath: input, status: 'locked' })
      expect(probe(input)).toMatchObject({ audioS: 4, frames: 96, videoS: 4 })
      expect(fs.readdirSync(dir)).toEqual(['h3.mp4'])
    })

    it('only trims the audio of an exact 4.000 s Omni clip', async () => {
      const input = makeClip(dir, 'omni.mp4', { audioS: 4.032, frames: 96 })
      const before = frameHashes(input)

      const result = await beatLockClip(input)

      expect(result).toMatchObject({ frames: 96, multiplier: 1, retimed: false, status: 'locked' })
      expect(frameHashes(input)).toEqual(before)
      expect(probe(input)).toMatchObject({ audioS: 4, frames: 96, videoS: 4 })
    })

    it('signals a re-roll and leaves the clip alone when the tail is too short', async () => {
      const input = makeClip(dir, 'short.mp4', { audioS: 3.3, frames: 78 })
      const bytes = fs.readFileSync(input)

      const result = await beatLockClip(input)

      expect(result).toMatchObject({ status: 'reroll' })
      expect(result.multiplier).toBeCloseTo(0.25, 5)
      expect(fs.readFileSync(input).equals(bytes)).toBe(true)
    })

    it('handles a clip without audio', async () => {
      const input = makeClip(dir, 'mute.mp4', { frames: H3_FRAMES })

      const result = await beatLockClip(input)

      expect(result).toMatchObject({ frames: 96, status: 'locked' })
      expect(probe(input)).toMatchObject({ audioS: null, frames: 96, videoS: 4 })
    })
  })

  describe('levelClipAudio', () => {
    it('brings a quiet clip to the SFX reference and keeps the picture', async () => {
      const input = makeClip(dir, 'quiet.mp4', { audioS: 4, frames: 96, toneVolumeDb: -8 })
      const before = frameHashes(input)
      const measured = await measureClipLoudness(input)
      expect(measured.integratedLufs).toBeLessThan(-22)

      const result = await levelClipAudio(input)

      const after = await measureClipLoudness(input)
      expect(result).toMatchObject({
        inputLufs: measured.integratedLufs,
        outputLufs: after.integratedLufs,
        status: 'levelled',
      })
      expect(result.status === 'levelled' && result.gainDb).toBeCloseTo(
        SFX_REF_LUFS - (measured.integratedLufs ?? 0),
        5,
      )
      expect(after.integratedLufs).toBeGreaterThan(SFX_REF_LUFS - 0.6)
      expect(after.integratedLufs).toBeLessThan(SFX_REF_LUFS + 0.6)
      expect(frameHashes(input)).toEqual(before)
      expect(probe(input)).toMatchObject({ audioS: 4, videoS: 4 })
    })

    it('keeps a beat-locked clip at exactly 4.000 s of audio', async () => {
      // 4 s at 48 kHz is not a whole number of AAC frames, so a plain re-encode grows by one.
      const input = makeClip(dir, 'h3.mp4', { audioS: 4.48, frames: H3_FRAMES })
      await beatLockClip(input)

      await levelClipAudio(input)

      expect(probe(input)).toMatchObject({ audioS: 4, frames: 96, videoS: 4 })
    })

    it('caps the boost at +21 dB for a near-silent clip', async () => {
      const input = makeClip(dir, 'faint.mp4', { audioS: 4, frames: 96, toneVolumeDb: -45 })
      const measured = await measureClipLoudness(input)

      const result = await levelClipAudio(input)

      expect(result).toMatchObject({ gainDb: 21, status: 'levelled' })
      const after = await measureClipLoudness(input)
      expect(after.integratedLufs).toBeCloseTo((measured.integratedLufs ?? 0) + 21, 0)
    })

    it('limits the peaks the boost would push over full scale', async () => {
      const input = makeClip(dir, 'clicks.mp4', {
        audioS: 4,
        clicks: true,
        frames: 96,
        toneVolumeDb: -40,
      })

      const result = await levelClipAudio(input)

      // Unlimited, the boost would push the 0.5 clicks past +3 dBFS.
      expect(result.status === 'levelled' && result.gainDb).toBeGreaterThan(9)
      const after = await measureClipLoudness(input)
      expect(after.truePeakDbtp).toBeLessThan(0)
    })

    it('skips a clip without audio', async () => {
      const input = makeClip(dir, 'mute.mp4', { frames: 96 })
      const bytes = fs.readFileSync(input)

      expect(await levelClipAudio(input)).toEqual({ reason: 'no audio', status: 'skipped' })
      expect(fs.readFileSync(input).equals(bytes)).toBe(true)
    })
  })

  describe('the limiter on the clip grid', () => {
    it.each([true, false])('leaves a hit on its sample (latency option: %s)', async (latency) => {
      const click = path.join(dir, 'click.wav')
      ffmpeg(
        '-f',
        'lavfi',
        '-i',
        String.raw`aevalsrc='if(between(n\,48000\,48047)\,0.9\,0)':s=48000:d=2`,
        '-ac',
        '2',
        click,
      )
      const out = path.join(dir, 'limited.wav')
      ffmpeg(
        '-i',
        click,
        '-af',
        buildLimiterFilter({ latency, limit: 0.5 }),
        '-c:a',
        'pcm_f32le',
        out,
      )
      const samples = readSamples(out)
      expect(samples.length).toBe(96_000)
      const first = samples.findIndex((value) => Math.abs(value) > 0.05)
      expect(Math.abs(first - 48_000)).toBeLessThanOrEqual(2)
    })
  })

  describe('joinClipAudio', () => {
    it('joins clips on the exact 4 s grid with a click-free 15 ms crossfade', async () => {
      const high = makeDc(dir, 'high.wav', 0.5, 4.02)
      const low = makeDc(dir, 'low.wav', -0.5, 4)
      const output = path.join(dir, 'sfx.wav')

      const result = await joinClipAudio({ clipPaths: [high, low, high], outputPath: output })

      expect(result).toEqual({ durationS: 12, outputPath: output })
      const samples = readSamples(output)
      expect(samples).toHaveLength(12 * 48_000)
      // Every clip keeps its place on the grid.
      expect(samples[1 * 48_000]).toBeCloseTo(0.5, 3)
      expect(samples[5 * 48_000]).toBeCloseTo(-0.5, 3)
      expect(samples[9 * 48_000]).toBeCloseTo(0.5, 3)
      // A butt splice would jump by 1.0 at each joint; the fades keep every step tiny.
      let maxStep = 0
      for (let i = 1; i < samples.length; i++) {
        maxStep = Math.max(maxStep, Math.abs(samples[i] - samples[i - 1]))
      }
      expect(maxStep).toBeLessThan(0.01)
    })

    it('fills a clip without audio with silence', async () => {
      const high = makeDc(dir, 'high.wav', 0.5, 4)
      const mute = makeClip(dir, 'mute.mp4', { frames: 96 })
      const output = path.join(dir, 'sfx.m4a')

      const result = await joinClipAudio({ clipPaths: [high, mute], outputPath: output })

      expect(result.durationS).toBe(8)
      expect(probe(output).audioS).toBeCloseTo(8, 2)
    })
  })
})

// A lossless encode, so frame hashes show exactly which source frame landed where.
const LOSSLESS = ['-c:v', 'libx264', '-qp', '0', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p']

function ffmpeg(...args: string[]): Buffer {
  return execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    maxBuffer: 64 * 1024 * 1024,
  })
}

/** A testsrc clip at 24 fps (every frame differs) with an optional sine track. */
function frameHashes(file: string): string[] {
  return ffmpeg('-i', file, '-map', '0:v', '-f', 'framemd5', '-')
    .toString()
    .split('\n')
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => line.split(',').at(-1)?.trim() ?? '')
}

function makeClip(
  dir: string,
  name: string,
  params: { audioS?: number; clicks?: boolean; frames: number; toneVolumeDb?: number },
): string {
  const out = path.join(dir, name)
  const args = ['-f', 'lavfi', '-i', `testsrc=size=96x160:rate=24:duration=${params.frames / 24}`]
  if (params.audioS !== undefined) {
    const tone = `sine=frequency=440:sample_rate=32000:duration=${params.audioS}`
    const clicks = params.clicks
      ? `aevalsrc='0.5*lt(mod(t\\,0.5)\\,0.002)':s=32000:d=${params.audioS}`
      : undefined
    args.push('-f', 'lavfi', '-i', tone)
    if (clicks) args.push('-f', 'lavfi', '-i', clicks)
    const gain = `volume=${params.toneVolumeDb ?? -10}dB`
    const audio = clicks
      ? `[1:a]${gain}[t];[t][2:a]amix=inputs=2:normalize=0[a]`
      : `[1:a]${gain}[a]`
    args.push('-filter_complex', audio, '-map', '0:v', '-map', '[a]', '-c:a', 'aac', '-ac', '2')
  }
  args.push('-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', out)
  ffmpeg(...args)
  return out
}

/** A stereo WAV holding a constant value, so a joint without a fade shows up as one big step. */
function makeDc(dir: string, name: string, value: number, durationS: number): string {
  const out = path.join(dir, name)
  ffmpeg(
    '-f',
    'lavfi',
    '-i',
    `aevalsrc=${value}|${value}:s=48000:d=${durationS}`,
    '-c:a',
    'pcm_f32le',
    out,
  )
  return out
}

function probe(file: string): { audioS: null | number; frames: number; videoS: number } {
  const json = JSON.parse(
    execFileSync('ffprobe', [
      '-v',
      'error',
      '-count_packets',
      '-show_entries',
      'stream=codec_type,duration,nb_read_packets',
      '-of',
      'json',
      file,
    ]).toString(),
  ) as { streams: { codec_type: string; duration?: string; nb_read_packets?: string }[] }
  const video = json.streams.find((s) => s.codec_type === 'video')
  const audio = json.streams.find((s) => s.codec_type === 'audio')
  return {
    audioS: audio?.duration ? round3(Number(audio.duration)) : null,
    frames: Number(video?.nb_read_packets ?? 0),
    videoS: round3(Number(video?.duration ?? 0)),
  }
}

function readSamples(file: string): Float32Array {
  const raw = ffmpeg('-i', file, '-af', 'pan=mono|c0=FL', '-f', 'f32le', '-')
  return new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4)
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}
