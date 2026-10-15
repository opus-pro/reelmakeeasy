import { getReqContext } from '@reelmakeeasy/common/utils/req-ctx'
import { BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common'

import type { ProjectService } from '../projects/projects.service'

export function assertActiveSession(
  session: { phase?: null | string; status?: string },
  requiredPhase: null | string,
  operation: string,
): void {
  if (session.status !== 'active') {
    throw new BadRequestException(`Cannot ${operation}: session is ${session.status}.`)
  }
  if (requiredPhase && session.phase !== requiredPhase) {
    throw new BadRequestException(
      `Cannot ${operation}: session is in phase "${session.phase}", expected "${requiredPhase}".`,
    )
  }
}

export async function assertUipAccess(
  projectService: ProjectService,
  projectId: string,
  mode: 'read' | 'write',
): Promise<void> {
  const project = await projectService.getProject(projectId)
  if (!project) {
    throw new NotFoundException(`Project with ID ${projectId} not found`)
  }

  const reqOrgId = getReqContext().org_id
  if (mode === 'read' || (reqOrgId && reqOrgId === project.orgId)) {
    return
  }

  throw new UnauthorizedException('You are not authorized to access this project')
}
