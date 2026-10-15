import type { BeatLoopClipQa } from '@reelmakeeasy/common/long-take/beat-loop-qa'

// An in-memory project folder. A file set to CORRUPT reads as JSON cut short.
const files = new Map<string, unknown>()
const CORRUPT = 'corrupt file'
jest.mock('../long-take/storage', () => ({
  ...jest.requireActual('../long-take/storage'),
  createLongTakeStorage: () => ({
    readJsonFile: async (relative: string) => {
      if (!files.has(relative)) throw Object.assign(new Error('No such object'), { code: 404 })
      if (files.get(relative) === CORRUPT) throw new SyntaxError('Unexpected end of JSON input')
      return structuredClone(files.get(relative))
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

import {
  BEAT_LOOP_QA_PATH,
  type BeatLoopTake,
  keepBeatLoopTake,
  pickBeatLoopTake,
  readBeatLoopQa,
  saveBeatLoopTake,
} from './qa-store'

function qa(fields: Partial<BeatLoopClipQa>): BeatLoopClipQa {
  return {
    anchor: { passed: true, ssim: 0.8 },
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
    text: null,
    ...fields,
  }
}

function take(fields: Partial<BeatLoopTake> & Pick<BeatLoopTake, 'take'>): BeatLoopTake {
  return {
    attempts: [],
    clipId: 's1',
    clipIndex: 0,
    createdAt: '2026-10-11T00:00:00.000Z',
    failed: [],
    failures: [],
    model: 'minimax-h3-max-turbo',
    passed: true,
    prompt: 'p',
    provider: 'fal',
    qa: qa({}),
    spend: {
      estimatedUsd: 0.16,
      model: 'minimax-h3-max-turbo',
      provider: 'fal',
      requestedSeconds: 4,
      usdPerSecond: 0.04,
    },
    transition: {
      endMs: 4000,
      fromShotId: 'f0',
      lastFrameUri: `store://long_take/transitions/s1_take${fields.take}_last.png`,
      prompt: 'p',
      qualityCheck: { hasGibberish: false, severity: 'none' },
      startMs: 0,
      toShotId: 'f1',
      transitionId: 's1',
      videoUri: `store://long_take/transitions/s1_take${fields.take}.mp4`,
    },
    ...fields,
  }
}

const failedAnchor = (n: number, ssim: number) =>
  take({
    failed: ['anchor'],
    failures: ['It lands on the wrong final frame.'],
    passed: false,
    qa: qa({ anchor: { passed: false, ssim }, failed: ['anchor'], passed: false }),
    take: n,
  })

beforeEach(() => files.clear())

describe('pickBeatLoopTake', () => {
  it('keeps a passing take over a failing one', () => {
    expect(pickBeatLoopTake([failedAnchor(1, 0.6), take({ take: 2 })])?.take).toBe(2)
  })

  it('keeps the better of two failing takes: the closer landing', () => {
    expect(pickBeatLoopTake([failedAnchor(1, 0.5), failedAnchor(2, 0.65)])?.take).toBe(2)
  })

  it('never keeps a take without a clip (the beat-lock refused its length)', () => {
    const refused = take({
      failed: ['beatLock'],
      passed: false,
      qa: null,
      take: 2,
      transition: null,
    })
    expect(pickBeatLoopTake([failedAnchor(1, 0.4), refused])?.take).toBe(1)
    expect(pickBeatLoopTake([refused])).toBeUndefined()
  })
})

describe('the QA file (long_take/beat_loop_qa.json)', () => {
  it('records every take with its spend, a re-run replacing the same take', async () => {
    await saveBeatLoopTake('p1', failedAnchor(1, 0.6))
    await saveBeatLoopTake('p1', take({ take: 2 }))
    await saveBeatLoopTake('p1', take({ take: 2 }))
    await saveBeatLoopTake(
      'p1',
      take({
        clipId: 's2',
        clipIndex: 1,
        spend: {
          estimatedUsd: 0.42,
          model: 'omni-flash-google',
          provider: 'google',
          reported: { usd: 0.4 },
          requestedSeconds: 4,
          usdPerSecond: 0.104,
        },
        take: 1,
      }),
    )
    const file = await readBeatLoopQa({ projectId: 'p1' })
    expect(files.has(BEAT_LOOP_QA_PATH)).toBe(true)
    expect(file.clips.map((c) => [c.clipId, c.takes.map((t) => t.take)])).toEqual([
      ['s1', [1, 2]],
      ['s2', [1]],
    ])
    expect(file.spend).toEqual({ estimatedUsd: 0.74, reportedUsd: 0.4, takes: 3 })
  })

  it('reads an empty file when nothing was saved yet', async () => {
    expect(await readBeatLoopQa({ projectId: 'p1' })).toMatchObject({ clips: [], version: 1 })
  })

  it("never reads a record it can't parse as empty: that would pay for every clip again", async () => {
    files.set(BEAT_LOOP_QA_PATH, CORRUPT)
    const unreadable = /beat_loop_qa\.json can't be read: Unexpected end of JSON input/

    await expect(readBeatLoopQa({ projectId: 'p1' })).rejects.toThrow(unreadable)
    // A new take is not written over it as if it were the only one.
    await expect(saveBeatLoopTake('p1', take({ take: 3 }))).rejects.toThrow(unreadable)
    await expect(keepBeatLoopTake({ clipId: 's1', projectId: 'p1' })).rejects.toThrow(unreadable)
    expect(files.get(BEAT_LOOP_QA_PATH)).toBe(CORRUPT)
  })

  it('keeps the better take, flags a clip whose best take still fails, and returns its clip', async () => {
    await saveBeatLoopTake('p1', failedAnchor(1, 0.5))
    await saveBeatLoopTake('p1', failedAnchor(2, 0.65))
    const kept = await keepBeatLoopTake({ clipId: 's1', projectId: 'p1' })
    expect(kept).toMatchObject({
      clipId: 's1',
      flagged: true,
      keptTake: 2,
      lastFrameUri: 'store://long_take/transitions/s1_take2_last.png',
    })
    expect(kept.transition.videoUri).toBe('store://long_take/transitions/s1_take2.mp4')
    const file = await readBeatLoopQa({ projectId: 'p1' })
    expect(file.clips[0]).toMatchObject({ flagged: true, keptTake: 2 })
  })

  it('refuses to keep a clip that has no usable take', async () => {
    await saveBeatLoopTake(
      'p1',
      take({ failed: ['beatLock'], passed: false, qa: null, take: 1, transition: null }),
    )
    await expect(keepBeatLoopTake({ clipId: 's1', projectId: 'p1' })).rejects.toThrow(/s1/)
  })
})
