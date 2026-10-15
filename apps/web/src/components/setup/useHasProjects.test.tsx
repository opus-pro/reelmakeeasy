import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'

const mockFetchApiDomain = jest.fn()
jest.mock('@/hooks/useApi', () => ({ useApi: () => ({ fetchApiDomain: mockFetchApiDomain }) }))

import { getProjectsQueryKeyPrefix } from '@/hooks/projects-query-utils'

import { useHasProjects } from './useHasProjects'

function page(total: number, count = 0) {
  return {
    data: {
      data: Array.from({ length: count }, (_, i) => ({ id: `p${i}` })),
      pagination: { total },
    },
  }
}

function setup(enabled: boolean) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, ...renderHook(() => useHasProjects(enabled), { wrapper }) }
}

beforeEach(() => mockFetchApiDomain.mockReset())

describe('useHasProjects', () => {
  it('asks for nothing until enabled', () => {
    const { result } = setup(false)
    expect(result.current).toEqual({ hasProjects: undefined, loading: false })
    expect(mockFetchApiDomain).not.toHaveBeenCalled()
  })

  it("reads one of the user's projects and says there are none", async () => {
    mockFetchApiDomain.mockResolvedValue(page(0))
    const { result } = setup(true)
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current).toEqual({ hasProjects: false, loading: false }))
    const url = new URL(mockFetchApiDomain.mock.calls[0][0] as string, 'http://x')
    expect(url.pathname).toBe('/api/project')
    expect(url.searchParams.get('q')).toBe('me')
    expect(url.searchParams.get('page')).toBe('1')
    expect(url.searchParams.get('pageSize')).toBe('1')
  })

  it('says there are some from the total, or from the page when there is no total', async () => {
    mockFetchApiDomain.mockResolvedValue(page(3, 1))
    const counted = setup(true)
    await waitFor(() => expect(counted.result.current.hasProjects).toBe(true))
    mockFetchApiDomain.mockResolvedValue(page(-1, 1))
    const uncounted = setup(true)
    await waitFor(() => expect(uncounted.result.current.hasProjects).toBe(true))
  })

  it('does not know when the request fails', async () => {
    mockFetchApiDomain.mockRejectedValue(new Error('Network Error'))
    const { result } = setup(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.hasProjects).toBeUndefined()
  })

  it('lives under the projects key, so a new or deleted project refreshes it', async () => {
    mockFetchApiDomain.mockResolvedValue(page(0))
    const { client, result } = setup(true)
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(client.getQueryCache().findAll({ queryKey: getProjectsQueryKeyPrefix() })).toHaveLength(
      1,
    )
  })
})
