import { BadRequestException } from '@nestjs/common'

export type CreatedAtFilterDates = {
  createdAfter?: Date
  createdBefore?: Date
  createdFrom?: Date
  createdTo?: Date
}

type CreatedAtFilterQuery = {
  createdAfter?: string
  createdBefore?: string
  createdFrom?: string
  createdTo?: string
}

export function parseCreatedAtFilterQuery(query: CreatedAtFilterQuery): CreatedAtFilterDates {
  return {
    createdAfter: parseDateParam('createdAfter', query.createdAfter),
    createdBefore: parseDateParam('createdBefore', query.createdBefore),
    createdFrom: parseDateParam('createdFrom', query.createdFrom),
    createdTo: parseDateParam('createdTo', query.createdTo),
  }
}

function parseDateParam(paramName: keyof CreatedAtFilterQuery, value?: string): Date | undefined {
  if (!value) {
    return undefined
  }

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) {
    throw new BadRequestException(`${paramName} must be a valid date`)
  }

  return parsed
}
