import type { UserVoiceCloneDataService } from '@shared/types/api/domain-services/user-voice-clone-data-service'

import { getUserVoiceCloneDataServicePrisma } from './user-voice-clone-data-service-prisma'

let defaultService: null | UserVoiceCloneDataService = null

export function getUserVoiceCloneDataService(): UserVoiceCloneDataService {
  if (!defaultService) {
    defaultService = getUserVoiceCloneDataServicePrisma()
  }
  return defaultService
}
