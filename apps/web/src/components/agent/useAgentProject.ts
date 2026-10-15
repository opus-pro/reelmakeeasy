'use client'

import type { Project } from '@shared/types/api/project'
import { useQuery } from '@tanstack/react-query'

import { ASPECT_RATIO_CSS } from '@/app/story-mode/hook/useLongTakeViewerData'
import { fetchProjectById } from '@/hooks/projects-query-utils'
import { useApi } from '@/hooks/useApi'

/**
 * The project record, read with the editor's own project query (`['project', id]`), so
 * the two share it. The agent page has no `projectIdAtom` (the editor's way to it).
 */
export function useAgentProject(projectId: string): null | Project | undefined {
  const { fetchApiDomain } = useApi()
  const { data } = useQuery<null | Project>({
    enabled: !!projectId,
    queryFn: () => fetchProjectById(fetchApiDomain, projectId),
    queryKey: ['project', projectId],
    refetchOnWindowFocus: false,
  })
  return data
}

/** The project's preview aspect ratio as the editor derives it (`longTakeRatio`, as CSS
 *  `w / h`), 9:16 until it is read. */
export function useProjectAspectRatio(projectId: string): string {
  return ASPECT_RATIO_CSS[useAgentProject(projectId)?.longTakeRatio ?? '9:16']
}
