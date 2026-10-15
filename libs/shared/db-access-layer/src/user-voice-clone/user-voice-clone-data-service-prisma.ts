import type { PrismaClient } from '@reelmakeeasy/api-db'
import type {
  Qwen3SpeakerRecord,
  UserVoiceCloneDataService,
} from '@shared/types/api/domain-services/user-voice-clone-data-service'

import { getDefaultPrisma } from '../get-prisma'

export function getUserVoiceCloneDataServicePrisma(
  prisma?: PrismaClient,
): UserVoiceCloneDataService {
  const db = prisma ?? getDefaultPrisma()
  return {
    async getFalCounterpartVoiceId(minimaxVoiceId: string): Promise<null | string> {
      // Scoped to provider:'fal' on purpose. `migratedFromVoiceId` is only ever set
      // on a Fal row, but constraining it here keeps the query honest if a future
      // provider reuses the column.
      //
      // Ordered deliberately. The contract is one Fal counterpart per source voice,
      // but that cannot be enforced in the schema: this is MongoDB, where a unique
      // index treats an absent field as null, so a plain `@@unique` would collide
      // across every row that has no `migratedFromVoiceId`, and Prisma does not
      // support partial indexes on MongoDB. So if a retried backfill ever does
      // create a duplicate, an unordered findFirst would route the same voice to a
      // different clone run to run. Oldest-wins makes it stable and matches the
      // first successful clone. Enforcing at-most-one belongs to the backfill's own
      // check-then-write idempotency.
      const row = await db.userVoiceClone.findFirst({
        where: { migratedFromVoiceId: minimaxVoiceId, provider: 'fal' },
        orderBy: { createdAt: 'asc' },
        select: { voiceId: true },
      })
      return row?.voiceId ?? null
    },

    async getProviderByVoiceId(voiceId: string): Promise<null | string> {
      const row = await db.userVoiceClone.findFirst({
        where: { voiceId },
        select: { provider: true },
      })
      return row?.provider ?? null
    },

    async getQwen3Speaker(voiceId: string): Promise<null | Qwen3SpeakerRecord> {
      const row = await db.userVoiceClone.findFirst({
        where: { provider: 'qwen3', voiceId },
        select: { referenceText: true, speakerEmbeddingPath: true },
      })
      if (!row?.speakerEmbeddingPath) return null
      return {
        speakerEmbeddingPath: row.speakerEmbeddingPath,
        ...(row.referenceText ? { referenceText: row.referenceText } : {}),
      }
    },
  }
}
