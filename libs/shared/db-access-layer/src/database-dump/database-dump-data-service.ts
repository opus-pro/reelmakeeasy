import { getPrismaInstance as getAoPrismaClient } from '@reelmakeeasy/api-db'
import type { DatabaseDumpDataService } from '@shared/types/api/domain-services/database-dump-data-service'

import { getDatabaseDumpDataServicePrisma } from './database-dump-data-service-prisma'

const DEFAULT_INSTANCE_KEY = Symbol('default_db_dump')
const cacheMap = new Map<string | symbol, DatabaseDumpDataService>()

/**
 * Returns the database dump data service for the current context.
 * Implementation is Prisma-backed today; can be swapped to an API-backed implementation later.
 * Used by DatabaseCollector to gather production database state for evaluation archival.
 */
export function getDatabaseDumpDataService(opt?: {
  datasourceUrl: string
}): DatabaseDumpDataService {
  const key = opt?.datasourceUrl ?? DEFAULT_INSTANCE_KEY
  const service = cacheMap.get(key)
  if (service) {
    return service
  }

  const params = key === DEFAULT_INSTANCE_KEY ? undefined : { datasourceUrl: opt?.datasourceUrl }
  const client = getAoPrismaClient(params)
  const newService = getDatabaseDumpDataServicePrisma(client)
  cacheMap.set(key, newService)
  return newService
}
