import { fireEvent, render, screen } from '@testing-library/react'

import type { ProjectProgress } from './useProjectProgress'
import { VideoActions } from './VideoActions'

let mockCaptionsOn: boolean | null = true
let mockKind: 'loop' | 'video' = 'video'
let mockLookDiffers = false
const mockLookDiffersArgs = jest.fn()

jest.mock('@/app/story-mode/components/LongTakeViewer/LongTakeDownload', () => ({
  LongTakeExportProgressDialog: () => null,
}))
jest.mock('@/app/story-mode/hook/useMusicToggle', () => ({
  musicRequestFromProject: () => ({ choice: 'off' }),
  useLiveMusicVolume: () => 50,
  useMusicToggle: () => ({ busy: false, musicOn: false }),
}))
jest.mock('@/components/music/MusicChangeButton', () => ({ MusicChangeButton: () => null }))
jest.mock('@/util/browserUtils', () => ({ useIsMobile: () => false }))
jest.mock('@/components/captions/CaptionSettingsPanel', () => ({
  CaptionSettingsPanel: ({
    aspectRatio,
    captionsOn,
    note,
  }: {
    aspectRatio: string
    captionsOn: boolean
    note?: string
  }) => (
    <div data-captions={String(captionsOn)} data-ratio={aspectRatio} data-testid="caption-panel">
      {note}
    </div>
  ),
}))
jest.mock('@/components/captions/useCaptionSettings', () => ({
  useCaptionStatus: () => ({ settled: true, status: { kind: mockKind } }),
  useDeliveredCaptionLookDiffers: (...args: unknown[]) => {
    mockLookDiffersArgs(...args)
    return mockLookDiffers
  },
}))
jest.mock('./useAgentProject', () => ({ useProjectAspectRatio: () => '16 / 9' }))
jest.mock('./useAgentVideoDownload', () => ({
  useAgentVideoDownload: () => ({
    busy: false,
    captionsOn: mockCaptionsOn,
    download: { isExportDisabled: false },
    handleDownload: jest.fn(),
    locked: false,
    project: null,
    setCaptionsOn: jest.fn(),
  }),
}))

// Radix popovers measure their anchor; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= jest.fn(() => ({
  disconnect: jest.fn(),
  observe: jest.fn(),
  unobserve: jest.fn(),
})) as unknown as typeof ResizeObserver

const progress = {
  bgmBedUrl: null,
  bgmEnabled: false,
  bgmVolume: null,
  captionsInVideo: true,
  delivered: true,
  videoUrl: 'http://localhost:5017/api/files/p1/final.mp4',
} as unknown as ProjectProgress

describe('VideoActions caption style', () => {
  beforeEach(() => {
    mockCaptionsOn = true
    mockKind = 'video'
    mockLookDiffers = false
    mockLookDiffersArgs.mockClear()
  })

  it("opens the caption look's controls from Style, beside the Captions switch", () => {
    render(<VideoActions livePreview progress={progress} projectId="p1" />)
    expect(screen.queryByTestId('caption-panel')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Style' }))
    const panel = screen.getByTestId('caption-panel')
    expect(panel.dataset.ratio).toBe('16 / 9')
    // The live preview above shows each change at once: nothing to explain.
    expect(panel.textContent).toBe('')
  })

  it('says a file player shows the new look only after the video renders again', () => {
    render(<VideoActions livePreview={false} progress={progress} projectId="p1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Style' }))
    expect(screen.getByTestId('caption-panel').textContent).toBe(
      'Shows after the video renders again',
    )
  })

  it.each([true, false])(
    "says a loop's look shows after a render only when it plays its file (captions on: %s)",
    (captionsOn) => {
      mockCaptionsOn = captionsOn
      mockKind = 'loop'
      const { unmount } = render(<VideoActions livePreview progress={progress} projectId="p1" />)
      fireEvent.click(screen.getByRole('button', { name: 'Style' }))
      // Played live by the editor's engine: the switch and the look show at once.
      expect(screen.getByTestId('caption-panel').textContent).toBe('')
      unmount()

      render(<VideoActions livePreview={false} progress={progress} projectId="p1" />)
      fireEvent.click(screen.getByRole('button', { name: 'Style' }))
      expect(screen.getByTestId('caption-panel').textContent).toBe(
        'Shows after the video renders again',
      )
    },
  )

  it('offers no Style while captions are off', () => {
    mockCaptionsOn = false
    render(<VideoActions livePreview progress={progress} projectId="p1" />)
    expect(screen.queryByRole('button', { name: 'Style' })).toBeNull()
  })

  it("keeps a loop's Style while captions are off: its highlight colours the fact stamps", () => {
    mockCaptionsOn = false
    mockKind = 'loop'
    render(<VideoActions livePreview={false} progress={progress} projectId="p1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Style' }))
    expect(screen.getByTestId('caption-panel').dataset.captions).toBe('false')
  })

  it('says under a file player when Download renders the video again in the look chosen', () => {
    mockLookDiffers = true
    render(<VideoActions livePreview={false} progress={progress} projectId="p1" />)
    expect(mockLookDiffersArgs).toHaveBeenLastCalledWith('p1', '16 / 9', true)
    expect(
      screen.getByText("This video's captions are in another style: Download renders it again."),
    ).toBeTruthy()
  })

  it("says so for a loop's fact stamps while its captions are off", () => {
    mockLookDiffers = true
    mockCaptionsOn = false
    mockKind = 'loop'
    render(
      <VideoActions
        livePreview={false}
        progress={{ ...progress, captionsInVideo: false }}
        projectId="p1"
      />,
    )
    expect(mockLookDiffersArgs).toHaveBeenLastCalledWith('p1', '16 / 9', false)
    expect(
      screen.getByText(
        "This video's fact stamps are in another colour: Download renders it again.",
      ),
    ).toBeTruthy()
  })

  it('says nothing about the look when the file has it, or the live preview shows it', () => {
    const { unmount } = render(
      <VideoActions livePreview={false} progress={progress} projectId="p1" />,
    )
    expect(screen.queryByText(/Download renders it again/)).toBeNull()
    unmount()
    mockLookDiffers = true
    render(<VideoActions livePreview progress={progress} projectId="p1" />)
    expect(screen.queryByText(/Download renders it again/)).toBeNull()
  })

  it('lets the captions switch line speak first when it is pending', () => {
    mockLookDiffers = true
    render(
      <VideoActions
        livePreview={false}
        progress={{ ...progress, captionsInVideo: false }}
        projectId="p1"
      />,
    )
    expect(screen.getByText('This video has no captions yet: Download adds them.')).toBeTruthy()
    expect(screen.queryByText(/Download renders it again/)).toBeNull()
  })
})
