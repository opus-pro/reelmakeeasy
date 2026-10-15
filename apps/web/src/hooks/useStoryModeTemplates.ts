import type { DemoProject } from '@shared/types/api/demo-project'
import type { QuickStartTemplate } from '@shared/types/assets/quick-start'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'

import {
  fetchAllDemoProjects,
  mapDemoProjectsToQuickStartTemplates,
  mapDemoProjectToQuickStartTemplate,
} from '@/app/home/hooks/quick-start-template-utils'
import { useApi } from '@/hooks/useApi'
import { DEFAULT_DEMO_VIEW_SIZE } from '@/util/demo-input-type'

export interface UseStoryModeTemplatesResult {
  /** Empty until the /api/demo-projects query has settled, and when there are no demos. */
  templates: QuickStartTemplate[]
}

/**
 * Merge two already-mapped demo template lists into the single curated order
 * the gallery renders: displayOrder ascending (the admin's ranking), ties
 * broken by createdAt descending -- the same sort the API applies per list, so
 * an interleave of two fetches keeps each row where its rank puts it.
 */
export function mergeDemoTemplatesByDisplayOrder(
  a: QuickStartTemplate[],
  b: QuickStartTemplate[],
): QuickStartTemplate[] {
  return [...a, ...b].sort(
    (x, y) => x.displayOrder - y.displayOrder || y.createdAt.localeCompare(x.createdAt),
  )
}

export function selectStoryModeTemplates(
  demoProjectTemplates: QuickStartTemplate[],
  fallbackTemplates: QuickStartTemplate[],
): QuickStartTemplate[] {
  return demoProjectTemplates.length > 0 ? demoProjectTemplates : fallbackTemplates
}

export function useStoryModeTemplate(projectId: string): null | QuickStartTemplate {
  const { fetchApiDomain } = useApi()

  const { data } = useQuery({
    queryKey: ['story-mode-demo-project', projectId],
    queryFn: async () => {
      // The filtered list answers "is this a demo?" with an empty page rather
      // than a 404 for every ordinary project.
      const query = new URLSearchParams({
        projectId,
        projectType: 'STORY_MODE',
        q: 'findByProjectType',
        size: '1',
      })
      const response = await fetchApiDomain<{ data?: DemoProject[] }>(
        `/api/demo-projects?${query.toString()}`,
        { noThrowError: true },
      )
      const demo = response.ok ? response.data?.data?.[0] : undefined

      return demo ? mapDemoProjectToQuickStartTemplate(demo) : null
    },
    enabled: Boolean(projectId),
    refetchOnWindowFocus: false,
    retry: false,
  })

  return data ?? null
}

export function useStoryModeTemplates(
  pageSize = DEFAULT_DEMO_VIEW_SIZE,
  // `enabled: false` lets gate-conditional consumers (the Reference to video
  // bucket) mount the hook without firing the paged fetch. Callers
  // that pass false must not render the result.
  { enabled = true }: { enabled?: boolean } = {},
): UseStoryModeTemplatesResult {
  const { fetchApiDomain } = useApi()

  const { data, isLoading } = useQuery({
    // 'card' is part of the key: it changes the shape of what is cached here,
    // and a full-shaped entry must never be read as a card-shaped one.
    queryKey: ['story-mode-demo-projects', 'STORY_MODE', pageSize, 'card'],
    queryFn: async () => {
      // Every page is fetched, not just the first: input-type filtering happens
      // client-side, so a demo past the first page is invisible on the homepage
      // no matter how it is tagged. Each page is requested card-shaped -- cards
      // never render initPrompt/transcript, which are 66% of the payload -- and
      // the detail and remix paths hydrate the one demo they act on
      // (useHydratedDemoTemplate).
      const demoProjects = await fetchAllDemoProjects(fetchApiDomain, {
        fields: 'card',
        pageSize,
        projectType: 'STORY_MODE',
      })

      return mapDemoProjectsToQuickStartTemplates(demoProjects)
    },
    enabled,
    refetchOnWindowFocus: false,
  })

  // Render nothing until the API query has settled, so <video> elements never
  // mount against a placeholder list and get torn down mid-fetch.
  const templates = useMemo(() => (isLoading ? [] : (data ?? [])), [data, isLoading])

  return { templates }
}
