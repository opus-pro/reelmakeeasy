import { Logger } from '@reelmakeeasy/common/logger'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import { Injectable, type OnModuleInit } from '@nestjs/common'

import { PrismaService } from '../prisma/prisma.service'

// 30 days, matching discovery's widest window (windowDays <= 30) -- the
// collection's only reader. An event slides out of every window
// before it turns 30 days old (windowSince(30) = UTC start of today minus 29
// days), and TTL expiry only ever lags behind the cutoff, never leads it, so
// expiry cannot delete an in-window event. Everything older is read by nobody
// and previously accumulated forever.
const RETENTION_SECONDS = 30 * 24 * 60 * 60
const EVENT_COLLECTION = 'ProjectDownloadEvent'
// Prisma's canonical name for the model's @@index([createdAt]); the fallback
// below must reuse it so a later `prisma db push` sees name+keys as in sync.
const CREATED_AT_INDEX = 'ProjectDownloadEvent_createdAt_idx'

// collMod errors that mean "nothing to convert yet" (fresh environment):
// NamespaceNotFound (26) when the collection was never created, IndexNotFound
// (27, "cannot find index") when the collection exists without the index. Only
// these are recoverable by creating the index ourselves; anything else (e.g.
// Unauthorized when the runtime user lacks dbAdmin) must surface as its own
// error -- falling through to createIndexes would bury the actionable cause
// under an inevitable IndexOptionsConflict.
const RECOVERABLE_COLLMOD_ERROR =
  /ns does not exist|NamespaceNotFound|cannot find index|IndexNotFound/i

/**
 * Ensures the 30-day TTL on ProjectDownloadEvent that the discovery v2 design
 * specified but never shipped. Prisma's mongodb provider cannot
 * declare a TTL index in-schema, and the model already carries a plain
 * @@index([createdAt]) (discovery's window scan), so a second index on the same
 * key pattern is not allowed -- instead, collMod converts the existing index in
 * place (a pure catalog operation; requires MongoDB >= 5.1). Verified
 * empirically: collMod is idempotent (re-running reports old == new) and a
 * subsequent `prisma db push` reports "already in sync" rather than reverting
 * the TTL option.
 */
@Injectable()
export class ProjectDownloadRetentionService implements OnModuleInit {
  private readonly logger = new Logger(ProjectDownloadRetentionService.name)

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    // Best-effort: a failure must not block startup (mirrors the
    // StyleGenerationAttempt TTL precedent); the next pod boot retries.
    let collModError: Error
    try {
      await this.prisma.$runCommandRaw({
        collMod: EVENT_COLLECTION,
        index: { keyPattern: { createdAt: 1 }, expireAfterSeconds: RETENTION_SECONDS },
      })
      return
    } catch (error) {
      collModError = ensureError(error)
    }
    if (!RECOVERABLE_COLLMOD_ERROR.test(collModError.message)) {
      this.logger.warn(
        { err: collModError },
        'failed to ensure ProjectDownloadEvent TTL index (collMod)',
      )
      return
    }
    // Fresh environment where no download was ever recorded: create the index
    // with the TTL option directly, under Prisma's index name.
    try {
      await this.prisma.$runCommandRaw({
        createIndexes: EVENT_COLLECTION,
        indexes: [
          {
            expireAfterSeconds: RETENTION_SECONDS,
            key: { createdAt: 1 },
            name: CREATED_AT_INDEX,
          },
        ],
      })
    } catch (error) {
      this.logger.warn(
        { collModError: collModError.message, err: ensureError(error) },
        'failed to ensure ProjectDownloadEvent TTL index',
      )
    }
  }
}
