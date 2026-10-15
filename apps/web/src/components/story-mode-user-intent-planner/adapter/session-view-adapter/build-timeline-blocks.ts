import type { TimelineRenderBlock } from '../../state-types'
import type { MessageEventEvent, SessionState, TimelineEvent } from '../api-types'

import { buildUploadedAssetsPool } from './build-blocks'
import type { SessionAssetsSnapshot } from './incremental-session-render-snapshot'
import { appendUserMessageRelatedBlocks, buildMessageBlock } from './timeline-message-blocks'
import { appendSessionChangedBlocks } from './timeline-session-changed-blocks'
import { buildVisibleRenderDiffByKindAndEventId } from './visible-render-diff'

export function buildTimelineBlocks(params: {
  cdnOrigin: string
  eventsForTimeline: TimelineEvent[]
  messageAssetAnchorByEventId: Map<number, SessionAssetsSnapshot>
  sessionId: string
  state: SessionState
  visibleRenderDiffByKindAndEventId: ReturnType<typeof buildVisibleRenderDiffByKindAndEventId>
}): {
  blocks: TimelineRenderBlock[]
  hasSessionChangedEvent: boolean
  lastMessage: MessageEventEvent | null
} {
  const {
    cdnOrigin,
    eventsForTimeline,
    messageAssetAnchorByEventId,
    sessionId,
    state,
    visibleRenderDiffByKindAndEventId,
  } = params

  const blocks: TimelineRenderBlock[] = []
  let userMessageIndex = -1
  let lastMessage: MessageEventEvent | null = null
  let hasSessionChangedEvent = false

  for (const event of eventsForTimeline) {
    if (event.type === 'assistant_message' || event.type === 'user_message') {
      const anchoredAssets = messageAssetAnchorByEventId.get(event.id)
      blocks.push(
        buildMessageBlock({
          anchorAssets: anchoredAssets?.anchor_assets_pool ?? [],
          event,
          uploadedAssets:
            event.type === 'user_message'
              ? buildUploadedAssetsPool(event.uploaded_assets ?? [], { cdnOrigin, sessionId })
              : [],
        }),
      )
      lastMessage = event
      if (event.type === 'user_message') {
        userMessageIndex = appendUserMessageRelatedBlocks({
          blocks,
          cdnOrigin,
          event,
          sessionId,
          state,
          userMessageIndex,
        })
      }
      continue
    }

    if (event.type === 'session_changed') {
      hasSessionChangedEvent = true
      appendSessionChangedBlocks(event.id, visibleRenderDiffByKindAndEventId, blocks)
    }
  }

  return {
    blocks,
    hasSessionChangedEvent,
    lastMessage,
  }
}
