import { resolveCaptionLook } from '../adapters/caption/caption-look'
import { getDefaultCaptionRenderPref } from '../adapters/caption/default-caption-render-pref'

const renderAndFinalizeFromScripts = jest.fn()
jest.mock('./render-and-finalize', () => ({
  renderAndFinalizeFromScripts: (...args: unknown[]) => renderAndFinalizeFromScripts(...args),
}))
jest.mock('./caption-track', () => ({ buildCaptionTrackIfEnabled: async () => undefined }))

import { prepareRenderScripts, renderFinal } from './render-final'
import type { RenderedVideoScript, RenderFinalStorage } from './render-final.types'

const written = new Map<string, unknown>()
const storage: RenderFinalStorage = {
  ensureDir: async (dir) => dir,
  getFullPath: (relativePath) => `store://projects/p1/${relativePath}`,
  readJsonFile: async () => {
    throw new Error('not read in these tests')
  },
  uploadFile: async () => undefined,
  writeJsonFile: async (pathName, data) => {
    written.set(pathName, data)
  },
}
const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() }
const transitionVideos = [
  {
    endMs: 4000,
    fromShotId: 'f0',
    prompt: '',
    startMs: 0,
    toShotId: 'f1',
    transitionId: 't1',
    videoUri: 'store://projects/p1/long_take/transitions/t1.mp4',
  },
]
const savedScript = () => written.get('storyboard/video_script.json') as RenderedVideoScript

describe('prepareRenderScripts: the caption look it records', () => {
  beforeEach(() => written.clear())

  it('saves the settings the caption style came from beside it, for the status to report', async () => {
    const opts = { aspectRatio: '9:16', kind: 'video' } as const
    const look = resolveCaptionLook({ accent: '#FFE500', preset: 'punch' }, opts)
    const prepared = await prepareRenderScripts({
      audioSourceUri: 'store://projects/p1/story_loader/audio/voice_over.mp3',
      captionRenderPref: look.captionRenderPref,
      captionStyle: look.captionStyle,
      logger,
      storage,
      transitionVideos,
    })

    expect(savedScript().captionRenderPref).toEqual(look.captionRenderPref)
    expect(savedScript().captionStyle).toEqual({
      accent: '#FFE500',
      position: null,
      preset: 'punch',
      size: 100,
    })
    // What the render engine is handed carries it too (the watermark copy is made from it).
    expect(prepared.videoScript).toEqual(savedScript())
  })

  it('writes no record when the caller has none (scripts stay as they were)', async () => {
    await prepareRenderScripts({
      audioSourceUri: 'store://projects/p1/story_loader/audio/voice_over.mp3',
      captionRenderPref: getDefaultCaptionRenderPref(),
      logger,
      storage,
      transitionVideos,
    })
    expect(savedScript()).not.toHaveProperty('captionStyle')
  })
})

describe('renderFinal', () => {
  beforeEach(() => {
    written.clear()
    renderAndFinalizeFromScripts.mockReset().mockResolvedValue({ videoUri: 'v' })
  })

  it('records the caption look it was handed in the video script', async () => {
    const look = resolveCaptionLook(null, { aspectRatio: '16:9', kind: 'video' })
    await renderFinal({
      aspectRatio: '16:9',
      audioSourceUri: 'store://projects/p1/story_loader/audio/voice_over.mp3',
      captionRenderPref: look.captionRenderPref,
      captionStyle: look.captionStyle,
      enableCaption: true,
      getThumbnailFallback: async () => undefined,
      logger,
      projectId: 'p1',
      storage,
      transitionVideos,
      userContext: { userEmail: '', userId: 'u1' },
    })

    expect(savedScript().captionRenderPref?.layoutAspectRatio).toBe('landscape')
    expect(savedScript().captionStyle).toEqual(look.captionStyle)
    expect(renderAndFinalizeFromScripts).toHaveBeenCalledTimes(1)
  })

  it("hands the delivery the music's Volume %, so a render again keeps the user's level", async () => {
    const render = (extra: { bgmVolume?: number }) =>
      renderFinal({
        audioSourceUri: 'store://projects/p1/story_loader/audio/voice_over.mp3',
        bgmBedUri: 'store://projects/p1/bgm/bed.mp3',
        getThumbnailFallback: async () => undefined,
        logger,
        projectId: 'p1',
        storage,
        transitionVideos,
        userContext: { userEmail: '', userId: 'u1' },
        ...extra,
      })

    await render({ bgmVolume: 25 })
    expect(renderAndFinalizeFromScripts).toHaveBeenLastCalledWith(
      expect.objectContaining({ bgmBedUri: 'store://projects/p1/bgm/bed.mp3', bgmVolume: 25 }),
    )
    // None given: the bake's default level, as before.
    await render({})
    expect(renderAndFinalizeFromScripts.mock.lastCall?.[0]).not.toHaveProperty('bgmVolume')
  })
})
