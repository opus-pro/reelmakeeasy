import type { GenerationRecordDataService } from '@shared/types/api/domain-services/generation-record-data-service'

import { getGenerationRecordDataServicePrisma } from './generation-record-data-service-prisma'

let defaultService: GenerationRecordDataService | null = null

/**
 * Returns the generation record data service for the current context.
 * Implementation is Prisma-backed today; can be swapped to another implementation later.
 */
export function getGenerationRecordDataService(): GenerationRecordDataService {
  if (!defaultService) {
    defaultService = getGenerationRecordDataServicePrisma()
  }
  return defaultService
}
