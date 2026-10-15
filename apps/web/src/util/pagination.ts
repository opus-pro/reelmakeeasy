import { PaginatedResponse } from '@shared/types/api/common/pagination'

/**
 * Standard getNextPageParam function for useInfiniteQuery with PaginatedResponse
 * Returns the next page number if there are more pages, otherwise undefined
 */
export function getNextPageParam<T>(lastPage: PaginatedResponse<T>): number | undefined {
  const pagination = lastPage?.pagination
  if (!pagination) {
    return undefined
  }
  const currentPage = pagination.page ?? 1
  const totalPages = pagination.pageTotal ?? 1
  if (currentPage >= totalPages) {
    return undefined
  }
  return currentPage + 1
}
