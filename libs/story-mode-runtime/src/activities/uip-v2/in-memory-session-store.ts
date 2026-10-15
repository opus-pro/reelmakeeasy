/**
 * In-Memory Session Store for Activities
 *
 * In the prototype, SessionStore is a NestJS @Injectable backed by a shared store.
 * In the activity, state is passed as input and returned as output --
 * no external persistence needed during the planner loop execution.
 *
 * This adapter satisfies the SessionStore interface that sub-modules expect
 * (via `deps.sessionStore`) without any external I/O.
 *
 * The optional `onUpdate` callback enables mid-activity SSE push: the planner
 * loop already calls `updateSession()` at every meaningful state transition
 * (e.g. after appending "Working on X..." before tool execution). When
 * `onUpdate` is provided, those calls fire-and-forget an HTTP callback to
 * push intermediate state to the frontend via SSE.
 */

import { randomUUID } from 'node:crypto'

import { createSubLogger } from '@reelmakeeasy/common/logger'
import type { Message, SessionState } from '@reelmakeeasy/uip-planner-runtime'

const logger = createSubLogger('uip-in-memory-session-store')

export interface SessionStoreLike {
  appendMessage: (session: SessionState, message: Message) => void
  updateSession: (session: SessionState) => Promise<void>
}

export function createInMemorySessionStore(
  onUpdate?: (session: SessionState) => Promise<void>,
  turnMeta?: { attempt: number; turnId: string },
  // Fired (best-effort) for every message appended during the activity. UIP V2
  // tool activities use this to stream appendProgressReply milestones to the
  // parent session workflow as a childProgressMessage signal.
  onAppend?: (message: Message) => void,
): SessionStoreLike {
  return {
    appendMessage(session: SessionState, message: Message): void {
      if (turnMeta) {
        if (!message.message_id) {
          message.message_id = randomUUID()
        }
        if (!message.exec_id) {
          message.exec_id = turnMeta.turnId
        }
        if (!message.turn_id) {
          message.turn_id = turnMeta.turnId
        }
        if (message.attempt === undefined) {
          message.attempt = turnMeta.attempt
        }
      }
      session.transcript.push(message)
      if (onAppend) {
        onAppend(message)
      }
    },

    async updateSession(session: SessionState): Promise<void> {
      session.updated_at = new Date().toISOString()
      if (onUpdate) {
        // Fire-and-forget: don't block the planner loop.
        // Errors are logged but never propagated.
        onUpdate(session).catch((err) =>
          logger.warn(
            `[${session.sessionId}] Mid-activity session publish failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
          ),
        )
      }
    },
  }
}
