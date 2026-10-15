/**
 * Shared confirm-lock helpers for the UIP confirm and confirm-fast paths.
 *
 * The confirm-lock markers (UipSession.lockedAt / Project.uipLockedAt /
 * stage=STORY_LOADER / scriptConfirmed / session status=completed) must be
 * committed ONLY AFTER a durably-running story-mode workflow. Writing them before
 * `workflowClient.workflow.start` let a mid-flight interruption (an api pod SIGKILL
 * during a rollout) strand the session as permanently "confirmed" -- the confirm
 * preflight short-circuits every retry -- with no story-mode workflow ever
 * created (a "confirmed, no video" dead-end).
 *
 * `commitUipConfirmedLock` therefore runs only AFTER `workflow.start` in both
 * orchestrations and rethrows on failure: once the workflow is running a confirm
 * retry reconciles the lock via
 * the idempotent `workflow.start` (which `isWorkflowAlreadyStartedError` gates).
 */

import { createSubLogger } from '@reelmakeeasy/common/logger'
import type { PersistedSessionState, Spec } from '@reelmakeeasy/uip-planner-runtime'

import type { PrismaService } from '../prisma/prisma.service'

import { buildAudioModeProjectUpdate } from './uip-audio-voiceover.util'
import { buildUipDebugSettingsUpdate } from './uip-debug-settings'
import { withSessionLock } from './uip-session-lock'
import { buildStatePatch } from './uip-state-patch'
import type { UipSessionState } from './uip-timeline-types'

const logger = createSubLogger('uip-service')

type ConfirmLockProject = NonNullable<Awaited<ReturnType<PrismaService['project']['findUnique']>>>

type ConfirmLockUipSession = NonNullable<
  Awaited<ReturnType<PrismaService['uipSession']['findUnique']>>
>

/**
 * True for the workflow engine's "workflow already running" error. Matched by `name` (not
 * `instanceof`) so it survives dual-package / SDK-instance boundaries -- the
 * same convention used across long-take.service.ts and the story-mode workers.
 */
export function isWorkflowAlreadyStartedError(err: unknown): boolean {
  return err instanceof Error && err.name === 'WorkflowExecutionAlreadyStartedError'
}

// Map UIP spec's `global_constraints.style` to the `prisma.project.update` style
// fields at confirm time. `undefined` for absent/blank values so the spread skips
// them. Fields are already whitespace-normalized at spec write time; the extra
// `?.trim()` on `style_thumbnail_url` mirrors the backfill's posture for byte-identical output.
export function buildConfirmedProjectStyleUpdate(spec: Spec): {
  styleName: string | undefined
  styleText: string | undefined
  styleThumbnailUrl: string | undefined
} {
  const style = spec.global_constraints.style
  return {
    styleName: style.style_name || undefined,
    styleText: style.style_text || undefined,
    styleThumbnailUrl: style.style_thumbnail_url?.trim() || undefined,
  }
}

/**
 * Commit the confirm-lock markers after the story-mode workflow is durably
 * running. Rethrows on failure (a confirm retry reconciles); never refunds.
 */
export async function commitUipConfirmedLock(params: {
  prisma: PrismaService
  project: ConfirmLockProject
  projectId: string
  script: string
  sessionState: PersistedSessionState
  spec: Spec
  storyModeWorkflowId: string
  uipSession: ConfirmLockUipSession
}): Promise<void> {
  const {
    prisma,
    project,
    projectId,
    script,
    sessionState,
    spec,
    storyModeWorkflowId,
    uipSession,
  } = params
  try {
    const lockedAt = new Date()
    await Promise.all([
      prisma.project.update({
        where: { id: projectId },
        data: {
          stage: 'STORY_LOADER',
          script,
          scriptConfirmed: true,
          uipLockedAt: lockedAt,
          ...buildUipDebugSettingsUpdate(project.debugSettings, uipSession.transitionVideoModel),
          ...buildConfirmedProjectStyleUpdate(spec),
          // Reconcile voiceOverJson to a voice-over-attachment for
          // audio-mode uploads (UIP never runs the classic story-loader scanner,
          // so it would otherwise keep the default preset "Rachel"). No-op for
          // non-audio projects; render output is unaffected either way.
          ...buildAudioModeProjectUpdate({ projectId, sessionState, spec }),
        },
      }),
      (async () => {
        await withSessionLock(prisma, uipSession, { state: true }, ({ state }) => {
          const nextState: UipSessionState = { ...state, status: 'completed' }
          return {
            write: { state: nextState },
            changes: [{ kind: 'state', state: buildStatePatch(state, nextState) }],
          }
        })
        await prisma.uipSession.update({ where: { projectId }, data: { lockedAt } })
      })(),
    ])
  } catch (lockErr) {
    logger.error(
      `[${projectId}] UIP confirm orchestration started story-mode workflow workflowId=${storyModeWorkflowId} but failed to persist the confirm-lock; a confirm retry will reconcile via the idempotent start: ${
        lockErr instanceof Error ? lockErr.message : String(lockErr)
      }`,
    )
    throw lockErr
  }
}
