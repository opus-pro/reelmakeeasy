import { Injectable } from '@nestjs/common'
import { PaginatedResponse } from '@shared/types/api/common/pagination'
import { FeedbackContentExt } from '@shared/types/chat/embedded-block-shared'
import { FeedbackRequestBody } from '@shared/types/chat/feedback'
import { AgentStreamMessage, ChatBoxMessage, RawChatBoxMessage } from '@shared/types/chat/message'
import { EmbeddedAttachmentBlock } from '@shared/types/chat/message-embedded-block'

import { PrismaService } from '../prisma/prisma.service'
import { parsePaginationConfig, toPaginationConfig } from '../util/pagination'

@Injectable()
export class HistoryService {
  constructor(private readonly prisma: PrismaService) {}

  async addMessage(projectId: string, message: RawChatBoxMessage) {
    return await this.prisma.history.create({
      data: {
        projectId,
        raw: JSON.stringify((message as unknown as AgentStreamMessage).raw || {}),
        role: message.role,
        text: (message as unknown as AgentStreamMessage).text || null,
        toolName: (message as unknown as AgentStreamMessage).toolName || null,
        type: (message as unknown as AgentStreamMessage).type,
        content: (message as unknown as EmbeddedAttachmentBlock).content || null,
        from: (message as unknown as EmbeddedAttachmentBlock).from === 'user' ? 'user' : 'backend',
        agentName: (message as unknown as AgentStreamMessage).agentName || null,
      },
    })
  }

  async getHistory(projectId: string, pageSize = 50, page = 0): Promise<ChatBoxMessage[]> {
    const entries = await this.prisma.history.findMany({
      orderBy: { createdAt: 'asc' },
      skip: page * pageSize,
      take: pageSize,
      where: { projectId },
    })

    return entries as unknown as ChatBoxMessage[]
  }

  async getHistoryPaginated(
    projectId: string,
    pageSize = 50,
    page = 0,
  ): Promise<PaginatedResponse<ChatBoxMessage>> {
    const maxPageSize = 1000
    const { skip, take } = parsePaginationConfig({ page, pageSize, maxPageSize })
    const data = await this.prisma.history.findMany({
      orderBy: { createdAt: 'asc' },
      where: { projectId },
      skip,
      take,
    })

    const total = await this.prisma.history.count({
      where: { projectId },
    })

    return {
      data: data as unknown as ChatBoxMessage[],
      pagination: toPaginationConfig({ skip, take, total }),
    }
  }

  async getMessageById(id: string) {
    return await this.prisma.history.findFirst({
      where: { id },
    })
  }

  async updateFeedback({
    projectId,
    msgId,
    feedback,
    orgId,
  }: {
    feedback: FeedbackRequestBody
    msgId: string
    orgId: string
    projectId: string
  }) {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } })
    if (!project) {
      throw new Error('Project not found')
    }

    const isOwner = project.orgId === orgId
    if (!isOwner) {
      throw new Error('You are not the owner of this project')
    }

    const msg = await this.prisma.history.findFirst({
      where: { projectId, id: msgId },
    })
    if (!msg) {
      throw new Error('Message not found')
    }

    const content = {
      ...(msg.content as FeedbackContentExt),
      feedback: {
        ...(msg.content as FeedbackContentExt)?.feedback,
        ...feedback,
        updatedAt: new Date().toISOString(),
      },
    }

    return await this.prisma.history.update({
      where: { id: msgId, projectId },
      data: { content },
    })
  }
}
