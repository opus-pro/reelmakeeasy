import type { RenderState, ScriptTranscriptBlock } from '../state-types'

/**
 * Single source of truth for "is this transcript editable right now".
 * Extracted from ScriptTranscriptBlockItem so the canvas Script section's Edit button
 * (whether to show it) and the editor itself (whether the textarea accepts input) can
 * never drift apart. Editing is allowed only in the script_review phase of an active
 * session, on the current (non-outdated) block, and never for user-audio sessions
 * (those transcripts are not modifiable). `isAudioMode` is resolved by the caller
 * because its source differs between the current block and outdated versions.
 *
 * `isLocked` belongs here rather than in any one caller: a session_changed event can carry
 * locked_at without status, so the status check alone would leave a locked session editable --
 * and a caller that adds the term itself is a gate the other callers silently lack.
 */
export function canEditScriptTranscript(
  renderState: RenderState,
  block: Pick<ScriptTranscriptBlock, 'blockStatus'>,
  isAudioMode: boolean,
): boolean {
  return (
    !renderState.isLocked &&
    renderState.status === 'active' &&
    renderState.phase === 'script_review' &&
    !isAudioMode &&
    block.blockStatus !== 'outdated'
  )
}
