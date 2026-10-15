import { useQuery } from '@tanstack/react-query'

import type { Session } from '@/components/story-mode-user-intent-planner/adapter/api-types'
import { useApi } from '@/hooks/useApi'

export function useUipFastConfirmActive(projectId: string) {
  const { fetchApiDomain } = useApi()
  return useQuery({
    enabled: false,
    queryFn: async () => {
      const { data: session } = await fetchApiDomain<Session>(`/api/uip-sessions/${projectId}`)
      const isPendingFastConfirm = session.state?.pending_action === 'confirm_fast'
      const isAcceptedInTimeline = session.timeline.events.some(
        (e) => e.type === 'action' && e.action === 'confirm_fast' && e.status === 'accepted',
      )
      return isPendingFastConfirm || isAcceptedInTimeline
    },
    queryKey: ['uip-fast-confirm-active', projectId] as const,
    staleTime: Infinity,
  })
}
