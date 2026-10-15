import { toast } from '@shared/ui'

import { getRenderStateAtom, getSubmitPendingAtom } from '../../state/atoms/planner'
import type {
  RenderAutoLockGate,
  RenderQueuedMessage,
  RenderState,
  TimelineRenderBlock,
} from '../../state-types'
import {
  getAdapterSessionAtom,
  getAdapterTimelineMetaAtom,
  getSessionStateAtom,
  getSimulatedEventsAtom,
  getTranscriptEditingOptimisticOpsAtom,
} from '../adapter-atoms'
import { pendingActionChangeEvent, statusChangeEvent } from '../adapter-events'
import type {
  ActionEvent,
  Session,
  StateChanges,
  TimelineEvent,
  UipMessageRecord,
  UserMessageEvent,
} from '../api-types'
import type { SimulatedEvent } from '../optimistic-events'
import { claimAndMergeOptimisticEvents } from '../optimistic-events'
import { buildTimelineRenderFromEvents } from '../session-view-adapter'
import { sortTimelineEvents, withSortedTimelineEvents } from '../timeline-events'

import { getEffectiveSessionState, hasAnyActiveTranscriptEditor } from './transcript-editing-sync'
import type { BridgeContext } from './types'
import { computeCountdownShowAt } from './user-operation-countdown-delay'

export function createSessionSync(context: BridgeContext) {
  const { cdnOrigin, events, plannerState, runtimeState, sessionId } = context

  let prevEffectivePendingAction: StateChanges['state']['pending_action'] = undefined

  const applySession = (session: Session) => {
    const sortedSession = withSortedTimelineEvents(session)
    plannerState.set(getAdapterSessionAtom, sortedSession)

    if (session.state && typeof session.state_version === 'number') {
      const { state, state_version } = session
      const currentStateVersion = plannerState.get(getSessionStateAtom).version
      if (state_version >= currentStateVersion) {
        plannerState.set(getSessionStateAtom, {
          state,
          version: state_version,
        })
      }
    }

    let simulatedEvents = plannerState.get(getSimulatedEventsAtom)
    const { state } = plannerState.get(getSessionStateAtom)

    simulatedEvents = flushStaleSimulatedActions(
      simulatedEvents,
      sortedSession.timeline.events,
      state.pending_action,
    )

    const nextEventId = sortedSession.timeline.next_event_id
    const { nextBackendResponseEvents, nextSimulatedEvents, extraEvents, simulatedInboxRecords } =
      claimAndMergeOptimisticEvents({
        backendResponseEvents: runtimeState.backendResponseEvents,
        inboxRecords: state.input_inbox?.records,
        nextEventId,
        realEvents: sortedSession.timeline.events,
        simulatedEvents,
      })
    runtimeState.backendResponseEvents = nextBackendResponseEvents
    plannerState.set(getSimulatedEventsAtom, nextSimulatedEvents)

    const mergedEvents =
      extraEvents.length === 0
        ? sortedSession.timeline.events
        : sortTimelineEvents([...sortedSession.timeline.events, ...extraEvents])

    let eventsForRender = mergedEvents.filter(
      (event) =>
        !(
          event.type === 'user_message' &&
          (event.status === 'unqueued' || runtimeState.removedQueueMessageIds.has(event.message_id))
        ),
    )

    const inputInboxRecords = [
      ...(state.input_inbox?.records ?? []),
      ...runtimeState.backendResponseEvents.map((item) => item.record),
      ...simulatedInboxRecords,
    ]
    const hasVisibleInboxRecords = inputInboxRecords.some(
      (record) => !runtimeState.removedQueueMessageIds.has(record.id),
    )
    const answeredQuestionMessageIds = buildAnsweredQuestionMessageIdsFromInboxRecords(
      inputInboxRecords,
      runtimeState.removedQueueMessageIds,
    )
    const isRunningPlannerLoop = state.is_running_planner_loop
    const timelineInboxRecords = inputInboxRecords.filter(
      (record) =>
        !runtimeState.removedQueueMessageIds.has(record.id) &&
        (record.answer_to_message_id ||
          record.status === 'pending' ||
          (record.status === 'sending' && !isRunningPlannerLoop)),
    )
    const timelineInboxRecordIds = new Set(timelineInboxRecords.map((record) => record.id))
    if (timelineInboxRecords.length > 0) {
      eventsForRender = sortTimelineEvents([
        ...eventsForRender,
        ...timelineInboxRecords.map((record, index) =>
          inboxRecordToTimelineUserMessage(record, nextEventId + index),
        ),
      ])
    }

    const latestAcceptedIdByAction = buildLatestAcceptedIdByAction(sortedSession.timeline.events)

    const rejectedActionMessages = sortedSession.timeline.events
      .filter(
        (e): e is ActionEvent =>
          e.type === 'action' &&
          e.status === 'rejected' &&
          e.reject_reason != null &&
          (latestAcceptedIdByAction.get(e.action) ?? -1) <= e.id,
      )
      .map((e, index) => ({
        content: rejectReasonToMessage(e.reject_reason),
        id: nextEventId + 2_000_000 + index,
        ts: e.ts,
        type: 'assistant_message' as const,
      }))
    if (rejectedActionMessages.length > 0) {
      eventsForRender = sortTimelineEvents([...eventsForRender, ...rejectedActionMessages])
    }

    const queuedMessages = buildQueuedMessagesFromInboxRecords(
      inputInboxRecords.filter((record) => !timelineInboxRecordIds.has(record.id)),
      runtimeState.removedQueueMessageIds,
    )
    const hasQueuedMessages = queuedMessages.length > 0

    const injectedBlockIds = new Set(
      rejectedActionMessages.map((m) => `block-message-event-${m.id}`),
    )

    const timelineBuild = buildTimelineRenderFromEvents(
      sessionId,
      eventsForRender,
      cdnOrigin,
      sortedSession.status,
      sortedSession.transition_video_model ?? undefined,
      answeredQuestionMessageIds,
      hasVisibleInboxRecords,
    )

    const blocks = deduplicateRejectedBlocks(timelineBuild.renderState.blocks, injectedBlockIds)

    let renderState: RenderState = {
      ...timelineBuild.renderState,
      aspectRatio: sortedSession.aspect_ratio ?? undefined,
      autoContinueEnabled: state.auto_continue_enabled !== false,
      blocks,
      carriedForwardImageModel: sortedSession.carried_forward_image_model ?? undefined,
      imageModel: sortedSession.image_model ?? undefined,
      modelSelectorTier: sortedSession.model_selector_tier,
      queuedMessages,
    }

    const prevStatus = plannerState.get(getAdapterTimelineMetaAtom)?.status
    const nextStatus = renderState.status

    plannerState.set(getAdapterTimelineMetaAtom, {
      gateToken: timelineBuild.gateToken,
      isProcessingFromTimeline: timelineBuild.isProcessingFromTimeline,
      lastMessageType: timelineBuild.lastMessage?.type ?? null,
      status: nextStatus,
    })

    if (prevStatus !== nextStatus) {
      events.emit(statusChangeEvent, { status: nextStatus })
    }

    const effectiveSessionState = getEffectiveSessionState({
      optimisticOps: plannerState.get(getTranscriptEditingOptimisticOpsAtom),
      state,
    })

    if (prevEffectivePendingAction !== effectiveSessionState.pending_action) {
      events.emit(pendingActionChangeEvent, { pendingAction: effectiveSessionState.pending_action })
      prevEffectivePendingAction = effectiveSessionState.pending_action
    }

    const hasActiveEditors = hasAnyActiveTranscriptEditor({
      state: effectiveSessionState,
    })
    const countdownShowAt = computeCountdownShowAt(state.operate_at)
    // A pending tail user message means the backend has not truly gone idle.
    const isPendingTailUserMessage =
      timelineBuild.lastMessage?.type === 'user_message' &&
      timelineBuild.lastMessage.status === 'pending'
    // isProcessing already folds in !is_idle (see buildTimelineRenderFromEvents), so
    // is_idle needs no separate clause here.
    const isGateIdle = !renderState.isProcessing && !isPendingTailUserMessage
    const hasQuickOptions = renderState.quickOptions.length > 0

    // The confirm planner turn completes in ~40ms but publishIntermediate delivers
    // the assistant response ~1-2s later. pending_action bridges that gap so the
    // Thinking indicator does not briefly disappear between the two events.
    //
    // A freshly-submitted message echoes optimistically as a pending tail user
    // message before the backend flips is_processing, so surface that as processing
    // -- the "Thinking..." indicator then shows the instant the user submits instead
    // of waiting for the first SSE event. Gated on !isRunningPlannerLoop so it only
    // covers the pre-loop gap: once the loop is running, is_processing governs and a
    // transient is_idle snapshot must not be overridden.
    renderState = {
      ...renderState,
      isProcessing:
        renderState.isProcessing ||
        effectiveSessionState.pending_action === 'confirm' ||
        (isPendingTailUserMessage && !isRunningPlannerLoop),
    }

    renderState = applyGateVisibility(renderState, {
      autoLockDeadlineAt: effectiveSessionState.review_gate?.auto_lock_deadline_at ?? null,
      countdownShowAt,
      hasActiveEditors,
      hasQueuedMessages,
      hasQuickOptions,
      isGateIdle,
      pendingAction: effectiveSessionState.pending_action,
      scriptReviewDeadlineAt:
        effectiveSessionState.review_gate?.review_auto_continue_deadline_at ?? null,
    })

    plannerState.set(getRenderStateAtom, renderState)

    // Clear the client-side submit flag once a backend update reflects the turn:
    // the agent is now processing (handoff to the real signal), a reply has
    // landed, or the session is no longer active. Until then the flag keeps the
    // "Thinking..." indicator up through the submit -> first-response gap, even at
    // bootstrap where the optimistic echo can't paint yet.
    if (
      renderState.isProcessing ||
      timelineBuild.lastMessage?.type === 'assistant_message' ||
      renderState.status !== 'active'
    ) {
      plannerState.set(getSubmitPendingAtom, false)
    }
  }

  const reapplySession = () => {
    const session = plannerState.get(getAdapterSessionAtom)
    if (session) {
      applySession(session)
    }
  }

  return {
    applySession,
    reapplySession,
  }
}

function buildAnsweredQuestionMessageIdsFromInboxRecords(
  records: UipMessageRecord[],
  removedIds: Set<string>,
): Set<string> {
  const answered = new Set<string>()
  for (const record of records) {
    if (removedIds.has(record.id) || !record.answer_to_message_id) {
      continue
    }
    answered.add(record.answer_to_message_id)
  }
  return answered
}

function buildLatestAcceptedIdByAction(events: TimelineEvent[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const e of events) {
    if (e.type === 'action' && e.status === 'accepted') {
      const cur = map.get(e.action) ?? -1
      if (e.id > cur) {
        map.set(e.action, e.id)
      }
    }
  }
  return map
}

function buildQueuedMessagesFromInboxRecords(
  records: UipMessageRecord[],
  removedIds: Set<string>,
): RenderQueuedMessage[] {
  const seenIds = new Set<string>()
  return records.flatMap((record) => {
    if (seenIds.has(record.id) || removedIds.has(record.id)) {
      return []
    }
    seenIds.add(record.id)
    return [
      {
        hasUploads: (record.uploaded_assets?.length ?? 0) > 0,
        id: record.id,
        status: record.status,
        text: record.message,
      },
    ]
  })
}

function deduplicateRejectedBlocks(
  blocks: TimelineRenderBlock[],
  injectedBlockIds: Set<string>,
): TimelineRenderBlock[] {
  const result: TimelineRenderBlock[] = []
  for (const block of blocks) {
    const prev = result[result.length - 1]
    if (
      block.kind === 'message' &&
      prev?.kind === 'message' &&
      injectedBlockIds.has(block.id) &&
      injectedBlockIds.has(prev.id) &&
      block.text === prev.text
    ) {
      // consecutive duplicate reject message - skip
    } else {
      result.push(block)
    }
  }
  return result
}

function flushStaleSimulatedActions(
  simulatedEvents: SimulatedEvent[],
  timelineEvents: TimelineEvent[],
  pendingAction: null | string | undefined,
): SimulatedEvent[] {
  const stale = simulatedEvents.filter((se) => se.kind === 'action' && pendingAction !== se.action)
  if (stale.length === 0) {
    return simulatedEvents
  }
  for (const se of stale) {
    const rejectedEvent = timelineEvents.find(
      (e): e is ActionEvent =>
        e.type === 'action' &&
        e.action === se.action &&
        e.status === 'rejected' &&
        e.reject_reason != null,
    )
    if (rejectedEvent?.reject_reason) {
      toast.error(rejectReasonToMessage(rejectedEvent.reject_reason))
    }
  }
  return simulatedEvents.filter((se) => !(se.kind === 'action' && pendingAction !== se.action))
}

function inboxRecordToTimelineUserMessage(
  record: UipMessageRecord,
  nextEventId: number,
): UserMessageEvent {
  const timestamp = record.dispatch_at ?? record.created_at
  return {
    answer_to_message_id: record.answer_to_message_id,
    client_id: record.client_message_id,
    id: nextEventId + 1_000_000,
    message: record.message,
    message_id: record.id,
    sent_from: record.sent_from,
    status: 'pending',
    ts: timestamp,
    type: 'user_message',
    uploaded_assets: record.uploaded_assets,
    uts: record.created_at,
  }
}

function maxIsoTimestamp(...values: Array<null | string | undefined>): null | string {
  let maxValue: null | string = null
  for (const value of values) {
    if (!value) {
      continue
    }
    if (!maxValue || value > maxValue) {
      maxValue = value
    }
  }
  return maxValue
}

// Recompute the active phase's review gate visibility from the chat's stability.
// A gate is only offered when the chat is idle with no pending quick question,
// queued messages, pending action, or artifact still generating. isGateIdle already
// folds in a pending tail user message, so the answer->ack window stays hidden too.
function applyGateVisibility(
  renderState: RenderState,
  params: {
    autoLockDeadlineAt: null | string
    countdownShowAt?: string
    hasActiveEditors: boolean
    hasQueuedMessages: boolean
    hasQuickOptions: boolean
    isGateIdle: boolean
    pendingAction: null | string | undefined
    scriptReviewDeadlineAt: null | string
  },
): RenderState {
  const { countdownShowAt, hasActiveEditors, isGateIdle } = params
  // A running tool call is the one busy signal isGateIdle cannot see: the planner turn
  // settles as soon as it dispatches the tool, so through a storyboard or asset
  // regeneration the chat reads idle while shots are still landing -- and the user is
  // asked to approve something still changing in front of them.
  const isStable =
    isGateIdle &&
    !params.hasQuickOptions &&
    !params.hasQueuedMessages &&
    !params.pendingAction &&
    !hasRunningToolCall(renderState.toolCallStates)

  if (renderState.phase === 'script_review') {
    const nextScriptReviewGate =
      mergeGateDeadline(renderState.scriptReviewGate, params.scriptReviewDeadlineAt) ??
      renderState.scriptReviewGate
    if (!nextScriptReviewGate) {
      return renderState
    }
    return {
      ...renderState,
      scriptReviewGate: {
        ...nextScriptReviewGate,
        countdownShowAt,
        hideCountdown: hasActiveEditors || !isGateIdle,
        visible: isStable,
      },
    }
  }

  if (renderState.phase === 'brand_review') {
    if (!renderState.brandReviewGate) {
      return renderState
    }
    return {
      ...renderState,
      brandReviewGate: { ...renderState.brandReviewGate, visible: isStable },
    }
  }

  if (renderState.phase === 'refinement') {
    // A locked plan must never revive the confirm gate. The timeline build
    // already drops autoLockGate when isLocked, but this merge path would
    // otherwise reconstruct it from a stale review_gate deadline. Guard here
    // too so the two gate-construction paths stay consistent.
    if (renderState.isLocked) {
      return renderState
    }
    const baseGate: RenderAutoLockGate | undefined =
      renderState.autoLockGate ??
      (params.autoLockDeadlineAt ? { deadlineAt: params.autoLockDeadlineAt } : undefined)
    const nextAutoLockGate = mergeGateDeadline(baseGate, params.autoLockDeadlineAt) ?? baseGate
    if (!nextAutoLockGate) {
      return renderState
    }
    return {
      ...renderState,
      autoLockGate: {
        ...nextAutoLockGate,
        countdownShowAt,
        hideCountdown: !isGateIdle,
        visible: isStable,
      },
    }
  }

  return renderState
}

// Any tool call still running: the agent is mid-work regardless of what the chat's
// own idle flags say. Kept tool-agnostic on purpose -- every tool the planner
// dispatches produces something a gate could be asked to approve.
function hasRunningToolCall(toolCallStates: RenderState['toolCallStates']): boolean {
  return toolCallStates.some((toolCall) => toolCall.status === 'running')
}

function mergeGateDeadline<T extends { deadlineAt: null | string }>(
  timelineGate: T | undefined,
  sessionStateDeadline: null | string,
): T | undefined {
  if (!timelineGate) {
    return undefined
  }
  const maxDeadlineAt = maxIsoTimestamp(timelineGate.deadlineAt, sessionStateDeadline)
  return maxDeadlineAt ? { ...timelineGate, deadlineAt: maxDeadlineAt } : timelineGate
}

function rejectReasonToMessage(reason?: 'word_cap_exceeded'): string {
  if (reason === 'word_cap_exceeded') {
    return 'Your script exceeds the maximum word limit. Please shorten it and try again.'
  }
  return 'Your action could not be completed. Please try again.'
}
