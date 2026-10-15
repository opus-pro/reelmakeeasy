/**
 * claimNextActionActivity -- Local Activity
 *
 * Called by the workflow after it has durably received a dispatched action
 * signal (new protocol). Tells the API to clear the `nextAction` record for the
 * given actionId, releasing the at-least-once delivery guard so the next action
 * (e.g. continue) is not rejected by evaluateActionIntentGuards as a conflicting
 * pending action. Mirrors V1 run-planner-turn's claimAction(). Idempotent: the
 * API no-ops when the id does not match / is already cleared.
 */

import { createSubLogger } from '@reelmakeeasy/common/logger'

import { postToInternalApi } from './common'

const logger = createSubLogger('uip-claim-next-action')

export async function claimNextActionActivity(input: {
  actionId: string
  projectId: string
}): Promise<void> {
  const { actionId, projectId } = input
  logger.info(`[${projectId}] Claiming next action ${actionId}`)
  const body = JSON.stringify({ actionId, projectId })
  const res = await postToInternalApi('/claim-next-action', body, true)
  if (!res.ok) {
    throw new Error(`claim-next-action failed: ${res.status}`)
  }
}
