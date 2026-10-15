import { logger } from '@reelmakeeasy/common/logger'
import { PROJECT_STAGE } from '@shared/types/enums/project'
import type { JournalEntry } from '@reelmakeeasy/workflow-engine/worker'

import type { PrismaService } from '../prisma/prisma.service'

export const INTERRUPTED_RUN_REASON =
  'Generation stopped because the server restarted. Start it again to continue.'

const TERMINAL_STAGES = [PROJECT_STAGE.FINISHED, PROJECT_STAGE.FAILED]

/**
 * Project-scoped workflow ids look like `ao:{projectId}:{domain}:...` (see
 * `getWorkflowId`). Global ones (`ao:{domain}:...`) also match this shape, so
 * callers must confirm the id belongs to a real project.
 */
export function projectIdFromWorkflowId(workflowId: string): string | undefined {
  const [prefix, projectId] = workflowId.split(':')
  return prefix === 'ao' && projectId ? projectId : undefined
}

/**
 * Workflows run inside the API process and are not resumable, so a run that
 * was open when the process stopped will never finish. Mark each affected
 * project as failed so the UI stops waiting on it. Projects that already
 * reached a terminal stage are left alone: their interrupted run was a
 * follow-up job (a remux, a regenerate) and the delivered video still stands.
 */
export async function failInterruptedRuns(
  prisma: PrismaService,
  runs: JournalEntry[],
): Promise<string[]> {
  if (runs.length === 0) return []

  const candidateIds = [
    ...new Set(runs.map((r) => projectIdFromWorkflowId(r.workflowId)).filter(Boolean)),
  ] as string[]
  const projects = candidateIds.length
    ? await prisma.project.findMany({
        select: { id: true },
        where: { id: { in: candidateIds }, stage: { notIn: TERMINAL_STAGES } },
      })
    : []
  const failedIds = projects.map((p) => p.id)

  if (failedIds.length) {
    await prisma.project.updateMany({
      data: { failedReason: INTERRUPTED_RUN_REASON, stage: PROJECT_STAGE.FAILED },
      where: { id: { in: failedIds }, stage: { notIn: TERMINAL_STAGES } },
    })
  }

  for (const run of runs) {
    logger.warn(
      `[workflow-runs] Interrupted by restart: ${run.workflowType} ${run.workflowId} (started ${run.startTime})`,
    )
  }
  logger.info(
    `[workflow-runs] ${runs.length} interrupted run(s); marked ${failedIds.length} project(s) as failed`,
  )
  return failedIds
}
