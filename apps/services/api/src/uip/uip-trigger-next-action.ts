/**
 * triggerNextAction logic for UIP sessions.
 *
 * Separated from uip.service.ts to keep that file under the max-lines limit.
 */
import { createSubLogger } from '@reelmakeeasy/common/logger'
import { NotFoundException } from '@nestjs/common'

import type { PrismaService } from '../prisma/prisma.service'

import { UipEmptyPlanConfirmError } from './uip-confirm-errors'
import type { ConfirmFastOrchestrationResult } from './uip-confirm-fast-orchestration'
import { clearSessionContinued, markSessionContinued } from './uip-continue-marker'
import { claimNextAction, selectNextAction } from './uip-next-action'
import { resolveActionEvents } from './uip-timeline-lock-writers'
import type { UipSessionState } from './uip-timeline-types'

export type TriggerNextActionFnDeps = {
  executeConfirmFastOrchestration: (projectId: string) => Promise<ConfirmFastOrchestrationResult>
  executeConfirmOrchestration: (projectId: string) => Promise<boolean>
  prisma: PrismaService
  signalWorkflow: (projectId: string, signal: string, payload?: unknown) => Promise<void>
}

export type TriggerNextActionResult =
  | { actionId: null; status: 'idle' }
  | { actionId: string; status: 'dispatched' }
  | {
      actionId: string
      reason: 'empty_plan' | 'word_cap_exceeded'
      status: 'action_required'
    }

const logger = createSubLogger('uip-service')

export async function triggerNextActionFn(
  projectId: string,
  deps: TriggerNextActionFnDeps,
): Promise<TriggerNextActionResult> {
  const { prisma, signalWorkflow } = deps

  const { decision, actionId } = await selectNextAction(prisma, projectId)
  if (decision.action === 'idle' || !actionId) {
    return { actionId: null, status: 'idle' }
  }

  // Fail-closed: a deleted project must never advance its session.
  // `project.deleted` cancels the session at the source, but that cancel can be
  // refused when another action is already pending, and a future delete path
  // could skip the event entirely. This is the single choke point where the
  // session continues and the render starts, so refuse here too -- and cancel rather
  // than idle, so an orphaned session converges instead of re-firing its
  // deadline forever.
  if (
    decision.action === 'confirm' ||
    decision.action === 'confirm_fast' ||
    decision.action === 'continue'
  ) {
    const refused = await refuseDeletedProjectAdvance(projectId, actionId, decision.action, deps)
    if (refused) {
      return refused
    }
  }

  if (decision.action === 'cancel') {
    // Best-effort: clear the continued marker before signalling.
    await clearSessionContinued(prisma, projectId)
    await signalWorkflow(projectId, 'uip-cancel-session', { actionId, gateToken: '' })
    await resolveActionEvents(prisma, projectId, ['cancel'])
  } else if (decision.action === 'confirm') {
    const earlyResult = await dispatchConfirm(projectId, actionId, deps)
    if (earlyResult) {
      return earlyResult
    }
  } else if (decision.action === 'confirm_fast') {
    const earlyResult = await dispatchConfirmFast(projectId, actionId, deps)
    if (earlyResult) {
      return earlyResult
    }
  } else if (decision.action === 'continue') {
    const earlyResult = await dispatchContinue(projectId, actionId, deps)
    if (earlyResult) {
      return earlyResult
    }
  } else if (decision.action === 'user_messages') {
    await signalWorkflow(projectId, 'uip-user-messages', {
      actionId,
      messages: decision.messages.map((m) => ({
        answerToMessageId: m.answer_to_message_id,
        brandDraftEdits: m.brandDraftEdits,
        clientMessageId: m.client_message_id,
        message: m.message,
        messageId: m.record_id,
        sentAt: m.sent_at,
        sentFrom: m.sent_from,
        uploadedAssets: m.uploaded_assets,
      })),
    })
  }

  return { actionId, status: 'dispatched' }
}

/**
 * Orchestrate the render, then signal the confirm. Returns a
 * terminal result when the action is rejected, or null to fall through to
 * 'dispatched'.
 */
async function dispatchConfirm(
  projectId: string,
  actionId: string,
  deps: TriggerNextActionFnDeps,
): Promise<null | TriggerNextActionResult> {
  const { prisma, signalWorkflow } = deps
  // Orchestrate before signalling: write storage spec, update Project, start story-mode workflow.
  // Runs here (not in the user endpoint) so storage spec is guaranteed stable after workflow writes.
  // Idempotent on retry -- starting a workflow that already exists is a no-op.
  try {
    await deps.executeConfirmOrchestration(projectId)
  } catch (err) {
    // No retry can turn a zero-shot spec into a video, and this runs inside a
    // retried activity: rethrowing would burn every attempt and fail the
    // planner workflow for good. Reject the action so the session stays in
    // refinement and the user can keep planning.
    if (!(err instanceof UipEmptyPlanConfirmError)) {
      throw err
    }
    await resolveActionEvents(prisma, projectId, [])
    // No signal sent so the workflow will not claim the action -- claim it here.
    await claimNextAction(prisma, projectId, actionId)
    return { actionId, status: 'action_required', reason: 'empty_plan' }
  }
  await signalWorkflow(projectId, 'uip-confirm', { actionId })
  await resolveActionEvents(prisma, projectId, ['confirm'])
  return null
}

/**
 * confirm_fast owns its business preconditions inside orchestration: phase guard,
 * word-cap guard, continued marker, lock, and workflow start. Returns a terminal
 * result when the action is rejected, or null to fall through to 'dispatched'.
 */
async function dispatchConfirmFast(
  projectId: string,
  actionId: string,
  deps: TriggerNextActionFnDeps,
): Promise<null | TriggerNextActionResult> {
  const { prisma, signalWorkflow } = deps
  const result = await deps.executeConfirmFastOrchestration(projectId)
  if (result.status === 'action_required') {
    await resolveActionEvents(prisma, projectId, [], result.reason)
    // No signal sent so the workflow will not claim the action -- claim it here.
    await claimNextAction(prisma, projectId, actionId)
    return { actionId, status: 'action_required', reason: result.reason }
  }
  if (result.status === 'started') {
    await signalWorkflow(projectId, 'uip-confirm-fast', { actionId })
  }
  await resolveActionEvents(prisma, projectId, ['confirm_fast'])
  return null
}

/**
 * Mark the session continued, then signal the continue-draft. Returns null to
 * fall through to 'dispatched'.
 */
async function dispatchContinue(
  projectId: string,
  actionId: string,
  deps: TriggerNextActionFnDeps,
): Promise<null | TriggerNextActionResult> {
  const { prisma, signalWorkflow } = deps
  const session = await prisma.uipSession.findUnique({
    where: { projectId },
    select: { state: true },
  })
  if (!session) {
    throw new NotFoundException(`UIP session not found: ${projectId}`)
  }
  // Idempotent: a retried or duplicate dispatch finds the marker set.
  await markSessionContinued(prisma, projectId)
  // The V2 workflow validates continue-draft against the current review-gate
  // token (foldCurrentGateToken). Send the real token persisted on the session
  // state -- an empty token never matches the workflow's review_gate_opened
  // uuid, so the signal would be silently dropped and the session would stall
  // in script_review.
  const gateToken = (session.state as null | UipSessionState)?.review_gate?.token ?? ''
  await signalWorkflow(projectId, 'uip-continue-draft', { actionId, gateToken })
  await resolveActionEvents(prisma, projectId, ['continue'])
  return null
}

/**
 * Turn an advance into a cancel when the project has been deleted. Returns a
 * terminal result when it fired, or null when the project is live and the
 * caller should proceed normally.
 */
async function refuseDeletedProjectAdvance(
  projectId: string,
  actionId: string,
  action: 'confirm' | 'confirm_fast' | 'continue',
  deps: TriggerNextActionFnDeps,
): Promise<null | TriggerNextActionResult> {
  const { prisma, signalWorkflow } = deps
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { isDeleted: true },
  })
  if (!project?.isDeleted) {
    return null
  }

  logger.warn(`[${projectId}] Refusing ${action}: the project is deleted -- cancelling the session`)

  // Best-effort, mirroring the cancel branch.
  await clearSessionContinued(prisma, projectId)
  await signalWorkflow(projectId, 'uip-cancel-session', { actionId, gateToken: '' })
  // The pending event is the refused advance, not a cancel, so it resolves as
  // rejected -- which is what happened to it.
  await resolveActionEvents(prisma, projectId, [])
  return { actionId, status: 'dispatched' }
}
