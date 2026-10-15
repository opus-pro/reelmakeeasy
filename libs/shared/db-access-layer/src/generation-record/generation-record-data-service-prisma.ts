import type { PrismaClient } from '@reelmakeeasy/api-db'
import type {
  GenerationRecordCreateData,
  GenerationRecordDataService,
  GenerationRecordPatchUrisData,
} from '@shared/types/api/domain-services/generation-record-data-service'

import { getDefaultPrisma, type JsonValue } from '../get-prisma'

/**
 * GenerationRecordDataService implementation backed by Prisma.
 */
export function getGenerationRecordDataServicePrisma(
  prisma?: PrismaClient,
): GenerationRecordDataService {
  const db = prisma ?? getDefaultPrisma()
  return {
    async createRecord(data: GenerationRecordCreateData): Promise<{ id: string }> {
      const created = await db.generationRecord.create({
        data: {
          taskId: data.taskId,
          attempt: data.attempt,
          projectId: data.projectId,
          userId: data.userId ?? undefined,
          anchorId: data.anchorId ?? undefined,
          anchorType: data.anchorType ?? undefined,
          type: data.type,
          task: data.task,
          status: data.status,
          model: data.model ?? undefined,
          inputText: data.inputText ?? undefined,
          outputText: data.outputText ?? undefined,
          inputUris: data.inputUris ?? [],
          outputUris: data.outputUris ?? [],
          stagingStatus: data.stagingStatus ?? undefined,
          stagingError: data.stagingError ?? undefined,
          errorName: data.errorName ?? undefined,
          errorMessage: data.errorMessage ?? undefined,
          errorStack: data.errorStack ?? undefined,
          meta: data.meta as JsonValue | undefined,
        },
        select: { id: true },
      })
      return { id: created.id }
    },

    async patchRecordUris(data: GenerationRecordPatchUrisData): Promise<void> {
      await db.generationRecord.update({
        where: { id: data.id },
        data: {
          inputUris: data.inputUris,
          outputUris: data.outputUris,
          stagingStatus: data.stagingStatus ?? undefined,
          stagingError: data.stagingError ?? undefined,
        },
      })
    },
  }
}
