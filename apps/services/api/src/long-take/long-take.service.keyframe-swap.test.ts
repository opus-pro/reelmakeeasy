const start = jest.fn(async (_type: string, _opts: unknown) => undefined)
jest.mock('@reelmakeeasy/common/workflow/client', () => ({
  createClient: async () => ({ workflow: { start } }),
}))
/** The project's files by path: JSON, or a picture's bytes. */
const files = new Map<string, unknown>()
const rel = (p: string) => p.replace(/^store:\/\/projects\/p1\//, '')
jest.mock('@reelmakeeasy/common/agent-v2/storage/storage', () => ({
  ...jest.requireActual('@reelmakeeasy/common/agent-v2/storage/storage'),
  createStorage: async () => ({
    copyFile: async (from: string, to: string) => {
      if (!files.has(rel(from)))
        throw Object.assign(new Error(`No such object: ${from}`), { code: 404 })
      files.set(rel(to), files.get(rel(from)))
    },
    exists: async (p: string) => files.has(rel(p)),
    getFullPath: (p: string) => `store://projects/p1/${p}`,
    readFile: async (p: string) => {
      const file = files.get(rel(p))
      if (!Buffer.isBuffer(file))
        throw Object.assign(new Error(`No such object: ${p}`), { code: 404 })
      return file
    },
    readJsonFile: async (p: string) => {
      if (!files.has(rel(p))) throw Object.assign(new Error(`No such object: ${p}`), { code: 404 })
      return structuredClone(files.get(rel(p)))
    },
    writeFile: async (p: string, content: Buffer) => {
      files.set(rel(p), content)
      return p
    },
    writeJsonFile: async (p: string, data: unknown) => {
      files.set(rel(p), structuredClone(data))
      return p
    },
  }),
}))

import {
  resetGenerationProviderForTesting,
  setGenerationProvider,
  setGenerationUnavailable,
} from '@reelmakeeasy/llm/registry'
import { BadRequestException, ConflictException } from '@nestjs/common'
import sharp from 'sharp'

import { LongTakeService } from './long-take.service'

const USER = { email: 'you@reelmakeeasy.local', orgId: 'o', sub: 'u', userId: 'u' }
const K = (id: string) => `store://projects/p1/long_take/keyframes/${id}.png`
const FULL_PROMPT =
  '[0:00.000-0:03.378] Already tracking forward beside the hand, the camera descends... (the whole prompt, past 512 characters)'

const transition = (n: number, from: string, to: string, startMs: number, endMs: number) => ({
  endMs,
  fromShotId: from,
  prompt: `stored prompt ${n}`,
  startMs,
  toShotId: to,
  transitionId: `transition_${n}`,
  videoHeight: 1344,
  videoUri: `store://projects/p1/long_take/transitions/transition_${n}.mp4`,
  videoWidth: 768,
})

function makeService(project: Record<string, unknown> = {}, loop = false) {
  const projectsService = {
    canVisitProject: jest.fn(async () => true),
    getProject: jest.fn(async () => ({
      cameraStyle: 'dynamic',
      createUseCase: loop ? 'beat-loop' : null,
      debugSettings: { transitionVideoModel: 'minimax-h3-max-turbo' },
      generationResolution: { videoResolution: '768p' },
      id: 'p1',
      longTakeRatio: '9:16',
      ...project,
    })),
  }
  const prisma = {
    generationRecord: {
      findMany: jest.fn(async () => [
        {
          anchorId: 'transition_0',
          attempt: 1,
          inputText: FULL_PROMPT,
          meta: {},
          model: 'minimax-h3-max-turbo',
          outputUris: ['store://projects/p1/long_take/transitions/transition_0.mp4'],
        },
      ]),
    },
  }
  const beatLoop = {
    isBeatLoopProject: jest.fn(async () => loop),
    planKeyframeSwap: jest.fn(async () => ({
      clipCount: 4,
      clipIds: ['c2', 'c3', 'c4'],
      clipUsd: 0.16,
      estimatedCostUsd: 0.48,
      frameId: 'f2',
      framePaths: ['long_take/keyframes/f2.png'],
      modelLabel: 'MiniMax Hailuo 3 Max Turbo',
    })),
    swapKeyframe: jest.fn(async () => ({
      clipIds: ['c2', 'c3', 'c4'],
      workflowId: 'ao:p1:story-mode',
    })),
  }
  const svc = new LongTakeService(
    projectsService as never,
    {} as never,
    { del: jest.fn() } as never,
    prisma as never,
    {} as never,
    beatLoop as never,
  )
  return { beatLoop, prisma, projectsService, svc }
}

async function storeStoryVideo() {
  files.set('long_take/keyframes.json', [
    { keyframeUrl: K('1'), shotId: '1' },
    { keyframeUrl: K('2'), shotId: '2', thumbnailUrl: 'store://projects/p1/t2.webp' },
    { keyframeUrl: K('3'), shotId: '3' },
    { keyframeUrl: K('4'), shotId: '4' },
  ])
  files.set('long_take/transition_videos.json', [
    transition(0, '1', '2', 0, 5400),
    transition(1, '2', '3', 5400, 8720),
  ])
  files.set(
    'long_take/keyframes/2.png',
    await sharp({ create: { background: '#888', channels: 3, height: 1360, width: 768 } })
      .png()
      .toBuffer(),
  )
}

beforeEach(() => {
  files.clear()
  start.mockClear()
  setGenerationProvider('fal')
})
afterEach(() => resetGenerationProviderForTesting())

describe('LongTakeService.planKeyframeSwap (story video)', () => {
  it('a keyframe inside the video makes the clip before and the clip after again, priced', async () => {
    await storeStoryVideo()
    const { svc } = makeService()

    await expect(svc.planKeyframeSwap('p1', '2')).resolves.toEqual({
      clipCount: 2,
      clips: [
        { endMs: 5400, id: 'transition_0', lands: true, number: 1, startMs: 0, usd: 0.24 },
        { endMs: 8720, id: 'transition_1', lands: false, number: 2, startMs: 5400, usd: 0.2 },
      ],
      frame: { height: 1360, width: 768 },
      loop: false,
      modelLabel: 'MiniMax Hailuo 3 Max Turbo',
      shotId: '2',
      totalUsd: 0.44,
    })
    expect(start).not.toHaveBeenCalled()
  })

  it('the first keyframe opens clip 1 only, the last ends the last clip only', async () => {
    await storeStoryVideo()
    const { svc } = makeService()
    expect((await svc.planKeyframeSwap('p1', '1')).clips.map((c) => c.id)).toEqual(['transition_0'])
    expect((await svc.planKeyframeSwap('p1', '3')).clips.map((c) => c.id)).toEqual(['transition_1'])
  })

  it("fits to the clips' frame when the keyframe's picture can't be read", async () => {
    await storeStoryVideo()
    files.delete('long_take/keyframes/2.png')
    const { svc } = makeService()
    expect((await svc.planKeyframeSwap('p1', '2')).frame).toEqual({ height: 1344, width: 768 })
  })

  it('refuses an unknown keyframe (naming them), one no clip uses, and no video model', async () => {
    await storeStoryVideo()
    const { svc } = makeService()
    await expect(svc.planKeyframeSwap('p1', '9')).rejects.toThrow(
      'No keyframe 9. The keyframes are 1, 2, 3, 4.',
    )
    await expect(svc.planKeyframeSwap('p1', '4')).rejects.toBeInstanceOf(BadRequestException)
    setGenerationUnavailable('Add FAL_KEY or GEMINI_API_KEY to .env, then restart')
    await expect(svc.planKeyframeSwap('p1', '2')).rejects.toBeInstanceOf(ConflictException)
  })

  it("a loop short's plan comes from its own service, fitted to its frame's picture", async () => {
    files.set(
      'long_take/keyframes/f2.png',
      await sharp({ create: { background: '#888', channels: 3, height: 1344, width: 768 } })
        .png()
        .toBuffer(),
    )
    const { beatLoop, svc } = makeService({}, true)
    await expect(svc.planKeyframeSwap('p1', 'f2')).resolves.toEqual({
      clipCount: 4,
      clips: [
        { endMs: 8000, id: 'c2', lands: true, number: 2, startMs: 4000, usd: 0.16 },
        { endMs: 12000, id: 'c3', lands: false, number: 3, startMs: 8000, usd: 0.16 },
        { endMs: 16000, id: 'c4', lands: false, number: 4, startMs: 12000, usd: 0.16 },
      ],
      frame: { height: 1344, width: 768 },
      loop: true,
      modelLabel: 'MiniMax Hailuo 3 Max Turbo',
      shotId: 'f2',
      totalUsd: 0.48,
    })
    expect(beatLoop.planKeyframeSwap).toHaveBeenCalledWith('p1', 'f2')
  })
})

describe('LongTakeService.remakeClipsWithKeyframe / commitKeyframe', () => {
  const NEW = Buffer.from('fitted picture')

  it('makes both clips again from the new picture with their own prompts and model, in one run', async () => {
    await storeStoryVideo()
    const { svc } = makeService()

    const run = await svc.remakeClipsWithKeyframe('p1', '2', NEW, USER as never)

    expect(run).toEqual({
      keyframeUri: expect.stringMatching(
        /^store:\/\/projects\/p1\/long_take\/keyframes\/2-\w+\.png$/,
      ),
      picturePath: rel(run.keyframeUri),
      transitionIds: ['transition_0', 'transition_1'],
      workflowId: 'ao:p1:story-mode:transition-keyframe-regen:2',
    })
    expect(files.get(rel(run.keyframeUri))).toEqual(NEW)
    const [type, opts] = start.mock.calls[0] as [string, Record<string, unknown>]
    expect(type).toBe('RegenerateTransitionWorkflow')
    expect(opts).toMatchObject({ taskQueue: 'ao-editor', workflowId: run.workflowId })
    const [args] = (opts as { args: Record<string, unknown>[] }).args
    expect(args).toMatchObject({
      aspectRatio: '9:16',
      cameraStyle: 'dynamic',
      commitToCanonical: true,
      projectId: 'p1',
      promptIsFinal: true,
      transitionVideoModel: 'minimax-h3-max-turbo',
      userId: 'u',
    })
    expect(args.transitionList).toEqual([
      expect.objectContaining({
        endMs: 5400,
        firstFrameUri: K('1'),
        lastFrameUri: run.keyframeUri,
        // The whole prompt it was made with (the stored copy is cut at 512 characters).
        prompt: FULL_PROMPT,
        startMs: 0,
        transitionId: 'transition_0',
      }),
      expect.objectContaining({
        endMs: 8720,
        firstFrameUri: run.keyframeUri,
        lastFrameUri: K('3'),
        prompt: 'stored prompt 1',
        startMs: 5400,
        transitionId: 'transition_1',
      }),
    ])
    // The keyframe itself changes only once the clips are made (commitKeyframe).
    expect(
      (files.get('long_take/keyframes.json') as { keyframeUrl: string }[])[1].keyframeUrl,
    ).toBe(K('2'))
    const old = files.get('long_take/keyframes/2.png')
    await svc.commitKeyframe('p1', '2', run)
    expect(
      (files.get('long_take/keyframes.json') as { keyframeUrl: string }[])[1].keyframeUrl,
    ).toBe(run.keyframeUri)
    // Under the keyframe's own name too, where the agent looks; the old one is kept.
    expect(files.get('long_take/keyframes/2.png')).toEqual(NEW)
    expect(files.get(`long_take/keyframes/replaced/${run.picturePath.split('/').pop()}`)).toBe(old)
  })

  it("keeps the stored prompt when the clip's record can't be read", async () => {
    await storeStoryVideo()
    const { prisma, svc } = makeService()
    prisma.generationRecord.findMany.mockRejectedValueOnce(new Error('db down'))
    await svc.remakeClipsWithKeyframe('p1', '2', NEW, USER as never)
    const [, opts] = start.mock.calls[0] as [
      string,
      { args: { transitionList: { prompt: string }[] }[] },
    ]
    expect(opts.args[0].transitionList.map((t) => t.prompt)).toEqual([
      'stored prompt 0',
      'stored prompt 1',
    ])
  })

  it('refuses a loop short and a run already going on that keyframe', async () => {
    await storeStoryVideo()
    await expect(
      makeService({}, true).svc.remakeClipsWithKeyframe('p1', 'f2', NEW, USER as never),
    ).rejects.toBeInstanceOf(BadRequestException)
    start.mockRejectedValueOnce(
      Object.assign(new Error('started'), { name: 'WorkflowExecutionAlreadyStartedError' }),
    )
    await expect(
      makeService().svc.remakeClipsWithKeyframe('p1', '2', NEW, USER as never),
    ).rejects.toBeInstanceOf(ConflictException)
  })

  it("swaps a loop short's keyframe through its own service, which runs the loop", async () => {
    const { beatLoop, svc } = makeService({}, true)
    await expect(svc.swapLoopKeyframe('p1', 'f2', NEW, USER as never)).resolves.toMatchObject({
      workflowId: 'ao:p1:story-mode',
    })
    expect(beatLoop.swapKeyframe).toHaveBeenCalledWith('p1', 'f2', NEW, USER)
  })
})
