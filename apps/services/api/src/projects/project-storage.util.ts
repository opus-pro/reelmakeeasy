import type { PrismaClient } from '@reelmakeeasy/api-db'
import { logger } from '@reelmakeeasy/common/logger'
import { measureProjectDeliverableBytes } from '@reelmakeeasy/common/storage/stored-files'
import type { ProjectForBackend } from '@shared/types/api/project'
import { PROJECT_STAGE } from '@shared/types/enums/project'

import { updateProjectLifecycle } from '../project-lifecycle/lifecycle-write.util'

// Persist a measured storage value to Project.storageBytes. Overwrite (idempotent). Throws on write
// failure -- the finish-hook wrapper below swallows it; the backlog sweep logs+skips per row.
//
// Writes via the raw-Mongo lifecycle writer so this internal measurement does NOT bump @updatedAt:
// it is not a user edit, and the backlog sweep touches every project row -- bumping updatedAt would
// reorder every "recently updated" project view (a supported sort). storageBytes is passed as
// extended-JSON { $numberLong } so it round-trips as a BSON Long: a raw JS bigint throws "cannot
// serialize BigInt" in $runCommandRaw, and a plain JS number would be stored as a Double and read
// back wrong for a BigInt column.
export async function persistProjectStorageBytes(
  prisma: PrismaClient,
  projectId: string,
  storageBytes: bigint,
): Promise<void> {
  await updateProjectLifecycle(
    prisma,
    { id: projectId },
    { storageBytes: { $numberLong: storageBytes.toString() }, storageBytesUpdatedAt: new Date() },
  )
}

// Measure + persist one project's delivered video size. Non-fatal: any error (storage read or DB
// write) is logged and swallowed so the finish hot path is never disrupted; a dropped write leaves
// the row null for the backlog sweep. The sweep also measures via measureProjectDeliverableBytes +
// persistProjectStorageBytes, but does NOT go through this wrapper -- it splits the two steps
// (concurrent reads, serialized writes) and does its own per-row error handling.
export async function measureAndPersistProjectStorage(
  prisma: PrismaClient,
  projectId: string,
): Promise<void> {
  try {
    const storageBytes = await measureProjectDeliverableBytes(projectId)
    await persistProjectStorageBytes(prisma, projectId, storageBytes)
  } catch (error) {
    logger.warn({ projectId, error }, 'measureAndPersistProjectStorage failed (non-fatal)')
  }
}

/**
 * Fire measurement when the delivered video may have changed: a finish (FINISHED stage or a
 * resultVideo write) publishes the 1080p delivery, and a resultVideo4k write is finalize4k's
 * terminal project-patch, which swaps the counted file to the larger 4K delivery. Those are the
 * only two moments a delivery object is written, so no periodic re-measure job is needed.
 */
export function shouldMeasureOnUpdate(data: Partial<ProjectForBackend>): boolean {
  return data.stage === PROJECT_STAGE.FINISHED || !!data.resultVideo || !!data.resultVideo4k
}

/**
 * Finish hook for internalUpdateProject: measure storage when a patch signals a
 * finish. Fire-and-forget + non-fatal (the inner call swallows its own errors);
 * guarding here keeps the hot-path call site to a single line.
 */
export function measureStorageOnFinish(
  prisma: PrismaClient,
  projectId: string,
  patch: Partial<ProjectForBackend>,
): void {
  if (shouldMeasureOnUpdate(patch)) {
    void measureAndPersistProjectStorage(prisma, projectId)
  }
}
