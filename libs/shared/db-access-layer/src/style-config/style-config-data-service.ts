import type { StyleConfigDataService } from '@shared/types/api/domain-services/style-config-data-service'

import { getStyleConfigDataServicePrisma } from './style-config-data-service-prisma'

let defaultService: null | StyleConfigDataService = null

/**
 * Returns the style config data service for the current context.
 * Implementation is Prisma-backed today; can be swapped to an API-backed implementation later.
 * Agent and workers should use this instead of direct Prisma access for style config.
 */
export function getStyleConfigDataService(): StyleConfigDataService {
  if (!defaultService) {
    defaultService = getStyleConfigDataServicePrisma()
  }
  return defaultService
}
