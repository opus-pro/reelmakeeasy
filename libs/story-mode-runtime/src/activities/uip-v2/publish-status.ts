/**
 * publishSessionStatus -- Local Activity (Architecture doc section 2.10)
 *
 * Publishes the current session status via HTTP callback to the API service,
 * which then pushes to SSE subscribers via SSEFactory.
 *
 * plan_md is passed in from persistSessionSnapshot (computed once per turn)
 * to avoid redundant renderPlanMd calls.
 *
 * Chain: Workflow -> publishSessionStatus (local activity) -> HTTP callback -> API -> SSE -> Frontend
 *
 * Local activity = runs on the workflow worker, short-lived, no heartbeat.
 */

import { createSubLogger } from '@reelmakeeasy/common/logger'
import { buildResponse, type SessionState } from '@reelmakeeasy/uip-planner-runtime'

import { postToInternalApi } from './common'

// Co-located after the move off workflows/uip/types (v1 cleanup).
interface PublishSessionStatusInput {
  projectId: string
  sessionState: SessionState
}

const logger = createSubLogger('uip-publish-status')

export async function publishSessionStatus(input: PublishSessionStatusInput): Promise<void> {
  const { sessionState, projectId } = input

  // Skip renderPlanMd and buildSpecHistoryTurns: the API /status handler
  // (sessionResponseToChangedEventInput) never reads plan_md or spec_history_turns,
  // so computing them on every loop iteration is pure waste.
  const response = buildResponse(sessionState, { skipHeavyFields: true })

  logger.info(`[${projectId}] Publishing session status (phase=${sessionState.todo_state.phase})`)

  // HTTP callback to API service -- the API pushes to SSE via SSEFactory.
  // Throws on 5xx (and network errors) so the activity is retried
  // (maximumAttempts=3, initialInterval=1s). A brief API outage would otherwise
  // leave the timeline with stale is_processing/phase and no recovery path.
  const res = await postToInternalApi('/status', {
    projectId,
    status: response,
  })
  if (res.status >= 500) {
    throw new Error(`[${projectId}] Status callback server error: ${res.status} — will retry`)
  }
  if (!res.ok) {
    logger.warn(`[${projectId}] Status callback failed: ${res.status}`)
  }
}
