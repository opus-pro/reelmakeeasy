import { execFileSync, spawnSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

import type { TranscriptData } from '@shared/types/agent/transcript'
import { createCanvas, loadImage } from 'canvas'

import type { CaptionSegment } from '../adapters/caption/caption-painter'
import { resolveCaptionRenderPref } from '../adapters/caption/caption-style'
import { transcriptToEditingScriptTextTrack } from '../adapters/caption/caption-to-editing-script-text-track'
import { getDefaultCaptionRenderPref } from '../adapters/caption/default-caption-render-pref'
import { TextAdapter } from '../adapters/text-adapter'
import { presetPackDir, RENDER_PRESETS } from '../storage/presets'

import { beatLoopStampSegments } from './beat-loop-delivery'
import {
  applyBeatLoopFinish,
  BEAT_LOOP_LIMITER,
  BEAT_LOOP_LOUDNESS,
  type BeatLoopFinishResult,
  buildBeatLoopMasterFilter,
  buildBeatLoopMixFilter,
  buildBeatLoopVideoFilter,
  finishBeatLoopVideo,
  type LimiterProbe,
  loudnormCanStayLinear,
  type LoudnormStats,
  masterBeatLoopAudio,
  measureBeatLoopMix,
  parseLoudnormStats,
  searchLimiterDrive,
  unpackBeatLoopFonts,
} from './beat-loop-finish'

// The real module object: the finish pass calls its execFile through it.
const childProcess = require('node:child_process') as typeof import('node:child_process')

/** A loop's stamps as the export draws them: the facts track in Classic with this highlight. */
function stampsIn(stamps: Array<null | string>, accent: string): CaptionSegment[] {
  const pref = resolveCaptionRenderPref(
    { accent, preset: 'classic' },
    { aspectRatio: '9:16', kind: 'loop' },
  )
  return beatLoopStampSegments(stamps, pref)
}

/** A loop transcript's chunks as the export draws them: the shared caption track, in Classic. */
async function classicCaptions(transcript: TranscriptData): Promise<CaptionSegment[]> {
  const track = await TextAdapter.genTextTrackFromTranscriptTrack({
    renderPref: getDefaultCaptionRenderPref(),
    track: transcriptToEditingScriptTextTrack(transcript),
  })
  return (track?.segs ?? []) as unknown as CaptionSegment[]
}

/** A chunk held for [start, end] s, its words 0.3 s each from `start`, the first accented. */
function chunk(text: string, start: number, end: number) {
  const words = text.split(' ').map((word, i) => ({
    ...(i === 0 ? { accent: true } : {}),
    end: start + (i + 1) * 0.3,
    start: start + i * 0.3,
    word,
  }))
  return { end, start, text, words }
}

const LOUDNORM_STDERR = `[out#0/null @ 0x1] video:0KiB audio:1500KiB
[Parsed_loudnorm_0 @ 0x600000a3c000]
{
	"input_i" : "-22.31",
	"input_tp" : "-9.02",
	"input_lra" : "6.10",
	"input_thresh" : "-32.55",
	"output_i" : "-14.02",
	"output_tp" : "-1.50",
	"output_lra" : "5.90",
	"output_thresh" : "-24.20",
	"normalization_type" : "linear",
	"target_offset" : "0.02"
}
`

const STATS: LoudnormStats = {
  inputI: -22.31,
  inputLra: 6.1,
  inputThresh: -32.55,
  inputTp: -9.02,
  normalizationType: 'linear',
  outputI: -14.02,
  outputTp: -1.5,
  targetOffset: 0.02,
}

describe('parseLoudnormStats', () => {
  it('reads the last loudnorm block ffmpeg printed', () => {
    expect(parseLoudnormStats(`{"input_i" : "-30.00"}\n${LOUDNORM_STDERR}`)).toEqual(STATS)
  })

  it('reads silence as minus infinity', () => {
    const stats = parseLoudnormStats(LOUDNORM_STDERR.replace('"-22.31"', '"-inf"'))
    expect(stats.inputI).toBe(Number.NEGATIVE_INFINITY)
  })

  it('throws when ffmpeg printed no measurement', () => {
    expect(() => parseLoudnormStats('Conversion failed!')).toThrow(/loudnorm/)
  })
})

describe('loudnormCanStayLinear', () => {
  it('is true when one gain reaches -14 LUFS with the true peak at or under -1.5 dB', () => {
    expect(loudnormCanStayLinear({ ...STATS, inputI: -22, inputTp: -9.5 })).toBe(true)
  })

  it('is false when the gain would push the true peak over -1.5 dB', () => {
    expect(loudnormCanStayLinear({ ...STATS, inputI: -22, inputTp: -6 })).toBe(false)
  })

  it('is false when the loudness range is over the target', () => {
    expect(loudnormCanStayLinear({ ...STATS, inputLra: 12 })).toBe(false)
  })
})

describe('filter builders', () => {
  const SCALED =
    '[0:v]setpts=PTS-STARTPTS,scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920,setsar=1[v0]'

  it('upscales to cover 1080x1920, then overlays the caption stream and the stamp stream over it', () => {
    const lines = buildBeatLoopVideoFilter({
      captions: { input: 1, y: 1480 },
      stamps: { input: 2, y: 120 },
    })
    expect(lines).toEqual([
      SCALED,
      // As the render's own caption overlay: each stream ends with its last image, and the
      // picture passes on.
      '[1:v]format=rgba,setpts=PTS-STARTPTS[caps]',
      '[v0][caps]overlay=x=0:y=1480:eof_action=pass[vcap]',
      '[2:v]format=rgba,setpts=PTS-STARTPTS[stamps]',
      '[vcap][stamps]overlay=x=0:y=120:eof_action=pass[vstamps]',
      '[vstamps]format=yuv420p[vout]',
    ])
  })

  it('overlays the stamps alone when the captions are off', () => {
    expect(buildBeatLoopVideoFilter({ stamps: { input: 1, y: 120 } })).toEqual([
      SCALED,
      '[1:v]format=rgba,setpts=PTS-STARTPTS[stamps]',
      '[v0][stamps]overlay=x=0:y=120:eof_action=pass[vstamps]',
      '[vstamps]format=yuv420p[vout]',
    ])
  })

  it('passes the picture through when there is nothing to overlay', () => {
    expect(buildBeatLoopVideoFilter({})).toEqual([SCALED, '[v0]format=yuv420p[vout]'])
  })

  it('levels the voice and the sound effects, then sums them without rescaling', () => {
    const lines = buildBeatLoopMixFilter({
      durationS: 24,
      sfx: { gainDb: -14.6, input: '0:a:0' },
      voice: { gainDb: 2.25, input: '1:a:0' },
    })
    expect(lines).toEqual([
      '[1:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=duration=24,asetpts=PTS-STARTPTS,volume=2.25dB[voice]',
      '[0:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=duration=24,asetpts=PTS-STARTPTS,volume=-14.6dB[sfx]',
      '[voice][sfx]amix=inputs=2:duration=longest:normalize=0,apad,atrim=duration=24[mix]',
    ])
  })

  it('puts music under the voice and the sound effects, padded to the loop and faded in and out at its seam', () => {
    const lines = buildBeatLoopMixFilter({
      durationS: 24,
      music: { gainDb: -11.5, input: '2:a:0' },
      sfx: { gainDb: -14.6, input: '0:a:0' },
      voice: { gainDb: 2.25, input: '1:a:0' },
    })
    expect(lines).toEqual([
      '[1:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=duration=24,asetpts=PTS-STARTPTS,volume=2.25dB[voice]',
      '[0:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,atrim=duration=24,asetpts=PTS-STARTPTS,volume=-14.6dB[sfx]',
      '[2:a:0]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,apad,atrim=duration=24,asetpts=PTS-STARTPTS,volume=-11.5dB,afade=t=in:st=0:d=0.1,afade=t=out:st=23.7:d=0.3[music]',
      '[voice][sfx][music]amix=inputs=3:duration=longest:normalize=0,apad,atrim=duration=24[mix]',
    ])
  })

  it('makes silence when there is no sound at all', () => {
    expect(buildBeatLoopMixFilter({ durationS: 8 })).toEqual([
      'anullsrc=r=48000:cl=stereo,atrim=duration=8[mix]',
    ])
  })

  it('masters in loudnorm linear mode with the measured values', () => {
    expect(buildBeatLoopMasterFilter({ measured: STATS })).toBe(
      '[mix]loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=-22.31:measured_TP=-9.02:measured_LRA=6.1:measured_thresh=-32.55:offset=0.02:linear=true:print_format=json,aresample=48000[aout]',
    )
  })

  it('limits the peaks before loudnorm when one gain would clip them', () => {
    const filter = buildBeatLoopMasterFilter({
      limiter: { ceilingDb: -2.5, gainDb: 8.4 },
      measured: { ...STATS, inputLra: 12.34 },
    })
    expect(filter).toMatch(
      /^\[mix\]volume=8\.4dB,alimiter=limit=0\.7499:attack=5:release=50:level=disabled:latency=1,loudnorm=/,
    )
    // LRA only decides linear vs dynamic: raised over the measured range, it keeps the gain linear.
    expect(filter).toContain(':LRA=12.5:measured_I=')
  })

  it('keeps the limited sound on the picture with an FFmpeg that has no latency option', () => {
    const filter = buildBeatLoopMasterFilter({
      limiter: { ceilingDb: -2.5, gainDb: 8.4 },
      limiterLatency: false,
      measured: STATS,
    })
    expect(filter).toMatch(
      /^\[mix\]volume=8\.4dB,alimiter=limit=0\.7499:attack=5:release=50:level=disabled,atrim=start=0\.005,asetpts=PTS-STARTPTS,apad=pad_dur=0\.005,loudnorm=/,
    )
  })

  it('aims under -14 LUFS when the limiter may not take more, and trims after loudnorm', () => {
    const filter = buildBeatLoopMasterFilter({ measured: STATS, targetLufs: -16.42, trimDb: -0.3 })
    expect(filter).toMatch(/^\[mix\]loudnorm=I=-16\.42:TP=-1\.5:LRA=11:measured_I=/)
    expect(filter).toMatch(/,aresample=48000,volume=-0\.3dB\[aout\]$/)
  })

  it('passes silence straight through', () => {
    expect(buildBeatLoopMasterFilter({})).toBe('[mix]anull[aout]')
  })
})

describe('searchLimiterDrive', () => {
  /** A limiter whose peak-to-loudness ratio and loudness loss follow `curve` (drive in dB). */
  const limiterCurve = (curve: (driveDb: number) => { lossLu: number; plrDb: number }) =>
    jest.fn(async (driveDb: number): Promise<LimiterProbe> => ({ driveDb, ...curve(driveDb) }))
  const unlimited = (plrDb: number): LimiterProbe => ({ driveDb: 0, lossLu: 0, plrDb })
  /** The peaks fit, with no more than about half a dB of limiting beyond what that takes. */
  const expectFits = (best: LimiterProbe, maxPlrDb: number) => {
    expect(best.plrDb).toBeLessThanOrEqual(maxPlrDb)
    expect(best.plrDb).toBeGreaterThanOrEqual(maxPlrDb - 0.5)
  }

  it('adds no limiter when the peaks already fit', async () => {
    const probe = limiterCurve(() => ({ lossLu: 0, plrDb: 0 }))
    const best = await searchLimiterDrive({ maxPlrDb: 12, probe, probes: [unlimited(11.5)] })
    expect(best.driveDb).toBe(0)
    expect(probe).not.toHaveBeenCalled()
  })

  it('lands on the drive that fits the peaks when limiting costs no loudness', async () => {
    // Sparse peaks (a voice's plosives): each dB of drive takes a dB off the peaks.
    const probe = limiterCurve((d) => ({ lossLu: 0.05 * d, plrDb: 19.6 - d }))
    const best = await searchLimiterDrive({ maxPlrDb: 12, probe, probes: [unlimited(19.6)] })
    expect(probe).toHaveBeenCalledTimes(1)
    expectFits(best, 12)
  })

  it('follows the measured slope when limiting buys little, and stops at the most it may take', async () => {
    // Dense, clipping sound effects: a dB of drive takes only 0.25 dB off the peaks but
    // 0.75 LU off the loudness. Assuming a dB per dB would stall far under the cap.
    const curve = (d: number) => ({ lossLu: 0.75 * d, plrDb: 18 - 0.25 * d })
    const probe = limiterCurve(curve)
    const probes = [unlimited(18)]
    const best = await searchLimiterDrive({ maxPlrDb: 12, probe, probes })
    const capDrive = BEAT_LOOP_LIMITER.maxLossLu / 0.75
    expect(Math.abs(best.driveDb - capDrive)).toBeLessThanOrEqual(0.35)
    expect(best.lossLu).toBeLessThanOrEqual(BEAT_LOOP_LIMITER.maxLossLu + 0.25)
    expect(probe.mock.calls.length).toBeLessThanOrEqual(BEAT_LOOP_LIMITER.tries)
  })

  it('finds the root of a curving response within the tries, never past the drive cap', async () => {
    // Fits at a drive of 10 dB, with 2 LU of loudness taken.
    const probe = limiterCurve((d) => ({ lossLu: 0.02 * d * d, plrDb: 20 - d + 0.02 * d * d }))
    const best = await searchLimiterDrive({ maxPlrDb: 12, probe, probes: [unlimited(20)] })
    expectFits(best, 12)
    for (const [d] of probe.mock.calls) {
      expect(d).toBeLessThanOrEqual(BEAT_LOOP_LIMITER.maxReductionDb)
    }
  })

  it('reuses earlier probes when the peak target moves', async () => {
    const probe = limiterCurve((d) => ({ lossLu: 0, plrDb: 19 - d }))
    const probes = [unlimited(19)]
    await searchLimiterDrive({ maxPlrDb: 12, probe, probes })
    const best = await searchLimiterDrive({ maxPlrDb: 11.5, probe, probes })
    expectFits(best, 11.5)
    expect(probe).toHaveBeenCalledTimes(2)
  })
})

const ffmpegAvailable = spawnSync('ffmpeg', ['-version']).status === 0
// Skipped on a computer without FFmpeg, never on CI: there a missing FFmpeg fails the run.
const describeWithFfmpeg = ffmpegAvailable || process.env['CI'] ? describe : describe.skip

describeWithFfmpeg('finishBeatLoopVideo (ffmpeg)', () => {
  jest.setTimeout(120_000)
  let dir: string

  const ffmpeg = (...args: string[]) =>
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args])

  /** Integrated loudness and true peak of a file, as loudnorm measures them. */
  const loudness = (file: string) => {
    const run = spawnSync(
      'ffmpeg',
      [
        '-hide_banner',
        '-nostats',
        '-i',
        file,
        '-vn',
        '-af',
        'loudnorm=print_format=json',
        '-f',
        'null',
        '-',
      ],
      { encoding: 'utf8' },
    )
    return parseLoudnormStats(run.stderr)
  }

  const probe = (file: string) =>
    JSON.parse(
      execFileSync(
        'ffprobe',
        ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file],
        {
          encoding: 'utf8',
        },
      ),
    ) as {
      format: { duration: string }
      streams: Array<{
        codec_name: string
        codec_type: string
        height?: number
        sample_rate?: string
        width?: number
      }>
    }

  /** Opaque-ish pixels of the frame at `timeS` within `tolerance` of `hex`, inside `box`. */
  const countAt = async (
    file: string,
    timeS: number,
    box: { height: number; width: number; x: number; y: number },
    hex: string,
    tolerance = 48,
  ) => {
    const png = path.join(dir, `frame-${timeS}.png`)
    ffmpeg('-ss', String(timeS), '-i', file, '-frames:v', '1', png)
    const image = await loadImage(png)
    const ctx = createCanvas(image.width, image.height).getContext('2d')
    ctx.drawImage(image, 0, 0)
    const { data } = ctx.getImageData(box.x, box.y, box.width, box.height)
    const want = [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16))
    let n = 0
    for (let i = 0; i < data.length; i += 4) {
      if (want.every((c, k) => Math.abs(data[i + k] - c) <= tolerance)) n++
    }
    return n
  }

  /**
   * The delivered file: true peak at or under -1.5 dB, loudness at the master's target
   * (-14 LUFS, or under it when getting there would take more limiting than allowed).
   */
  const expectMastered = (result: BeatLoopFinishResult, outputPath: string) => {
    const out = loudness(outputPath)
    expect(out.inputTp).toBeLessThanOrEqual(BEAT_LOOP_LOUDNESS.truePeakDb)
    expect(result.targetLufs).toBeLessThanOrEqual(BEAT_LOOP_LOUDNESS.lufs)
    expect(Math.abs(out.inputI - (result.targetLufs ?? 0))).toBeLessThanOrEqual(0.5)
    expect(result.limiter?.lossLu ?? 0).toBeLessThanOrEqual(BEAT_LOOP_LIMITER.maxLossLu + 0.25)
    expect(result.limiter?.reductionDb ?? 0).toBeLessThanOrEqual(BEAT_LOOP_LIMITER.maxReductionDb)
  }

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'beat-loop-finish-'))
    // Two 4 s clips at the model's native size: a plain dark picture, with a clip sound bed
    // of pink noise that hits hard for the first 0.25 s of each clip.
    ffmpeg(
      '-f',
      'lavfi',
      '-i',
      'color=c=0x203040:size=768x1344:rate=24:duration=8',
      '-f',
      'lavfi',
      '-i',
      'anoisesrc=color=pink:amplitude=0.5:duration=8:sample_rate=48000:seed=1',
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
      'color=c=0x203040:size=768x1344:rate=24:duration=8',
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      path.join(dir, 'silent.mp4'),
    )
    // Dense, already-clipping sound effects (a run of booms): pink noise driven into the rails
    // with a slow decay every 2 s over a steady rumble. Its true peak is over 0 dBTP, and
    // limiting it takes loudness away almost as fast as it takes the peaks down.
    ffmpeg(
      '-f',
      'lavfi',
      '-i',
      'color=c=0x203040:size=768x1344:rate=24:duration=8',
      '-f',
      'lavfi',
      '-i',
      'anoisesrc=color=pink:amplitude=1:duration=8:sample_rate=48000:seed=1',
      '-af',
      "aeval='clip(val(0)*3*(exp(-4*mod(t,2))+0.08),-1,1)':c=same",
      '-c:v',
      'libx264',
      '-preset',
      'ultrafast',
      '-c:a',
      'aac',
      '-shortest',
      path.join(dir, 'booms.mp4'),
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
    // A quieter line with near full-scale plosive pings: one gain to -14 LUFS would push its
    // peaks far over -1.5 dB.
    ffmpeg(
      '-f',
      'lavfi',
      '-i',
      `aevalsrc='0.2*sin(2*PI*190*t)*${line}+0.95*exp(-300*mod(t,0.37))*sin(2*PI*1500*t)':s=48000:d=8`,
      path.join(dir, 'peaky-voice.wav'),
    )
  })
  afterAll(() => fs.rmSync(dir, { force: true, recursive: true }))

  /** The caption band of the default (bottom) slot: its centre is 80.9% down a 9:16 frame. */
  const CAPTION_BAND = { height: 260, width: 1080, x: 0, y: 1423 }
  /** Around a stamp: its turned strip's right edge 70 px in from the right, its top 170 px down. */
  const STAMP_CORNER = { height: 180, width: 500, x: 540, y: 130 }

  it('burns the captions and stamps in their windows, mixes, masters to -14 LUFS and upscales in one encode', async () => {
    const outputPath = path.join(dir, 'final.mp4')
    const captions = await classicCaptions({
      captionWindows: 'segment',
      language: 'en',
      segments: [chunk('The Great Pyramid', 0.15, 2.5)],
    })
    const result = await applyBeatLoopFinish({
      captions,
      fontsDir: path.join(dir, 'no-fonts'),
      outputPath,
      stamps: stampsIn(['c. 2560 BC', null], '#FFE500'),
      videoPath: path.join(dir, 'clips.mp4'),
      voicePath: path.join(dir, 'voice.wav'),
      workDir: path.join(dir, 'work'),
    })

    const { format, streams } = probe(outputPath)
    const video = streams.find((s) => s.codec_type === 'video')
    const audio = streams.find((s) => s.codec_type === 'audio')
    expect(video).toMatchObject({ codec_name: 'h264', height: 1920, width: 1080 })
    expect(audio).toMatchObject({ codec_name: 'aac', sample_rate: '48000' })
    expect(Number(format.duration)).toBeCloseTo(8, 1)

    // Voice to -23 LUFS, sound effects 9.1 LU under it.
    expect(result.voiceLufs).toBeDefined()
    expect(result.voiceGainDb).toBeCloseTo(-23 - (result.voiceLufs ?? 0), 1)
    expect(result.sfxGainDb).toBeCloseTo(-23 - 9.1 - (result.sfxLufs ?? 0), 1)
    expect(result.normalizationType).toBe('linear')
    expect(result.targetLufs).toBe(BEAT_LOOP_LOUDNESS.lufs)
    const out = loudness(outputPath)
    expect(Math.abs(out.inputI - BEAT_LOOP_LOUDNESS.lufs)).toBeLessThanOrEqual(0.5)
    expect(out.inputTp).toBeLessThanOrEqual(BEAT_LOOP_LOUDNESS.truePeakDb)
    // What the result reports is the delivered file's own measurement.
    expect(result.delivered?.truePeakDb).toBeCloseTo(out.inputTp, 1)
    expect(result.delivered?.lufs).toBeCloseTo(out.inputI, 1)

    // The stamp shows from 0.3 s to 3.0 s only, top right; the caption, white with the spoken
    // word in the caption green, in the bottom slot for its window, 0.15 s to 2.5 s.
    expect(result.stampOverlay?.y).toBeLessThan(STAMP_CORNER.y + 40)
    expect(await countAt(outputPath, 1, STAMP_CORNER, '#FFE500')).toBeGreaterThan(2000)
    expect(await countAt(outputPath, 0.2, STAMP_CORNER, '#FFE500')).toBe(0)
    expect(await countAt(outputPath, 3.5, STAMP_CORNER, '#FFE500')).toBe(0)
    expect(result.captionOverlay?.y).toBeGreaterThan(CAPTION_BAND.y)
    // With no font pack the face is the system's own, so where the line breaks differs per OS
    // (Linux's wider fallback puts "PYRAMID" on a line of its own, all of it lit). So the white
    // words are checked while the first word is spoken, and the window by any caption ink.
    const inkAt = async (t: number) =>
      (await countAt(outputPath, t, CAPTION_BAND, '#FFFFFF', 24)) +
      (await countAt(outputPath, t, CAPTION_BAND, '#04F827'))
    expect(await countAt(outputPath, 0.3, CAPTION_BAND, '#04F827')).toBeGreaterThan(300)
    expect(await countAt(outputPath, 0.3, CAPTION_BAND, '#FFFFFF', 24)).toBeGreaterThan(500)
    expect(await inkAt(2)).toBeGreaterThan(1000)
    expect(await inkAt(2.75)).toBe(0)
  })

  it('draws the stamps alone when the captions are off', async () => {
    const outputPath = path.join(dir, 'no-captions.mp4')
    const result = await applyBeatLoopFinish({
      captions: [],
      fontsDir: path.join(dir, 'no-fonts'),
      outputPath,
      stamps: stampsIn(['c. 2560 BC', null], '#04F827'),
      videoPath: path.join(dir, 'clips.mp4'),
      voicePath: path.join(dir, 'voice.wav'),
      workDir: path.join(dir, 'work-off'),
    })
    expect(result.captionOverlay).toBeUndefined()
    expect(await countAt(outputPath, 1, STAMP_CORNER, '#04F827')).toBeGreaterThan(2000)
    expect(await countAt(outputPath, 1, CAPTION_BAND, '#FFFFFF', 24)).toBe(0)
  })

  it('draws the captions and the stamps with the caption painter in one picture encode, no PNG stamps', async () => {
    const calls: string[][] = []
    const realExecFile = childProcess.execFile
    const spy = jest.spyOn(childProcess, 'execFile').mockImplementation(((
      file: string,
      args: string[],
      ...rest: unknown[]
    ) => {
      calls.push([file, ...args])
      return (realExecFile as (...a: unknown[]) => unknown)(file, args, ...rest)
    }) as unknown as typeof childProcess.execFile)
    try {
      await applyBeatLoopFinish({
        captions: await classicCaptions({
          captionWindows: 'segment',
          language: 'en',
          segments: [chunk('The Great Pyramid', 0.15, 2.5)],
        }),
        fontsDir: path.join(dir, 'no-fonts'),
        outputPath: path.join(dir, 'one-encode.mp4'),
        stamps: stampsIn(['c. 2560 BC', '1969 AD'], '#04F827'),
        videoPath: path.join(dir, 'clips.mp4'),
        voicePath: path.join(dir, 'voice.wav'),
        workDir: path.join(dir, 'work-one'),
      })
    } finally {
      spy.mockRestore()
    }
    const encodes = calls.filter((args) => args.includes('libx264'))
    expect(encodes).toHaveLength(1)
    const inputs = encodes[0].filter((_, i, args) => args[i - 1] === '-i')
    // The clips, the caption stream, the stamp stream and the mastered audio.
    expect(inputs).toHaveLength(4)
    expect(inputs.filter((file) => file.endsWith('.ffconcat'))).toHaveLength(2)
    expect(inputs.filter((file) => file.endsWith('.png'))).toEqual([])
  })

  it('limits a peaky voice so the master still lands at -14 LUFS in linear mode', async () => {
    const outputPath = path.join(dir, 'peaky.mp4')
    const result = await finishBeatLoopVideo({
      outputPath,
      videoPath: path.join(dir, 'clips.mp4'),
      voicePath: path.join(dir, 'peaky-voice.wav'),
    })
    expect(result.limiter).toBeDefined()
    expect(result.normalizationType).toBe('linear')
    expect(result.targetLufs).toBe(BEAT_LOOP_LOUDNESS.lufs)
    const out = loudness(outputPath)
    expect(Math.abs(out.inputI - BEAT_LOOP_LOUDNESS.lufs)).toBeLessThanOrEqual(0.5)
    expect(out.inputTp).toBeLessThanOrEqual(BEAT_LOOP_LOUDNESS.truePeakDb)
  })

  it('reports the levels it mixed at, for the clip sound bed', async () => {
    const videoPath = path.join(dir, 'clips.mp4')
    const voicePath = path.join(dir, 'voice.wav')
    const result = await finishBeatLoopVideo({
      outputPath: path.join(dir, 'levels.mp4'),
      videoPath,
      voicePath,
    })
    const levels = await measureBeatLoopMix({ durationS: 8, sfxPath: videoPath, voicePath })
    expect(result.levels).toEqual(levels)
    expect(levels).toMatchObject({
      sfx: { gainDb: result.sfxGainDb, lufs: result.sfxLufs },
      voice: { gainDb: result.voiceGainDb, lufs: result.voiceLufs },
    })
    // The true peaks as the sources enter the mix.
    expect(levels.sfx?.peakDb).toBeGreaterThan(levels.sfx?.lufs ?? 0)
    expect(levels.sfx?.peakDb).toBeLessThan(0)
    expect(levels.voice?.peakDb).toBeGreaterThan(levels.voice?.lufs ?? 0)

    // Without a voice the clips keep their own level; silent clips are left out.
    const alone = await measureBeatLoopMix({ durationS: 8, sfxPath: videoPath })
    expect(alone).toEqual({ sfx: { ...levels.sfx, gainDb: 0 } })
    const mute = path.join(dir, 'mute.wav')
    ffmpeg('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '8', mute)
    expect(await measureBeatLoopMix({ durationS: 8, sfxPath: mute })).toEqual({})
  })

  describe('music under a loop (masterBeatLoopAudio)', () => {
    /** A 6 s pad of chords, louder than the voice: shorter than the 8 s loop, so it is padded. */
    let bed: string
    beforeAll(() => {
      bed = path.join(dir, 'bed.wav')
      ffmpeg(
        '-f',
        'lavfi',
        '-i',
        "aevalsrc='0.4*(sin(2*PI*220*t)+sin(2*PI*277*t)+sin(2*PI*330*t))/3':s=44100:d=6",
        bed,
      )
    })

    /** Decoded audio, as a hash: two files with the same hash sound exactly the same. */
    const pcmHash = (file: string) =>
      execFileSync(
        'ffmpeg',
        ['-hide_banner', '-loglevel', 'error', '-i', file, '-map', '0:a:0', '-f', 'md5', '-'],
        { encoding: 'utf8' },
      ).trim()

    it('mixes the music its Volume % under the narration, keeps the -14 LUFS master and the exact length', async () => {
      const outputPath = path.join(dir, 'with-music.m4a')
      const duckDb = 14
      const result = await masterBeatLoopAudio({
        durationS: 8,
        music: { duckDb, path: bed },
        outputPath,
        sfxPath: path.join(dir, 'clips.mp4'),
        voicePath: path.join(dir, 'voice.wav'),
      })
      const music = result.levels.music
      expect(music).toBeDefined()
      // The narration is levelled to -23 LUFS in the mix; the music sits duckDb under it,
      // the rule every video's music follows.
      expect(music?.gainDb).toBeCloseTo(-23 - duckDb - (music?.lufs ?? 0), 1)
      expect(result.levels.voice?.gainDb).toBeCloseTo(-23 - (result.levels.voice?.lufs ?? 0), 1)
      const out = loudness(outputPath)
      expect(out.inputTp).toBeLessThanOrEqual(BEAT_LOOP_LOUDNESS.truePeakDb)
      expect(Math.abs(out.inputI - BEAT_LOOP_LOUDNESS.lufs)).toBeLessThanOrEqual(0.5)
      expect(Number(probe(outputPath).format.duration)).toBeCloseTo(8, 1)
      // The music is in it: the master differs from the loop's own sound alone.
      const alone = path.join(dir, 'alone.m4a')
      await masterBeatLoopAudio({
        durationS: 8,
        outputPath: alone,
        sfxPath: path.join(dir, 'clips.mp4'),
        voicePath: path.join(dir, 'voice.wav'),
      })
      expect(pcmHash(outputPath)).not.toBe(pcmHash(alone))
    })

    it("without music is exactly the sound the finish delivered: turning music off puts the loop's own audio back", async () => {
      const videoPath = path.join(dir, 'clips.mp4')
      const voicePath = path.join(dir, 'voice.wav')
      const finished = path.join(dir, 'no-music.mp4')
      await finishBeatLoopVideo({ durationS: 8, outputPath: finished, videoPath, voicePath })
      const remastered = path.join(dir, 'no-music-again.m4a')
      const result = await masterBeatLoopAudio({
        durationS: 8,
        outputPath: remastered,
        sfxPath: videoPath,
        voicePath,
      })
      expect(result.levels.music).toBeUndefined()
      expect(pcmHash(remastered)).toBe(pcmHash(finished))
    })

    it('finishes a loop with its music in the one encode', async () => {
      const outputPath = path.join(dir, 'final-music.mp4')
      const result = await finishBeatLoopVideo({
        durationS: 8,
        music: { duckDb: 14, path: bed },
        outputPath,
        videoPath: path.join(dir, 'clips.mp4'),
        voicePath: path.join(dir, 'voice.wav'),
      })
      expect(result.levels?.music).toBeDefined()
      expectMastered(result, outputPath)
      expect(Number(probe(outputPath).format.duration)).toBeCloseTo(8, 1)
    })

    it('leaves out a silent music file', async () => {
      const mute = path.join(dir, 'mute-bed.wav')
      ffmpeg('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo', '-t', '8', mute)
      const result = await masterBeatLoopAudio({
        durationS: 8,
        music: { duckDb: 14, path: mute },
        outputPath: path.join(dir, 'mute-bed.m4a'),
        voicePath: path.join(dir, 'voice.wav'),
      })
      expect(result.levels.music).toBeUndefined()
    })
  })

  it('masters the clip sound alone when there is no voice', async () => {
    const outputPath = path.join(dir, 'sfx-only.mp4')
    const result = await finishBeatLoopVideo({
      outputPath,
      videoPath: path.join(dir, 'clips.mp4'),
    })
    expect(result.sfxGainDb).toBe(0)
    expect(result.normalizationType).toBe('linear')
    expectMastered(result, outputPath)
  })

  it('masters a dense, already-clipping bed without clipping, squashing it or going dynamic', async () => {
    const bed = path.join(dir, 'booms.mp4')
    expect(loudness(bed).inputTp).toBeGreaterThan(0)
    const outputPath = path.join(dir, 'booms-final.mp4')
    const result = await finishBeatLoopVideo({ outputPath, videoPath: bed })
    expect(result.limiter).toBeDefined()
    expect(result.normalizationType).toBe('linear')
    expectMastered(result, outputPath)
  })

  it('still delivers an audio track when nothing makes a sound', async () => {
    const outputPath = path.join(dir, 'mute.mp4')
    const result = await finishBeatLoopVideo({
      outputPath,
      videoPath: path.join(dir, 'silent.mp4'),
    })
    expect(result.normalizationType).toBe('none')
    const { format, streams } = probe(outputPath)
    expect(streams.map((s) => s.codec_type).sort()).toEqual(['audio', 'video'])
    expect(Number(format.duration)).toBeCloseTo(8, 1)
  })
})

describe('unpackBeatLoopFonts', () => {
  it('only warns, and still names a folder, when the font pack is not there', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'beat-loop-no-pack-'))
    try {
      const fontsDir = await unpackBeatLoopFonts([], {
        archive: path.join(dir, 'missing.tar.gz'),
        dir: path.join(dir, 'fonts'),
      })
      expect(fontsDir).toBe(path.join(dir, 'fonts'))
    } finally {
      fs.rmSync(dir, { force: true, recursive: true })
    }
  })
})

// The render font pack is installed by `pnpm reelmakeeasy setup`; without it these are skipped.
const fontArchive = (() => {
  try {
    return path.join(presetPackDir(), RENDER_PRESETS.fonts)
  } catch {
    return undefined
  }
})()
const describeWithFontPack = fontArchive && fs.existsSync(fontArchive) ? describe : describe.skip

describeWithFontPack('unpackBeatLoopFonts with the installed render fonts', () => {
  let dir: string
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'beat-loop-font-cache-'))
  })
  afterAll(() => fs.rmSync(dir, { force: true, recursive: true }))

  it('unpacks the faces the captions and the stamps name, once', async () => {
    const captions = await classicCaptions({
      captionWindows: 'segment',
      language: 'en',
      segments: [chunk('The Great Pyramid', 0.15, 2.5)],
    })
    const segments = [...captions, ...stampsIn(['c. 2560 BC'], '#04F827')]
    const fontsDir = await unpackBeatLoopFonts(segments, { dir: path.join(dir, 'cache') })
    // Classic is Montserrat 900: the pack's Black face. The stamps draw in PT Serif Bold.
    expect(fs.readdirSync(fontsDir).sort()).toEqual(['Montserrat-Black.ttf', 'PTSerif-Bold.ttf'])
    const unpackedAt = fs.statSync(path.join(fontsDir, 'Montserrat-Black.ttf')).mtimeMs

    expect(await unpackBeatLoopFonts(segments, { dir: path.join(dir, 'cache') })).toBe(fontsDir)
    expect(fs.statSync(path.join(fontsDir, 'Montserrat-Black.ttf')).mtimeMs).toBe(unpackedAt)
  })

  it('unpacks a face again when the cache lost it', async () => {
    const stamps = stampsIn(['c. 2560 BC'], '#04F827')
    const fontsDir = await unpackBeatLoopFonts(stamps, { dir: path.join(dir, 'lost') })
    fs.rmSync(path.join(fontsDir, 'PTSerif-Bold.ttf'))
    await unpackBeatLoopFonts(stamps, { dir: path.join(dir, 'lost') })
    expect(fs.readdirSync(fontsDir)).toEqual(['PTSerif-Bold.ttf'])
  })
})
