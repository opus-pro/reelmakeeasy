import type { TimelineRenderBlock } from '../../state-types'

import { buildVisibleRenderDiffByKindAndEventId, SESSION_BLOCK_ORDER } from './visible-render-diff'

export function appendSessionChangedBlocks(
  eventId: number,
  visibleRenderDiffByKindAndEventId: ReturnType<typeof buildVisibleRenderDiffByKindAndEventId>,
  blocks: TimelineRenderBlock[],
): void {
  for (const key of SESSION_BLOCK_ORDER) {
    const nextValue = visibleRenderDiffByKindAndEventId.get(key)?.get(eventId)
    if (!nextValue) {
      continue
    }
    blocks.push({
      ...nextValue,
      id: `${nextValue.id}-event-${eventId}`,
    })
  }
}
