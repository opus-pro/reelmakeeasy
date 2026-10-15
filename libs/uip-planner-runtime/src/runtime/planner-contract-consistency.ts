import type { SessionState } from '../types'

import { buildConsistencyContext } from './consistency-context'
import type { PlannerOutputLike } from './runtime.types'

/**
 * Whether this output ends the planner's turn -- the last point at which it can
 * still address the ledger.
 *
 * Derived from the wake predicate rather than a hard-coded action list:
 * TOOL_CALLS is followed by a decision-worthy
 * tool_completed, MODE_CONFIRMED by a decision-worthy mode_confirmed, and
 * PATCH_SPEC by a decision-worthy planner-sourced spec_patched (folds.ts).
 */
function endsTurn(output: PlannerOutputLike): boolean {
  if (output.action === 'TOOL_CALLS' || output.action === 'PATCH_SPEC') {
    return false
  }
  // mode_confirmed is in DECISION_WORTHY_EVENT_TYPES (folds.ts:148) and
  // execute-decision.ts:218 appends it before the planner's next turn, so
  // MODE_CONFIRMED never ends the turn -- same reasoning as TOOL_CALLS.
  // Unreachable today only because MODE_CONFIRMED is legal solely in
  // mode_confirmation, and realizability.ts's NO_DISCHARGE_PHASES already
  // defers every entry there unconditionally -- two independent invariants
  // that happen to cancel out, not a reason to fold this into the
  // `return true` catch-all below.
  if (output.action === 'MODE_CONFIRMED') {
    return false
  }
  return true
}

/**
 * Reject a `stale_dispositions` array that is malformed independent of
 * whether the turn ends: a duplicate (artifact, source_path) pair, or a
 * `dismiss` with no reason.
 *
 * This is intentionally NOT a `PlannerOutputSchema` `.superRefine()`.
 * `PlannerOutputSchema` is passed straight through as `responseFormat` to
 * `completion`/`completionWithMeta` (call-planner.ts), and libs/llm
 * parses the model's raw JSON with `responseFormat` directly on the
 * model's raw output -- not just for the outbound wire schema. A refinement
 * failure there throws out of `callPlanner`'s try block, which is caught only
 * as "this layer failed" and cascades through the full chain-restart ->
 * Gemini fallback (three provider calls), potentially ending the entire
 * planner turn (`result: null`) if every layer repeats the same defect. That
 * is a categorically worse failure mode for a data-quality defect than a
 * normal guard rejection, which re-prompts the SAME call with a targeted
 * message. (Separately, `zod-to-json-schema`'s default `effectStrategy:
 * "input"` means a refinement would not even change the JSON schema
 * advertised to the model -- effects are unwrapped to their inner shape --
 * so schema-level validation would buy nothing on the wire while paying for
 * the retry-storm risk above.) See also the schema-layer comment on
 * `StaleDispositionSchema` in planner-schema.ts.
 */
function checkStaleDispositionsShape(
  dispositions: PlannerOutputLike['stale_dispositions'],
): null | string {
  const list = dispositions ?? []
  const seen = new Set<string>()
  const duplicates = new Set<string>()
  for (const d of list) {
    const key = `${d.artifact}::${d.source_path}`
    if (seen.has(key)) {
      duplicates.add(key)
    }
    seen.add(key)
  }
  if (duplicates.size > 0) {
    return (
      'stale_dispositions has more than one entry for the same (artifact, source_path) pair: ' +
      `${[...duplicates].join('; ')}. Each pair may appear at most once -- pick a single ` +
      'disposition for it.'
    )
  }
  const missingReason = list.filter((d) => d.disposition === 'dismiss' && !d.reason?.trim())
  if (missingReason.length > 0) {
    const listed = missingReason.map((d) => `${d.artifact} (${d.source_path})`).join('; ')
    return (
      `A dismiss disposition requires a non-empty reason: ${listed}. Add a reason explaining ` +
      'why the change does not actually invalidate the artifact.'
    )
  }
  return null
}

/**
 * Reject a turn-ending output that leaves an enforceable ledger entry
 * unaddressed -- OR a `stale_dispositions` array
 * that is malformed independent of whether the turn ends (a duplicate
 * (artifact, source_path) pair, or a `dismiss` with no reason). The shape
 * check runs BEFORE the turn-ending check and can reject on its own even on a
 * non-turn-ending output (e.g. TOOL_CALLS): a malformed output is malformed
 * regardless of whether the turn ends.
 *
 * The unaddressed-entry check does not judge WHETHER a change was material --
 * the ledger cannot decide that and neither can this function (section 4.6).
 * It forces the judgement to be STATED. `dismiss` with a reason is a passing
 * answer, by design: a logged "this does not actually invalidate the
 * storyboard" is strictly better telemetry than a silent plausible-looking
 * rewrite.
 */
export function checkConsistencyContract(
  session: SessionState,
  output: PlannerOutputLike,
): null | string {
  // Malformed independent of whether the turn ends -- a duplicate pair or a
  // reasonless dismiss is checked before endsTurn short-circuits a
  // non-turn-ending output (e.g. TOOL_CALLS), since a bogus disposition on a
  // non-final output would otherwise never get flagged at all.
  const shapeError = checkStaleDispositionsShape(output.stale_dispositions)
  if (shapeError) {
    return shapeError
  }
  if (!endsTurn(output)) {
    return null
  }
  const addressed = new Set(
    (output.stale_dispositions ?? []).map((d) => `${d.artifact}::${d.source_path}`),
  )
  const unaddressed = buildConsistencyContext(session).stale.filter(
    (entry) =>
      entry.status === 'enforceable' && !addressed.has(`${entry.artifact}::${entry.source_path}`),
  )
  if (unaddressed.length === 0) {
    return null
  }
  const listed = unaddressed
    .map((entry) => `${entry.artifact} (stale since ${entry.source_path} changed)`)
    .join('; ')
  return `These artifacts are recorded stale and this output does not address them: ${listed}. Add one stale_dispositions entry per item with the same artifact and source_path, and a disposition of tool, patch, ask, or dismiss. Use dismiss with a reason if the change does not actually invalidate the artifact.`
}
