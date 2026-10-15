import type { Timeline } from '@reelmakeeasy/common/utils/multi-source-timeline/timeline'
import type {
  TimelinePage,
  TimelineSource,
} from '@reelmakeeasy/common/utils/multi-source-timeline/types'
import { PROJECT_SEEN_FILTER } from '@shared/types/api/project'

import { fetchProjectsPage } from '@/hooks/projects-query-utils'
import type { FetchApiDomain } from '@/hooks/useApi'

import {
  DEFAULT_PAGE_SIZE,
  fetchOngoingPageBySource,
  hasProjectStatusPayloadChanged,
  MAX_ONGOING_SYNC_PAGES,
  MAX_SYNC_ATTEMPTS,
  ONGOING_SYNC_PAGE_SIZE,
  RETRY_DELAY_MS,
  runWithRetry,
  type TimelineProjectItem,
  type TimelineSourceKey,
  toCreatedAtStringFromTimestamp,
  toTimelineProjectItem,
  toTimestamp,
} from './OngoingProjectsNotificationState.utils'
import { toGlobalProjectId } from './utils'

export type CreateTimelineSourceOptions = {
  createdFromBaseline?: number
  createdFromString: string | undefined
  fetchApiDomain: FetchApiDomain
  pageSize?: number
}

export function createTimelineSource(
  sourceKey: TimelineSourceKey,
  opts: CreateTimelineSourceOptions,
): TimelineSource<TimelineProjectItem> {
  const { fetchApiDomain, createdFromString, pageSize: optPageSize, createdFromBaseline } = opts

  return {
    loadNewer: async (createdAfter?: number): Promise<TimelinePage<TimelineProjectItem>> => {
      const pageSize = optPageSize ?? DEFAULT_PAGE_SIZE

      const page = await fetchProjectsPage(fetchApiDomain, {
        q: 'me',
        sort: 'createdAt',
        createdAfter: toCreatedAtStringFromTimestamp(createdAfter),
        createdFrom: createdFromString,
        page: 1,
        pageSize,
        seenFilter: PROJECT_SEEN_FILTER.UNSEEN,
        withCount: false,
      })
      const items = page.data ?? []

      return {
        hasMore: items.length >= pageSize,
        items: items.map((project) => toTimelineProjectItem(project, sourceKey)),
      }
    },
    loadOlder: async (
      createdBefore: number,
      include?: boolean,
    ): Promise<TimelinePage<TimelineProjectItem>> => {
      if (createdFromBaseline !== undefined && createdBefore <= createdFromBaseline) {
        return { hasMore: false, items: [] }
      }

      const pageSize = optPageSize ?? DEFAULT_PAGE_SIZE

      const page = await fetchProjectsPage(fetchApiDomain, {
        q: 'me',
        sort: 'createdAt',
        [include ? 'createdBefore' : 'createdTo']: toCreatedAtStringFromTimestamp(createdBefore),
        createdFrom: createdFromString,
        page: 1,
        pageSize,
        seenFilter: PROJECT_SEEN_FILTER.UNSEEN,
        withCount: false,
      })
      const items = page.data ?? []

      return {
        hasMore: items.length >= pageSize,
        items: items.map((project) => toTimelineProjectItem(project, sourceKey)),
      }
    },
  }
}

export async function syncOngoingSourceWithHasMore(
  currentTimeline: Timeline<TimelineProjectItem>,
  sourceKey: TimelineSourceKey,
  createdFrom: number,
  fetchApiDomain: FetchApiDomain,
  pageSize: number | undefined,
  isDisposedFn: () => boolean,
  isTimelineStaleFn: () => boolean,
  getTimelineProjectByIdFn: (timelineId: string) => null | TimelineProjectItem,
  debugLog: (msg: string, ...args: unknown[]) => void,
  state: unknown,
): Promise<boolean> {
  let changed = false
  let createdTo: number | undefined
  let requestCount = 0

  while (requestCount < MAX_ONGOING_SYNC_PAGES) {
    const ongoingPage = await runWithRetry(
      () =>
        fetchOngoingPageBySource(
          sourceKey,
          createdFrom,
          fetchApiDomain,
          Math.max(pageSize ?? DEFAULT_PAGE_SIZE, ONGOING_SYNC_PAGE_SIZE),
          createdTo,
        ),
      MAX_SYNC_ATTEMPTS,
      RETRY_DELAY_MS,
      () => isDisposedFn() || isTimelineStaleFn(),
    )
    if (isDisposedFn() || isTimelineStaleFn()) {
      return changed
    }
    requestCount++

    for (const project of ongoingPage.items) {
      const timelineId = toGlobalProjectId(sourceKey, project.id)

      const currentItem = getTimelineProjectByIdFn(timelineId)
      if (!currentItem) {
        continue
      }

      const payloadChanged = hasProjectStatusPayloadChanged(currentItem.project, project)

      currentTimeline.update({
        ...currentItem,
        createdAt: currentItem.createdAt,
        project,
      })

      if (!payloadChanged) {
        continue
      }

      changed = true
    }

    if (!ongoingPage.hasMore) {
      return changed
    }
    const oldest = ongoingPage.items.at(-1)
    if (!oldest) {
      debugLog(
        'ongoing.sync.emptyPageWithHasMore',
        { createdFrom, createdTo, requestCount, sourceKey },
        state,
      )
      return changed
    }
    createdTo = toTimestamp(oldest.createdAt)
  }

  if (requestCount >= MAX_ONGOING_SYNC_PAGES) {
    debugLog(
      'ongoing.sync.pageCapReached',
      { createdFrom, createdTo, hasMore: true, requestCount, sourceKey },
      state,
    )
  }

  return changed
}
