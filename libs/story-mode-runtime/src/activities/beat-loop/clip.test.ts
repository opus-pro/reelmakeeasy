import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { BeatLoopClipQa, BeatLoopClipQaInput } from '@reelmakeeasy/common/long-take/beat-loop-qa'
import {
  currentGenerationProvider,
  resetGenerationProviderForTesting,
  setGenerationProvider,
} from '@reelmakeeasy/llm/registry'
import { ApplicationFailure } from '@reelmakeeasy/workflow-engine/activity'
import type { BeatLoopStoryboard } from '@shared/types/api/agent'

// The clip activity with the transition step and the meters faked: what it asks for, where it
// falls back, and what it saves. The transition step itself is tested in transition-beat-loop.
let root = ''
const files = new Map<string, unknown>()
jest.mock('../long-take/storage', () => ({
  ...jest.requireActual('../long-take/storage'),
  createLongTakeStorage: () => ({
    getFullPath: (relative: string) => path.join(root, relative),
    readJsonFile: async (relative: string) => {
      if (!files.has(relative)) throw new Error('No such object')
      return structuredClone(files.get(relative))
    },
    uploadFile: async (local: string, relative: string) => {
      fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true })
      fs.copyFileSync(local, path.join(root, relative))
      return relative
    },
    writeJsonFile: async (relative: string, data: unknown) => {
      files.set(relative, structuredClone(data))
      return relative
    },
  }),
}))
jest.mock('../long-take/common', () => ({
  ...jest.requireActual('../long-take/common'),
  withActivityHeartbeat: (fn: () => unknown) => fn(),
  withLongTakeContext: (_context: unknown, fn: () => unknown) => fn(),
}))
type TransitionCall = Record<string, unknown> & { outputName: string; transitionId: string }
const transition = jest.fn()
jest.mock('../long-take/transitions', () => ({
  generateLongTakeTransitionVideo: (params: TransitionCall) => transition(params),
}))
const measure = jest.fn()
jest.mock('@reelmakeeasy/common/long-take/beat-loop-qa', () => ({
  ...jest.requireActual('@reelmakeeasy/common/long-take/beat-loop-qa'),
  measureBeatLoopClip: (input: BeatLoopClipQaInput) => measure(input),
}))
jest.mock('./text-check', () => ({
  checkBeatLoopClipText: async () => ({ hasText: false }),
}))

import { renderBeatLoopClip } from './clip'
import { BEAT_LOOP_REROLL, type BeatLoopPaidClip, markVideoCallFailure } from './clip-video'
import { BEAT_LOOP_QA_PATH, type BeatLoopQaFile, type BeatLoopTake } from './qa-store'

const STYLE =
  'Editorial explainer collage: textured off-white newsprint paper background, halftone cutouts.'

const storyboard: BeatLoopStoryboard = {
  accent: '#FFE500',
  caption_style: 'explainer',
  clips: Array.from({ length: 4 }, (_, i) => ({
    caption: null,
    cut: 'The camera dives into the next cutout.',
    cut_camera: 'Zoom in' as const,
    freeze: 'The cutouts freeze on the page.',
    hit: 'The cutouts slam into place.',
    hit_camera: 'Push in' as const,
    id: `s${i + 1}`,
    narration: 'Cleopatra lived closer to the Moon landing than the pyramids.',
    stamp: null,
  })),
  duration_s: 16,
  keyframes: [
    ...Array.from({ length: 4 }, (_, i) => ({ id: `f${i}`, prompt: `Shot ${i}` })),
    { id: 'f4', same_as: 'f0' },
  ],
  sources: 'A source',
  title: 'Loop',
}

/** A still 144x252 clip (the clip's shape) and keyframe PNGs at 160x288 (a 9:16 keyframe). */
function makeClip(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    'testsrc2=size=144x252:rate=24:duration=4',
    '-c:v',
    'libx264',
    '-pix_fmt',
    'yuv420p',
    file,
  ])
}

function makeFrame(file: string, size: string): void {
  execFileSync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-f',
    'lavfi',
    '-i',
    `testsrc2=size=${size}`,
    '-frames:v',
    '1',
    file,
  ])
}

function qaResult(fields: Partial<BeatLoopClipQa> = {}): BeatLoopClipQa {
  return {
    anchor: { passed: true, ssim: 0.81 },
    beatShape: {
      cutToFreeze: 5,
      cutToHit: 2,
      e12: 3,
      e3: 1,
      e4: 6,
      hitToFreeze: 3,
      passed: true,
    },
    durationS: 4,
    failed: [],
    fps: 24,
    frameCount: 96,
    joint: { passed: true, ssim: 0.9 },
    lateArrival: { arrivalS: 3.5, passed: true, startDistance: 40 },
    musicBed: { audioS: 4, passed: true, tonalS: 0 },
    passed: true,
    seam: null,
    strayCut: { cuts: [], median: 2, passed: true },
    text: { frames: 18, passed: true },
    ...fields,
  }
}

function size(file: string): string {
  return execFileSync('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'stream=width,height',
    '-of',
    'csv=p=0:s=x',
    file,
  ])
    .toString()
    .trim()
}

let frames: { f0: string; f1: string; f4: string }
const seen: { params: TransitionCall; provider: string }[] = []

beforeAll(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'beat-loop-clip-'))
  const dir = path.join(root, 'keyframes')
  fs.mkdirSync(dir)
  frames = {
    f0: path.join(dir, 'f0.png'),
    f1: path.join(dir, 'f1.png'),
    f4: path.join(dir, 'f4.png'),
  }
  for (const file of Object.values(frames)) makeFrame(file, '160x288')
})
afterAll(() => fs.rmSync(root, { force: true, recursive: true }))

const env = { ...process.env }
beforeEach(() => {
  files.clear()
  seen.length = 0
  resetGenerationProviderForTesting()
  process.env = { ...env, FAL_KEY: 'test-fal', GEMINI_API_KEY: 'test-gemini' }
  transition.mockReset()
  transition.mockImplementation(async (params: TransitionCall) => {
    seen.push({ params, provider: currentGenerationProvider() })
    // The provider delivers (unless the take already paid for its clip): reported at once.
    if (!params['beatLoopPaidClip']) {
      const onPaid = params['onBeatLoopClipPaid'] as (paid: BeatLoopPaidClip) => Promise<void>
      await onPaid({
        model: params['transitionVideoModel'] as string,
        uri: path.join(root, 'long_take/transitions', `${params.outputName}_paid.mp4`),
      })
    }
    const videoUri = path.join(root, 'long_take/transitions', `${params.outputName}.mp4`)
    makeClip(videoUri)
    return {
      beatLoop: {
        audio: { status: 'levelled' },
        beatLock: { frames: 96, multiplier: 1.458, retimed: true, sourceDurationS: 4.458 },
      },
      endMs: params['endMs'],
      fromShotId: params['fromShotId'],
      lastFrameUri: path.join(root, 'long_take/transitions', `${params.outputName}_last.png`),
      prompt: params['preparedPrompt'],
      qualityCheck: { hasGibberish: false, severity: 'none' },
      startMs: params['startMs'],
      toShotId: params['toShotId'],
      transitionId: params.transitionId,
      transitionVideoModel: params['transitionVideoModel'],
      videoHeight: 252,
      videoUri,
      videoWidth: 144,
    }
  })
  measure.mockReset()
  measure.mockResolvedValue(qaResult())
})
afterEach(() => {
  process.env = env
  resetGenerationProviderForTesting()
})

const clipParams = (clipIndex: number, fields: Record<string, unknown> = {}) => ({
  clipIndex,
  firstFrameUri: frames.f0,
  projectId: 'p1',
  storyboard,
  style: STYLE,
  targetFrameUri: frames.f1,
  userId: 'u1',
  ...fields,
})

describe('renderBeatLoopClip', () => {
  it('makes clip 1 on fal with H3, the skill template as written, 4 s from f0 to f1', async () => {
    const take = await renderBeatLoopClip(clipParams(0))

    expect(seen).toHaveLength(1)
    expect(seen[0].provider).toBe('fal')
    const prompt = seen[0].params['preparedPrompt'] as string
    expect(
      prompt.startsWith('A 4-second vertical short-form clip filmed as ONE continuous shot'),
    ).toBe(true)
    expect(prompt).toContain('0.0s-2.0s [Push in]: The cutouts slam into place.')
    expect(prompt.endsWith('non_diegetic_music: N/A')).toBe(true)
    expect(seen[0].params).toMatchObject({
      aspectRatio: '9:16',
      beatLoop: true,
      captureLastFrame: true,
      durationSeconds: 4,
      endMs: 4000,
      firstFrameUri: frames.f0,
      fromShotId: 'f0',
      lastFrameUri: frames.f1,
      outputName: 's1',
      startMs: 0,
      toShotId: 'f1',
      transitionId: 's1',
      transitionVideoModel: 'minimax-h3-max-turbo',
    })

    expect(take).toMatchObject({
      clipId: 's1',
      failed: [],
      model: 'minimax-h3-max-turbo',
      passed: true,
      provider: 'fal',
      spend: { estimatedUsd: 0.16, requestedSeconds: 4 },
      take: 1,
    })
    expect(take.beatLoop?.beatLock.frames).toBe(96)
    expect(take.transition?.videoUri).toContain('s1.mp4')
  })

  /** Records what the meters were given (the temporary frames are gone afterwards). */
  function recordMeterInput(): { input?: BeatLoopClipQaInput; sizes: Record<string, string> } {
    const seenByMeter: { input?: BeatLoopClipQaInput; sizes: Record<string, string> } = {
      sizes: {},
    }
    measure.mockImplementation(async (input: BeatLoopClipQaInput) => {
      seenByMeter.input = input
      for (const key of ['startFramePath', 'targetFramePath', 'loopFirstFramePath'] as const) {
        if (input[key]) seenByMeter.sizes[key] = size(input[key] as string)
      }
      fs.mkdirSync(input.workDir as string, { recursive: true })
      const firstFramePath = path.join(input.workDir as string, 'first.png')
      makeFrame(firstFramePath, '144x252')
      return { ...qaResult(), files: { firstFramePath, lastFramePath: '', stripPath: null } }
    })
    return seenByMeter
  }

  it('measures the clip against its frames cut to the clip shape, and keeps clip 1 first frame', async () => {
    const meter = recordMeterInput()
    const take = await renderBeatLoopClip(clipParams(0))
    expect(measure).toHaveBeenCalledTimes(1)
    expect(meter.sizes).toEqual({ startFramePath: '144x252', targetFramePath: '144x252' })
    expect(meter.input?.textChecker).toBeDefined()
    expect(take.firstFrameUri).toBe(path.join(root, 'long_take/transitions/s1_first.png'))
    expect(fs.existsSync(take.firstFrameUri as string)).toBe(true)
    expect(take.qa).not.toHaveProperty('files')
  })

  it('checks the loop seam on the last clip, against the loop frame it is given', async () => {
    const meter = recordMeterInput()
    const take = await renderBeatLoopClip(
      clipParams(3, {
        firstFrameUri: frames.f1,
        loopFirstFrameUri: frames.f0,
        take: 2,
        targetFrameUri: frames.f4,
      }),
    )
    expect(meter.sizes['loopFirstFramePath']).toBe('144x252')
    // Only clip 1 keeps its first frame.
    expect(take.firstFrameUri).toBeUndefined()
    expect(seen[0].params).toMatchObject({
      endMs: 16000,
      fromShotId: 'f3',
      outputName: 's4_take2',
      startMs: 12000,
      toShotId: 'f0',
    })
  })

  it("speaks Omni's dialect when Google makes the videos, without newsprint", async () => {
    setGenerationProvider('google')
    const take = await renderBeatLoopClip(clipParams(0))
    expect(seen[0].provider).toBe('google')
    const prompt = seen[0].params['preparedPrompt'] as string
    expect(prompt.startsWith('[# Sources <FIRST_FRAME>@Image1 <LAST_FRAME>@Image2]')).toBe(true)
    expect(prompt).not.toMatch(/newsprint/i)
    expect(prompt.endsWith('non_diegetic_music: N/A')).toBe(true)
    expect(take).toMatchObject({ model: 'omni-flash-google', provider: 'google' })
    // The registry's rate, unrounded: 4 s at $0.104.
    expect(take.spend.estimatedUsd).toBeCloseTo(0.416, 6)
    expect(take.spend.usdPerSecond).toBe(0.104)
  })

  it('falls back to Omni, pinned to Google, when the H3 call fails and a Gemini key is set', async () => {
    transition.mockRejectedValueOnce(
      markVideoCallFailure(new Error('fal minimax failed: overloaded')),
    )
    const take = await renderBeatLoopClip(clipParams(0))
    expect(seen.map((s) => [s.provider, s.params['transitionVideoModel']])).toEqual([
      ['google', 'omni-flash-google'],
    ])
    expect(take.model).toBe('omni-flash-google')
    expect(take.attempts).toEqual([
      { error: 'fal minimax failed: overloaded', model: 'minimax-h3-max-turbo' },
    ])
  })

  it('has no fallback without a Gemini key: the error goes to the workflow', async () => {
    delete process.env['GEMINI_API_KEY']
    transition.mockRejectedValue(markVideoCallFailure(new Error('fal minimax failed: overloaded')))
    await expect(renderBeatLoopClip(clipParams(0))).rejects.toThrow('overloaded')
    expect(transition).toHaveBeenCalledTimes(1)
  })

  it('records a take the beat-lock refused as failed, with its spend and no clip', async () => {
    transition.mockRejectedValueOnce(
      ApplicationFailure.create({
        message: 'Clip s1 came back 6.00 s long',
        nonRetryable: true,
        type: BEAT_LOOP_REROLL,
      }),
    )
    const take = await renderBeatLoopClip(clipParams(0))
    expect(take).toMatchObject({
      failed: ['beatLock'],
      passed: false,
      qa: null,
      spend: { estimatedUsd: 0.16 },
      transition: null,
    })
    expect(take.failures[0]).toMatch(/6\.00 s/)
    expect(measure).not.toHaveBeenCalled()
    expect(transition).toHaveBeenCalledTimes(1)
  })

  it('saves every take with its readings to long_take/beat_loop_qa.json', async () => {
    measure.mockResolvedValueOnce(
      qaResult({
        anchor: { passed: false, ssim: 0.6 },
        failed: ['anchor'],
        passed: false,
      }),
    )
    const first = await renderBeatLoopClip(clipParams(0))
    expect(first).toMatchObject({ failed: ['anchor'], passed: false })
    expect(first.failures[0]).toMatch(/wrong final frame \(60% match/)
    await renderBeatLoopClip(clipParams(0, { take: 2 }))
    const file = files.get(BEAT_LOOP_QA_PATH) as BeatLoopQaFile
    expect(file.clips[0].takes.map((t) => [t.take, t.passed])).toEqual([
      [1, false],
      [2, true],
    ])
    expect(file.spend).toMatchObject({ estimatedUsd: 0.32, takes: 2 })
  })

  it("records the take's generation, start frame, target frame and prompt", async () => {
    const take = await renderBeatLoopClip(clipParams(0, { generation: 3, take: 4 }))
    expect(take).toMatchObject({
      generation: 3,
      startFrameUri: frames.f0,
      take: 4,
      targetFrameUri: frames.f1,
    })
    expect(take.prompt).toBe(seen[0].params['preparedPrompt'])
    expect(seen[0].params.outputName).toBe('s1_take4')
  })

  it('stays on its model when something fails before the video call (no fallback)', async () => {
    transition.mockRejectedValueOnce(new Error('could not download the first frame'))
    await expect(renderBeatLoopClip(clipParams(0))).rejects.toThrow('first frame')
    expect(transition).toHaveBeenCalledTimes(1)
    expect(files.has(BEAT_LOOP_QA_PATH)).toBe(false)
  })

  it('never pays for another clip when a delivered one fails to finish: the take stays unfinished, with its spend', async () => {
    transition.mockImplementationOnce(async (params: TransitionCall) => {
      const onPaid = params['onBeatLoopClipPaid'] as (paid: BeatLoopPaidClip) => Promise<void>
      await onPaid({ model: 'minimax-h3-max-turbo', uri: '/stored/s1_paid.mp4' })
      throw new Error('ffmpeg crashed while beat-locking')
    })
    await expect(renderBeatLoopClip(clipParams(0))).rejects.toThrow('ffmpeg crashed')
    // Not Omni: only a failed video call goes to another model.
    expect(transition).toHaveBeenCalledTimes(1)
    const file = files.get(BEAT_LOOP_QA_PATH) as BeatLoopQaFile
    expect(file.clips[0].takes).toEqual([
      expect.objectContaining({
        failed: ['unfinished'],
        model: 'minimax-h3-max-turbo',
        paidClipUri: '/stored/s1_paid.mp4',
        take: 1,
        transition: null,
      }),
    ])
    expect(file.clips[0].takes[0].failures[0]).toMatch(/ffmpeg crashed/)
    expect(file.spend).toMatchObject({ estimatedUsd: 0.16, takes: 1 })
  })

  it('a meter that fails after a paid clip fails the activity instead of asking for a re-roll', async () => {
    measure.mockRejectedValueOnce(new Error('ffprobe: no such file'))
    await expect(renderBeatLoopClip(clipParams(0))).rejects.toThrow('ffprobe')
    const file = files.get(BEAT_LOOP_QA_PATH) as BeatLoopQaFile
    expect(file.clips[0].takes[0]).toMatchObject({ failed: ['unfinished'], take: 1 })
    expect(transition).toHaveBeenCalledTimes(1)
  })

  it('the retry finishes the stored paid clip on the model that made it, without paying again', async () => {
    // Setup picks fal, but take 1 was paid for on Omni and left unfinished.
    const earlier = {
      attempts: [{ error: 'fal minimax failed: busy', model: 'minimax-h3-max-turbo' }],
      clipId: 's1',
      clipIndex: 0,
      createdAt: '2026-10-11T10:00:00.000Z',
      failed: ['unfinished'],
      failures: ['The clip was made but could not be finished: upload timed out.'],
      generation: 1,
      model: 'omni-flash-google',
      paidClipUri: '/stored/s1_paid.mp4',
      passed: false,
      prompt: 'the Omni prompt sent',
      provider: 'google',
      qa: null,
      spend: {
        estimatedUsd: 0.416,
        model: 'omni-flash-google',
        provider: 'google',
        requestedSeconds: 4,
        usdPerSecond: 0.104,
      },
      startFrameUri: frames.f0,
      take: 1,
      transition: null,
    } satisfies BeatLoopTake
    files.set(BEAT_LOOP_QA_PATH, {
      clips: [{ clipId: 's1', clipIndex: 0, takes: [earlier] }],
      spend: { estimatedUsd: 0.42, takes: 1 },
      updatedAt: '',
      version: 1,
    })

    const take = await renderBeatLoopClip(clipParams(0, { take: 1 }))

    expect(transition).toHaveBeenCalledTimes(1)
    expect(seen[0].provider).toBe('google')
    expect(seen[0].params).toMatchObject({
      beatLoopPaidClip: { model: 'omni-flash-google', uri: '/stored/s1_paid.mp4' },
      preparedPrompt: 'the Omni prompt sent',
      transitionVideoModel: 'omni-flash-google',
    })
    expect(take).toMatchObject({
      attempts: earlier.attempts,
      createdAt: earlier.createdAt,
      model: 'omni-flash-google',
      passed: true,
      spend: { estimatedUsd: 0.416 },
    })
    const file = files.get(BEAT_LOOP_QA_PATH) as BeatLoopQaFile
    expect(file.spend).toMatchObject({ estimatedUsd: 0.42, takes: 1 })
  })

  it('returns a take already finished as it is (an activity retried after saving it)', async () => {
    const first = await renderBeatLoopClip(clipParams(0))
    transition.mockClear()
    await expect(renderBeatLoopClip(clipParams(0))).resolves.toEqual(first)
    expect(transition).not.toHaveBeenCalled()
  })

  it('fails without retrying, naming the hit to soften, when every model refuses the prompt', async () => {
    const blocked = Object.assign(new Error('content policy'), { providerCode: 'policy_blocked' })
    transition.mockRejectedValue(markVideoCallFailure(blocked))
    const error = await renderBeatLoopClip(clipParams(1)).catch((e: unknown) => e)
    expect(error).toMatchObject({ nonRetryable: true, type: 'BeatLoopSafetyBlock' })
    expect((error as Error).message).toMatch(/s2/)
    expect((error as Error).message).toMatch(/slam/)
  })
})
