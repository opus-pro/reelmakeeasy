import { PROJECT_STAGE } from '@shared/types/enums/project'

import type { PrismaService } from '../prisma/prisma.service'

/**
 * Marks a UIP session as failed and, if the project is still in UIP_PLANNING,
 * marks the project as FAILED too. Only acts if the session is currently active.
 *
 * Returns true if the session was transitioned, false if it was already in a
 * non-active state (i.e. no update was needed).
 */
export async function markUipSessionFailedIfActive(
  prisma: PrismaService,
  projectId: string,
): Promise<boolean> {
  const [sessionResult] = await prisma.$transaction([
    prisma.uipSession.updateMany({
      where: { projectId, status: 'active' },
      data: { status: 'failed' },
    }),
    prisma.project.updateMany({
      where: { id: projectId, stage: PROJECT_STAGE.UIP_PLANNING },
      data: { stage: PROJECT_STAGE.FAILED },
    }),
  ])

  return sessionResult.count > 0
}
