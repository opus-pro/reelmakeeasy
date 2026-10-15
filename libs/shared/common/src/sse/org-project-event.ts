import {
  ORG_PROJECT_STREAM_EVENT_TYPE,
  type OrgProjectEventPayload,
} from '@shared/types/sse/org-project-event'

import { logger } from '../logger'

import { SSEFactory } from './factory'

export type {
  OrgProjectEventAction,
  OrgProjectEventPayload,
  OrgProjectEventResource,
  OrgProjectStreamEventType,
  ProcessingUpdateKind,
  ProcessingUpdateOutcome,
} from '@shared/types/sse/org-project-event'
export { ORG_PROJECT_STREAM_EVENT_TYPE } from '@shared/types/sse/org-project-event'

const ORG_BUS_PREFIX = 'org-project-events:'

/** Build the SSE bus key for org-level project change events. */
export function orgProjectEventBusKey(orgId: string): string {
  return ORG_BUS_PREFIX + orgId
}

/**
 * Push a project update event to the org-level SSE bus.
 * Fire-and-forget: errors are logged but never thrown so mutation
 * callers are never affected by notification failures.
 */
export async function pushOrgProjectEvent(
  orgId: null | string | undefined,
  payload: OrgProjectEventPayload,
): Promise<void> {
  if (!orgId) {
    return
  }

  try {
    const busKey = orgProjectEventBusKey(orgId)
    const bus = await SSEFactory.getSSEBus(busKey)
    if (!bus) {
      logger.warn('[org-project-event] Failed to get SSE bus for org %s', orgId)
      return
    }
    await bus.push({
      type: ORG_PROJECT_STREAM_EVENT_TYPE,
      data: JSON.stringify(payload),
    })
  } catch (err) {
    // Fire-and-forget: never let notification failure break mutations
    logger.warn(
      '[org-project-event] Failed to push event for org %s: %s',
      orgId,
      err instanceof Error ? err.message : String(err),
    )
  }
}
