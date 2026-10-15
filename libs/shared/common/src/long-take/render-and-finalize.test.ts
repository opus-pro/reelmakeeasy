const finalizeRender = jest.fn()
jest.mock('./render-final', () => ({
  buildRenderPayloads: async () => ({ clean: { args: [], taskQueue: 'q', workflowId: 'w' } }),
  finalizeRender: (...args: unknown[]) => finalizeRender(...args),
}))
jest.mock('./render-start', () => ({
  startRenderVideo: async () => ({ data: { videoUri: 'store://render/clean.mp4' } }),
}))

import { renderAndFinalizeFromScripts } from './render-and-finalize'
import type { RenderedVideoScript, RenderFinalStorage } from './render-final.types'

const storage = {} as RenderFinalStorage
const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() }

const deliver = (
  videoScript: RenderedVideoScript,
  music: { bgmBedUri?: string; bgmVolume?: number } = {},
) =>
  renderAndFinalizeFromScripts({
    ...music,
    getThumbnailFallback: async () => undefined,
    logger,
    projectId: 'p1',
    startedAt: 0,
    storage,
    totalDurationMs: 4000,
    transitionVideos: [],
    userContext: { userEmail: '', userId: 'u1' },
    videoScript,
  })

describe('renderAndFinalizeFromScripts', () => {
  beforeEach(() => finalizeRender.mockReset().mockResolvedValue({ videoUri: 'v' }))

  it('hands the delivery the caption look its script draws, to record once the file is up', async () => {
    const captionStyle = { accent: '#FFE500', position: null, preset: 'punch', size: 100 } as const
    await deliver({ captionStyle, tracks: [] })
    expect(finalizeRender).toHaveBeenCalledWith(
      expect.objectContaining({
        captionStyle,
        cleanVideoUri: 'store://render/clean.mp4',
      }),
    )
  })

  it("bakes the music at the user's Volume % (the same level rule as the music remux)", async () => {
    const bed = 'store://projects/p1/bgm/bed.mp3'
    await deliver({ tracks: [] }, { bgmBedUri: bed, bgmVolume: 25 })
    expect(finalizeRender).toHaveBeenLastCalledWith(
      expect.objectContaining({ bgmBedUri: bed, bgmVolume: 25 }),
    )
    await deliver({ tracks: [] }, { bgmBedUri: bed })
    expect(finalizeRender.mock.lastCall?.[0]).not.toHaveProperty('bgmVolume')
  })
})
