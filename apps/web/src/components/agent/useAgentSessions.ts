'use client'

import {
  sessionRowStatus,
  sortSessionsByActivity,
} from '@reelmakeeasy/common/codex-agent/agent-sessions'
import type { AgentSessionListItem } from '@shared/types/api/agent'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback } from 'react'

import { useApi } from '@/hooks/useApi'

export const AGENT_SESSIONS_QUERY_KEY = ['agent-sessions'] as const

/** Thrown when the agent routes refuse the request (403: not this computer). */
export class AgentSessionsError extends Error {
  constructor(readonly status: number) {
    super(status === 403 ? 'Agent mode is only available on this computer' : "Couldn't load chats")
  }
}

/** Every agent chat, newest first. Refetches on focus, and every 10 s while a row's video
 *  is still generating. */
export function useAgentSessions() {
  const { fetchApiDomain } = useApi()
  return useQuery<AgentSessionListItem[], AgentSessionsError>({
    queryFn: async () => {
      const res = await fetchApiDomain<AgentSessionListItem[]>('/api/agent/sessions', {
        method: 'GET',
        noThrowError: true,
      })
      if (!res.ok) throw new AgentSessionsError(res.status)
      return sortSessionsByActivity(res.data)
    },
    queryKey: AGENT_SESSIONS_QUERY_KEY,
    refetchInterval: (query) =>
      query.state.data?.some((i) => sessionRowStatus(i).kind === 'generating') ? 10_000 : false,
    refetchOnWindowFocus: true,
  })
}

export function useRefreshAgentSessions(): () => void {
  const queryClient = useQueryClient()
  return useCallback(
    () => void queryClient.invalidateQueries({ queryKey: AGENT_SESSIONS_QUERY_KEY }),
    [queryClient],
  )
}
