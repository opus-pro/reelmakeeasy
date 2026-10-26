import { renderHook, waitFor } from '@testing-library/react'

import { useChatModel } from './useChatModel'

const mockFetchApiDomain = jest.fn(async () => ({
  data: { current: null, default: null, models: [], recommended: null, source: 'recommended' },
}))
jest.mock('@/hooks/useApi', () => ({ useApi: () => ({ fetchApiDomain: mockFetchApiDomain }) }))

describe('useChatModel', () => {
  it('asks again when the chat moves to another agent or mode', async () => {
    const { rerender } = renderHook(({ key }) => useChatModel('s1', true, key), {
      initialProps: { key: 'codex:' },
    })
    await waitFor(() => expect(mockFetchApiDomain).toHaveBeenCalledTimes(1))
    rerender({ key: 'claude:animation' })
    await waitFor(() => expect(mockFetchApiDomain).toHaveBeenCalledTimes(2))
    rerender({ key: 'claude:animation' })
    expect(mockFetchApiDomain).toHaveBeenCalledTimes(2)
  })
})
