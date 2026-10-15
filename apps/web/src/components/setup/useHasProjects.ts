'use client'

import { useQuery } from '@tanstack/react-query'

import { fetchProjectsPage, PROJECTS_QUERY_KEY } from '@/hooks/projects-query-utils'
import { useApi } from '@/hooks/useApi'

/** Under the projects prefix, so creating or deleting a project refreshes it. */
const HAS_PROJECTS_QUERY_KEY = [PROJECTS_QUERY_KEY, 'has-any'] as const

/** Whether the user has any project (one page of one), read only while `enabled`.
 *  `hasProjects` is undefined while loading, and when the request failed. */
export function useHasProjects(enabled: boolean): {
  hasProjects: boolean | undefined
  loading: boolean
} {
  const { fetchApiDomain } = useApi()
  const { data, isLoading } = useQuery({
    enabled,
    queryFn: async () => {
      const page = await fetchProjectsPage(fetchApiDomain, {
        page: 1,
        pageSize: 1,
        q: 'me',
        sort: 'createdAt',
      })
      // A total of -1 means it wasn't counted: the page itself says then.
      return (page?.pagination?.total ?? 0) > 0 || (page?.data?.length ?? 0) > 0
    },
    queryKey: HAS_PROJECTS_QUERY_KEY,
  })
  return { hasProjects: data, loading: isLoading }
}
