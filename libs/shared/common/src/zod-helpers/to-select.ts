import type { ZodObject, ZodRawShape } from 'zod'

import { zodGetKeys } from './get-keys'

/**
 * Converts a Zod object schema into a Prisma select clause.
 * Each top-level key in the schema becomes `{ key: true }` in the select.
 *
 * @param schema - A Zod object schema
 * @returns A Prisma-compatible select object
 *
 * @example
 * const StatusSchema = z.object({
 *   id: z.string(),
 *   status: z.string(),
 *   completedAt: z.date().nullable(),
 * })
 * const select = zodToSelect(StatusSchema)
 * // select = { id: true, status: true, completedAt: true }
 */
export function zodToSelect<T extends ZodRawShape>(schema: ZodObject<T>): Record<keyof T, true> {
  const select = {} as Record<keyof T, true>
  for (const key of zodGetKeys(schema)) {
    select[key] = true
  }
  return select
}
