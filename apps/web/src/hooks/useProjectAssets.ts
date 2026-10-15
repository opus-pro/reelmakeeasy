'use client'

import { Asset } from '@agent-lib/types/storyloader'
import { useQuery } from '@tanstack/react-query'

import { useApi } from './useApi'

export function useProjectAssets(projectId?: null | string) {
  const { fetchApiDomain: fetchWithProjectId } = useApi()

  return useQuery<Asset[]>({
    queryKey: ['project-assets', projectId],
    enabled: !!projectId,
    queryFn: async () => {
      if (!projectId) {
        return []
      }
      const res = await fetchWithProjectId<Asset[]>(`/api/project/${projectId}/assets`)
      if (!res.ok) {
        throw new Error('Failed to fetch assets')
      }
      return res.data
    },
    refetchOnWindowFocus: false,
  })
}
