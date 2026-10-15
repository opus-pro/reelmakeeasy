import { PaginationConfig } from '@shared/types/api/common/pagination'

const MAX_PAGE_SIZE = 200

/** better sticked to the max pagesize */
export function parsePaginationConfig({
  pageSize,
  page,
  maxPageSize = MAX_PAGE_SIZE,
}: {
  maxPageSize?: number
  page: number
  pageSize: number
}): {
  page: number
  pageSize: number
  skip: number
  take: number
} {
  const validPage = Math.max(page, 1)
  const validPageSize = Math.min(pageSize, maxPageSize)
  return {
    page: validPage,
    pageSize: validPageSize,
    skip: (validPage - 1) * validPageSize,
    take: validPageSize,
  }
}
export function toPaginationConfig({
  take,
  skip,
  total,
}: {
  skip: number
  take: number
  total: number
}): PaginationConfig {
  if (take <= 0) {
    return {
      page: 1,
      pageSize: 0,
      pageTotal: 0,
      total,
    }
  }

  const pageSize = take
  const page = Math.floor(skip / take) + 1
  const pageTotal = Math.ceil(total / take)
  return {
    page,
    pageSize,
    pageTotal,
    total,
  }
}
