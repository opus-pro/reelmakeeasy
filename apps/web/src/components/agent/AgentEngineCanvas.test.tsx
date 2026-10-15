import type { RenderPlan } from '@reelmakeeasy/common/types/render-plan-struct'
import { act, render } from '@testing-library/react'
import { createStore, Provider } from 'jotai'

import { useRenderEngine } from '@/app/projects/[projectId]/editor/render-engine-sdk'
import {
  type EngineActions,
  getRenderEngineStore,
} from '@/app/projects/[projectId]/editor/render-engine-sdk/render-engine.store'
import { useStoryPreviewPlan } from '@/app/story-mode/components/editor/render'
import { loopPreviewMedia } from '@/app/story-mode/components/editor/render/loopPreview'

import AgentEngineCanvas, { type AgentEngineCanvasProps } from './AgentEngineCanvas'

jest.mock('@/app/projects/[projectId]/editor/render-engine-sdk', () => ({
  ...jest.requireActual('@/app/projects/[projectId]/editor/render-engine-sdk/audio-ready'),
  getRenderEngineStore: jest.requireActual(
    '@/app/projects/[projectId]/editor/render-engine-sdk/render-engine.store',
  ).getRenderEngineStore,
  useRenderEngine: jest.fn(),
}))
jest.mock('@/app/story-mode/components/editor/render', () => ({
  StoryRenderPlanBuilder: { parseAspectRatio: () => ({ height: 1920, width: 1080 }) },
  useCanvasFit: () => null,
  useEnginePlayback: jest.requireActual(
    '@/app/story-mode/components/editor/render/useEnginePlayback',
  ).useEnginePlayback,
  useStoryPreviewPlan: jest.fn(),
}))
jest.mock('@/app/story-mode/components/editor/EnginePlayerOverlay', () => ({
  EnginePlayerOverlay: () => null,
}))
jest.mock('@/app/story-mode/hook/useMusicToggle', () => ({
  useLiveMusicVolume: (_projectId: string, volume: null | number) => volume ?? 0,
}))

const FILES = 'http://localhost:5017/api/files/projects/p1'
const LOOP = loopPreviewMedia({
  loopClipsUrl: `${FILES}/long_take/beat_loop_clips.mp4?v=6`,
  loopSfxBedUrl: `${FILES}/long_take/beat_loop_sfx.m4a?v=7`,
  loopSfxBedVolume: 35,
})
const planWith = (captions: boolean) =>
  ({ id: '#Root', tracks: [], videoInfo: { captions } }) as unknown as RenderPlan

/** The audio elements made beside the engine (jsdom can't play): what was set on them. */
class FakeAudio {
  static made: FakeAudio[] = []
  crossOrigin: null | string = null
  currentTime = 0
  loop = false
  paused = true
  pause = jest.fn(() => {
    this.paused = true
  })
  play = jest.fn(() => {
    this.paused = false
    return Promise.resolve()
  })
  preload = ''
  volume = 1
  constructor(readonly src: string) {
    FakeAudio.made.push(this)
  }
}

let engine: { playbackCompleted: boolean; readyForPlay: boolean }
const actions: jest.Mocked<EngineActions> = {
  playOrPause: jest.fn(),
  refresh: jest.fn(),
  seek: jest.fn(),
}

function setup(props: Partial<AgentEngineCanvasProps> = {}) {
  const jotai = createStore()
  const onUnavailable = jest.fn()
  const base: AgentEngineCanvasProps = {
    aspectRatio: '9 / 16',
    autoPlay: true,
    captionEnabled: true,
    className: 'h-96',
    loop: LOOP,
    onUnavailable,
    projectId: 'p1',
    voiceOverUrl: `${FILES}/story_loader/audio/voice_over.mp3`,
    ...props,
  }
  // The engine loads: its actions are up (in its store, by the name this player gave it),
  // then its first frame is drawn.
  const ready = engine.readyForPlay
  engine.readyForPlay = false
  const view = render(<AgentEngineCanvas {...base} />, {
    wrapper: ({ children }) => <Provider store={jotai}>{children}</Provider>,
  })
  const moduleName = jest.mocked(useRenderEngine).mock.calls[0][0].moduleName
  const store = getRenderEngineStore(moduleName)
  act(() => jotai.set(store.engineActions, actions))
  engine.readyForPlay = ready
  const rerender = (next: Partial<AgentEngineCanvasProps>) =>
    view.rerender(<AgentEngineCanvas {...base} {...next} />)
  rerender({})
  return {
    moduleName,
    onUnavailable,
    rerender,
    setEngineMs: (ms: number) => act(() => jotai.set(store.currentTime, ms)),
  }
}

describe('AgentEngineCanvas', () => {
  const realAudio = globalThis.Audio
  beforeEach(() => {
    FakeAudio.made = []
    globalThis.Audio = FakeAudio as unknown as typeof Audio
    engine = { playbackCompleted: false, readyForPlay: true }
    jest.mocked(useRenderEngine).mockReset()
    jest.mocked(useRenderEngine).mockImplementation(() => ({
      audioReady: true,
      currentTime: 0,
      hardwareAccelerationUnavailable: false,
      ...engine,
    }))
    jest.mocked(useStoryPreviewPlan).mockReset()
    jest.mocked(useStoryPreviewPlan).mockImplementation(
      (_projectId, { captionEnabled, loopClipsUrl }) =>
        ({
          planFailed: false,
          playsLoopClips: !!loopClipsUrl,
          renderPlan: planWith(captionEnabled),
          totalMs: 32_000,
        }) as unknown as ReturnType<typeof useStoryPreviewPlan>,
    )
    Object.values(actions).forEach((fn) => fn.mockClear())
  })
  afterAll(() => {
    globalThis.Audio = realAudio
  })

  it('plays a loop live: its joined clips muted in the plan, on a loop, its clip sound beside the engine at its volume', () => {
    setup()
    expect(useStoryPreviewPlan).toHaveBeenLastCalledWith(
      'p1',
      expect.objectContaining({ captionEnabled: true, loopClipsUrl: LOOP?.clipsUrl }),
    )
    expect(actions.playOrPause).toHaveBeenLastCalledWith(true, true)
    const [bed] = FakeAudio.made
    expect(FakeAudio.made).toHaveLength(1)
    expect(bed.src).toBe(LOOP?.bedUrl)
    expect(bed.loop).toBe(true)
    expect(bed.volume).toBeCloseTo(0.35)
    expect(bed.play).toHaveBeenCalled()
  })

  it('keeps its clip sound in step with the engine: seeks, pauses, and wraps with the loop', () => {
    const { setEngineMs } = setup()
    const [bed] = FakeAudio.made
    setEngineMs(12_000)
    // 300 ms is inaudible as an offset; 12 s is a seek.
    expect(bed.currentTime).toBe(12)

    // An engine that reports the loop's end goes on from the top, and so does the bed.
    bed.paused = true
    engine.playbackCompleted = true
    setEngineMs(32_000)
    expect(actions.seek).toHaveBeenCalledWith(0)
    expect(actions.playOrPause).toHaveBeenLastCalledWith(true, true)
    expect(bed.currentTime).toBe(0)
    expect(bed.paused).toBe(false)
  })

  it('draws a Captions switch or a new look at once: a new plan for the same engine, clips and bed', () => {
    const { moduleName, rerender } = setup()
    rerender({ captionEnabled: false })
    expect(useStoryPreviewPlan).toHaveBeenLastCalledWith(
      'p1',
      expect.objectContaining({ captionEnabled: false, loopClipsUrl: LOOP?.clipsUrl }),
    )
    const last = jest.mocked(useRenderEngine).mock.calls.at(-1)?.[0]
    expect(last?.renderPlan).toEqual(planWith(false))
    expect(last?.moduleName).toBe(moduleName)
    // Nothing reloaded: one bed element, never paused for the change.
    expect(FakeAudio.made).toHaveLength(1)
    expect(FakeAudio.made[0].pause).not.toHaveBeenCalled()
  })

  it('plays no clip sound while the plan plays the clips in its state, not the joined ones', () => {
    jest.mocked(useStoryPreviewPlan).mockReturnValue({
      planFailed: false,
      playsLoopClips: false,
      renderPlan: planWith(true),
      totalMs: 32_000,
    } as unknown as ReturnType<typeof useStoryPreviewPlan>)
    const { onUnavailable } = setup()
    // Still live, on a loop, as the editor plays it; the bed is the joined clips' sound.
    expect(actions.playOrPause).toHaveBeenLastCalledWith(true, true)
    expect(FakeAudio.made).toHaveLength(0)
    expect(onUnavailable).not.toHaveBeenCalled()
  })

  it("gives up for the rendered file when its plan can't be built", () => {
    jest.mocked(useStoryPreviewPlan).mockReturnValue({
      planFailed: true,
      renderPlan: null,
      totalMs: 32_000,
    } as unknown as ReturnType<typeof useStoryPreviewPlan>)
    const { onUnavailable } = setup()
    expect(onUnavailable).toHaveBeenCalledWith('no-plan')
  })

  it('plays any other video once, with no clip sound', () => {
    setup({ loop: null })
    expect(useStoryPreviewPlan).toHaveBeenLastCalledWith(
      'p1',
      expect.objectContaining({ loopClipsUrl: null }),
    )
    expect(actions.playOrPause).toHaveBeenLastCalledWith(true, false)
    expect(FakeAudio.made).toHaveLength(0)
  })
})
