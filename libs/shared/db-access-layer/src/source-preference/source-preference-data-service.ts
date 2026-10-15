import { SourcePreferenceDataService } from '@shared/types/api/domain-services/source-preference-data-service'

import { getSourcePreferenceDataServicePrisma } from './source-preference-data-service-prisma'

let defaultService: null | SourcePreferenceDataService = null

export function getSourcePreferenceDataService(): SourcePreferenceDataService {
  if (!defaultService) {
    defaultService = getSourcePreferenceDataServicePrisma()
  }
  return defaultService as SourcePreferenceDataService
}
