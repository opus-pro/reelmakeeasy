import { PaginatedResponse } from '@shared/types/api/common/pagination'
import { DemoProject } from '@shared/types/api/demo-project'
import { QuickStartProjectType, QuickStartTemplate } from '@shared/types/assets/quick-start'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { useAtomValue, useSetAtom } from 'jotai'
import { useEffect, useMemo } from 'react'

import { quickStartTemplatesAtom } from '@/atom/home'
import { useApi } from '@/hooks/useApi'
import { getNextPageParam } from '@/util/pagination'

import {
  fetchDemoProjectsPage,
  mapDemoProjectsToQuickStartTemplates,
  mapDemoProjectToQuickStartTemplate,
} from './quick-start-template-utils'

export const useQuickStartTemplateList = (
  pageSize = 20,
  projectType?: QuickStartProjectType,
  useCase?: string,
  goal?: string,
  industry?: string,
): {
  demoProjectsError: Error | null
  fetchNextPage: () => void
  hasNextPage: boolean
  isFetchingNextPage: boolean
  isLoadingDemoProjects: boolean
} => {
  const { fetchApiDomain } = useApi()
  const setQuickStartTemplatesAtom = useSetAtom(quickStartTemplatesAtom)

  const {
    data: demoProjectsData,
    isLoading: isLoadingDemoProjects,
    error: demoProjectsError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery<PaginatedResponse<QuickStartTemplate>>({
    enabled: !!projectType,
    initialPageParam: 1,
    queryFn: async ({ pageParam }) => {
      if (!projectType) {
        return { data: [], pagination: { page: 1, pageSize, pageTotal: 0, total: 0 } }
      }

      const response = await fetchDemoProjectsPage(fetchApiDomain, {
        goal,
        industry,
        page: Number(pageParam),
        pageSize,
        projectType,
        useCase,
      })

      return {
        ...response,
        data: mapDemoProjectsToQuickStartTemplates(response.data ?? []),
      }
    },
    queryKey: ['project-type', projectType, pageSize, useCase, goal, industry],
    getNextPageParam,
    refetchOnWindowFocus: false,
  })

  // Flatten all pages into a single list
  const allTemplates = useMemo(() => {
    if (!demoProjectsData?.pages) {
      return []
    }
    return demoProjectsData.pages.flatMap((page) => page.data ?? [])
  }, [demoProjectsData])

  useEffect(() => {
    if (projectType && !isLoadingDemoProjects) {
      setQuickStartTemplatesAtom(allTemplates)
    }
  }, [allTemplates, projectType, isLoadingDemoProjects, setQuickStartTemplatesAtom])

  return {
    demoProjectsError: demoProjectsError as Error | null,
    fetchNextPage,
    hasNextPage: hasNextPage ?? false,
    isFetchingNextPage,
    isLoadingDemoProjects,
  }
}

/**
 * Hook to fetch a single template by ID for deep link scenarios.
 * Uses TanStack Query to handle race conditions automatically.
 *
 * This is a pure fetch hook - it only fetches the template data.
 * State management (storing to atom, cleanup) is handled by the caller.
 */
export const useDeepLinkTemplate = (
  templateId: null | string,
): {
  deepLinkTemplate: null | QuickStartTemplate
  isError: boolean
  isLoading: boolean
} => {
  const { fetchApiDomain } = useApi()
  const currentTemplateList = useAtomValue(quickStartTemplatesAtom)

  const { data, isLoading, isError } = useQuery({
    queryKey: ['demo-project-deep-link', templateId],
    queryFn: async () => {
      if (!templateId) {
        return null
      }

      // First check if template exists in current paginated list
      const existing = currentTemplateList.find((t) => t.projectId === templateId)
      if (existing) {
        return existing
      }

      // Not in list, fetch from API
      const response = await fetchApiDomain<DemoProject>(`/api/demo-projects/${templateId}`)
      if (!response.ok) {
        throw new Error('Template not found')
      }
      return mapDemoProjectToQuickStartTemplate(response.data)
    },
    enabled: !!templateId,
    staleTime: 5 * 60 * 1000, // 5 minutes - avoid refetching same ID
    retry: false,
    refetchOnWindowFocus: false,
  })

  return {
    deepLinkTemplate: data ?? null,
    isLoading,
    isError,
  }
}
