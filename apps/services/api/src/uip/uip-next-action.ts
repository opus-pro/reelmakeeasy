import { randomUUID } from 'node:crypto'

import type { PrismaService } from '../prisma/prisma.service'

import { withSessionLock } from './uip-session-lock'
import { buildStatePatch } from './uip-state-patch'
import type {
  ActionEvent,
  NextActionDecision,
  NextActionMessage,
  NextActionRecord,
  UipMessageRecord,
  UipSessionState,
} from './uip-timeline-types'

export type SelectNextActionResult = {
  actionId: null | string
  decision: NextActionDecision
  /**
   * Source of the pending action being dispatched: 'deadline' for the
   * auto-confirm/auto-continue timer, null for a user-initiated intent. Lets the
   * caller derive confirmType (Auto vs User_Click) for tracking.
   */
  pendingActionSource: 'deadline' | null
}

/**
 * Atomically select the next action from state and persist it to nextAction for idempotency.
 * Priority: cancel > confirm > continue > first inbox record > idle.
 *
 * Idempotent retry behavior:
 * - If nextAction already has an unclaimed record: signal may not have reached the workflow,
 *   re-use the same decision (the workflow is idempotent, duplicate signals are safe).
 * - Otherwise pick a new action and write it to nextAction.
 *
 * For pending_action (cancel/confirm/continue): clears pending_action and resolves
 * pending timeline action events atomically in one lock.
 * For inbox: CAS status 'sending' -> 'pending' to prevent duplicate signals.
 */
export async function selectNextAction(
  prisma: PrismaService,
  projectId: string,
): Promise<SelectNextActionResult> {
  let decision: NextActionDecision = { action: 'idle' }
  let actionId: null | string = null
  let pendingActionSource: 'deadline' | null = null

  await withSessionLock(
    prisma,
    projectId,
    { state: true, timeline: true, nextAction: true },
    ({ state: current, timeline, nextAction: existingAction }) => {
      // Reset on each retry so a previous attempt's value does not leak through.
      decision = { action: 'idle' }
      actionId = null
      // Captured before resolveActionEvents (which nulls it) so the caller can
      // attribute Auto vs User_Click for tracking.
      pendingActionSource = current.pending_action_source ?? null

      // Existing nextAction: signal may not have reached the workflow yet.
      // If it's user_messages and new 'sending' records arrived since the last dispatch
      // (e.g. user sent "try again" while the failed activity was running), merge them in
      // so they're processed together rather than in a separate turn.
      if (existingAction) {
        if (existingAction.decision.action === 'user_messages') {
          const records = current.input_inbox?.records ?? []
          const newSending = records.filter((r) => r.status === 'sending')
          if (newSending.length > 0) {
            const result = buildUserMessagesAction(
              current,
              records,
              newSending,
              existingAction.decision.messages,
            )
            decision = result.decision
            actionId = result.actionId
            return {
              write: {
                nextAction: result.actionRecord,
                state: result.newState,
                timeline: 'abandon',
              },
              changes: [{ kind: 'state', state: buildStatePatch(current, result.newState) }],
            }
          }
        }
        decision = existingAction.decision
        actionId = existingAction.id
        return {
          write: { nextAction: 'abandon', state: 'abandon', timeline: 'abandon' },
          changes: [],
        }
      }

      // No existing nextAction -- pick a new action.
      const pendingAction = current.pending_action
      if (
        pendingAction === 'cancel' ||
        pendingAction === 'confirm' ||
        pendingAction === 'confirm_fast' ||
        pendingAction === 'continue'
      ) {
        decision = { action: pendingAction }
        actionId = randomUUID()

        // User endpoint only set pending_action (no timeline event written yet).
        // Write the action event as 'pending' here; resolveActionEvents marks it 'accepted'
        // at the end of triggerNextAction after signals succeed.
        // Do NOT clear pending_action -- leave it for resolveActionEvents to clear.
        const ts = new Date().toISOString()
        const newEventId = timeline.next_event_id
        const newEvent: ActionEvent = {
          id: newEventId,
          type: 'action',
          action: pendingAction,
          status: 'pending',
          ts,
        }
        const actionRecord: NextActionRecord = {
          id: actionId,
          decision,
          created_at: ts,
        }
        return {
          write: {
            nextAction: actionRecord,
            timeline: {
              ...timeline,
              events: [...timeline.events, newEvent],
              next_event_id: newEventId + 1,
            },
            state: 'abandon',
          },
          changes: [{ kind: 'timeline' as const, append: [newEvent], update: [] }],
        }
      }

      const records = current.input_inbox?.records ?? []
      const sending = records.filter((r) => r.status === 'sending')
      if (sending.length > 0) {
        const result = buildUserMessagesAction(current, records, sending, [])
        decision = result.decision
        actionId = result.actionId
        return {
          write: { nextAction: result.actionRecord, state: result.newState, timeline: 'abandon' },
          changes: [{ kind: 'state', state: buildStatePatch(current, result.newState) }],
        }
      }

      return {
        write: { nextAction: 'abandon', state: 'abandon', timeline: 'abandon' },
        changes: [],
      }
    },
  )

  return { decision, actionId, pendingActionSource }
}

function buildUserMessagesAction(
  current: UipSessionState,
  allRecords: readonly UipMessageRecord[],
  newSending: readonly UipMessageRecord[],
  prependMessages: readonly NextActionMessage[],
): {
  actionId: string
  actionRecord: NextActionRecord
  decision: NextActionDecision
  newState: UipSessionState
} {
  const dispatchedAt = new Date().toISOString()
  const sendingIds = new Set(newSending.map((r) => r.id))
  const appendedMessages: NextActionMessage[] = newSending.map((r) => ({
    answer_to_message_id: r.answer_to_message_id,
    brandDraftEdits: r.brandDraftEdits,
    client_message_id: r.client_message_id,
    message: r.message,
    record_id: r.id,
    sent_at: r.created_at,
    sent_from: r.sent_from,
    uploaded_assets: r.uploaded_assets as NextActionMessage['uploaded_assets'],
  }))
  const messages = [...prependMessages, ...appendedMessages]
  const actionId = randomUUID()
  const decision: NextActionDecision = { action: 'user_messages', messages }
  const newRecords = allRecords.map((r) =>
    sendingIds.has(r.id) ? { ...r, status: 'pending' as const, dispatch_at: dispatchedAt } : r,
  )
  const newState: UipSessionState = { ...current, input_inbox: { records: newRecords } }
  const actionRecord: NextActionRecord = { id: actionId, decision, created_at: dispatchedAt }
  return { actionId, actionRecord, decision, newState }
}

/**
 * Remove the nextAction record once the workflow starts processing the signal.
 * Returns true if the record was found and removed; false if not found or already removed.
 */
export async function claimNextAction(
  prisma: PrismaService,
  projectId: string,
  actionId: string,
): Promise<boolean> {
  let claimed = false

  await withSessionLock(prisma, projectId, { nextAction: true }, ({ nextAction }) => {
    // Reset on each retry so a previous attempt's value does not leak through.
    claimed = false

    if (!nextAction || nextAction.id !== actionId) {
      return { write: { nextAction: 'abandon' }, changes: [] }
    }
    claimed = true
    return { write: { nextAction: null }, changes: [] }
  })

  return claimed
}
