import { CoalescingQueue } from '@reelmakeeasy/common/utils/coalescing-queue'
import { Logger } from '@reelmakeeasy/common/utils/logger'
import type {
  ReadonlyBucket,
  TimelineItem,
} from '@reelmakeeasy/common/utils/multi-source-timeline/types'
import type { Project } from '@shared/types/api/project'
import { PROJECT_SEEN_FILTER, PROJECT_STAGE_FILTER } from '@shared/types/api/project'
import type {
  OrgProjectEventPayload,
  OrgProjectEventResource,
} from '@shared/types/sse/org-project-event'
import type { QueryClient } from '@tanstack/react-query'

import { fetchProjectsPage } from '@/hooks/projects-query-utils'
import type { CreateSSEConnection, FetchApiDomain } from '@/hooks/useApi'

import { isOngoingProject, toGlobalProjectId } from './utils'

const nsLogger = Logger.get('ongoing-projects-notification')

export const DEFAULT_PAGE_SIZE = 20
export const DEFAULT_POLL_INTERVAL_MS = 60_000
export const DISCONNECTED_POLL_INTERVAL_MS = 5_000
export const MAX_RECONNECT_ATTEMPTS = 30
export const BASE_RECONNECT_DELAY_MS = 1_000
export const NOTIFICATION_QUERY_STALE_TIME_MS = 5_000
export const DEFAULT_STREAM_PATH = '/api/notification/project-changes-stream'
export const MAX_INIT_LOAD_ATTEMPTS = 3
export const MAX_RESYNC_ATTEMPTS = 3
export const MAX_SYNC_ATTEMPTS = 3
export const MAX_TOTALS_ATTEMPTS = 3
export const MAX_ONGOING_SYNC_PAGES = 20
export const ONGOING_SYNC_PAGE_SIZE = 50
export const RETRY_DELAY_MS = 1_000

export type OngoingProjectsNotificationStateOptions = {
  /** UTC ms timestamp used as createdFrom lower bound on all project queries. */
  createdFromBaseline?: number
  createSSEConnection?: CreateSSEConnection
  /** Whether to keep the 60s fallback polling after SSE is connected. Defaults to true. */
  enableConnectedFallbackPolling?: boolean
  fetchApiDomain: FetchApiDomain
  /** Pause sync behavior (polling + live event application) while preserving SSE event signals. */
  isSyncPaused?: boolean
  onSeenCleared?: (resource: OrgProjectEventResource, projectIds: ReadonlyArray<string>) => void
  onStateChange?: (state: OngoingProjectsNotificationStateValue) => void
  pageSize?: number
  pollingIntervalMs?: number
  queryClient: QueryClient
  streamPath?: string
}

export type OngoingProjectsNotificationStateValue = {
  allTotal: number
  error: null | unknown
  isConnected: boolean
  isLoading: boolean
  isReconnecting: boolean
  items: TimelineProjectItem[]
  ongoingTotal: number
}

export type StageUpdateRef = {
  projectId: string
  resource: OrgProjectEventPayload['resource']
}

export type TimelineProjectItem = TimelineItem & {
  readonly project: Project
  readonly sourceKey: TimelineSourceKey
}

export type TimelineSourceKey = OrgProjectEventPayload['resource']

export type TotalsSnapshot = {
  allTotal: number
  ongoingTotal: number
}

export function createFetcherWithCoalescingQueue<T>(fetch: () => Promise<T>) {
  const queue = new CoalescingQueue<T>()
  const fn = () => queue.push(() => fetch())
  fn.queue = queue
  return fn
}

export function fetchOngoingPageBySource(
  _currentSourceKey: TimelineSourceKey,
  createdFrom: number,
  fetchApiDomain: FetchApiDomain,
  pageSize: number,
  createdTo?: number,
): Promise<{
  hasMore: boolean
  items: Project[]
}> {
  const createdFromValue = toCreatedAtStringFromTimestamp(createdFrom)
  const createdToValue = toCreatedAtStringFromTimestamp(createdTo)

  return fetchProjectsPage(fetchApiDomain, {
    q: 'me',
    sort: 'createdAt',
    createdFrom: createdFromValue,
    createdTo: createdToValue,
    page: 1,
    pageSize,
    seenFilter: PROJECT_SEEN_FILTER.UNSEEN,
    stageFilter: PROJECT_STAGE_FILTER.ONGOING,
    withCount: false,
  }).then((response) => {
    const items = response.data || []
    return { hasMore: items.length >= pageSize, items }
  })
}

export function getOldestOngoingByBuckets(
  buckets: ReadonlyMap<string, ReadonlyBucket<TimelineProjectItem>>,
): Map<TimelineSourceKey, TimelineProjectItem> {
  const result = new Map<TimelineSourceKey, TimelineProjectItem>()

  for (const [sourceKey, bucket] of buckets) {
    for (const segment of bucket.segments) {
      for (const item of segment.items) {
        if (!isOngoingProject(item.project)) {
          continue
        }
        const source = sourceKey as TimelineSourceKey
        const prev = result.get(source)
        if (!prev || item.createdAt < prev.createdAt) {
          result.set(source, item)
        }
      }
    }
  }

  return result
}

export function hasProjectStatusPayloadChanged(current: Project, next: Project): boolean {
  return (
    current.stage !== next.stage ||
    current.updatedAt !== next.updatedAt ||
    current.resultVideo !== next.resultVideo ||
    current.resultVideoThumbnail !== next.resultVideoThumbnail ||
    current.previewThumbnail !== next.previewThumbnail
  )
}

export async function runWithRetry<T>(
  fn: () => Promise<T>,
  maxAttempts: number,
  delayMs: number,
  shouldAbort: () => boolean,
): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (shouldAbort()) {
      throw new Error('Aborted')
    }
    if (attempt > 0) {
      await sleep(delayMs)
      if (shouldAbort()) {
        throw new Error('Aborted')
      }
    }
    try {
      return await fn()
    } catch (error) {
      lastError = error
      nsLogger.error(error)
    }
  }
  throw lastError
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function toCreatedAtStringFromTimestamp(value?: number): string | undefined {
  if (value === undefined || Number.isNaN(value)) {
    return undefined
  }
  return new Date(value).toISOString()
}

export function toTimelineProjectItem(
  project: Project,
  sourceKey: TimelineSourceKey,
): TimelineProjectItem {
  return {
    createdAt: toTimestamp(project.createdAt),
    id: toGlobalProjectId(sourceKey, project.id),
    project,
    sourceKey,
  }
}

export function toTimestamp(value?: Date | string): number {
  if (!value) {
    return 0
  }

  const timestamp = new Date(value).getTime()
  if (Number.isNaN(timestamp)) {
    return 0
  }

  return timestamp
}
