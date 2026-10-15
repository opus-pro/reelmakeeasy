/** @deprecated Use @reelmakeeasy/common/api/pagination-types instead */
export type PaginatedResponse<T> = {
  data: T[]
  pagination?: PaginationConfig
}
export type PaginationConfig = {
  /** start from 1 */
  page: number
  pageSize: number
  pageTotal: number
  total: number
}
