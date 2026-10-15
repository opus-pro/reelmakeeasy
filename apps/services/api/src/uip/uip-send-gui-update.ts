import { randomUUID } from 'node:crypto'

import type { ProjectVoiceOverJson } from '@shared/types/api/project'

import type { PrismaService } from '../prisma/prisma.service'

import { appendGuiEditWithSessionChanged } from './uip-gui-edit'
import { validateScriptReviewInput } from './uip-script-validation'
import { assertActiveSession } from './uip-session-assertions'
import { withSessionLock } from './uip-session-lock'
import { buildStatePatch } from './uip-state-patch'
import type { GuiEditKind, UipSessionState } from './uip-timeline-types'

export async function sendGuiUpdateFn(
  projectId: string,
  input: { transcript?: string; voice?: ProjectVoiceOverJson; voicePreviewSpeed?: number },
  session: { phase?: null | string; state?: unknown; status?: string },
  deps: {
    prisma: PrismaService
    signalWorkflow: (projectId: string, signal: string, payload: unknown) => Promise<void>
  },
): Promise<void> {
  const { prisma, signalWorkflow } = deps
  const sessionState = (session.state as null | UipSessionState) ?? {}
  const kinds = new Set<GuiEditKind>()
  let speedChanged = false

  if (input.transcript !== undefined) {
    assertActiveSession(session, 'script_review', 'update transcript')
    validateScriptReviewInput(input.transcript, sessionState)
    kinds.add('script_edit')
  }

  if (input.voicePreviewSpeed !== undefined) {
    assertActiveSession(session, 'script_review', 'update voice preview speed')
    const voicePreviewSpeed = normalizeVoicePreviewSpeed(input.voicePreviewSpeed)
    await withSessionLock(prisma, projectId, { state: true }, ({ state }) => {
      if (state.voice_preview_speed === voicePreviewSpeed) {
        return { write: { state: 'abandon' }, changes: [] }
      }
      speedChanged = true
      const nextState: UipSessionState = { ...state, voice_preview_speed: voicePreviewSpeed }
      return {
        write: { state: nextState },
        changes: [{ kind: 'state', state: buildStatePatch(state, nextState) }],
      }
    })
  }

  // Voice is validated and persisted later in UipService.sendGuiUpdate, but it
  // must be gated here too: it participates in the signal-only branch below, so
  // without this an inactive or non-script_review session could reset the gate
  // deadline before that check runs. `!= null` also drops a no-op voice: null.
  const hasVoiceEdit = input.voice != null
  if (hasVoiceEdit) {
    assertActiveSession(session, 'script_review', 'update voice')
  }

  const hasScriptEdit = kinds.size > 0

  // Voice and speed are live gate edits too: they must reset the script-review
  // auto-continue deadline, which only happens via the uip-gui-update signal
  // (user_gui_update is a foldDeadline reset). Without this the gate could
  // auto-continue while the user is actively changing voice or speed.
  if (!hasScriptEdit && !speedChanged && !hasVoiceEdit) {
    return
  }

  // Persist the confirmed transcript synchronously so the confirm handoff uses
  // the exact text the user saw. working_script in storage is only updated
  // via the async uip-gui-update signal below and so can lag the saved text.
  // This DB write is API-owned and the FE awaits this save before "Create video",
  // so the confirm always sees the confirmed transcript.
  if (input.transcript !== undefined) {
    await prisma.uipSession.update({
      where: { projectId },
      data: { confirmedScript: input.transcript },
    })
  }

  // A transcript edit writes gui_edit + session_changed (script) atomically so
  // SSE is pushed immediately, even while a planner activity is running. A
  // voice/speed-only edit carries no script content, so it just needs the
  // deadline-reset signal with a fresh requestId and no gui_edit.
  let requestId: string
  if (hasScriptEdit) {
    const guiEdit = await appendGuiEditWithSessionChanged(prisma, projectId, {
      kinds: Array.from(kinds),
      script: input.transcript === undefined ? undefined : { content: input.transcript },
    })
    requestId = guiEdit.requestId
  } else {
    requestId = randomUUID()
  }
  await signalWorkflow(projectId, 'uip-gui-update', { requestId, transcript: input.transcript })
}

function normalizeVoicePreviewSpeed(value: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return 1
  }
  return Number(Math.min(2, Math.max(0.5, value)).toFixed(2))
}
