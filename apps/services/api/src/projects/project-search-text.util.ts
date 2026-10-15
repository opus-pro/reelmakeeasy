import { PROJECT_STAGE } from '@shared/types/enums/project'

// Cap keeps the one-time Voyage embed cheap and bounded; the head of a script
// carries the topical signal vector search needs (hook, subject, setting).
export const SEARCH_TEXT_MAX_CHARS = 4000

interface ProjectSnapshotStore {
  project: {
    findUnique: (args: {
      select: { script: true; searchText: true }
      where: { id: string }
    }) => Promise<null | { script: null | string; searchText: null | string }>
    updateMany: (args: {
      data: { searchText: string }
      where: {
        id: string
        OR: Array<{ searchText: null } | { searchText: { isSet: false } }>
      }
    }) => Promise<{ count: number }>
  }
}

/**
 * Builds the write-once Project.searchText value from the final script.
 * Returns undefined when there is nothing useful to embed so callers skip
 * the write entirely (Atlas only embeds documents that have the field).
 */
export function buildProjectSearchText(script: null | string | undefined): string | undefined {
  const trimmed = script?.trim()
  if (!trimmed) {
    return undefined
  }
  return trimmed.length <= SEARCH_TEXT_MAX_CHARS ? trimmed : trimmed.slice(0, SEARCH_TEXT_MAX_CHARS)
}

/**
 * Resolves the write-once searchText snapshot for a project update patch.
 * Returns the snapshot only when the patch moves the project to FINISHED,
 * no snapshot exists yet (write-once), and there is script content. Callers
 * can assign the result directly into a Prisma update patch -- undefined
 * keys are ignored by Prisma.
 */
export async function resolveSearchTextSnapshot(
  prisma: ProjectSnapshotStore,
  id: string,
  patch: { script?: null | string; stage?: null | string },
): Promise<string | undefined> {
  if (patch.stage !== PROJECT_STAGE.FINISHED) {
    return undefined
  }
  const existing = await prisma.project.findUnique({
    where: { id },
    select: { script: true, searchText: true },
  })
  if (!existing || existing.searchText) {
    return undefined
  }
  return buildProjectSearchText(patch.script ?? existing.script)
}

/**
 * Resolves and persists the write-once searchText snapshot. The write is
 * guarded by an unset-only where clause so concurrent FINISHED updates
 * cannot overwrite an already-written snapshot (the pre-read in
 * resolveSearchTextSnapshot alone would be a TOCTOU race).
 */
export async function applySearchTextSnapshot(
  prisma: ProjectSnapshotStore,
  id: string,
  patch: { script?: null | string; stage?: null | string },
): Promise<void> {
  const snapshot = await resolveSearchTextSnapshot(prisma, id, patch)
  if (!snapshot) {
    return
  }
  await prisma.project.updateMany({
    where: { id, OR: [{ searchText: null }, { searchText: { isSet: false } }] },
    data: { searchText: snapshot },
  })
}
