import type { JsonValue, PrismaClient } from '@reelmakeeasy/api-db'
import { getPrismaInstance } from '@reelmakeeasy/api-db'

export type { JsonValue, PrismaClient }

/**
 * Returns the default Prisma client.
 * If not already instantiated, creates a new one.
 * !WARNING: This is a singleton and should not be used in multiple places.
 * !WARNING: Inside db-access-layer ONLY
 */
export function getDefaultPrisma(): PrismaClient {
  return getPrismaInstance()
}
