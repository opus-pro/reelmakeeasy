import type { PrismaClient } from '@reelmakeeasy/api-db'
import { logger } from '@reelmakeeasy/common/logger'
import type { DatabaseDumpDataService } from '@shared/types/api/domain-services/database-dump-data-service'

import { getDefaultPrisma } from '../get-prisma'

/**
 * DatabaseDumpDataService implementation backed by Prisma.
 */
export function getDatabaseDumpDataServicePrisma(prisma?: PrismaClient): DatabaseDumpDataService {
  return createPrismaDatabaseDumpDataService(prisma)
}

function createPrismaDatabaseDumpDataService(prisma?: PrismaClient): DatabaseDumpDataService {
  return {
    async getProject(projectId: string): Promise<unknown> {
      const db = prisma ?? getDefaultPrisma()
      try {
        return await db.project.findUnique({
          where: { id: projectId },
        })
      } catch (error) {
        logger.error(`[DatabaseDumpDataService] Failed to get Project: ${error}`)
        return null
      }
    },

    async getHistory(projectId: string): Promise<unknown[]> {
      const db = prisma ?? getDefaultPrisma()
      try {
        return await db.history.findMany({
          where: { projectId },
        })
      } catch (error) {
        logger.error(`[DatabaseDumpDataService] Failed to get History: ${error}`)
        return []
      }
    },

    async getProjectAttachments(projectId: string): Promise<unknown[]> {
      const db = prisma ?? getDefaultPrisma()
      try {
        return await db.projectAttachment.findMany({
          where: { projectId },
        })
      } catch (error) {
        logger.error(`[DatabaseDumpDataService] Failed to get ProjectAttachments: ${error}`)
        return []
      }
    },

    async getProjectShared(projectId: string): Promise<unknown> {
      const db = prisma ?? getDefaultPrisma()
      try {
        return await db.projectShared.findUnique({
          where: { projectId },
        })
      } catch (error) {
        logger.error(`[DatabaseDumpDataService] Failed to get ProjectShared: ${error}`)
        return null
      }
    },
  }
}
