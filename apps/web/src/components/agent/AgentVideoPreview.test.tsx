import type { VideoScript } from '@reelmakeeasy/common/types/video-script'
import { act, fireEvent, render, screen } from '@testing-library/react'

import type { AgentEngineCanvasProps, EngineUnavailableReason } from './AgentEngineCanvas'
import { AgentVideoPreview } from './AgentVideoPreview'
import { claimPlayback } from './exclusivePlayback'
import type { ProjectProgress } from './useProjectProgress'

let mockProject: null | Record<string, unknown> | undefined
let mockFileExists: boolean | null
let mockWebgl: boolean
// The video script as the shared query has it, and whether it is still being read.
let mockScript: undefined | VideoScript
let mockScriptLoading: boolean
// Why the engine, once started, gives up (it calls `onUnavailable`); null: it plays.
let mockEngineFailure: EngineUnavailableReason | null
const mockInvalidate = jest.fn()

jest.mock(
  '@/app/projects/[projectId]/editor/render-engine-sdk/detect-hardware-acceleration',
  () => ({
    detectHardwareAcceleration: () => ({ supported: mockWebgl }),
  }),
)
jest.mock('@/util/browserUtils', () => ({ useIsMobile: () => false }))
jest.mock('@/util/hard-navigation', () => ({ reloadPage: jest.fn() }))
jest.mock(
  'next/dynamic',
  () => () =>
    function EngineStub({ captionEnabled, loop, onUnavailable }: AgentEngineCanvasProps) {
      jest.requireActual<typeof import('react')>('react').useEffect(() => {
        if (mockEngineFailure) onUnavailable(mockEngineFailure)
      }, [onUnavailable])
      return (
        <div
          data-bed={loop?.bedUrl}
          data-captions={String(captionEnabled)}
          data-clips={loop?.clipsUrl}
          data-testid="engine"
        />
      )
    },
)
jest.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mockInvalidate }),
}))
jest.mock('@/hooks/useVideoScript', () => ({
  useVideoScript: (projectId: string) => ({
    data: projectId ? mockScript : undefined,
    isLoading: !!projectId && mockScriptLoading,
  }),
  videoScriptQueryKey: (projectId: string) => ['video-script', projectId],
}))
jest.mock('./exclusivePlayback', () => ({
  ...jest.requireActual('./exclusivePlayback'),
  claimPlayback: jest.fn(),
}))
jest.mock('./renderedFile', () => ({ useRenderedFileExists: () => mockFileExists }))
jest.mock('./useAgentCaptionChoice', () => ({
  useAgentCaptionChoice: () => ({ captionsOn: true }),
}))
jest.mock('./useAgentProject', () => ({
  useAgentProject: () => mockProject,
  useProjectAspectRatio: () => '9 / 16',
}))
jest.mock('./VideoActions', () => ({
  VideoActions: ({ livePreview }: { livePreview: boolean }) => (
    <div data-live={String(livePreview)} data-testid="video-actions" />
  ),
}))

const VIDEO_URL = 'http://localhost:5017/api/files/p1/final.mp4?v=1'
const FILES = 'http://localhost:5017/api/files/projects/p1/long_take'
const BED = `${FILES}/beat_loop_sfx.m4a?v=7`
const CLIPS = `${FILES}/beat_loop_clips.mp4?v=6`

const progress = {
  audioPreviewUrl: 'http://localhost:5017/api/files/p1/voice_over.mp3',
  bgmBedGainDb: null,
  bgmBedUrl: null,
  bgmEnabled: false,
  captionsInVideo: true,
  keyframes: [],
  loopClipsUrl: null,
  loopSfxBedPending: false,
  loopSfxBedUrl: null,
  loopSfxBedVolume: null,
} as unknown as ProjectProgress

/** A loop's progress once its clip sound bed is there. */
const withBed = {
  ...progress,
  loopClipsUrl: CLIPS,
  loopSfxBedUrl: BED,
  loopSfxBedVolume: 35,
} as ProjectProgress
/** What a loop's render saves since stamps are a track (an empty one for a loop without any). */
const STAMPED = { tracks: [{ id: 'track-facts', segments: [], type: 'facts' }] } as VideoScript

function preview(over: Partial<{ progress: ProjectProgress; videoUrl: string }> = {}) {
  return (
    <AgentVideoPreview
      progress={over.progress ?? progress}
      projectId="p1"
      videoClassName="h-96"
      videoUrl={over.videoUrl ?? VIDEO_URL}
    />
  )
}

const renderPreview = (over: Parameters<typeof preview>[0] = {}) => render(preview(over))

function setIsolated(value: boolean) {
  Object.defineProperty(window, 'crossOriginIsolated', { configurable: true, value })
}

const video = (container: HTMLElement) => container.querySelector('video')
const live = () => screen.getByTestId('video-actions').dataset.live
const startEngine = () => fireEvent.click(screen.getByRole('button', { name: 'Play your video' }))

describe('AgentVideoPreview', () => {
  beforeAll(() => {
    // jsdom has no media playback; the player pauses and unloads its file on unmount.
    jest.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined)
    jest.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined)
  })

  beforeEach(() => {
    mockProject = { createUseCase: 'script-to-video', id: 'p1' }
    mockFileExists = true
    mockWebgl = true
    mockScript = STAMPED
    mockScriptLoading = false
    mockEngineFailure = null
    setIsolated(true)
    jest.mocked(claimPlayback).mockClear()
    mockInvalidate.mockClear()
  })

  describe('a loop short', () => {
    beforeEach(() => {
      mockProject = { createUseCase: 'beat-loop', id: 'p1' }
    })

    it("plays live in the editor's player, on a loop: its joined clips, voice-over, captions, stamps and clip sound", () => {
      const { container } = renderPreview({ progress: withBed })

      expect(video(container)).toBeNull()
      startEngine()
      const engine = screen.getByTestId('engine')
      expect(engine.dataset.clips).toBe(CLIPS)
      expect(engine.dataset.bed).toBe(BED)
      expect(engine.dataset.captions).toBe('true')
      // The Captions switch and the caption look show here at once: no "renders again" line.
      expect(live()).toBe('true')
    })

    it('plays its rendered file on a loop, with controls, while it has no clip sound bed', () => {
      const { container } = renderPreview()

      expect(screen.queryByRole('button', { name: 'Play your video' })).toBeNull()
      expect(screen.queryByTestId('engine')).toBeNull()
      const player = video(container)
      expect(player?.getAttribute('src')).toBe(VIDEO_URL)
      expect(player?.loop).toBe(true)
      expect(player?.controls).toBe(true)
      // The file shows a new look only after a render: the popover says so.
      expect(live()).toBe('false')
      // No engine was wanted: nothing to excuse.
      expect(screen.queryByText(/This is the downloadable video/)).toBeNull()
    })

    it('goes live once its clip sound bed is built', () => {
      const pending = { ...progress, loopSfxBedPending: true } as ProjectProgress
      const { container, rerender } = renderPreview({ progress: pending })
      expect(video(container)?.loop).toBe(true)

      rerender(preview({ progress: withBed }))
      expect(screen.getByRole('button', { name: 'Play your video' })).toBeTruthy()
      expect(live()).toBe('true')
    })

    it('keeps its file on screen while it plays, going live once it is paused', () => {
      const { container, rerender } = renderPreview()
      const player = video(container) as HTMLVideoElement
      fireEvent.play(player)

      rerender(preview({ progress: withBed }))
      expect(video(container)).toBe(player)
      expect(live()).toBe('false')

      fireEvent.pause(player)
      expect(screen.getByRole('button', { name: 'Play your video' })).toBeTruthy()
    })

    it('keeps its file playing while its video script is read, once the bed arrives', () => {
      mockScriptLoading = true
      const { container, rerender } = renderPreview()
      const player = video(container) as HTMLVideoElement
      fireEvent.play(player)

      rerender(preview({ progress: withBed }))
      expect(video(container)).toBe(player)

      mockScriptLoading = false
      fireEvent.pause(player)
      rerender(preview({ progress: withBed }))
      expect(screen.getByRole('button', { name: 'Play your video' })).toBeTruthy()
    })

    it('goes live after its file player went away mid-play (a new render)', () => {
      const { container, rerender } = renderPreview()
      fireEvent.play(video(container) as HTMLVideoElement)
      // Not rendered any more: the file player goes, and with it what it was doing.
      mockFileExists = false
      rerender(preview())
      expect(video(container)).toBeNull()

      mockFileExists = true
      rerender(preview({ progress: withBed }))
      expect(screen.getByRole('button', { name: 'Play your video' })).toBeTruthy()
    })

    it('plays its file when rendered before stamps were a track: the live preview would lack them', () => {
      mockScript = { tracks: [] } as unknown as VideoScript
      const { container } = renderPreview({ progress: withBed })

      expect(video(container)?.loop).toBe(true)
      expect(live()).toBe('false')
    })

    it('waits for its video script before choosing, so its file never flashes first', () => {
      mockScriptLoading = true
      const { container } = renderPreview({ progress: withBed })

      expect(video(container)).toBeNull()
      expect(container.querySelector('[aria-busy]')).toBeTruthy()
    })

    it.each([
      ['no-plan', "the editor's player couldn't put it together"],
      ['load-timeout', "the editor's player didn't load"],
    ] as const)(
      'falls back to its file on a loop, saying why, when the engine gives up (%s)',
      (failure, why) => {
        mockEngineFailure = failure
        const { container } = renderPreview({ progress: withBed })
        startEngine()

        expect(screen.queryByTestId('engine')).toBeNull()
        expect(video(container)?.loop).toBe(true)
        expect(screen.getByText(new RegExp(why))).toBeTruthy()
        expect(live()).toBe('false')
      },
    )

    it('falls back to its file without hardware acceleration', () => {
      mockWebgl = false
      const { container } = renderPreview({ progress: withBed })

      expect(video(container)?.loop).toBe(true)
      expect(screen.getByText(/needs hardware acceleration/)).toBeTruthy()
    })

    it("offers the editor's player after a reload on a page that isn't isolated", () => {
      setIsolated(false)
      const { container } = renderPreview({ progress: withBed })

      expect(video(container)?.loop).toBe(true)
      expect(screen.getByText(/Reload the page/)).toBeTruthy()
    })

    it("doesn't offer the editor's player without a clip sound bed, on a page that isn't isolated", () => {
      setIsolated(false)
      const { container } = renderPreview()

      expect(video(container)?.loop).toBe(true)
      expect(screen.queryByText(/Reload the page/)).toBeNull()
      expect(screen.queryByText(/This is the downloadable video/)).toBeNull()
    })

    it('playing its file pauses the other players', () => {
      const { container } = renderPreview()
      const player = video(container) as HTMLVideoElement

      fireEvent.play(player)

      expect(claimPlayback).toHaveBeenCalledWith({ media: player })
    })

    it('says so when not rendered yet', () => {
      mockFileExists = false
      const { container } = renderPreview()

      expect(video(container)).toBeNull()
      expect(screen.getByRole('status').textContent).toContain('Video not rendered yet')
    })
  })

  it('reads the video script again after the video renders again, for the new stamps and captions', () => {
    const { rerender } = renderPreview()
    expect(mockInvalidate).not.toHaveBeenCalled()

    act(() => {
      rerender(preview({ videoUrl: 'http://localhost:5017/api/files/p1/final.mp4?v=2' }))
    })
    expect(mockInvalidate).toHaveBeenCalledWith({ queryKey: ['video-script', 'p1'] })
  })

  it("a story video still starts on the editor's player, with no clip sound", () => {
    const { container } = renderPreview({ progress: withBed })

    expect(screen.getByRole('button', { name: 'Play your video' })).toBeTruthy()
    expect(video(container)).toBeNull()
    expect(live()).toBe('true')
    startEngine()
    expect(screen.getByTestId('engine').dataset.bed).toBeUndefined()
  })

  it("a story video's file fallback plays once, with the reload note", () => {
    setIsolated(false)
    const { container } = renderPreview()

    expect(video(container)?.loop).toBe(false)
    expect(screen.getByText(/Reload the page/)).toBeTruthy()
  })
})
