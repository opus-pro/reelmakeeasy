import { execFile } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

import {
  buildCaptionOverlay,
  captionFontFile,
  type CaptionOverlay,
  type CaptionSegment,
} from '../adapters/caption/caption-painter'
import { getLogger } from '../logger'
import { dataDir } from '../storage/file-store'
import { presetPackDir, presetPackVersion, RENDER_PRESETS } from '../storage/presets'
import {
  alimiterTakesLatency,
  BEAT_LOCK_FPS,
  buildLimiterFilter,
  computeSfxMixGainDb,
} from '../utils/beat-lock'

import { computeBgmGainDb, probeMediaDurationSec } from './bgm-mix'

/**
 * The finish pass of a beat-loop short, in ONE picture encode (skill sections 6
 * and 8): the captions and the fact stamps burned in (the app's caption painter,
 * one image stream each, the stamps over the captions), the voice-over mixed over
 * the clips' own sound effects, the master normalized to -14 LUFS, and the picture
 * upscaled to 1080x1920 (clips render at the model's native size so their
 * anchor frames chain; the upscale happens only here).
 *
 * Mix: the voice is levelled to -23 LUFS and the clips' sound, measured as it
 * enters the mix, sits 9.1 LU under it (about 35% amplitude): the beat-lock's
 * computeSfxMixGainDb, the same static-gain formula as the BGM bed. Master:
 * two-pass loudnorm I=-14 TP=-1.5 LRA=11, kept in LINEAR mode (one gain, no
 * pumping): when that gain would push the true peak over -1.5 dB,
 * a limiter shaves the peaks first and the mix is measured again. The limiter
 * may take only so much loudness: a bed that would need more (dense sound
 * effects with no voice) is mastered under -14 LUFS rather than squashed.
 *
 * Music (off unless the user adds it): the bed sits under the voice at the user's level, the
 * rule every video's music follows (its Volume % is a duck under the narration), so -23 LUFS
 * less that duck. It is padded to the loop and fades in and out at the loop's seam (MUSIC_FADE),
 * and the master takes it in with everything else, so the loop keeps its -14 LUFS and length.
 *
 * The audio is encoded on its own and its true peak measured after the AAC
 * encode, which adds 0.4-0.8 dB (up to 1.7 dB on dense sound effects); while it
 * is over -1.5 dB the master is planned again with that much less room and
 * encoded again from the mix (never from the AAC). The picture encode then
 * copies that audio stream in, so the file delivered is the one measured.
 */

const logger = getLogger('beat-loop-finish')

/** The finished short's frame. */
export const BEAT_LOOP_FRAME = { height: 1920, width: 1080 } as const

/** The master: skill section 6. */
export const BEAT_LOOP_LOUDNESS = { lra: 11, lufs: -14, truePeakDb: -1.5 } as const
/** The voice-over's level before the mix (the broadcast reference normalizeAudioVolume uses). */
export const BEAT_LOOP_VOICE_LUFS = -23

/**
 * How hard the limiter may work. `maxLossLu`: the loudness it may take away (its
 * average gain reduction; sparse voice peaks cost a fraction of a LU, dense sound
 * effects several). `maxReductionDb`: how far the loudest peak may be pushed into it.
 * `tries`: limiter settings measured per plan.
 */
export const BEAT_LOOP_LIMITER = { maxLossLu: 3, maxReductionDb: 12, tries: 6 } as const

const SAMPLE_RATE = 48_000
/** Music fades in at the loop's start and out at its end (s), so the seam doesn't click. */
export const MUSIC_FADE = { inS: 0.1, outS: 0.3 } as const
// Integrated loudness at or below this is silence.
const SILENCE_LUFS = -70
// The AAC encode adds 0.4-0.8 dB to the true peak on tested clip chains with a voice: the
// first plan keeps the master's peaks this far under the target, later plans lower
// them by what the encode actually added.
const ENCODE_HEADROOM_DB = 0.5
// Extra room when re-planning after an encode overshot.
const ENCODE_MARGIN_DB = 0.1
const ENCODE_TRIES = 3
// The limiter's ceiling. Loudnorm sets the level afterwards, so only the drive into it
// matters; any fixed ceiling under full scale will do.
const LIMITER_CEILING_DB = -3
// A limiter setting this close to a limit (dB or LU) is close enough.
const LIMITER_TOLERANCE = 0.2
// The loudness taken may run this far over maxLossLu once the search is close.
const LIMITER_LOSS_SLACK_LU = 0.25
// A 32 s 1080x1920 encode takes well under a minute; the bound only stops a wedged ffmpeg.
const FFMPEG_TIMEOUT_MS = 10 * 60_000
// loudnorm and x264 report on stderr.
const MAX_BUFFER_BYTES = 32 * 1024 * 1024

export interface BeatLoopFinishInput {
  /** The caption stream (caption-painter.ts), overlaid under the stamps; none without captions. */
  captionOverlay?: CaptionOverlay
  /** Defaults to the video's duration. */
  durationS?: number
  frame?: { height: number; width: number }
  /** The music bed, when the user added music; none by default. */
  music?: BeatLoopMusic
  outputPath: string
  /** Clip sound effects; defaults to the video's own audio, when it has any. */
  sfxPath?: string
  /** The fact stamps' stream (caption-painter.ts), over the captions; none without stamps. */
  stampOverlay?: CaptionOverlay
  /** The picture: the beat-locked clips back to back, any size (it is cropped to cover the frame). */
  videoPath: string
  /** The voice-over on the beat grid (line k at (k-1)*4 + 0.15 s). */
  voicePath?: string
}

export interface BeatLoopFinishResult {
  /** The caption stream drawn, when there were captions. */
  captionOverlay?: CaptionOverlay
  /** The delivered audio, measured after the AAC encode. */
  delivered?: { lufs: number; truePeakDb: number }
  durationS: number
  /**
   * The levels the mix put its sources at (finishBeatLoopVideo always reports them): what the
   * clip sound bed (beat-loop-sfx-bed.ts) is levelled by.
   */
  levels?: BeatLoopMixLevels
  /** The limiter, when one gain would have pushed the peaks over: how hard it worked. */
  limiter?: BeatLoopLimiter & { lossLu: number; reductionDb: number }
  /** What loudnorm reported in the final pass. */
  loudness?: LoudnormStats
  /** `none` when nothing made a sound and the track is silence. */
  normalizationType: 'dynamic' | 'linear' | 'none'
  outputPath: string
  sfxGainDb?: number
  sfxLufs?: number
  /** The stamp stream drawn, when there were stamps. */
  stampOverlay?: CaptionOverlay
  /** The master's loudness: -14 LUFS, or under it when the limiter could not take more. */
  targetLufs?: number
  voiceGainDb?: number
  voiceLufs?: number
}

export interface BeatLoopLimiter {
  /** The limiter's ceiling (sample peak), dBFS. */
  ceilingDb: number
  /** Gain before the limiter: puts the loudest peak `reductionDb` over the ceiling. */
  gainDb: number
}

/** A loop's own sound mastered on its own (masterBeatLoopAudio). */
export interface BeatLoopAudioResult {
  /** The delivered audio, measured after the AAC encode. */
  delivered?: { lufs: number; truePeakDb: number }
  durationS: number
  levels: BeatLoopMixLevels
  limiter?: BeatLoopFinishResult['limiter']
  loudness?: LoudnormStats
  normalizationType: BeatLoopFinishResult['normalizationType']
  outputPath: string
  targetLufs?: number
}

/** The music bed under a loop: the file, and how far under the narration it sits (dB). */
export interface BeatLoopMusic {
  /** resolveBgmDuckDbForVolume of the user's Volume %, as for every video's music. */
  duckDb: number
  path: string
}

/** The mix's sources, each left out when it is missing or silent (measureBeatLoopMix). */
export interface BeatLoopMixLevels {
  /** The music bed, when there is one. */
  music?: BeatLoopMixSource
  /** The clips' own sound effects. */
  sfx?: BeatLoopMixSource
  /** The voice-over. */
  voice?: BeatLoopMixSource
}

/** One source as it enters the mix (resampled, trimmed to the loop), and its gain there. */
export interface BeatLoopMixSource {
  /** The static gain the mix gives it, dB. */
  gainDb: number
  /** Integrated loudness, LUFS. */
  lufs: number
  /** True peak, dBTP. */
  peakDb: number
}

/** One limiter setting, measured. */
export interface LimiterProbe {
  /** How far the loudest peak goes over the limiter's ceiling, dB (0: no limiting). */
  driveDb: number
  /** Loudness the limiter took away, LU. */
  lossLu: number
  /** True peak minus integrated loudness of the limited mix: what one gain keeps. */
  plrDb: number
}

export interface LoudnormStats {
  inputI: number
  inputLra: number
  inputThresh: number
  inputTp: number
  normalizationType?: string
  outputI?: number
  outputTp?: number
  targetOffset: number
}

/** The mix as ffmpeg inputs and a filter graph ending in `[mix]`. */
interface MixAudio {
  durationS: number
  files: string[]
  mix: string[]
}

/** A limiter setting with what it measured. */
type MixProbe = LimiterProbe & { limiter?: BeatLoopLimiter; stats: LoudnormStats }

/** Reads the last loudnorm report (print_format=json) in ffmpeg's stderr. */
export function parseLoudnormStats(stderr: string): LoudnormStats {
  const start = stderr.lastIndexOf('{')
  const end = stderr.lastIndexOf('}')
  if (start === -1 || end <= start) {
    throw new Error('No loudnorm measurement in the ffmpeg output')
  }
  const raw = JSON.parse(stderr.slice(start, end + 1)) as Partial<
    Record<
      | 'input_i'
      | 'input_lra'
      | 'input_thresh'
      | 'input_tp'
      | 'normalization_type'
      | 'output_i'
      | 'output_tp'
      | 'target_offset',
      string
    >
  >
  const num = (key: keyof typeof raw) => {
    const value = raw[key]?.trim()
    if (value === undefined) return undefined
    if (/^-inf/i.test(value)) return Number.NEGATIVE_INFINITY
    if (/^\+?inf/i.test(value)) return Number.POSITIVE_INFINITY
    return Number.parseFloat(value)
  }
  return {
    inputI: num('input_i') ?? Number.NaN,
    inputLra: num('input_lra') ?? Number.NaN,
    inputThresh: num('input_thresh') ?? Number.NaN,
    inputTp: num('input_tp') ?? Number.NaN,
    normalizationType: raw.normalization_type,
    outputI: num('output_i'),
    outputTp: num('output_tp'),
    targetOffset: num('target_offset') ?? 0,
  }
}

/** loudnorm's own test for linear mode (af_loudnorm.c): the peak fits and the range is in target. */
export function loudnormCanStayLinear(stats: LoudnormStats, target = BEAT_LOOP_LOUDNESS): boolean {
  const peakFits = stats.inputTp + (target.lufs - stats.inputI) <= target.truePeakDb
  return peakFits && stats.inputLra <= target.lra
}

/**
 * The picture: cover-scale to the frame (Lanczos), then the caption stream (input
 * `captions.input`, its strip's top at `captions.y`), then the stamp stream over it
 * (`stamps`, likewise).
 */
export function buildBeatLoopVideoFilter(options: {
  captions?: { input: number; y: number }
  frame?: { height: number; width: number }
  stamps?: { input: number; y: number }
}): string[] {
  const { height, width } = options.frame ?? BEAT_LOOP_FRAME
  const lines = [
    `[0:v]setpts=PTS-STARTPTS,scale=${width}:${height}:force_original_aspect_ratio=increase:flags=lanczos,crop=${width}:${height},setsar=1[v0]`,
  ]
  let last = 'v0'
  // As the render's own caption overlay (render-plan-ffmpeg.ts): each stream ends with its last
  // image, and the picture passes on.
  const streams = [
    { label: 'caps', out: 'vcap', stream: options.captions },
    { label: 'stamps', out: 'vstamps', stream: options.stamps },
  ]
  for (const { label, out, stream } of streams) {
    if (!stream) continue
    lines.push(
      `[${stream.input}:v]format=rgba,setpts=PTS-STARTPTS[${label}]`,
      `[${last}][${label}]overlay=x=0:y=${stream.y}:eof_action=pass[${out}]`,
    )
    last = out
  }
  lines.push(`[${last}]format=yuv420p[vout]`)
  return lines
}

/**
 * The mix, ending in `[mix]`: each source resampled to 48 kHz stereo, trimmed
 * to the video and levelled by its static gain, then summed without amix's 1/n
 * rescaling and padded to exactly `durationS`.
 */
export function buildBeatLoopMixFilter(options: {
  durationS: number
  /** Padded to the loop (a shorter bed ends in silence), then faded in and out (MUSIC_FADE). */
  music?: { gainDb: number; input: string }
  sfx?: { gainDb: number; input: string }
  voice?: { gainDb: number; input: string }
}): string[] {
  const d = fmt(options.durationS, 3)
  const format = `aresample=${SAMPLE_RATE},aformat=sample_fmts=fltp:channel_layouts=stereo`
  const prep = (source: { gainDb: number; input: string }, label: string) =>
    `[${source.input}]${format},atrim=duration=${d},asetpts=PTS-STARTPTS,volume=${fmt(source.gainDb, 2)}dB[${label}]`
  const lines: string[] = []
  const labels: string[] = []
  if (options.voice) {
    lines.push(prep(options.voice, 'voice'))
    labels.push('[voice]')
  }
  if (options.sfx) {
    lines.push(prep(options.sfx, 'sfx'))
    labels.push('[sfx]')
  }
  if (options.music) {
    const fadeOutAt = fmt(Math.max(0, options.durationS - MUSIC_FADE.outS), 3)
    lines.push(
      `[${options.music.input}]${format},apad,atrim=duration=${d},asetpts=PTS-STARTPTS,volume=${fmt(options.music.gainDb, 2)}dB,` +
        `afade=t=in:st=0:d=${MUSIC_FADE.inS},afade=t=out:st=${fadeOutAt}:d=${MUSIC_FADE.outS}[music]`,
    )
    labels.push('[music]')
  }
  if (!labels.length) return [`anullsrc=r=${SAMPLE_RATE}:cl=stereo,atrim=duration=${d}[mix]`]
  const sum = labels.length > 1 ? `amix=inputs=${labels.length}:duration=longest:normalize=0,` : ''
  lines.push(`${labels.join('')}${sum}apad,atrim=duration=${d}[mix]`)
  return lines
}

/**
 * The master, from `[mix]` to `[aout]`: the optional limiter, then loudnorm's
 * second pass with the measured values. Without a measurement (silence) the
 * mix passes through.
 */
export function buildBeatLoopMasterFilter(options: {
  limiter?: BeatLoopLimiter
  /** Whether FFmpeg's alimiter has `latency` (alimiterTakesLatency); default true. */
  limiterLatency?: boolean
  measured?: LoudnormStats
  /** Defaults to -14 LUFS. */
  targetLufs?: number
  /** A last gain after loudnorm, when the encoded true peak still ran over. */
  trimDb?: number
}): string {
  const { limiter, measured, trimDb } = options
  if (!measured) return '[mix]anull[aout]'
  const target = BEAT_LOOP_LOUDNESS
  // The range only decides linear vs dynamic mode: a target over the measured range keeps
  // the gain linear (loudnorm accepts up to 50), and so does a non-zero measured range (a
  // steady bed can measure 0, which loudnorm reads as "not measured").
  const lra = Math.min(50, Math.max(target.lra, Math.ceil((measured.inputLra + 0.1) * 10) / 10))
  const chain = [
    ...limiterFilters(limiter, options.limiterLatency ?? true),
    `loudnorm=I=${fmt(options.targetLufs ?? target.lufs, 2)}:TP=${target.truePeakDb}:LRA=${fmt(lra, 1)}` +
      `:measured_I=${fmt(measured.inputI, 2)}:measured_TP=${fmt(measured.inputTp, 2)}` +
      `:measured_LRA=${fmt(Math.max(measured.inputLra, 0.01), 2)}` +
      `:measured_thresh=${fmt(measured.inputThresh, 2)}` +
      `:offset=${fmt(measured.targetOffset, 2)}:linear=true:print_format=json`,
    // loudnorm can hand back 192 kHz.
    `aresample=${SAMPLE_RATE}`,
    ...(trimDb ? [`volume=${fmt(trimDb, 2)}dB`] : []),
  ]
  return `[mix]${chain.join(',')}[aout]`
}

/** The gain into the limiter, then the limiter, its look-ahead taken back out (sound on picture). */
function limiterFilters(limiter: BeatLoopLimiter | undefined, latency: boolean): string[] {
  if (!limiter) return []
  const limit = Number((10 ** (limiter.ceilingDb / 20)).toFixed(4))
  return [
    `volume=${fmt(limiter.gainDb, 2)}dB`,
    buildLimiterFilter({ attackMs: 5, latency, limit, releaseMs: 50 }),
  ]
}

/**
 * Picks how hard to drive the limiter so one linear gain to the target keeps the
 * true peak in bounds (`plrDb` at most `maxPlrDb`), without taking more than
 * `maxLossLu` of loudness or pushing the loudest peak more than `maxDriveDb` in.
 *
 * Limiting sparse peaks (a voice's plosives) takes a dB off the peaks per dB of
 * drive; on dense sound effects it can take a quarter of that and most of it off
 * the loudness. So each step follows the slopes measured so far (secant, then
 * regula falsi once a setting has gone past a limit), for both the peaks and
 * the loudness taken, and stops at whichever limit comes first. `probes` holds
 * every setting measured (at least the unlimited mix, drive 0) and gains the new
 * ones, so a later search with a lower `maxPlrDb` starts from them. Returns the
 * setting that leaves the master loudest, the gentler one on a tie.
 */
export async function searchLimiterDrive<P extends LimiterProbe>(options: {
  maxDriveDb?: number
  maxLossLu?: number
  maxPlrDb: number
  probe: (driveDb: number) => Promise<P>
  probes: P[]
  tries?: number
}): Promise<P> {
  const { maxPlrDb, probes } = options
  if (!probes.length) throw new Error('Measure the unlimited mix (drive 0) first')
  const maxDrive = options.maxDriveDb ?? BEAT_LOOP_LIMITER.maxReductionDb
  const maxLoss = options.maxLossLu ?? BEAT_LOOP_LIMITER.maxLossLu
  // Room left before either limit: falls as the drive rises; the search wants it at 0. It
  // aims the peaks a tolerance under the limit, so a close-enough setting fits them.
  const peakRoom = (p: LimiterProbe) => p.plrDb - (maxPlrDb - LIMITER_TOLERANCE)
  const lossRoom = (p: LimiterProbe) => maxLoss - p.lossLu
  const room = (p: LimiterProbe) => Math.min(peakRoom(p), lossRoom(p))

  for (let n = 0; n < (options.tries ?? BEAT_LOOP_LIMITER.tries); n++) {
    const sorted = [...probes].sort((a, b) => a.driveDb - b.driveDb)
    if (sorted.some((p) => Math.abs(room(p)) <= LIMITER_TOLERANCE)) break
    const under = sorted.filter((p) => room(p) > 0)
    const below = under.at(-1)
    if (!below) break
    const above = sorted.find((p) => room(p) < 0)
    if (!above && below.driveDb >= maxDrive) break
    if (above && above.driveDb - below.driveDb < LIMITER_TOLERANCE) break

    // Where each limit is reached, along the line through two settings (with a single
    // setting: peaks fall a dB per dB of drive, and the loudness taken is unknown).
    const other = above ?? under.at(-2)
    const crossing = (f: (p: LimiterProbe) => number, fallbackSlope: number) => {
      const slope = other ? (f(other) - f(below)) / (other.driveDb - below.driveDb) : fallbackSlope
      return slope < -0.01 ? below.driveDb - f(below) / slope : Number.POSITIVE_INFINITY
    }
    let next = Math.min(crossing(peakRoom, -1), crossing(lossRoom, 0), maxDrive)
    if (above) {
      // Strictly inside the bracket, so it always shrinks.
      const span = above.driveDb - below.driveDb
      next = Math.min(Math.max(next, below.driveDb + 0.1 * span), above.driveDb - 0.1 * span)
    } else {
      next = Math.min(maxDrive, Math.max(next, below.driveDb + LIMITER_TOLERANCE))
    }
    probes.push(await options.probe(round2(next)))
  }

  const shortfall = (p: LimiterProbe) => Math.max(0, p.plrDb - maxPlrDb)
  return probes
    .filter((p) => p.lossLu <= maxLoss + LIMITER_LOSS_SLACK_LU)
    .reduce((best, p) => {
      const diff = shortfall(p) - shortfall(best)
      return diff < -0.005 || (Math.abs(diff) <= 0.005 && p.driveDb < best.driveDb) ? p : best
    })
}

/**
 * Draws the captions and the stamps (the shared caption painter: one image stream each, sampled
 * at the loop's 24 fps), then runs the finish pass.
 */
export async function applyBeatLoopFinish(
  input: Omit<BeatLoopFinishInput, 'captionOverlay' | 'stampOverlay'> & {
    /** The caption segments to draw (the loop's track in its caption style); none when off. */
    captions: CaptionSegment[]
    /** The unpacked render fonts; by default the faces drawn, from the installed preset pack. */
    fontsDir?: string
    /** The fact stamps to draw (the loop's facts track in its highlight colour), captions or not. */
    stamps: CaptionSegment[]
    /** Scratch space for the caption and stamp images; the caller removes it. */
    workDir: string
  },
): Promise<BeatLoopFinishResult> {
  const { captions, fontsDir: unpacked, stamps, workDir, ...finish } = input
  const frame = input.frame ?? BEAT_LOOP_FRAME
  const durationS = input.durationS ?? (await probeMediaDurationSec(input.videoPath))
  const fontsDir = unpacked ?? (await unpackBeatLoopFonts([...captions, ...stamps]))
  const draw = (segments: CaptionSegment[], dir: string) =>
    buildCaptionOverlay({
      fontsDir,
      fps: BEAT_LOCK_FPS,
      frame,
      segments,
      totalSec: durationS,
      workDir: path.join(workDir, dir),
    })
  const captionOverlay = await draw(captions, 'captions')
  const stampOverlay = await draw(stamps, 'stamps')
  return finishBeatLoopVideo({ ...finish, captionOverlay, durationS, stampOverlay })
}

/** The render font listings this process has read, by archive. */
const fontListings = new Map<string, Promise<string[]>>()

/**
 * Unpacks the render fonts' faces the captions and stamps draw with (each segment's family,
 * weight and style, picked as the caption painter picks them) from the installed preset pack,
 * and returns their folder: by default a cache in the data folder, per pack version, so every
 * render in this process registers the same files. A face already there is not unpacked again.
 * On failure the painter falls back to system faces, so this only warns.
 */
export async function unpackBeatLoopFonts(
  segments: readonly CaptionSegment[] = [],
  options: { archive?: string; dir?: string } = {},
): Promise<string> {
  const cache = path.join(dataDir(), 'cache', 'render-fonts')
  let dir = options.dir ?? cache
  try {
    dir = options.dir ?? path.join(cache, presetPackVersion())
    const archive = options.archive ?? path.join(presetPackDir(), RENDER_PRESETS.fonts)
    let listing = fontListings.get(archive)
    if (!listing) {
      listing = listFontArchive(archive)
      fontListings.set(archive, listing)
      // A pack installed later is read then.
      listing.catch(() => fontListings.delete(archive))
    }
    const files = await listing
    const wanted = new Set(
      segments.flatMap((s) => captionFontFile(files, captionFontOf(s))?.file ?? []),
    )
    const missing = [...wanted].filter(
      (file) => files.includes(file) && !fs.existsSync(path.join(dir, file)),
    )
    if (missing.length) await extractFonts(archive, missing, dir)
  } catch (error) {
    logger.warn(`[beat-loop] Could not unpack the render fonts: ${errorText(error)}`)
  }
  return dir
}

/** The face a caption or stamp segment is drawn in, as caption-layout reads it from it. */
function captionFontOf(segment: CaptionSegment) {
  const { style } = segment
  return {
    family: style.fontFamily ?? 'Montserrat',
    italic: Boolean(style.italic),
    weight: style.fontWeight ?? 400,
  }
}

/** The font files in the pack's `fonts/` folder. */
async function listFontArchive(archive: string): Promise<string[]> {
  const { stdout } = await run('tar', ['-tzf', archive])
  return stdout.split('\n').flatMap((line) => {
    const file = /^fonts\/([^/]+\.(?:otf|ttf))$/i.exec(line.trim())?.[1]
    return file ? [file] : []
  })
}

/**
 * Unpacks `files` from the pack's `fonts/` into `dir`. Each face is moved in whole once
 * unpacked, so another render never registers half a file.
 */
async function extractFonts(archive: string, files: string[], dir: string): Promise<void> {
  await fs.promises.mkdir(dir, { recursive: true })
  const staging = await fs.promises.mkdtemp(path.join(dir, '.unpack-'))
  try {
    await run('tar', ['-xzf', archive, '-C', staging, ...files.map((f) => `fonts/${f}`)])
    for (const file of files) {
      await fs.promises.rename(path.join(staging, 'fonts', file), path.join(dir, file))
    }
  } finally {
    await fs.promises.rm(staging, { force: true, recursive: true })
  }
}

/** Captions, stamps, mix, master and upscale: one picture encode, the mastered audio copied in. */
export async function finishBeatLoopVideo(
  input: BeatLoopFinishInput,
): Promise<BeatLoopFinishResult> {
  const durationS = input.durationS ?? (await probeMediaDurationSec(input.videoPath))
  const sfxFile =
    input.sfxPath ?? ((await hasAudioStream(input.videoPath)) ? input.videoPath : undefined)

  await fs.promises.mkdir(path.dirname(input.outputPath), { recursive: true })
  const scratch = await fs.promises.mkdtemp(
    path.join(path.dirname(input.outputPath), '.beat-loop-finish-'),
  )
  try {
    const audioPath = path.join(scratch, 'audio.m4a')
    const { delivered, levels, limiter, loudness, normalizationType, targetLufs } =
      await masterBeatLoopAudio({
        durationS,
        music: input.music,
        outputPath: audioPath,
        sfxPath: sfxFile,
        voicePath: input.voicePath,
      })
    const { gainDb: voiceGainDb, lufs: voiceLufs } = levels.voice ?? {}
    const { gainDb: sfxGainDb, lufs: sfxLufs } = levels.sfx ?? {}

    // The picture: the one video encode; the mastered audio is copied in as measured.
    const picture = pictureInputs(input)
    await run('ffmpeg', [
      '-hide_banner',
      '-nostats',
      '-y',
      ...picture.args,
      '-i',
      audioPath,
      '-filter_complex',
      picture.filter.join(';'),
      '-map',
      '[vout]',
      '-map',
      `${picture.count}:a:0`,
      '-c:v',
      'libx264',
      '-preset',
      'medium',
      '-crf',
      '18',
      '-pix_fmt',
      'yuv420p',
      '-c:a',
      'copy',
      '-t',
      fmt(durationS, 3),
      '-movflags',
      '+faststart',
      input.outputPath,
    ])

    logger.info(
      `[beat-loop] Finished ${JSON.stringify({ captions: Boolean(input.captionOverlay), delivered, durationS, limiter, music: levels.music, normalizationType, outputPath: input.outputPath, sfxGainDb, stamps: Boolean(input.stampOverlay), targetLufs, voiceGainDb })}`,
    )
    return {
      ...(input.captionOverlay ? { captionOverlay: input.captionOverlay } : {}),
      ...(delivered ? { delivered } : {}),
      durationS,
      levels,
      ...(limiter ? { limiter } : {}),
      ...(loudness ? { loudness } : {}),
      normalizationType,
      outputPath: input.outputPath,
      ...(sfxGainDb === undefined ? {} : { sfxGainDb, sfxLufs }),
      ...(input.stampOverlay ? { stampOverlay: input.stampOverlay } : {}),
      ...(targetLufs === undefined ? {} : { targetLufs }),
      ...(voiceGainDb === undefined ? {} : { voiceGainDb, voiceLufs }),
    }
  } finally {
    await fs.promises.rm(scratch, { force: true, recursive: true })
  }
}

/**
 * A loop's sound on its own, mastered into the AAC file `outputPath`: the voice over the clips'
 * sound, and the music under both when there is some, at -14 LUFS / -1.5 dBTP and exactly
 * `durationS` long. The finish pass copies it under the picture. A music change on a delivered
 * loop masters it again from the same files and puts it under the delivered picture, so with
 * the same files and no music it is the very sound the finish delivered.
 */
export async function masterBeatLoopAudio(input: {
  durationS: number
  music?: BeatLoopMusic
  outputPath: string
  sfxPath?: string
  voicePath?: string
}): Promise<BeatLoopAudioResult> {
  const { durationS, music, outputPath, sfxPath, voicePath } = input
  const levels = await measureBeatLoopMix({ durationS, music, sfxPath, voicePath })

  // Audio inputs in order: the sound effects, the voice, the music.
  const files: string[] = []
  const source = (file: string | undefined, level: BeatLoopMixSource | undefined) =>
    file && level ? { gainDb: level.gainDb, input: `${files.push(file) - 1}:a:0` } : undefined
  const sfx = source(sfxPath, levels.sfx)
  const voice = source(voicePath, levels.voice)
  const bed = source(music?.path, levels.music)
  const audio = {
    durationS,
    files,
    mix: buildBeatLoopMixFilter({ durationS, music: bed, sfx, voice }),
  }

  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true })
  const master = await masterAudio(audio, outputPath, {
    audible: Boolean(levels.voice || levels.sfx || levels.music),
    limiterLatency: await alimiterTakesLatency(),
  })
  const normalizationType = normalizationOf(master.loudness)
  if (normalizationType === 'dynamic') {
    logger.warn(
      `[beat-loop] loudnorm fell back to dynamic mode ${JSON.stringify({ limiter: master.limiter, loudness: master.loudness })}`,
    )
  }
  return { ...master, durationS, levels, normalizationType, outputPath }
}

/**
 * The picture's ffmpeg inputs, in order (the clips, the caption stream when there are
 * captions, the stamp stream when there are stamps), how many there are, and its filter graph.
 */
function pictureInputs(input: BeatLoopFinishInput): {
  args: string[]
  count: number
  filter: string[]
} {
  const { captionOverlay, stampOverlay } = input
  const stampInput = captionOverlay ? 2 : 1
  return {
    args: [
      '-i',
      input.videoPath,
      ...(captionOverlay?.inputArgs ?? []),
      ...(stampOverlay?.inputArgs ?? []),
    ],
    count: stampInput + (stampOverlay ? 1 : 0),
    filter: buildBeatLoopVideoFilter({
      captions: captionOverlay && { input: 1, y: captionOverlay.y },
      frame: input.frame,
      stamps: stampOverlay && { input: stampInput, y: stampOverlay.y },
    }),
  }
}

/**
 * Masters the mix into the AAC file `audioPath`. Pass one measures the mix; when
 * one gain to -14 LUFS would push the true peak over the target, the limiter
 * search (searchLimiterDrive) finds how hard to drive it. Then the master is
 * encoded and its true peak measured: while the encode pushed it over -1.5 dB,
 * the master is planned again with that much less room for the peaks. A plain
 * trim catches whatever the tries leave over.
 */
async function masterAudio(
  audio: MixAudio,
  audioPath: string,
  { audible, limiterLatency }: { audible: boolean; limiterLatency: boolean },
): Promise<{
  delivered?: { lufs: number; truePeakDb: number }
  limiter?: BeatLoopFinishResult['limiter']
  loudness?: LoudnormStats
  targetLufs?: number
}> {
  const encode = async (master: string) => {
    const { stderr } = await run('ffmpeg', [
      '-hide_banner',
      '-nostats',
      '-y',
      ...audio.files.flatMap((file) => ['-i', file]),
      '-filter_complex',
      [...audio.mix, master].join(';'),
      '-map',
      '[aout]',
      '-c:a',
      'aac',
      '-b:a',
      '192k',
      '-ar',
      String(SAMPLE_RATE),
      '-t',
      fmt(audio.durationS, 3),
      audioPath,
    ])
    return stderr
  }
  const analyse = (limiter?: BeatLoopLimiter) =>
    analyseLoudness(audio.files, [
      ...audio.mix,
      `[mix]${[...limiterFilters(limiter, limiterLatency), loudnormAnalysis()].join(',')}[aout]`,
    ])

  const first = audible ? await analyse() : undefined
  if (!first || !isAudible(first)) {
    await encode(buildBeatLoopMasterFilter({}))
    return {}
  }

  const target = BEAT_LOOP_LOUDNESS
  const probes: MixProbe[] = [{ driveDb: 0, lossLu: 0, plrDb: plr(first), stats: first }]
  const probe = async (driveDb: number): Promise<MixProbe> => {
    // The gain that puts the loudest peak `driveDb` over the ceiling.
    const limiter = {
      ceilingDb: LIMITER_CEILING_DB,
      gainDb: round2(LIMITER_CEILING_DB + driveDb - first.inputTp),
    }
    const stats = await analyse(limiter)
    const lossLu = round2(first.inputI + limiter.gainDb - stats.inputI)
    return { driveDb, limiter, lossLu, plrDb: plr(stats), stats }
  }

  let peakDb = target.truePeakDb - ENCODE_HEADROOM_DB
  let plan: undefined | { best: MixProbe; targetLufs: number; trimDb?: number }
  let loudness: LoudnormStats | undefined
  let delivered: LoudnormStats | undefined
  for (let n = 0; n < ENCODE_TRIES; n++) {
    const best = await searchLimiterDrive({ maxPlrDb: peakDb - target.lufs, probe, probes })
    // -14 LUFS, or as loud as the peaks allow when the limiter could not take enough.
    plan = { best, targetLufs: Math.min(target.lufs, floor2(peakDb - best.plrDb)) }
    loudness = parseLoudnormStats(await encode(masterFilter(plan, limiterLatency)))
    delivered = await measureFile(audioPath)
    if (delivered.inputTp <= target.truePeakDb) break
    peakDb = round2(peakDb - (delivered.inputTp - target.truePeakDb) - ENCODE_MARGIN_DB)
  }
  if (!plan || !loudness || !delivered) throw new Error('The beat-loop master was never planned')
  if (delivered.inputTp > target.truePeakDb) {
    plan.trimDb = round2(target.truePeakDb - ENCODE_MARGIN_DB - delivered.inputTp)
    loudness = parseLoudnormStats(await encode(masterFilter(plan, limiterLatency)))
    delivered = await measureFile(audioPath)
    if (delivered.inputTp > target.truePeakDb) {
      logger.warn(
        `[beat-loop] True peak still over the target after the trim ${JSON.stringify({ trimDb: plan.trimDb, truePeakDb: delivered.inputTp })}`,
      )
    }
  }

  const targetLufs = round2(plan.targetLufs + (plan.trimDb ?? 0))
  if (targetLufs < target.lufs - 0.5) {
    logger.warn(
      `[beat-loop] Mastered under ${target.lufs} LUFS: louder would take more limiting than allowed ${JSON.stringify({ lossLu: plan.best.lossLu, peakDb, plrDb: plan.best.plrDb, targetLufs })}`,
    )
  }
  const { best } = plan
  return {
    delivered: { lufs: delivered.inputI, truePeakDb: delivered.inputTp },
    ...(best.limiter
      ? { limiter: { ...best.limiter, lossLu: best.lossLu, reductionDb: best.driveDb } }
      : {}),
    loudness,
    targetLufs,
  }
}

function masterFilter(
  plan: { best: MixProbe; targetLufs: number; trimDb?: number },
  limiterLatency: boolean,
): string {
  return buildBeatLoopMasterFilter({
    limiter: plan.best.limiter,
    limiterLatency,
    measured: plan.best.stats,
    targetLufs: plan.targetLufs,
    trimDb: plan.trimDb,
  })
}

/** Runs `filters` (a loudnorm analysis ending at `[aout]`) over `files` and reads the report. */
async function analyseLoudness(files: string[], filters: string[]): Promise<LoudnormStats> {
  const { stderr } = await run('ffmpeg', [
    '-hide_banner',
    '-nostats',
    ...files.flatMap((file) => ['-i', file]),
    '-filter_complex',
    filters.join(';'),
    '-map',
    '[aout]',
    '-f',
    'null',
    '-',
  ])
  return parseLoudnormStats(stderr)
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message.split('\n')[0] : String(error)
}

/** Whether a media file has an audio stream (a silent one counts). */
export async function hasAudioStream(file: string): Promise<boolean> {
  const { stdout } = await run('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    'a',
    '-show_entries',
    'stream=index',
    '-of',
    'csv=p=0',
    file,
  ])
  return stdout.trim().length > 0
}

function loudnormAnalysis(): string {
  const { lra, lufs, truePeakDb } = BEAT_LOOP_LOUDNESS
  return `loudnorm=I=${lufs}:TP=${truePeakDb}:LRA=${lra}:print_format=json`
}

function normalizationOf(
  loudness: LoudnormStats | undefined,
): BeatLoopFinishResult['normalizationType'] {
  if (!loudness) return 'none'
  return loudness.normalizationType === 'linear' ? 'linear' : 'dynamic'
}

/**
 * The mix's levels, measured before it mixes: each source's loudness and true peak as it enters
 * the mix, and its static gain there. The voice is levelled to -23 LUFS and the clips' sound sits
 * 9.1 LU under it (computeSfxMixGainDb); with no voice the clips keep their own level. A silent
 * source is left out. `sfxPath` needs an audio stream (the finish takes the video's own when it
 * has one).
 */
export async function measureBeatLoopMix(input: {
  durationS: number
  music?: BeatLoopMusic
  sfxPath?: string
  voicePath?: string
}): Promise<BeatLoopMixLevels> {
  const { durationS, music, sfxPath, voicePath } = input
  const [voice, sfx, bed] = await Promise.all([
    voicePath ? measureSource(voicePath, durationS) : undefined,
    sfxPath ? measureSource(sfxPath, durationS) : undefined,
    music ? measureSource(music.path, durationS) : undefined,
  ])
  const sfxGainDb = (lufs: number) =>
    voice ? computeSfxMixGainDb({ clipLufs: lufs, voiceLufs: BEAT_LOOP_VOICE_LUFS }) : 0
  // The music sits its duck under the narration's level in the mix, voice or not.
  const musicGainDb = (lufs: number) =>
    computeBgmGainDb({ bedLufs: lufs, duckDb: music?.duckDb, voiceLufs: BEAT_LOOP_VOICE_LUFS })
  return {
    ...(bed ? { music: { ...bed, gainDb: musicGainDb(bed.lufs) } } : {}),
    ...(sfx ? { sfx: { ...sfx, gainDb: sfxGainDb(sfx.lufs) } } : {}),
    ...(voice ? { voice: { ...voice, gainDb: BEAT_LOOP_VOICE_LUFS - voice.lufs } } : {}),
  }
}

/** Loudness and true peak of a finished audio file. */
function measureFile(file: string): Promise<LoudnormStats> {
  return analyseLoudness([file], [`[0:a:0]${loudnormAnalysis()}[aout]`])
}

/** Integrated loudness and true peak of one source as it enters the mix; undefined when silent. */
async function measureSource(
  file: string,
  durationS: number,
): Promise<Omit<BeatLoopMixSource, 'gainDb'> | undefined> {
  const stats = await analyseLoudness(
    [file],
    [
      ...buildBeatLoopMixFilter({ durationS, voice: { gainDb: 0, input: '0:a:0' } }),
      `[mix]${loudnormAnalysis()}[aout]`,
    ],
  )
  return isAudible(stats) ? { lufs: stats.inputI, peakDb: stats.inputTp } : undefined
}

function run(file: string, args: string[]): Promise<{ stderr: string; stdout: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      file,
      args,
      { encoding: 'utf8', maxBuffer: MAX_BUFFER_BYTES, timeout: FFMPEG_TIMEOUT_MS },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`${file} failed: ${error.message}\n${stderr.slice(-2000)}`))
          return
        }
        resolve({ stderr, stdout })
      },
    )
  })
}

/** Louder than silence (loudnorm reports silence as -inf). */
const isAudible = (stats: LoudnormStats) => stats.inputI > SILENCE_LUFS

/** Peak-to-loudness ratio: true peak minus integrated loudness. */
const plr = (stats: LoudnormStats) => round2(stats.inputTp - stats.inputI)

const round2 = (n: number) => Math.round(n * 100) / 100
const floor2 = (n: number) => Math.floor(n * 100 + 1e-9) / 100

/** Fixed precision with trailing zeros dropped: 0.30 -> "0.3", 3.000 -> "3". */
function fmt(value: number, digits: number): string {
  return String(Number(value.toFixed(digits)))
}
