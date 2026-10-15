'use client'

import { cn } from '@shared/ui'
import { useQuery } from '@tanstack/react-query'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef } from 'react'

import AppSidebar from '@/components/AppSidebar'
import { DeleteProjectDialog } from '@/components/delete-project-dialog/DeleteProjectDialog'
import { useMarkProjectViewed } from '@/components/ongoing-projects/hooks/useMarkProjectViewed'
import {
  getColumnCountFromWidth,
  getColumnCountFromWindow,
} from '@/components/project-card-grid/ProjectCardGrid'
import { MobileProjectsHeader } from '@/components/projects-v2/MobileProjectsHeader'
import type { CardRecord, ProjectCardRecord } from '@/components/projects-v2/ProjectResultsSection'
import { ProjectResultsSection } from '@/components/projects-v2/ProjectResultsSection'
import { useProjectListScrollRestoration } from '@/components/projects-v2/use-scroll-restoration'
import {
  fetchProjectsPage,
  getProjectsV2StoryModeCountQueryKey,
  getProjectsV2VideoCountQueryKey,
} from '@/hooks/projects-query-utils'
import { useApi } from '@/hooks/useApi'
import { useProjects } from '@/hooks/useProjects'
import { hardNavigate } from '@/util/hard-navigation'

type ProjectFilter = 'all' | 'story-mode'

interface ProjectFilterButtonsProps {
  activeFilter: ProjectFilter
  counts: ProjectFilterCountMap
  filters: Array<{ label: string; value: ProjectFilter }>
  onFilterChange: (filter: ProjectFilter) => void
}
type ProjectFilterCountMap = Record<ProjectFilter, number>

const PROJECT_FILTERS: Array<{ label: string; value: ProjectFilter }> = [
  { label: 'All', value: 'all' },
  { label: 'Videos', value: 'story-mode' },
]

// `undefined` means "don't filter by long-take" (the All tab); the story-mode
// tab maps to the boolean the projects API expects.
function cardRecordId(record: CardRecord): string {
  return record.project.id
}

function resolveIsLongTakeFilter(activeFilter: ProjectFilter): boolean | undefined {
  if (activeFilter === 'story-mode') {
    return true
  }
  return undefined
}

// Batch expressed in grid rows; the per-fetch item count is columns * rows.
const ROWS_PER_FETCH = 4

export function ProjectListPageV2() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { fetchApiDomain } = useApi()
  const contentRef = useRef<HTMLDivElement>(null)
  // Derives the fetch size from the grid width AT FETCH TIME so the query key
  // stays width-independent (no refetch/reset on resize or layout settle) while
  // each fetch still pulls whole rows for the width at that moment. "Whole
  // rows" is approximate: getColumnCountFromWidth uses breakpoint buckets
  // while the grid renders repeat(auto-fill,205px), so the two can disagree
  // by a column at some widths -- affects batch granularity only.
  const cursorPageSize = useCallback(() => {
    const width = contentRef.current?.offsetWidth ?? 0
    const columns = width > 0 ? getColumnCountFromWidth(width) : getColumnCountFromWindow()
    return Math.max(columns, 2) * ROWS_PER_FETCH
  }, [])
  const routeBase = pathname.startsWith('/projects-v2') ? '/projects-v2' : '/projects'
  // Filter lives in the `filter` query param (single root URL for the whole
  // listing view). Fall back to the legacy filter pathname on first render
  // so users landing on /projects/story-mode via bookmark see the right tab
  // until the redirect-effect below moves them to /projects?filter=story-mode.
  const activeFilter = useMemo<ProjectFilter>(
    () => resolveActiveFilter(searchParams?.get('filter'), pathname),
    [searchParams, pathname],
  )
  const isLongTakeFilter = resolveIsLongTakeFilter(activeFilter)

  // One-time redirect for users landing on the legacy filter route
  // (/projects/story-mode).
  // We move them to /projects?filter=<filter> so all filter state lives at the
  // root pathname -- this prevents Next.js from re-fetching a nested route
  // segment's RSC payload on every filter change.
  useEffect(() => {
    const legacyFilter = filterFromLegacyPathname(pathname)
    if (!legacyFilter) {
      return
    }
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    if (params.get('filter') !== legacyFilter) {
      params.set('filter', legacyFilter)
    }
    const qs = params.toString()
    const suffix = qs ? `?${qs}` : ''
    router.replace(`${routeBase}${suffix}`, { scroll: false })
  }, [pathname, routeBase, router, searchParams])

  const {
    error: videoError,
    isLoading: isLoadingVideo,
    projects,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    total: projectsTotal,
  } = useProjects({
    isLongTake: isLongTakeFilter,
    cursorPageSize,
  })

  const shouldFetchStoryModeCount = activeFilter !== 'story-mode'

  const { data: videoCountResponse } = useQuery({
    queryFn: () =>
      fetchProjectsPage(fetchApiDomain, {
        q: 'me',
        sort: 'createdAt',
        page: 1,
        pageSize: 0,
        isLongTake: false,
      }),
    queryKey: getProjectsV2VideoCountQueryKey(),
    refetchOnWindowFocus: false,
  })

  const { data: storyModeCountResponse } = useQuery({
    enabled: shouldFetchStoryModeCount,
    queryFn: () =>
      fetchProjectsPage(fetchApiDomain, {
        q: 'me',
        sort: 'createdAt',
        page: 1,
        pageSize: 0,
        isLongTake: true,
      }),
    queryKey: getProjectsV2StoryModeCountQueryKey(),
    refetchOnWindowFocus: false,
  })

  const cardRecords = useMemo<CardRecord[]>(
    () =>
      projects.map((project) => ({
        kind: 'project',
        project,
      })),
    [projects],
  )

  const viewItems = useMemo(
    () =>
      cardRecords.map((record) => ({
        source: 'project' as const,
        project: record.project,
      })),
    [cardRecords],
  )

  useMarkProjectViewed(viewItems)

  const videoTotal = videoCountResponse?.pagination?.total ?? 0
  const storyModeTotal =
    activeFilter === 'story-mode' ? projectsTotal : (storyModeCountResponse?.pagination?.total ?? 0)
  const projectsAllTotal = activeFilter === 'all' ? projectsTotal : videoTotal + storyModeTotal

  const filterCounts = useMemo<ProjectFilterCountMap>(
    () => ({
      all: projectsAllTotal,
      'story-mode': storyModeTotal,
    }),
    [projectsAllTotal, storyModeTotal],
  )

  const error = videoError
  const isLoading = isLoadingVideo
  const projectListScrollRestoration = useProjectListScrollRestoration({
    cardIds: cardRecords.map(cardRecordId),
    context: {
      activeFilter,
      isSearchMode: false,
      routeBase,
      searchQuery: '',
    },
    hasNextPage,
    isFetchingNextPage,
    isReady: !isLoading && !error,
    onLoadMore: fetchNextPage,
  })

  const handleFilterChange = (filter: ProjectFilter) => {
    const params = new URLSearchParams(searchParams?.toString() ?? '')
    if (!filter || filter === 'all') {
      params.delete('filter')
    } else {
      params.set('filter', filter)
    }
    const qs = params.toString()
    const suffix = qs ? `?${qs}` : ''
    // Same pathname (no nested route segment) so Next.js does not re-fetch
    // an RSC payload -- only the query-param state changes.
    router.replace(`${routeBase}${suffix}`, { scroll: false })
  }

  return (
    <div className="min-h-screen">
      <div className="flex flex-col md:flex-row">
        <AppSidebar />
        <main className="flex min-w-0 flex-1 flex-col">
          <div
            className="relative z-10 w-full px-3 md:mx-auto md:max-w-[min(2037px,calc(100%-var(--sidebar-width,212px)))] md:px-12 md:pb-8 md:pt-16"
            ref={contentRef}
          >
            <div
              // Spacing tracks the bars that actually render, derived from their height
              // tokens (+ a small gap): no top bar (sit at the top, clearing only the
              // safe-area/notch) and a bottom tab bar to clear.
              className="flex w-full flex-col gap-4 md:pt-[68px] pt-0 pb-[calc(var(--mobile-bottom-bar-height)+16px)]"
            >
              <MobileProjectsHeader />

              <div className="flex w-full items-center gap-2">
                <ProjectFilterButtons
                  activeFilter={activeFilter}
                  counts={filterCounts}
                  filters={PROJECT_FILTERS}
                  onFilterChange={handleFilterChange}
                />
              </div>

              <ProjectResultsSection
                activeHasNextPage={hasNextPage}
                activeIsFetchingNextPage={isFetchingNextPage}
                cardRecords={cardRecords}
                error={error}
                isLoading={isLoading}
                onFetchNextPage={fetchNextPage}
                onOpenProject={(record) => {
                  projectListScrollRestoration.persistProjectAnchor(record.project.id)
                  // Editor routes need a cross-origin isolated document, which
                  // only a full document load carries (see util/hard-navigation.ts).
                  hardNavigate(getProjectRoute(record))
                }}
              />
            </div>
          </div>
        </main>
        <DeleteProjectDialog />
      </div>
    </div>
  )
}

const VALID_FILTER_VALUES: ReadonlyArray<ProjectFilter> = ['all', 'story-mode']

function filterFromLegacyPathname(pathname: string): null | ProjectFilter {
  const normalizedPath = pathname.replace(/\/+$/, '')
  if (normalizedPath.endsWith('/story-mode')) {
    return 'story-mode'
  }
  return null
}

function isValidFilter(value: null | string | undefined): value is ProjectFilter {
  return typeof value === 'string' && (VALID_FILTER_VALUES as ReadonlyArray<string>).includes(value)
}

/**
 * Resolves the active filter for the listing view.
 * Priority:
 *   1. ?filter=<value> on the current URL (the canonical source after refactor)
 *   2. Legacy /projects/<filter> pathname segment (only the first render after
 *      a deep link / bookmark; the redirect-effect cleans this up immediately)
 *   3. Default to 'all'
 */
function getProjectRoute({ project }: Readonly<ProjectCardRecord>): string {
  if (project.isLongTake) {
    return `/story-mode/${project.id}`
  }

  return `/projects/${project.id}`
}

function ProjectFilterButtons({
  activeFilter,
  counts,
  filters,
  onFilterChange,
}: ProjectFilterButtonsProps) {
  return (
    <div className="h-[38px] w-full min-w-0">
      <div
        aria-label="Project type filters"
        className="scrollbar-hide flex size-full min-w-0 items-center gap-2 overflow-x-auto"
        data-testid="project-type-filter-scroll"
        role="group"
      >
        {filters.map((filter) => {
          const isActive = activeFilter === filter.value
          const count = counts[filter.value]

          return (
            <button
              className={cn(
                'h-[38px] min-w-[38px] shrink-0 rounded-sm px-2.5 transition-colors',
                isActive ? 'bg-white/10' : 'bg-transparent hover:bg-white/[0.05]',
              )}
              key={filter.value}
              onClick={() => onFilterChange(filter.value)}
              type="button"
            >
              <div className="flex items-center px-0.5">
                <span
                  className={cn(
                    'whitespace-nowrap text-sm font-medium leading-[17px]',
                    isActive ? 'text-white' : 'text-white/50',
                  )}
                >
                  {`${filter.label} (${count})`}
                </span>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function resolveActiveFilter(
  filterParam: null | string | undefined,
  pathname: string,
): ProjectFilter {
  return isValidFilter(filterParam) ? filterParam : (filterFromLegacyPathname(pathname) ?? 'all')
}
