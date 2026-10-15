import { PaginatedResponse } from '@shared/types/api/common/pagination'
import { ChatBoxMessage } from '@shared/types/chat/message'
import { useQuery } from '@tanstack/react-query'
import { useCallback } from 'react'

import { useApi } from '@/hooks/useApi'

export function useFetchHistory(projectId?: string) {
  const { fetchApiDomain } = useApi()

  const fetchAllHistory = useCallback(
    async (projectId: string): Promise<ChatBoxMessage[]> => {
      let allMessages: ChatBoxMessage[] = []

      // start from 1
      let page = 1
      const pageSize = 1000 // Use max page size to minimize requests
      let hasMore = true

      while (hasMore) {
        const query = new URLSearchParams({ page: page.toString(), pageSize: pageSize.toString() })
        const response = await fetchApiDomain<PaginatedResponse<ChatBoxMessage>>(
          `/api/history/${projectId}?${query.toString()}`,
        )

        if (response.data?.data) {
          allMessages = [...allMessages, ...response.data.data]

          // Check if there are more pages
          const pagination = response.data.pagination
          if (pagination) {
            const totalPages = pagination.pageTotal
            hasMore = page < totalPages
            page++
          } else {
            hasMore = false
          }
        } else {
          hasMore = false
        }
      }

      return allMessages
    },
    [fetchApiDomain],
  )

  const { data: history, ...queryProps } = useQuery({
    enabled: !!projectId,
    queryFn: () => fetchAllHistory(projectId || ''),
    queryKey: ['all-paginated-history', projectId],
    staleTime: 1000 * 60,
  })

  return {
    history,
    fetchAllHistory,
    ...queryProps,
  }
}
