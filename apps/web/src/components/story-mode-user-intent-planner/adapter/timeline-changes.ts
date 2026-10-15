import type { Session, TimelineChanges, TimelineEvent, TimelineEventPatch } from './api-types'
import { sortTimelineEvents } from './timeline-events'

export function applyTimelineChangesToSession(params: {
  changes: TimelineChanges
  current: Session
}): { next: Session; nextVersion: number; requiresResync: boolean } {
  const { changes, current } = params
  const localVersion = current.timeline.version
  if (changes.version !== localVersion + 1) {
    return { next: current, nextVersion: localVersion, requiresResync: true }
  }

  const nextTimeline = {
    ...current.timeline,
    events: mergeTimelineEvents(current.timeline.events, changes.append, changes.update),
    next_event_id: changes.next_event_id,
    version: changes.version,
  }

  return {
    next: { ...current, timeline: nextTimeline },
    nextVersion: changes.version,
    requiresResync: false,
  }
}

function mergeTimelineEvents(
  existing: TimelineEvent[],
  append: TimelineEvent[],
  update: TimelineEventPatch[],
): TimelineEvent[] {
  const byId = new Map<number, TimelineEvent>()
  const ordered = [...existing]

  for (const event of existing) {
    byId.set(event.id, event)
  }

  for (const patch of update) {
    const target = byId.get(patch.id)
    if (!target) {
      continue
    }
    const merged = { ...target, ...patch } as TimelineEvent
    byId.set(patch.id, merged)
  }

  for (let i = 0; i < ordered.length; i += 1) {
    const event = ordered[i]
    if (!event) {
      continue
    }
    ordered[i] = byId.get(event.id) ?? event
  }

  for (const event of append) {
    if (byId.has(event.id)) {
      continue
    }
    byId.set(event.id, event)
    ordered.push(event)
  }

  return sortTimelineEvents(ordered)
}
