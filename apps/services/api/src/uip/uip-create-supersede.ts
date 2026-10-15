/**
 * Park auto-continue on a session the user has replaced.
 *
 * Why this exists: a duplicate session is an annoyance, but it is auto-continue
 * that turns it into a wasted render. The failure mode: the user finishes the
 * *newer* session by hand (confirm-fast) and abandons the older one at its
 * script_review gate -- and the older one then advances itself to storyboard and
 * confirms itself to video minutes later with no user click. Such an
 * auto-dispatch logs as `Deadline expired - dispatched continue|confirm`, the
 * path documented in uip-deadline-resolver.ts as firing with confirmType='Auto'.
 *
 * Auto-continue itself is intended behaviour ("Stay to refine it together, or
 * I'll use my best judgment"), so this does NOT disable it in general -- only on
 * a session whose content the user has demonstrably re-submitted. The parked
 * session stays openable and manually finishable; it simply stops arming the
 * review-gate timers. `foldDeadline` returns null whenever
 * foldAutoContinueEnabled is false, and session-termination.ts already treats an
 * auto-continue-off idle timeout as the designed outcome of the opt-out (logged
 * info, not an anomaly), so no new terminal state or alert noise appears.
 *
 * Reuses the existing mid-session flip end to end -- no workflow-code
 * change.
 */
import { createSubLogger } from '@reelmakeeasy/common/logger'

import type { PrismaService } from '../prisma/prisma.service'

import { setAutoContinueFn } from './uip-set-auto-continue'

const logger = createSubLogger('uip-service')

export type SupersedeAutoContinueDeps = {
  prisma: PrismaService
  signalWorkflow?: (projectId: string, signal: string, payload: unknown) => Promise<void>
}

/**
 * Best-effort: turn auto-continue off on `supersededProjectId` because
 * `replacementProjectId` re-submitted the same content.
 *
 * Never throws and never blocks -- the create it hangs off has already
 * succeeded, so a failure here must cost the user nothing. Skips a session that
 * is no longer active, already locked, or has already continued: past those
 * points the video is committed and parking it achieves nothing.
 */
export async function supersedeAutoContinue(
  supersededProjectId: string,
  replacementProjectId: string,
  deps: SupersedeAutoContinueDeps,
): Promise<void> {
  const { prisma, signalWorkflow } = deps
  if (!signalWorkflow || supersededProjectId === replacementProjectId) {
    return
  }
  try {
    const session = await prisma.uipSession.findUnique({
      select: { continuedAt: true, lockedAt: true, status: true },
      where: { projectId: supersededProjectId },
    })
    if (!session || session.status !== 'active') {
      return
    }
    if (session.lockedAt !== null || session.continuedAt !== null) {
      return
    }
    await setAutoContinueFn(supersededProjectId, false, { prisma, signalWorkflow })
    logger.info(
      `[${supersededProjectId}] Parked auto-continue: superseded by ${replacementProjectId} (same content)`,
    )
  } catch (err) {
    // A completed / missing workflow signals as a 400 ("Session is completed"),
    // which is an expected race here, not a fault worth failing the create for.
    logger.warn(
      `[${supersededProjectId}] Could not park auto-continue for superseded session: ${err}`,
    )
  }
}
