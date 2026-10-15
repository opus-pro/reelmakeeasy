import { randomUUID } from 'node:crypto'

import { UIP_INBOUND_SIGNALS } from '@reelmakeeasy/common/workflow/uip-v2-signal-names'

import type { PrismaService } from '../prisma/prisma.service'

import { withSessionLock } from './uip-session-lock'
import { buildStatePatch } from './uip-state-patch'
import type { UipSessionState } from './uip-timeline-types'

/**
 * Pure builder for the write-through state after a mid-session auto-continue
 * flip. Returns null when nothing needs writing. On disable, both
 * review-gate deadlines are cleared: the workflow will never fire them, so a
 * lingering value is a phantom countdown. On enable, arming is left to the
 * workflow persist (foldDeadline stamps the fresh deadline).
 */
export function buildAutoContinueState(
  current: UipSessionState,
  enabled: boolean,
): null | UipSessionState {
  const currentReviewGate = current.review_gate ?? {}
  const hasLiveDeadline =
    currentReviewGate.review_auto_continue_deadline_at != null ||
    currentReviewGate.auto_lock_deadline_at != null
  if (current.auto_continue_enabled === enabled && (enabled || !hasLiveDeadline)) {
    return null
  }
  return {
    ...current,
    auto_continue_enabled: enabled,
    ...(enabled
      ? {}
      : {
          review_gate: {
            ...currentReviewGate,
            auto_lock_deadline_at: null,
            review_auto_continue_deadline_at: null,
          },
        }),
  }
}

/**
 * Mid-session auto-continue flip. Two writes, in source-of-truth
 * order:
 *   1. Signal the workflow. The flip lands as a user_auto_continue_changed
 *      event, so foldAutoContinueEnabled (workflow timer + foldSession
 *      projection) reflects it from the next sync-loop wake.
 *   2. Write-through the persisted session state so SSE clients see the new
 *      setting immediately, without waiting for the workflow's own persist.
 *      Only values consistent with the signaled event are written, so a racing
 *      workflow persist converges on the same state.
 */
export async function setAutoContinueFn(
  projectId: string,
  enabled: boolean,
  deps: {
    prisma: PrismaService
    signalWorkflow: (projectId: string, signal: string, payload: unknown) => Promise<void>
  },
): Promise<void> {
  const { prisma, signalWorkflow } = deps

  await signalWorkflow(projectId, UIP_INBOUND_SIGNALS.setAutoContinue, {
    enabled,
    requestId: randomUUID(),
  })

  await withSessionLock(prisma, projectId, { state: true }, ({ state }) => {
    const nextState = buildAutoContinueState(state, enabled)
    if (nextState === null) {
      return { write: { state: 'abandon' }, changes: [] }
    }
    return {
      write: { state: nextState },
      changes: [{ kind: 'state', state: buildStatePatch(state, nextState) }],
    }
  })
}
