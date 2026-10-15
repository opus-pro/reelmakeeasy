import { randomUUID } from 'node:crypto'

import type { PrismaService } from '../prisma/prisma.service'

import { appendTimelineEvents } from './uip-timeline-lock-writers'
import type { GuiEditKind, TimelineEventInput } from './uip-timeline-types'

/**
 * Append a gui_edit timeline event and return the generated requestId.
 * The event is written with status 'pending'; the workflow marks it 'handled' after processing.
 */
export async function appendGuiEditEvent(
  prisma: PrismaService,
  projectId: string,
  kinds: GuiEditKind[],
): Promise<{ requestId: string; ts: string }> {
  const requestId = randomUUID()
  const ts = new Date().toISOString()
  await appendTimelineEvents(prisma, projectId, () => ({
    appendForFile: kinds.map((kind) => ({
      type: 'gui_edit' as const,
      kind,
      request_id: requestId,
      status: 'pending' as const,
      ts,
    })),
  }))
  return { requestId, ts }
}

/**
 * Append a gui_edit event plus an optional session_changed event (e.g. new script content)
 * in one lock. The session_changed event is pushed via SSE immediately so the frontend
 * receives the update even while a planner activity is running.
 */
export async function appendGuiEditWithSessionChanged(
  prisma: PrismaService,
  projectId: string,
  params: {
    kinds: GuiEditKind[]
    script?: { content: string }
  },
): Promise<{ requestId: string; ts: string }> {
  const { kinds, script } = params
  const requestId = randomUUID()
  const ts = new Date().toISOString()

  const guiEditEvents: TimelineEventInput[] = kinds.map((kind) => ({
    type: 'gui_edit' as const,
    kind,
    request_id: requestId,
    status: 'pending' as const,
    ts,
  }))

  const sessionChangedEvents: TimelineEventInput[] = script
    ? [
        {
          type: 'session_changed' as const,
          ts,
          script: { content: script.content, gui_request_id: requestId },
        },
      ]
    : []

  await appendTimelineEvents(prisma, projectId, () => ({
    appendForFile: [...guiEditEvents, ...sessionChangedEvents],
    appendForSse: [...guiEditEvents, ...sessionChangedEvents],
  }))

  return { requestId, ts }
}
