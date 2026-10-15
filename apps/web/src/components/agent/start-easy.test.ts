import type { AgentMode, AgentSession } from '@shared/types/api/agent'
import { act, renderHook, waitFor } from '@testing-library/react'

import {
  agentChatUrl,
  START_EASY_PARAM,
  type StartEasyInput,
  startsEasy,
  useStartEasyOnce,
} from './start-easy'

function session(over: Partial<AgentSession> = {}): AgentSession {
  return {
    createdAt: '2026-10-10T00:00:00.000Z',
    harness: 'claude',
    id: 's1',
    projectId: null,
    status: 'idle',
    threadId: null,
    title: 'New chat',
    ...over,
  }
}

describe('agentChatUrl', () => {
  it('opens the chat, with the Easy marker when asked', () => {
    expect(agentChatUrl('a b')).toBe('/agent?sessionId=a%20b')
    expect(agentChatUrl('s1', { easy: true })).toBe(`/agent?sessionId=s1&${START_EASY_PARAM}=easy`)
  })
})

describe('startsEasy', () => {
  it('reads the marker from the page URL', () => {
    expect(startsEasy(new URLSearchParams('sessionId=s1&start=easy'))).toBe(true)
    expect(startsEasy(new URLSearchParams('sessionId=s1'))).toBe(false)
    expect(startsEasy(new URLSearchParams('sessionId=s1&start=guided'))).toBe(false)
    expect(startsEasy(null)).toBe(false)
  })
})

describe('useStartEasyOnce', () => {
  function setup(initial: Partial<StartEasyInput>, accepted = true) {
    const chooseMode = jest.fn(async (_mode: AgentMode, _harness?: string) => accepted)
    const onConsumed = jest.fn()
    const input: StartEasyInput = {
      chooseMode,
      marked: true,
      mode: null,
      onConsumed,
      session: null,
      ...initial,
    }
    const hook = renderHook((props: StartEasyInput) => useStartEasyOnce(props), {
      initialProps: input,
    })
    return { ...hook, chooseMode, input, onConsumed }
  }

  it("chooses Easy on the chat's agent once the session loads, exactly once", async () => {
    const { chooseMode, input, onConsumed, rerender, result } = setup({})
    // The session is still loading: nothing yet.
    expect(chooseMode).not.toHaveBeenCalled()
    expect(result.current).toBeNull()

    rerender({ ...input, session: session() })
    await waitFor(() => expect(chooseMode).toHaveBeenCalledTimes(1))
    expect(chooseMode).toHaveBeenCalledWith('autonomous', 'claude')
    expect(onConsumed).toHaveBeenCalledTimes(1)
    // The welcome card shows Easy starting.
    expect(result.current).toBe('autonomous')

    // A session refresh, the marker leaving the URL, the mode arriving: never again.
    rerender({ ...input, marked: false, session: session({ title: 'Renamed' }) })
    rerender({ ...input, marked: true, mode: null, session: session({ updatedAt: 'later' }) })
    rerender({ ...input, mode: 'autonomous', session: session({ mode: 'autonomous' }) })
    expect(chooseMode).toHaveBeenCalledTimes(1)
    expect(onConsumed).toHaveBeenCalledTimes(1)
  })

  it('does nothing without the marker', () => {
    const { chooseMode, onConsumed } = setup({ marked: false, session: session() })
    expect(chooseMode).not.toHaveBeenCalled()
    expect(onConsumed).not.toHaveBeenCalled()
  })

  it('does not choose again for a chat that already has a mode, but drops the marker', () => {
    const { chooseMode, onConsumed, result } = setup({
      mode: 'free',
      session: session({ mode: 'free' }),
    })
    expect(chooseMode).not.toHaveBeenCalled()
    expect(onConsumed).toHaveBeenCalledTimes(1)
    expect(result.current).toBeNull()
  })

  it('lets the user pick again when the choice is refused', async () => {
    const { chooseMode, result } = setup({ session: session() }, false)
    await waitFor(() => expect(chooseMode).toHaveBeenCalledTimes(1))
    await act(async () => undefined)
    expect(result.current).toBeNull()
  })
})
