const readBeatLoopSfxBed = jest.fn()
const rebuildBeatLoopSfxBed = jest.fn()
jest.mock('@reelmakeeasy/common/long-take/beat-loop-sfx-bed', () => ({
  BEAT_LOOP_SFX_BED_PATH: 'long_take/beat_loop_sfx.m4a',
  readBeatLoopSfxBed: (...args: unknown[]) => readBeatLoopSfxBed(...args),
  rebuildBeatLoopSfxBed: (...args: unknown[]) => rebuildBeatLoopSfxBed(...args),
}))

// The project's folders, by project id.
const projects = new Map<string, Map<string, unknown>>()
jest.mock('@reelmakeeasy/common/agent-v2/storage/storage', () => ({
  createStorage: async (projectId: string) => folder(projectId),
}))

import {
  createLoopSfxBedRebuilds,
  loopSfxBedRebuilds,
  readLoopSfxBedStatus,
} from './long-take-loop-sfx-bed.util'

const CLIPS = 'long_take/beat_loop_clips.mp4'
const STORYBOARD = 'long_take/beat_loop.json'

function folder(projectId: string) {
  const files = projects.get(projectId) ?? new Map<string, unknown>()
  return {
    exists: async (p: string) => files.has(p),
    getFullPath: (p: string) => `store://projects/${projectId}/${p}`,
    getObjectMetadata: async () => undefined,
    readJsonFile: async <T>(p: string): Promise<T> => {
      if (!files.has(p)) throw new Error(`No such object: ${p}`)
      return structuredClone(files.get(p)) as T
    },
  }
}

const RECORD = {
  durationS: 8,
  gainDb: 2,
  sfxGainDb: -12.1,
  version: 1,
  voiceGainDb: -5,
  volume: 35.1,
}

// No bed, and none coming: play the delivered file.
const NO_BED = {
  loopClipsUrl: null,
  loopSfxBedPending: false,
  loopSfxBedUrl: null,
  loopSfxBedVolume: null,
}
// No bed yet, one being built: worth reading the status again.
const BUILDING = { ...NO_BED, loopSfxBedPending: true }

const logger = { warn: jest.fn() }

/** A loop whose render is done, with its joined clips and storyboard stored. */
function finishedLoop(projectId: string) {
  projects.set(
    projectId,
    new Map<string, unknown>([
      [CLIPS, 'clips'],
      [STORYBOARD, { storyboard: { clips: [{ id: 'c1' }, { id: 'c2' }], duration_s: 8 } }],
    ]),
  )
  return folder(projectId)
}

beforeEach(() => {
  projects.clear()
  readBeatLoopSfxBed.mockReset()
  rebuildBeatLoopSfxBed.mockReset()
  logger.warn.mockClear()
})

describe('readLoopSfxBedStatus', () => {
  it('gives a loop its bed, the URL built on read and keyed to the file, and its volume', async () => {
    readBeatLoopSfxBed.mockResolvedValue({
      clipsVersion: '11',
      record: RECORD,
      state: 'current',
      version: '17',
    })
    const storage = finishedLoop('p1')
    const status = await readLoopSfxBedStatus(
      storage,
      { kind: 'loop', projectId: 'p1', settled: true },
      logger,
    )
    expect(status).toEqual({
      // The joined clips the bed was made from, keyed to their own file.
      loopClipsUrl:
        'http://localhost:5017/api/files/projects/p1/long_take/beat_loop_clips.mp4?v=11',
      loopSfxBedPending: false,
      loopSfxBedUrl: 'http://localhost:5017/api/files/projects/p1/long_take/beat_loop_sfx.m4a?v=17',
      loopSfxBedVolume: 35.1,
    })
    expect(readBeatLoopSfxBed).toHaveBeenCalledWith(storage, { clipsPath: CLIPS })
    expect(rebuildBeatLoopSfxBed).not.toHaveBeenCalled()

    // A storage that reports no versions: the plain URL.
    readBeatLoopSfxBed.mockResolvedValue({ record: { ...RECORD, volume: 0 }, state: 'current' })
    expect(
      await readLoopSfxBedStatus(storage, { kind: 'loop', projectId: 'p1', settled: true }, logger),
    ).toEqual({
      loopClipsUrl: 'http://localhost:5017/api/files/projects/p1/long_take/beat_loop_clips.mp4',
      loopSfxBedPending: false,
      loopSfxBedUrl: 'http://localhost:5017/api/files/projects/p1/long_take/beat_loop_sfx.m4a',
      loopSfxBedVolume: 0,
    })
  })

  it('is null for any other video, reading nothing', async () => {
    const storage = finishedLoop('p1')
    const status = await readLoopSfxBedStatus(
      storage,
      { kind: 'video', projectId: 'p1', settled: true },
      logger,
    )
    expect(status).toEqual(NO_BED)
    expect(readBeatLoopSfxBed).not.toHaveBeenCalled()
    expect(
      await readLoopSfxBedStatus(null, { kind: 'loop', projectId: 'p1', settled: true }, logger),
    ).toEqual(NO_BED)
  })

  it.each(['missing', 'stale'] as const)(
    'is null for a %s bed, and builds a finished loop its bed in the background, saying so',
    async (state) => {
      readBeatLoopSfxBed.mockResolvedValue({ state })
      let finish: () => void = () => undefined
      rebuildBeatLoopSfxBed.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)))
      const storage = finishedLoop('p1')

      // The status does not wait for the build.
      const status = await readLoopSfxBedStatus(
        storage,
        { kind: 'loop', projectId: 'p1', settled: true },
        logger,
      )
      expect(status).toEqual(BUILDING)
      await flush()
      expect(rebuildBeatLoopSfxBed).toHaveBeenCalledTimes(1)
      const [into, input] = rebuildBeatLoopSfxBed.mock.calls[0]
      expect(input).toEqual({ clipsPath: CLIPS, durationS: 8 })
      expect(into.getFullPath('x')).toBe('store://projects/p1/x')

      // Polled again meanwhile: one build, still under way.
      expect(
        await readLoopSfxBedStatus(
          storage,
          { kind: 'loop', projectId: 'p1', settled: true },
          logger,
        ),
      ).toEqual(BUILDING)
      await flush()
      expect(rebuildBeatLoopSfxBed).toHaveBeenCalledTimes(1)
      finish()
      await loopSfxBedRebuilds.idle()

      // Built: the next read has the bed, and nothing left to wait for.
      readBeatLoopSfxBed.mockResolvedValue({ record: RECORD, state: 'current', version: '18' })
      expect(
        await readLoopSfxBedStatus(
          storage,
          { kind: 'loop', projectId: 'p1', settled: true },
          logger,
        ),
      ).toMatchObject({ loopSfxBedPending: false, loopSfxBedVolume: 35.1 })
    },
  )

  it('stops saying a bed is coming once its build has failed', async () => {
    readBeatLoopSfxBed.mockResolvedValue({ state: 'missing' })
    rebuildBeatLoopSfxBed.mockRejectedValue(new Error('ffmpeg failed: corrupt clips'))
    const storage = finishedLoop('p3')
    const read = () =>
      readLoopSfxBedStatus(storage, { kind: 'loop', projectId: 'p3', settled: true }, logger)

    expect(await read()).toEqual(BUILDING)
    await loopSfxBedRebuilds.idle()
    // Not tried again for a while: a client polling for the bed can stop.
    expect(await read()).toEqual(NO_BED)
    await loopSfxBedRebuilds.idle()
    expect(rebuildBeatLoopSfxBed).toHaveBeenCalledTimes(1)
  })

  it('says no bed is coming while a render runs, even with a build queued before it', async () => {
    readBeatLoopSfxBed.mockResolvedValue({ state: 'missing' })
    let finish: () => void = () => undefined
    rebuildBeatLoopSfxBed.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)))
    const storage = finishedLoop('p4')
    const read = (settled: boolean) =>
      readLoopSfxBedStatus(storage, { kind: 'loop', projectId: 'p4', settled }, logger)

    try {
      expect(await read(true)).toEqual(BUILDING)
      // A render starts while that build runs: the render writes the bed itself.
      expect(await read(false)).toEqual(NO_BED)
    } finally {
      finish()
      await loopSfxBedRebuilds.idle()
    }
    expect(rebuildBeatLoopSfxBed).toHaveBeenCalledTimes(1)
  })

  it('queues no second build when the one it saw running finishes during the read', async () => {
    let finish: () => void = () => undefined
    rebuildBeatLoopSfxBed.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)))
    readBeatLoopSfxBed.mockResolvedValueOnce({ state: 'missing' })
    const storage = finishedLoop('p5')
    const read = () =>
      readLoopSfxBedStatus(storage, { kind: 'loop', projectId: 'p5', settled: true }, logger)

    expect(await read()).toEqual(BUILDING)
    await flush()
    // The next read looks before the build writes the bed, and the build ends meanwhile.
    readBeatLoopSfxBed.mockImplementationOnce(async () => {
      finish()
      await loopSfxBedRebuilds.idle()
      return { state: 'missing' }
    })
    expect(await read()).toEqual(BUILDING)
    await loopSfxBedRebuilds.idle()
    expect(rebuildBeatLoopSfxBed).toHaveBeenCalledTimes(1)

    // The read after that finds the bed.
    readBeatLoopSfxBed.mockResolvedValue({ record: RECORD, state: 'current', version: '3' })
    expect(await read()).toMatchObject({ loopSfxBedPending: false, loopSfxBedVolume: 35.1 })
  })

  it('builds nothing while a render runs, or for a loop with no joined clips to build from', async () => {
    readBeatLoopSfxBed.mockResolvedValue({ state: 'missing' })
    const storage = finishedLoop('p1')
    expect(
      await readLoopSfxBedStatus(
        storage,
        { kind: 'loop', projectId: 'p1', settled: false },
        logger,
      ),
    ).toEqual(NO_BED)

    projects.set('p2', new Map<string, unknown>([[STORYBOARD, { clips: [{ id: 'c1' }] }]]))
    const older = await readLoopSfxBedStatus(
      folder('p2'),
      { kind: 'loop', projectId: 'p2', settled: true },
      logger,
    )
    expect(older).toEqual(NO_BED)
    await loopSfxBedRebuilds.idle()
    expect(rebuildBeatLoopSfxBed).not.toHaveBeenCalled()
  })

  it('reads null, and only warns, when the folder cannot be read', async () => {
    readBeatLoopSfxBed.mockRejectedValue(new Error('storage unavailable'))
    const status = await readLoopSfxBedStatus(
      finishedLoop('p1'),
      { kind: 'loop', projectId: 'p1', settled: true },
      logger,
    )
    expect(status).toEqual(NO_BED)
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/sound bed.*storage unavailable/),
    )
  })
})

describe('createLoopSfxBedRebuilds', () => {
  it('builds one bed at a time, in the order asked', async () => {
    const order: string[] = []
    const releases: Array<() => void> = []
    const rebuilds = createLoopSfxBedRebuilds({
      build: (projectId) => {
        order.push(`start ${projectId}`)
        return new Promise<void>((resolve) =>
          releases.push(() => {
            order.push(`end ${projectId}`)
            resolve()
          }),
        )
      },
    })
    expect(rebuilds.schedule('a', logger)).toBe(true)
    expect(rebuilds.schedule('b', logger)).toBe(true)
    await flush()
    expect(order).toEqual(['start a'])
    releases[0]()
    await flush()
    expect(order).toEqual(['start a', 'end a', 'start b'])
    releases[1]()
    await rebuilds.idle()
    expect(order).toEqual(['start a', 'end a', 'start b', 'end b'])
  })

  it('says which projects have a build queued or running', async () => {
    const releases: Array<() => void> = []
    const rebuilds = createLoopSfxBedRebuilds({
      build: () => new Promise<void>((resolve) => releases.push(resolve)),
    })
    expect(rebuilds.pending('a')).toBe(false)
    rebuilds.schedule('a', logger)
    rebuilds.schedule('b', logger)
    await flush()
    // 'a' builds, 'b' waits its turn: both pending.
    expect([rebuilds.pending('a'), rebuilds.pending('b')]).toEqual([true, true])
    releases[0]()
    await flush()
    expect([rebuilds.pending('a'), rebuilds.pending('b')]).toEqual([false, true])
    releases[1]()
    await rebuilds.idle()
    expect(rebuilds.pending('b')).toBe(false)
  })

  it('tries a failed build again only after a while, and says why it failed', async () => {
    let now = 1_000_000
    const build = jest.fn(async () => {
      throw new Error('ffmpeg failed: corrupt clips')
    })
    const rebuilds = createLoopSfxBedRebuilds({ build, now: () => now, retryMs: 60_000 })

    rebuilds.schedule('a', logger)
    expect(rebuilds.pending('a')).toBe(true)
    await rebuilds.idle()
    expect(logger.warn).toHaveBeenCalledWith(expect.stringMatching(/sound bed.*corrupt clips/))
    expect(rebuilds.pending('a')).toBe(false)
    expect(rebuilds.schedule('a', logger)).toBe(false)
    expect(rebuilds.pending('a')).toBe(false)
    now += 59_000
    expect(rebuilds.schedule('a', logger)).toBe(false)
    now += 2000
    expect(rebuilds.schedule('a', logger)).toBe(true)
    await rebuilds.idle()
    expect(build).toHaveBeenCalledTimes(2)
  })
})

/** Lets queued promise callbacks run. */
async function flush() {
  for (let i = 0; i < 10; i++) await Promise.resolve()
}
