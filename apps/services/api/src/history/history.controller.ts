import { getReqContext } from '@reelmakeeasy/common/utils/req-ctx'
import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Put,
  Query,
  UnauthorizedException,
} from '@nestjs/common'
import { PaginatedResponse } from '@shared/types/api/common/pagination'
import { FeedbackRequestBody, FeedbackRequestBodySchema } from '@shared/types/chat/feedback'
import { ChatBoxMessage } from '@shared/types/chat/message'

import { ProjectService } from '../projects/projects.service'

import { HistoryService } from './history.service'

@Controller('history')
export class HistoryController {
  constructor(
    private readonly historyService: HistoryService,
    private readonly projectService: ProjectService,
  ) {}

  @Get('/:projectId')
  async getHistory(
    @Param('projectId') projectId: string,
    @Query('pageSize') pageSize: string,
    @Query('page') page: string,
    @Headers('x-reelmakeeasy-shared-id') headerShareId?: string,
  ): Promise<PaginatedResponse<ChatBoxMessage>> {
    const canVisit = await this.projectService.canVisitProject(projectId, headerShareId)
    if (!canVisit) {
      throw new UnauthorizedException('You are not authorized to access this project')
    }

    return this.historyService.getHistoryPaginated(
      projectId,
      Number.parseInt(pageSize),
      Number.parseInt(page),
    )
  }

  @Put('/:projectId/feedback')
  async updateFeedback(
    @Param('projectId') projectId: string,
    @Query('msgId') msgId: string,
    @Body() feedback: FeedbackRequestBody,
  ) {
    const parsedFeedback = FeedbackRequestBodySchema.parse(feedback)
    return this.historyService.updateFeedback({
      projectId,
      msgId,
      feedback: parsedFeedback,
      orgId: getReqContext().org_id,
    })
  }
}
