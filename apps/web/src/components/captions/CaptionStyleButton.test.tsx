import { fireEvent, render, screen } from '@testing-library/react'

import { CaptionStyleButton } from './CaptionStyleButton'

let mockKind: 'loop' | 'video' = 'video'

jest.mock('@/util/browserUtils', () => ({ useIsMobile: () => false }))
jest.mock('@/components/agent/useAgentProject', () => ({
  useProjectAspectRatio: () => '16 / 9',
}))
jest.mock('./useCaptionSettings', () => ({
  useCaptionStatus: () => ({ settled: true, status: { kind: mockKind } }),
}))
jest.mock('./CaptionSettingsPanel', () => ({
  CaptionSettingsPanel: ({
    aspectRatio,
    loopNote,
    note,
  }: {
    aspectRatio: string
    loopNote?: string
    note?: string
  }) => (
    <div data-loop-note={loopNote} data-note={note} data-ratio={aspectRatio} data-testid="panel" />
  ),
}))

// Radix popovers measure their anchor; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= jest.fn(() => ({
  disconnect: jest.fn(),
  observe: jest.fn(),
  unobserve: jest.fn(),
})) as unknown as typeof ResizeObserver

const base = { captionsOn: true, disabled: false, livePreview: true, projectId: 'p1' }

describe('CaptionStyleButton', () => {
  beforeEach(() => {
    mockKind = 'video'
  })

  it("opens the panel at the project's aspect ratio unless one is given", () => {
    const { unmount } = render(<CaptionStyleButton {...base} />)
    fireEvent.click(screen.getByRole('button', { name: 'Style' }))
    expect(screen.getByTestId('panel').dataset.ratio).toBe('16 / 9')
    unmount()

    render(<CaptionStyleButton {...base} aspectRatio="9:16" loopNote="No stamps yet" />)
    fireEvent.click(screen.getByRole('button', { name: 'Style' }))
    expect(screen.getByTestId('panel').dataset).toMatchObject({
      loopNote: 'No stamps yet',
      ratio: '9:16',
    })
  })

  it('says a file player shows the change only after the next render', () => {
    render(<CaptionStyleButton {...base} livePreview={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Style' }))
    expect(screen.getByTestId('panel').dataset.note).toBe('Shows after the video renders again')
  })

  it("shows nothing with captions off, except for a loop's highlight", () => {
    const { unmount } = render(<CaptionStyleButton {...base} captionsOn={false} />)
    expect(screen.queryByRole('button', { name: 'Style' })).toBeNull()
    unmount()

    mockKind = 'loop'
    render(<CaptionStyleButton {...base} captionsOn={false} />)
    expect(screen.getByRole('button', { name: 'Style' })).toBeTruthy()
  })

  it('takes the size of the links around it', () => {
    render(<CaptionStyleButton {...base} className="text-xs" disabled />)
    const style = screen.getByRole('button', { name: 'Style' }) as HTMLButtonElement
    expect(style.className.split(' ')).toContain('text-xs')
    expect(style.className.split(' ')).not.toContain('text-sm')
    expect(style.disabled).toBe(true)
  })
})
