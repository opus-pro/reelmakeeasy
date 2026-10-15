'use client'

import type { VideoScript } from '@reelmakeeasy/common/types/video-script'
import { useQuery } from '@tanstack/react-query'

import { useApi } from '@/hooks/useApi'

/** The project's VideoScript query, for reading it again once a render saved a new one. */
export function videoScriptQueryKey(projectId: string) {
  return ['video-script', projectId] as const
}

/**
 * Fetches the project's VideoScript from storage (via the API). Returns `undefined`
 * when the script doesn't exist yet (e.g. story mode before the first export).
 *
 * The queryKey is stable across call sites so react-query de-dupes the request.
 */
export function useVideoScript(projectId: string): {
  data: undefined | VideoScript
  isLoading: boolean
} {
  const { fetchApiDomain } = useApi()

  const { data, isLoading } = useQuery<undefined | VideoScript>({
    queryKey: videoScriptQueryKey(projectId),
    queryFn: async () => {
      const response = await fetchApiDomain<VideoScript>(`/api/project/${projectId}/video-script`, {
        method: 'GET',
        noThrowError: true,
      })
      if (!response.ok) {
        return undefined
      }
      return response.data
    },
    enabled: !!projectId,
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
  })

  return { data, isLoading }
}
