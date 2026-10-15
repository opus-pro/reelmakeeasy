// Beat-loop QA meters (the beat-loop skill's section 9).
// Each 4 s clip is measured before the next one starts: beat shape, late
// arrival, stray cut, music bed, the joint and loop seam, the landing on its
// keyframe, and a text screen. ffmpeg decodes; the maths runs here so one
// decode feeds every motion meter. The meters screen, they don't judge: a
// flagged clip gets one re-roll, and its frame strip is what a person checks.

import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { extractLastFrame } from '../utils/media'

import { BEAT_CUT_LEAD_SECONDS, BEAT_HIT_END_SECONDS, BEAT_HOLD_SECONDS } from './beat-loop-timing'

/** Motion meters run on gray frames scaled down to this size. */
export const BEAT_QA_FRAME_WIDTH = 72
export const BEAT_QA_FRAME_HEIGHT = 128

/** E12/E3 and E4/E3 must reach this: the freeze is clearly stiller than the hit and the cut. */
export const BEAT_SHAPE_MIN_RATIO = 1.3
/** E4 must be at least this share of E12: the cut carries real energy. */
export const BEAT_SHAPE_MIN_CUT_TO_HIT = 0.5
/** A frame has arrived once its distance to the last frame is within this share of the first frame's. */
export const ARRIVAL_WITHIN = 0.25
/** The clip must not arrive before this (no early morph): just before the cut beat, 2.9 s. */
export const ARRIVAL_MIN_S = BEAT_HOLD_SECONDS - BEAT_CUT_LEAD_SECONDS
/** A stray cut spikes above this multiple of the clip's median motion... */
export const STRAY_CUT_MEDIAN_MULTIPLE = 4
/** ...above this absolute level (gray levels, 0-255)... */
export const STRAY_CUT_MIN_VALUE = 15
/** ...and at least this multiple of both neighbours... */
export const STRAY_CUT_NEIGHBOUR_MULTIPLE = 2.5
/** ...between these times (the cut beat is allowed to move fast). */
export const STRAY_CUT_FROM_S = 0.15
export const STRAY_CUT_TO_S = ARRIVAL_MIN_S
/** A stray cut happens in one step: the biggest frame-to-frame step carries this share of it. */
export const STRAY_CUT_ONE_STEP_SHARE = 0.8
/** Seconds of sustained tonal lines allowed: none. */
export const MUSIC_BED_MAX_S = 0
/** SSIM floor for a joint (clip k's last frame vs clip k+1's first) and the loop seam. */
export const JOINT_MIN_SSIM = 0.8
/** SSIM floor for the landing: the clip's last frame vs the keyframe f(k) it was asked to end on. */
export const ANCHOR_MIN_SSIM = 0.7
/** The text screen looks at one frame per this many seconds. */
export const TEXT_FRAME_INTERVAL_S = 0.22
/** The music meter's sample rate (its frequency bins assume it). */
export const TONAL_SAMPLE_RATE = 16_000

// Beat boundaries inside a beat-locked clip: hit 0-2 s, freeze 2-3 s, cut 3 s to the end.
const HIT_END_S = BEAT_HIT_END_SECONDS
const FREEZE_END_S = BEAT_HOLD_SECONDS
// A freeze that truly holds still measures 0: floor the divisor so the ratios stay finite (and JSON-safe).
const ENERGY_FLOOR = 0.01
// Stray cuts compare frames two apart, so a picture shown twice (12 fps judder
// on a 24 fps clip) reads as smooth motion instead of a 0/jump/0 flicker.
const STRAY_CUT_FRAME_GAP = 2
// Music meter (a port of the beat-loop skill's music-bed screen, section 9): 2048-point Hann windows every
// 256 samples, narrow peaks 100 Hz-8 kHz at least 10 dB above the median of the
// 12 bins either side, held for at least 0.5 s (one bin of drift allowed).
const TONAL_FFT_SIZE = 2048
const TONAL_HOP = 256
const TONAL_MIN_HZ = 100
const TONAL_MAX_HZ = 8000
const TONAL_PEAK_DB = 10
const TONAL_NEIGHBOUR_BINS = 12
const TONAL_MIN_RUN_S = 0.5
// SSIM is measured at the size the floors were calibrated at.
const SSIM_SIZE = '720:1280'
// Tiles per row in the text strip.
const STRIP_COLUMNS = 9
const STRIP_TILE_WIDTH = 200
// A 4 s clip decodes in well under a second; a wedged ffmpeg must not hang the workflow.
const COMMAND_TIMEOUT_MS = 120_000

export type BeatLoopQaCheck =
  | 'anchor'
  | 'beatShape'
  | 'joint'
  | 'lateArrival'
  | 'musicBed'
  | 'seam'
  | 'strayCut'
  | 'text'

export interface BeatLoopTextCheckInput {
  clipPath: string
  /** One frame every 0.22 s, full size. */
  frames: BeatLoopTextFrame[]
  /** The same frames tiled into one image (cheaper to send to a vision model). */
  stripPath: string
}

export interface BeatLoopTextFrame {
  path: string
  timeS: number
}

export interface BeatLoopTextVerdict {
  detail?: string
  hasText: boolean
}

export interface BeatShapeCheck {
  /** E4 / E3 */
  cutToFreeze: number
  /** E4 / E12 */
  cutToHit: number
  /** Mean motion energy 2-3 s (the freeze). */
  e3: number
  /** Mean motion energy 3 s to the end (the cut). */
  e4: number
  /** Mean motion energy 0-2 s (the hit). */
  e12: number
  /** E12 / E3 */
  hitToFreeze: number
  passed: boolean
}

export interface LateArrivalCheck {
  /** When the clip settles within 25% of its starting distance from the last frame, for good. */
  arrivalS: number
  passed: boolean
  /** The first frame's distance to the last frame (mean gray-level difference). */
  startDistance: number
}

export interface MusicBedCheck {
  /** Length of the clip's audio (0 when it has none). */
  audioS: number
  passed: boolean
  /** Seconds covered by sustained tonal lines. */
  tonalS: number
}

export interface SsimCheck {
  passed: boolean
  ssim: number
}

export interface StrayCut {
  /** Time of the first frame of the new shot. */
  timeS: number
  /** The two-frames-apart difference at the cut (gray levels). */
  value: number
}

export interface StrayCutCheck {
  cuts: StrayCut[]
  /** Median two-frames-apart difference over the clip. */
  median: number
  passed: boolean
}

export interface TextCheck {
  detail?: string
  /** Set when the checker failed to run; the clip is not failed for it. */
  error?: string
  frames: number
  passed: boolean
}

/** Every meter's reading for one take of one clip (saved to beat_loop_qa.json). */
export interface BeatLoopClipQa {
  anchor: null | SsimCheck
  beatShape: BeatShapeCheck
  durationS: number
  /** The checks that failed, in a fixed order. */
  failed: BeatLoopQaCheck[]
  /** Kept frames, when a workDir was given. */
  files?: BeatLoopClipQaFiles
  fps: number
  frameCount: number
  /** First frame vs the start frame. */
  joint: null | SsimCheck
  lateArrival: LateArrivalCheck
  musicBed: MusicBedCheck
  passed: boolean
  /** Last frame vs the loop's first frame (last clip only). */
  seam: null | SsimCheck
  strayCut: StrayCutCheck
  text: null | TextCheck
}

export interface BeatLoopClipQaFiles {
  firstFramePath: string
  lastFramePath: string
  stripPath: null | string
}

export interface BeatLoopClipQaInput {
  clipPath: string
  /** Set on the last clip: the loop's first frame, to check the loop seam. */
  loopFirstFramePath?: string
  /** The image the clip was asked to start from: f0 for clip 1, then the previous clip's real last frame. */
  startFramePath?: string
  /** f(k), the keyframe the clip was asked to land on. */
  targetFramePath?: string
  textChecker?: BeatLoopTextChecker
  /** Keeps the extracted frames and the strip here; otherwise a temporary folder is removed afterwards. */
  workDir?: string
}

/** Looks for letters or numbers anywhere in the frames. Injected so the meters stay free of model calls. */
export type BeatLoopTextChecker = (input: BeatLoopTextCheckInput) => Promise<BeatLoopTextVerdict>

// The order failed checks are listed in.
const CHECK_ORDER: BeatLoopQaCheck[] = [
  'beatShape',
  'lateArrival',
  'strayCut',
  'musicBed',
  'joint',
  'anchor',
  'seam',
  'text',
]

interface ClipProbe {
  fps: number
  hasAudio: boolean
}

interface FrameChecks {
  anchor: null | SsimCheck
  files: BeatLoopClipQaFiles
  joint: null | SsimCheck
  seam: null | SsimCheck
}

/** Run every meter on one clip. Throws only when ffmpeg can't read the clip. */
export async function measureBeatLoopClip(input: BeatLoopClipQaInput): Promise<BeatLoopClipQa> {
  const workDir =
    input.workDir ?? (await mkdtemp(path.join(os.tmpdir(), 'reelmakeeasy-beat-loop-qa-')))
  try {
    await mkdir(workDir, { recursive: true })
    const probe = await probeClip(input.clipPath)
    const [frames, musicBed, frameChecks, text] = await Promise.all([
      decodeGrayFrames(input.clipPath),
      measureMusicBed(input.clipPath, probe.hasAudio),
      measureFrameChecks(input, workDir),
      runTextCheck(input, workDir),
    ])
    const beatShape = measureBeatShape(motionEnergies(frames), probe.fps)
    const lateArrival = measureLateArrival(frames, probe.fps)
    const strayCut = findStrayCuts(frames, probe.fps)
    const results = {
      anchor: frameChecks.anchor,
      beatShape,
      joint: frameChecks.joint,
      lateArrival,
      musicBed,
      seam: frameChecks.seam,
      strayCut,
      text: text.check,
    }
    const failed = CHECK_ORDER.filter((name) => results[name]?.passed === false)
    return {
      ...results,
      durationS: round(frames.length / probe.fps, 3),
      failed,
      ...(input.workDir ? { files: { ...frameChecks.files, stripPath: text.stripPath } } : {}),
      fps: probe.fps,
      frameCount: frames.length,
      passed: failed.length === 0,
    }
  } finally {
    if (!input.workDir) await rm(workDir, { force: true, recursive: true })
  }
}

/** One plain sentence per failed check, for the tool result and the run log. */
export function describeBeatLoopQaFailures(qa: BeatLoopClipQa): string[] {
  return qa.failed.map((name) => {
    switch (name) {
      case 'anchor': {
        return `It lands on the wrong final frame (${percent(qa.anchor?.ssim)} match, needs ${percent(ANCHOR_MIN_SSIM)}).`
      }
      case 'beatShape': {
        return "It doesn't hit, hold still, then cut: the motion is too even."
      }
      case 'joint': {
        return `It doesn't start where the last clip ended (${percent(qa.joint?.ssim)} match, needs ${percent(JOINT_MIN_SSIM)}).`
      }
      case 'lateArrival': {
        return `It reaches the next picture too early (at ${qa.lateArrival.arrivalS} s; not before ${ARRIVAL_MIN_S} s).`
      }
      case 'musicBed': {
        return `Music under the sound effects (${qa.musicBed.tonalS} s of steady tones).`
      }
      case 'seam': {
        return `The loop doesn't close: the last frame doesn't match the first (${percent(qa.seam?.ssim)} match, needs ${percent(JOINT_MIN_SSIM)}).`
      }
      case 'strayCut': {
        const times = qa.strayCut.cuts.map((cut) => `${cut.timeS} s`).join(', ')
        return qa.strayCut.cuts.length > 1 ? `Hard cuts at ${times}.` : `A hard cut at ${times}.`
      }
      case 'text': {
        return qa.text?.detail
          ? `Letters or numbers on screen: ${qa.text.detail}.`
          : 'Letters or numbers on screen.'
      }
    }
  })
}

/**
 * Sort comparator for takes of the same clip, better first: fewer failed checks,
 * then the closer landing on the keyframe, then the smoother joint.
 */
export function compareBeatLoopTakes(a: BeatLoopClipQa, b: BeatLoopClipQa): number {
  return (
    a.failed.length - b.failed.length ||
    (b.anchor?.ssim ?? 0) - (a.anchor?.ssim ?? 0) ||
    (b.joint?.ssim ?? 0) - (a.joint?.ssim ?? 0)
  )
}

// ---------------------------------------------------------------------------
// Motion meters (pure, on gray frames)
// ---------------------------------------------------------------------------

/**
 * Mean absolute difference between consecutive frames: the same number as the
 * YAVG of ffmpeg's `scale=72:128,format=gray,tblend=all_mode=difference,signalstats`.
 * Entry j is the step into frame j+1, so it carries that frame's time.
 */
export function motionEnergies(frames: Uint8Array[]): number[] {
  return frames.slice(1).map((current, j) => meanAbsDiff(current, frames[j]))
}

/** Beat shape: a hit, a stiller freeze, then a cut with real energy. */
export function measureBeatShape(energies: number[], fps: number): BeatShapeCheck {
  const hit: number[] = []
  const freeze: number[] = []
  const cut: number[] = []
  energies.forEach((energy, j) => {
    const timeS = (j + 1) / fps
    if (timeS <= HIT_END_S) hit.push(energy)
    else if (timeS <= FREEZE_END_S) freeze.push(energy)
    else cut.push(energy)
  })
  const e12 = mean(hit)
  const e3 = mean(freeze)
  const e4 = mean(cut)
  const hitToFreeze = e12 / Math.max(e3, ENERGY_FLOOR)
  const cutToFreeze = e4 / Math.max(e3, ENERGY_FLOOR)
  const cutToHit = e4 / Math.max(e12, ENERGY_FLOOR)
  return {
    cutToFreeze: round(cutToFreeze, 2),
    cutToHit: round(cutToHit, 2),
    e12: round(e12, 3),
    e3: round(e3, 3),
    e4: round(e4, 3),
    hitToFreeze: round(hitToFreeze, 2),
    passed:
      hitToFreeze >= BEAT_SHAPE_MIN_RATIO &&
      cutToFreeze >= BEAT_SHAPE_MIN_RATIO &&
      e4 >= BEAT_SHAPE_MIN_CUT_TO_HIT * e12,
  }
}

/**
 * Late arrival: the time from which every frame stays within 25% of the first
 * frame's distance to the last frame. A clip that never leaves its first frame
 * arrives at 0 s and fails.
 */
export function measureLateArrival(frames: Uint8Array[], fps: number): LateArrivalCheck {
  if (frames.length === 0) return { arrivalS: 0, passed: false, startDistance: 0 }
  const last = frames.at(-1) as Uint8Array
  const distances = frames.map((image) => meanAbsDiff(image, last))
  const limit = ARRIVAL_WITHIN * distances[0]
  let arrived = distances.length - 1
  while (arrived > 0 && distances[arrived - 1] <= limit) arrived--
  const arrivalS = arrived / fps
  return {
    arrivalS: round(arrivalS, 3),
    passed: arrivalS >= ARRIVAL_MIN_S,
    startDistance: round(distances[0], 2),
  }
}

/**
 * Stray cuts between 0.15 s and 2.9 s: a spike in the difference between frames
 * two apart, above 4x the clip median and 15, at least 2.5x the neighbouring
 * (non-overlapping) differences, and carried by one frame-to-frame step (80% of
 * it): fast motion settling into the freeze adds up two big steps, a cut is one.
 * A hard cut raises two overlapping differences; they are reported once, at the
 * first frame of the new shot.
 */
export function findStrayCuts(frames: Uint8Array[], fps: number): StrayCutCheck {
  const gap = STRAY_CUT_FRAME_GAP
  // values[k] compares frame k+gap with frame k and carries frame k+gap's time.
  const values = frames.slice(gap).map((current, k) => meanAbsDiff(current, frames[k]))
  // steps[k] compares frame k+1 with frame k.
  const steps = motionEnergies(frames)
  const median = medianOf(values)
  const cuts: StrayCut[] = []
  let previous = Number.NEGATIVE_INFINITY
  for (let k = gap; k < values.length - gap; k++) {
    const timeS = (k + gap) / fps
    if (timeS < STRAY_CUT_FROM_S || timeS > STRAY_CUT_TO_S) continue
    if (!isSpike(values, k, median)) continue
    // The pair's biggest single step must carry the jump.
    if (Math.max(...steps.slice(k, k + gap)) < STRAY_CUT_ONE_STEP_SHARE * values[k]) continue
    const lastCut = cuts.at(-1)
    if (lastCut && k - previous === 1) {
      lastCut.value = Math.max(lastCut.value, round(values[k], 2))
    } else {
      cuts.push({ timeS: round(timeS, 3), value: round(values[k], 2) })
    }
    previous = k
  }
  return { cuts, median: round(median, 2), passed: cuts.length === 0 }
}

function isSpike(values: number[], k: number, median: number): boolean {
  const value = values[k]
  const gap = STRAY_CUT_FRAME_GAP
  return (
    value > STRAY_CUT_MEDIAN_MULTIPLE * median &&
    value > STRAY_CUT_MIN_VALUE &&
    value >= STRAY_CUT_NEIGHBOUR_MULTIPLE * values[k - gap] &&
    value >= STRAY_CUT_NEIGHBOUR_MULTIPLE * values[k + gap]
  )
}

// ---------------------------------------------------------------------------
// Music bed meter (pure, on 16 kHz mono samples)
// ---------------------------------------------------------------------------

/**
 * Seconds of sustained tonal lines in 16 kHz mono audio: a TypeScript port of
 * the beat-loop skill's music-bed screen (Python). Sound effects are broadband and short; a music bed
 * leaves narrow spectral lines that hold for half a second or more.
 */
export function measureTonalSeconds(samples: Float32Array): number {
  const frameCount =
    samples.length > TONAL_FFT_SIZE ? Math.ceil((samples.length - TONAL_FFT_SIZE) / TONAL_HOP) : 0
  if (frameCount === 0) return 0
  const binHz = TONAL_SAMPLE_RATE / TONAL_FFT_SIZE
  const bins = TONAL_FFT_SIZE / 2 + 1
  // First bins at or above 100 Hz and 8 kHz (numpy searchsorted).
  const lo = Math.ceil(TONAL_MIN_HZ / binHz)
  const hi = Math.ceil(TONAL_MAX_HZ / binHz)
  const spectrum = spectrogramDb(samples, frameCount)
  const peaks = markTonalPeaks(spectrum, frameCount, bins, lo, hi)
  const need = Math.floor((TONAL_MIN_RUN_S * TONAL_SAMPLE_RATE) / TONAL_HOP)
  const sustained = new Uint8Array(frameCount)
  for (let bin = lo; bin < hi; bin++) {
    let run = 0
    for (let t = 0; t < frameCount; t++) {
      const row = t * bins
      // A line may drift by one bin between windows.
      const lit = peaks[row + bin] || peaks[row + bin - 1] || peaks[row + bin + 1]
      run = lit ? run + 1 : 0
      if (run === need) sustained.fill(1, t - need + 1, t + 1)
      else if (run > need) sustained[t] = 1
    }
  }
  const sustainedFrames = sustained.reduce((sum, flag) => sum + flag, 0)
  return round((sustainedFrames * TONAL_HOP) / TONAL_SAMPLE_RATE, 3)
}

/** Magnitude in dB, frame by frame (rows of TONAL_FFT_SIZE/2+1 bins), with a Hann window. */
function spectrogramDb(samples: Float32Array, frameCount: number): Float64Array {
  const n = TONAL_FFT_SIZE
  const bins = n / 2 + 1
  const window = Float64Array.from(
    { length: n },
    (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)),
  )
  const fft = createFft(n)
  const re = new Float64Array(n)
  const im = new Float64Array(n)
  const out = new Float64Array(frameCount * bins)
  for (let t = 0; t < frameCount; t++) {
    const offset = t * TONAL_HOP
    for (let i = 0; i < n; i++) re[i] = samples[offset + i] * window[i]
    im.fill(0)
    fft(re, im)
    for (let b = 0; b < bins; b++) {
      out[t * bins + b] = 20 * Math.log10(Math.hypot(re[b], im[b]) + 1e-9)
    }
  }
  return out
}

/** Bins at least 10 dB above the median of the 12 bins either side (the bin itself left out). */
function markTonalPeaks(
  spectrum: Float64Array,
  frameCount: number,
  bins: number,
  lo: number,
  hi: number,
): Uint8Array {
  const peaks = new Uint8Array(frameCount * bins)
  const neighbours = new Float64Array(2 * TONAL_NEIGHBOUR_BINS)
  for (let t = 0; t < frameCount; t++) {
    const row = t * bins
    for (let bin = lo; bin < hi; bin++) {
      let count = 0
      const from = Math.max(0, bin - TONAL_NEIGHBOUR_BINS)
      const to = Math.min(bins - 1, bin + TONAL_NEIGHBOUR_BINS)
      for (let j = from; j <= to; j++) {
        if (j !== bin) neighbours[count++] = spectrum[row + j]
      }
      const local = medianOfSorted(neighbours.subarray(0, count).sort())
      if (spectrum[row + bin] >= local + TONAL_PEAK_DB) peaks[row + bin] = 1
    }
  }
  return peaks
}

/** In-place radix-2 FFT for a power-of-two size. */
export function createFft(size: number): (re: Float64Array, im: Float64Array) => void {
  const levels = Math.log2(size)
  const reversed = new Uint32Array(size)
  for (let i = 0; i < size; i++) {
    let r = 0
    for (let bit = 0; bit < levels; bit++) r = (r << 1) | ((i >> bit) & 1)
    reversed[i] = r
  }
  const cos = Float64Array.from({ length: size / 2 }, (_, i) => Math.cos((2 * Math.PI * i) / size))
  const sin = Float64Array.from({ length: size / 2 }, (_, i) => Math.sin((2 * Math.PI * i) / size))
  return (re, im) => {
    for (let i = 0; i < size; i++) {
      const j = reversed[i]
      if (j > i) {
        ;[re[i], re[j]] = [re[j], re[i]]
        ;[im[i], im[j]] = [im[j], im[i]]
      }
    }
    for (let length = 2; length <= size; length <<= 1) {
      const half = length >> 1
      const step = size / length
      for (let start = 0; start < size; start += length) {
        for (let k = 0; k < half; k++) {
          const wr = cos[k * step]
          const wi = -sin[k * step]
          const a = start + k
          const b = a + half
          const tr = re[b] * wr - im[b] * wi
          const ti = re[b] * wi + im[b] * wr
          re[b] = re[a] - tr
          im[b] = im[a] - ti
          re[a] += tr
          im[a] += ti
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// ffmpeg
// ---------------------------------------------------------------------------

async function probeClip(clipPath: string): Promise<ClipProbe> {
  const { stdout } = await run('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'stream=codec_type,r_frame_rate,avg_frame_rate',
    '-of',
    'json',
    clipPath,
  ])
  const parsed = JSON.parse(stdout.toString('utf8')) as {
    streams?: { avg_frame_rate?: string; codec_type?: string; r_frame_rate?: string }[]
  }
  const streams = parsed.streams ?? []
  const video = streams.find((stream) => stream.codec_type === 'video')
  const fps = parseRate(video?.r_frame_rate) || parseRate(video?.avg_frame_rate)
  if (!fps) throw new Error(`Could not read the frame rate of ${clipPath}`)
  return { fps, hasAudio: streams.some((stream) => stream.codec_type === 'audio') }
}

/** Every frame, scaled to 72x128 gray. */
async function decodeGrayFrames(clipPath: string): Promise<Uint8Array[]> {
  const { stdout } = await run('ffmpeg', [
    '-v',
    'error',
    '-i',
    clipPath,
    '-map',
    '0:v:0',
    '-vf',
    `scale=${BEAT_QA_FRAME_WIDTH}:${BEAT_QA_FRAME_HEIGHT},format=gray`,
    '-f',
    'rawvideo',
    '-pix_fmt',
    'gray',
    '-',
  ])
  const size = BEAT_QA_FRAME_WIDTH * BEAT_QA_FRAME_HEIGHT
  const count = Math.floor(stdout.length / size)
  return Array.from({ length: count }, (_, i) => stdout.subarray(i * size, (i + 1) * size))
}

async function measureFrameChecks(
  input: BeatLoopClipQaInput,
  workDir: string,
): Promise<FrameChecks> {
  const base = path.basename(input.clipPath, path.extname(input.clipPath))
  const firstFramePath = path.join(workDir, `${base}_qa_first.png`)
  const lastFramePath = path.join(workDir, `${base}_qa_last.png`)
  await Promise.all([
    extractFirstFrame(input.clipPath, firstFramePath),
    extractLastFrame(input.clipPath, lastFramePath),
  ])
  const compare = async (a: string, b: string | undefined, floor: number) =>
    b ? toSsimCheck(await measureFrameSsim(a, b), floor) : null
  const [joint, anchor, seam] = await Promise.all([
    compare(firstFramePath, input.startFramePath, JOINT_MIN_SSIM),
    compare(lastFramePath, input.targetFramePath, ANCHOR_MIN_SSIM),
    compare(lastFramePath, input.loopFirstFramePath, JOINT_MIN_SSIM),
  ])
  return { anchor, files: { firstFramePath, lastFramePath, stripPath: null }, joint, seam }
}

async function measureMusicBed(clipPath: string, hasAudio: boolean): Promise<MusicBedCheck> {
  if (!hasAudio) return { audioS: 0, passed: true, tonalS: 0 }
  const { stdout } = await run('ffmpeg', [
    '-v',
    'error',
    '-i',
    clipPath,
    '-map',
    '0:a:0',
    '-ac',
    '1',
    '-ar',
    String(TONAL_SAMPLE_RATE),
    '-f',
    'f32le',
    '-',
  ])
  // Copy into an aligned buffer: Float32Array needs a 4-byte-aligned offset.
  const samples = new Float32Array(Math.floor(stdout.length / 4))
  new Uint8Array(samples.buffer).set(stdout.subarray(0, samples.length * 4))
  const tonalS = measureTonalSeconds(samples)
  return {
    audioS: round(samples.length / TONAL_SAMPLE_RATE, 3),
    passed: tonalS <= MUSIC_BED_MAX_S,
    tonalS,
  }
}

/** SSIM ("All") of two images, both scaled to 720x1280. */
export async function measureFrameSsim(aPath: string, bPath: string): Promise<number> {
  const { stderr } = await run('ffmpeg', [
    '-hide_banner',
    '-nostats',
    '-v',
    'info',
    '-i',
    aPath,
    '-i',
    bPath,
    '-lavfi',
    `[0:v]scale=${SSIM_SIZE},format=yuv420p[a];[1:v]scale=${SSIM_SIZE},format=yuv420p[b];[a][b]ssim`,
    '-f',
    'null',
    '-',
  ])
  const ssim = parseSsimAll(stderr)
  if (ssim === null) throw new Error(`Could not measure SSIM of ${aPath} vs ${bPath}`)
  return ssim
}

/** The overall ("All") score from the ssim filter's summary line. */
export function parseSsimAll(ffmpegStderr: string): null | number {
  const matches = [...ffmpegStderr.matchAll(/All:([\d.]+)/g)]
  const value = Number(matches.at(-1)?.[1])
  return matches.length > 0 && Number.isFinite(value) ? value : null
}

async function extractFirstFrame(clipPath: string, outputPath: string): Promise<void> {
  await run('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-i',
    clipPath,
    '-map',
    '0:v:0',
    '-frames:v',
    '1',
    outputPath,
  ])
}

async function runTextCheck(
  input: BeatLoopClipQaInput,
  workDir: string,
): Promise<{ check: null | TextCheck; stripPath: null | string }> {
  if (!input.textChecker) return { check: null, stripPath: null }
  const { frames, stripPath } = await extractTextFrames(input.clipPath, workDir)
  try {
    const verdict = await input.textChecker({ clipPath: input.clipPath, frames, stripPath })
    return {
      check: {
        ...(verdict.detail ? { detail: verdict.detail } : {}),
        frames: frames.length,
        passed: !verdict.hasText,
      },
      stripPath,
    }
  } catch (error) {
    // The screen couldn't run (a vision call failed): don't spend a re-roll on it.
    const message = error instanceof Error ? error.message : String(error)
    return { check: { error: message, frames: frames.length, passed: true }, stripPath }
  }
}

/** One full-size frame every 0.22 s, plus the same frames tiled into a strip. */
async function extractTextFrames(
  clipPath: string,
  workDir: string,
): Promise<{ frames: BeatLoopTextFrame[]; stripPath: string }> {
  const base = path.basename(clipPath, path.extname(clipPath))
  const framesDir = path.join(workDir, `${base}_qa_text`)
  await rm(framesDir, { force: true, recursive: true })
  await mkdir(framesDir, { recursive: true })
  const pattern = path.join(framesDir, 'frame_%03d.jpg')
  await run('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-i',
    clipPath,
    '-map',
    '0:v:0',
    '-vf',
    `fps=1/${TEXT_FRAME_INTERVAL_S}`,
    '-q:v',
    '2',
    pattern,
  ])
  const names = (await readdir(framesDir)).filter((name) => /^frame_\d{3}\.jpg$/.test(name)).sort()
  if (names.length === 0) throw new Error(`Could not extract frames from ${clipPath}`)
  const frames = names.map((name, i) => ({
    path: path.join(framesDir, name),
    timeS: round(i * TEXT_FRAME_INTERVAL_S, 2),
  }))
  const columns = Math.min(STRIP_COLUMNS, frames.length)
  const rows = Math.ceil(frames.length / columns)
  const stripPath = path.join(workDir, `${base}_qa_strip.jpg`)
  await run('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-framerate',
    '1',
    '-i',
    pattern,
    '-vf',
    `scale=${STRIP_TILE_WIDTH}:-2,tile=${columns}x${rows}`,
    '-frames:v',
    '1',
    '-q:v',
    '2',
    stripPath,
  ])
  return { frames, stripPath }
}

/** Run a command to completion, keeping stdout as bytes (raw frames and samples). */
function run(command: string, args: string[]): Promise<{ stderr: string; stdout: Buffer }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    const chunks: Buffer[] = []
    let stderr = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), COMMAND_TIMEOUT_MS)
    child.stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')))
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code, signal) => {
      clearTimeout(timer)
      if (code === 0) {
        resolve({ stderr, stdout: Buffer.concat(chunks) })
        return
      }
      const reason = signal ? `was stopped (${signal})` : `exited with code ${code}`
      reject(new Error(`${command} ${reason}: ${stderr.trim().slice(-1000)}`))
    })
  })
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function mean(values: number[]): number {
  return values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : 0
}

function meanAbsDiff(a: Uint8Array, b: Uint8Array): number {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i])
  return a.length > 0 ? sum / a.length : 0
}

function medianOf(values: number[]): number {
  return values.length > 0 ? medianOfSorted(Float64Array.from(values).sort()) : 0
}

function medianOfSorted(sorted: Float64Array): number {
  const n = sorted.length
  if (n === 0) return Number.NEGATIVE_INFINITY
  const mid = n >> 1
  return n % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function parseRate(rate: string | undefined): number {
  const [num, den = '1'] = (rate ?? '').split('/')
  const value = Number(num) / Number(den)
  return Number.isFinite(value) && value > 0 ? value : 0
}

function percent(value: number | undefined): string {
  return `${Math.round((value ?? 0) * 100)}%`
}

function round(value: number, digits: number): number {
  const scale = 10 ** digits
  return Math.round(value * scale) / scale
}

function toSsimCheck(ssim: number, floor: number): SsimCheck {
  return { passed: ssim >= floor, ssim: round(ssim, 4) }
}
