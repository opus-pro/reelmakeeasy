import { pushOrgProjectEvent } from '@reelmakeeasy/common/sse/org-project-event'
import type {
  PersistedSessionState,
  PlannerPhase,
  SessionResponse,
  SessionStatus,
  Spec,
} from '@reelmakeeasy/uip-planner-runtime'
import { PROJECT_STAGE } from '@shared/types/enums/project'

import type { PrismaService } from '../prisma/prisma.service'

import { PHASE_RANK, terminalSessionStatus } from './uip-constants'
import { withSessionLock } from './uip-session-lock'
import { maxIsoTimestamp } from './uip-session-utils'
import { buildStatePatch } from './uip-state-patch'
import {
  buildAudioSourceState,
  buildReviewGateState,
  mergeTranscriptAndSessionChanged,
  resolveActionEvents,
  resolveGuiEditEvents,
} from './uip-timeline-lock-writers'
import type { UipTranscriptMessage } from './uip-timeline-merge'
import { mapPrevSessionStateRawToChangedEventInput } from './uip-timeline-transformers'
import type { SessionChangedEventInput } from './uip-timeline-types'

type LoggerLike = {
  info(message: string): void
  warn(message: string): void
}

export async function persistFromCallbackToStorage(params: {
  logger: LoggerLike
  newRawInput?: {
    sessionState?: null | unknown
    spec?: null | unknown
  }
  prisma: PrismaService
  projectId: string
  sessionState: unknown
}) {
  const { logger, newRawInput, prisma, projectId, sessionState } = params
  const state = sessionState as SessionResponse & {
    _cancelled?: boolean
    _failed?: boolean
    _timed_out?: boolean
    auto_continue_enabled?: boolean
    gui_request_ids?: string[]
    lockedAt?: null | string
    phase: string
    review_auto_continue_deadline_at?: null | string
    review_gate?: null | { token: string }
    specVersion: number
    transcript?: UipTranscriptMessage[]
  }

  const currentSession = await prisma.uipSession.findUnique({
    where: { projectId },
    select: {
      projectId: true,
      lockedAt: true,
      phase: true,
      status: true,
      state: true,
      stateVersion: true,
    },
  })
  if (!currentSession) {
    return
  }

  const alreadyLocked = Boolean(currentSession.lockedAt)

  const newRank = PHASE_RANK[state.phase] ?? -1
  const oldRank = PHASE_RANK[currentSession.phase ?? ''] ?? -1
  if (newRank >= 0 && oldRank >= 0 && newRank < oldRank) {
    logger.warn(
      `[${projectId}] persist callback dropped: phase regression ${currentSession.phase} -> ${state.phase} (likely stale attempt after retry)`,
    )
    return
  }

  const wasAlreadyTerminal = terminalSessionStatus.is(currentSession.status as SessionStatus)
  let newStatus = currentSession.status as SessionStatus
  if (!wasAlreadyTerminal) {
    // Pass the DB lockedAt (alreadyLocked) as well as the snapshot's: confirm
    // may have set uipSession.lockedAt out-of-band while this persist carried a
    // pre-lock snapshot. Resolving from the DB state too means a stale persist
    // reconciles such a row to 'completed' instead of leaving it 'active'.
    newStatus = resolveSessionStatusFromState(state, alreadyLocked)
    if (newStatus === 'cancelled' || newStatus === 'timed_out') {
      await prisma.project.update({
        where: { id: projectId },
        data: { stage: PROJECT_STAGE.CANCELED },
      })
    } else if (newStatus === 'failed') {
      await prisma.project.update({
        where: { id: projectId },
        data: { stage: PROJECT_STAGE.FAILED },
      })
    }
  }

  const inputSpec = (newRawInput?.spec ?? null) as null | {
    meta?: {
      audio_source?: 'user_audio' | null
      auto_lock_deadline_at?: null | string
      script_word_cap?: null | { exceeded?: boolean }
    }
  }
  const audioSource = inputSpec?.meta?.audio_source
  const scriptWordCapExceeded = inputSpec?.meta?.script_word_cap?.exceeded ?? null
  const inputPersistedState = (newRawInput?.sessionState ?? null) as null | {
    auto_continue_enabled?: boolean
    brand_telemetry?: { brief_edit_count?: number; files_uploaded_count?: number }
    review_auto_continue_deadline_at?: null | string
    review_gate?: null | { token?: string }
  }
  const currentPersistedState = currentSession.state as null | {
    review_gate?: null | { token?: string }
  }
  const brandTelemetry = inputPersistedState?.brand_telemetry
  await prisma.uipSession.update({
    where: { projectId },
    data: {
      phase: state.phase,
      status: newStatus,
      specVersion: state.specVersion,
      // Never write null: lockedAt is set-once (a confirmed session does not
      // un-lock). Writing null here clobbered confirm-orchestration's lockedAt
      // in a read-modify-write race when this persist ran concurrently with the
      // confirm DB write -> the session looked unconfirmed and got swept-failed.
      // Leave it unchanged (undefined) when the snapshot carries no lockedAt.
      lockedAt: alreadyLocked ? undefined : state.lockedAt ? new Date(state.lockedAt) : undefined,
    },
  })

  await withSessionLock(prisma, currentSession, { state: true }, async ({ state: oldState }) => {
    let newState = oldState
    if (newState.phase !== state.phase) {
      newState = { ...newState, phase: state.phase }
    }
    if (newState.status !== newStatus) {
      newState = { ...newState, status: newStatus }
    }
    if (audioSource !== undefined) {
      newState = buildAudioSourceState(newState, audioSource)
    }
    if (
      scriptWordCapExceeded !== null &&
      newState.script_word_cap_exceeded !== scriptWordCapExceeded
    ) {
      newState = { ...newState, script_word_cap_exceeded: scriptWordCapExceeded }
    }
    if (
      inputPersistedState?.auto_continue_enabled !== undefined &&
      newState.auto_continue_enabled !== inputPersistedState.auto_continue_enabled
    ) {
      newState = {
        ...newState,
        auto_continue_enabled: inputPersistedState.auto_continue_enabled,
      }
    }
    if (alreadyLocked || newStatus === 'completed') {
      // A locked session has no live gate. This persist path only ever SETS
      // review_gate (the branch below) and never cleared it, so a stale
      // review_gate.auto_lock_deadline_at survived lock and the FE revived the
      // "confirm" CTA on the project / chat-history page (getSession serves this
      // persisted state with no re-fold). Clearing here is the single authoritative
      // clear: this callback is the last writer after EITHER lock path
      // (executeConfirmOrchestration or executeConfirmFastOrchestration).
      if (newState.review_gate) {
        newState = { ...newState, review_gate: undefined }
      }
    } else if (state.review_gate?.token) {
      newState = buildReviewGateState(
        newState,
        state.review_gate.token,
        state.review_auto_continue_deadline_at ?? null,
      )
    }
    if (
      brandTelemetry !== undefined &&
      JSON.stringify(newState.brand_telemetry ?? null) !== JSON.stringify(brandTelemetry)
    ) {
      newState = { ...newState, brand_telemetry: brandTelemetry }
    }
    // Never fabricate these from undefined: persistPayload does not carry the
    // live-status flags, so the live /status path (writeLiveStatusState) is their
    // sole owner. Writing undefined here clobbered the live value in the state
    // column, which the list API reads -- breaking the card's "Needs your input"
    // / "Agent is thinking" derivation. Only honor a value the snapshot defines.
    if (state.is_idle !== undefined && newState.is_idle !== state.is_idle) {
      newState = { ...newState, is_idle: state.is_idle }
    }
    if (
      state.is_running_planner_loop !== undefined &&
      newState.is_running_planner_loop !== state.is_running_planner_loop
    ) {
      newState = { ...newState, is_running_planner_loop: state.is_running_planner_loop }
    }
    if (newState === oldState) {
      return { write: { state: 'abandon' }, changes: [] }
    }
    return {
      write: { state: newState },
      changes: [{ kind: 'state', state: buildStatePatch(oldState, newState) }],
    }
  })

  const lastHistory = await prisma.history.findFirst({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  })
  const lastPersistedAt = lastHistory?.createdAt ?? new Date(0)
  const transcript = state.transcript ?? []
  const newMessages = transcript.filter((msg) => new Date(msg.timestamp) > lastPersistedAt)

  if (newMessages.length > 0) {
    await prisma.history.createMany({
      data: newMessages.map((msg) => {
        const hasOptions = Boolean(msg.options?.length)
        const hasExpectAssets = msg.expect_assets === true
        const hasExtra = msg.spec_version != null || msg.phase != null || hasExpectAssets
        const content =
          hasOptions || hasExtra
            ? JSON.parse(
                JSON.stringify({
                  ...(hasOptions ? { options: msg.options } : {}),
                  ...(hasExpectAssets ? { expect_assets: true } : {}),
                  ...(msg.spec_version == null ? {} : { spec_version: msg.spec_version }),
                  ...(msg.phase ? { phase: msg.phase } : {}),
                }),
              )
            : undefined
        return {
          projectId,
          role: msg.role === 'assistant' ? 'agent' : msg.role,
          text: msg.content,
          type: 'text',
          agentName: 'uip',
          content,
          createdAt: new Date(msg.timestamp),
        }
      }),
    })
  }

  const nextState: SessionChangedEventInput = {
    ...mapPrevSessionStateRawToChangedEventInput(
      {
        sessionState: (newRawInput?.sessionState ?? null) as null | PersistedSessionState,
        spec: (newRawInput?.spec ?? null) as null | Spec,
      },
      state.phase as PlannerPhase,
    ),
    ...liveStatusFlagsForEmit(state),
    status: newStatus,
    spec_version: state.specVersion,
  }

  await mergeTranscriptAndSessionChanged(prisma, projectId, {
    nextState,
    transcript,
    ts: new Date().toISOString(),
  })

  emitUipReviewCheckpointIfReady({
    currentPhase: currentSession.phase,
    logger,
    nextPhase: state.phase,
    prisma,
    projectId,
    reviewMode: inputPersistedState?.auto_continue_enabled === false ? 'manual' : 'auto',
    previousScriptGateToken: currentPersistedState?.review_gate?.token,
    scriptDeadlineAt: inputPersistedState?.review_auto_continue_deadline_at ?? null,
    scriptGateToken: inputPersistedState?.review_gate?.token,
    storyboardDeadlineAt: inputSpec?.meta?.auto_lock_deadline_at ?? null,
  })

  const persistResolved: Array<'cancel' | 'confirm' | 'continue'> = []
  if (newStatus === 'completed') {
    persistResolved.push('confirm')
  }
  if (newStatus === 'cancelled' || newStatus === 'timed_out') {
    persistResolved.push('cancel')
  }
  if (state.phase === 'bootstrap_visual') {
    persistResolved.push('continue')
  }
  if (persistResolved.length) {
    await resolveActionEvents(prisma, projectId, persistResolved)
  }

  await resolveGuiEditEvents(prisma, projectId, state.gui_request_ids ?? [])

  logger.info(
    `[${projectId}] Persisted from callback (phase=${state.phase}, ${newMessages.length} new messages)`,
  )
}

export async function writeLiveStatusState(
  prisma: PrismaService,
  projectId: string,
  res: SessionResponse,
): Promise<void> {
  await withSessionLock(prisma, projectId, { state: true }, ({ state: oldState }) => {
    let newState = oldState

    if (newState.is_idle !== res.is_idle) {
      newState = { ...newState, is_idle: res.is_idle }
    }
    if (newState.is_running_planner_loop !== res.is_running_planner_loop) {
      newState = { ...newState, is_running_planner_loop: res.is_running_planner_loop }
    }
    if (res.auto_lock_deadline_at) {
      const currentDeadline = newState.review_gate?.auto_lock_deadline_at ?? null
      const nextDeadline = maxIsoTimestamp(currentDeadline, res.auto_lock_deadline_at)
      if (nextDeadline && nextDeadline !== currentDeadline) {
        newState = {
          ...newState,
          review_gate: { ...newState.review_gate, auto_lock_deadline_at: nextDeadline },
        }
      }
    }

    if (newState === oldState) {
      return { write: { state: 'abandon' }, changes: [] }
    }
    return {
      write: { state: newState },
      changes: [{ kind: 'state', state: buildStatePatch(oldState, newState) }],
    }
  })
}

function emitUipReviewCheckpoint(params: {
  deadlineAt: null | string
  dedupeKey: string
  logger: LoggerLike
  prisma: PrismaService
  processingType: 'uip-script' | 'uip-storyboard'
  projectId: string
  reviewMode: 'auto' | 'manual'
}): void {
  const { deadlineAt, dedupeKey, logger, prisma, processingType, projectId, reviewMode } = params
  void prisma.project
    .findUnique({
      where: { id: projectId },
      select: { name: true, orgId: true, owner: true },
    })
    .then((project) => {
      if (!project) {
        return
      }
      return pushOrgProjectEvent(project.orgId, {
        action: 'processing-update',
        deadlineAt,
        dedupeKey,
        outcome: 'action-required',
        ownerLoginId: project.owner ?? null,
        processingType,
        projectId,
        projectTitle: project.name ?? null,
        resource: 'project',
        reviewMode,
        uipSessionId: projectId,
      })
    })
    .catch((err: unknown) => {
      logger.warn(
        `[${projectId}] ${processingType} notification failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      )
    })
}

function emitUipReviewCheckpointIfReady(params: {
  currentPhase: string
  logger: LoggerLike
  nextPhase: string
  previousScriptGateToken?: string
  prisma: PrismaService
  projectId: string
  reviewMode: 'auto' | 'manual'
  scriptDeadlineAt: null | string
  scriptGateToken?: string
  storyboardDeadlineAt: null | string
}): void {
  const scriptGateOpened =
    params.nextPhase === 'script_review' &&
    params.scriptGateToken !== undefined &&
    params.scriptGateToken !== params.previousScriptGateToken

  if (scriptGateOpened) {
    emitUipReviewCheckpoint({
      deadlineAt: params.scriptDeadlineAt,
      dedupeKey: `${params.projectId}:uip-script:${params.scriptGateToken}`,
      logger: params.logger,
      prisma: params.prisma,
      processingType: 'uip-script',
      projectId: params.projectId,
      reviewMode: params.reviewMode,
    })
  } else if (params.currentPhase !== params.nextPhase && params.nextPhase === 'refinement') {
    emitUipReviewCheckpoint({
      deadlineAt: params.storyboardDeadlineAt,
      dedupeKey: `${params.projectId}:uip-storyboard:refinement`,
      logger: params.logger,
      prisma: params.prisma,
      processingType: 'uip-storyboard',
      projectId: params.projectId,
      reviewMode: params.reviewMode,
    })
  }
}

/**
 * Transient live-status flags for the /persist session_changed -- emitted ONLY
 * when the snapshot actually defines them (never fabricate `false` from undefined).
 *
 * The persist payload (persistSessionSnapshot's persistPayload, shared by V1 and V2)
 * does NOT carry is_idle/is_processing/is_running_planner_loop, so in practice they
 * are undefined here and omitted on every persist. The live publishSessionStatus path
 * -- run-planner-turn's publishIntermediate during a turn, plus the idle publish -- is
 * the sole owner of these flags for both V1 and V2.
 *
 * The old `state.X ?? false` fabricated is_processing=false on every persist. V2
 * persists mid-tool (sync-loop persists on each persist-worthy event), so that ran
 * right after the live publishSessionStatus on the same tick and clobbered it: the FE
 * folds session_changed in order, so the persisted false won over the live true and the
 * "Thinking" indicator vanished ~2s into a running tool. (V1 never persists mid-tool, so
 * it never clobbered -- but it fabricated the same false; omitting is correct for both.)
 * Omitting undefined keys lets buildSessionChangedEventDiff skip them so the live publish
 * stays authoritative.
 */
function liveStatusFlagsForEmit(state: {
  is_idle?: boolean
  is_processing?: boolean
  is_running_planner_loop?: boolean
}): Partial<SessionChangedEventInput> {
  const flags: Partial<SessionChangedEventInput> = {}
  if (state.is_idle !== undefined) {
    flags.is_idle = state.is_idle
  }
  if (state.is_processing !== undefined) {
    flags.is_processing = state.is_processing
  }
  if (state.is_running_planner_loop !== undefined) {
    flags.is_running_planner_loop = state.is_running_planner_loop
  }
  return flags
}

function resolveSessionStatusFromState(
  state: {
    _cancelled?: boolean
    _failed?: boolean
    _timed_out?: boolean
    lockedAt?: null | string
  },
  alreadyLocked = false,
): SessionStatus {
  if (state._failed === true) {
    return 'failed'
  }
  if (state._cancelled === true) {
    return 'cancelled'
  }
  if (state._timed_out === true) {
    return 'timed_out'
  }
  // A locked session has been confirmed (handed off to the story-mode render
  // workflow), so it is terminally complete. Resolve from the
  // DB lockedAt (alreadyLocked) as well as the snapshot's, so a stale persist
  // that ran with a pre-lock snapshot still reconciles a confirmed row to
  // 'completed' rather than leaving it 'active'. Without this the row lingers at
  // status='active' and the stuck-session sweep incorrectly marks the succeeded project
  // FAILED.
  if (state.lockedAt || alreadyLocked) {
    return 'completed'
  }
  return 'active'
}
