import type { PrismaService } from '../prisma/prisma.service'

import {
  TRANSCRIPT_EDITING_DEADLINE_EXTENSION_MS,
  TRANSCRIPT_EDITING_STALE_MS,
} from './uip-constants'
import { withSessionLock } from './uip-session-lock'
import { maxIsoTimestamp } from './uip-session-utils'
import { buildStatePatch } from './uip-state-patch'
import { buildOperateAtState } from './uip-timeline-lock-writers'
import type { StateChanges, UipSessionState } from './uip-timeline-types'

type LoggerLike = {
  info(message: string): void
}

export function buildTranscriptEditingState(
  current: UipSessionState,
  active: boolean,
  clientId: string,
  staleMs: number,
  deadlineExtensionMs: number,
  nowMs = Date.now(),
): UipSessionState {
  const currentMap = Object.fromEntries(
    Object.entries(current.transcript?.editing_at ?? {}).filter(([, timestamp]) => {
      const tsMs = new Date(timestamp).getTime()
      return Number.isFinite(tsMs) && nowMs - tsMs < staleMs
    }),
  )
  if (active) {
    currentMap[clientId] = new Date(nowMs).toISOString()
  } else {
    delete currentMap[clientId]
  }

  const currentReviewGate = current.review_gate ?? {}
  // Skip re-arming the auto-continue deadline when the session opted
  // out -- the workflow never fires it, so a written value is a phantom
  // countdown. The operate_at heartbeat (buildOperateAtState below) still runs.
  const deadlineCandidate = new Date(nowMs + deadlineExtensionMs).toISOString()
  const reviewAutoContinueDeadline =
    current.auto_continue_enabled === false
      ? null
      : maxIsoTimestamp(
          currentReviewGate.review_auto_continue_deadline_at ?? null,
          deadlineCandidate,
        )

  const nextState: UipSessionState = {
    ...current,
    review_gate: {
      ...currentReviewGate,
      ...(reviewAutoContinueDeadline
        ? { review_auto_continue_deadline_at: reviewAutoContinueDeadline }
        : {}),
    },
    transcript: { ...current.transcript, editing_at: currentMap },
  }

  if (!active) {
    return nextState
  }
  return buildOperateAtState(nextState, clientId, staleMs, deadlineExtensionMs, nowMs)
}

export async function updateTranscriptEditingStateWithLock(params: {
  active: boolean
  clientId: string
  logger: LoggerLike
  prisma: PrismaService
  projectId: string
}): Promise<null | StateChanges> {
  const { active, clientId, logger, prisma, projectId } = params
  const lockResult = await withSessionLock(
    prisma,
    projectId,
    { state: true },
    async ({ state }) => {
      const newState = buildTranscriptEditingState(
        state,
        active,
        clientId,
        TRANSCRIPT_EDITING_STALE_MS,
        TRANSCRIPT_EDITING_DEADLINE_EXTENSION_MS,
      )
      return {
        write: { state: newState },
        changes: [{ kind: 'state', state: buildStatePatch(state, newState) }],
      }
    },
  )

  if (!lockResult?.state) {
    return null
  }

  logger.info(
    `[${projectId}] Transcript editing state updated: active=${active} clientId=${clientId}`,
  )
  return {
    state: lockResult.state.value,
    version: lockResult.state.version,
  }
}
