import type { PrismaService } from '../prisma/prisma.service'

import { OPERATE_AT_DEADLINE_EXTENSION_MS, OPERATE_AT_STALE_MS } from './uip-constants'
import { buildSessionChangedEventDiff } from './uip-session-changed-diff'
import { SessionLockArg, withSessionLock } from './uip-session-lock'
import { maxIsoTimestamp } from './uip-session-utils'
import { buildStatePatch } from './uip-state-patch'
import { mergeTranscriptEventsIntoTimeline, type UipTranscriptMessage } from './uip-timeline-merge'
import { overlaySessionChangedEvents } from './uip-timeline-transformers'
import type {
  ActionEvent,
  NextActionRecord,
  SessionChangedEventInput,
  SessionLockOutput,
  StateChanges,
  TimelineEvent,
  TimelineEventInput,
  TimelineEventPatch,
  TimelineFile,
  UipMessageRecord,
  UipSessionState,
  UserMessageEvent,
} from './uip-timeline-types'

export type ReviewGateDeadlineField = 'auto_lock_deadline_at' | 'review_auto_continue_deadline_at'

type AppendPlan =
  | 'abandon'
  | null
  | {
      appendForFile: TimelineEventInput[]
      appendForSse?: TimelineEventInput[]
    }

export async function appendTimelineEvents(
  prisma: PrismaService,
  project: SessionLockArg<'timeline'>,
  build: (current: TimelineFile) => AppendPlan,
): Promise<void> {
  await withSessionLock(prisma, project, { timeline: true }, async ({ timeline: current }) => {
    const plan = build(current)
    if (plan === 'abandon') {
      return { write: { timeline: 'abandon' }, changes: [] }
    }
    if (!plan || !plan.appendForFile.length) {
      return toTimelineNoop()
    }

    const appendForSse = plan.appendForSse ?? plan.appendForFile
    if (appendForSse.length !== plan.appendForFile.length) {
      throw new Error('appendForSse length must match appendForFile length')
    }

    let nextId = current.next_event_id
    const appendedForFile: TimelineEvent[] = []
    const appendedForSse: TimelineEvent[] = []
    for (let index = 0; index < plan.appendForFile.length; index++) {
      const id = nextId++
      appendedForFile.push({ ...plan.appendForFile[index], id } as TimelineEvent)
      appendedForSse.push({ ...appendForSse[index], id } as TimelineEvent)
    }

    return {
      write: {
        timeline: {
          next_event_id: nextId,
          events: [...current.events, ...appendedForFile],
        },
      },
      changes: [{ kind: 'timeline', append: appendedForSse, update: [] }],
    }
  })
}
export function buildAudioSourceState(
  current: UipSessionState,
  audioSource: 'user_audio' | null,
): UipSessionState {
  if (current.audio_source === audioSource) {
    return current
  }
  return {
    ...current,
    audio_source: audioSource,
  }
}

/**
 * Build user_message timeline events from inbox records that match transcript
 * user messages. Must run BEFORE mergeTranscriptEventsIntoTimeline so the merge
 * treats them as existing events (update path) rather than creating duplicates.
 * Events carry full inbox fidelity: client_id, uts, uploaded_assets.
 */
export function buildMergeTranscriptAndSessionChangedTimeline(
  prevTimeline: TimelineFile,
  input: {
    nextState: SessionChangedEventInput
    transcript: UipTranscriptMessage[]
    ts: string
  },
  currentState: UipSessionState,
): SessionLockOutput<'state' | 'timeline'> {
  const prevState = overlaySessionChangedEvents({}, prevTimeline.events)

  const inboxRecords = currentState.input_inbox?.records ?? []

  let currentTimeline = prevTimeline

  const {
    consumedIds,
    events: inboxEvents,
    nextId: nextIdAfterInbox,
  } = buildInboxEventsFromTranscript(inboxRecords, input.transcript, currentTimeline.next_event_id)

  // Augment current events with inbox events so mergeTranscriptEventsIntoTimeline
  // sees them as existing and only generates update patches, never duplicates.
  if (consumedIds.size > 0) {
    currentTimeline = {
      ...currentTimeline,
      events: [...currentTimeline.events, ...inboxEvents],
      next_event_id: nextIdAfterInbox,
    }
  }

  const merged = mergeTranscriptEventsIntoTimeline({
    current: currentTimeline.events,
    nextEventId: currentTimeline.next_event_id,
    transcript: input.transcript,
  })
  const { appendItems, mergedEvents, updateItems } = merged
  let { nextId } = merged

  const sessionChangedEvent = buildSessionChangedEventDiff(prevState, input.nextState, input.ts)

  if (sessionChangedEvent) {
    const sessionChangedWithId = { ...sessionChangedEvent, id: nextId++ }
    appendItems.push(sessionChangedWithId)
    mergedEvents.push(sessionChangedWithId)
  }

  const stateChanged = consumedIds.size > 0
  const timelineChanged = consumedIds.size > 0 || appendItems.length > 0 || updateItems.length > 0

  if (!stateChanged && !timelineChanged) {
    return { write: { state: 'abandon', timeline: 'abandon' }, changes: [] }
  }

  let newState = currentState
  if (consumedIds.size > 0) {
    newState = {
      ...newState,
      input_inbox: { records: inboxRecords.filter((r) => !consumedIds.has(r.id)) },
    }
  }

  const changes: SessionLockOutput<'state' | 'timeline'>['changes'] = []
  if (timelineChanged) {
    // Inbox events go to append (not update) so clients see the full event on first delivery.
    changes.push({
      kind: 'timeline',
      append: [...inboxEvents, ...appendItems],
      update: updateItems,
    })
  }
  if (stateChanged) {
    changes.push({ kind: 'state', state: buildStatePatch(currentState, newState) })
  }

  return {
    write: {
      state: stateChanged ? newState : 'abandon',
      timeline: timelineChanged ? { next_event_id: nextId, events: mergedEvents } : 'abandon',
    },
    changes,
  }
}

export function buildOperateAtState(
  current: UipSessionState,
  clientId: string,
  staleMs: number,
  deadlineExtensionMs: number,
  nowMs = Date.now(),
): UipSessionState {
  const pruned = Object.fromEntries(
    Object.entries(current.operate_at ?? {}).filter(([, timestamp]) => {
      const tsMs = new Date(timestamp).getTime()
      return Number.isFinite(tsMs) && nowMs - tsMs < staleMs
    }),
  )
  pruned[clientId] = new Date(nowMs).toISOString()
  // When the session opted out of auto-continue, record the operate_at
  // heartbeat but never re-arm a review-gate deadline -- the workflow's
  // foldDeadline stays null, so a written deadline is a phantom countdown.
  if (current.auto_continue_enabled === false) {
    return { ...current, operate_at: pruned }
  }
  const currentReviewGate = current.review_gate ?? {}
  const deadlineCandidate = new Date(nowMs + deadlineExtensionMs).toISOString()
  return {
    ...current,
    operate_at: pruned,
    review_gate: {
      ...currentReviewGate,
      review_auto_continue_deadline_at: deadlineCandidate,
      auto_lock_deadline_at: deadlineCandidate,
    },
  }
}

export function buildReviewGateState(
  current: UipSessionState,
  token: string,
  reviewAutoContinueDeadlineAt?: null | string,
): UipSessionState {
  const reviewGate = {
    ...current.review_gate,
    token,
    ...(reviewAutoContinueDeadlineAt === undefined
      ? {}
      : { review_auto_continue_deadline_at: reviewAutoContinueDeadlineAt }),
  }
  return { ...current, review_gate: reviewGate }
}

export async function mergeTranscriptAndSessionChanged(
  prisma: PrismaService,
  projectId: string,
  input: {
    nextState: SessionChangedEventInput
    transcript: UipTranscriptMessage[]
    ts: string
  },
): Promise<void> {
  await withSessionLock(
    prisma,
    projectId,
    { state: true, timeline: true },
    ({ state, timeline }) => {
      return buildMergeTranscriptAndSessionChangedTimeline(timeline, input, state)
    },
  )
}

export async function updateTimelineEvents(
  prisma: PrismaService,
  projectId: string,
  build: (current: TimelineFile) => null | TimelineEventPatch[],
): Promise<void> {
  await withSessionLock(prisma, projectId, { timeline: true }, async ({ timeline: current }) => {
    const updateItems = build(current)
    if (!updateItems?.length) {
      return toTimelineNoop()
    }
    return {
      write: {
        timeline: {
          next_event_id: current.next_event_id,
          events: current.events,
        },
      },
      changes: [{ kind: 'timeline', append: [], update: updateItems }],
    }
  })
}

export async function writeAudioSourceState(
  prisma: PrismaService,
  project: SessionLockArg<'state'>,
  audioSource: 'user_audio' | null,
): Promise<void> {
  await withSessionLock(prisma, project, { state: true }, async ({ state: current }) => {
    const newState = buildAudioSourceState(current, audioSource)
    if (newState === current) {
      return { write: { state: 'abandon' }, changes: [] }
    }
    return {
      write: { state: newState },
      changes: [{ kind: 'state', state: buildStatePatch(current, newState) }],
    }
  })
}

export async function writeOperateAtHeartbeat(
  prisma: PrismaService,
  project: SessionLockArg<'state'>,
  clientId: string,
): Promise<null | StateChanges> {
  const lockResult = await withSessionLock(
    prisma,
    project,
    { state: true },
    async ({ state: current }) => {
      const newState = buildOperateAtState(
        current,
        clientId,
        OPERATE_AT_STALE_MS,
        OPERATE_AT_DEADLINE_EXTENSION_MS,
      )
      return {
        write: { state: newState },
        changes: [{ kind: 'state', state: buildStatePatch(current, newState) }],
      }
    },
  )

  if (!lockResult?.state) {
    return null
  }
  return {
    state: lockResult.state.value,
    version: lockResult.state.version,
  }
}

export async function writeReviewGateDeadlineByField(
  prisma: PrismaService,
  project: SessionLockArg<'state'>,
  deadlineField: ReviewGateDeadlineField,
  deadlineCandidate: string,
): Promise<void> {
  await withSessionLock(prisma, project, { state: true }, async ({ state }) => {
    const currentReviewGate = state.review_gate ?? {}
    const currentDeadline = currentReviewGate[deadlineField] ?? null
    const nextDeadline = maxIsoTimestamp(currentDeadline, deadlineCandidate)
    const newState: UipSessionState = {
      ...state,
      review_gate: {
        ...currentReviewGate,
        ...(nextDeadline ? { [deadlineField]: nextDeadline } : {}),
      },
    }
    return {
      write: { state: newState },
      changes: [{ kind: 'state', state: buildStatePatch(state, newState) }],
    }
  })
}

export async function writeReviewGateToken(
  prisma: PrismaService,
  project: SessionLockArg<'state'>,
  token: string,
  reviewAutoContinueDeadlineAt?: null | string,
): Promise<void> {
  await withSessionLock(prisma, project, { state: true }, async ({ state: current }) => {
    const newState = buildReviewGateState(current, token, reviewAutoContinueDeadlineAt)
    return {
      write: { state: newState },
      changes: [{ kind: 'state', state: buildStatePatch(current, newState) }],
    }
  })
}

function buildInboxEventsFromTranscript(
  inboxRecords: UipMessageRecord[],
  transcript: UipTranscriptMessage[],
  startId: number,
): { consumedIds: Set<string>; events: UserMessageEvent[]; nextId: number } {
  if (!inboxRecords.length) {
    return { consumedIds: new Set(), events: [], nextId: startId }
  }

  const inboxById = new Map(inboxRecords.map((r) => [r.id, r]))
  const events: UserMessageEvent[] = []
  const consumedIds = new Set<string>()
  let nextId = startId

  for (const msg of transcript) {
    if (msg.role !== 'user' || !msg.message_id) {
      continue
    }
    const record = inboxById.get(msg.message_id)
    if (!record) {
      continue
    }
    inboxById.delete(msg.message_id)
    events.push({
      id: nextId++,
      type: 'user_message',
      ts: msg.timestamp,
      uts: record.created_at,
      message_id: record.id,
      message: record.message,
      uploaded_assets: record.uploaded_assets as UserMessageEvent['uploaded_assets'],
      // The inbox record holds the compose-time modal snapshot; the transcript copy
      // covers records whose snapshot only survives on the workflow side.
      sent_from: record.sent_from ?? msg.sent_from,
      status: 'handled',
      exec_id: msg.exec_id,
      answer_to_message_id: record.answer_to_message_id,
      attempt: msg.attempt,
      ...(record.client_message_id ? { client_id: record.client_message_id } : {}),
    })
    consumedIds.add(record.id)
  }

  return { consumedIds, events, nextId }
}

/**
 * Evaluate the common state-machine guards shared by setPendingActionIntent and appendActionEvent.
 * Returns 'accepted' when all guards pass; 'duplicated' or 'rejected' otherwise.
 */
export function evaluateActionIntentGuards(
  state: UipSessionState,
  nextAction: NextActionRecord | null | undefined,
  action: 'cancel' | 'confirm' | 'confirm_fast' | 'continue',
): 'accepted' | 'duplicated' | 'rejected' {
  // Guard: pending_action state machine check.
  // Same action already pending -> duplicated (idempotent re-submit).
  // Different action pending -> rejected (conflicting state transition).
  if (state.pending_action) {
    return state.pending_action === action ? 'duplicated' : 'rejected'
  }
  // Guard: inbox has unprocessed messages -> reject to avoid racing with
  // a planner turn that is about to consume those messages.
  if (state.input_inbox?.records?.length) {
    return 'rejected'
  }
  // Guard: nextAction already dispatched.
  // Same action -> duplicated (idempotent re-submit, signal still in-flight).
  // Different action -> rejected (conflicting state transition).
  if (nextAction) {
    return nextAction.decision.action === action ? 'duplicated' : 'rejected'
  }
  return 'accepted'
}

/**
 * Set state.pending_action to signal intent for a confirm/continue/cancel action.
 * Used by the new-protocol user-facing endpoints instead of appendActionEvent.
 * The timeline event is written later by selectNextAction inside triggerNextAction.
 *
 * Also rejects any stale 'pending' action events from aborted previous cycles to
 * maintain the invariant: pending_action=null <-> no pending action events in timeline.
 */
export async function setPendingActionIntent(
  prisma: PrismaService,
  projectId: string,
  action: 'cancel' | 'confirm' | 'confirm_fast' | 'continue',
): Promise<'accepted' | 'duplicated' | 'rejected'> {
  let result: 'accepted' | 'duplicated' | 'rejected' = 'duplicated'

  await withSessionLock(
    prisma,
    projectId,
    { state: true, nextAction: true, timeline: true },
    ({ state: current, nextAction, timeline }) => {
      // Reset on each retry so a previous attempt's value does not leak through.
      result = 'duplicated'

      const guard = evaluateActionIntentGuards(current, nextAction, action)
      if (guard !== 'accepted') {
        result = guard
        return {
          write: { state: 'abandon', nextAction: 'abandon', timeline: 'abandon' },
          changes: [],
        }
      }

      result = 'accepted'
      const newState: UipSessionState = { ...current, pending_action: action }

      // Reject any stale 'pending' action events left from an aborted previous cycle.
      // In steady state the invariant (pending_action=null <-> no pending events) holds,
      // but this guards against inconsistent state from partial failures.
      const staleItems: TimelineEventPatch[] = []
      const updatedEvents = timeline.events.map((event): TimelineEvent => {
        if (event.type === 'action' && event.status === 'pending') {
          staleItems.push({ id: event.id, status: 'rejected' })
          return { ...event, status: 'rejected' }
        }
        return event
      })

      return {
        write: {
          state: newState,
          nextAction: 'abandon',
          timeline: staleItems.length ? { ...timeline, events: updatedEvents } : 'abandon',
        },
        changes: [
          { kind: 'state' as const, state: buildStatePatch(current, newState) },
          ...(staleItems.length
            ? [{ kind: 'timeline' as const, append: [] as never[], update: staleItems }]
            : []),
        ],
      }
    },
  )

  return result
}

/**
 * Write an ActionEvent to the timeline and, if status='pending', set
 * uipSession.state.pending_action to track the optimistic update.
 * client_id is included in the SSE push but stripped from the storage file.
 */
export async function appendActionEvent(
  prisma: PrismaService,
  projectId: string,
  action: 'cancel' | 'confirm' | 'continue',
  clientId?: string,
): Promise<'accepted' | 'duplicated' | 'rejected'> {
  let result: 'accepted' | 'duplicated' | 'rejected' = 'duplicated'

  const ts = new Date().toISOString()

  await withSessionLock(
    prisma,
    projectId,
    { timeline: true, state: true, nextAction: true },
    async ({ timeline, state, nextAction }) => {
      // Reset on each retry so a previous attempt's value does not leak through.
      result = 'duplicated'

      const guard = evaluateActionIntentGuards(state, nextAction, action)
      if (guard !== 'accepted') {
        result = guard
        return {
          write: { timeline: 'abandon', state: 'abandon', nextAction: 'abandon' },
          changes: [],
        }
      }

      // Scan from the end to guard against concurrent duplicate writes.
      for (let i = timeline.events.length - 1; i >= 0; i--) {
        const e = timeline.events[i]
        if (e.type === 'action' && e.action === action && e.status === 'pending') {
          result = 'duplicated'
          return {
            write: { timeline: 'abandon', state: 'abandon', nextAction: 'abandon' },
            changes: [],
          }
        }
      }

      result = 'accepted'

      const eventId = timeline.next_event_id

      // Strip client_id for storage file; include in SSE push.
      const eventForFile: ActionEvent = {
        type: 'action',
        ts,
        id: eventId,
        action,
        status: 'pending',
      }
      const eventForSse: ActionEvent = clientId
        ? { ...eventForFile, client_id: clientId }
        : eventForFile

      const newState: UipSessionState = { ...state, pending_action: action }

      return {
        write: {
          timeline: {
            next_event_id: eventId + 1,
            events: [...timeline.events, eventForFile],
          },
          state: newState,
          nextAction: 'abandon',
        },
        changes: [
          { kind: 'timeline', append: [eventForSse], update: [] },
          { kind: 'state', state: buildStatePatch(state, newState) },
        ],
      }
    },
  )

  return result
}

/**
 * Resolve all pending ActionEvents in the timeline.
 * resolvedActions is the SOT array - actions that actually happened (accepted).
 * - Pending events whose action is in resolvedActions -> 'accepted'
 * - Other pending events -> 'rejected' (with optional rejectReason)
 * Clears state.pending_action. No-op if there is no pending action.
 */
export async function resolveActionEvents(
  prisma: PrismaService,
  projectId: string,
  resolvedActions: Iterable<'cancel' | 'confirm' | 'confirm_fast' | 'continue'>,
  rejectReason?: 'word_cap_exceeded',
): Promise<void> {
  const resolvedSet = new Set(resolvedActions)

  await withSessionLock(
    prisma,
    projectId,
    { timeline: true, state: true },
    async ({ timeline, state }) => {
      if (!state.pending_action) {
        return { write: { timeline: 'abandon', state: 'abandon' }, changes: [] }
      }

      // Extra fields stamped onto every rejected event this call produces.
      const rejectFields: Partial<ActionEvent> = {}
      if (rejectReason) {
        rejectFields.reject_reason = rejectReason
      }

      const updateItems: TimelineEventPatch[] = []
      const updatedEvents = timeline.events.map((event) => {
        if (event.type === 'action' && event.status === 'pending') {
          const newStatus: 'accepted' | 'rejected' = resolvedSet.has(event.action)
            ? 'accepted'
            : 'rejected'
          const patch: TimelineEventPatch = { id: event.id, status: newStatus }
          if (newStatus === 'rejected') {
            Object.assign(patch, rejectFields)
          }
          updateItems.push(patch)
          return {
            ...event,
            status: newStatus,
            ...(newStatus === 'rejected' ? rejectFields : {}),
          }
        }
        return event
      })

      const newState: UipSessionState = {
        ...state,
        pending_action: null,
        pending_action_source: null,
      }

      if (!updateItems.length) {
        return {
          write: { timeline: 'abandon', state: newState },
          changes: [{ kind: 'state', state: buildStatePatch(state, newState) }],
        }
      }

      return {
        write: {
          timeline: { ...timeline, events: updatedEvents },
          state: newState,
        },
        changes: [
          { kind: 'timeline', append: [], update: updateItems },
          { kind: 'state', state: buildStatePatch(state, newState) },
        ],
      }
    },
  )
}

/**
 * Patch pending gui_edit events whose request_id appears in guiRequestIds to 'handled'.
 * Idempotent: events already marked handled are skipped.
 */
export async function resolveGuiEditEvents(
  prisma: PrismaService,
  projectId: string,
  guiRequestIds: string[],
): Promise<void> {
  if (!guiRequestIds.length) {
    return
  }
  const idSet = new Set(guiRequestIds)

  await withSessionLock(prisma, projectId, { timeline: true }, async ({ timeline }) => {
    const updateItems: TimelineEventPatch[] = []
    const updatedEvents = timeline.events.map((event): TimelineEvent => {
      if (event.type === 'gui_edit' && event.status === 'pending' && idSet.has(event.request_id)) {
        updateItems.push({ id: event.id, status: 'handled' })
        return { ...event, status: 'handled' }
      }
      return event
    })

    if (!updateItems.length) {
      return { write: { timeline: 'abandon' }, changes: [] }
    }

    return {
      write: { timeline: { ...timeline, events: updatedEvents } },
      changes: [{ kind: 'timeline', append: [], update: updateItems }],
    }
  })
}

function toTimelineNoop(): SessionLockOutput<'timeline'> {
  return { write: { timeline: null }, changes: [] }
}
