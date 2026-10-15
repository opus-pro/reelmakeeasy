import type { JsonValue, PrismaClient } from '@reelmakeeasy/api-db'
import {
  AvatarDataService,
  SharedAvatarDto,
} from '@shared/types/api/domain-services/avatar-data-service'

import { getDefaultPrisma } from '../get-prisma'

function mapRowToSharedAvatarDto(
  row: null | {
    cropOffset: null | number
    images: JsonValue | null
  },
): null | SharedAvatarDto {
  return row
    ? {
        cropOffset: row.cropOffset,
        images: (row.images ?? []) as unknown[],
      }
    : null
}
/**
 * AvatarDataService implementation backed by Prisma.
 */
export function getAvatarDataServicePrisma(prisma?: PrismaClient): AvatarDataService {
  const db = prisma ?? getDefaultPrisma()
  return {
    async getAiAvatarById(id: string): Promise<null | SharedAvatarDto> {
      const row = await db.aiAvatar.findUnique({ where: { id } })
      return mapRowToSharedAvatarDto(row)
    },
    async getStockAvatarById(id: string): Promise<null | SharedAvatarDto> {
      const row = await db.stockAvatar.findUnique({ where: { id } })
      return mapRowToSharedAvatarDto(row)
    },
  }
}
