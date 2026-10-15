import type { Session, TimelineEvent } from './api-types'

export function sortTimelineEvents(events: TimelineEvent[]): TimelineEvent[] {
  return [...events].sort(compareTimelineEvents)
}

export function withSortedTimelineEvents(session: Session): Session {
  return {
    ...session,
    timeline: {
      ...session.timeline,
      events: sortTimelineEvents(session.timeline.events),
    },
  }
}

function compareTimelineEvents(a: TimelineEvent, b: TimelineEvent): number {
  if (a.type === 'session_changed' && b.type === 'session_changed') {
    return a.id - b.id
  }

  const timeA = Date.parse(a.ts)
  const timeB = Date.parse(b.ts)

  if (Number.isFinite(timeA) && Number.isFinite(timeB) && timeA !== timeB) {
    return timeA - timeB
  }
  if (Number.isFinite(timeA) && !Number.isFinite(timeB)) {
    return -1
  }
  if (!Number.isFinite(timeA) && Number.isFinite(timeB)) {
    return 1
  }

  return a.id - b.id
}
