import {
  Project,
  PROJECT_SEEN_FILTER,
  ProjectListQueryType,
  ProjectPaginatedResponse,
  ProjectSeenFilter,
  ProjectStageFilter,
} from '@shared/types/api/project'

import { ApiError } from '@/lib/api-error'

import type { FetchApiDomain } from './useApi'

export const PROJECTS_QUERY_KEY = 'projects'

export type ProjectsInfiniteData<T> = {
  pages?: Array<undefined | { data?: T[] }>
}

export type ProjectsPageQueryParams = BaseProjectQueryParams & {
  page: number
  q: ProjectListQueryType
  sort: 'createdAt' | 'updatedAt'
}

export type ProjectsQueryKeyParams = Omit<ProjectsPageQueryParams, 'page'>

type BaseProjectQueryParams = {
  createdAfter?: string
  createdBefore?: string
  createdFrom?: string
  createdTo?: string
  isLongTake?: boolean
  pageSize: number
  search?: string
  seenFilter?: ProjectSeenFilter
  stageFilter?: ProjectStageFilter
  userSub?: string
  withCount?: boolean
}

type CursorPage<T> = {
  data?: T[]
  pagination?: { total?: number }
  requestedPageSize?: number
}

export function buildProjectsQueryKey({
  q,
  search,
  userSub,
  sort,
  pageSize,
  createdFrom,
  createdTo,
  createdAfter,
  createdBefore,
  isLongTake,
  seenFilter,
  stageFilter,
}: ProjectsQueryKeyParams) {
  return [
    PROJECTS_QUERY_KEY,
    q,
    search,
    userSub,
    sort,
    pageSize,
    createdFrom,
    createdTo,
    createdAfter,
    createdBefore,
    isLongTake,
    seenFilter,
    stageFilter,
  ] as const
}

export function dedupeById<T extends { id: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const item of items) {
    if (!seen.has(item.id)) {
      seen.add(item.id)
      out.push(item)
    }
  }
  return out
}

/**
 * Cancel the UIP planning session behind a project. The gate token is
 * omitted deliberately: the projects grid holds none, and the endpoint treats it
 * as optional for exactly this caller.
 *
 * The API answers 400 once the session is no longer active -- a real race here,
 * since the grid's Cancel has no confirm step and auto-confirm can land in the
 * same instant. Callers surface that as "already finished planning", not an error.
 *
 * `status: 'rejected'` arrives with HTTP 200 but means the opposite of success:
 * another action was already pending, so no cancel intent was written and the
 * session keeps running -- and keeps spending. Treated as a failure here,
 * matching how the planner bridge reads the same status (planner-api-factory.ts).
 */
export async function cancelUipSession(fetchApiDomain: FetchApiDomain, projectId: string) {
  const response = await fetchApiDomain<{ status: string }>(
    `/api/uip-sessions/${encodeURIComponent(projectId)}/cancel`,
    { method: 'POST', data: {} },
  )
  if (!response.ok) {
    // ApiError, not a bare Error: the caller has to tell the already-terminal
    // 400 apart from a genuine failure, and only the status carries that.
    throw new ApiError(response.error || 'Failed to cancel generation', response.status)
  }
  if (response.data?.status === 'rejected') {
    throw new ApiError(CANCEL_REJECTED_MESSAGE, response.status, CANCEL_REJECTED_CODE)
  }
  return response.data
}

/** `code` on the ApiError thrown when the API took the request but refused the cancel. */
export const CANCEL_REJECTED_CODE = 'cancel_rejected'
const CANCEL_REJECTED_MESSAGE = 'Another action is already in progress'

export async function deleteProjectById(fetchApiDomain: FetchApiDomain, projectId: string) {
  const response = await fetchApiDomain<Project>(`/api/project/${projectId}/delete`, {
    method: 'POST',
    data: {},
  })
  if (!response.ok) {
    throw new Error(response.error || 'Failed to delete project')
  }
  return response.data
}

export async function fetchProjectById(fetchApiDomain: FetchApiDomain, projectId: string) {
  const response = await fetchApiDomain<null | Project>(`/api/project/${projectId}`)
  return response.data
}

export async function fetchProjectsPage(
  fetchApiDomain: FetchApiDomain,
  params: ProjectsPageQueryParams,
) {
  const query = new URLSearchParams({
    page: normalizePageParam(params.page).toString(),
    pageSize: params.pageSize.toString(),
    q: params.q,
    sort: params.sort,
    user: params.userSub ?? '',
  })

  applyCommonProjectFilters(query, params)

  const trimmedSearch = params.search?.trim()
  if (trimmedSearch) {
    query.set('search', trimmedSearch)
  }

  const response = await fetchApiDomain<ProjectPaginatedResponse & { searchDegraded?: boolean }>(
    `/api/project?${query.toString()}`,
  )
  return response.data
}

// getNextPageParam for cursor pagination: the returned param is the last item's
// createdAt, which the backend applies as a strict `createdAt < cursor` bound.
// Total-based first so the Load more button matches page-number mode exactly
// (no phantom extra click on exact-multiple counts); fall back to the full-page
// heuristic only when total is unavailable.
export function getCursorNextPageParam<T extends { createdAt: string; id: string }>(
  lastPage: CursorPage<T> | undefined,
  allPages: Array<CursorPage<T> | undefined>,
): string | undefined {
  const lastItems = lastPage?.data ?? []
  const total = allPages[0]?.pagination?.total
  // withCount=false responses carry total: -1 as a sentinel, not a real count.
  if (typeof total === 'number' && total >= 0) {
    let seen = 0
    const ids = new Set<string>()
    for (const page of allPages) {
      for (const item of page?.data ?? []) {
        if (!ids.has(item.id)) {
          ids.add(item.id)
          seen += 1
        }
      }
    }
    if (seen >= total) {
      return undefined
    }
  } else if (lastItems.length < (lastPage?.requestedPageSize ?? 0)) {
    return undefined
  }
  // The strict `lt` bound skips items sharing the cursor's exact createdAt;
  // deduping the flattened list by id absorbs the common case and the residual
  // same-millisecond skip is accepted.
  return lastItems[lastItems.length - 1]?.createdAt
}

export function getProjectsQueryKeyPrefix() {
  return [PROJECTS_QUERY_KEY] as const
}

export function getProjectsV2StoryModeCountQueryKey() {
  return ['projects-v2', 'count', 'story-mode'] as const
}

export function getProjectsV2VideoCountQueryKey() {
  return ['projects-v2', 'count', 'video'] as const
}

/**
 * Pure transform for a cached projects infinite-query result.
 * `transform` returning null removes that item from its page. Used to patch
 * a React Query cache directly (via `setQueriesData`) instead of invalidating,
 * so an SSE-driven update doesn't force a network refetch.
 */
export function patchProjectListPages<T extends { id: string }>(
  oldData: ProjectsInfiniteData<T> | undefined,
  transform: (item: T) => null | T,
): ProjectsInfiniteData<T> | undefined {
  if (!oldData?.pages) {
    return oldData
  }
  return {
    ...oldData,
    pages: oldData.pages.map((page) => {
      if (!page?.data) {
        return page
      }
      return {
        ...page,
        data: page.data.map(transform).filter((item): item is T => item !== null),
      }
    }),
  }
}

// Index of `seenFilter` in the tuple returned by buildProjectsQueryKey above.
// Keep this in sync if that changes.
const PROJECTS_QUERY_KEY_SEEN_FILTER_INDEX = 11

export function isUnseenProjectsQueryKey(queryKey: readonly unknown[]): boolean {
  return (
    queryKey[0] === PROJECTS_QUERY_KEY &&
    queryKey[PROJECTS_QUERY_KEY_SEEN_FILTER_INDEX] === PROJECT_SEEN_FILTER.UNSEEN
  )
}

export async function markProjectsSeen(
  fetchApiDomain: FetchApiDomain,
  ids: ReadonlyArray<string>,
): Promise<{ changedCount: number; skippedCount: number }> {
  const response = await fetchApiDomain<{ changedCount: number; skippedCount: number }>(
    '/api/project/mark-seen',
    {
      data: { ids },
      method: 'POST',
    },
  )
  return response.data
}

/**
 * Acknowledge finished background jobs when the user opens the
 * project (clears the card status pill's done state on every device). NOT the
 * mark-seen batch above -- that stamps lastSeenAt on list render.
 *
 * Keepalive, because the only caller fires this immediately before
 * hardNavigate() opens the project. A normal request is cancelled the moment
 * the new document commits, and this one is cross-origin with custom headers,
 * so it owes a CORS preflight first -- always cold, since the URL carries the
 * project id. Two round trips against a CDN-fast document load: the stamp lost
 * that race essentially every time, and the pill came back on the next list
 * read forever. keepalive hands the request to the browser process so it
 * outlives the document that started it.
 */
export async function markProcessingSeen(
  fetchApiDomain: FetchApiDomain,
  projectId: string,
): Promise<void> {
  await fetchApiDomain(`/api/projects/${projectId}/processing-seen`, {
    keepalive: true,
    method: 'POST',
  })
}

export function normalizePageParam(pageParam: unknown): number {
  return typeof pageParam === 'number' && !Number.isNaN(pageParam) ? pageParam : 1
}

export async function renameProject(
  fetchApiDomain: FetchApiDomain,
  projectId: string,
  name: string,
) {
  const response = await fetchApiDomain<Project>(`/api/project/${projectId}/name`, {
    method: 'PUT',
    data: { name },
  })
  if (!response.ok) {
    throw new Error(response.error || 'Failed to rename project')
  }
  return response.data
}

function applyCommonProjectFilters(query: URLSearchParams, params: BaseProjectQueryParams) {
  if (params.createdFrom) {
    query.set('createdFrom', params.createdFrom)
  }
  if (params.createdTo) {
    query.set('createdTo', params.createdTo)
  }
  if (params.createdAfter) {
    query.set('createdAfter', params.createdAfter)
  }
  if (params.createdBefore) {
    query.set('createdBefore', params.createdBefore)
  }
  if (params.stageFilter) {
    query.set('stageFilter', params.stageFilter)
  }
  if (params.seenFilter) {
    query.set('seenFilter', params.seenFilter)
  }
  if (params.isLongTake !== undefined) {
    query.set('isLongTake', String(params.isLongTake))
  }
  if (params.withCount !== undefined) {
    query.set('withCount', String(params.withCount))
  }
}
