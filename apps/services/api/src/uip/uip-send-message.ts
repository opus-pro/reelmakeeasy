/**
 * sendMessage logic for UIP sessions.
 *
 * Separated from uip.service.ts to keep that file under the max-lines limit.
 */
import { randomUUID } from 'node:crypto'

import { createSubLogger } from '@reelmakeeasy/common/logger'
import { toSavedAddressesInText } from '@reelmakeeasy/common/storage/address'
import type { UserMessageSignalPayload } from '@reelmakeeasy/uip-planner-runtime'
import {
  API_INBOX_WORKFLOW_PROTOCOL_SINCE,
  supportsWorkflowProtocolFeature,
} from '@reelmakeeasy/uip-planner-runtime'
import { BadRequestException, NotFoundException } from '@nestjs/common'
import { once } from 'lodash-es'

import type { PrismaService } from '../prisma/prisma.service'

import { TRANSCRIPT_EDITING_DEADLINE_EXTENSION_MS } from './uip-constants'
import { type AnswerStatus, appendInputMessage } from './uip-input-inbox'
import {
  appendTimelineEvents,
  type ReviewGateDeadlineField,
  writeReviewGateDeadlineByField,
} from './uip-timeline-lock-writers'
import type { TimelineEventInput, UipMessageRecord, UipSessionState } from './uip-timeline-types'

const logger = createSubLogger('uip-service')

export type SendMessageResult = {
  answerStatus?: AnswerStatus
  record?: UipMessageRecord
  timelineEvent?: TimelineEventInput
}

export async function sendMessageFn(
  projectId: string,
  message: string,
  uploadedAssets:
    | Array<{
        asset_id: string
        content_type: string
        file_name: string
        file_path: string
      }>
    | undefined,
  answerToMessageId: string | undefined,
  clientId: string | undefined,
  deps: {
    brandDraftEdits?: UserMessageSignalPayload['brandDraftEdits']
    prisma: PrismaService
    sentFrom?: UipMessageRecord['sent_from']
    signalWorkflow: (projectId: string, signal: string, payload?: unknown) => Promise<void>
  },
): Promise<SendMessageResult> {
  const { prisma, signalWorkflow } = deps
  // An upload's tag keeps the file's address, never a URL with a host or port: the
  // timeline serves it as a URL when it is sent out.
  message = toSavedAddressesInText(message)

  const session = await prisma.uipSession.findUnique({
    where: { projectId },
    select: { phase: true, state: true, status: true, timeline: true },
  })
  if (!session) {
    throw new NotFoundException(`UIP session not found: ${projectId}`)
  }
  if (session.status !== 'active') {
    throw new BadRequestException(`Cannot sendMessage: session is ${session.status}.`)
  }

  const sessionState = (session.state ?? {}) as UipSessionState
  const isNewProtocol = supportsWorkflowProtocolFeature(
    sessionState.workflow_protocol_version,
    API_INBOX_WORKFLOW_PROTOCOL_SINCE,
  )

  // When the session opted out of auto-continue, don't write a
  // review-gate deadline -- the workflow's foldDeadline stays null, so the
  // countdown would never fire (phantom timer).
  const deadlineField: null | ReviewGateDeadlineField =
    sessionState.auto_continue_enabled === false
      ? null
      : session.phase === 'script_review'
        ? 'review_auto_continue_deadline_at'
        : session.phase === 'refinement'
          ? 'auto_lock_deadline_at'
          : null

  const sentAt = new Date().toISOString()

  if (deadlineField) {
    const deadlineCandidate = new Date(
      Date.now() + TRANSCRIPT_EDITING_DEADLINE_EXTENSION_MS,
    ).toISOString()
    await writeReviewGateDeadlineByField(prisma, projectId, deadlineField, deadlineCandidate)
  }

  if (isNewProtocol) {
    const { answerStatus, record } = await appendInputMessage(prisma, {
      answerToMessageId,
      brandDraftEdits: deps.brandDraftEdits,
      clientMessageId: clientId,
      createdAt: sentAt,
      message,
      projectId,
      sentFrom: deps.sentFrom,
      uploadedAssets,
    })
    if (answerStatus && answerStatus !== 'accepted') {
      return { answerStatus }
    }
    if (!record) {
      return {}
    }
    logger.info(`[${projectId}] User message written to inbox (recordId=${record.id})`)
    await signalWorkflow(projectId, 'uip-wake')
    logger.info(`[${projectId}] Wake signal sent (recordId=${record.id})`)
    return { answerStatus, record }
  }

  // Old protocol path: write timeline + signal the workflow.
  const messageId = randomUUID()
  const payload: UserMessageSignalPayload = {
    answerToMessageId,
    brandDraftEdits: deps.brandDraftEdits,
    message,
    messageId,
    sentAt,
    uploadedAssets: uploadedAssets as UserMessageSignalPayload['uploadedAssets'],
  }

  const timelineEvent: TimelineEventInput = {
    type: 'user_message',
    ts: sentAt,
    uts: sentAt,
    message_id: messageId,
    answer_to_message_id: answerToMessageId,
    message,
    uploaded_assets: uploadedAssets,
    status: 'pending',
  }

  const writeMessage = once(async () => {
    await appendTimelineEvents(prisma, projectId, (current) => {
      const existed = current.events.find(
        (event) => event.type === 'user_message' && event.message_id === messageId,
      )
      if (existed) {
        return 'abandon'
      }
      return {
        appendForFile: [timelineEvent],
        appendForSse: [
          clientId
            ? ({ ...timelineEvent, client_id: clientId } satisfies TimelineEventInput)
            : timelineEvent,
        ],
      }
    })
  })

  if (!answerToMessageId) {
    await writeMessage()
  }

  await signalWorkflow(projectId, 'uip-user-message', payload)
  logger.info(`[${projectId}] User message signal sent (messageId=${messageId})`)

  // Write after signal for answers: the workflow must receive the message before we persist it
  // so the frontend can answer again even if a DB write fails.
  if (answerToMessageId) {
    await writeMessage()
  }

  return { timelineEvent }
}
