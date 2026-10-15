// Explicit user style switch. Skips the usual
// `this.service.setStyle` wrapper because uip.service.ts is at the max-lines
// cap -- mirrors editBrandBankOp (uip-brand-operations.ts): the op function
// accepts the service instance as its first arg and delegates to its public
// helpers (assertUipAccess, loadSession, signalWorkflow).

import { createSubLogger } from '@reelmakeeasy/common/logger'
import { UIP_INBOUND_SIGNALS } from '@reelmakeeasy/common/workflow/uip-v2-signal-names'
import { BadRequestException, ConflictException } from '@nestjs/common'

import type { UipService } from './uip.service'
import { PHASE_RANK } from './uip-constants'
import { toSavedAddress } from '@reelmakeeasy/common/storage/address'

const logger = createSubLogger('uip-set-style')

export interface SetStyleBody {
  styleName: string
  styleText: string
  styleThumbnailUrl?: string
}

/**
 * Signal the workflow with a user-driven style switch. The signal handler
 * (uip-v2/signal-handlers.ts) writes this as a REAL `spec_patched`
 * update_global_field on `style` + `style_source='auto_switched'` -- not a
 * passive global_constraints merge like scriptReviewUpdate -- so the
 * auto-style re-selection gate (foldStyleSource) honors the switch on a later
 * brief regen instead of re-picking over it.
 *
 * Lock enforcement (net-new -- neither image-model/update nor
 * script-review/update has this): once a session has passed the
 * visual-render lock -- folded phase >= bootstrap_visual, or `locked_at` is
 * already stamped -- the style is baked into the render pipeline and can no
 * longer be swapped. Reject with 409 instead of silently no-oping.
 */
export async function setStyle(
  svc: UipService,
  projectId: string,
  body: SetStyleBody,
): Promise<void> {
  await svc.assertUipAccess(projectId, 'write')
  const session = await svc.loadSession(projectId, {
    lockedAt: true,
    phase: true,
    status: true,
  })

  // Same active-session guard image-model/update and transition-video-model/
  // update use (requireActiveSession(projectId, null, ...)): a session that
  // already finished has no phase/lock state worth trusting for the switch,
  // and signaling its workflow would just throw at the workflow layer anyway.
  if (session.status !== 'active') {
    throw new BadRequestException(`Cannot switch style: session ${projectId} is ${session.status}.`)
  }

  const phaseRank = PHASE_RANK[session.phase ?? ''] ?? -1
  if (phaseRank >= PHASE_RANK['bootstrap_visual'] || session.lockedAt) {
    throw new ConflictException(
      `Cannot switch style: session ${projectId} has passed the visual-render lock ` +
        `(phase=${session.phase ?? 'unknown'}, locked_at=${session.lockedAt?.toISOString() ?? null}).`,
    )
  }

  await svc.signalWorkflow(projectId, UIP_INBOUND_SIGNALS.setStyle, {
    styleName: body.styleName,
    styleText: body.styleText,
    styleThumbnailUrl: toSavedAddress(body.styleThumbnailUrl),
  })
  logger.info(`[${projectId}] Style switch dispatched (auto_switched)`)
}
