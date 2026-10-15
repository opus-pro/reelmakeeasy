import type { ActiveModalKind } from '../state/atoms/planner'

import type {
  ActionEvent,
  SessionChangedEventUploadedAsset,
  TimelineEvent,
  UipMessageRecord,
  UserMessageEvent,
} from './api-types'

// ---- Simulated line (layer 3 - frontend-constructed, injected before API call) ----

export interface BackendResponseEvent {
  localOffset: number
  record: UipMessageRecord
}

export interface SimulatedEvent {
  action?: 'cancel' | 'confirm' | 'confirm_fast' | 'continue'
  answerToMessageId?: string
  /** Matches client_id on the real UserMessageEvent from SSE for direct claim. */
  clientId?: string
  kind: SimulatedEventKind
  localOffset: number
  // user_message fields
  message?: string
  // Canvas modal open at send time. Carried on the optimistic
  // event so the bubble tags itself from block.sentFrom during the optimistic
  // window, before the backend echoes sent_from on the real inbox record.
  sentFrom?: ActiveModalKind
  ts: string
  uploadedAssets?: SessionChangedEventUploadedAsset[]
}

export type SimulatedEventKind = 'action' | 'user_message'

// ---- Merge function (pure, no side effects) ----

export function claimAndMergeOptimisticEvents(params: {
  backendResponseEvents: BackendResponseEvent[]
  inboxRecords?: Array<{ client_message_id?: string; id: string }>
  nextEventId: number
  realEvents: TimelineEvent[]
  simulatedEvents: SimulatedEvent[]
}): {
  extraEvents: TimelineEvent[]
  nextBackendResponseEvents: BackendResponseEvent[]
  nextSimulatedEvents: SimulatedEvent[]
  simulatedInboxRecords: UipMessageRecord[]
} {
  const { nextEventId, realEvents } = params
  let { backendResponseEvents, simulatedEvents } = params
  const inboxClientIds = new Set(
    (params.inboxRecords ?? [])
      .map((record) => record.client_message_id)
      .filter((id): id is string => id != null),
  )
  const inboxRecordIds = new Set((params.inboxRecords ?? []).map((record) => record.id))

  // Claim simulated user_message: real line arrived with matching client_id.
  const realClientIds = new Set(
    realEvents
      .filter((e): e is UserMessageEvent => e.type === 'user_message')
      .map((e) => e.client_id)
      .filter((id): id is string => id != null),
  )
  simulatedEvents = simulatedEvents.filter(
    (se) => se.kind !== 'user_message' || !se.clientId || !realClientIds.has(se.clientId),
  )
  simulatedEvents = simulatedEvents.filter(
    (se) =>
      se.kind !== 'user_message' ||
      !(
        (se.clientId && inboxClientIds.has(se.clientId)) ||
        backendResponseEvents.some((br) => br.localOffset === se.localOffset)
      ),
  )
  backendResponseEvents = backendResponseEvents.filter(
    (br) =>
      !inboxRecordIds.has(br.record.id) && !realClientIds.has(br.record.client_message_id ?? ''),
  )
  simulatedEvents = simulatedEvents.filter(
    (se) =>
      se.kind !== 'action' ||
      !se.clientId ||
      !realEvents.some(
        (event) =>
          event.type === 'action' && event.client_id === se.clientId && event.action === se.action,
      ),
  )

  const extraEvents = simulatedEvents.flatMap((se) =>
    se.kind === 'action' ? [simulatedActionToTimelineEvent(se, nextEventId + se.localOffset)] : [],
  )
  const simulatedInboxRecords = simulatedEvents.flatMap((se) =>
    se.kind === 'user_message' ? [simulatedUserToInboxRecord(se)] : [],
  )

  return {
    nextBackendResponseEvents: backendResponseEvents,
    nextSimulatedEvents: simulatedEvents,
    simulatedInboxRecords,
    extraEvents,
  }
}

function simulatedActionToTimelineEvent(se: SimulatedEvent, eventId: number): ActionEvent {
  return {
    action: se.action ?? 'continue',
    client_id: se.clientId,
    id: eventId,
    status: 'pending',
    ts: se.ts,
    type: 'action',
  }
}

function simulatedUserToInboxRecord(se: SimulatedEvent): UipMessageRecord {
  return {
    answer_to_message_id: se.answerToMessageId,
    client_message_id: se.clientId,
    created_at: se.ts,
    id: `optimistic-${se.clientId ?? se.localOffset}`,
    message: se.message ?? '',
    sent_from: se.sentFrom,
    status: 'sending',
    uploaded_assets: se.uploadedAssets,
  }
}
