'use client'
import {
  Project,
  ProjectListQueryType,
  ProjectSeenFilter,
  ProjectStageFilter,
} from '@shared/types/api/project'
import { toast } from '@shared/ui'
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAtom, useAtomValue } from 'jotai'
import { useEffect, useMemo } from 'react'

import { projectAtom, projectIdAtom } from '@/atom/project'
import { isProcessingRunActive } from '@/components/projects-v2/project-card-processing-run'
import { useProjectId } from '@/contexts/ProjectContext'
import { isApiError } from '@/lib/api-error'
import { getNextPageParam } from '@/util/pagination'
import { UpdaterFnOrValue } from '@/util/state-setter-fn'

import {
  buildProjectsQueryKey,
  CANCEL_REJECTED_CODE,
  cancelUipSession,
  dedupeById,
  deleteProjectById,
  fetchProjectById,
  fetchProjectsPage,
  getCursorNextPageParam,
  getProjectsQueryKeyPrefix,
  normalizePageParam,
} from './projects-query-utils'
import { useRefCallback } from './use-ref-callback'
import { useApi } from './useApi'

// Sentinel pinned into the projects query key in cursor mode so the key never
// varies with the fetch-time page size (see cursorPageSize below).
const CURSOR_QUERY_KEY_PAGE_SIZE = 0

// List poll cadence while a background run (bgmRun) is in flight.
// BGM regeneration takes minutes, so 30s observes the settle promptly without
// hammering the list read; the poll stops when no run is running.
const PROCESSING_RUN_POLL_MS = 30_000

/**
 * Cancel the UIP planning session behind a project. Fires straight
 * from the card's `...` menu -- no confirmation step by product decision.
 *
 * The workflow ends as `cancelled`, which the persist callback maps to
 * `stage = CANCELED`, so invalidating the list is enough for the card to settle
 * into its Canceled treatment (Delete re-enabled, Retry offered).
 */
export function useCancelUipSession() {
  const { fetchApiDomain } = useApi()
  const queryClient = useQueryClient()

  const cancelSession = useMutation({
    mutationFn: async (projectId: string) => cancelUipSession(fetchApiDomain, projectId),
    onError: (error: unknown) => {
      // Two expected non-faults, each worth its own words. With no confirm step
      // the click can land in the same instant auto-confirm does (400), or while
      // another action is still pending (200 + status 'rejected').
      let message = "Couldn't cancel this generation. Please try again."
      if (isApiError(error)) {
        if (error.code === CANCEL_REJECTED_CODE) {
          message = 'Another action is still finishing. Try cancelling again in a moment.'
        } else if (error.status === 400) {
          message = 'This project already finished planning.'
        }
      }
      toast.error(message)
    },
    onSuccess: (_, projectId) => {
      queryClient.invalidateQueries({ queryKey: getProjectsQueryKeyPrefix() })
      queryClient.invalidateQueries({ queryKey: ['project', projectId] })
    },
  })

  return {
    cancelSession: cancelSession.mutate,
    isCancelling: cancelSession.isPending,
  }
}

export function useDeleteProject() {
  const { fetchApiDomain } = useApi()
  const queryClient = useQueryClient()

  const deleteProject = useMutation({
    mutationFn: async (projectId: string): Promise<Project> => {
      return deleteProjectById(fetchApiDomain, projectId)
    },
    onSuccess: (_, projectId) => {
      // Invalidate project queries to refetch the updated list
      queryClient.invalidateQueries({ queryKey: getProjectsQueryKeyPrefix() })
      queryClient.invalidateQueries({ queryKey: ['project', projectId] })
    },
  })

  return {
    deleteProject: deleteProject.mutate,
    deleteProjectAsync: deleteProject.mutateAsync,
    isDeleting: deleteProject.isPending,
    isSuccess: deleteProject.isSuccess,
    error: deleteProject.error,
  }
}

export function useMergeProjects({
  userSub,
  q = 'me',
  pageSize = 50,
  disable = false,
  sort = 'createdAt',
}: {
  disable?: boolean
  pageSize?: number
  q?: ProjectListQueryType
  sort?: 'createdAt' | 'updatedAt'
  userSub?: string
} = {}) {
  const videoProjects = useProjects({
    userSub,
    q,
    pageSize,
    disable,
    sort,
  })

  const mergedProjects = useMemo(() => {
    return videoProjects.projects
      .toSorted((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, pageSize)
  }, [videoProjects.projects])

  return {
    mergedProjects,
    error: videoProjects.error,
    isLoading: videoProjects.isLoading,
    projects: videoProjects.projects,
    fetchNextPage: videoProjects.fetchNextPage,
    hasNextPage: videoProjects.hasNextPage,
    isFetchingNextPage: videoProjects.isFetchingNextPage,
  }
}
// Module-level map to track the latest dataUpdatedAt per projectId.
// Shared across all useProjectAtom instances to prevent new mounts from
// overwriting the jotai atom with stale React Query cache data
// (e.g., after an optimistic update that only modified the atom).
const projectDataTimestampMap = new Map<string, number>()

export function useProjectAtom() {
  const projectId = useAtomValue(projectIdAtom)
  const [projectInfo, setProjectInfoRaw] = useAtom(projectAtom)
  const initProjectInfo = useFetchProjectInfo(projectId)

  const setProjectInfo = useRefCallback((updater: UpdaterFnOrValue<null | Project>) => {
    return setProjectInfoRaw(updater)
  })

  useEffect(() => {
    if (!initProjectInfo || !projectId) {
      return
    }

    const { data, dataUpdatedAt } = initProjectInfo
    const lastTimestamp = projectDataTimestampMap.get(projectId) ?? 0
    if (data && dataUpdatedAt > lastTimestamp) {
      projectDataTimestampMap.set(projectId, dataUpdatedAt)
      setProjectInfo(data)
    }
  }, [projectId, setProjectInfo, initProjectInfo.data, initProjectInfo.dataUpdatedAt])

  const isDeleted = isApiError(initProjectInfo.error) && initProjectInfo.error.isNotFound

  return {
    projectId,
    projectInfo,
    setProjectInfo,
    refetchProjectInfo: initProjectInfo.refetch,
    error: initProjectInfo.error,
    isDeleted,
    isLoading: initProjectInfo.isLoading,
  }
}

export function useProjects({
  createdAfter,
  createdBefore,
  createdFrom,
  createdTo,
  cursorPageSize,
  disable = false,
  isLongTake,
  seenFilter,
  stageFilter,
  pageSize = 50,
  q = 'me',
  search,
  sort = 'createdAt',
  refetchInterval = false,
  userSub,
  withCount,
}: {
  createdAfter?: string
  createdBefore?: string
  createdFrom?: string
  createdTo?: string
  // Opt-in cursor pagination. When provided, the per-fetch page size is derived
  // from this callback AT FETCH TIME (so grid width at the moment of fetch, not
  // a cached value, decides the batch) and the query key drops pageSize so a
  // resize/layout-settle never churns the cache. Absent = page-number mode.
  cursorPageSize?: () => number
  disable?: boolean
  isLongTake?: boolean
  pageSize?: number
  q?: ProjectListQueryType
  refetchInterval?: false | number
  search?: string
  seenFilter?: ProjectSeenFilter
  sort?: 'createdAt' | 'updatedAt'
  stageFilter?: ProjectStageFilter
  userSub?: string
  withCount?: boolean
} = {}) {
  const { fetchApiDomain } = useApi()

  const isCursorMode = typeof cursorPageSize === 'function'
  if (isCursorMode && sort !== 'createdAt' && process.env.NODE_ENV !== 'production') {
    throw new Error('useProjects cursor mode requires sort === "createdAt"')
  }

  const { data, error, fetchNextPage, hasNextPage, isFetching, isFetchingNextPage, isLoading } =
    useInfiniteQuery({
      enabled: !disable,
      initialPageParam: (isCursorMode ? undefined : 1) as number | string | undefined,
      queryFn: ({ pageParam }) => {
        if (isCursorMode) {
          const requestedPageSize = cursorPageSize()
          return fetchProjectsPage(fetchApiDomain, {
            createdAfter,
            // First page (pageParam undefined) uses the static createdBefore;
            // subsequent pages ride the cursor.
            createdBefore: typeof pageParam === 'string' ? pageParam : createdBefore,
            createdFrom,
            createdTo,
            isLongTake,
            page: 1,
            pageSize: requestedPageSize,
            q,
            search,
            seenFilter,
            sort,
            stageFilter,
            userSub,
            withCount,
          }).then((page) => ({ ...page, requestedPageSize }))
        }
        return fetchProjectsPage(fetchApiDomain, {
          createdAfter,
          createdBefore,
          createdFrom,
          createdTo,
          isLongTake,
          page: normalizePageParam(pageParam),
          pageSize,
          q,
          search,
          seenFilter,
          sort,
          stageFilter,
          userSub,
          withCount,
        })
      },
      queryKey: buildProjectsQueryKey({
        createdAfter,
        createdBefore,
        createdFrom,
        createdTo,
        isLongTake,
        // Cursor mode pins this slot so the key stays width-independent while the
        // tuple shape (and downstream index-based key matchers) stay intact.
        pageSize: isCursorMode ? CURSOR_QUERY_KEY_PAGE_SIZE : pageSize,
        q,
        search,
        seenFilter,
        sort,
        stageFilter,
        userSub,
      }),
      getNextPageParam: isCursorMode ? getCursorNextPageParam : getNextPageParam,
      // The global staleTime keeps a mounted-then-remounted list from refetching
      // needlessly; SSE-driven invalidation (OngoingProjectsNotificationState)
      // keeps the cache live in between, so no forced refetch on mount is needed.
      refetchOnWindowFocus: false,
      // While any listed project has a background run in flight,
      // poll so the card status pill observes the settle without a manual
      // refresh -- BGM regen runs on FINISHED projects, which the bulk
      // progress SSE never covers. An explicit refetchInterval param still wins.
      refetchInterval: (query) => {
        if (refetchInterval !== false) {
          return refetchInterval
        }
        const pages = query.state.data?.pages
        if (!pages) {
          return false
        }
        // Same staleness ceiling the pill uses: a record a hard terminate left
        // `running` must not keep the list refetching for as long as it is shown.
        const now = Date.now()
        const hasRunningProcessing = pages.some((page) =>
          (page?.data ?? []).some((project) => isProcessingRunActive(project.bgmRun, now)),
        )
        // A live planner session moves on its own -- the phase label
        // advances, and a cancel only goes terminal once the workflow persists
        // it, well after the request resolved. Nothing else refreshes the grid
        // for UIP rows (no SSE subscriber, and the stage write emits no project
        // event), so without this the card sits on a stale phase, or on
        // "Cancel", until a manual reload. `uip` is attached only while the
        // session is active, so the poll retires itself.
        const hasLivePlannerSession = pages.some((page) =>
          (page?.data ?? []).some((project) => Boolean(project.uip)),
        )
        return hasRunningProcessing || hasLivePlannerSession ? PROCESSING_RUN_POLL_MS : false
      },
    })

  // Transform projects (original logic for video projects)
  const projects = useMemo<Project[]>(() => {
    const flat = data?.pages.flatMap((page) => page?.data ?? []) ?? []
    return isCursorMode ? dedupeById(flat) : flat
  }, [data, isCursorMode])

  const total = useMemo<number>(() => {
    const rawTotal = data?.pages[0]?.pagination?.total ?? 0
    // withCount=false responses carry total: -1 as a sentinel; keep it out of
    // count UI in cursor mode (page mode preserves it for legacy consumers).
    return isCursorMode ? Math.max(rawTotal, 0) : rawTotal
  }, [data, isCursorMode])

  const searchDegraded = useMemo<boolean>(() => {
    return Boolean(data?.pages[0]?.searchDegraded)
  }, [data])

  return {
    error,
    isFetching,
    isLoading,
    fetchNextPage,
    hasNextPage: !disable && Boolean(hasNextPage),
    isFetchingNextPage,
    projects,
    searchDegraded,
    total,
  }
}

function useFetchProjectInfo(id?: string, interval: false | number = false) {
  const { projectId: projectIdFromContext } = useProjectId()
  const { fetchApiDomain } = useApi()
  const projectId = id ?? projectIdFromContext
  return useQuery<null | Project>({
    queryFn: async () => {
      if (!projectId) {
        return null
      }
      return fetchProjectById(fetchApiDomain, projectId)
    },
    queryKey: ['project', projectId],
    enabled: !!projectId,
    refetchOnWindowFocus: false,
    refetchInterval: interval,
    // Don't retry on 404 (project deleted/not found) or 401 (unauthenticated)
    retry: (failureCount, error) => {
      if (isApiError(error) && (error.isNotFound || error.isUnauthorized)) {
        return false
      }
      return failureCount < 3
    },
  })
}
