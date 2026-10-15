/**
 * triggerNextActionActivity -- Local Activity
 *
 * Called by the workflow when a wake signal arrives (new protocol).
 * Asks the API to read current state, select the next pending action,
 * and send the authoritative workflow signal. The workflow then waits
 * for that authoritative signal on the next iteration.
 */

import { createSubLogger } from '@reelmakeeasy/common/logger'

import { postToInternalApi } from './common'

const logger = createSubLogger('uip-trigger-next-action')

export async function triggerNextActionActivity(input: { projectId: string }): Promise<void> {
  const { projectId } = input
  logger.info(`[${projectId}] Triggering next action`)
  const body = JSON.stringify({ projectId })
  const res = await postToInternalApi('/trigger-next-action', body, true)
  if (!res.ok) {
    throw new Error(`trigger-next-action failed: ${res.status}`)
  }
}
