// The loop workflow on the real in-process engine, with every paid activity faked: the
// voiceover, the keyframes and the clips. The QA record is the real one (in memory), so the
// re-roll policy and the resume read the same file the clip activity writes.
import type { BeatLoopClipQa, BeatLoopQaCheck } from '@reelmakeeasy/common/long-take/beat-loop-qa'
import { STORY_MODE_ADMISSION_START_SIGNAL } from '@reelmakeeasy/common/long-take/story-mode-routing-constants'
import { ApplicationFailure } from '@reelmakeeasy/workflow-engine/activity'
import { Client } from '@reelmakeeasy/workflow-engine/client'
import { configureEngine, registerWorker } from '@reelmakeeasy/workflow-engine/worker'
import type { BeatLoopLength, BeatLoopStoryboard } from '@shared/types/api/agent'

// An in-memory project folder.
const files = new Map<string, unknown>()
jest.mock('../../activities/long-take/storage', () => ({
  ...jest.requireActual('../../activities/long-take/storage'),
  createLongTakeStorage: () => ({
    readJsonFile: async (relative: string) => {
      if (!files.has(relative)) throw new Error('No such object')
      return structuredClone(files.get(relative))
    },
    writeJsonFile: async (relative: string, data: unknown) => {
      files.set(relative, structuredClone(data))
      return relative
    },
  }),
}))
jest.mock('../../activities/long-take/common', () => ({
  ...jest.requireActual('../../activities/long-take/common'),
  withActivityHeartbeat: (fn: () => unknown) => fn(),
  withLongTakeContext: (_context: unknown, fn: () => unknown) => fn(),
}))

import type {
  BeatLoopKeyframeResult,
  BeatLoopTakeCheck,
  RenderBeatLoopClipParams,
} from '../../activities/beat-loop'
import {
  type BeatLoopTake,
  keepBeatLoopTake as keepTake,
  readBeatLoopQa,
  saveBeatLoopTake,
} from '../../activities/beat-loop/qa-store'

import type { BeatLoopWorkflowParams, BeatLoopWorkflowResult } from './types'
import { BeatLoopWorkflow } from './workflow'

const QUEUE = 'beat-loop-test'
const H3 = 'minimax-h3-max-turbo'
const OMNI = 'omni-flash-google'

/** How a take of a clip comes out: passes, fails these checks, or leaves no clip. */
type Verdict = 'noClip' | 'pass' | BeatLoopTakeCheck[]

let calls: string[] = []
let verdicts: Record<string, Verdict> = {}
/** Takes (`<clip>#<take>`) H3 failed on, so Omni made them. */
let fellBack = new Set<string>()
let clock = 0
let keyframeFrames: (clipCount: number) => BeatLoopKeyframeResult[] = loopFrames
/** Whether the keyframes activity reused every stored frame (false: it made them again). */
let keyframesReused = true
const madeVoiceover = async () => ({
  durationSeconds: 16,
  lines: [],
  transcriptPath: 'transformed_transcript.json',
  ttsProvider: 'local',
  voiceId: 'v1',
  voiceOverPath: 'voice_over.mp3',
})
let voiceover: () => Promise<unknown> = madeVoiceover

const activities = {
  generateBeatLoopKeyframes: jest.fn(async (params: { storyboard: BeatLoopStoryboard }) => {
    calls.push('keyframes')
    return {
      frames: keyframeFrames(params.storyboard.clips.length),
      keyframesPath: 'long_take/keyframes.json',
      reused: keyframesReused,
      shotPlanPath: 'long_take/shot_plan.json',
    }
  }),
  generateBeatLoopVoiceover: jest.fn(async () => {
    calls.push('voiceover')
    return voiceover()
  }),
  keepBeatLoopTake: jest.fn(
    async (params: {
      clipId: string
      generation?: number
      projectId: string
      startFrameUri?: string
    }) => {
      calls.push(`keep ${params.clipId}`)
      return keepTake(params)
    },
  ),
  readBeatLoopQa,
  recordLongTakeRuntimeMetadata: jest.fn(async () => undefined),
  releaseLongTakeSlot: jest.fn(async () => undefined),
  renderBeatLoopClip: jest.fn(async (params: RenderBeatLoopClipParams) => {
    const clipId = params.storyboard.clips[params.clipIndex].id
    const take = params.take ?? 1
    calls.push(`clip ${clipId} take ${take}`)
    const made = {
      ...makeTake(params.clipIndex, clipId, take, verdicts[`${clipId}#${take}`] ?? 'pass'),
      ...(fellBack.has(`${clipId}#${take}`)
        ? {
            attempts: [{ error: 'fal is busy', model: H3 }],
            model: OMNI,
            provider: 'google' as const,
          }
        : {}),
      generation: params.generation ?? 1,
      startFrameUri: params.firstFrameUri,
      targetFrameUri: params.targetFrameUri,
    }
    await saveBeatLoopTake(params.projectId, made)
    return made
  }),
  renderLongTakeVideo: jest.fn(async () => {
    calls.push('render')
    return {
      bgmBaked: false,
      enableCaption: true,
      renderDurationMs: 1,
      thumbnailFallbackUsed: false,
      videoUri: 'store://final_video.mp4',
    }
  }),
  reserveLongTakeSlot: jest.fn(async () => undefined),
  setLongTakeStatus: jest.fn(async () => undefined),
}

const noop = (): void => undefined
const silent = { debug: noop, error: noop, info: noop, trace: noop, warn: noop }

beforeAll(() => {
  configureEngine({ logger: silent })
  registerWorker({ activities, taskQueue: QUEUE, workflows: { BeatLoopWorkflow } })
})

beforeEach(() => {
  files.clear()
  calls = []
  verdicts = {}
  fellBack = new Set()
  keyframeFrames = loopFrames
  keyframesReused = true
  voiceover = madeVoiceover
  jest.clearAllMocks()
})

let runSeq = 0
function clipRenders(): RenderBeatLoopClipParams[] {
  return activities.renderBeatLoopClip.mock.calls.map(([params]) => params)
}

async function run(clipCount = 4, params: Partial<BeatLoopWorkflowParams> = {}) {
  return (await (await start(clipCount, params)).result()) as BeatLoopWorkflowResult
}

async function runFailing(clipCount = 4): Promise<Error> {
  const error = await run(clipCount).then(
    () => new Error('the run should have failed'),
    (failure: Error) => failure,
  )
  expect(error.name).toBe('WorkflowFailedError')
  return error
}

function start(clipCount = 4, params: Partial<BeatLoopWorkflowParams> = {}) {
  return new Client().workflow.start(BeatLoopWorkflow, {
    args: [
      {
        projectId: 'p1',
        storyboard: storyboard(clipCount),
        style: 'Bold ink',
        userId: 'u1',
        ...params,
      } satisfies BeatLoopWorkflowParams,
    ],
    taskQueue: QUEUE,
    workflowId: `beat-loop-test-${++runSeq}`,
  })
}

/** The first call's arguments (the engine adds the request context as a second one). */
function firstArgs(mock: jest.Mock): unknown {
  return mock.mock.calls[0]?.[0]
}

function statuses(stage: string): { detail?: string; meta?: Record<string, unknown> }[] {
  return (
    activities.setLongTakeStatus.mock.calls as unknown as [
      { detail?: string; meta?: Record<string, unknown>; stage: string },
    ][]
  )
    .map(([params]) => params)
    .filter((params) => params.stage === stage)
}

const keyframeUri = (index: number) => `store://long_take/keyframes/f${index}.png`

function clipFile(clipId: string, take: number, suffix: string): string {
  const name = take > 1 ? `${clipId}_take${take}` : clipId
  return `store://long_take/transitions/${name}${suffix}`
}

describe('BeatLoopWorkflow', () => {
  it('makes the voiceover, then the keyframes, then the clips one by one, then renders', async () => {
    const result = await run()

    expect(calls).toEqual([
      'voiceover',
      'keyframes',
      'clip c1 take 1',
      'keep c1',
      'clip c2 take 1',
      'keep c2',
      'clip c3 take 1',
      'keep c3',
      'clip c4 take 1',
      'keep c4',
      'render',
    ])
    expect(result).toEqual({
      flaggedClips: [],
      otherModelClips: [],
      rerolls: 0,
      resumedClips: 0,
      status: 'completed',
      videoUri: 'store://final_video.mp4',
    })
    expect(firstArgs(activities.renderLongTakeVideo)).toEqual(
      expect.objectContaining({
        aspectRatio: '9:16',
        enableCaption: true,
        projectId: 'p1',
        transitionVideos: ['c1', 'c2', 'c3', 'c4'].map((clipId, index) =>
          expect.objectContaining({
            endMs: (index + 1) * 4000,
            startMs: index * 4000,
            transitionId: clipId,
            videoUri: clipFile(clipId, 1, '.mp4'),
          }),
        ),
      }),
    )
    expect(statuses('completed').at(-1)?.meta).toEqual(
      expect.objectContaining({
        beatLoopClipSpendUsd: 0.64,
        beatLoopClips: 4,
        beatLoopRerolls: 0,
        transitionVideoModel: H3,
      }),
    )
    expect(activities.reserveLongTakeSlot).toHaveBeenCalledTimes(1)
    expect(activities.releaseLongTakeSlot).toHaveBeenCalledTimes(1)
  })

  it('chains each clip from the real last frame of the clip before; the last lands on fN, the copy of f0', async () => {
    await run()

    const renders = clipRenders()
    expect(renders.map((params) => [params.firstFrameUri, params.targetFrameUri])).toEqual([
      [keyframeUri(0), keyframeUri(1)],
      [clipFile('c1', 1, '_last.png'), keyframeUri(2)],
      [clipFile('c2', 1, '_last.png'), keyframeUri(3)],
      [clipFile('c3', 1, '_last.png'), keyframeUri(4)],
    ])
    // fN is the byte copy of f0, and the seam is checked against clip 1's real first frame.
    expect(renders[3].loopFirstFrameUri).toBe(clipFile('c1', 1, '_first.png'))
    expect(renders.slice(0, 3).every((params) => params.loopFirstFrameUri === undefined)).toBe(true)
    // Every clip tries Setup's model first: none is held to the model the clip before used.
    expect(renders.every((params) => !('model' in params))).toBe(true)
  })

  it("names a clip made on the other provider's model, and tries Setup's model first again after it", async () => {
    // H3 failed on clip 2's call, so Omni made it (at Omni's price).
    fellBack = new Set(['c2#1'])

    const result = await run()

    expect(clipRenders().every((params) => !('model' in params))).toBe(true)
    expect(result.otherModelClips).toEqual([
      { clipId: 'c2', failedModel: 'MiniMax Hailuo 3 Max Turbo', model: 'Gemini Omni Flash' },
    ])
    const completed = statuses('completed').at(-1)
    expect(completed?.detail).toBe(
      'Render complete. Clip c2 was made with Gemini Omni Flash: MiniMax Hailuo 3 Max Turbo failed on it.',
    )
    expect(completed?.meta).toEqual(
      expect.objectContaining({ transitionVideoModel: `${H3},${OMNI}` }),
    )
  })

  it("fails before any clip when the last keyframe isn't a copy of f0", async () => {
    keyframeFrames = (clipCount) =>
      loopFrames(clipCount).map((frame) => ({ ...frame, copyOf: undefined }))

    const error = await runFailing()

    expect(activities.renderBeatLoopClip).not.toHaveBeenCalled()
    expect((error.cause as Error | undefined)?.message).toMatch(/close the loop/)
    expect(statuses('error')).toEqual([
      expect.objectContaining({ detail: expect.stringMatching(/close the loop/) }),
    ])
  })

  it('stops before clip 2 when clip 1 fails its re-roll too (the clip-1 gate)', async () => {
    verdicts = { 'c1#1': ['beatShape'], 'c1#2': ['beatShape', 'strayCut'] }

    const error = await runFailing()

    expect(calls).toEqual(['voiceover', 'keyframes', 'clip c1 take 1', 'clip c1 take 2', 'keep c1'])
    expect(activities.renderLongTakeVideo).not.toHaveBeenCalled()
    const detail = statuses('error')[0]?.detail ?? ''
    expect(detail).toMatch(/Clip c1/)
    expect(detail).toContain('Fails beatShape.')
    expect((error.cause as Error | undefined)?.message).toBe(detail)
    expect(activities.releaseLongTakeSlot).toHaveBeenCalledTimes(1)
  })

  it('goes on once clip 1 passes on its re-roll', async () => {
    verdicts = { 'c1#1': ['joint'] }

    const result = await run()

    expect(calls.slice(0, 6)).toEqual([
      'voiceover',
      'keyframes',
      'clip c1 take 1',
      'clip c1 take 2',
      'keep c1',
      'clip c2 take 1',
    ])
    expect(clipRenders()[2].firstFrameUri).toBe(clipFile('c1', 2, '_last.png'))
    expect(result.rerolls).toBe(1)
    expect(result.flaggedClips).toEqual([])
  })

  it('re-rolls a failing clip once before the next clip, then keeps the better take and flags it', async () => {
    verdicts = { 'c2#1': ['beatShape', 'strayCut'], 'c2#2': ['lateArrival'] }

    const result = await run()

    expect(calls.slice(4, 8)).toEqual([
      'clip c2 take 1',
      'clip c2 take 2',
      'keep c2',
      'clip c3 take 1',
    ])
    // Take 2 fails one check, take 1 two: take 2 is kept, and clip 3 starts on its last frame.
    expect(clipRenders()[3].firstFrameUri).toBe(clipFile('c2', 2, '_last.png'))
    expect(result.flaggedClips).toEqual([{ clipId: 'c2', failures: ['Fails lateArrival.'] }])
    expect(result.rerolls).toBe(1)
    const completed = statuses('completed').at(-1)
    expect(completed?.meta).toEqual(expect.objectContaining({ beatLoopFlaggedClips: 'c2' }))
    expect(completed?.detail).toContain('Fails lateArrival.')
    expect(firstArgs(activities.renderLongTakeVideo)).toEqual(
      expect.objectContaining({
        transitionVideos: expect.arrayContaining([
          expect.objectContaining({ transitionId: 'c2', videoUri: clipFile('c2', 2, '.mp4') }),
        ]),
      }),
    )
  })

  it('spends at most three re-rolls on a video', async () => {
    verdicts = {
      'c1#1': ['beatShape'],
      'c2#1': ['beatShape'],
      'c3#1': ['beatShape'],
      'c4#1': ['beatShape'],
      'c5#1': ['text'],
    }

    const result = await run(6)

    expect(calls.filter((call) => call.startsWith('clip'))).toEqual([
      'clip c1 take 1',
      'clip c1 take 2',
      'clip c2 take 1',
      'clip c2 take 2',
      'clip c3 take 1',
      'clip c3 take 2',
      'clip c4 take 1',
      'clip c5 take 1',
      'clip c6 take 1',
    ])
    expect(result.rerolls).toBe(3)
    expect(result.flaggedClips.map((clip) => clip.clipId)).toEqual(['c4', 'c5'])
  })

  it('fails when no take of a clip left a clip to keep and no re-roll is left', async () => {
    verdicts = {
      'c1#1': ['beatShape'],
      'c2#1': ['beatShape'],
      'c3#1': ['beatShape'],
      'c4#1': 'noClip',
    }

    await runFailing(5)

    expect(statuses('error')[0]?.detail).toMatch(/Clip c4 has no usable take/)
    expect(activities.renderLongTakeVideo).not.toHaveBeenCalled()
  })

  it('fails fast when the voiceover fails, before any picture is made', async () => {
    voiceover = async () => {
      throw ApplicationFailure.nonRetryable('Clip c2 has too many words to say in 3.45 s', 'Long')
    }

    await runFailing()

    expect(calls).toEqual(['voiceover'])
    // The reason, not the engine's "Activity task failed".
    expect(statuses('error')[0]?.detail).toBe('Clip c2 has too many words to say in 3.45 s')
    expect(activities.releaseLongTakeSlot).toHaveBeenCalledTimes(1)
  })

  it('waits for the admission queue when it starts paused', async () => {
    const handle = await start(4, { startPaused: true })
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(calls).toEqual([])

    await handle.signal(STORY_MODE_ADMISSION_START_SIGNAL)
    await handle.result()

    expect(calls[0]).toBe('voiceover')
  })

  describe('resume', () => {
    it('picks up at the first clip it has not kept, and keeps the stored clips', async () => {
      await store([
        { clipId: 'c1', takes: ['pass'] },
        { clipId: 'c2', takes: [['beatShape'], 'pass'] },
        { clipId: 'c3', keep: false, takes: [['joint']] },
      ])

      const result = await run()

      expect(calls).toEqual([
        'voiceover',
        'keyframes',
        // Clip 3's stored take failed: this run gives it its re-roll.
        'clip c3 take 2',
        'keep c3',
        'clip c4 take 1',
        'keep c4',
        'render',
      ])
      // New frames are written for Setup's model, whichever model the stored clips used.
      expect(firstArgs(activities.generateBeatLoopKeyframes)).not.toHaveProperty('model')
      const [c3, c4] = clipRenders()
      expect(c3.firstFrameUri).toBe(clipFile('c2', 2, '_last.png'))
      expect(c4.loopFirstFrameUri).toBe(clipFile('c1', 1, '_first.png'))
      expect(result.resumedClips).toBe(2)
      // Clip 2's and clip 3's.
      expect(result.rerolls).toBe(2)
      expect(firstArgs(activities.renderLongTakeVideo)).toEqual(
        expect.objectContaining({
          transitionVideos: [
            expect.objectContaining({ videoUri: clipFile('c1', 1, '.mp4') }),
            expect.objectContaining({ videoUri: clipFile('c2', 2, '.mp4') }),
            expect.objectContaining({ videoUri: clipFile('c3', 2, '.mp4') }),
            expect.objectContaining({ videoUri: clipFile('c4', 1, '.mp4') }),
          ],
        }),
      )
      expect(statuses('transitions')[0]?.meta).toEqual(
        expect.objectContaining({ completedTransitions: 2, transitionCount: 4 }),
      )
    })

    it('keeps a stored passing take that was never kept, without making it again', async () => {
      await store([
        { clipId: 'c1', takes: ['pass'] },
        { clipId: 'c2', keep: false, takes: ['pass'] },
      ])

      await run()

      expect(calls.filter((call) => call.startsWith('clip'))).toEqual([
        'clip c3 take 1',
        'clip c4 take 1',
      ])
      expect(clipRenders()[0].firstFrameUri).toBe(clipFile('c2', 1, '_last.png'))
    })

    it('makes clip 1 again after it failed the gate', async () => {
      verdicts = { 'c1#1': ['beatShape'], 'c1#2': ['beatShape'] }
      await runFailing()
      calls = []
      verdicts = {}

      await run()

      expect(calls.slice(2, 5)).toEqual(['clip c1 take 3', 'keep c1', 'clip c2 take 1'])
      expect(clipRenders().at(-4)?.firstFrameUri).toBe(keyframeUri(0))
    })

    it('reuses the clips kept after a redone clip, and numbers its new take after the old ones', async () => {
      await run()
      jest.clearAllMocks()
      calls = []
      // The API's redo of c2 without redoFollowing: c2 starts over, c3 and c4 are kept.
      redo('c2', { keptAfter: ['c3', 'c4'] })

      const result = await run()

      expect(calls).toEqual(['voiceover', 'keyframes', 'clip c2 take 2', 'keep c2', 'render'])
      const [c2] = clipRenders()
      expect(c2).toMatchObject({
        firstFrameUri: clipFile('c1', 1, '_last.png'),
        generation: 2,
        take: 2,
      })
      expect(firstArgs(activities.keepBeatLoopTake)).toEqual(
        expect.objectContaining({
          clipId: 'c2',
          generation: 2,
          startFrameUri: clipFile('c1', 1, '_last.png'),
        }),
      )
      // The old take's files stay as they were: the new take has its own.
      expect(firstArgs(activities.renderLongTakeVideo)).toEqual(
        expect.objectContaining({
          transitionVideos: ['c1#1', 'c2#2', 'c3#1', 'c4#1'].map((key) => {
            const [clipId, take] = key.split('#')
            return expect.objectContaining({ videoUri: clipFile(clipId, Number(take), '.mp4') })
          }),
        }),
      )
      expect(result.resumedClips).toBe(3)

      // A later Try again still reuses them all: c3 stays kept although it starts on the old frame.
      calls = []
      await run()
      expect(calls).toEqual(['voiceover', 'keyframes', 'render'])
    })

    it('makes every clip after a redone one again with redoFollowing, each from the clip before', async () => {
      await run()
      jest.clearAllMocks()
      calls = []
      redo('c2', { remade: ['c3', 'c4'] })

      await run()

      expect(calls.filter((call) => call.startsWith('clip'))).toEqual([
        'clip c2 take 2',
        'clip c3 take 2',
        'clip c4 take 2',
      ])
      const renders = clipRenders()
      expect(renders.map((params) => [params.generation, params.firstFrameUri])).toEqual([
        [2, clipFile('c1', 1, '_last.png')],
        [2, clipFile('c2', 2, '_last.png')],
        [2, clipFile('c3', 2, '_last.png')],
      ])
    })

    it('finishes a take already paid for before paying for a new one', async () => {
      await store([{ clipId: 'c1', takes: ['pass'] }])
      await saveBeatLoopTake('p1', {
        ...makeTake(1, 'c2', 1, 'noClip'),
        failed: ['unfinished'],
        failures: ['The clip was made but could not be finished: upload failed.'],
        paidClipUri: 'store://long_take/transitions/c2_paid.mp4',
      })

      await run()

      expect(calls.find((call) => call.startsWith('clip'))).toBe('clip c2 take 1')
    })

    it('gives a stored failing take only its re-roll, then keeps the better of the two', async () => {
      await store([
        { clipId: 'c1', takes: ['pass'] },
        { clipId: 'c2', keep: false, takes: [['joint']] },
      ])
      verdicts = { 'c2#2': ['beatShape', 'joint'] }

      const result = await run()

      expect(calls.filter((call) => call.startsWith('clip'))).toEqual([
        'clip c2 take 2',
        'clip c3 take 1',
        'clip c4 take 1',
      ])
      // Take 1 fails one check, its re-roll two: take 1 is kept, flagged.
      expect(result.flaggedClips).toEqual([{ clipId: 'c2', failures: ['Fails joint.'] }])
      expect(clipRenders()[1].firstFrameUri).toBe(clipFile('c2', 1, '_last.png'))
    })

    it('keeps a stored failing take when the video has no re-roll left', async () => {
      await store([
        { clipId: 'c1', takes: [['joint'], 'pass'] },
        { clipId: 'c2', takes: [['joint'], 'pass'] },
        { clipId: 'c3', takes: [['joint'], 'pass'] },
        { clipId: 'c4', keep: false, takes: [['joint']] },
      ])

      const result = await run()

      expect(calls.filter((call) => call.startsWith('clip'))).toEqual([])
      expect(result.flaggedClips).toEqual([{ clipId: 'c4', failures: ['Fails joint.'] }])
    })

    it('finishes a paid re-roll and keeps the better take rather than paying for a third', async () => {
      await store([
        { clipId: 'c1', takes: ['pass'] },
        { clipId: 'c2', keep: false, takes: [['beatShape', 'joint']] },
      ])
      // The re-roll was paid for, then the run stopped before it was finished.
      await saveBeatLoopTake('p1', {
        ...makeTake(1, 'c2', 2, 'noClip'),
        failed: ['unfinished'],
        failures: ['The clip was made but could not be finished: upload failed.'],
        paidClipUri: 'store://long_take/transitions/c2_take2_paid.mp4',
      })
      verdicts = { 'c2#2': ['joint'] }

      const result = await run()

      expect(calls.filter((call) => call.startsWith('clip'))).toEqual([
        'clip c2 take 2',
        'clip c3 take 1',
        'clip c4 take 1',
      ])
      expect(result.flaggedClips).toEqual([{ clipId: 'c2', failures: ['Fails joint.'] }])
      expect(result.rerolls).toBe(1)
    })

    it('keeps the better of two stored takes instead of paying for a third', async () => {
      await store([
        { clipId: 'c1', takes: ['pass'] },
        { clipId: 'c2', keep: false, takes: [['beatShape', 'joint'], ['joint']] },
      ])

      const result = await run()

      expect(calls.filter((call) => call.startsWith('clip'))).toEqual([
        'clip c3 take 1',
        'clip c4 take 1',
      ])
      expect(result.flaggedClips).toEqual([{ clipId: 'c2', failures: ['Fails joint.'] }])
    })

    it('starts every stored clip over when the keyframes were made again', async () => {
      await run()
      jest.clearAllMocks()
      calls = []
      keyframesReused = false

      await run()

      expect(calls.filter((call) => call.startsWith('clip'))).toEqual([
        'clip c1 take 2',
        'clip c2 take 2',
        'clip c3 take 2',
        'clip c4 take 2',
      ])
      expect(clipRenders().every((params) => params.generation === 2)).toBe(true)
      // The keyframes step moves the stored clips to those generations before it writes over a
      // frame, so a run stopped after that never reuses clips made on the old frames.
      expect(firstArgs(activities.generateBeatLoopKeyframes)).toEqual(
        expect.objectContaining({ restartGenerations: [2, 2, 2, 2] }),
      )
    })

    it('counts the re-rolls of the kept clips against the limit', async () => {
      await store([
        { clipId: 'c1', takes: [['beatShape'], 'pass'] },
        { clipId: 'c2', takes: [['beatShape'], 'pass'] },
      ])
      verdicts = { 'c3#1': ['joint'], 'c4#1': ['joint'] }

      const result = await run(6)

      expect(calls.filter((call) => call.startsWith('clip'))).toEqual([
        'clip c3 take 1',
        'clip c3 take 2',
        'clip c4 take 1',
        'clip c5 take 1',
        'clip c6 take 1',
      ])
      expect(result.rerolls).toBe(3)
      expect(result.flaggedClips.map((clip) => clip.clipId)).toEqual(['c4'])
    })
  })
})

function isQaCheck(check: BeatLoopTakeCheck): check is BeatLoopQaCheck {
  return check !== 'beatLock' && check !== 'unfinished'
}

/** One take as the clip activity saves it, with fixed file names per clip and take. */
function makeTake(clipIndex: number, clipId: string, take: number, verdict: Verdict): BeatLoopTake {
  const failed = verdict === 'pass' ? [] : verdict === 'noClip' ? ['beatLock' as const] : verdict
  return {
    attempts: [],
    clipId,
    clipIndex,
    // Strictly later for every take, as real renders are minutes apart.
    createdAt: new Date(Date.UTC(2026, 9, 11, 10, 0, ++clock)).toISOString(),
    failed,
    failures: failed.map((check) => `Fails ${check}.`),
    ...(clipIndex === 0 && verdict !== 'noClip'
      ? { firstFrameUri: clipFile(clipId, take, '_first.png') }
      : {}),
    ...(verdict === 'noClip' ? {} : { lastFrameUri: clipFile(clipId, take, '_last.png') }),
    model: H3,
    passed: failed.length === 0,
    prompt: `prompt ${clipId}`,
    provider: 'fal',
    qa: verdict === 'noClip' ? null : qa(failed.filter(isQaCheck)),
    spend: {
      estimatedUsd: 0.16,
      model: H3,
      provider: 'fal',
      requestedSeconds: 4,
      usdPerSecond: 0.04,
    },
    take,
    transition:
      verdict === 'noClip'
        ? null
        : {
            endMs: (clipIndex + 1) * 4000,
            fromShotId: `f${clipIndex}`,
            lastFrameUri: clipFile(clipId, take, '_last.png'),
            prompt: `prompt ${clipId}`,
            qualityCheck: { hasGibberish: false, severity: 'none' },
            startMs: clipIndex * 4000,
            toShotId: `f${clipIndex + 1}`,
            transitionId: clipId,
            transitionVideoModel: H3,
            videoUri: clipFile(clipId, take, '.mp4'),
          },
  }
}

function qa(failed: BeatLoopClipQa['failed']): BeatLoopClipQa {
  return {
    anchor: { passed: !failed.includes('anchor'), ssim: 0.8 },
    beatShape: {
      cutToFreeze: 5,
      cutToHit: 2,
      e12: 3,
      e3: 1,
      e4: 6,
      hitToFreeze: 3,
      passed: !failed.includes('beatShape'),
    },
    durationS: 4,
    failed,
    fps: 24,
    frameCount: 96,
    joint: { passed: !failed.includes('joint'), ssim: 0.9 },
    lateArrival: { arrivalS: 3.5, passed: !failed.includes('lateArrival'), startDistance: 40 },
    musicBed: { audioS: 4, passed: true, tonalS: 0 },
    passed: failed.length === 0,
    seam: null,
    strayCut: { cuts: [], median: 2, passed: !failed.includes('strayCut') },
    text: null,
  }
}

/** Stores takes as an earlier run left them; each clip is kept unless `keep` is false. */
async function store(clips: { clipId: string; keep?: boolean; takes: Verdict[] }[]): Promise<void> {
  for (const clip of clips) {
    const clipIndex = Number(clip.clipId.slice(1)) - 1
    for (const [index, verdict] of clip.takes.entries()) {
      await saveBeatLoopTake('p1', makeTake(clipIndex, clip.clipId, index + 1, verdict))
    }
    if (clip.keep !== false) await keepTake({ clipId: clip.clipId, projectId: 'p1' })
  }
}

/**
 * What the API's redo does to the QA record: the redone clip (and `remade`, with redoFollowing)
 * start over in a new generation; `keptAfter` stay, kept on purpose.
 */
function redo(clipId: string, options: { keptAfter?: string[]; remade?: string[] }): void {
  const file = files.get('long_take/beat_loop_qa.json') as {
    clips: { clipId: string; generation?: number; keepAfterRedo?: boolean; keptTake?: number }[]
  }
  for (const clip of file.clips) {
    if (clip.clipId === clipId || options.remade?.includes(clip.clipId)) {
      clip.generation = (clip.generation ?? 1) + 1
      delete clip.keptTake
    }
    if (options.keptAfter?.includes(clip.clipId)) clip.keepAfterRedo = true
  }
}

/** f0..f(N-1), then fN: the byte copy of f0 that closes the loop. */
function loopFrames(clipCount: number): BeatLoopKeyframeResult[] {
  const frames = Array.from({ length: clipCount }, (_, index) => ({
    id: `f${index}`,
    prompt: `keyframe ${index}`,
    uri: keyframeUri(index),
  }))
  return [
    ...frames,
    { copyOf: 'f0', id: `f${clipCount}`, prompt: 'keyframe 0', uri: keyframeUri(clipCount) },
  ]
}

function storyboard(clipCount: number): BeatLoopStoryboard {
  const clips = Array.from({ length: clipCount }, (_, index) => ({
    caption: null,
    cut: 'The camera pushes into the next picture',
    cut_camera: 'Push in' as const,
    freeze: 'The motion freezes',
    hit: 'A wave crashes over the rocks',
    hit_camera: 'Shake' as const,
    id: `c${index + 1}`,
    narration: 'Waves have shaped this coast for ten thousand years',
    stamp: null,
  }))
  return {
    accent: '#FFE500',
    caption_style: 'punch',
    clips,
    duration_s: (clipCount * 4) as BeatLoopLength,
    keyframes: [
      ...clips.map((_, index) => ({ id: `f${index}`, prompt: `keyframe ${index}` })),
      { id: `f${clipCount}`, same_as: 'f0' },
    ],
    sources: 'test',
    title: 'Coast',
  }
}
