import type { SetupStatus } from '@shared/types/api/setup'
import { act, renderHook, waitFor } from '@testing-library/react'

import { ApiError } from '@/lib/api-error'

const mockFetchApiDomain = jest.fn()
jest.mock('@/hooks/useApi', () => ({ useApi: () => ({ fetchApiDomain: mockFetchApiDomain }) }))

// One stable client, as the app's QueryClientProvider gives; only invalidateQueries is used.
const mockQueryClient = { invalidateQueries: jest.fn() }
jest.mock('@tanstack/react-query', () => ({ useQueryClient: () => mockQueryClient }))

import { CHECK_FAILED, NOT_THIS_COMPUTER } from './setup-status'
import { setupStatus } from './setup-status.fixtures'
import { useSetupStatus } from './useSetupStatus'

const STATUS: SetupStatus = setupStatus({ fal: true })

beforeEach(() => {
  mockFetchApiDomain.mockReset()
  mockFetchApiDomain.mockResolvedValue({ data: STATUS, error: null, ok: true, status: 200 })
  mockQueryClient.invalidateQueries.mockReset()
})

describe('useSetupStatus', () => {
  it('reads the status on mount, and Check again asks the agents afresh', async () => {
    const { result } = renderHook(() => useSetupStatus())
    await waitFor(() => expect(result.current.status).toEqual(STATUS))
    expect(mockFetchApiDomain).toHaveBeenCalledWith('/api/setup/status', { method: 'GET' })
    await act(async () => {
      await result.current.recheck()
    })
    expect(mockFetchApiDomain).toHaveBeenLastCalledWith('/api/setup/status?refresh=1', {
      method: 'GET',
    })
    expect(result.current.loading).toBe(false)
  })

  it('saves the writer, then the video maker, refreshes the video lists, then reads the status again', async () => {
    const { result } = renderHook(() => useSetupStatus())
    await waitFor(() => expect(result.current.status).not.toBeNull())
    mockFetchApiDomain.mockClear()
    let saved = false
    await act(async () => {
      saved = await result.current.save({ generation: 'google', llm: 'claude' })
    })
    expect(saved).toBe(true)
    expect(mockFetchApiDomain.mock.calls.map((call) => call[0])).toEqual([
      '/api/setup/llm',
      '/api/setup/generation',
      '/api/setup/status',
    ])
    expect(mockFetchApiDomain.mock.calls[0][1]).toEqual({
      data: { provider: 'claude' },
      method: 'PUT',
    })
    expect(mockFetchApiDomain.mock.calls[1][1]).toEqual({
      data: { provider: 'google' },
      method: 'PUT',
    })
    // The clip-model and quality menus, the voice picker and the engine chips follow the video
    // maker, so the composer must not keep fal's lists after a switch to Gemini.
    expect(mockQueryClient.invalidateQueries.mock.calls).toEqual([
      [{ queryKey: ['models'] }],
      [{ queryKey: ['voice-over-options'] }],
      [{ queryKey: ['tts-engines'] }],
    ])
  })

  it("shows the API's words when it refuses a choice", async () => {
    const { result } = renderHook(() => useSetupStatus())
    await waitFor(() => expect(result.current.status).not.toBeNull())
    mockFetchApiDomain.mockRejectedValueOnce(
      new ApiError('Codex is not available: sign in first', 409),
    )
    let saved = true
    await act(async () => {
      saved = await result.current.save({ llm: 'codex' })
    })
    expect(saved).toBe(false)
    expect(result.current.error).toBe('Codex is not available: sign in first')
    expect(result.current.status).toEqual(STATUS)
    expect(mockQueryClient.invalidateQueries).not.toHaveBeenCalled()
  })

  it('says how to fix it when the API is not reachable', async () => {
    mockFetchApiDomain.mockRejectedValue(new Error('Network Error'))
    const { result } = renderHook(() => useSetupStatus())
    await waitFor(() => expect(result.current.error).toBe(CHECK_FAILED))
    expect(result.current.status).toBeNull()
  })

  it('says Setup only works on this computer when the API answers 403', async () => {
    mockFetchApiDomain.mockRejectedValue(
      new ApiError('Agent mode only accepts requests from this computer', 403),
    )
    const { result } = renderHook(() => useSetupStatus())
    await waitFor(() => expect(result.current.error).toBe(NOT_THIS_COMPUTER))
    expect(result.current.status).toBeNull()
  })
})
