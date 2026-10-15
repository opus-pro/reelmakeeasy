import type { VideoScript } from '@reelmakeeasy/common/types/video-script'
import { renderHook } from '@testing-library/react'

import { useLiveCaptionStyle } from '@/components/captions/useCaptionSettings'

import useRenderPlan from './useRenderPlan'
import { useStoryPreviewPlan, type UseStoryPreviewPlanOptions } from './useStoryPreviewPlan'

const FILES = 'http://localhost:5017/api/files/projects/p1/long_take'
const CLIP = {
  endMs: 4000,
  kind: 'transition',
  startMs: 0,
  transitionId: 's1',
  videoUri: `${FILES}/transitions/s1.mp4`,
}
// The editor state as useStorySegments gives it: not read yet (undefined), or read.
let mockState: undefined | { transitions: unknown[] }
// The video script as useVideoScript gives it: a loop's names the clips its render joined.
let mockScript: { data: undefined | VideoScript; isLoading: boolean }
const JOINED_S1 = {
  tracks: [
    {
      id: 'track-media',
      segments: [
        {
          content: {
            resourceType: 'video',
            sourceUri: 'store://projects/p1/long_take/transitions/s1.mp4',
          },
          id: 'segment-long-take-0',
          timeline: { in: 0, out: 4000 },
        },
      ],
      type: 'media',
    },
  ],
} as unknown as VideoScript

jest.mock('./useRenderPlan', () => ({
  __esModule: true,
  default: jest.fn(() => ({ failed: false, renderPlan: null })),
}))
jest.mock('./useStorySegments', () => ({
  useStorySegments: () => ({
    currentState: mockState,
    keyframeSegments: [],
    totalMs: mockState?.transitions.length ? 4000 : 0,
    transcript: undefined,
    transitionSegments: mockState?.transitions ?? [],
  }),
}))
jest.mock('@/hooks/useVideoScript', () => ({ useVideoScript: () => mockScript }))
jest.mock('@/components/captions/useCaptionSettings', () => ({ useLiveCaptionStyle: jest.fn() }))

/** The look as useLiveCaptionStyle gives it: read (`settled`) or not yet. */
function setLook(settled: boolean) {
  jest.mocked(useLiveCaptionStyle).mockReturnValue({
    kind: 'loop',
    settings: settled ? { accent: '#FF3EA5' } : null,
    settled,
  } as ReturnType<typeof useLiveCaptionStyle>)
}

const preview = (captionEnabled: boolean, more: Partial<UseStoryPreviewPlanOptions> = {}) =>
  renderHook(() =>
    useStoryPreviewPlan('p1', { aspectRatio: '9 / 16', captionEnabled, currentMs: 0, ...more }),
  )

/** What the last plan was asked for. */
const lastPlan = () => jest.mocked(useRenderPlan).mock.calls.at(-1)?.[0]

describe('useStoryPreviewPlan', () => {
  beforeEach(() => {
    jest.mocked(useRenderPlan).mockClear()
    jest.mocked(useRenderPlan).mockReturnValue({ failed: false, renderPlan: null })
    mockState = { transitions: [CLIP] }
    mockScript = { data: JOINED_S1, isLoading: false }
  })

  it("holds a loop's captions and stamps until its look is read, so neither shows in the default first", () => {
    setLook(false)
    preview(true)
    expect(lastPlan()).toMatchObject({ captionEnabled: false, factsReady: false })
  })

  it('draws them in the look once it is read, the stamps with the captions off too', () => {
    setLook(true)
    preview(false)
    expect(lastPlan()).toMatchObject({
      captionEnabled: false,
      captionStyle: { accent: '#FF3EA5' },
      factsReady: true,
    })
  })

  it("plays a loop's joined clips when they are the clips in its state, and says so", () => {
    setLook(true)
    const loopClipsUrl = `${FILES}/beat_loop_clips.mp4?v=7`
    const { result } = preview(true, { loopClipsUrl })
    expect(lastPlan()).toMatchObject({ allSegments: [CLIP], loopClipsUrl })
    expect(result.current.playsLoopClips).toBe(true)
  })

  it("plays the clips in the state one by one when they aren't the joined ones", () => {
    setLook(true)
    // An edit not rendered yet, or a render between joining new clips and saving them as the
    // state: the joined clips (and the bed made from them) are another take.
    const take2 = { ...CLIP, videoUri: `${FILES}/transitions/s1_take2.mp4` }
    mockState = { transitions: [take2] }
    const { result } = preview(true, { loopClipsUrl: `${FILES}/beat_loop_clips.mp4?v=7` })
    expect(lastPlan()).toMatchObject({ allSegments: [take2], loopClipsUrl: null })
    expect(result.current.playsLoopClips).toBe(false)
  })

  it("waits for the video script before building a loop's plan, so its clips don't load one by one first", () => {
    setLook(true)
    mockScript = { data: undefined, isLoading: true }
    const { rerender, result } = preview(true, {
      loopClipsUrl: `${FILES}/beat_loop_clips.mp4?v=7`,
    })
    expect(lastPlan()).toMatchObject({ allSegments: [] })
    expect(result.current).toMatchObject({ planFailed: false, playsLoopClips: false })

    mockScript = { data: JOINED_S1, isLoading: false }
    rerender()
    expect(lastPlan()).toMatchObject({ allSegments: [CLIP] })
    expect(result.current.playsLoopClips).toBe(true)
  })

  it('plays any other video from its state, with no joined clips', () => {
    setLook(true)
    mockScript = { data: undefined, isLoading: true }
    const { result } = preview(true)
    expect(lastPlan()).toMatchObject({ allSegments: [CLIP], loopClipsUrl: null })
    expect(result.current.playsLoopClips).toBe(false)
  })

  it("says the plan can't be built when building it threw", () => {
    setLook(true)
    jest.mocked(useRenderPlan).mockReturnValue({ failed: true, renderPlan: null })
    expect(preview(true).result.current.planFailed).toBe(true)
  })

  it("says so when the video's state, once read, has no clips to play", () => {
    setLook(true)
    expect(preview(true).result.current.planFailed).toBe(false)
    mockState = undefined
    expect(preview(true).result.current.planFailed).toBe(false)
    mockState = { transitions: [] }
    expect(preview(true).result.current.planFailed).toBe(true)
  })
})
