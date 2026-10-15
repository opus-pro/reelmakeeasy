/**
 * Cancel a UIP session when its project is deleted.
 *
 * Deleting a project used to leave the planner session behind it
 * running. `project.deleted` soft-deleted the row and aborted the chat stream,
 * but never told the session workflow anything, so its auto-continue deadline
 * kept firing synthetic confirm / continue actions minutes later and rendered a
 * video into a soft-deleted row the owner can never open. Reported three times.
 *
 * The cancel itself is not new. `UipService.cancelSession` already signals the
 * workflow's cancel fast-path; it was simply
 * never wired to the delete event.
 */
import { createSubLogger } from '@reelmakeeasy/common/logger'

import type { PrismaService } from '../prisma/prisma.service'

const logger = createSubLogger('uip-service')

export type CancelSessionOnProjectDeletedDeps = {
  /** The cancel body without the request-scoped access check -- the delete already authorized it. */
  cancelActiveSession: (projectId: string) => Promise<'accepted' | 'duplicated' | 'rejected'>
  prisma: PrismaService
}

/** What the delete listener did. Only `cancelled` stopped a session. */
export type ProjectDeletedCancelOutcome =
  | 'already_locked'
  | 'cancelled'
  | 'failed'
  | 'no_session'
  | 'not_active'
  | 'rejected'

export async function cancelSessionOnProjectDeleted(
  projectId: string,
  deps: CancelSessionOnProjectDeletedDeps,
): Promise<ProjectDeletedCancelOutcome> {
  const outcome = await resolveProjectDeletedCancel(projectId, deps)
  return outcome
}

async function resolveProjectDeletedCancel(
  projectId: string,
  deps: CancelSessionOnProjectDeletedDeps,
): Promise<ProjectDeletedCancelOutcome> {
  const session = await deps.prisma.uipSession.findUnique({
    where: { projectId },
    select: { lockedAt: true, status: true },
  })

  if (!session) {
    // Non-UIP project (or the session row was never written): nothing schedules
    // work against it, so there is nothing to stop.
    return 'no_session'
  }

  if (session.status !== 'active') {
    // Already terminal (completed / cancelled / timed_out / failed): no deadline
    // is armed and no reservation of ours is outstanding.
    return 'not_active'
  }

  if (session.lockedAt) {
    // Confirmed before the delete. The spec is locked and story mode is rendering
    // against a real reservation, while the `status` column only flips to
    // 'completed' when the workflow's next persist callback lands -- so an active
    // status here does not mean the session is still planning. Releasing the
    // freeze inside that window would settle a reservation the running render
    // still needs. This cancel is exclusively about sessions that had NOT been
    // confirmed when the user deleted, and those have no lockedAt.
    return 'already_locked'
  }

  try {
    const result = await deps.cancelActiveSession(projectId)
    if (result === 'rejected') {
      // Another action is already pending in the timeline, so the cancel intent
      // could not be written. The deleted-project guard in triggerNextAction is
      // what stops that pending action from charging.
      logger.warn(`[${projectId}] Cancel on project delete rejected: another action is pending`)
      return 'rejected'
    }
    logger.info(`[${projectId}] Session cancelled because the project was deleted (${result})`)
    return 'cancelled'
  } catch (err) {
    // Best-effort. The project row is already soft-deleted and the rest of the
    // delete fan-out must still run, so a workflow blip here must not throw.
    logger.error(
      `[${projectId}] Failed to cancel session on project delete: ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
    return 'failed'
  }
}
