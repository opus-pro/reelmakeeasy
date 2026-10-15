import { getPrismaInstance as getAoPrismaClient, PrismaClient } from '@reelmakeeasy/api-db'
import type { ProjectDataService } from '@shared/types/api/domain-services/project-data-service'

import { getProjectDataServicePrisma } from './project-data-service-prisma'

// let defaultService: null | ProjectDataService = null
const DEFAULT_INSTANCE_KEY = Symbol('default_ao_uri')
const cacheMap = new Map<string | symbol, ProjectDataService>()

/**
 * Returns the project data service for the current context.
 * Implementation is Prisma-backed today (including eval mock when in eval workflow);
 * can be swapped to an API-backed implementation later.
 * Callers (e.g. load-context) depend only on ProjectDataService, not on Prisma.
 */
export function getProjectDataService(opt?: {
  datasourceUrl: string
  prisma?: PrismaClient
}): ProjectDataService {
  if (opt?.prisma) {
    return getProjectDataServicePrisma(opt.prisma)
  }

  const key = opt?.datasourceUrl ?? DEFAULT_INSTANCE_KEY
  const service = cacheMap.get(key)
  if (service) {
    return service
  }

  const params = key === DEFAULT_INSTANCE_KEY ? undefined : { datasourceUrl: opt?.datasourceUrl }
  const client = getAoPrismaClient(params)
  const newService = getProjectDataServicePrisma(client)
  cacheMap.set(key, newService)
  return newService
}
