/**
 * sendSummaryUpdateFn -- passive gui-update channel for editing the video
 * summary artifact's global_constraints fields (topic / directives /
 * must_not_violate). Reuses the transcript gui-update signal
 * (`uip-gui-update`) so a summary edit also resets the review-gate deadline,
 * like any other live edit. Modeled on sendGuiUpdateFn (uip-send-gui-update.ts).
 *
 * Gated on the user edit window: active session, folded phase before
 * `bootstrap_visual`, and no `locked_at`. This matches the canvas's Locked
 * badge (which flips at `bootstrap_visual`) and mirrors the visual-render-lock
 * gate in uip-set-style.ts -- once visual bootstrap starts, the summary is
 * baked into the render pipeline and can no longer be swapped.
 */
import { randomUUID } from 'node:crypto'

import { BadRequestException, ConflictException } from '@nestjs/common'

import { PHASE_RANK } from './uip-constants'
import { assertActiveSession } from './uip-session-assertions'

export interface SummaryUpdateGlobalConstraints {
  directives?: string[]
  must_not_violate?: string[]
  topic?: string
}

export async function sendSummaryUpdateFn(
  projectId: string,
  input: { globalConstraints?: SummaryUpdateGlobalConstraints; requestId?: string },
  session: { lockedAt?: Date | null; phase?: null | string; status?: string },
  deps: {
    signalWorkflow: (projectId: string, signal: string, payload: unknown) => Promise<void>
  },
): Promise<void> {
  assertActiveSession(session, null, 'update summary')
  const phaseRank = PHASE_RANK[session.phase ?? ''] ?? -1
  if (phaseRank >= PHASE_RANK['bootstrap_visual'] || session.lockedAt) {
    throw new ConflictException(
      `Cannot update summary: session ${projectId} has passed the visual-render lock ` +
        `(phase=${session.phase ?? 'unknown'}, locked_at=${session.lockedAt?.toISOString() ?? null}).`,
    )
  }
  if (!input.globalConstraints) {
    return
  }
  // SummaryUpdateDto's class-validator decorators document the wire shape but
  // don't run (this API installs no global ValidationPipe).
  // Enforce the topic/directives/must_not_violate whitelist at runtime instead,
  // so a client can't smuggle other global_constraints fields (e.g. style_mode,
  // script_word_cap, brand_video_type) through this endpoint. A whitelisted key
  // with a malformed value is rejected rather than coerced: filtering [123] to
  // [] would silently clear the user's list.
  const gc = input.globalConstraints
  const clean: SummaryUpdateGlobalConstraints = {}
  if (gc.topic !== undefined) {
    if (typeof gc.topic !== 'string') {
      throw new BadRequestException('topic must be a string')
    }
    clean.topic = gc.topic
  }
  for (const key of ['directives', 'must_not_violate'] as const) {
    const value = gc[key]
    if (value === undefined) {
      continue
    }
    if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
      throw new BadRequestException(`${key} must be an array of strings`)
    }
    clean[key] = value
  }
  if (Object.keys(clean).length === 0) {
    return
  }
  await deps.signalWorkflow(projectId, 'uip-gui-update', {
    requestId: input.requestId ?? randomUUID(),
    globalConstraints: clean,
  })
}
