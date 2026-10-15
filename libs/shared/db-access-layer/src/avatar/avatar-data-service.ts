import { AvatarDataService } from '@shared/types/api/domain-services/avatar-data-service'

import { getAvatarDataServicePrisma } from './avatar-data-service-prisma'

let defaultService: AvatarDataService | null = null

export function getAvatarDataService(): AvatarDataService {
  if (!defaultService) {
    defaultService = getAvatarDataServicePrisma()
  }
  return defaultService as AvatarDataService
}
