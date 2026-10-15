import { execFile } from 'node:child_process'
import * as path from 'node:path'

import { runFfmpeg } from '../utils/cmdline'

// Locked mix recipe (export bake). The bed is ducked DUCK dB below the
// measured voiceover loudness, trimmed to the video, resampled/format-aligned,
// and mixed in ONE re-mux with the video stream COPIED (no re-encode).
// `normalize=0` on amix is mandatory: the default rescales each input by 1/n,
// which would halve (-6 dB) the voiceover.
//
// Duck depth defaults to the panel-default volume's duck: the bake
// paths (render-final, finalize-4k) don't thread a user volume, so the fresh
// delivery must match what the panel shows for a project with no persisted
// bgmVolume. The settings/regen remuxes pass the user's duck explicitly.
// The duck/clamp constants live in the browser-safe bgm-volume module (the web
// preview shares the curve); re-exported here for the node-side consumers.
import {
  BGM_DEFAULT_VOLUME,
  BGM_GAIN_MAX_DB,
  BGM_GAIN_MIN_DB,
  resolveBgmDuckDbForVolume,
} from './bgm-volume'

export { BGM_DEFAULT_VOLUME, BGM_DUCK_DB, BGM_GAIN_MAX_DB, BGM_GAIN_MIN_DB } from './bgm-volume'

// The render pipeline delivers 48 kHz stereo AAC; align the bed before amix so
// mixed-format inputs (the Lyria bed can arrive as 44.1k or WAV-in-mp3) never
// produce resample artifacts.
const BGM_MIX_SAMPLE_RATE = 48_000
// Integrated loudness at/below this (LUFS) means effectively silent audio; the
// gain formula would be meaningless, so measurement fails instead.
const LUFS_SILENCE_FLOOR = -70
// The loudnorm analysis pass prints to stderr; a long video produces sizeable
// logs, so raise the buffer well above Node's 1 MiB default.
const MEASURE_MAX_BUFFER_BYTES = 16 * 1024 * 1024
// ffprobe on a local file is instant; a wedged probe must not hang the render.
const PROBE_TIMEOUT_MS = 10_000

export interface MixBgmIntoVideoParams {
  /** Local path of the BGM bed audio (mp3/wav). */
  bedPath: string
  /**
   * dB the bed sits below the voiceover; defaults to the BGM_DEFAULT_VOLUME
   * duck (the bake paths, which never carry a user volume).
   */
  duckDb?: number
  /**
   * Precomputed bed gain in dB. When set, the loudness measurement passes are
   * skipped -- used to apply one measured gain to sibling variants (e.g. the
   * watermark video, whose voiceover loudness matches the clean video's).
   */
  gainDb?: number
  /** Output file name inside workDir; defaults to bgm_mixed_video.mp4. */
  outputFileName?: string
  /** Local path of the video whose audio is the voiceover mix base. */
  videoPath: string
  /** Directory for the mixed output; must not be the videoPath's own file. */
  workDir: string
}

export interface MixBgmIntoVideoResult {
  /**
   * Raw bed->voice loudness delta (voice LUFS - bed LUFS) measured by THIS
   * call; absent when a precomputed gainDb was supplied and nothing was
   * measured. Pre-duck and unclamped: the same quantity the generation path
   * persists as bgmBedGainDb for the live preview's ear-tuning.
   */
  bedToVoiceGainDb?: number
  /** The bed gain (dB) actually applied, post-clamp. */
  gainDb: number
  /** Absolute path of the mixed output video. */
  outputPath: string
  /** Probed duration (seconds) of the input video. */
  videoDurationSec: number
}

/**
 * Compute the bed gain so the bed sits `duckDb` below the voiceover:
 * gain = (voiceLufs - duckDb) - bedLufs, clamped to [-30, +6] dB.
 */
export function computeBgmGainDb(params: {
  bedLufs: number
  duckDb?: number
  voiceLufs: number
}): number {
  const { bedLufs, duckDb = resolveBgmDuckDbForVolume(BGM_DEFAULT_VOLUME), voiceLufs } = params
  const raw = voiceLufs - duckDb - bedLufs
  return Math.min(BGM_GAIN_MAX_DB, Math.max(BGM_GAIN_MIN_DB, raw))
}

/**
 * Build the amix filter_complex per the locked recipe: trim the bed to the
 * video, align rate/layout, apply the duck gain, and sum WITHOUT amix's
 * default 1/n input rescaling (normalize=0). `duration=longest` + no
 * `-shortest` so the video is never truncated by the audio graph.
 */
export function buildBgmMixFilter(params: { gainDb: number; videoDurationSec: number }): string {
  const { gainDb, videoDurationSec } = params
  const trimSec = formatFixed(videoDurationSec, 3)
  const gain = formatFixed(gainDb, 2)
  return (
    `[1:a]atrim=0:${trimSec},aresample=${BGM_MIX_SAMPLE_RATE},` +
    `aformat=channel_layouts=stereo,volume=${gain}dB[bgm];` +
    '[0:a][bgm]amix=inputs=2:duration=longest:normalize=0[mix]'
  )
}

/**
 * Measure integrated loudness (LUFS) via an ffmpeg loudnorm analysis pass
 * (print_format=json on stderr, same approach as generate-preview-video.ts).
 * Throws when the audio is unmeasurable or effectively silent -- the caller's
 * mix is best-effort and treats that as "skip the mix".
 */
export async function measureIntegratedLufs(mediaPath: string): Promise<number> {
  const { stderr } = await execFileP(
    'ffmpeg',
    [
      '-hide_banner',
      '-i',
      mediaPath,
      '-vn',
      '-af',
      'loudnorm=print_format=json',
      '-f',
      'null',
      '-',
    ],
    { maxBuffer: MEASURE_MAX_BUFFER_BYTES },
  )
  const lufs = parseLoudnormIntegratedLufs(stderr)
  if (lufs === null) {
    throw new Error(`Integrated loudness unmeasurable (silent audio?) for ${mediaPath}`)
  }
  return lufs
}

/**
 * Bake the BGM bed under the video's voiceover in ONE ffmpeg re-mux: the video
 * stream is stream-copied (lossless, seconds not minutes) and only the audio is
 * re-encoded (AAC 192k). When `gainDb` is not supplied, the bed gain is derived
 * from measured integrated loudness so the bed sits `duckDb` below the voice.
 */
export async function mixBgmIntoVideo(
  params: MixBgmIntoVideoParams,
): Promise<MixBgmIntoVideoResult> {
  const { bedPath, duckDb, outputFileName = 'bgm_mixed_video.mp4', videoPath, workDir } = params
  const outputPath = path.join(workDir, outputFileName)
  if (outputPath === videoPath) {
    throw new Error('BGM mix output path must differ from the input video path')
  }

  const videoDurationSec = await probeMediaDurationSec(videoPath)
  let gainDb = params.gainDb
  let bedToVoiceGainDb: number | undefined
  if (gainDb === undefined) {
    const [voiceLufs, bedLufs] = await Promise.all([
      measureIntegratedLufs(videoPath),
      measureIntegratedLufs(bedPath),
    ])
    bedToVoiceGainDb = voiceLufs - bedLufs
    gainDb = computeBgmGainDb({ bedLufs, duckDb, voiceLufs })
  }

  await runFfmpeg(
    '-i',
    videoPath,
    '-i',
    bedPath,
    '-filter_complex',
    buildBgmMixFilter({ gainDb, videoDurationSec }),
    '-map',
    '0:v',
    '-map',
    '[mix]',
    '-c:v',
    'copy',
    '-c:a',
    'aac',
    '-b:a',
    '192k',
    '-movflags',
    '+faststart',
    outputPath,
  )
  return {
    ...(bedToVoiceGainDb === undefined ? {} : { bedToVoiceGainDb }),
    gainDb,
    outputPath,
    videoDurationSec,
  }
}

/**
 * Parse the integrated loudness (input_i) from the JSON block a loudnorm
 * analysis pass writes to stderr. Returns null when the measurement is
 * non-finite or at/below the silence floor (loudnorm emits -inf for silence).
 */
export function parseLoudnormIntegratedLufs(ffmpegStderr: string): null | number {
  const start = ffmpegStderr.lastIndexOf('{')
  const end = ffmpegStderr.lastIndexOf('}')
  if (start === -1 || end <= start) {
    throw new Error('Could not parse loudnorm measurement from ffmpeg output')
  }
  const measured = JSON.parse(ffmpegStderr.slice(start, end + 1)) as { input_i?: string }
  const lufs = Number.parseFloat(measured.input_i ?? '')
  if (!Number.isFinite(lufs) || lufs <= LUFS_SILENCE_FLOOR) {
    return null
  }
  return lufs
}

/** Probe a media file's container duration (seconds) via ffprobe. */
export async function probeMediaDurationSec(mediaPath: string): Promise<number> {
  const { stdout } = await execFileP(
    'ffprobe',
    [
      '-v',
      'error',
      '-show_entries',
      'format=duration',
      '-of',
      'default=noprint_wrappers=1:nokey=1',
      mediaPath,
    ],
    { timeout: PROBE_TIMEOUT_MS },
  )
  const durationSec = Number.parseFloat(stdout.trim())
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    throw new Error(`Could not probe media duration for ${mediaPath}`)
  }
  return durationSec
}

/**
 * Callback-style execFile wrapped by hand (instead of util.promisify) so the
 * stderr channel -- where loudnorm prints -- is preserved and tests can stub
 * node:child_process.execFile with a plain last-arg-callback mock.
 */
function execFileP(
  file: string,
  args: string[],
  options: { maxBuffer?: number; timeout?: number },
): Promise<{ stderr: string; stdout: string }> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { encoding: 'utf8', ...options }, (error, stdout, stderr) => {
      if (error) {
        reject(error)
        return
      }
      resolve({ stderr: stderr ?? '', stdout: stdout ?? '' })
    })
  })
}

/** Fixed-precision number formatting with trailing zeros stripped (test-stable). */
function formatFixed(value: number, digits: number): string {
  return String(Number(value.toFixed(digits)))
}
