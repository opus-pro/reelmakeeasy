import { act, renderHook } from '@testing-library/react'

const mockFetchApiDomain = jest.fn()
jest.mock('@/hooks/useApi', () => ({ useApi: () => ({ fetchApiDomain: mockFetchApiDomain }) }))
const mockPush = jest.fn()
jest.mock('next/navigation', () => ({ useRouter: () => ({ push: mockPush }) }))
const mockHardNavigate = jest.fn()
jest.mock('@/util/hard-navigation', () => ({
  hardNavigate: (url: string) => mockHardNavigate(url),
}))
const mockToastError = jest.fn()
jest.mock('@shared/ui', () => ({ toast: { error: (text: string) => mockToastError(text) } }))

import { useStartAgentSession } from './useStartAgentSession'

const NOT_READY = {
  available: false,
  binary: null,
  loggedIn: false,
  reason: 'not-found',
  version: null,
}

beforeEach(() => {
  mockFetchApiDomain.mockReset()
  mockPush.mockReset()
  mockHardNavigate.mockReset()
  mockToastError.mockReset()
})

describe('useStartAgentSession', () => {
  it('opens a new chat on the picked agent with the Easy marker, by a full page load', async () => {
    mockFetchApiDomain.mockResolvedValue({ data: { id: 's1' } })
    const { result } = renderHook(() => useStartAgentSession({ hard: true }))
    let opened: boolean | undefined
    await act(async () => {
      opened = await result.current.start('claude', { easy: true })
    })
    expect(opened).toBe(true)
    expect(mockFetchApiDomain).toHaveBeenCalledTimes(1)
    expect(mockFetchApiDomain).toHaveBeenCalledWith('/api/agent/sessions', {
      data: { harness: 'claude' },
      method: 'POST',
    })
    expect(mockHardNavigate).toHaveBeenCalledWith('/agent?sessionId=s1&start=easy')
    // Still "starting" while the page leaves, so a second click can't open another chat.
    expect(result.current.starting).toBe(true)
  })

  it('without the option, opens the chat as before', async () => {
    mockFetchApiDomain.mockResolvedValue({ data: { id: 's2' } })
    const { result } = renderHook(() => useStartAgentSession({ hard: false }))
    await act(async () => {
      await result.current.start('codex')
    })
    expect(mockPush).toHaveBeenCalledWith('/agent?sessionId=s2')
  })

  it('says why and resolves false when no agent is ready', async () => {
    mockFetchApiDomain.mockResolvedValue({
      data: { ...NOT_READY, claude: NOT_READY, codex: NOT_READY, defaultHarness: 'codex' },
    })
    const { result } = renderHook(() => useStartAgentSession({ hard: true }))
    let opened: boolean | undefined
    await act(async () => {
      opened = await result.current.start(undefined, { easy: true })
    })
    expect(opened).toBe(false)
    expect(mockToastError).toHaveBeenCalledWith('Install Codex or Claude Code to use Agent mode')
    expect(mockHardNavigate).not.toHaveBeenCalled()
    expect(result.current.starting).toBe(false)
  })

  it('a second start while one is under way (a double click) makes no second chat', async () => {
    let created = (_session: { data: { id: string } }): void => undefined
    mockFetchApiDomain.mockReturnValue(
      new Promise((resolve) => {
        created = resolve
      }),
    )
    const { result } = renderHook(() => useStartAgentSession({ hard: false }))
    let first: Promise<boolean> | undefined
    let second: boolean | undefined
    await act(async () => {
      // Both clicks land before React re-renders with `starting`.
      first = result.current.start('codex')
      second = await result.current.start('codex')
    })
    expect(second).toBe(false)
    await act(async () => {
      created({ data: { id: 's3' } })
      await first
    })
    expect(await first).toBe(true)
    expect(mockFetchApiDomain).toHaveBeenCalledTimes(1)
    expect(mockPush).toHaveBeenCalledTimes(1)
    // Once it has opened, the next start works again.
    mockFetchApiDomain.mockResolvedValue({ data: { id: 's4' } })
    await act(async () => {
      await result.current.start('codex')
    })
    expect(mockPush).toHaveBeenLastCalledWith('/agent?sessionId=s4')
  })

  it('resolves false when the chat could not be created', async () => {
    mockFetchApiDomain.mockRejectedValue(new Error('Network Error'))
    const { result } = renderHook(() => useStartAgentSession({ hard: true }))
    let opened: boolean | undefined
    await act(async () => {
      opened = await result.current.start('codex', { easy: true })
    })
    expect(opened).toBe(false)
    expect(mockToastError).toHaveBeenCalled()
  })
})
