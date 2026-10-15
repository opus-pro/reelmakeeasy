import {
  estimateScriptDurationSeconds,
  isLongVideoDuration,
  isLongVideoScriptDuration,
  type LongVideoAttemptSource,
  textHasLongVideoDurationMention,
} from '@reelmakeeasy/common/story-mode/long-video-attribution'

import { normalizeTimeline } from './uip-timeline-transformers'
import type { AssistantMessageEvent, TimelineFile, UserMessageEvent } from './uip-timeline-types'

export function resolveUipLongVideoAttemptSource(params: {
  audioDurationSeconds?: number
  requestedDurationSeconds?: null | number
  script?: string
  timeline: unknown
}): LongVideoAttemptSource | undefined {
  const timeline = normalizeTimelineInput(params.timeline)
  const requestedDurationSeconds =
    params.requestedDurationSeconds ?? extractLatestDurationSeconds(timeline)
  const timelineAudioDurationSeconds = extractLatestUserAudioDurationSeconds(timeline)
  if (
    isLongVideoDuration(params.audioDurationSeconds) ||
    isLongVideoDuration(timelineAudioDurationSeconds)
  ) {
    return 'audio_upload'
  }

  const scriptLengthSource = isLongVideoScriptDuration(estimateScriptDurationSeconds(params.script))
    ? 'script_length'
    : undefined
  if (!isLongVideoDuration(requestedDurationSeconds)) {
    return scriptLengthSource
  }

  return resolveUipRequestedDurationSource(timeline) ?? scriptLengthSource
}

function clickedOptionHasLongDuration(
  message: UserMessageEvent,
  assistantByMessageId: Map<string, AssistantMessageEvent>,
): boolean {
  const assistant = message.answer_to_message_id
    ? assistantByMessageId.get(message.answer_to_message_id)
    : undefined
  const option = assistant?.options?.find(
    (item) => item.label.trim() === message.message.trim() || item.id === message.message.trim(),
  )
  if (!option) {
    return false
  }
  return (
    textHasLongVideoDurationMention(message.message) ||
    textHasLongVideoDurationMention(option.label) ||
    textHasLongVideoDurationMention(option.id) ||
    isLongVideoDuration(Number(option.id))
  )
}

function extractLatestDurationSeconds(timeline: null | TimelineFile): number | undefined {
  let latest: number | undefined
  for (const event of timeline?.events ?? []) {
    if (event.type !== 'session_changed') {
      continue
    }
    const value = event.mode_state?.duration_seconds
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      latest = value
    }
  }
  return latest
}

function extractLatestUserAudioDurationSeconds(timeline: null | TimelineFile): number | undefined {
  let latest: number | undefined
  for (const event of timeline?.events ?? []) {
    if (event.type !== 'session_changed' || event.audio_source !== 'user_audio') {
      continue
    }
    const value = event.mode_state?.duration_seconds
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      latest = value
    }
  }
  return latest
}

function normalizeTimelineInput(timeline: unknown): null | TimelineFile {
  try {
    return timeline ? normalizeTimeline(timeline) : null
  } catch {
    return null
  }
}

function resolveUipRequestedDurationSource(
  timeline: null | TimelineFile,
): LongVideoAttemptSource | undefined {
  if (!timeline?.events?.length) {
    return undefined
  }

  const assistantByMessageId = new Map<string, AssistantMessageEvent>()
  const sorted = [...timeline.events].sort((a, b) => a.id - b.id)
  for (const event of sorted) {
    if (event.type === 'assistant_message' && event.message_id) {
      assistantByMessageId.set(event.message_id, event)
    }
  }

  const userMessages = sorted.filter(
    (event): event is UserMessageEvent =>
      event.type === 'user_message' && event.status !== 'unqueued',
  )
  const firstUserMessageId = userMessages[0]?.id

  for (const message of userMessages) {
    if (
      message.answer_to_message_id &&
      clickedOptionHasLongDuration(message, assistantByMessageId)
    ) {
      return 'uip_duration_option'
    }
  }

  if (
    firstUserMessageId !== undefined &&
    textHasLongVideoDurationMention(userMessages[0]?.message)
  ) {
    return 'uip_initial_prompt_duration_mention'
  }

  for (const message of userMessages.slice(1)) {
    if (
      textHasLongVideoDurationMention(message.message) &&
      !clickedOptionHasLongDuration(message, assistantByMessageId)
    ) {
      return 'uip_followup_prompt_duration_mention'
    }
  }

  return undefined
}
