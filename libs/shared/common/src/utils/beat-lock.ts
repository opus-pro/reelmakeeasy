import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import { logger } from '../logger'
import { BEAT_CLIP_SECONDS, BEAT_HOLD_SECONDS } from '../long-take/beat-loop-timing'
import { computeBgmGainDb } from '../long-take/bgm-mix'

const execFileAsync = promisify(execFile)

// Beat-loop clips are four beats on a fixed grid: hit + freeze until 3.0 s,
// then a fast camera move that cuts to the next keyframe by 4.0 s. Models
// overrun (H3 answers a 4 s request with 107 frames = 4.458 s) and the overrun
// lands in the last beat, because the prompt's timecodes are absolute. The
// beat-lock keeps 0-3 s untouched and squeezes (or stretches) the tail into
// the last second, so every clip is exactly 96 frames and the grid holds.

/** Frame rate of every beat-loop clip after the beat-lock. */
export const BEAT_LOCK_FPS = 24

/**
 * Tail speed range the beat-lock accepts. Outside it the cut reads as broken
 * (or the clip is far off the requested length), so the clip is re-rolled.
 * Also the range a single `atempo` covers on every ffmpeg version.
 */
export const BEAT_LOCK_MIN_MULTIPLIER = 0.5
export const BEAT_LOCK_MAX_MULTIPLIER = 2

/**
 * Integrated loudness every clip's sound is levelled to before the mix: the
 * median of 246 measured H3 clips. Levelling evens out the providers
 * (Omni clips sit near -33 LUFS) so one mix gain works for all of them.
 */
export const SFX_REF_LUFS = -17.5

/** Most a quiet clip is boosted on its way to SFX_REF_LUFS. */
export const SFX_LEVEL_MAX_GAIN_DB = 21

/**
 * How far the clip sound sits under the voice in the mix: the skill's "SFX at
 * about 35% under the voice" (20*log10(0.35) = -9.1 dB). The one value the
 * finish pass (long-take/beat-loop-finish.ts) mixes with.
 */
export const SFX_UNDER_VOICE_LU = 9.1

/** alimiter's look-ahead when no attack is given: its default attack, 5 ms. */
export const LIMITER_DEFAULT_ATTACK_MS = 5

/** Length of the crossfade window at each joint between clips. */
export const JOINT_CROSSFADE_S = 0.015

// The limiter ceiling after the levelling gain: -1 dBFS. Omni clips were measured
// with true peaks up to +0.2 dBTP.
const SFX_LIMIT_LINEAR = 10 ** (-1 / 20)
// The render delivers 48 kHz stereo; clip audio is aligned to it here so the
// joints and the mix never resample.
const CLIP_AUDIO_SAMPLE_RATE = 48_000
const CLIP_AUDIO_BITRATE = '192k'
// Integrated loudness at or below this (LUFS) is silence: ebur128's absolute gate.
const LUFS_SILENCE_FLOOR = -70
// The ebur128 pass prints to stderr; leave room above Node's 1 MiB default.
const MEASURE_MAX_BUFFER_BYTES = 16 * 1024 * 1024
// Intermediate quality: the clip is encoded again by the render, and its last
// frame seeds the next clip, so keep this generation close to the source.
const DEFAULT_VIDEO_CODEC_ARGS: readonly string[] = [
  '-c:v',
  'libx264',
  '-preset',
  'medium',
  '-crf',
  '16',
  '-pix_fmt',
  'yuv420p',
]

export interface BeatLockOptions {
  /** Seconds at the start kept untouched. Defaults to BEAT_HOLD_SECONDS. */
  holdS?: number
  /** Where to write the locked clip. Defaults to replacing the input. */
  outputPath?: string
  /** Clip length after the lock. Defaults to BEAT_CLIP_SECONDS. */
  targetS?: number
  /**
   * ffmpeg video encoder arguments for a retimed clip. Tests pass a lossless
   * encoder to prove the held frames come through unchanged.
   */
  videoCodecArgs?: readonly string[]
}

export type BeatLockPlan =
  | { action: 'noop' | 'retime'; multiplier: number }
  | { action: 'reroll'; multiplier: number; reason: string }

export type BeatLockResult =
  | {
      frames: number
      multiplier: number
      outputPath: string
      /** False when the clip was already on the grid and only its audio was trimmed. */
      retimed: boolean
      sourceDurationS: number
      status: 'locked'
    }
  | { multiplier: number; reason: string; sourceDurationS: number; status: 'reroll' }

export interface ClipLoudness {
  /** Integrated loudness (LUFS); null when the audio is silent. */
  integratedLufs: null | number
  /** True peak (dBTP); null when the audio is silent. */
  truePeakDbtp: null | number
}

export type LevelClipAudioResult =
  | {
      gainDb: number
      inputLufs: number
      /**
       * Loudness after the limiter. Peaky clips (Omni) land under the
       * reference, because the limiter takes back part of the boost.
       */
      outputLufs: null | number
      outputPath: string
      status: 'levelled'
    }
  | { reason: 'no audio' | 'silent'; status: 'skipped' }

interface MediaProbe {
  audio: boolean
  /** Container-reported audio length; 0 when unknown. */
  audioDurationS: number
  fps: number
  frames: number
  videoDurationS: number
}

/**
 * Beat-lock one clip to exactly `targetS` seconds at 24 fps (96 frames for
 * 4 s): frames before `holdS` are kept as they are, the tail is retimed by
 * m = (D - holdS) / (targetS - holdS) with `setpts` and its sound with
 * `atempo`, and the audio is first trimmed to the video (providers return
 * 10-32 ms of extra audio). A clip already on the grid is not re-encoded;
 * only its audio is trimmed. When m falls outside 0.5-2 nothing is written
 * and the result asks for a re-roll.
 */
export async function beatLockClip(
  clipPath: string,
  options: BeatLockOptions = {},
): Promise<BeatLockResult> {
  const holdS = options.holdS ?? BEAT_HOLD_SECONDS
  const targetS = options.targetS ?? BEAT_CLIP_SECONDS
  const outputPath = options.outputPath ?? clipPath
  const source = await probeMedia(clipPath)
  const plan = resolveBeatLockPlan({
    durationS: source.videoDurationS,
    fps: source.fps,
    frames: source.frames,
    holdS,
    targetS,
  })
  const sourceDurationS = source.videoDurationS
  if (plan.action === 'reroll') {
    logger.warn({ clipPath, ...plan, sourceDurationS }, '[beat-lock] Clip needs a re-roll')
    return { multiplier: plan.multiplier, reason: plan.reason, sourceDurationS, status: 'reroll' }
  }

  const targetFrames = Math.round(targetS * BEAT_LOCK_FPS)
  if (plan.action === 'noop') {
    await trimClipAudio({ clipPath, hasAudio: source.audio, outputPath, targetS })
  } else {
    const filter = buildBeatLockFilter({
      durationS: sourceDurationS,
      hasAudio: source.audio,
      holdS,
      multiplier: plan.multiplier,
      targetS,
    })
    await writeViaTemp(outputPath, (tempPath) =>
      ffmpeg(
        '-i',
        clipPath,
        '-filter_complex',
        filter,
        '-map',
        '[v]',
        ...(source.audio ? ['-map', '[a]', ...clipAudioCodecArgs(tempPath)] : ['-an']),
        ...(options.videoCodecArgs ?? DEFAULT_VIDEO_CODEC_ARGS),
        '-movflags',
        '+faststart',
        tempPath,
      ),
    )
  }

  const locked = await probeMedia(outputPath)
  if (locked.frames !== targetFrames) {
    throw new Error(
      `Beat-lock produced ${locked.frames} frames instead of ${targetFrames} for ${clipPath}`,
    )
  }
  logger.info(
    { clipPath, multiplier: plan.multiplier, retimed: plan.action === 'retime', sourceDurationS },
    '[beat-lock] Locked clip to the beat grid',
  )
  return {
    frames: locked.frames,
    multiplier: plan.multiplier,
    outputPath,
    retimed: plan.action === 'retime',
    sourceDurationS,
    status: 'locked',
  }
}

/**
 * The beat-lock filter graph for a clip of `durationS` seconds: input 0's
 * video split at `holdS`, the tail sped up by `multiplier`, resampled to
 * 24 fps and cut to exactly targetS * 24 frames ([v]); its audio trimmed to
 * the video, the tail sped up with `atempo`, padded or cut to exactly
 * `targetS` seconds at 48 kHz stereo ([a]).
 */
export function buildBeatLockFilter(params: {
  durationS: number
  hasAudio: boolean
  holdS?: number
  multiplier: number
  targetS?: number
}): string {
  const hold = num(params.holdS ?? BEAT_HOLD_SECONDS)
  const target = num(params.targetS ?? BEAT_CLIP_SECONDS)
  const m = num(params.multiplier)
  const targetFrames = Math.round((params.targetS ?? BEAT_CLIP_SECONDS) * BEAT_LOCK_FPS)
  const video = [
    '[0:v]setpts=PTS-STARTPTS,split=2[vh][vt]',
    `[vh]trim=end=${hold},setpts=PTS-STARTPTS[h]`,
    `[vt]trim=start=${hold},setpts=(PTS-STARTPTS)/${m}[t]`,
    // fps keeps the held frames (already on the 24 fps grid) and picks the
    // tail frames; the cloned spare frame covers an ffmpeg rounding short.
    `[h][t]concat=n=2:v=1:a=0,fps=${BEAT_LOCK_FPS},tpad=stop_mode=clone:stop=1,` +
      `trim=end_frame=${targetFrames}[v]`,
  ]
  if (!params.hasAudio) return video.join(';')
  const audio = [
    `[0:a]asetpts=PTS-STARTPTS,atrim=end=${num(params.durationS)},${clipAudioFormat()},` +
      'asplit=2[ah][at]',
    `[ah]atrim=end=${hold},asetpts=PTS-STARTPTS[aho]`,
    `[at]atrim=start=${hold},asetpts=PTS-STARTPTS,atempo=${m}[ato]`,
    `[aho][ato]concat=n=2:v=0:a=1,apad=whole_dur=${target},atrim=end=${target}[a]`,
  ]
  return [...video, ...audio].join(';')
}

/**
 * Filter graph that joins `clipCount` clip sounds back to back on the exact
 * clip grid, with a JOINT_CROSSFADE_S window at each joint: the outgoing clip
 * fades out over the last half of the window and the incoming one fades in
 * over the first half. An overlapping crossfade (acrossfade) would shorten
 * the track by the window at every joint and pull clip k's sound
 * (k - 1) * 15 ms ahead of its picture (75 ms by clip 6). With `loop` (the
 * default) the file's start and end fade too, since the player loops it.
 * Each input is aligned to 48 kHz stereo and padded or cut to `clipDurationS`
 * first.
 */
export function buildJointCrossfadeFilter(params: {
  clipCount: number
  clipDurationS?: number
  crossfadeS?: number
  /** Input pads, one per clip; defaults to `0:a`, `1:a`, ... */
  inputLabels?: readonly string[]
  loop?: boolean
  /** Output pad; defaults to `sfx`. */
  outputLabel?: string
}): string {
  const { clipCount, loop = true, outputLabel = 'sfx' } = params
  const clipS = params.clipDurationS ?? BEAT_CLIP_SECONDS
  const half = (params.crossfadeS ?? JOINT_CROSSFADE_S) / 2
  const chains: string[] = []
  for (let k = 0; k < clipCount; k++) {
    const input = params.inputLabels?.[k] ?? `${k}:a`
    const steps = [
      `[${input}]asetpts=PTS-STARTPTS`,
      clipAudioFormat(),
      `apad=whole_dur=${num(clipS)},atrim=end=${num(clipS)}`,
    ]
    if (loop || k > 0) steps.push(`afade=t=in:st=0:d=${num(half)}`)
    if (loop || k < clipCount - 1) steps.push(`afade=t=out:st=${num(clipS - half)}:d=${num(half)}`)
    chains.push(`${steps.join(',')}[j${k}]`)
  }
  const joined = Array.from({ length: clipCount }, (_, k) => `[j${k}]`).join('')
  chains.push(`${joined}concat=n=${clipCount}:v=0:a=1[${outputLabel}]`)
  return chains.join(';')
}

/**
 * Whether this FFmpeg's alimiter has the `latency` option, from the text of
 * `ffmpeg -h filter=alimiter`. FFmpeg 4.4 (Ubuntu 22.04's) does not.
 */
export function alimiterHelpHasLatency(help: string): boolean {
  return /^\s*latency\s/m.test(help)
}

let limiterLatency: Promise<boolean> | undefined

/**
 * Whether alimiter can take its look-ahead delay back out itself (`latency=1`);
 * asked of the installed FFmpeg once per process.
 */
export function alimiterTakesLatency(): Promise<boolean> {
  limiterLatency ??= execFileAsync('ffmpeg', ['-hide_banner', '-h', 'filter=alimiter']).then(
    ({ stdout }) => alimiterHelpHasLatency(stdout),
    () => false,
  )
  return limiterLatency
}

/**
 * The levelling chain: a static gain, then a -1 dBFS limiter that keeps the hit
 * on its frame (see buildLimiterFilter). Resampling comes first: a resample
 * after the limiter would put overshoots back between the samples.
 */
export function buildClipLevelFilter(gainDb: number, options: { latency?: boolean } = {}): string {
  const limiter = buildLimiterFilter({ latency: options.latency ?? true, limit: SFX_LIMIT_LINEAR })
  return `${clipAudioFormat()},volume=${num(gainDb)}dB,${limiter}`
}

/**
 * An alimiter (auto level off) that leaves the sound where it was: the limiter
 * looks ahead by its attack and so delays everything by it. `latency=1` takes
 * that back out on FFmpeg 5 and later; on older ones (`latency: false`, see
 * alimiterTakesLatency) the delay is cut off the start and the end padded
 * back, so the length is unchanged too.
 */
export function buildLimiterFilter(options: {
  attackMs?: number
  latency: boolean
  limit: number
  releaseMs?: number
}): string {
  const settings = [
    `limit=${num(options.limit)}`,
    ...(options.attackMs === undefined ? [] : [`attack=${num(options.attackMs)}`]),
    ...(options.releaseMs === undefined ? [] : [`release=${num(options.releaseMs)}`]),
    'level=disabled',
  ]
  const limiter = `alimiter=${settings.join(':')}`
  if (options.latency) return `${limiter}:latency=1`
  const delay = num((options.attackMs ?? LIMITER_DEFAULT_ATTACK_MS) / 1000)
  return `${limiter},atrim=start=${delay},asetpts=PTS-STARTPTS,apad=pad_dur=${delay}`
}

/** Gain that brings a clip measured at `clipLufs` to the SFX reference, capped at +21 dB. */
export function computeSfxLevelGainDb(
  clipLufs: number,
  options: { maxGainDb?: number; refLufs?: number } = {},
): number {
  const { maxGainDb = SFX_LEVEL_MAX_GAIN_DB, refLufs = SFX_REF_LUFS } = options
  return Math.min(maxGainDb, refLufs - clipLufs)
}

/**
 * Mix gain for the clip sound so it sits SFX_UNDER_VOICE_LU under the voice:
 * the BGM bed's formula, gain = (voiceLufs - 9.1) - clipLufs, within its
 * bounds. `clipLufs` is the joined clip track as measured, not SFX_REF_LUFS:
 * the limiter leaves peaky clips under the reference. With the voice at -23
 * LUFS and the track at -17.5 this is -14.6 dB.
 */
export function computeSfxMixGainDb(params: {
  clipLufs: number
  gapLu?: number
  voiceLufs: number
}): number {
  const { clipLufs, gapLu = SFX_UNDER_VOICE_LU, voiceLufs } = params
  return computeBgmGainDb({ bedLufs: clipLufs, duckDb: gapLu, voiceLufs })
}

/**
 * Join the clips' sounds into one track of exactly clipCount * clipDurationS
 * seconds (see buildJointCrossfadeFilter). A clip without audio contributes
 * silence. WAV output is 16-bit PCM; anything else is AAC.
 */
export async function joinClipAudio(params: {
  clipDurationS?: number
  clipPaths: readonly string[]
  crossfadeS?: number
  loop?: boolean
  outputPath: string
}): Promise<{ durationS: number; outputPath: string }> {
  const { clipPaths, outputPath } = params
  const clipS = params.clipDurationS ?? BEAT_CLIP_SECONDS
  if (clipPaths.length === 0) throw new Error('joinClipAudio needs at least one clip')
  const inputs: string[] = []
  for (const clipPath of clipPaths) {
    const { audio } = await probeMedia(clipPath)
    inputs.push(
      ...(audio
        ? ['-i', clipPath]
        : [
            '-f',
            'lavfi',
            '-t',
            num(clipS),
            '-i',
            `anullsrc=r=${CLIP_AUDIO_SAMPLE_RATE}:cl=stereo`,
          ]),
    )
  }
  const filter = buildJointCrossfadeFilter({
    clipCount: clipPaths.length,
    clipDurationS: clipS,
    crossfadeS: params.crossfadeS,
    loop: params.loop,
  })
  await writeViaTemp(outputPath, (tempPath) =>
    ffmpeg(
      ...inputs,
      '-filter_complex',
      filter,
      '-map',
      '[sfx]',
      ...clipAudioCodecArgs(tempPath),
      tempPath,
    ),
  )
  return { durationS: Number(num(clipS * clipPaths.length)), outputPath }
}

/**
 * Level a clip's sound to SFX_REF_LUFS (boost capped at +21 dB), then limit it
 * to -1 dBFS. The video stream is copied. Silent clips and clips without audio
 * are left alone.
 */
export async function levelClipAudio(
  clipPath: string,
  options: { outputPath?: string; refLufs?: number } = {},
): Promise<LevelClipAudioResult> {
  const outputPath = options.outputPath ?? clipPath
  const { audio, audioDurationS } = await probeMedia(clipPath)
  if (!audio) return { reason: 'no audio', status: 'skipped' }
  const { integratedLufs } = await measureClipLoudness(clipPath)
  if (integratedLufs === null) return { reason: 'silent', status: 'skipped' }

  const gainDb = computeSfxLevelGainDb(integratedLufs, { refLufs: options.refLufs })
  const latency = await alimiterTakesLatency()
  // Decoding AAC keeps the encoder's end padding (4 s at 48 kHz decodes as
  // 4.011 s), so cut back to the stored length or each pass grows the clip.
  const trim = audioDurationS > 0 ? `,atrim=end=${num(audioDurationS)}` : ''
  await writeViaTemp(outputPath, (tempPath) =>
    ffmpeg(
      '-i',
      clipPath,
      '-map',
      '0:v?',
      '-map',
      '0:a:0',
      '-c:v',
      'copy',
      '-af',
      `${buildClipLevelFilter(gainDb, { latency })}${trim}`,
      ...clipAudioCodecArgs(tempPath),
      '-movflags',
      '+faststart',
      tempPath,
    ),
  )
  const { integratedLufs: outputLufs } = await measureClipLoudness(outputPath)
  logger.info(
    { clipPath, gainDb, inputLufs: integratedLufs, outputLufs },
    '[beat-lock] Levelled clip audio',
  )
  return { gainDb, inputLufs: integratedLufs, outputLufs, outputPath, status: 'levelled' }
}

/**
 * Measure a clip's integrated loudness and true peak with ffmpeg's ebur128
 * (the meter SFX_REF_LUFS was set with). Throws when the file has no
 * audio stream.
 */
export async function measureClipLoudness(mediaPath: string): Promise<ClipLoudness> {
  const { stderr } = await execFileAsync(
    'ffmpeg',
    [
      '-hide_banner',
      '-nostats',
      '-i',
      mediaPath,
      '-map',
      '0:a:0',
      '-af',
      'ebur128=peak=true:framelog=quiet',
      '-f',
      'null',
      '-',
    ],
    { maxBuffer: MEASURE_MAX_BUFFER_BYTES },
  )
  return parseEbur128Summary(stderr)
}

/** Read the integrated loudness and true peak from the summary ebur128 prints at the end. */
export function parseEbur128Summary(ffmpegStderr: string): ClipLoudness {
  const start = ffmpegStderr.lastIndexOf('Summary:')
  if (start === -1) throw new Error('Could not parse the ebur128 summary from ffmpeg output')
  const summary = ffmpegStderr.slice(start)
  const integrated = readDb(summary, /\bI:\s+(-?[\d.]+|-inf)\s+LUFS/)
  const peak = readDb(summary, /\bPeak:\s+(-?[\d.]+|-inf)\s+dBFS/)
  if (integrated === null || integrated <= LUFS_SILENCE_FLOOR) {
    return { integratedLufs: null, truePeakDbtp: null }
  }
  return { integratedLufs: integrated, truePeakDbtp: peak }
}

/**
 * Decide what the beat-lock does with a clip of `durationS` seconds:
 * m = (durationS - holdS) / (targetS - holdS). A clip already at targetS * 24
 * frames and 24 fps needs no retime; m outside 0.5-2 asks for a re-roll.
 */
export function resolveBeatLockPlan(params: {
  durationS: number
  fps: number
  frames: number
  holdS?: number
  targetS?: number
}): BeatLockPlan {
  const holdS = params.holdS ?? BEAT_HOLD_SECONDS
  const targetS = params.targetS ?? BEAT_CLIP_SECONDS
  const multiplier = (params.durationS - holdS) / (targetS - holdS)
  if (!(multiplier >= BEAT_LOCK_MIN_MULTIPLIER && multiplier <= BEAT_LOCK_MAX_MULTIPLIER)) {
    return {
      action: 'reroll',
      multiplier,
      reason:
        `The clip runs ${params.durationS.toFixed(3)} s, so its last beat would play at ` +
        `${multiplier.toFixed(2)}x (allowed ${BEAT_LOCK_MIN_MULTIPLIER}-${BEAT_LOCK_MAX_MULTIPLIER}x)`,
    }
  }
  const onGrid =
    params.frames === Math.round(targetS * BEAT_LOCK_FPS) &&
    Math.abs(params.fps - BEAT_LOCK_FPS) < 0.001
  return onGrid ? { action: 'noop', multiplier: 1 } : { action: 'retime', multiplier }
}

/** Resample and channel layout every clip sound is aligned to. */
function clipAudioFormat(): string {
  return `aresample=${CLIP_AUDIO_SAMPLE_RATE},aformat=channel_layouts=stereo`
}

/** Audio encoder for a clip or joined track: 16-bit PCM for WAV, AAC otherwise. */
function clipAudioCodecArgs(outputPath: string): string[] {
  const rate = ['-ar', String(CLIP_AUDIO_SAMPLE_RATE)]
  if (path.extname(outputPath).toLowerCase() === '.wav') return ['-c:a', 'pcm_s16le', ...rate]
  return ['-c:a', 'aac', '-b:a', CLIP_AUDIO_BITRATE, ...rate]
}

async function ffmpeg(...args: string[]): Promise<void> {
  await execFileAsync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], {
    maxBuffer: MEASURE_MAX_BUFFER_BYTES,
  })
}

/** Fixed-precision number for filter strings, trailing zeros stripped. */
function num(value: number): string {
  return String(Number(value.toFixed(6)))
}

function parseRate(rate: string | undefined): number {
  const [numerator, denominator = '1'] = (rate ?? '').split('/')
  const fps = Number(numerator) / Number(denominator)
  return Number.isFinite(fps) && fps > 0 ? fps : 0
}

/** One ffprobe pass: video frame count (counted, not trusted from the header), fps, duration, audio. */
async function probeMedia(mediaPath: string): Promise<MediaProbe> {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v',
    'error',
    '-count_packets',
    '-show_entries',
    'stream=codec_type,duration,nb_read_packets,avg_frame_rate,r_frame_rate',
    '-of',
    'json',
    mediaPath,
  ])
  const { streams = [] } = JSON.parse(stdout) as {
    streams?: {
      avg_frame_rate?: string
      codec_type?: string
      duration?: string
      nb_read_packets?: string
      r_frame_rate?: string
    }[]
  }
  const video = streams.find((stream) => stream.codec_type === 'video')
  const audioStream = streams.find((stream) => stream.codec_type === 'audio')
  const audioDurationS = Number(audioStream?.duration)
  const fps = parseRate(video?.avg_frame_rate) || parseRate(video?.r_frame_rate)
  const frames = Number(video?.nb_read_packets ?? 0)
  const streamDurationS = Number(video?.duration)
  const videoDurationS =
    Number.isFinite(streamDurationS) && streamDurationS > 0
      ? streamDurationS
      : fps > 0
        ? frames / fps
        : 0
  return {
    audio: audioStream !== undefined,
    audioDurationS: Number.isFinite(audioDurationS) && audioDurationS > 0 ? audioDurationS : 0,
    fps,
    frames,
    videoDurationS,
  }
}

function readDb(summary: string, pattern: RegExp): null | number {
  const value = pattern.exec(summary)?.[1]
  if (value === undefined || value === '-inf') return null
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : null
}

/** For a clip already on the grid: copy the video, trim the audio to `targetS`. */
async function trimClipAudio(params: {
  clipPath: string
  hasAudio: boolean
  outputPath: string
  targetS: number
}): Promise<void> {
  const { clipPath, hasAudio, outputPath, targetS } = params
  if (!hasAudio) {
    if (outputPath !== clipPath) await fs.copyFile(clipPath, outputPath)
    return
  }
  const target = num(targetS)
  await writeViaTemp(outputPath, (tempPath) =>
    ffmpeg(
      '-i',
      clipPath,
      '-map',
      '0:v:0',
      '-map',
      '0:a:0',
      '-c:v',
      'copy',
      '-af',
      `asetpts=PTS-STARTPTS,atrim=end=${target},${clipAudioFormat()},` +
        `apad=whole_dur=${target},atrim=end=${target}`,
      ...clipAudioCodecArgs(tempPath),
      '-movflags',
      '+faststart',
      tempPath,
    ),
  )
}

/**
 * Write through a temp file next to `outputPath`, then rename it into place,
 * so an in-place edit never leaves a half-written clip behind.
 */
async function writeViaTemp(
  outputPath: string,
  write: (tempPath: string) => Promise<void>,
): Promise<void> {
  const ext = path.extname(outputPath) || '.mp4'
  const tempPath = `${outputPath}.beat-lock.tmp${ext}`
  try {
    await write(tempPath)
    await fs.rename(tempPath, outputPath)
  } catch (error) {
    await fs.rm(tempPath, { force: true })
    throw error
  }
}
