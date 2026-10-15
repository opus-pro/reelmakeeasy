import { Injectable } from '@nestjs/common'
import { Cron } from '@nestjs/schedule'
import { logger } from '@reelmakeeasy/common/logger'
import { createClient } from '@reelmakeeasy/common/workflow/client'
import { getUipWorkflowId } from '@reelmakeeasy/common/workflow/uip-workflow-version'
import { isDev } from '@reelmakeeasy/common/utils/env'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import { WorkflowNotFoundError } from '@reelmakeeasy/workflow-engine/client'

import { PrismaService } from '../prisma/prisma.service'
import { ScheduledJobNameEnum } from '../scheduled-job/scheduled-job.dto'
import { ScheduledJobRegistryService } from '../scheduled-job/scheduled-job-registry.service'

import { markUipSessionFailedIfActive } from './uip-session-ops'

// Workflow statuses that indicate the workflow is no longer running
const TERMINAL_WORKFLOW_STATUSES = new Set([
  'CANCELLED',
  'COMPLETED',
  'FAILED',
  'TERMINATED',
  'TIMED_OUT',
])

@Injectable()
export class UipScheduledJobService {
  private static readonly LOCK_TTL_SECONDS = 5 * 60 // 5 minutes

  constructor(
    private readonly prisma: PrismaService,
    private readonly scheduledJobRegistry: ScheduledJobRegistryService,
  ) {}

  /**
   * Cron job to detect stuck UIP sessions whose workflow has died
   * without firing a callback. Runs every 10 minutes in production.
   *
   * A session is a candidate if it has been active for more than 2 hours.
   * For each candidate we describe the workflow:
   * - Not found (WorkflowNotFoundError) -> mark failed
   * - Terminal status (FAILED / CANCELLED / TERMINATED / TIMED_OUT) -> mark failed
   * - COMPLETED status -> ideally should have been closed via callback; mark failed
   * - RUNNING -> skip (still alive)
   */
  @Cron('0 */10 * * * *', {
    disabled: isDev(),
  })
  async markStuckSessionsFailed(): Promise<void> {
    await this.scheduledJobRegistry.withJob(
      ScheduledJobNameEnum.UIP_MARK_STUCK_SESSIONS_FAILED,
      UipScheduledJobService.LOCK_TTL_SECONDS,
      () => this.executeMarkStuckSessionsFailed(),
    )
  }

  private async executeMarkStuckSessionsFailed(): Promise<void> {
    const cutoff = new Date(Date.now() - 2 * 60 * 60 * 1000) // 2 hours ago

    const sessions = await this.prisma.uipSession.findMany({
      where: {
        status: 'active',
        createdAt: { lt: cutoff },
      },
      select: { projectId: true },
    })

    if (!sessions.length) {
      return
    }

    logger.info(`uipMarkStuckSessionsFailed: checking ${sessions.length} candidate session(s)`)

    const workflowClient = await createClient()

    for (const { projectId } of sessions) {
      try {
        const workflowId = getUipWorkflowId(projectId)
        let isStuck = false

        try {
          const handle = workflowClient.workflow.getHandle(workflowId)
          const description = await handle.describe()
          const statusName = description.status.name

          if (TERMINAL_WORKFLOW_STATUSES.has(statusName)) {
            isStuck = true
            logger.warn(
              `uipMarkStuckSessionsFailed: [${projectId}] workflow status=${statusName}, marking failed`,
            )
          }
        } catch (err) {
          if (err instanceof WorkflowNotFoundError) {
            isStuck = true
            logger.warn(
              `uipMarkStuckSessionsFailed: [${projectId}] workflow not found, marking failed`,
            )
          } else {
            throw err
          }
        }

        if (!isStuck) {
          continue
        }

        const marked = await markUipSessionFailedIfActive(this.prisma, projectId)
        logger.info(`uipMarkStuckSessionsFailed: [${projectId}] marked=${marked}`)
      } catch (err) {
        const error = ensureError(err)
        logger.warn(
          { projectId, err: error },
          'uipMarkStuckSessionsFailed: error processing session',
        )
      }
    }
  }
}
