'use client'

import type { LongTakeEditorStateResponse } from '@shared/types/api/long-take'
import { useQuery, useQueryClient, type UseQueryOptions } from '@tanstack/react-query'
import { useCallback } from 'react'

import { useApi } from '@/hooks/useApi'

const UNRENDERED_CHANGES_QUERY_KEY = 'long-take-unrendered-changes'
const RUNNING_GENERATION_POLL_MS = 5000

type EditorStateSignals = {
  hasUnrenderedChanges: boolean
  runningInpaintGenerationCount: number
}

const NO_SIGNALS: EditorStateSignals = {
  hasUnrenderedChanges: false,
  runningInpaintGenerationCount: 0,
}

export function buildUnrenderedChangesQueryKey(projectId: string) {
  return [UNRENDERED_CHANGES_QUERY_KEY, projectId] as const
}

export function useInvalidateUnrenderedChanges(projectId: string) {
  const queryClient = useQueryClient()

  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: buildUnrenderedChangesQueryKey(projectId) })
  }, [queryClient, projectId])
}

export function useUnrenderedChanges(projectId: string) {
  return useEditorStateSignals(projectId, false).hasUnrenderedChanges
}

/**
 * Inpaint generations the server still considers in flight.
 *
 * Polls while the server (or `localRunning`) reports work, so the actions a running generation
 * holds re-enable without the user refreshing.
 */
export function useRunningInpaintGenerationCount(projectId: string, localRunning: boolean) {
  return useEditorStateSignals(projectId, (query) =>
    localRunning || (query.state.data?.runningInpaintGenerationCount ?? 0) > 0
      ? RUNNING_GENERATION_POLL_MS
      : false,
  ).runningInpaintGenerationCount
}

function useEditorStateSignals(
  projectId: string,
  refetchInterval: UseQueryOptions<EditorStateSignals>['refetchInterval'],
): EditorStateSignals {
  const { fetchApiDomain } = useApi()

  const { data } = useQuery({
    queryKey: buildUnrenderedChangesQueryKey(projectId),
    queryFn: async (): Promise<EditorStateSignals> => {
      const res = await fetchApiDomain<LongTakeEditorStateResponse>(
        `/api/long-take-videos/${projectId}/state`,
      )
      return res.ok && res.data
        ? {
            hasUnrenderedChanges: res.data.hasUnrenderedChanges,
            runningInpaintGenerationCount: res.data.runningInpaintGenerationCount,
          }
        : NO_SIGNALS
    },
    enabled: !!projectId,
    refetchInterval,
    refetchOnWindowFocus: true,
    // App default staleTime is 5 min (providers.tsx); this signal must be
    // fresh on focus, not served from a stale cache.
    staleTime: 0,
  })

  return data ?? NO_SIGNALS
}
