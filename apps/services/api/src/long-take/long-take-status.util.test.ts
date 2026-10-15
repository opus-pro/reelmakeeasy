// The project's folder: null when storage is unavailable.
let files: Map<string, unknown> | null = null
jest.mock('@reelmakeeasy/common/agent-v2/storage/storage', () => ({
  createStorage: async () => {
    if (!files) throw new Error('no storage in unit tests')
    const folder = files
    return {
      exists: async (path: string) => folder.has(path),
      getFullPath: (path: string) => `store://projects/p1/${path}`,
      // Like a backend that reports no generations.
      getObjectMetadata: async () => undefined,
      readJsonFile: async (path: string) => {
        if (!folder.has(path)) throw new Error('No such object')
        return structuredClone(folder.get(path))
      },
      readTextFile: async () => {
        throw new Error('No such object')
      },
    }
  },
}))
jest.mock('@reelmakeeasy/common/long-take/queue-admission', () => ({
  getLongTakeAdmissionPayload: async () => null,
}))
jest.mock('./long-take-workflow.util', () => ({
  buildQueuedAdmissionMeta: async () => undefined,
  resolveUploadedAudioUrl: async () => null,
}))
// A loop's missing clip sound bed is built in the background: no FFmpeg here.
const rebuildBeatLoopSfxBed = jest.fn(async () => undefined)
jest.mock('@reelmakeeasy/common/long-take/beat-loop-sfx-bed', () => ({
  ...jest.requireActual('@reelmakeeasy/common/long-take/beat-loop-sfx-bed'),
  rebuildBeatLoopSfxBed: () => rebuildBeatLoopSfxBed(),
}))

import { getLongTakeStatusKey } from '@reelmakeeasy/common/long-take'

import { loopSfxBedRebuilds } from './long-take-loop-sfx-bed.util'
import { buildLongTakeStatus, type StatusDeps } from './long-take-status.util'

function makeDeps(project: Record<string, unknown>) {
  return {
    kv: { getObject: jest.fn(async () => null), set: jest.fn() },
    logger: { warn: jest.fn() },
    projectsService: {
      canVisitProject: async () => true,
      getProject: async () => ({
        isLongTake: true,
        resultVideo: 'https://cdn.reelmakeeasy.local/p1/final_video.mp4',
        stage: 'FINISHED',
        ...project,
      }),
      internalUpdateProject: jest.fn(async () => undefined),
    },
  } as unknown as StatusDeps
}

describe('buildLongTakeStatus: caption settings', () => {
  it('exposes the caption look saved on the project', async () => {
    const captionStyle = { accent: '#FFE500', position: 66, preset: 'punch', size: 120 }
    const status = await buildLongTakeStatus(makeDeps({ captionStyle }), 'p1')
    expect(status?.captionStyle).toEqual(captionStyle)
  })

  it('reads null when nobody chose one, so the client applies the default', async () => {
    const status = await buildLongTakeStatus(makeDeps({ captionStyle: null }), 'p1')
    expect(status?.captionStyle).toBeNull()
    const legacy = await buildLongTakeStatus(makeDeps({}), 'p1')
    expect(legacy?.captionStyle).toBeNull()
  })

  it('drops malformed saved fields', async () => {
    const status = await buildLongTakeStatus(
      makeDeps({ captionStyle: { accent: 'green', preset: 'explainer', size: 'big' } }),
      'p1',
    )
    expect(status?.captionStyle).toEqual({ preset: 'explainer' })
  })
})

describe('buildLongTakeStatus: the caption look of the delivered file', () => {
  const PUNCH = { accent: '#04F827', position: null, preset: 'punch', size: 100 }
  const CLASSIC = { ...PUNCH, preset: 'classic' }
  const script = (captionStyle?: unknown) => ({
    captionRenderPref: {},
    ...(captionStyle ? { captionStyle } : {}),
    tracks: [],
  })
  /** What a render leaves once its file is uploaded: the look final_video.mp4 has. */
  const RECORD = 'final_video_caption_style.json'
  /** long_take/beat_loop.json as the app writes it (BeatLoopFile): the storyboard is inside. */
  const loopFile = (storyboard: Record<string, unknown>) => ({
    createdAt: '2026-10-11T00:00:00.000Z',
    format: 'beat_loop',
    storyboard: { clips: [{ id: 'c1' }], duration_s: 4, ...storyboard },
    style: 'Paper cut-outs',
    updatedAt: '2026-10-11T00:00:00.000Z',
    version: 1,
  })

  afterEach(() => {
    files = null
  })

  it("reports a loop: its kind, the storyboard's suggested highlight, and the look its file has", async () => {
    files = new Map<string, unknown>([
      ['long_take/beat_loop.json', loopFile({ accent: '#ffe500' })],
      [RECORD, { captionStyle: PUNCH }],
    ])
    const status = await buildLongTakeStatus(makeDeps({}), 'p1')
    expect(status).toMatchObject({
      captionAccentSuggestion: '#FFE500',
      captionKind: 'loop',
      renderedCaptionStyle: PUNCH,
    })
  })

  it('reports any other video as a video, with nothing suggested', async () => {
    files = new Map<string, unknown>([[RECORD, { captionStyle: CLASSIC }]])
    const status = await buildLongTakeStatus(makeDeps({}), 'p1')
    expect(status).toMatchObject({
      captionAccentSuggestion: null,
      captionKind: 'video',
      renderedCaptionStyle: CLASSIC,
    })
  })

  it('reads null for a file rendered before caption looks were recorded, or for no file', async () => {
    files = new Map<string, unknown>([['storyboard/video_script.json', script()]])
    const before = await buildLongTakeStatus(makeDeps({}), 'p1')
    expect(before?.renderedCaptionStyle).toBeNull()

    // A record with no file says nothing about a file.
    files = new Map<string, unknown>([[RECORD, { captionStyle: PUNCH }]])
    const undelivered = await buildLongTakeStatus(
      makeDeps({ resultVideo: null, stage: 'GENERATING' }),
      'p1',
    )
    expect(undelivered?.renderedCaptionStyle).toBeNull()
  })

  it("trusts only the delivered file's record, not the script a later render prepared", async () => {
    // The user picked Punch and exported; the render wrote its script, then failed (or is
    // still running, or the API restarted). final_video.mp4 is still the Classic one.
    files = new Map<string, unknown>([
      ['storyboard/video_script.json', script(PUNCH)],
      [RECORD, { captionStyle: CLASSIC }],
    ])
    const failed = await buildLongTakeStatus(makeDeps({}), 'p1')
    expect(failed?.renderedCaptionStyle).toEqual(CLASSIC)

    // A file from before looks were recorded, with such a script beside it: still unknown.
    files = new Map<string, unknown>([['storyboard/video_script.json', script(PUNCH)]])
    const legacy = await buildLongTakeStatus(makeDeps({}), 'p1')
    expect(legacy?.renderedCaptionStyle).toBeNull()
  })

  it('suggests no highlight when the storyboard has no colour', async () => {
    for (const accent of [undefined, 'yellow', '#FFF', 7]) {
      files = new Map<string, unknown>([['long_take/beat_loop.json', loopFile({ accent })]])
      const status = await buildLongTakeStatus(makeDeps({}), 'p1')
      expect(status).toMatchObject({ captionAccentSuggestion: null, captionKind: 'loop' })
    }
  })

  it("reads the colour of a bare storyboard too (the render's lenient read)", async () => {
    files = new Map<string, unknown>([
      ['long_take/beat_loop.json', { accent: '#00e5ff', clips: [{ id: 'c1' }], duration_s: 4 }],
    ])
    const status = await buildLongTakeStatus(makeDeps({}), 'p1')
    expect(status).toMatchObject({ captionAccentSuggestion: '#00E5FF', captionKind: 'loop' })
  })

  it('ignores a colour beside the storyboard, where the app never writes one', async () => {
    files = new Map<string, unknown>([
      ['long_take/beat_loop.json', { ...loopFile({}), accent: '#FF3EA5' }],
    ])
    const status = await buildLongTakeStatus(makeDeps({}), 'p1')
    expect(status?.captionAccentSuggestion).toBeNull()
  })

  it('knows a loop by its project row when its folder cannot be read', async () => {
    const loop = await buildLongTakeStatus(makeDeps({ createUseCase: 'beat-loop' }), 'p1')
    expect(loop).toMatchObject({
      captionAccentSuggestion: null,
      captionKind: 'loop',
      renderedCaptionStyle: null,
    })
    const video = await buildLongTakeStatus(makeDeps({}), 'p1')
    expect(video?.captionKind).toBe('video')
  })
})

describe("buildLongTakeStatus: a loop's clip sound bed", () => {
  const BED = 'long_take/beat_loop_sfx.m4a'
  const BED_RECORD = 'long_take/beat_loop_sfx.json'
  const CLIPS = 'long_take/beat_loop_clips.mp4'
  const STORYBOARD = 'long_take/beat_loop.json'
  const record = {
    durationS: 8,
    gainDb: 2,
    sfxGainDb: -12.1,
    version: 1,
    voiceGainDb: -5,
    volume: 35.1,
  }
  const loop = { clips: [{ id: 'c1' }, { id: 'c2' }], duration_s: 8 }
  // No bed, and none being built: the chat plays the delivered file and need not wait.
  const NO_BED = {
    loopClipsUrl: null,
    loopSfxBedPending: false,
    loopSfxBedUrl: null,
    loopSfxBedVolume: null,
  }

  beforeEach(() => rebuildBeatLoopSfxBed.mockClear())
  afterEach(async () => {
    files = null
    await loopSfxBedRebuilds.idle()
  })

  it('gives a loop the URL of its bed, built on read, and the volume to play it at', async () => {
    files = new Map<string, unknown>([
      [BED, 'bed'],
      [BED_RECORD, record],
      [CLIPS, 'clips'],
      [STORYBOARD, loop],
    ])
    const status = await buildLongTakeStatus(makeDeps({}), 'p1')
    expect(status).toMatchObject({
      loopClipsUrl: 'http://localhost:5017/api/files/projects/p1/long_take/beat_loop_clips.mp4',
      loopSfxBedPending: false,
      loopSfxBedUrl: 'http://localhost:5017/api/files/projects/p1/long_take/beat_loop_sfx.m4a',
      loopSfxBedVolume: 35.1,
    })
  })

  it('reads null for any other video, whatever its folder holds', async () => {
    files = new Map<string, unknown>([
      [BED, 'bed'],
      [BED_RECORD, record],
    ])
    const status = await buildLongTakeStatus(makeDeps({}), 'p1')
    expect(status).toMatchObject(NO_BED)
  })

  it('reads null for a loop without a bed, and says one is coming while it is built in the background', async () => {
    files = new Map<string, unknown>([
      [CLIPS, 'clips'],
      [STORYBOARD, loop],
    ])
    const status = await buildLongTakeStatus(makeDeps({}), 'p1')
    expect(status).toMatchObject({ ...NO_BED, loopSfxBedPending: true })
    await loopSfxBedRebuilds.idle()
    expect(rebuildBeatLoopSfxBed).toHaveBeenCalledTimes(1)
  })

  it('builds no bed while a render runs, nor before the loop has a file', async () => {
    files = new Map<string, unknown>([
      [CLIPS, 'clips'],
      [STORYBOARD, loop],
    ])
    const rendering = makeDeps({})
    ;(rendering.kv.getObject as jest.Mock).mockImplementation(async (key: string) =>
      key === getLongTakeStatusKey('p1') ? { stage: 'render', status: 'in_progress' } : null,
    )
    const status = await buildLongTakeStatus(rendering, 'p1')
    expect(status).toMatchObject(NO_BED)

    const generating = await buildLongTakeStatus(
      makeDeps({ resultVideo: null, stage: 'GENERATING' }),
      'p1',
    )
    expect(generating).toMatchObject(NO_BED)
    await loopSfxBedRebuilds.idle()
    expect(rebuildBeatLoopSfxBed).not.toHaveBeenCalled()
  })
})

describe('buildLongTakeStatus: a finished video the project lost track of', () => {
  afterEach(() => {
    files = null
  })

  it('saves the delivered video and its thumbnail as addresses, never a URL with a port', async () => {
    // FINISHED with no resultVideo and no status left: the delivered file is picked up again.
    files = new Map<string, unknown>([['final_video.mp4', {}]])
    const deps = makeDeps({ resultVideo: null, stage: 'FINISHED' })
    const status = await buildLongTakeStatus(deps, 'p1')
    expect(deps.projectsService.internalUpdateProject).toHaveBeenCalledWith(
      'p1',
      {
        previewThumbnail: 'store://agent/workspace/p1/_thumbnail/final_video.mp4.jpg',
        resultVideo: 'store://agent/workspace/p1/final_video.mp4',
        resultVideoThumbnail: 'store://agent/workspace/p1/_thumbnail/final_video.mp4.jpg',
        stage: 'FINISHED',
      },
      'system',
    )
    // The status carries the address too: the API serves it as a URL on the way out.
    expect(status?.videoUrl).toBe('store://agent/workspace/p1/final_video.mp4')
  })
})
