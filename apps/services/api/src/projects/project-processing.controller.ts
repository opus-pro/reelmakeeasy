import { getReqContext } from '@reelmakeeasy/common/utils/req-ctx'
import { Body, Controller, Param, Post } from '@nestjs/common'

import { ProjectService } from './projects.service'

/**
 * Project background-job routes. Separate from the legacy singular
 * `@Controller('project')` because the house standard mandates plural
 * collections for new routes (AGENTS.md, "Plural collections, always").
 */
@Controller('projects')
export class ProjectProcessingController {
  constructor(private readonly projectService: ProjectService) {}

  @Post(':id/acknowledge-editor-warning')
  async acknowledgeEditorWarning(
    @Param('id') id: string,
    @Body() body: { copyVersion: string },
  ): Promise<{ editorWarningAcknowledgedAt: string; editorWarningCopyVersion: string }> {
    return this.projectService.acknowledgeEditorWarning(id, body.copyVersion)
  }

  /**
   * Acknowledge finished background jobs (the card status pill's
   * done state), fired when the user opens the project. Named operation, not
   * mark-seen: that pipeline stamps lastSeenAt on list render.
   */
  @Post(':id/processing-seen')
  async markProcessingSeen(@Param('id') id: string): Promise<{ processingSeenAt: string }> {
    return this.projectService.markProcessingSeen(id, getReqContext().org_id)
  }
}
