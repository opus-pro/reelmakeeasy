/**
 * Deadline expiry resolution for UIP sessions.
 *
 * Separated from uip.service.ts to keep that file under the max-lines limit.
 */
import { createSubLogger } from '@reelmakeeasy/common/logger'
import { USER_INACTIVITY_TIMEOUT_MS } from '@reelmakeeasy/common/workflow/uip-v2-deadline-policy'

import type { PrismaService } from '../prisma/prisma.service'

import { PENDING_ACTION_DEFER_MS, USER_ACTION_REQUIRED_RETRY_MS } from './uip-constants'
import { withSessionLock } from './uip-session-lock'
import { buildStatePatch } from './uip-state-patch'
import { evaluateActionIntentGuards } from './uip-timeline-lock-writers'
import type {
  NextActionRecord,
  TimelineEvent,
  TimelineEventPatch,
  TimelineFile,
  UipSessionState,
} from './uip-timeline-types'
import { triggerNextActionFn, type TriggerNextActionFnDeps } from './uip-trigger-next-action'

const logger = createSubLogger('uip-service')

export type DeadlineExpiredDecision =
  | { action: 'activity'; activityAt: string; deadline: string }
  | { action: 'extend'; deadline: string }

type SelectDeadlineActionResult =
  | { activityAt: string; deadline: string; kind: 'activity' }
  | { deadline: string; kind: 'extend' }
  | { kind: 'dispatch' }

export function latestActiveOperateAt(
  state: UipSessionState,
  nowMs: number,
): null | { activityAt: string; deadline: string } {
  let latest: null | { activityAt: string; timestampMs: number } = null

  for (const activityAt of Object.values(state.operate_at ?? {})) {
    const timestampMs = Date.parse(activityAt)
    if (!Number.isFinite(timestampMs) || timestampMs > nowMs) {
      continue
    }
    if (latest === null || timestampMs > latest.timestampMs) {
      latest = { activityAt, timestampMs }
    }
  }

  if (latest === null || nowMs >= latest.timestampMs + USER_INACTIVITY_TIMEOUT_MS) {
    return null
  }

  return {
    activityAt: latest.activityAt,
    deadline: new Date(latest.timestampMs + USER_INACTIVITY_TIMEOUT_MS).toISOString(),
  }
}

/**
 * Atomically evaluate all deadline-expiry guards and write pending_action if proceeding.
 * Mirrors the selectNextAction pattern: single withSessionLock covers all checks and the write.
 */
export async function resolveDeadlineExpiredFn(
  projectId: string,
  intent: 'confirm' | 'continue',
  deps: TriggerNextActionFnDeps,
  // force=true skips the persisted-deadline re-check below. The V2 workflow owns
  // the deadline timer + busy-defer/cap and only calls this once it has decided
  // to fire, so the API must dispatch rather than re-decide "extend" against a
  // deadline value that races the V2 sync-loop persist. V1 omits force.
  force = false,
): Promise<DeadlineExpiredDecision> {
  const { prisma } = deps

  const decision = await selectDeadlineAction(prisma, projectId, intent, force)

  if (decision.kind === 'activity') {
    logger.info(
      `[${projectId}] Deadline expired - active user heartbeat at ${decision.activityAt}, blocked until ${decision.deadline}`,
    )
    return { action: 'activity', activityAt: decision.activityAt, deadline: decision.deadline }
  }

  if (decision.kind === 'extend') {
    logger.info(`[${projectId}] Deadline expired - extending to ${decision.deadline}`)
    return { action: 'extend', deadline: decision.deadline }
  }

  const result = await triggerNextActionFn(projectId, deps)

  if (result.status === 'action_required') {
    const deadline = new Date(Date.now() + USER_ACTION_REQUIRED_RETRY_MS).toISOString()
    logger.info(`[${projectId}] Deadline expired - ${result.reason}, retrying at ${deadline}`)
    return { action: 'extend', deadline }
  }

  if (result.status === 'idle') {
    const deadline = new Date(Date.now() + PENDING_ACTION_DEFER_MS).toISOString()
    logger.info(
      `[${projectId}] Deadline expired - action already processed, extending to ${deadline}`,
    )
    return { action: 'extend', deadline }
  }

  // uipScriptConfirmed / uipVideoStarted are fired inside triggerNextActionFn with
  // confirmType='Auto' (derived from pending_action_source='deadline').
  const deadline = new Date(Date.now() + PENDING_ACTION_DEFER_MS).toISOString()
  logger.info(`[${projectId}] Deadline expired - dispatched ${intent}, rescheduling to ${deadline}`)
  return { action: 'extend', deadline }
}

async function selectDeadlineAction(
  prisma: PrismaService,
  projectId: string,
  intent: 'confirm' | 'continue',
  force: boolean,
): Promise<SelectDeadlineActionResult> {
  let extendDeadline: string = new Date(Date.now() + PENDING_ACTION_DEFER_MS).toISOString()
  const selected: { activity: null | { activityAt: string; deadline: string } } = {
    activity: null,
  }
  let shouldDispatch = false
  let proceedTimeline: null | TimelineFile = null

  await withSessionLock(
    prisma,
    projectId,
    { state: true, nextAction: true, timeline: true },
    ({
      state: current,
      nextAction,
      timeline,
    }: {
      nextAction: NextActionRecord | null
      state: UipSessionState
      timeline: TimelineFile
    }) => {
      extendDeadline = new Date(Date.now() + PENDING_ACTION_DEFER_MS).toISOString()
      selected.activity = null
      shouldDispatch = false
      proceedTimeline = timeline

      if (force) {
        const activeOperateAt = latestActiveOperateAt(current, Date.now())
        if (activeOperateAt) {
          selected.activity = activeOperateAt
          return {
            write: { state: 'abandon', nextAction: 'abandon', timeline: 'abandon' },
            changes: [],
          }
        }
      }

      const persistedDeadline =
        intent === 'continue'
          ? current.review_gate?.review_auto_continue_deadline_at
          : (current.review_gate?.auto_lock_deadline_at ?? null)

      // force (V2): the workflow already decided to fire; never re-extend.
      if (!force && persistedDeadline && persistedDeadline > new Date().toISOString()) {
        extendDeadline = persistedDeadline
        return {
          write: { state: 'abandon', nextAction: 'abandon', timeline: 'abandon' },
          changes: [],
        }
      }

      const guard = evaluateActionIntentGuards(
        current,
        nextAction as NextActionRecord | null,
        intent,
      )
      if (guard !== 'accepted') {
        // Only re-dispatch if the existing pending_action was itself deadline-initiated.
        // User-initiated pending_action: extend and let the workflow process it normally.
        shouldDispatch = guard === 'duplicated' && current.pending_action_source === 'deadline'
        return {
          write: { state: 'abandon', nextAction: 'abandon', timeline: 'abandon' },
          changes: [],
        }
      }

      const newState: UipSessionState = {
        ...current,
        pending_action: intent,
        pending_action_source: 'deadline',
      }

      const staleItems: TimelineEventPatch[] = []
      const updatedEvents = timeline.events.map((event): TimelineEvent => {
        if (event.type === 'action' && event.status === 'pending') {
          staleItems.push({ id: event.id, status: 'rejected' })
          return { ...event, status: 'rejected' }
        }
        return event
      })

      shouldDispatch = true
      proceedTimeline = { ...timeline, events: updatedEvents }
      return {
        write: {
          state: newState,
          nextAction: 'abandon',
          timeline: proceedTimeline,
        },
        changes: [
          { kind: 'state' as const, state: buildStatePatch(current, newState) },
          ...(staleItems.length
            ? [{ kind: 'timeline' as const, append: [] as never[], update: staleItems }]
            : []),
        ],
      }
    },
  )

  if (selected.activity) {
    return { kind: 'activity', ...selected.activity }
  }

  if (!shouldDispatch) {
    return { kind: 'extend', deadline: extendDeadline }
  }

  return { kind: 'dispatch' }
}
