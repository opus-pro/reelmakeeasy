import { isPhaseAtOrAfterVisualRenderLock } from '@/components/story-mode-user-intent-planner/adapter/session-view-adapter/constants'
import type { RenderState } from '@/components/story-mode-user-intent-planner/state-types'

type LockInputs = Pick<RenderState, 'isLocked' | 'phase' | 'status'>

/**
 * The session accepts no further change of any kind. Every uip write asserts
 * `status === 'active'`, and sendMessage -- the only way to change an artifact the GUI cannot
 * edit -- asserts nothing else, so this is the outer boundary for agent-driven artifacts.
 * `isLocked` is redundant in principle (locked_at derives status 'completed') but is kept so a
 * session_changed event carrying locked_at without status still reads as closed.
 *
 * Therefore the sole producer of a Locked badge: the badge promises immutability, and
 * this is the only predicate that delivers it. `locked_at` is stamped in commitUipConfirmedLock
 * after the render workflow starts, so the badge lands exactly at the video confirm gate.
 */
export function isSessionClosed(renderState: LockInputs): boolean {
  return renderState.isLocked || renderState.status !== 'active'
}

/**
 * The user can no longer influence the pre-visual artifacts -- brief, script, voiceover. Adds the
 * script_review -> bootstrap_visual boundary that sendGuiUpdate and sendSummaryUpdate enforce on top of
 * isSessionClosed: those three stop accepting user input the moment the phase advances, well
 * before locked_at is stamped.
 *
 * Never a Locked-badge predicate: it gates the GUI edit path (summary-actions,
 * StoryModeCanvas's read-only mode) and nothing else. The agent keeps maintaining the brief and
 * re-voicing the transcript past this point, so a Locked badge here would promise a stillness the
 * section does not have.
 */
export function isPastUserEditWindow(renderState: LockInputs): boolean {
  return isSessionClosed(renderState) || isPhaseAtOrAfterVisualRenderLock(renderState.phase)
}

/** A section that is committed for the rest of the session -- no GUI edit, no agent escape. */
export const PERMANENT_LOCK_REASON = 'This section can no longer be changed.'

// "Locked", not "completed": confirm-fast stamps locked_at the moment the workflow starts, so
// this shows while the video is still rendering -- and the header says "Creating your video..."
// right then (sessionStatusMessage.ts). Saying the session completed would contradict it.
export const SESSION_CLOSED_LOCK_REASON = 'This session is locked. No further changes can be made.'
