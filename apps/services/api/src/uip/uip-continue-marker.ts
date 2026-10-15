/**
 * The "continued" marker on a UIP session (UipSession.continuedAt): stamped once
 * when the draft is committed at "Create video" (the user click, or the review
 * deadline auto-continuing). Confirm refuses to start a render for a session that
 * never continued, supersede leaves a committed session alone, and the image
 * model locks once it is set.
 *
 * Separated from uip.service.ts to keep that file under the max-lines limit.
 */
import { createSubLogger } from '@reelmakeeasy/common/logger'
import type { Spec } from '@reelmakeeasy/uip-planner-runtime'
import { BadRequestException, NotFoundException } from '@nestjs/common'

import type { PrismaService } from '../prisma/prisma.service'

import { extractScriptFromSpec } from './uip-planner-utils'
import { fileStore } from '@reelmakeeasy/common/storage/file-store'

const logger = createSubLogger('uip-service')

/**
 * Stamp the continued marker. Idempotent: returns `marked: false` when the session
 * already continued (a double click or a retried dispatch), so callers can key
 * once-only analytics on `marked: true`.
 *
 * Throws when a non-audio session has no script yet: there is nothing to render.
 */
export async function markSessionContinued(
  prisma: PrismaService,
  projectId: string,
): Promise<{ marked: boolean }> {
  const [project, uipSession] = await Promise.all([
    prisma.project.findUnique({ where: { id: projectId }, select: { id: true } }),
    prisma.uipSession.findUnique({
      where: { projectId },
      select: { confirmedScript: true, continuedAt: true },
    }),
  ])
  if (!project) {
    throw new NotFoundException(`Project not found: ${projectId}`)
  }
  if (uipSession?.continuedAt) {
    logger.info(`[${projectId}] Session already continued, skipping`)
    return { marked: false }
  }

  // At script_review -> bootstrap_visual ("Create video"), shots have NOT been
  // generated yet, so the script lives in the session state's working_script.
  // Prefer the transcript the user confirmed at "Create video".
  const uipPrefix = `projects/${projectId}/user-intent-planner`
  const [specDownload, sessionStateDownload] = await Promise.all([
    fileStore.file(`${uipPrefix}/spec/current/spec.json`).read(),
    fileStore.file(`${uipPrefix}/session-state.json`).read(),
  ])
  const spec = JSON.parse(specDownload.toString()) as Spec
  const sessionState = JSON.parse(sessionStateDownload.toString()) as {
    cached_artifacts?: { working_script?: { script?: string } }
  }
  const script =
    uipSession?.confirmedScript?.trim() ||
    (spec?.visual_script?.shots?.length
      ? extractScriptFromSpec(spec)
      : (sessionState.cached_artifacts?.working_script?.script?.trim() ?? ''))
  // Uploaded audio (e.g. a music video) legitimately has no script: the audio is
  // the source (instrumental "Song to Video").
  if (!script && spec.meta?.audio_source !== 'user_audio') {
    throw new BadRequestException('Cannot continue: no script available yet')
  }

  await prisma.uipSession.update({ where: { projectId }, data: { continuedAt: new Date() } })
  logger.info(`[${projectId}] Session continued`)
  return { marked: true }
}

/**
 * Clear the continued marker when a session is cancelled. Best-effort: errors are
 * logged, not thrown, so the cancel always proceeds.
 */
export async function clearSessionContinued(
  prisma: PrismaService,
  projectId: string,
): Promise<void> {
  try {
    await prisma.uipSession.updateMany({
      where: { continuedAt: { not: null }, projectId },
      data: { continuedAt: null },
    })
  } catch (err) {
    logger.error(
      `[${projectId}] Failed to clear the continued marker on cancel: ${
        err instanceof Error ? err.message : String(err)
      }`,
    )
  }
}
