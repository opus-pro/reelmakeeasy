/**
 * checkDeadlineExpiredActivity -- Local Activity
 *
 * Called by the workflow when a phase deadline expires. Asks the API to decide
 * the actual action: confirm, continue (auto), or extend (user is still editing).
 *
 * Replacing the old unidirectional auto-confirm: the workflow now passes its
 * intended action to the API, and the API returns the real decision.
 */

import { createSubLogger } from '@reelmakeeasy/common/logger'

import { postToInternalApi } from './common'

const logger = createSubLogger('uip-check-deadline-expired')

export type DeadlineExpiredDecision =
  | { action: 'activity'; activityAt: string; deadline: string }
  | { action: 'confirm' }
  | { action: 'continue' }
  | { action: 'extend'; deadline: string }

export async function checkDeadlineExpiredActivity(input: {
  // force=true skips the API-side persisted-deadline re-check (the "extend if
  // still in the future" gate). The V2 workflow owns the deadline timer +
  // busy-defer/cap, so when it fires it has already decided NOT to extend; the
  // API must dispatch, not re-decide (and its persisted deadline races the
  // concurrent V2 sync-loop persist). V1 omits force -> re-check preserved.
  force?: boolean
  intent: 'confirm' | 'continue'
  projectId: string
}): Promise<DeadlineExpiredDecision> {
  const { projectId, intent, force } = input

  logger.info(`[${projectId}] Checking deadline-expired (intent=${intent}, force=${!!force})`)

  const res = await postToInternalApi('/deadline-expired', { projectId, intent, force })

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`deadline-expired check failed: ${res.status} ${body}`)
  }

  const decision = (await res.json()) as DeadlineExpiredDecision
  logger.info(`[${projectId}] deadline-expired decision: ${decision.action}`)
  return decision
}
