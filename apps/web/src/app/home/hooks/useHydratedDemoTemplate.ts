import type { DemoProject } from '@shared/types/api/demo-project'
import type { QuickStartTemplate } from '@shared/types/assets/quick-start'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo } from 'react'

import { useApi } from '@/hooks/useApi'

import { mapDemoProjectToQuickStartTemplate } from './quick-start-template-utils'

type FetchApiDomain = ReturnType<typeof useApi>['fetchApiDomain']

/**
 * The gallery list is fetched with `fields=card`, which empties `initPrompt`
 * and `transcript` -- 66% of the payload, and text no card renders. Anything
 * that DOES surface that text (the detail panels) or reuses it (the remix
 * payload) pulls the full record for the single demo it needs.
 *
 * Hydration is keyed off an empty `initPrompt` because the projection always
 * sets it to `''`. Templates that already carry their text -- showcase
 * fallbacks, or any caller that did not opt into the projection -- skip the
 * fetch entirely.
 */
export function demoProjectDetailQueryKey(projectId: string): string[] {
  return ['demo-project-detail', projectId]
}

export function needsDemoTextHydration(template: null | QuickStartTemplate | undefined): boolean {
  return Boolean(template?.projectId) && !template?.initPrompt
}

async function fetchDemoTemplateDetail(
  fetchApiDomain: FetchApiDomain,
  projectId: string,
): Promise<null | QuickStartTemplate> {
  const response = await fetchApiDomain<DemoProject>(`/api/demo-projects/${projectId}`, {
    noThrowError: true,
  })

  if (!response.ok || !response.data) {
    return null
  }

  return mapDemoProjectToQuickStartTemplate(response.data)
}

function mergeHydratedText(
  template: QuickStartTemplate,
  detail: null | QuickStartTemplate,
): QuickStartTemplate {
  if (!detail) {
    return template
  }

  // Merge only the projected-away text. Everything else stays as the gallery
  // resolved it, so a hydrate can never swap out media URLs or model badges
  // the card already rendered.
  return { ...template, initPrompt: detail.initPrompt, transcript: detail.transcript }
}

/**
 * Imperative counterpart for click handlers (the remix payload), which need the
 * text at apply time rather than at render. Shares the query key with the hook,
 * so an open detail panel and a remix click cost one request between them.
 */
export function useDemoTemplateHydrator(): (
  template: QuickStartTemplate,
) => Promise<QuickStartTemplate> {
  const { fetchApiDomain } = useApi()
  const queryClient = useQueryClient()

  return useCallback(
    async (template: QuickStartTemplate) => {
      if (!needsDemoTextHydration(template)) {
        return template
      }

      // A failed hydrate must not take the action down with it. The caller is
      // mid-click (remix), so degrading to the card-shaped template loses the
      // prefilled prompt but still starts the remix -- far better than an
      // unhandled rejection swallowing the click entirely.
      try {
        const detail = await queryClient.fetchQuery({
          queryKey: demoProjectDetailQueryKey(template.projectId),
          queryFn: () => fetchDemoTemplateDetail(fetchApiDomain, template.projectId),
        })

        return mergeHydratedText(template, detail)
      } catch {
        return template
      }
    },
    [fetchApiDomain, queryClient],
  )
}

export function useHydratedDemoTemplate(
  template: QuickStartTemplate,
  options: { enabled?: boolean } = {},
): QuickStartTemplate {
  const { fetchApiDomain } = useApi()
  const shouldHydrate = (options.enabled ?? true) && needsDemoTextHydration(template)

  const { data } = useQuery({
    queryKey: demoProjectDetailQueryKey(template.projectId),
    queryFn: () => fetchDemoTemplateDetail(fetchApiDomain, template.projectId),
    enabled: shouldHydrate,
    refetchOnWindowFocus: false,
    retry: false,
  })

  return useMemo(() => mergeHydratedText(template, data ?? null), [data, template])
}
