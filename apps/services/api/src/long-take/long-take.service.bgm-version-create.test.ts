const start = jest.fn(async () => undefined)
jest.mock('@reelmakeeasy/common/workflow/client', () => ({
  createClient: async () => ({ workflow: { start } }),
}))
jest.mock('./long-take-workflow.util', () => ({
  ...jest.requireActual('./long-take-workflow.util'),
  resolveStoryModeTaskQueue: async () => 'story-mode',
}))

import { BGM_DEFAULT_VOLUME } from '@reelmakeeasy/common/long-take/bgm-volume'

import { LongTakeService } from './long-take.service'

const USER = { email: 'you@reelmakeeasy.local', orgId: 'o', sub: 'u', userId: 'u' }

function makeService(project: Record<string, unknown>) {
  const projectsService = {
    canVisitProject: jest.fn(async () => true),
    getProject: jest.fn(async () => project),
    internalUpdateProject: jest.fn(async () => undefined),
  }
  const kv = { del: jest.fn(async () => undefined) }
  const svc = new LongTakeService(
    projectsService as never,
    {} as never,
    kv as never,
    {} as never,
    {} as never,
    {} as never,
  )
  return { kv, projectsService, svc }
}

const STATUS_CACHE_KEY = 'long-take:status-cache:p1'

describe('createBgmVersion', () => {
  beforeEach(() => start.mockClear())

  it('turns music on for the project, so the new bed is put into the delivered video', async () => {
    const { projectsService, svc } = makeService({
      bgmEnabled: false,
      duration: 30,
      id: 'p1',
      resultVideo: 'final_video.mp4',
    })
    await svc.createBgmVersion('p1', {}, USER as never)
    expect(projectsService.internalUpdateProject).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({ bgmEnabled: true }),
      'u',
      'o',
    )
    expect(start).toHaveBeenCalledWith(
      'LongTakeBgmRegenerateWorkflow',
      expect.objectContaining({
        args: [
          expect.objectContaining({ bgmEnabled: true, projectId: 'p1', remuxDelivered: true }),
        ],
      }),
    )
  })

  it('drops the cached status so the page reads the change back at once', async () => {
    const { kv, svc } = makeService({
      bgmEnabled: false,
      duration: 30,
      id: 'p1',
      resultVideo: 'final_video.mp4',
    })
    await svc.createBgmVersion('p1', {}, USER as never)
    expect(kv.del).toHaveBeenCalledWith(STATUS_CACHE_KEY)
  })

  it('leaves a project that already has music on alone', async () => {
    const { projectsService, svc } = makeService({
      bgmEnabled: true,
      duration: 30,
      id: 'p1',
      resultVideo: 'final_video.mp4',
    })
    await svc.createBgmVersion('p1', { prompt: 'warm piano' }, USER as never)
    expect(projectsService.internalUpdateProject).not.toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({ bgmEnabled: true }),
      expect.anything(),
      expect.anything(),
    )
    expect(start).toHaveBeenCalledWith(
      'LongTakeBgmRegenerateWorkflow',
      expect.objectContaining({
        args: [expect.objectContaining({ bgmEnabled: true, prompt: 'warm piano' })],
      }),
    )
  })
})

describe('updateBgmSettings', () => {
  beforeEach(() => start.mockClear())

  it('persists the toggle, drops the cached status and starts the remux', async () => {
    const { kv, projectsService, svc } = makeService({
      bgmBedUri: 'store://projects/p1/bgm/bed-1.mp3',
      bgmEnabled: true,
      id: 'p1',
      resultVideo: 'final_video.mp4',
    })
    const r = await svc.updateBgmSettings('p1', { bgmEnabled: false }, USER as never)
    expect(projectsService.internalUpdateProject).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({ bgmEnabled: false }),
      'u',
    )
    expect(kv.del).toHaveBeenCalledWith(STATUS_CACHE_KEY)
    expect(r.remux).toBe('started')
    expect(start).toHaveBeenCalledWith(
      'LongTakeBgmRemuxWorkflow',
      expect.objectContaining({ args: [expect.objectContaining({ bgmEnabled: false })] }),
    )
  })
})

describe('createBgmVersion with a track', () => {
  beforeEach(() => start.mockClear())

  it('fits the chosen track: the workflow gets the track and no prompt', async () => {
    const projectsService = {
      canVisitProject: jest.fn(async () => true),
      getProject: jest.fn(async () => ({
        bgmEnabled: true,
        bgmNote: 'calm piano',
        duration: 30,
        id: 'p1',
        resultVideo: 'final_video.mp4',
      })),
      internalUpdateProject: jest.fn(async () => undefined),
    }
    const music = {
      resolveTrackArg: jest.fn(async () => ({
        id: 'bright-steps',
        source: 'library',
        title: 'Bright Steps',
      })),
    }
    const svc = new LongTakeService(
      projectsService as never,
      {} as never,
      { del: jest.fn(async () => undefined) } as never,
      {} as never,
      music as never,
      {} as never,
    )
    await svc.createBgmVersion(
      'p1',
      { track: { id: 'bright-steps', source: 'library' } },
      USER as never,
    )
    expect(music.resolveTrackArg).toHaveBeenCalledWith('u', {
      id: 'bright-steps',
      source: 'library',
    })
    expect(start).toHaveBeenCalledWith(
      'LongTakeBgmRegenerateWorkflow',
      expect.objectContaining({
        args: [
          expect.objectContaining({
            track: { id: 'bright-steps', source: 'library', title: 'Bright Steps' },
          }),
        ],
      }),
    )
    const args = (start.mock.calls[0] as unknown[])[1] as { args: Record<string, unknown>[] }
    expect(args.args[0]).not.toHaveProperty('prompt')
    expect(args.args[0]).not.toHaveProperty('userRequest')
  })
})

describe('createBgmVersion with a note', () => {
  beforeEach(() => start.mockClear())

  it('stores the wish on the project and hands it to the director, with no prompt', async () => {
    const { projectsService, svc } = makeService({
      bgmEnabled: true,
      bgmNote: 'old wish',
      duration: 30,
      id: 'p1',
      resultVideo: 'final_video.mp4',
    })
    await svc.createBgmVersion('p1', { note: 'warm guitar' }, USER as never)
    expect(projectsService.internalUpdateProject).toHaveBeenCalledWith(
      'p1',
      { bgmNote: 'warm guitar' },
      'u',
      'o',
    )
    const args = (start.mock.calls[0] as unknown[])[1] as { args: Record<string, unknown>[] }
    expect(args.args[0]).toMatchObject({ userRequest: 'warm guitar' })
    expect(args.args[0].prompt).toBeUndefined()
  })

  it('a null note clears the wish so the director picks freely', async () => {
    const { projectsService, svc } = makeService({
      bgmEnabled: true,
      bgmNote: 'old wish',
      duration: 30,
      id: 'p1',
      resultVideo: 'final_video.mp4',
    })
    await svc.createBgmVersion('p1', { note: null }, USER as never)
    expect(projectsService.internalUpdateProject).toHaveBeenCalledWith(
      'p1',
      { bgmNote: null },
      'u',
      'o',
    )
    const args = (start.mock.calls[0] as unknown[])[1] as { args: Record<string, unknown>[] }
    expect(args.args[0].userRequest).toBeUndefined()
  })
})

describe('a saved volume of 0 does not keep the music silent', () => {
  beforeEach(() => start.mockClear())

  it('turning music on resets 0% to the default level', async () => {
    const { projectsService, svc } = makeService({
      bgmBedUri: 'store://projects/p1/bgm/bed-1.mp3',
      bgmEnabled: false,
      bgmVolume: 0,
      id: 'p1',
      resultVideo: 'final_video.mp4',
    })
    await svc.updateBgmSettings('p1', { bgmEnabled: true }, USER as never)
    expect(projectsService.internalUpdateProject).toHaveBeenCalledWith(
      'p1',
      { bgmEnabled: true, bgmVolume: BGM_DEFAULT_VOLUME },
      'u',
    )
    expect(start).toHaveBeenCalledWith(
      'LongTakeBgmRemuxWorkflow',
      expect.objectContaining({
        args: [expect.objectContaining({ bgmVolume: BGM_DEFAULT_VOLUME })],
      }),
    )
  })

  it('a new bed on a project at 0% plays at the default level', async () => {
    const { projectsService, svc } = makeService({
      bgmEnabled: true,
      bgmVolume: 0,
      duration: 30,
      id: 'p1',
      resultVideo: 'final_video.mp4',
    })
    await svc.createBgmVersion('p1', { note: 'warm piano' }, USER as never)
    expect(projectsService.internalUpdateProject).toHaveBeenCalledWith(
      'p1',
      expect.objectContaining({ bgmVolume: BGM_DEFAULT_VOLUME }),
      'u',
      'o',
    )
    expect(start).toHaveBeenCalledWith(
      'LongTakeBgmRegenerateWorkflow',
      expect.objectContaining({
        args: [expect.objectContaining({ bgmVolume: BGM_DEFAULT_VOLUME })],
      }),
    )
  })
})
