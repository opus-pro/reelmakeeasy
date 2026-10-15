import type { PrismaClient } from '@reelmakeeasy/api-db'
import type {
  StyleConfigDataService,
  StyleConfigDto,
  StyleFontDto,
  StylePaletteDto,
} from '@shared/types/api/domain-services/style-config-data-service'

import { getDefaultPrisma } from '../get-prisma'

function mapRowToDto(row: {
  [key: string]: unknown
  fonts: unknown
  palette: unknown
}): StyleConfigDto {
  return {
    ...row,
    fonts: row.fonts as StyleFontDto[],
    palette: row.palette as StylePaletteDto,
  } as StyleConfigDto
}

/**
 * StyleConfigDataService implementation backed by Prisma.
 */
export function getStyleConfigDataServicePrisma(prisma?: PrismaClient): StyleConfigDataService {
  const db = prisma ?? getDefaultPrisma()
  return {
    async getStyleByName(name: string): Promise<null | StyleConfigDto> {
      const row = await db.styleConfig.findUnique({
        where: { name },
      })
      return row ? mapRowToDto(row) : null
    },

    async getAllLiveStyles(): Promise<StyleConfigDto[]> {
      const rows = await db.styleConfig.findMany({
        where: { status: 'Live' },
        orderBy: { updatedAt: 'desc' },
      })
      return rows.map(mapRowToDto)
    },

    async getStylesList(): Promise<StyleConfigDto[]> {
      const rows = await db.styleConfig.findMany({
        orderBy: { updatedAt: 'desc' },
      })
      return rows.map(mapRowToDto)
    },
  }
}
