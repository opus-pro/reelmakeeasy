import type { Project } from '@shared/types/api/project'
import type { DebugSettings } from '@shared/types/project/debug-settings'
import { useQuery } from '@tanstack/react-query'

import type { Session } from '@/components/story-mode-user-intent-planner/adapter/api-types'
import { useApi } from '@/hooks/useApi'

import { resolveUipBadgeVideoModel } from './video-model-badge.util'

/**
 * Resolve the transition-video-model id for the Story Mode model badge.
 *
 * For the owner of a UIP project we eagerly read the authoritative UipSession
 * `transition_video_model` (set the instant the user picks it, loaded during
 * planning) and let it fill the gap while the once-fetched project record's
 * `debugSettings.transitionVideoModel` catches up after fast-confirm -- so the
 * badge never flashes the "Seedance 1.5" default. The project value wins once
 * present. Non-owner / share / non-UIP views keep the project value (no fetch).
 */
export function useBadgeVideoModel({
  isOwner,
  isUip,
  project,
  projectId,
  shareMode,
}: {
  isOwner: boolean
  isUip: boolean | undefined
  project: Project | undefined
  projectId: string
  shareMode: boolean
}): null | string {
  const { fetchApiDomain } = useApi()
  const enabled = Boolean(isUip && isOwner && !shareMode && projectId)
  const { data: sessionVideoModel } = useQuery({
    enabled,
    queryFn: async () => {
      const { data: session } = await fetchApiDomain<Session>(`/api/uip-sessions/${projectId}`)
      return session.transition_video_model ?? null
    },
    queryKey: ['uip-session-video-model', projectId] as const,
    refetchOnWindowFocus: false,
    staleTime: 30_000,
  })

  const projectVideoModel =
    (project?.debugSettings as DebugSettings | undefined)?.transitionVideoModel ?? null
  return enabled
    ? resolveUipBadgeVideoModel({ projectVideoModel, sessionVideoModel })
    : projectVideoModel
}
