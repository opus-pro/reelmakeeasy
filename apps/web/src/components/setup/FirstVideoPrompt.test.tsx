import type { SetupStatus } from '@shared/types/api/setup'
import { act, fireEvent, render, screen } from '@testing-library/react'

let mockProjects: { hasProjects: boolean | undefined; loading: boolean } = {
  hasProjects: false,
  loading: false,
}
const mockUseHasProjects = jest.fn((_enabled: boolean) => mockProjects)
jest.mock('./useHasProjects', () => ({
  useHasProjects: (enabled: boolean) => mockUseHasProjects(enabled),
}))

const mockStart = jest.fn()
let mockStarting = false
let mockStartOptions: unknown
jest.mock('@/components/agent/useStartAgentSession', () => ({
  useStartAgentSession: (options: unknown) => {
    mockStartOptions = options
    return { start: mockStart, starting: mockStarting }
  },
}))

import { EXAMPLE_IDEA, FIRST_VIDEO_ANSWERED_KEY } from './first-video'
import { FirstVideoPrompt } from './FirstVideoPrompt'
import { missing, ready, setupStatus } from './setup-status.fixtures'

/** Claude Code writes, fal makes the videos. */
const CLAUDE_FAL = setupStatus({ claude: ready, fal: true })
/** Gemini writes and makes the videos; no agent on this computer. */
const GEMINI_ONLY = setupStatus({ claude: missing, gemini: true })

function renderPrompt(
  status: null | SetupStatus,
  over: { cardShowing?: boolean; checking?: boolean } = {},
) {
  const onBusyChange = jest.fn()
  const onTryExample = jest.fn()
  const view = render(
    <FirstVideoPrompt
      cardShowing={over.cardShowing ?? false}
      checking={over.checking ?? false}
      onBusyChange={onBusyChange}
      onTryExample={onTryExample}
      status={status}
    />,
  )
  return { ...view, onBusyChange, onTryExample }
}

const TITLE = 'Make your first video?'

beforeEach(() => {
  localStorage.clear()
  mockProjects = { hasProjects: false, loading: false }
  mockUseHasProjects.mockClear()
  mockStart.mockReset()
  mockStart.mockResolvedValue(true)
  mockStarting = false
  mockStartOptions = undefined
})

describe('FirstVideoPrompt', () => {
  it('asks a new user once setup is complete and there is no video yet', () => {
    const { onBusyChange } = renderPrompt(CLAUDE_FAL)
    expect(screen.getByText(TITLE)).toBeTruthy()
    expect(mockUseHasProjects).toHaveBeenLastCalledWith(true)
    expect(onBusyChange).toHaveBeenLastCalledWith(true)
  })

  it('stays away when there is a video already', () => {
    mockProjects = { hasProjects: true, loading: false }
    const { onBusyChange } = renderPrompt(CLAUDE_FAL)
    expect(screen.queryByText(TITLE)).toBeNull()
    expect(onBusyChange).toHaveBeenLastCalledWith(false)
  })

  it('never shows while the Get set up card is showing, and does not look for videos then', () => {
    renderPrompt(CLAUDE_FAL, { cardShowing: true })
    expect(screen.queryByText(TITLE)).toBeNull()
    expect(mockUseHasProjects).toHaveBeenLastCalledWith(false)
  })

  it('shows once the card is saved and goes away (same status source)', () => {
    const { rerender } = renderPrompt(setupStatus({ claude: missing, fal: true }), {
      cardShowing: true,
    })
    expect(screen.queryByText(TITLE)).toBeNull()
    rerender(<FirstVideoPrompt cardShowing={false} checking={false} status={CLAUDE_FAL} />)
    expect(screen.getByText(TITLE)).toBeTruthy()
  })

  it('is busy (holding the home tour) while it checks for videos', () => {
    mockProjects = { hasProjects: undefined, loading: true }
    const { onBusyChange } = renderPrompt(CLAUDE_FAL)
    expect(screen.queryByText(TITLE)).toBeNull()
    expect(onBusyChange).toHaveBeenLastCalledWith(true)
  })

  it('is busy while the setup status loads, and not when the video check failed', () => {
    const loading = renderPrompt(null, { checking: true })
    expect(loading.onBusyChange).toHaveBeenLastCalledWith(true)
    loading.unmount()
    mockProjects = { hasProjects: undefined, loading: false }
    const failed = renderPrompt(CLAUDE_FAL)
    expect(screen.queryByText(TITLE)).toBeNull()
    expect(failed.onBusyChange).toHaveBeenLastCalledWith(false)
  })

  it('stays away once answered in this browser, without looking for videos', () => {
    localStorage.setItem(FIRST_VIDEO_ANSWERED_KEY, '1')
    const { onBusyChange } = renderPrompt(CLAUDE_FAL)
    expect(screen.queryByText(TITLE)).toBeNull()
    expect(mockUseHasProjects).toHaveBeenLastCalledWith(false)
    expect(onBusyChange).toHaveBeenLastCalledWith(false)
  })

  it('Not now remembers the answer and closes', () => {
    const { onBusyChange } = renderPrompt(CLAUDE_FAL)
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }))
    expect(localStorage.getItem(FIRST_VIDEO_ANSWERED_KEY)).toBe('1')
    expect(screen.queryByText(TITLE)).toBeNull()
    expect(onBusyChange).toHaveBeenLastCalledWith(false)
    expect(mockStart).not.toHaveBeenCalled()
  })

  it('closing it hides it for this visit only: nothing is remembered, and a reload asks again', () => {
    const first = renderPrompt(CLAUDE_FAL)
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(screen.queryByText(TITLE)).toBeNull()
    expect(localStorage.getItem(FIRST_VIDEO_ANSWERED_KEY)).toBeNull()
    expect(first.onBusyChange).toHaveBeenLastCalledWith(false)
    first.unmount()
    renderPrompt(CLAUDE_FAL)
    expect(screen.getByText(TITLE)).toBeTruthy()
  })

  it('Go opens a new chat on the agent that writes, with Easy already chosen', async () => {
    renderPrompt(CLAUDE_FAL)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Go' }))
    })
    expect(mockStart).toHaveBeenCalledWith('claude', { easy: true })
    // From the home page: a full page load (the agent page needs its own headers).
    expect(mockStartOptions).toEqual({ hard: true })
    expect(localStorage.getItem(FIRST_VIDEO_ANSWERED_KEY)).toBe('1')
    // The page is leaving: the dialog stays until it does.
    expect(screen.getByText(TITLE)).toBeTruthy()
  })

  it('closes when the chat could not open (a toast says why)', async () => {
    mockStart.mockResolvedValue(false)
    renderPrompt(CLAUDE_FAL)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Go' }))
    })
    expect(screen.queryByText(TITLE)).toBeNull()
  })

  it('without Codex or Claude Code, Try an example puts an idea in the home box', () => {
    const { onTryExample } = renderPrompt(GEMINI_ONLY)
    expect(screen.getByText('A 30-second video costs about $3 on Gemini.')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Try an example' }))
    expect(onTryExample).toHaveBeenCalledWith(EXAMPLE_IDEA)
    expect(mockStart).not.toHaveBeenCalled()
    expect(localStorage.getItem(FIRST_VIDEO_ANSWERED_KEY)).toBe('1')
    expect(screen.queryByText(TITLE)).toBeNull()
  })
})
