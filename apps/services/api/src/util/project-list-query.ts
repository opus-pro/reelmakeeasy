import { BadRequestException } from '@nestjs/common'
import {
  PROJECT_SEEN_FILTER,
  PROJECT_STAGE_FILTER,
  type ProjectSeenFilter,
  type ProjectStageFilter,
} from '@shared/types/api/project'

import { type CreatedAtFilterDates, parseCreatedAtFilterQuery } from './created-at-filter'

type ProjectListFilterQuery = {
  createdAfter?: string
  createdBefore?: string
  createdFrom?: string
  createdTo?: string
  isLongTake?: string
  seenFilter?: string
  stageFilter?: string
  withCount?: string
}

const SEEN_FILTER_VALUES = new Set<ProjectSeenFilter>(Object.values(PROJECT_SEEN_FILTER))
const STAGE_FILTER_VALUES = new Set<ProjectStageFilter>(Object.values(PROJECT_STAGE_FILTER))

export function parseBooleanQuery(
  paramName: string,
  value: boolean | string | undefined,
  defaultValue: boolean,
): boolean {
  if (value === undefined || value === null || value === '') {
    return defaultValue
  }
  if (typeof value === 'boolean') {
    return value
  }
  if (value === 'true') {
    return true
  }
  if (value === 'false') {
    return false
  }
  throw new BadRequestException(`${paramName} must be true or false`)
}

export function parseNonNegativeIntegerQuery(
  paramName: string,
  value: number | string | undefined,
  defaultValue: number,
): number {
  if (value === undefined || value === null || value === '') {
    return defaultValue
  }

  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new BadRequestException(`${paramName} must be a non-negative integer`)
  }

  return parsed
}

export function parseOptionalProjectSeenFilter(value?: string): ProjectSeenFilter | undefined {
  return parseOptionalEnumFilter(
    value,
    SEEN_FILTER_VALUES,
    'seenFilter',
    Object.values(PROJECT_SEEN_FILTER).join(', '),
  )
}

export function parseOptionalProjectStageFilter(value?: string): ProjectStageFilter | undefined {
  return parseOptionalEnumFilter(
    value,
    STAGE_FILTER_VALUES,
    'stageFilter',
    Object.values(PROJECT_STAGE_FILTER).join(', '),
  )
}

export function parsePositiveIntegerQuery(
  paramName: string,
  value: number | string | undefined,
  defaultValue: number,
): number {
  if (value === undefined || value === null || value === '') {
    return defaultValue
  }

  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new BadRequestException(`${paramName} must be a positive integer`)
  }

  return parsed
}

export function parseProjectListFilters(query: ProjectListFilterQuery): {
  createdAtFilter: CreatedAtFilterDates
  isLongTake?: boolean
  seenFilter: ProjectSeenFilter
  stageFilter: ProjectStageFilter
  withCount: boolean
} {
  const createdAtFilter = parseCreatedAtFilterQuery({
    createdAfter: query.createdAfter,
    createdBefore: query.createdBefore,
    createdFrom: query.createdFrom,
    createdTo: query.createdTo,
  })

  validateDateRange(
    'createdAfter',
    createdAtFilter.createdAfter,
    'createdBefore',
    createdAtFilter.createdBefore,
  )
  validateDateRange(
    'createdFrom',
    createdAtFilter.createdFrom,
    'createdTo',
    createdAtFilter.createdTo,
  )

  return {
    createdAtFilter,
    isLongTake:
      query.isLongTake === undefined || query.isLongTake === ''
        ? undefined
        : parseBooleanQuery('isLongTake', query.isLongTake, false),
    seenFilter: parseOptionalProjectSeenFilter(query.seenFilter) ?? PROJECT_SEEN_FILTER.ALL,
    stageFilter: parseOptionalProjectStageFilter(query.stageFilter) ?? PROJECT_STAGE_FILTER.ALL,
    withCount: parseBooleanQuery('withCount', query.withCount, true),
  }
}

function parseOptionalEnumFilter<T extends string>(
  value: string | undefined,
  allowedValues: Set<T>,
  paramName: string,
  validList: string,
): T | undefined {
  if (value === undefined) {
    return undefined
  }
  if (allowedValues.has(value as T)) {
    return value as T
  }
  throw new BadRequestException(`${paramName} must be one of: ${validList}`)
}

function validateDateRange(leftName: string, left?: Date, rightName?: string, right?: Date) {
  if (!left || !right || !rightName) {
    return
  }
  if (left.getTime() > right.getTime()) {
    throw new BadRequestException(`${leftName} must be earlier than or equal to ${rightName}`)
  }
}
