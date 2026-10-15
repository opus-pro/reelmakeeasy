/**
 * Runtime-layer wrapper for the TTS word-cap audit.
 *
 * Combines the pure audit pass (`writeScriptWordCapAudit` in
 * tool-internals/script-word-cap-audit.ts) with the side effect of
 * injecting an agent reply when the cap is exceeded. Keeps the pure
 * audit reusable from `patch-apply.ts` (which has no `runtime`
 * access), while tool-runtime callers that DO have runtime use this
 * wrapper to surface the cap notice to the user in the same turn.
 *
 * Reply-frequency contract (by user decision): emit an agent reply
 * EVERY time audit finds `exceeded: true`, not only on the first
 * transition from ok -> exceeded. The runtime gates (script_review
 * auto-continue, refinement auto-lock, Create-video CTA) separately
 * ensure the session does not auto-advance while exceeded.
 */

import {
  auditScriptWordCap,
  type ScriptWordCapAuditResult,
} from '../tool-internals/script-word-cap-audit'
import type { SessionState } from '../types'

interface ScriptWordCapRuntimeDeps {
  appendAgentReply: (session: SessionState, content: string) => void
}

function asDeps(runtime: object): ScriptWordCapRuntimeDeps {
  return runtime as ScriptWordCapRuntimeDeps
}

/**
 * Audit the session's current script, stamp the result on
 * `spec.meta.script_word_cap`, and inject an agent reply when the
 * cap is exceeded.
 *
 * Idempotent-adjacent: running it twice in a row with no script
 * change stamps the same result twice, and emits the reply twice
 * (intentional per contract). Callers that only want to recompute
 * the flag without the reply side effect should call
 * `writeScriptWordCapAudit` from the pure module instead.
 */
export function syncScriptWordCapAudit(runtime: object, session: SessionState): void {
  const result = auditScriptWordCap(session)
  session.spec.meta.script_word_cap = result
  if (result?.exceeded) {
    asDeps(runtime).appendAgentReply(session, buildExceededReply(result))
  }
}

function buildExceededReply(result: ScriptWordCapAuditResult): string {
  const over = result.word_count - result.cap
  const overText = over === 1 ? '1 word' : `${over} words`
  return (
    `Heads up — the current script is ${result.word_count} words, ` +
    `and our voice service caps each video at ${result.cap} words. ` +
    `Please trim about ${overText} and I'll continue.`
  )
}
