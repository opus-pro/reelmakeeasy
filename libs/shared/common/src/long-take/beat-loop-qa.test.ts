import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  ANCHOR_MIN_SSIM,
  type BeatLoopClipQa,
  type BeatLoopTextCheckInput,
  compareBeatLoopTakes,
  createFft,
  describeBeatLoopQaFailures,
  findStrayCuts,
  measureBeatLoopClip,
  measureBeatShape,
  measureLateArrival,
  measureTonalSeconds,
  motionEnergies,
  TONAL_SAMPLE_RATE,
} from './beat-loop-qa'

// Synthetic clips are drawn at twice the meter size (the meters scale to 72x128),
// 24 fps, 96 frames: the shape of a beat-locked 4 s clip.
const W = 144
const H = 256
const FPS = 24
const FRAMES = 96

type Audio = 'noise' | 'silence' | 'tone'

type Frame = Uint8Array

function frame(paint: (x: number, y: number) => number): Frame {
  const out = new Uint8Array(W * H)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) out[y * W + x] = paint(x, y)
  }
  return out
}

/** Mid-gray page with a bright square: the clip's opening frame. */
function squareAt(left: number, background = 128): Frame {
  return frame((x, y) => (x >= left && x < left + 40 && y >= 100 && y < 140 ? 235 : background))
}

/** Horizontal stripes: the keyframe the clip lands on. */
const target = frame((_x, y) => (y % 32 < 16 ? 230 : 25))

/** Vertical stripes scrolled by `offset` px. */
function stripes(offset: number): Frame {
  return frame((x) => ((x + offset) % 32 < 16 ? 230 : 25))
}

/** The cut beat: wipe from `from` to the target, right to left, over the given frames. */
function wipe(from: Frame, count: number): Frame[] {
  return Array.from({ length: count }, (_, i) => {
    const edge = Math.round(W * (1 - (i + 1) / count))
    return frame((x, y) => (x >= edge ? target[y * W + x] : from[y * W + x]))
  })
}

/** A clip that follows the beat: a square slides for 2 s, holds for 1 s, then wipes to the target. */
function beatClip(options: { cutAtFrame?: number } = {}): Frame[] {
  const out: Frame[] = []
  for (let i = 0; i < 48; i++) {
    const background = options.cutAtFrame !== undefined && i >= options.cutAtFrame ? 20 : 128
    out.push(squareAt(10 + i * 2, background))
  }
  const held = out[47]
  for (let i = 48; i < 72; i++) out.push(held)
  return [...out, ...wipe(held, FRAMES - 72)]
}

function hasFfmpeg(): boolean {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' })
    execFileSync('ffprobe', ['-version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/** Hit beat at 12 fps on a 24 fps clip: every picture is shown twice (Veo's judder). */
function judderClip(): Frame[] {
  const out: Frame[] = []
  for (let i = 0; i < 48; i++) out.push(stripes(Math.floor(i / 2) * 4))
  const held = out[47]
  for (let i = 48; i < 72; i++) out.push(held)
  return [...out, ...wipe(held, FRAMES - 72)]
}

const AUDIO_SOURCE: Record<Audio, string> = {
  // White noise: loud, broadband, no steady pitch (like a whoosh or an impact).
  noise: 'anoisesrc=color=white:amplitude=0.3:sample_rate=48000:duration=4',
  silence: 'anullsrc=channel_layout=stereo:sample_rate=48000',
  // A held note over quiet noise: what a music bed looks like to the meter.
  tone: 'sine=frequency=440:sample_rate=48000:duration=4,volume=0.5[s];anoisesrc=color=pink:amplitude=0.01:sample_rate=48000:duration=4[n];[s][n]amix=inputs=2:normalize=0',
}

/** Encode gray frames losslessly to an mp4 with the chosen audio. */
async function encodeClip(file: string, frames: Frame[], audio: Audio = 'silence') {
  const args = [
    '-v',
    'error',
    '-y',
    '-f',
    'rawvideo',
    '-pix_fmt',
    'gray',
    '-s',
    `${W}x${H}`,
    '-r',
    String(FPS),
    '-i',
    'pipe:0',
    '-f',
    'lavfi',
    '-i',
    AUDIO_SOURCE[audio],
    '-map',
    '0:v',
    '-map',
    '1:a',
    '-c:v',
    'libx264',
    '-qp',
    '0',
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-t',
    '4',
    file,
  ]
  await new Promise<void>((resolve, reject) => {
    const child = spawn('ffmpeg', args, { stdio: ['pipe', 'ignore', 'pipe'] })
    let stderr = ''
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()))
    child.on('error', reject)
    child.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}: ${stderr}`)),
    )
    child.stdin.end(Buffer.concat(frames))
  })
}

function writeImage(file: string, image: Frame) {
  execFileSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-y',
      '-f',
      'rawvideo',
      '-pix_fmt',
      'gray',
      '-s',
      `${W}x${H}`,
      '-i',
      'pipe:0',
    ].concat(['-frames:v', '1', file]),
    { input: Buffer.from(image) },
  )
}

/** Downscale a synthetic frame to the meter size by 2x2 averaging (close to ffmpeg's scale). */
function meterFrame(image: Frame): Frame {
  const out = new Uint8Array((W / 2) * (H / 2))
  for (let y = 0; y < H / 2; y++) {
    for (let x = 0; x < W / 2; x++) {
      const i = 2 * y * W + 2 * x
      out[y * (W / 2) + x] = Math.round(
        (image[i] + image[i + 1] + image[i + W] + image[i + W + 1]) / 4,
      )
    }
  }
  return out
}

describe('beat shape', () => {
  it('passes a hit, a still freeze and a strong cut', () => {
    const energies = [...new Array(48).fill(3), ...new Array(24).fill(0), ...new Array(23).fill(6)]
    const shape = measureBeatShape(energies, FPS)
    expect(shape.passed).toBe(true)
    expect(shape.e12).toBeCloseTo(3)
    expect(shape.e3).toBe(0)
    expect(shape.e4).toBeCloseTo(6)
  })

  it('fails even motion with no freeze', () => {
    expect(measureBeatShape(new Array(95).fill(4), FPS).passed).toBe(false)
  })

  it('fails a cut much weaker than the hit', () => {
    const energies = [...new Array(48).fill(10), ...new Array(24).fill(1), ...new Array(23).fill(4)]
    const shape = measureBeatShape(energies, FPS)
    expect(shape.cutToFreeze).toBeGreaterThan(1.3)
    expect(shape.passed).toBe(false)
  })

  it('fails a clip that never moves, without dividing by zero', () => {
    const shape = measureBeatShape(new Array(95).fill(0), FPS)
    expect(shape.passed).toBe(false)
    expect(Number.isFinite(shape.hitToFreeze)).toBe(true)
  })
})

describe('stray cut', () => {
  it('finds a hard cut inside the hit once, at the first frame of the new shot', () => {
    const frames = beatClip({ cutAtFrame: 36 }).map(meterFrame)
    const check = findStrayCuts(frames, FPS)
    expect(check.passed).toBe(false)
    expect(check.cuts).toHaveLength(1)
    expect(check.cuts[0].timeS).toBeCloseTo(36 / FPS, 3)
  })

  it('ignores repeated-frame judder, which fools a frame-to-frame meter', () => {
    const frames = judderClip().map(meterFrame)
    const consecutive = motionEnergies(frames).slice(0, 46)
    // Every other step is a repeated frame: the next-frame difference flips between 0 and a big jump.
    expect(Math.max(...consecutive.filter((_, i) => i % 2 === 0))).toBe(0)
    expect(Math.min(...consecutive.filter((_, i) => i % 2 === 1))).toBeGreaterThan(15)
    expect(findStrayCuts(frames, FPS)).toMatchObject({ cuts: [], passed: true })
  })

  it('ignores cuts outside 0.15-2.9 s (the cut beat is meant to move fast)', () => {
    const frames = beatClip().map(meterFrame)
    // A hard cut at 3.5 s, inside the cut beat.
    const cutAway = frames.map((image, i) => (i >= 84 ? meterFrame(target) : image))
    expect(findStrayCuts(cutAway, FPS).passed).toBe(true)
  })
})

/** Tiny frames of one gray level each: the meters see |a - b| between two of them. */
const levels = (values: number[]): Frame[] => values.map((value) => new Uint8Array(16).fill(value))

/** A still 96-frame clip at gray 100 with a 1-step flicker, and `steps` added from `at` on. */
function stepClip(at: number, steps: number[]): Frame[] {
  const values = Array.from({ length: FRAMES }, (_, i) => 100 + (i % 2))
  let level = 0
  for (let i = at; i < FRAMES; i++) {
    level += steps[i - at] ?? 0
    values[i] += level
  }
  return levels(values)
}

describe('stray cut, one condition at a time', () => {
  it('ignores fast motion settling into the freeze: no single step carries the jump', () => {
    // Steps of 2, 11, 11 and 2: frames two apart differ by 22, but each step is half of it.
    const settle = findStrayCuts(stepClip(40, [2, 11, 11, 2]), FPS)
    expect(settle).toMatchObject({ cuts: [], passed: true })
    // The same 22 in one step is a cut.
    expect(findStrayCuts(stepClip(40, [0, 22]), FPS).cuts).toHaveLength(1)
  })

  it('needs the jump to be over 15', () => {
    expect(findStrayCuts(stepClip(40, [14]), FPS).passed).toBe(true)
    expect(findStrayCuts(stepClip(40, [17]), FPS).passed).toBe(false)
  })

  it('needs the jump to be over 4x the clip median', () => {
    // Motion of 5 per frame all through: frames two apart differ by 10, so 30 is not a spike.
    const busy = Array.from({ length: FRAMES }, (_, i) => 5 * i)
    busy.forEach((_, i) => i >= 40 && (busy[i] += 20))
    expect(findStrayCuts(levels(busy.map((v) => v % 256)).slice(0, 50), FPS).passed).toBe(true)
  })

  it('needs both neighbouring differences to be much smaller', () => {
    // A jump of 20, then steady motion of 10 per frame: the right neighbour (20) is too close.
    const values = Array.from({ length: FRAMES }, (_, i) => 100 + (i % 2))
    for (let i = 40; i < FRAMES; i++) values[i] = Math.min(255, 120 + 10 * (i - 40))
    expect(findStrayCuts(levels(values), FPS).passed).toBe(true)
  })
})

describe('late arrival', () => {
  it('fails a clip that reaches its keyframe by 1.5 s and then holds (the 25% rule)', () => {
    // Gray 0 to 100 over the first 36 frames, then still: within 25 of 100 from frame 27.
    const morph = levels(
      Array.from({ length: FRAMES }, (_, i) => Math.round(100 * Math.min(1, i / 36))),
    )
    const check = measureLateArrival(morph, FPS)
    expect(check.passed).toBe(false)
    expect(check.arrivalS).toBeCloseTo(27 / FPS, 3)
    expect(check.startDistance).toBe(100)
  })

  it('passes a clip that only gets within 25% in the cut beat', () => {
    const late = levels(
      Array.from({ length: FRAMES }, (_, i) => (i < 72 ? 0 : Math.round((100 * (i - 71)) / 24))),
    )
    expect(measureLateArrival(late, FPS)).toMatchObject({ passed: true })
    expect(measureLateArrival(late, FPS).arrivalS).toBeGreaterThanOrEqual(2.9)
  })
})

describe('music bed meter (port of the skill screen)', () => {
  const seconds = 4
  const count = TONAL_SAMPLE_RATE * seconds
  // Deterministic noise so the test never flakes.
  function noise(amplitude: number): Float32Array {
    let seed = 12_345
    return Float32Array.from({ length: count }, () => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648
      return amplitude * (seed / 1_073_741_824 - 1)
    })
  }

  it('measures a held note as a sustained tonal line', () => {
    const quiet = noise(0.01)
    const tone = quiet.map(
      (v, i) => v + 0.5 * Math.sin((2 * Math.PI * 440 * i) / TONAL_SAMPLE_RATE),
    )
    expect(measureTonalSeconds(tone)).toBeGreaterThan(3.5)
  })

  it('finds no tonal line in noise or silence', () => {
    expect(measureTonalSeconds(noise(0.3))).toBe(0)
    expect(measureTonalSeconds(new Float32Array(count))).toBe(0)
  })

  it('needs half a second: a short beep is not a bed', () => {
    const quiet = noise(0.01)
    const beep = quiet.map((v, i) =>
      i < 0.3 * TONAL_SAMPLE_RATE
        ? v + 0.5 * Math.sin((2 * Math.PI * 1000 * i) / TONAL_SAMPLE_RATE)
        : v,
    )
    expect(measureTonalSeconds(beep)).toBe(0)
  })

  it('returns 0 for audio shorter than one window', () => {
    expect(measureTonalSeconds(new Float32Array(100))).toBe(0)
  })

  it('gives the seconds the Python screen gives on a fixed mix of lines, a glide, a beep and a hum', () => {
    // The skill's Python screen on the same samples (generated the same way): 2.8 s.
    let seed = 12_345
    const mix = Float32Array.from({ length: count }, (_, i) => {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0
      const t = i / TONAL_SAMPLE_RATE
      const sine = (hz: number, from: number, to: number) =>
        t >= from && t < to ? 0.3 * Math.sin(2 * Math.PI * hz * t) : 0
      const g = t - 1.2
      const glide = t >= 1.2 && t < 2.2 ? 0.3 * Math.sin(2 * Math.PI * (500 * g + 30 * g * g)) : 0
      return (
        (seed / 4_294_967_296 - 0.5) * 0.2 +
        glide +
        sine(4000, 0.2, 0.9) +
        sine(2000, 2.5, 3.4) +
        sine(1000, 3.5, 3.8) +
        sine(60, 0, seconds)
      )
    })
    expect(measureTonalSeconds(mix)).toBeCloseTo(2.8, 3)
  })
})

describe('createFft', () => {
  it('matches a plain DFT on a 2048-sample frame', () => {
    const n = 2048
    let seed = 7
    const input = Float64Array.from({ length: n }, (_, i) => {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0
      return seed / 4_294_967_296 - 0.5 + Math.sin((2 * Math.PI * 37.3 * i) / n)
    })
    const re = Float64Array.from(input)
    const im = new Float64Array(n)
    createFft(n)(re, im)
    for (const k of [0, 1, 37, 38, 511, 1024, 1500, 2047]) {
      let sumRe = 0
      let sumIm = 0
      for (let i = 0; i < n; i++) {
        sumRe += input[i] * Math.cos((2 * Math.PI * k * i) / n)
        sumIm -= input[i] * Math.sin((2 * Math.PI * k * i) / n)
      }
      expect(re[k]).toBeCloseTo(sumRe, 6)
      expect(im[k]).toBeCloseTo(sumIm, 6)
    }
  })
})

describe('failure text and take ranking', () => {
  const base: BeatLoopClipQa = {
    anchor: { passed: true, ssim: 0.9 },
    beatShape: {
      cutToFreeze: 5,
      cutToHit: 2,
      e12: 3,
      e3: 0.5,
      e4: 6,
      hitToFreeze: 6,
      passed: true,
    },
    durationS: 4,
    failed: [],
    fps: 24,
    frameCount: 96,
    joint: { passed: true, ssim: 0.92 },
    lateArrival: { arrivalS: 3.6, passed: true, startDistance: 40 },
    musicBed: { audioS: 4, passed: true, tonalS: 0 },
    passed: true,
    seam: null,
    strayCut: { cuts: [], median: 2, passed: true },
    text: null,
  }

  it('describes each failed check in plain words', () => {
    const failing: BeatLoopClipQa = {
      ...base,
      anchor: { passed: false, ssim: 0.55 },
      failed: ['strayCut', 'musicBed', 'anchor', 'text'],
      musicBed: { audioS: 4, passed: false, tonalS: 2.2 },
      passed: false,
      strayCut: { cuts: [{ timeS: 1.9, value: 40 }], median: 2, passed: false },
      text: { detail: 'a date on a sign', frames: 18, passed: false },
    }
    expect(describeBeatLoopQaFailures(failing)).toEqual([
      'A hard cut at 1.9 s.',
      'Music under the sound effects (2.2 s of steady tones).',
      'It lands on the wrong final frame (55% match, needs 70%).',
      'Letters or numbers on screen: a date on a sign.',
    ])
    expect(describeBeatLoopQaFailures(base)).toEqual([])
  })

  it('keeps the take with fewer failed checks, then the closer landing', () => {
    const oneFail = { ...base, failed: ['musicBed' as const], passed: false }
    const twoFails = { ...base, failed: ['musicBed' as const, 'text' as const], passed: false }
    const closer = { ...oneFail, anchor: { passed: true, ssim: 0.95 } }
    expect([twoFails, oneFail].sort(compareBeatLoopTakes)[0]).toBe(oneFail)
    expect([oneFail, closer].sort(compareBeatLoopTakes)[0]).toBe(closer)
  })
})

// CI installs FFmpeg, so there a missing one fails these tests instead of skipping them.
const describeWithFfmpeg = hasFfmpeg() || process.env['CI'] ? describe : describe.skip

describeWithFfmpeg('measureBeatLoopClip on synthetic clips', () => {
  jest.setTimeout(60_000)
  let dir: string
  let start: string
  let landing: string
  let elsewhere: string

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'beat-loop-qa-'))
    start = path.join(dir, 'start.png')
    landing = path.join(dir, 'f1.png')
    elsewhere = path.join(dir, 'other.png')
    writeImage(start, squareAt(10))
    writeImage(landing, target)
    writeImage(elsewhere, stripes(0))
  })

  afterAll(() => fs.rmSync(dir, { force: true, recursive: true }))

  it('passes a clip that follows the beat and lands on its keyframe', async () => {
    const clip = path.join(dir, 'beat.mp4')
    await encodeClip(clip, beatClip(), 'noise')
    const qa = await measureBeatLoopClip({
      clipPath: clip,
      startFramePath: start,
      targetFramePath: landing,
    })
    expect(qa.failed).toEqual([])
    expect(qa.passed).toBe(true)
    expect(qa.frameCount).toBe(96)
    expect(qa.durationS).toBeCloseTo(4, 3)
    expect(qa.lateArrival.arrivalS).toBeGreaterThanOrEqual(2.9)
    expect(qa.musicBed.tonalS).toBe(0)
    expect(qa.joint?.ssim).toBeGreaterThan(0.95)
    expect(qa.anchor?.ssim).toBeGreaterThan(0.95)
    expect(qa.seam).toBeNull()
    expect(qa.text).toBeNull()
  })

  it('matches the YAVG of ffmpeg tblend=difference + signalstats (the skill method)', async () => {
    const clip = path.join(dir, 'parity.mp4')
    await encodeClip(clip, beatClip())
    const yavg = execFileSync(
      'ffmpeg',
      [
        '-v',
        'error',
        '-i',
        clip,
        '-vf',
        'scale=72:128,format=gray,tblend=all_mode=difference,signalstats,metadata=mode=print:key=lavfi.signalstats.YAVG:file=-',
        '-f',
        'null',
        '-',
      ],
      { encoding: 'utf8' },
    )
      .split('\n')
      .filter((line) => line.startsWith('lavfi.signalstats.YAVG='))
      .map((line) => Number(line.split('=')[1]))
    const qa = await measureBeatLoopClip({ clipPath: clip })
    const expected = {
      e12: mean(yavg.slice(0, 48)),
      e3: mean(yavg.slice(48, 72)),
      e4: mean(yavg.slice(72)),
    }
    expect(qa.beatShape.e12).toBeCloseTo(expected.e12, 2)
    expect(qa.beatShape.e3).toBeCloseTo(expected.e3, 2)
    expect(qa.beatShape.e4).toBeCloseTo(expected.e4, 2)
  })

  it('fails a static clip on beat shape and arrival', async () => {
    const clip = path.join(dir, 'static.mp4')
    const still = squareAt(10)
    await encodeClip(
      clip,
      Array.from({ length: FRAMES }, () => still),
    )
    const qa = await measureBeatLoopClip({ clipPath: clip })
    expect(qa.failed).toEqual(['beatShape', 'lateArrival'])
    expect(qa.lateArrival.arrivalS).toBe(0)
    expect(qa.strayCut.passed).toBe(true)
    expect(qa.musicBed.tonalS).toBe(0)
  })

  it('flags a hard cut in the hit', async () => {
    const clip = path.join(dir, 'cut.mp4')
    await encodeClip(clip, beatClip({ cutAtFrame: 36 }))
    const qa = await measureBeatLoopClip({ clipPath: clip, targetFramePath: landing })
    expect(qa.failed).toEqual(['strayCut'])
    expect(qa.strayCut.cuts).toHaveLength(1)
    expect(qa.strayCut.cuts[0].timeS).toBeCloseTo(1.5, 2)
  })

  it('does not flag repeated-frame judder as a cut', async () => {
    const clip = path.join(dir, 'judder.mp4')
    await encodeClip(clip, judderClip())
    const qa = await measureBeatLoopClip({ clipPath: clip })
    expect(qa.strayCut).toMatchObject({ cuts: [], passed: true })
  })

  it('flags a music bed under the clip', async () => {
    const clip = path.join(dir, 'tone.mp4')
    await encodeClip(clip, beatClip(), 'tone')
    const qa = await measureBeatLoopClip({ clipPath: clip })
    expect(qa.musicBed.passed).toBe(false)
    expect(qa.musicBed.tonalS).toBeGreaterThan(3)
    expect(qa.musicBed.audioS).toBeCloseTo(4, 1)
    expect(qa.failed).toEqual(['musicBed'])
  })

  it('checks the joint, the landing and the loop seam against the given frames', async () => {
    const clip = path.join(dir, 'anchors.mp4')
    await encodeClip(clip, beatClip())
    const qa = await measureBeatLoopClip({
      clipPath: clip,
      // Wrong start and wrong landing; the seam closes on the frame the clip ends on.
      loopFirstFramePath: landing,
      startFramePath: elsewhere,
      targetFramePath: elsewhere,
    })
    expect(qa.joint?.passed).toBe(false)
    expect(qa.anchor?.passed).toBe(false)
    expect(qa.anchor?.ssim).toBeLessThan(ANCHOR_MIN_SSIM)
    expect(qa.seam).toMatchObject({ passed: true })
    expect(qa.failed).toEqual(['joint', 'anchor'])

    const open = await measureBeatLoopClip({ clipPath: clip, loopFirstFramePath: start })
    expect(open.failed).toEqual(['seam'])
  })

  it('hands a frame every 0.22 s and a strip to the text checker', async () => {
    const clip = path.join(dir, 'text.mp4')
    await encodeClip(clip, beatClip())
    const workDir = path.join(dir, 'kept')
    let seen: BeatLoopTextCheckInput | undefined
    const qa = await measureBeatLoopClip({
      clipPath: clip,
      textChecker: async (input) => {
        seen = input
        expect(input.frames.every((f) => fs.existsSync(f.path))).toBe(true)
        expect(fs.existsSync(input.stripPath)).toBe(true)
        return { detail: 'a number in the corner', hasText: true }
      },
      workDir,
    })
    expect(seen?.clipPath).toBe(clip)
    expect(seen?.frames.length).toBeGreaterThanOrEqual(18)
    expect(seen?.frames[1].timeS).toBeCloseTo(0.22, 2)
    expect(qa.text).toEqual({
      detail: 'a number in the corner',
      frames: seen?.frames.length,
      passed: false,
    })
    expect(qa.failed).toEqual(['text'])
    // A kept workDir keeps the frames and the strip for a person to look at.
    expect(fs.existsSync(qa.files?.stripPath ?? '')).toBe(true)
    expect(fs.existsSync(qa.files?.lastFramePath ?? '')).toBe(true)
    expect(fs.existsSync(qa.files?.firstFramePath ?? '')).toBe(true)
  })

  it('does not fail the clip when the text checker itself errors', async () => {
    const clip = path.join(dir, 'text-error.mp4')
    await encodeClip(clip, beatClip())
    const qa = await measureBeatLoopClip({
      clipPath: clip,
      textChecker: async () => {
        throw new Error('vision model unavailable')
      },
    })
    expect(qa.text).toMatchObject({ error: 'vision model unavailable', passed: true })
    expect(qa.failed).toEqual([])
    expect(qa.files).toBeUndefined()
  })
})

describe('beat grid', () => {
  it('ends the hit, the freeze and the 2.9 s screens where the beat grid says', () => {
    jest.isolateModules(() => {
      // A grid with its beats moved: hit to 1 s, freeze to 2 s, the cut allowed 0.2 s early.
      jest.doMock('./beat-loop-timing', () => ({
        ...jest.requireActual('./beat-loop-timing'),
        BEAT_CUT_LEAD_SECONDS: 0.2,
        BEAT_HIT_END_SECONDS: 1,
        BEAT_HOLD_SECONDS: 2,
      }))
      const moved = jest.requireActual<typeof import('./beat-loop-qa')>('./beat-loop-qa')
      expect(moved.ARRIVAL_MIN_S).toBe(1.8)
      expect(moved.STRAY_CUT_TO_S).toBe(1.8)
      // Hit 0-1 s, freeze 1-2 s, cut 2 s to the end: a beat shape only on the moved grid.
      const energies = [
        ...new Array(24).fill(3),
        ...new Array(24).fill(0),
        ...new Array(47).fill(6),
      ]
      expect(moved.measureBeatShape(energies, FPS)).toMatchObject({ e3: 0, passed: true })
      expect(measureBeatShape(energies, FPS).passed).toBe(false)
    })
    jest.dontMock('./beat-loop-timing')
  })

  it('keeps the skill grid: 2 s of hit, freeze to 3 s, nothing settles before 2.9 s', async () => {
    const qa = await import('./beat-loop-qa')
    expect([qa.ARRIVAL_MIN_S, qa.STRAY_CUT_TO_S]).toEqual([2.9, 2.9])
  })
})

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length
}
