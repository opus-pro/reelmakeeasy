import { Logger } from '@reelmakeeasy/common/logger'
import { createClient } from '@reelmakeeasy/common/workflow/client'
import { WorkflowNotFoundError } from '@reelmakeeasy/workflow-engine/common'
import { BadRequestException, UnauthorizedException } from '@nestjs/common'

import type { ProjectService } from '../projects/projects.service'

const CANCELLABLE_WORKFLOW_TYPES = new Set([
  'GenerateAssetWorkflow',
  'LongTakeEditRenderWorkflow',
  'RegenerateTransitionKeyframeWorkflow',
  'RegenerateTransitionWorkflow',
])

export async function cancelProjectWorkflow(
  deps: {
    logger: Logger
    projectsService: ProjectService
  },
  projectId: string,
  workflowId: string,
): Promise<{ workflowId: string }> {
  const canVisit = await deps.projectsService.canVisitProject(projectId)
  if (!canVisit) {
    throw new UnauthorizedException('You are not authorized to access this project')
  }
  // Anchor on `ao:<projectId>:` prefix; substring match would let a project
  // `foo` user cancel `ao:foobar123:...` workflows.
  if (!workflowId.startsWith(`ao:${projectId}:`)) {
    throw new BadRequestException('workflowId does not belong to this project')
  }
  deps.logger.log(`Cancelling workflow: ${workflowId}`)
  const client = await createClient()
  const handle = client.workflow.getHandle(workflowId)
  try {
    const description = await handle.describe()
    if (!CANCELLABLE_WORKFLOW_TYPES.has(description.type)) {
      throw new BadRequestException(`Unsupported workflow type: ${description.type}`)
    }
    if (description.status.name !== 'RUNNING') {
      deps.logger.log(
        `Workflow ${workflowId} already in terminal state ${description.status.name}; skipping terminate`,
      )
      return { workflowId }
    }
    await handle.terminate('User cancelled operation')
    deps.logger.log(`Workflow ${workflowId} terminated successfully`)
  } catch (error) {
    if (error instanceof WorkflowNotFoundError) {
      deps.logger.warn(`Workflow ${workflowId} already finished or not found`)
    } else {
      throw error
    }
  }
  return { workflowId }
}
