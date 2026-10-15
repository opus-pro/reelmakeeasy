import { fireEvent, render, screen } from '@testing-library/react'
import { getDefaultStore } from 'jotai'

import { renderSettingsAtom } from '@/atom/longtake-history.store'
import { useCaptionStyleRenderSync } from '@/components/captions/useCaptionSettings'
import { useVideoScript } from '@/hooks/useVideoScript'

import { useReadVideoScriptOnDelivery } from './hooks/useReadVideoScriptOnDelivery'
import { DetailPanel } from './DetailPanel'

let mockKind: 'loop' | 'video' = 'video'

jest.mock('@/components/captions/CaptionSettingsPanel', () => ({
  CaptionSettingsPanel: ({
    aspectRatio,
    captionsOn,
    disabled,
    loopNote,
    note,
    projectId,
  }: {
    aspectRatio: string
    captionsOn: boolean
    disabled: boolean
    loopNote?: string
    note?: string
    projectId: string
  }) => (
    <div
      data-captions={String(captionsOn)}
      data-disabled={String(disabled)}
      data-loop-note={loopNote}
      data-note={note}
      data-project={projectId}
      data-ratio={aspectRatio}
      data-testid="caption-panel"
    />
  ),
}))
jest.mock('@/components/captions/useCaptionSettings', () => ({
  useCaptionStatus: () => ({ settled: true, status: { kind: mockKind } }),
  useCaptionStyleRenderSync: jest.fn(),
}))
jest.mock('@/components/agent/useAgentProject', () => ({
  useProjectAspectRatio: () => '9 / 16',
}))
jest.mock('@/util/browserUtils', () => ({ useIsMobile: () => false }))
jest.mock('@/hooks/useVideoScript', () => ({ useVideoScript: jest.fn() }))
jest.mock('./hooks/useReadVideoScriptOnDelivery', () => ({
  useReadVideoScriptOnDelivery: jest.fn(),
}))
jest.mock('./use-resolved-project-style', () => ({
  useResolvedProjectStyle: () => ({ effectiveStyleText: '', styleName: 'Style' }),
}))
jest.mock('@/hooks/useStoryModeShareActions', () => ({
  useStoryModeShareActions: () => ({
    canCopyStyle: false,
    canRemix: false,
    handleCopyStyle: jest.fn(),
    handleRemix: jest.fn(),
    handleShare: jest.fn(),
  }),
}))
jest.mock('@/hooks/useProjectShareControls', () => ({ useProjectShareControls: () => ({}) }))
jest.mock('@/app/story-mode/hook/useMusicToggle', () => ({
  musicRequestFromProject: () => ({ choice: 'off' }),
  useLiveMusicVolume: () => 50,
  useMusicToggle: () => ({ busy: false, musicOn: false }),
}))
jest.mock('@/app/story-mode/components/StoryModeInputTranscriptPanels', () => ({
  StoryModeInputTranscriptPanels: () => null,
}))
jest.mock('@/components/delete-project-dialog/DeleteProjectDialog', () => ({
  DeleteProjectDialog: () => null,
}))
jest.mock('@/components/music/MusicChangeButton', () => ({ MusicChangeButton: () => null }))
jest.mock('@/components/music/MusicVolumeSlider', () => ({ MusicVolumeSlider: () => null }))
jest.mock('./ActionButtons', () => ({ ActionButtons: () => null }))
jest.mock('./MobileDetailMenu', () => ({ MobileDetailMenu: () => null }))
jest.mock('./StyleSummaryCard', () => ({ StyleSummaryCard: () => null }))
jest.mock('./TopActionRow', () => ({ TopActionRow: () => null }))

// Radix popovers measure their anchor; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= jest.fn(() => ({
  disconnect: jest.fn(),
  observe: jest.fn(),
  unobserve: jest.fn(),
})) as unknown as typeof ResizeObserver

const store = getDefaultStore()

function renderPanel(props: Partial<Parameters<typeof DetailPanel>[0]> = {}) {
  return render(
    <DetailPanel
      isOwner
      projectId="p1"
      ratio="16:9"
      showCaptionSwitch
      stage="completed"
      videoUrl="http://localhost:5017/api/files/p1/final.mp4"
      {...props}
    />,
  )
}

function setCaptions(on: boolean) {
  store.set(renderSettingsAtom, (prev) => ({
    ...prev,
    captionEnabled: { latest: on, original: on },
  }))
}

/** The video script the editor preview draws from (the last render's). */
function setVideoScript(data: unknown, isLoading = false) {
  jest
    .mocked(useVideoScript)
    .mockReturnValue({ data, isLoading } as ReturnType<typeof useVideoScript>)
}

/** "Style" under the Caption switch: opens the caption look's controls in a popover. */
function openStyle(): HTMLElement {
  fireEvent.click(screen.getByRole('button', { name: 'Style' }))
  return screen.getByTestId('caption-panel')
}

describe('DetailPanel caption look', () => {
  beforeEach(() => {
    jest.mocked(useCaptionStyleRenderSync).mockClear()
    mockKind = 'video'
    setCaptions(true)
    setVideoScript({ tracks: [] })
  })

  it("opens the caption look's controls from Style under the Caption switch, as in the chat", () => {
    renderPanel()
    // No controls inline in the card: only the link, after the switch's label.
    expect(screen.queryByTestId('caption-panel')).toBeNull()
    const style = screen.getByRole('button', { name: 'Style' })
    expect(screen.getByText('Caption').compareDocumentPosition(style)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    )
    // In the Caption row's block, with the switch.
    const row = screen.getByText('Caption').closest('.flex-col')
    expect(row?.contains(style)).toBe(true)
    expect(row?.querySelector('[role="switch"]')).not.toBeNull()

    const panel = openStyle()
    expect(panel.dataset).toMatchObject({
      captions: 'true',
      disabled: 'false',
      project: 'p1',
      ratio: '16:9',
    })
    // The editor's preview shows each change at once: nothing to explain.
    expect(panel.dataset.note).toBeUndefined()
    // In the popover, not in the card.
    expect(row?.contains(panel)).toBe(false)
    expect(panel.closest('.w-80')).not.toBeNull()
  })

  it('keeps Style reachable: the card scrolls and the transcript keeps room', () => {
    renderPanel()
    // The card around the transcript and the switches.
    const card = screen.getByRole('button', { name: 'Style' }).closest('.rounded-2xl')
    expect(card?.className.split(' ')).toContain('overflow-y-auto')
    expect(card?.className.split(' ')).not.toContain('overflow-hidden')
    // The transcript shrinks to make room, but not to nothing.
    const transcript = card?.firstElementChild
    expect(transcript?.className.split(' ')).not.toContain('min-h-0')
    expect(transcript?.className).toMatch(/\bmin-h-\d+\b/)
  })

  it("says a loop's fact stamps show only in the downloaded video while its preview has none", () => {
    // Rendered before stamps were a track: its video script has captions only.
    setVideoScript({ tracks: [{ id: 'track-caption', segments: [], type: 'caption' }] })
    renderPanel()
    expect(openStyle().dataset.loopNote).toBe(
      'This preview has no fact stamps: they show in the downloaded video.',
    )
  })

  it('says nothing about the stamps once a render saved them, none for a loop without stamps', () => {
    // A loop whose clips have no stamp: its render saves an empty facts track, and its file has
    // no stamps either.
    setVideoScript({ tracks: [{ id: 'track-facts', segments: [], type: 'facts' }] })
    renderPanel()
    expect(openStyle().dataset.loopNote).toBeUndefined()
  })

  it('reads the video script again once the video it showed generating is delivered', () => {
    const read = jest.mocked(useReadVideoScriptOnDelivery)
    const { rerender } = renderPanel({ stage: 'render', videoUrl: undefined })
    expect(read).toHaveBeenLastCalledWith('p1', false)

    const done = {
      stage: 'completed' as const,
      videoUrl: 'http://localhost:5017/api/files/p1/final.mp4',
    }
    rerender(<DetailPanel isOwner projectId="p1" ratio="16:9" showCaptionSwitch {...done} />)
    expect(read).toHaveBeenLastCalledWith('p1', true)

    // The stage unknown (the status not read yet): no change to act on.
    renderPanel({ stage: undefined })
    expect(read).toHaveBeenLastCalledWith('p1', undefined)
  })

  it('says nothing about the stamps before the video script is read', () => {
    setVideoScript(undefined, true)
    renderPanel()
    expect(openStyle().dataset.loopNote).toBeUndefined()
  })

  it('locks Style until the video is done', () => {
    renderPanel({ stage: 'render' })
    const style = screen.getByRole('button', { name: 'Style' }) as HTMLButtonElement
    expect(style.disabled).toBe(true)
    fireEvent.click(style)
    expect(screen.queryByTestId('caption-panel')).toBeNull()
  })

  it("keeps a loop's Style while captions are off: its highlight still colours its fact stamps", () => {
    setCaptions(false)
    mockKind = 'loop'
    renderPanel()
    expect(openStyle().dataset.captions).toBe('false')
  })

  it('offers no Style while captions are off for any other video', () => {
    setCaptions(false)
    renderPanel()
    expect(screen.queryByRole('button', { name: 'Style' })).toBeNull()
  })

  it('keeps Style off the phone layout, which says to open the project on a desktop', () => {
    renderPanel({ isMobile: true })
    expect(screen.queryByRole('button', { name: 'Style' })).toBeNull()
  })

  it("compares the delivered look for the owner's Download only", () => {
    renderPanel()
    expect(useCaptionStyleRenderSync).toHaveBeenLastCalledWith('p1', '16:9')
    renderPanel({ isOwner: false, shareMode: true })
    expect(useCaptionStyleRenderSync).toHaveBeenLastCalledWith('', '16:9')
  })
})
