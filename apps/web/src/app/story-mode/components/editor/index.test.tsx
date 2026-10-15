import { act, fireEvent, render, screen } from '@testing-library/react'
import { createStore, Provider } from 'jotai'

import type { EngineActions } from '@/app/projects/[projectId]/editor/render-engine-sdk/render-engine.store'
import { renderMainEngineStore } from '@/app/projects/[projectId]/editor/render-engine-sdk/render-main-engine.store'

import { loopPreviewMedia } from './render/loopPreview'
import { useBgmBedPlayback } from './render/useBgmBedPlayback'
import { useStoryPreviewPlan } from './render'
import StorySequencerV2 from '.'

jest.mock('@/app/projects/[projectId]/editor/render-engine-sdk/use-render-main-engine', () => ({
  useRenderMainEngine: () => ({
    hardwareAccelerationUnavailable: false,
    playbackCompleted: false,
    readyForPlay: true,
  }),
}))
jest.mock('@/app/projects/[projectId]/editor/components/HardwareAccelerationBanner', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('@/atom/longtake-history.store', () => {
  const { atom } = jest.requireActual<typeof import('jotai')>('jotai')
  return {
    longtakeHistoryStore: {
      canRedoAtom: atom(false),
      canUndoAtom: atom(false),
      maskedKeyframeIdsAtom: atom(new Set()),
      redoAtom: atom(null, () => undefined),
      staleTransitionIdsAtom: atom(new Set()),
      undoAtom: atom(null, () => undefined),
    },
    renderSettingsAtom: atom({ captionEnabled: { latest: true, original: true } }),
  }
})
jest.mock('@/app/story-mode/hook/useMusicToggle', () => ({
  useLiveMusicVolume: (_projectId: string, volume?: null | number) => volume ?? 0,
}))
jest.mock('@/components/BackdropPortal', () => ({ BackdropPortal: () => null }))
jest.mock('../LongTakeViewer/EditBox/EditBox', () => ({ __esModule: true, default: () => null }))
jest.mock('../LongTakeViewer/hooks/useLongTakeHistoryKeyboard', () => ({
  useLongTakeHistoryKeyboard: () => undefined,
}))
jest.mock('../LongTakeViewer/hooks/useOwnerEditActions', () => ({
  useOwnerEditActions: () => ({
    activeTransitionProgress: null,
    handleRegenerateTransition: jest.fn(),
    isRegeneratingTransition: false,
    regeneratingTransitionIds: new Set(),
  }),
}))
jest.mock('../LongTakeViewer/LongTakeHistoryToolbar', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('../LongTakeViewer/StorySequencer/ClipStrip', () => ({
  __esModule: true,
  default: () => null,
}))
jest.mock('../OnboardingTour', () => ({ EditorOnboardingTour: () => null }))
jest.mock('./EnginePlayerOverlay', () => ({
  EnginePlayerOverlay: ({ onPlay }: { onPlay: () => void }) => (
    <button onClick={onPlay} type="button">
      Play
    </button>
  ),
}))
jest.mock('./render', () => ({
  StoryRenderPlanBuilder: { parseAspectRatio: () => ({ height: 1920, width: 1080 }) },
  useCanvasFit: () => null,
  useEnginePlayback: jest.requireActual('./render/useEnginePlayback').useEnginePlayback,
  useStoryPreviewPlan: jest.fn(),
}))
jest.mock('./render/useBgmBedPlayback', () => ({ useBgmBedPlayback: jest.fn() }))

const FILES = 'http://localhost:5017/api/files/projects/p1/long_take'
const LOOP = loopPreviewMedia({
  loopClipsUrl: `${FILES}/beat_loop_clips.mp4?v=7`,
  loopSfxBedUrl: `${FILES}/beat_loop_sfx.m4a?v=8`,
  loopSfxBedVolume: 35,
})

// The plan of a loop whose joined clips are the clips in its state.
const PLAN: ReturnType<typeof useStoryPreviewPlan> = {
  activeKeyframeIndex: 0,
  activeKeyframeSegment: null,
  activeTransitionSegment: null,
  currentState: undefined,
  keyframeSegments: [],
  planFailed: false,
  playsLoopClips: true,
  renderPlan: null,
  totalMs: 32_000,
  transcript: undefined,
  transitionSegments: [],
}

describe('StorySequencerV2 for a loop short', () => {
  beforeEach(() => {
    jest.mocked(useBgmBedPlayback).mockClear()
    jest.mocked(useStoryPreviewPlan).mockReturnValue(PLAN)
  })

  it('previews it as the chat does: its joined clips, its clip sound beside the engine, on a loop', () => {
    const jotai = createStore()
    const actions: jest.Mocked<EngineActions> = {
      playOrPause: jest.fn(),
      refresh: jest.fn(),
      seek: jest.fn(),
    }
    jotai.set(renderMainEngineStore.engineActions, actions)
    render(
      <Provider store={jotai}>
        <StorySequencerV2 loop={LOOP} projectId="p1" voiceOverUrl={`${FILES}/voice.mp3`} />
      </Provider>,
    )

    expect(useStoryPreviewPlan).toHaveBeenLastCalledWith(
      'p1',
      expect.objectContaining({ loopClipsUrl: `${FILES}/beat_loop_clips.mp4?v=7` }),
    )
    expect(useBgmBedPlayback).toHaveBeenCalledWith({
      bedGainDb: null,
      enabled: true,
      engineMs: 0,
      loopMs: 32_000,
      playing: false,
      url: LOOP?.bedUrl,
      volume: 35,
    })

    act(() => fireEvent.click(screen.getByRole('button', { name: 'Play' })))
    expect(actions.playOrPause).toHaveBeenLastCalledWith(true, true)
  })

  it('plays its clip sound once, and its music in addition at its Volume when music is on', () => {
    render(
      <Provider store={createStore()}>
        <StorySequencerV2
          bgmGainDb={1.13}
          bgmUrl={`${FILES}/bgm_bed.m4a?v=2`}
          bgmVolume={90}
          loop={LOOP}
          musicEnabled
          projectId="p1"
          voiceOverUrl={`${FILES}/voice.mp3`}
        />
      </Provider>,
    )
    // Each render plays two beds: the music and the loop's clip sound, never the clip sound twice.
    const lastRender = jest.mocked(useBgmBedPlayback).mock.calls.slice(-2)
    const urls = lastRender.map(([bed]) => bed.url)
    expect(urls.filter((url) => url === LOOP?.bedUrl)).toHaveLength(1)
    expect(lastRender).toContainEqual([
      expect.objectContaining({
        bedGainDb: 1.13,
        enabled: true,
        url: `${FILES}/bgm_bed.m4a?v=2`,
        volume: 90,
      }),
    ])
    expect(lastRender).toContainEqual([
      expect.objectContaining({ bedGainDb: null, enabled: true, url: LOOP?.bedUrl, volume: 35 }),
    ])
  })

  it('plays no clip sound while the plan plays the clips in its state, not the joined ones', () => {
    // The state's clips aren't the joined ones (an edit not rendered yet): the bed is the joined
    // clips' sound.
    jest.mocked(useStoryPreviewPlan).mockReturnValue({ ...PLAN, playsLoopClips: false })
    render(
      <Provider store={createStore()}>
        <StorySequencerV2 loop={LOOP} projectId="p1" voiceOverUrl={`${FILES}/voice.mp3`} />
      </Provider>,
    )
    expect(useBgmBedPlayback).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false, loopMs: 32_000, url: null }),
    )
    expect(useBgmBedPlayback).not.toHaveBeenCalledWith(
      expect.objectContaining({ url: LOOP?.bedUrl }),
    )
  })
})
