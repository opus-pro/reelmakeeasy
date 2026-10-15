import { act, renderHook } from '@testing-library/react'

const mockFetchApiDomain = jest.fn()
jest.mock('@/hooks/useApi', () => ({ useApi: () => ({ fetchApiDomain: mockFetchApiDomain }) }))
jest.mock('@/hooks/useSignedUpload', () => ({ useSignedUpload: () => ({ uploadFile: jest.fn() }) }))

import { useMusicCatalog } from './useMusicCatalog'

const track = {
  aiGenerated: false,
  createdAt: 'x',
  durationSec: 26,
  id: 't1',
  name: 'Brand Theme',
  url: 'u',
}
const lib = { description: '', id: 'quiet-piano', mood: 'calm', title: 'Quiet Piano', variants: [] }

describe('useMusicCatalog', () => {
  it('keeps the lists it has when a later re-read fails', async () => {
    mockFetchApiDomain.mockImplementation(async (path: string) =>
      path.endsWith('/library')
        ? { data: { data: { tracks: [lib] } }, ok: true }
        : { data: { data: { tracks: [track] } }, ok: true },
    )
    const { result } = renderHook(() => useMusicCatalog())
    await act(async () => {
      await result.current.refresh()
    })
    expect(result.current.mine).toHaveLength(1)
    mockFetchApiDomain.mockImplementation(async () => ({ error: 'offline', ok: false }))
    await act(async () => {
      await result.current.refresh()
    })
    expect(result.current.mine).toHaveLength(1)
    expect(result.current.library).toHaveLength(1)
    expect(result.current.loaded).toBe(true)
  })
})
