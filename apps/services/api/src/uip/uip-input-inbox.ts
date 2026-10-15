import { randomUUID } from 'node:crypto'

import type { PrismaService } from '../prisma/prisma.service'

import { withSessionLock } from './uip-session-lock'
import { buildStatePatch } from './uip-state-patch'
import type { TimelineEvent, UipMessageRecord, UipSessionState } from './uip-timeline-types'

export type AppendInputMessageParams = {
  answerToMessageId?: string
  brandDraftEdits?: UipMessageRecord['brandDraftEdits']
  clientMessageId?: string
  createdAt: string
  message: string
  projectId: string
  sentFrom?: UipMessageRecord['sent_from']
  uploadedAssets?: Array<{
    asset_id: string
    content_type: string
    file_name: string
    file_path: string
  }>
}

export function scanPendingQuestions(events: TimelineEvent[]): {
  answeredInTimeline: Set<string>
  latestPendingQuestionId: null | string
} {
  const answeredInTimeline = new Set<string>()
  for (const e of events) {
    if (e.type === 'user_message' && e.answer_to_message_id != null) {
      answeredInTimeline.add(e.answer_to_message_id)
    }
  }
  let latestPendingQuestionId: null | string = null
  for (const e of events) {
    if (
      e.type === 'assistant_message' &&
      e.message_id != null &&
      e.options?.length &&
      !answeredInTimeline.has(e.message_id)
    ) {
      latestPendingQuestionId = e.message_id
    }
  }
  return { answeredInTimeline, latestPendingQuestionId }
}

/** Result of validating answerToMessageId inside the lock. Undefined when not provided. */
export type AnswerStatus =
  | 'accepted'
  | 'action_pending'
  | 'already_answered'
  | 'question_not_found'
  | 'queue_not_empty'

export type AppendInputMessageResult = {
  /** Undefined when answerToMessageId was not provided. */
  answerStatus?: AnswerStatus
  /** True if there is at least one unanswered assistant question in the timeline at lock time. */
  hasPendingQuestion: boolean
  /** Undefined when answerToMessageId was provided but not accepted (write abandoned). */
  record?: UipMessageRecord
}

/**
 * Upsert a message record into state.input_inbox with status 'sending'.
 * Idempotent by clientMessageId -- re-sends from the client are safe.
 *
 * Locks both state and timeline to atomically:
 *   - Compute pendingQuestionIds from the timeline
 *   - Validate answerToMessageId is in pendingQuestionIds and not already claimed by another inbox record
 *   - Return isAnswerAccepted and hasPendingQuestion for the caller's wake decision
 */
export async function appendInputMessage(
  prisma: PrismaService,
  params: AppendInputMessageParams,
): Promise<AppendInputMessageResult> {
  const {
    answerToMessageId,
    brandDraftEdits,
    clientMessageId,
    createdAt,
    message,
    projectId,
    sentFrom,
    uploadedAssets,
  } = params
  let record: UipMessageRecord | undefined
  let answerStatus: AnswerStatus | undefined
  let hasPendingQuestion = false

  await withSessionLock(
    prisma,
    projectId,
    { state: true, timeline: true },
    ({ state: current, timeline }) => {
      // Reset on each retry so a previous attempt's value does not leak through.
      record = undefined
      answerStatus = undefined
      hasPendingQuestion = false

      // Idempotency check -- must run before pending_action guard so that a
      // network retry with the same clientMessageId returns the existing record
      // even if pending_action was set after the original write succeeded.
      if (clientMessageId) {
        const existing = current.input_inbox?.records.find(
          (r) => r.client_message_id === clientMessageId,
        )
        if (existing) {
          record = existing
          answerStatus = existing.answer_to_message_id == null ? undefined : 'accepted'
          return { write: { state: 'abandon', timeline: 'abandon' }, changes: [] }
        }
      }

      // Block new messages while a confirm/continue/cancel action is being processed.
      if (current.pending_action) {
        answerStatus = 'action_pending'
        return { write: { state: 'abandon', timeline: 'abandon' }, changes: [] }
      }

      // Validate answer inside the lock
      if (answerToMessageId) {
        const existingRecords = current.input_inbox?.records ?? []

        // If inbox has any steering (non-answer) records, user has moved on -- reject answer.
        if (existingRecords.some((r) => r.answer_to_message_id == null)) {
          answerStatus = 'queue_not_empty'
          return { write: { state: 'abandon', timeline: 'abandon' }, changes: [] }
        }

        const { answeredInTimeline, latestPendingQuestionId } = scanPendingQuestions(
          timeline.events,
        )
        hasPendingQuestion = latestPendingQuestionId != null

        if (
          answeredInTimeline.has(answerToMessageId) ||
          existingRecords.some((r) => r.answer_to_message_id === answerToMessageId)
        ) {
          answerStatus = 'already_answered'
          return { write: { state: 'abandon', timeline: 'abandon' }, changes: [] }
        }
        // Only the latest unanswered question may be answered.
        if (answerToMessageId !== latestPendingQuestionId) {
          answerStatus = 'question_not_found'
          return { write: { state: 'abandon', timeline: 'abandon' }, changes: [] }
        }
        answerStatus = 'accepted'
      }

      record = {
        id: randomUUID(),
        status: 'sending',
        answer_to_message_id: answerStatus === 'accepted' ? answerToMessageId : undefined,
        brandDraftEdits,
        client_message_id: clientMessageId,
        message,
        sent_from: sentFrom,
        uploaded_assets: uploadedAssets,
        created_at: createdAt,
      }

      const existingRecords = current.input_inbox?.records ?? []
      const newState: UipSessionState = {
        ...current,
        input_inbox: {
          records: [...existingRecords, record],
        },
      }
      return {
        write: { state: newState, timeline: 'abandon' },
        changes: [{ kind: 'state', state: buildStatePatch(current, newState) }],
      }
    },
  )

  return { answerStatus, hasPendingQuestion, record }
}

/**
 * Remove a record from state.input_inbox.
 * Returns true if the record was found and removed, false if it was not in the inbox
 * (already materialized or never existed).
 */

export async function cancelInputMessage(
  prisma: PrismaService,
  projectId: string,
  recordId: string,
): Promise<boolean> {
  let removed = false

  await withSessionLock(prisma, projectId, { state: true }, ({ state: current }) => {
    const records = current.input_inbox?.records ?? []
    const index = records.findIndex((r) => r.id === recordId)
    if (index === -1) {
      return { write: { state: 'abandon' }, changes: [] }
    }
    // pending = already dispatched to the workflow; cannot unqueue
    if (records[index].status !== 'sending') {
      return { write: { state: 'abandon' }, changes: [] }
    }

    removed = true
    const newRecords = records.filter((r) => r.id !== recordId)
    const newState: UipSessionState = {
      ...current,
      input_inbox: { records: newRecords },
    }
    return {
      write: { state: newState },
      changes: [{ kind: 'state', state: buildStatePatch(current, newState) }],
    }
  })

  return removed
}
