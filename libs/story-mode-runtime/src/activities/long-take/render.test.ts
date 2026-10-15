import { resolveCaptionRenderPref } from '@reelmakeeasy/common/adapters/caption/caption-style'
import { getDefaultCaptionRenderPref } from '@reelmakeeasy/common/adapters/caption/default-caption-render-pref'
import { BGM_DEFAULT_VOLUME } from '@reelmakeeasy/common/long-take/bgm-volume'
import type { RenderFinalTransitionVideo } from '@reelmakeeasy/common/long-take/render-final'
import type { VideoScript } from '@reelmakeeasy/common/types/video-script'

const renderFinal = jest.fn()
jest.mock('@reelmakeeasy/common/long-take/render-final', () => ({
  renderFinal: (...args: unknown[]) => renderFinal(...args),
}))
const renderBeatLoopFinal = jest.fn()
jest.mock('@reelmakeeasy/common/long-take/beat-loop-render', () => ({
  renderBeatLoopFinal: (...args: unknown[]) => renderBeatLoopFinal(...args),
}))
let beatLoop: unknown
jest.mock('@reelmakeeasy/common/long-take/beat-loop-delivery', () => ({
  readBeatLoopRenderSpec: async () => beatLoop,
}))
const getMediaDurationMs = jest.fn(async () => 24_050)
jest.mock('@reelmakeeasy/common/utils/media', () => ({
  getMediaDurationMs: (...args: unknown[]) => getMediaDurationMs(...(args as [])),
}))
let watermark = false
jest.mock('@agent-lib/agents/common/utils', () => ({ getWatermarkEnableFlag: () => watermark }))
jest.mock('@agent-lib/agents/video-script/utils/add-watermark-track', () => ({
  generateWatermarkSegments: () => [],
}))
// The project row: its saved caption look (null when nobody chose one).
let savedCaptionStyle: unknown = null
const getProject = jest.fn(async () => ({ captionStyle: savedCaptionStyle, id: 'p1' }))
jest.mock('@shared/db-access-layer', () => ({
  getProjectDataService: () => ({ getProject }),
}))
const storage = { getFullPath: (relativePath: string) => `store://projects/p1/${relativePath}` }
jest.mock('./storage', () => ({ createLongTakeStorage: () => storage }))
const logger = { error: jest.fn(), info: jest.fn(), warn: jest.fn() }
jest.mock('./common', () => ({
  getFirstLongTakeKeyframeThumbnailUrl: async () => undefined,
  logger,
  withActivityHeartbeat: (fn: () => unknown) => fn(),
  withLongTakeContext: (_context: unknown, fn: () => unknown) => fn(),
}))

import { renderLongTakeVideo } from './render'

const RESULT = {
  bgmBaked: false,
  enableCaption: true,
  finalVideoUri: 'http://cdn/final_video.mp4',
  renderDurationMs: 1200,
  thumbnailFallbackUsed: false,
  videoUri: 'store://projects/p1/long_take/beat_loop_clips.mp4',
}

const transitionVideos: RenderFinalTransitionVideo[] = [
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

const params = {
  aspectRatio: '9:16' as const,
  bgmBedUri: 'store://projects/p1/bgm/bed.mp3',
  enableCaption: false,
  keyframesToCommit: [],
  projectId: 'p1',
  transitionVideos,
  userEmail: 'me@example.com',
  userId: 'u1',
}

const CLASSIC = { accent: '#04F827', position: null, preset: 'classic', size: 100 }
const PUNCH = { ...CLASSIC, preset: 'punch' }

describe('renderLongTakeVideo', () => {
  beforeEach(() => {
    beatLoop = undefined
    savedCaptionStyle = null
    watermark = false
    getProject.mockClear()
    renderFinal.mockReset().mockResolvedValue(RESULT)
    renderBeatLoopFinal.mockReset().mockResolvedValue(RESULT)
    getMediaDurationMs.mockClear()
  })

  it('renders a loop short through the beat-loop render: its music, the caption toggle as set', async () => {
    beatLoop = { clipCount: 1, stamps: [null] }

    const result = await renderLongTakeVideo({ ...params, bgmVolume: 35 })

    expect(renderFinal).not.toHaveBeenCalled()
    expect(renderBeatLoopFinal).toHaveBeenCalledTimes(1)
    const [input] = renderBeatLoopFinal.mock.calls[0] as [Record<string, unknown>]
    expect(input).toMatchObject({
      aspectRatio: '9:16',
      audioSourceUri: 'store://projects/p1/story_loader/audio/voice_over.mp3',
      beatLoop,
      // A loop nobody styled starts in Punch, and the video script records that it did.
      captionRenderPref: resolveCaptionRenderPref(null, { aspectRatio: '9:16', kind: 'loop' }),
      captionStyle: PUNCH,
      enableCaption: false,
      keyframesToCommit: [],
      projectId: 'p1',
      transitionVideos,
      userContext: { userEmail: 'me@example.com', userId: 'u1' },
    })
    // The music goes to the loop's finish pass, never the story bake (it would mix into the
    // clips' sound): at the level the user saved, else the default.
    expect(input).not.toHaveProperty('bgmBedUri')
    expect(input.music).toEqual({ bedUri: params.bgmBedUri, volume: 35 })
    await renderLongTakeVideo(params)
    expect(renderBeatLoopFinal.mock.calls[1][0]).toMatchObject({
      music: { bedUri: params.bgmBedUri, volume: BGM_DEFAULT_VOLUME },
    })
    // A loop without music (the default) gets none.
    await renderLongTakeVideo({ ...params, bgmBedUri: undefined })
    expect(renderBeatLoopFinal.mock.calls[2][0]).not.toHaveProperty('music')
    // The loop is N x 4 s by construction; the voice-over is not measured to stretch it.
    expect(getMediaDurationMs).not.toHaveBeenCalled()
    expect(result).toEqual({
      bgmBaked: false,
      enableCaption: true,
      renderDurationMs: 1200,
      thumbnailFallbackUsed: false,
      videoUri: RESULT.videoUri,
    })
  })

  it('renders every other project through renderFinal, as before', async () => {
    await renderLongTakeVideo(params)

    expect(renderBeatLoopFinal).not.toHaveBeenCalled()
    expect(renderFinal).toHaveBeenCalledWith(
      expect.objectContaining({
        audioDurationMs: 24_050,
        bgmBedUri: params.bgmBedUri,
        captionStyle: CLASSIC,
        enableCaption: false,
        transitionVideos,
      }),
    )
    // A 9:16 video nobody styled draws exactly the captions it always did.
    const [input] = renderFinal.mock.calls[0] as [{ captionRenderPref: unknown }]
    expect(input.captionRenderPref).toStrictEqual(getDefaultCaptionRenderPref())
    expect(getProject).toHaveBeenCalledWith('p1')
  })

  it("bakes a normal video's music at the Volume % it is handed, else at the default level", async () => {
    // Rendered again (render_video, the editor's export): the API hands the saved level on.
    await renderLongTakeVideo({ ...params, bgmVolume: 25 })
    expect(renderFinal).toHaveBeenLastCalledWith(
      expect.objectContaining({ bgmBedUri: params.bgmBedUri, bgmVolume: 25 }),
    )
    // Muted is a level too: the bake then leaves the music out.
    await renderLongTakeVideo({ ...params, bgmVolume: 0 })
    expect(renderFinal).toHaveBeenLastCalledWith(expect.objectContaining({ bgmVolume: 0 }))
    // None handed (the first render): the bake's default level, as before.
    await renderLongTakeVideo(params)
    expect(renderFinal.mock.lastCall?.[0]).not.toHaveProperty('bgmVolume')
  })

  it('lays a 16:9 video nobody styled out for its own frame', async () => {
    await renderLongTakeVideo({ ...params, aspectRatio: '16:9' })

    const [input] = renderFinal.mock.calls[0] as [{ captionRenderPref: unknown }]
    expect(input.captionRenderPref).toStrictEqual({
      ...getDefaultCaptionRenderPref(),
      layoutAspectRatio: 'landscape',
    })
  })

  it("draws the look saved on the project, a loop's at 9:16 whatever the row's ratio", async () => {
    savedCaptionStyle = { accent: '#FFE500', preset: 'explainer', size: 120 }
    await renderLongTakeVideo(params)
    expect(renderFinal).toHaveBeenCalledWith(
      expect.objectContaining({
        captionRenderPref: resolveCaptionRenderPref(savedCaptionStyle as never, {
          aspectRatio: '9:16',
          kind: 'video',
        }),
        captionStyle: { accent: '#FFE500', position: null, preset: 'explainer', size: 120 },
      }),
    )

    beatLoop = { clipCount: 1, stamps: [null] }
    savedCaptionStyle = { position: 40 }
    await renderLongTakeVideo({ ...params, aspectRatio: '16:9' })
    expect(renderBeatLoopFinal).toHaveBeenCalledWith(
      expect.objectContaining({
        captionRenderPref: resolveCaptionRenderPref(
          { position: 40 },
          { aspectRatio: '9:16', kind: 'loop' },
        ),
        captionStyle: { ...PUNCH, position: 40 },
      }),
    )
  })

  it('draws the look the user was looking at when the render request carries one', async () => {
    savedCaptionStyle = { preset: 'punch' }
    await renderLongTakeVideo({ ...params, captionStyle: { accent: '#00E5FF', preset: 'classic' } })
    expect(renderFinal).toHaveBeenLastCalledWith(
      expect.objectContaining({ captionStyle: { ...CLASSIC, accent: '#00E5FF' } }),
    )

    // null is a look too: the kind's default, whatever was saved.
    beatLoop = { clipCount: 1, stamps: [null] }
    savedCaptionStyle = { preset: 'explainer' }
    await renderLongTakeVideo({ ...params, captionStyle: null })
    expect(renderBeatLoopFinal).toHaveBeenLastCalledWith(
      expect.objectContaining({ captionStyle: PUNCH }),
    )
    expect(getProject).not.toHaveBeenCalled()
  })

  it('gives the watermark copy the same captions as the clean video', async () => {
    watermark = true
    savedCaptionStyle = { preset: 'punch' }
    await renderLongTakeVideo(params)

    const [input] = renderFinal.mock.calls[0] as [
      {
        buildWatermarkVideoScript: (script: VideoScript, totalMs: number) => VideoScript
        captionRenderPref: VideoScript['captionRenderPref']
        captionStyle: unknown
      },
    ]
    const clean = {
      captionRenderPref: input.captionRenderPref,
      captionStyle: input.captionStyle,
      tracks: [],
    }
    const copy = input.buildWatermarkVideoScript(clean, 4000)
    expect(copy).toMatchObject({ captionRenderPref: input.captionRenderPref, captionStyle: PUNCH })
    expect(copy.tracks.map((t) => t.type)).toEqual(['media'])
  })
})
