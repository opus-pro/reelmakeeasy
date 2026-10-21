import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'

import { ApiError } from '@/lib/api-error'

import { useAgentSession } from './useAgentSession'

type Handlers = { agent: (payload: { data: string }) => void }

const mockFetchApiDomain = jest.fn()
let stream: Handlers | undefined
jest.mock('@/hooks/useApi', () => ({
  useApi: () => ({
    createSSEConnection: (_url: string, handlers: Handlers) => {
      stream = handlers
      return { close: () => undefined, start: () => new Promise(() => undefined) }
    },
    fetchApiDomain: mockFetchApiDomain,
    fetchWithAuth: jest.fn(),
  }),
}))

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={new QueryClient()}>{children}</QueryClientProvider>
)

/** The API: the session loads; a message POST does `onMessage` first. */
function api(onMessage: () => Promise<unknown>) {
  mockFetchApiDomain.mockImplementation((url: string) =>
    url.endsWith('/messages')
      ? onMessage()
      : url === '/api/agent/sessions/{id}'
        ? Promise.resolve({ data: { id: 's1', mode: 'free', status: 'idle', title: 'x' } })
        : Promise.resolve({ data: {} }),
  )
}

async function sendOnce(text: string) {
  const { result } = renderHook(() => useAgentSession('s1'), { wrapper })
  let sent: boolean | undefined
  await act(async () => {
    sent = await result.current.send(text, ['dog.png'])
  })
  return { result, sent }
}

describe('useAgentSession send', () => {
  beforeEach(() => {
    mockFetchApiDomain.mockReset()
    stream = undefined
  })

  it('went: resolves true', async () => {
    api(() => Promise.resolve({ data: {} }))
    expect((await sendOnce('hi')).sent).toBe(true)
  })

  it('a refusal says why and resolves false, so the box gets the text and files back', async () => {
    api(() =>
      Promise.reject(
        new ApiError(
          'Pick what the ranking is about first (the card above), then attach your clips.',
          409,
        ),
      ),
    )
    const { result, sent } = await sendOnce('')
    expect(sent).toBe(false)
    expect(result.current.transcript.entries).toContainEqual(
      expect.objectContaining({
        kind: 'notice',
        text: 'Pick what the ranking is about first (the card above), then attach your clips.',
      }),
    )
  })

  it('a 5xx after the chat shows the message: it went (the failure is in the chat)', async () => {
    api(() => {
      // The server shows the message, then fails to start the turn.
      act(() =>
        stream?.agent({ data: JSON.stringify({ id: 1, text: 'hi', type: 'user_message' }) }),
      )
      return Promise.reject(new ApiError('turn/start failed', 500))
    })
    expect((await sendOnce('hi')).sent).toBe(true)
  })

  it('a 5xx before the message was taken: it never went', async () => {
    api(() => Promise.reject(new ApiError('EACCES: permission denied', 500)))
    expect((await sendOnce('hi')).sent).toBe(false)
  })
})
