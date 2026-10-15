/**
 * TTS-vendor script word-cap audit.
 *
 * The downstream TTS vendor has a hard per-video limit of
 * `SCRIPT_WORD_CAP` words. Runtime audits the current script after
 * every mutation (script tool completion, VS tool shot application,
 * any PATCH_SPEC op that touches audio_vo or shot structure) and stamps
 * the result on `spec.meta.script_word_cap`. Downstream gates consume
 * that flag to pause auto-timers and disable the Create-video CTA
 * until the user trims back under the cap.
 *
 * Audio-mode sessions (user uploaded their own voice) skip the audit
 * entirely: they do not route through the TTS vendor, and the ASR
 * transcript is immutable from the user's perspective.
 *
 * This module stays pure -- no `runtime` access, no logging, no reply
 * injection. Callers with access to `runtime` should use
 * `syncScriptWordCapAudit` in `runtime/script-word-cap-runtime.ts` to
 * attach the reply-injection side effect.
 */

import { EXPANDED_STORY_MODE_LIMITS } from '@reelmakeeasy/common/story-mode/user-limits'

import { getScriptSource } from '../runtime/session-runtime'
import type { SessionState } from '../types'
import { countWords } from '../word-budget'

/**
 * The TTS-vendor per-video word ceiling -- a single tier for every session
 * now that the long-video rollout is fully launched.
 */
export const SCRIPT_WORD_CAP = EXPANDED_STORY_MODE_LIMITS.absoluteMaxScriptWords

export interface ScriptWordCapAuditResult {
  cap: number
  exceeded: boolean
  word_count: number
}

export function getEffectiveScriptWordCap(_session: SessionState): number {
  return SCRIPT_WORD_CAP
}

/**
 * Compute the cap audit for the current session.
 *
 * Returns `null` when audit is not applicable:
 * - Audio-mode session (ASR path, does not hit TTS vendor).
 * - No script source yet (pre-script bootstrap).
 *
 * Returns `{ exceeded: true | false, word_count, cap }` otherwise.
 *
 * The word count reflects the SAME source of truth the rest of the
 * runtime uses for "current script" -- joined shot audio_vo when shots
 * exist, otherwise the staged `working_script.script`. See
 * `getScriptSource` for the precedence contract.
 */
export function auditScriptWordCap(session: SessionState): null | ScriptWordCapAuditResult {
  if (session.spec.meta.audio_source === 'user_audio') {
    return null
  }

  const script = getScriptSource(session)
  if (!script) {
    return null
  }

  const wordCount = countWords(script)
  const cap = getEffectiveScriptWordCap(session)
  return {
    cap,
    exceeded: wordCount > cap,
    word_count: wordCount,
  }
}

/**
 * Pure write: run the audit and stamp the result onto
 * `spec.meta.script_word_cap`. Safe for callers that do not have
 * access to `runtime` (e.g. `applyPatch`). No reply injection.
 *
 * For the full "audit + reply" composite, use
 * `syncScriptWordCapAudit` in the runtime layer.
 */
export function writeScriptWordCapAudit(session: SessionState): void {
  session.spec.meta.script_word_cap = auditScriptWordCap(session)
}
