import type { PrismaClient } from '@reelmakeeasy/api-db'
import { SourcePreferenceDataService } from '@shared/types/api/domain-services/source-preference-data-service'
import {
  SourcePreferenceDto,
  SourcePreferenceDtoSchema,
} from '@shared/types/api/source-preference.zod'

import { getDefaultPrisma } from '../get-prisma'

export function getSourcePreferenceDataServicePrisma(
  prisma?: PrismaClient,
): SourcePreferenceDataService {
  const db = prisma ?? getDefaultPrisma()
  return {
    async getSourcePreferenceByUserId(userId: string): Promise<null | SourcePreferenceDto> {
      const row = await db.sourcePreference.findUnique({
        where: { userId },
      })
      if (!row) {
        return null
      }
      return SourcePreferenceDtoSchema.parse(row) ?? null
    },
  }
}
