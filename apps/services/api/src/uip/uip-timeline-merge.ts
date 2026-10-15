import { randomUUID } from 'node:crypto'

import { typedKeys } from '@reelmakeeasy/common/utils/type-utils'

import type {
  AssistantMessageEvent,
  TimelineEvent,
  TimelineEventInput,
  TimelineEventPatch,
  UserMessageEvent,
} from './uip-timeline-types'

export type UipTranscriptMessage = {
  answer_to_message_id?: string
  attempt?: number
  content: string
  exec_id?: string
  expect_assets?: boolean
  message_id?: string
  options?: Array<{ expect_assets?: boolean; id: string; label: string }>
  phase?: string
  question_index?: number
  role: string
  sent_from?: UserMessageEvent['sent_from']
  spec_version?: number
  timestamp: string
  turn_id?: string
  uploaded_assets?: Array<{
    asset_id: string
    content_type: string
    file_name: string
    file_path: string
    preview_url?: string
  }>
  uts?: string
}

export function mergeTranscriptEventsIntoTimeline(params: {
  current: TimelineEvent[]
  nextEventId: number
  transcript: UipTranscriptMessage[]
}) {
  const { current, nextEventId, transcript: originalTranscript } = params

  const transcript = originalTranscript.map((msg) => {
    if (!msg.message_id) {
      return { ...msg, message_id: randomUUID() }
    }
    return msg
  })

  const { timelineMsgMap, transcriptMsgMap } = collectHandledUserMessageMaps(current, transcript)
  const { timelineAssistantMap, transcriptAssistantMap, timelineContentByTurn } =
    collectAssistantMessageMaps(current, transcript)
  const { updateItems, updatedEvents } = applyExistingTranscriptUpdates({
    current,
    timelineMsgMap,
    transcriptAssistantMap,
    transcriptMsgMap,
  })
  const upsertedUserMsgs = collectMissingHandledUserEvents(timelineMsgMap, transcriptMsgMap)
  const upsertedAssistantEvents = collectMissingAssistantEvents(
    timelineAssistantMap,
    transcriptAssistantMap,
    timelineContentByTurn,
  )

  const newEventsToMerge = [...upsertedUserMsgs, ...upsertedAssistantEvents].sort((a, b) =>
    a.ts.localeCompare(b.ts),
  )

  const merged = mergeEventsInTimestampOrder(nextEventId, newEventsToMerge, updatedEvents)

  return { ...merged, updateItems }
}

function addToContentByTurn(
  byTurn: Map<string | undefined, Set<string>>,
  turnId: string | undefined,
  content: string,
): void {
  let bucket = byTurn.get(turnId)
  if (!bucket) {
    bucket = new Set()
    byTurn.set(turnId, bucket)
  }
  bucket.add(content)
}

function applyExistingTranscriptUpdates(params: {
  current: TimelineEvent[]
  timelineMsgMap: Map<string, UserMessageEvent>
  transcriptAssistantMap: Map<string, UipTranscriptMessage>
  transcriptMsgMap: Map<string, UipTranscriptMessage>
}) {
  const { current, timelineMsgMap, transcriptMsgMap } = params
  const updateItems: TimelineEventPatch[] = []
  const updatedEvents = current.map((event) => {
    if (event.type === 'user_message') {
      const timelineMsg = timelineMsgMap.get(event.message_id)
      if (!timelineMsg) {
        return event
      }
      const transcriptMessage = transcriptMsgMap.get(event.message_id)
      if (!transcriptMessage) {
        return event
      }
      // Never resurrect a cancelled message: unqueued status is terminal.
      // TODO(Step 9): remove after old-protocol workflows drain. New-protocol messages
      // are either materialized (pending -> handled) or cancelled before materialization
      // and never reach the timeline, so unqueued can only come from old-protocol sessions.
      if (timelineMsg.status === 'unqueued') {
        return event
      }
      const patch: Partial<UserMessageEvent> = {
        status: 'handled',
        ts: transcriptMessage.timestamp,
        uts: timelineMsg.uts ?? timelineMsg.ts,
        turn_id: transcriptMessage.turn_id,
        attempt: transcriptMessage.attempt,
      }
      // Keep handled rows stable across retries; only pending/unqueued rows
      // should adopt transcript timestamp as timeline sort `ts`.
      if (timelineMsg.status === 'handled') {
        delete patch.ts
        delete patch.uts
      }
      const keys = typedKeys(patch)
      let changed = false
      for (const key of keys) {
        if (timelineMsg[key] === patch[key]) {
          delete patch[key]
        } else {
          changed = true
        }
      }
      if (changed) {
        updateItems.push({ id: event.id, ...patch })
        return { ...event, ...patch } satisfies UserMessageEvent
      }
    }

    return event
  })
  return { updateItems, updatedEvents }
}

function collectAssistantMessageMaps(current: TimelineEvent[], transcript: UipTranscriptMessage[]) {
  const timelineAssistantMap = new Set<string>()
  const timelineContentByTurn = new Map<string | undefined, Set<string>>()
  for (const event of current) {
    if (event.type !== 'assistant_message') {
      continue
    }
    if (event.message_id) {
      timelineAssistantMap.add(event.message_id)
    }
    addToContentByTurn(timelineContentByTurn, event.turn_id, event.content)
  }

  const transcriptAssistantMap = new Map<string, UipTranscriptMessage>()
  for (const message of transcript) {
    if (message.role === 'assistant' && message.message_id) {
      transcriptAssistantMap.set(message.message_id, message)
    }
  }

  return { timelineAssistantMap, transcriptAssistantMap, timelineContentByTurn }
}

function collectHandledUserMessageMaps(
  current: TimelineEvent[],
  transcript: UipTranscriptMessage[],
) {
  const timelineMsgMap = new Map<string, UserMessageEvent>()
  for (const event of current) {
    if (event.type === 'user_message') {
      timelineMsgMap.set(event.message_id, event)
    }
  }

  const transcriptMsgMap = new Map<string, UipTranscriptMessage>()
  for (const message of transcript) {
    if (message.role === 'user' && message.message_id) {
      transcriptMsgMap.set(message.message_id, message)
    }
  }

  return { timelineMsgMap, transcriptMsgMap }
}

function collectMissingAssistantEvents(
  timelineAssistantMap: Set<string>,
  transcriptAssistantMap: Map<string, UipTranscriptMessage>,
  contentByTurn: Map<string | undefined, Set<string>>,
) {
  // Per-turn content dedup catches activity retries that re-emit identical
  // assistant replies with fresh random message_ids under the same turn_id.
  // Cross-turn repeats (e.g., re-asks of the same ASK_CLARIFY after ambiguous user
  // answers) are intentional and must pass through.
  const upsertedAssistantEvents: Array<Omit<AssistantMessageEvent, 'id'>> = []
  for (const [messageId, message] of transcriptAssistantMap) {
    if (timelineAssistantMap.has(messageId)) {
      continue
    }
    if (contentByTurn.get(message.turn_id)?.has(message.content)) {
      continue
    }
    upsertedAssistantEvents.push({
      type: 'assistant_message',
      ts: message.timestamp,
      content: message.content,
      expect_assets: message.expect_assets,
      message_id: messageId,
      options: message.options,
      question_index: message.question_index,
      turn_id: message.turn_id,
      attempt: message.attempt,
    })
    addToContentByTurn(contentByTurn, message.turn_id, message.content)
  }
  return upsertedAssistantEvents
}

function collectMissingHandledUserEvents(
  timelineMsgMap: Map<string, UserMessageEvent>,
  transcriptMsgMap: Map<string, UipTranscriptMessage>,
) {
  const upsertedUserMsgs: TimelineEventInput[] = []
  for (const [msgId, message] of transcriptMsgMap) {
    if (timelineMsgMap.has(msgId)) {
      continue
    }
    upsertedUserMsgs.push({
      type: 'user_message',
      answer_to_message_id: message.answer_to_message_id,
      ts: message.timestamp,
      uts: message.uts,
      message: message.content,
      message_id: msgId,
      sent_from: message.sent_from,
      status: 'handled',
      turn_id: message.turn_id,
      attempt: message.attempt,
      uploaded_assets: message.uploaded_assets,
    })
  }
  return upsertedUserMsgs
}

function mergeEventsInTimestampOrder(
  nextEventId: number,
  newEventsToMerge: TimelineEventInput[],
  updatedEvents: TimelineEvent[],
) {
  let nextId = nextEventId
  const appendItems = newEventsToMerge.map((event) => ({
    ...event,
    id: nextId++,
  }))
  const mergedEvents = [...updatedEvents, ...appendItems]
  return { appendItems, mergedEvents, nextId }
}
