const regenerateIntoNewProject = jest.fn()
const retryEligibility = jest.fn()
jest.mock('./long-take-regenerate.util', () => ({
  ...jest.requireActual('./long-take-regenerate.util'),
  regenerateLongTakeIntoNewProject: (...args: unknown[]) => regenerateIntoNewProject(...args),
  resolveLongTakeRetryEligibility: (...args: unknown[]) => retryEligibility(...args),
}))
const start = jest.fn(async () => undefined)
jest.mock('@reelmakeeasy/common/workflow/client', () => ({
  createClient: async () => ({ workflow: { start } }),
}))
/** The project's stored JSON files, by path; any other read fails as a missing object would. */
const files = new Map<string, unknown>()
jest.mock('@reelmakeeasy/common/agent-v2/storage/storage', () => ({
  ...jest.requireActual('@reelmakeeasy/common/agent-v2/storage/storage'),
  createStorage: async () => ({
    readJsonFile: async (path: string) => {
      if (!files.has(path)) throw Object.assign(new Error(`No such object: ${path}`), { code: 404 })
      return files.get(path)
    },
  }),
}))
jest.mock('@reelmakeeasy/common/inpaint/state-store', () => ({
  ...jest.requireActual('@reelmakeeasy/common/inpaint/state-store'),
  readInpaintState: async () => null,
}))

import {
  resetGenerationProviderForTesting,
  setGenerationProvider,
  setGenerationUnavailable,
} from '@reelmakeeasy/llm/registry'
import { BadRequestException, ConflictException } from '@nestjs/common'

import { LongTakeService } from './long-take.service'

const USER = { email: 'you@reelmakeeasy.local', orgId: 'o', sub: 'u', userId: 'u' }

function makeService(
  createUseCase: null | string = 'beat-loop',
  project: Record<string, unknown> = {},
) {
  const projectsService = {
    canVisitProject: jest.fn(async () => true),
    getProject: jest.fn(async () => ({ createUseCase, id: 'p1', ...project })),
    internalUpdateProject: jest.fn(async () => undefined),
  }
  const loop = createUseCase === 'beat-loop'
  const beatLoop = {
    canResume: jest.fn(async () => true),
    checkLines: jest.fn(async () => ({ lines: [], voice: { free: true, id: 'v', name: 'V' } })),
    isBeatLoopProject: jest.fn(async () => loop),
    regenerateClip: jest.fn(async () => ({ clipIds: ['c2'], workflowId: 'w' })),
    resume: jest.fn(async () => ({ projectId: 'p1', workflowId: 'ao:p1:story-mode' })),
    start: jest.fn(async () => ({ projectId: 'p1', workflowId: 'ao:p1:story-mode' })),
  }
  const svc = new LongTakeService(
    projectsService as never,
    {} as never,
    { del: jest.fn() } as never,
    {} as never,
    {} as never,
    beatLoop as never,
  )
  return { beatLoop, projectsService, svc }
}

beforeEach(() => {
  files.clear()
  regenerateIntoNewProject.mockReset().mockResolvedValue({ projectId: 'p2', workflowId: 'w2' })
  retryEligibility.mockReset().mockResolvedValue({ canRegenerate: false })
  start.mockClear()
  setGenerationProvider('fal')
})
afterEach(() => resetGenerationProviderForTesting())

describe('LongTakeService with loop shorts', () => {
  it('starts a loop through BeatLoopService, and refuses first when nothing can make it', async () => {
    const { beatLoop, svc } = makeService()
    const input = { projectId: 'p1', storyboard: {} as never, style: 'x', user: USER as never }
    await expect(svc.startBeatLoop(input)).resolves.toEqual({
      projectId: 'p1',
      workflowId: 'ao:p1:story-mode',
    })
    expect(beatLoop.start).toHaveBeenCalledWith(input)

    setGenerationUnavailable('Add FAL_KEY or GEMINI_API_KEY to .env, then restart')
    await expect(svc.startBeatLoop(input)).rejects.toBeInstanceOf(ConflictException)
    await expect(
      svc.regenerateLoopClip('p1', 'c2', { redoFollowing: true }, USER as never),
    ).rejects.toBeInstanceOf(ConflictException)
    expect(beatLoop.start).toHaveBeenCalledTimes(1)
    expect(beatLoop.regenerateClip).not.toHaveBeenCalled()
  })

  it("checks a loop's lines through BeatLoopService, refusing first when nothing can make it", async () => {
    const { beatLoop, svc } = makeService()
    const input = { storyboard: {} as never, user: USER as never, voice: 'Sarah' }
    await expect(svc.checkBeatLoopLines(input)).resolves.toEqual({
      lines: [],
      voice: { free: true, id: 'v', name: 'V' },
    })
    expect(beatLoop.checkLines).toHaveBeenCalledWith(input)

    // No line is said (a paid voice costs) for a loop that can't be made.
    setGenerationUnavailable('Add FAL_KEY or GEMINI_API_KEY to .env, then restart')
    await expect(svc.checkBeatLoopLines(input)).rejects.toBeInstanceOf(ConflictException)
    expect(beatLoop.checkLines).toHaveBeenCalledTimes(1)
  })

  it('redoes a loop clip and tells the tool layer whether a project is a loop', async () => {
    const { beatLoop, svc } = makeService()
    await svc.regenerateLoopClip('p1', 'c2', { redoFollowing: true }, USER as never)
    expect(beatLoop.regenerateClip).toHaveBeenCalledWith('p1', 'c2', { redoFollowing: true }, USER)
    await expect(svc.isBeatLoopProject('p1')).resolves.toBe(true)
  })

  it('Try again on a loop runs it again in the same project, not a long-take regenerate', async () => {
    const { beatLoop, svc } = makeService()
    await expect(
      svc.regenerateLongTake('p1', { transitionVideoModel: 'minimax-h3-max-turbo' }, USER as never),
    ).resolves.toEqual({ projectId: 'p1', workflowId: 'ao:p1:story-mode' })
    expect(beatLoop.resume).toHaveBeenCalledWith('p1', USER)
    expect(regenerateIntoNewProject).not.toHaveBeenCalled()

    await expect(svc.getLongTakeRetryEligibility('p1')).resolves.toEqual({ canRegenerate: true })
    beatLoop.canResume.mockResolvedValueOnce(false)
    await expect(svc.getLongTakeRetryEligibility('p1')).resolves.toEqual({ canRegenerate: false })
    expect(retryEligibility).not.toHaveBeenCalled()
  })

  it('a story video still regenerates into a new project', async () => {
    const { beatLoop, svc } = makeService(null)
    await expect(
      svc.regenerateLongTake('p1', { transitionVideoModel: 'minimax-h3-max-turbo' }, USER as never),
    ).resolves.toEqual({ projectId: 'p2', workflowId: 'w2' })
    expect(beatLoop.resume).not.toHaveBeenCalled()
    await svc.getLongTakeRetryEligibility('p1')
    expect(retryEligibility).toHaveBeenCalled()
  })

  it("the editor state shows a loop's keyframes as they are made, before keyframes.json", async () => {
    const { svc } = makeService()
    files.set('long_take/beat_loop_keyframes.json', {
      complete: false,
      dialect: 'h3',
      frames: [{ id: 'f0', prompt: 'p', uri: 'https://files/f0.png' }],
    })

    const state = await svc.getStateWithUnrenderedChanges('p1')

    expect(state.data.keyframes).toEqual([{ keyframeUrl: 'https://files/f0.png', shotId: 'f0' }])
    expect(state.hasUnrenderedChanges).toBe(false)
  })

  it('makes music for a loop like for any video: a new bed, then the delivered loop rebuilt', async () => {
    const { projectsService, svc } = makeService('beat-loop', {
      bgmEnabled: false,
      duration: 24,
      resultVideo: 'https://files/p1/final_video.mp4',
    })
    await expect(
      svc.createBgmVersion('p1', { note: 'warm piano' }, USER as never),
    ).resolves.toEqual({ workflowId: expect.stringContaining('bgm-regen') })
    expect(start).toHaveBeenCalledWith(
      'LongTakeBgmRegenerateWorkflow',
      expect.objectContaining({
        args: [
          expect.objectContaining({ bgmEnabled: true, durationSec: 24, remuxDelivered: true }),
        ],
      }),
    )
    // Asking for music turns it on.
    expect(projectsService.internalUpdateProject).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({ bgmEnabled: true }),
      'u',
      'o',
    )
  })

  it("refuses a long-take clip redo on a loop: it would break the loop's beat", async () => {
    const { svc } = makeService()
    await expect(
      svc.regenerateTransitionFromState('p1', 'c2', 'a prompt', USER as never, {
        promptIsFinal: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException)
    await expect(
      svc.regenerateTransition(
        'p1',
        'c2',
        { transitionList: [{ firstFrameUrl: 'a', lastFrameUrl: 'b', transitionId: 'c2' }] },
        USER as never,
      ),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(start).not.toHaveBeenCalled()
  })
})
