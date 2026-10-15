/**
 * Consistency-ledger helpers for the session fold, split out of
 * session-state.ts to keep that file under the max-lines cap.
 *
 * `markContextFor` takes `Spec` rather than the folded session state on purpose:
 * session-state.ts imports this module, so depending on its
 * `FoldedSessionState` would close an import cycle.
 */
import { createSubLogger } from '@reelmakeeasy/common/logger'
import type {
  MarkContext,
  PatchOp,
  PlannerOutputLike,
  SessionState,
  Spec,
  StaleEntry,
} from '@reelmakeeasy/uip-planner-runtime'
import {
  artifactsProducedBy,
  changedPathsForOps,
  clearStale,
  clearStaleByPatch,
  existingArtifactsOf,
  markStale,
  markStaleFromSourcePaths,
  WORKING_SCRIPT_SOURCE_PATH,
} from '@reelmakeeasy/uip-planner-runtime'

import type { AgentEvent } from '../../workflows/uip-v2/types'

const logger = createSubLogger('uip-v2-consistency')

function errMsg(error: unknown): string {
  try {
    return error instanceof Error ? error.message : String(error)
  } catch {
    // The conversion itself can throw: a thrown value carrying a throwing
    // Symbol.toPrimitive, or an Error subclass with a throwing `message` getter.
    // Exotic, but this helper lives inside the wrapper whose entire job is to
    // not throw -- an escape hatch here defeats the wrapper completely.
    return '<unstringifiable error>'
  }
}

/**
 * Run a ledger update under the same no-throw posture the rest of the fold's
 * finishing projection already uses (session-state.ts wraps
 * writeScriptWordCapAudit and applyValidation the same way).
 *
 * foldSession runs on the path of every activity. The ledger IS now read: it
 * feeds the planner's consistency context (buildConsistencyContext, wired
 * into context-builder.ts's `runtime.consistency`), so a throw in here would
 * brick every session's projection to fix one bad ledger update rather than
 * only staling the consistency context it feeds. On failure the ledger is
 * left exactly as it was: a missed mark under-reports, which is the
 * pre-ledger behaviour, and a missed clear over-reports. Both are recovered
 * by the next event that touches the same path.
 *
 * Remove this wrapper only when a silently stale consistency projection is
 * worse than bricking the whole fold over one bad ledger update. That is not
 * true today.
 */
export function safeLedgerUpdate(
  label: string,
  current: StaleEntry[] | undefined,
  compute: () => StaleEntry[],
): StaleEntry[] | undefined {
  try {
    return compute()
  } catch (error) {
    logger.warn(`[foldSession] ${label} skipped: ${errMsg(error)}`)
    return current
  }
}

/**
 * The mark context for a spec mutation. `suppressedArtifacts` stops a tool's own
 * writes re-marking what it just produced -- without it the anchor pair contract
 * livelocks, since satisfying an anchor entry requires a same-batch VS whose arm
 * mutates shots and re-marks anchors.
 */
function markContextFor(
  session: SessionState,
  timestamp: string,
  toolName?: string,
  suppressedSourcePaths?: readonly string[],
): MarkContext {
  const spec = session.spec
  return {
    audioMode: spec.meta.audio_source === 'user_audio',
    existingArtifacts: existingArtifactsOf(session),
    locked: spec.meta.locked_at != null,
    suppressedArtifacts: toolName ? artifactsProducedBy(toolName) : undefined,
    suppressedSourcePaths,
    timestamp,
  }
}

/**
 * Whether a global-constraints path actually changed value across a patch.
 * Non-global paths return true: only the patch tier needs the value-change
 * requirement, and its discharge paths are all global fields.
 */
function globalConstraintValueChanged(
  prevSpec: Spec,
  nextSpec: Spec,
  path: string,
  stableStringify: (value: unknown) => string,
): boolean {
  const prefix = 'global_constraints.'
  if (!path.startsWith(prefix)) {
    return true
  }
  const field = path.slice(prefix.length) as keyof Spec['global_constraints']
  return (
    stableStringify(prevSpec.global_constraints[field]) !==
    stableStringify(nextSpec.global_constraints[field])
  )
}

/**
 * The invocation params of a completed call, for the scope-aware clear.
 *
 * `ToolCompletedEvent` carries no params, so they are joined back from the
 * matching `tool_started.toolInput`. The anchor+VS batch dispatches as one
 * synthetic tool whose VS arm has no `tool_started` of its own, so its params
 * live at `toolInput.vs`.
 *
 * A closed `tool_started` survives compaction only inside the last-100-event
 * window, so the start can legitimately be absent. Returning undefined makes
 * `clearStale` KEEP a param-carrying entry: clearing on an unknown scope would
 * be the silent metric-lying discharge the scope-aware rule exists to prevent.
 * The log line is what keeps that visible rather than silent.
 */
function findToolCallParams(
  events: AgentEvent[],
  toolCallId: string,
  toolName: string,
): Readonly<Record<string, unknown>> | undefined {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const candidate = events[i]
    if (candidate.type !== 'tool_started' || candidate.toolCallId !== toolCallId) {
      continue
    }
    const input = candidate.toolInput as Record<string, unknown> | undefined
    if (!input) {
      return undefined
    }
    if (toolName === 'anchor_vs_batch') {
      return (input.vs as Record<string, unknown> | undefined) ?? undefined
    }
    return input
  }
  logger.warn(
    `[foldSession] no tool_started for ${toolName} (${toolCallId}); ` +
      'scope-carrying stale entries stay unresolved',
  )
  return undefined
}

/**
 * The ledger update for a `spec_patched` fold step: discharge what this patch
 * satisfied, then mark what it invalidated.
 *
 * Clear runs BEFORE mark, or a patch would discharge the very entries it is
 * about to create. And the provenance suppression covers ONLY the paths that
 * actually discharged an entry, not every changed path -- suppressing all of
 * them would stop a plain planner patch from marking anything at all, a silent
 * false negative where the feature simply never fires.
 */
export function foldPatchLedger(params: {
  ops: PatchOp[]
  prevSpec: Spec
  session: SessionState
  stableStringify: (value: unknown) => string
  timestamp: string
}): StaleEntry[] {
  const { ops, prevSpec, session, stableStringify, timestamp } = params
  const nextSpec = session.spec
  const changedPaths = changedPathsForOps(ops).filter((path) =>
    globalConstraintValueChanged(prevSpec, nextSpec, path, stableStringify),
  )
  const beforeClear = nextSpec.meta.stale_artifacts ?? []
  const afterClear = clearStaleByPatch(beforeClear, changedPaths)
  const dischargedEntries = beforeClear.filter((entry) => !afterClear.includes(entry))
  const dischargingPaths = changedPaths.filter((path) =>
    dischargedEntries.some((entry) => entry.discharge_paths?.includes(path)),
  )
  const marked = markStale(
    afterClear,
    ops,
    markContextFor(session, timestamp, undefined, dischargingPaths),
  )
  // Clear AGAIN over the freshly marked entries, with the same changed paths.
  //
  // The prompt mandates batching global-field edits into one atomic PATCH_SPEC,
  // so "write the directive and the tone it implies together" is the encouraged
  // shape. Clearing only before the mark meant a target co-written by this very
  // patch could not discharge the entry this patch created, and the next wake
  // saw an inconsistency the planner had already resolved -- on a confirm-urgency
  // edge, that surfaces as a question to the user about work already done.
  //
  // This is not a new rule, it is the existing one applied consistently:
  // clearStaleByPatch already means "any discharge path written => discharged",
  // so the same write arriving one fold step later WOULD have discharged the
  // entry. Ordering must not change the outcome. An entry cannot cancel itself
  // here, because no edge lists its own source among its discharge paths (see
  // the invariant in dependency-graph.test.ts).
  return clearStaleByPatch(marked, changedPaths)
}

/**
 * The ledger update for a tool-artifact apply. Tool auto-apply emits no
 * `spec_patched` event, so an event-only mark hook would miss the dominant
 * storyboard write path. The batch recurses with the REAL sub-tool names, so
 * the suppression here sees the actual producer.
 */
export function foldToolArtifactLedger(
  session: SessionState,
  ops: PatchOp[],
  timestamp: string,
  toolName?: string,
): StaleEntry[] {
  return markStale(
    session.spec.meta.stale_artifacts ?? [],
    ops,
    markContextFor(session, timestamp, toolName),
  )
}

/**
 * The ledger update for a manual GUI script edit.
 *
 * A transcript edit writes `cached_artifacts.working_script.script` and emits no
 * `PatchOp`, so `markStale` -- which derives its source keys from ops -- cannot
 * see it. Same shape as `foldToolArtifactLedger` above: a real artifact mutation
 * that produces no patch, and therefore needs its own mark hook or the edit is
 * invisible to the ledger.
 *
 * The caller is responsible for only invoking this when the transcript VALUE
 * changed. The API sends `transcript` whenever the field is present, and marking
 * from an unchanged value would manufacture staleness from a no-op.
 */
export function foldGuiScriptLedger(
  session: SessionState,
  timestamp: string,
  sourceChange: null | string,
): StaleEntry[] {
  return markStaleFromSourcePaths(
    session.spec.meta.stale_artifacts ?? [],
    [WORKING_SCRIPT_SOURCE_PATH],
    {
      ...markContextFor(session, timestamp),
      ...(sourceChange ? { sourceChanges: { [WORKING_SCRIPT_SOURCE_PATH]: sourceChange } } : {}),
    },
  )
}

/**
 * The ledger update for a `tool_completed` fold step.
 *
 * Keyed on the OUTER tool name: for the anchor+VS pair that is the synthetic
 * `anchor_vs_batch`, which resolves to both arms. This cannot live inside
 * `applyToolOutput` -- that receives neither the event log nor the call id, and
 * its batch branch recurses then returns before any trailing statement runs.
 */
export function foldToolCompletedLedger(
  spec: Spec,
  events: AgentEvent[],
  toolCallId: string,
  toolName: string,
  output: unknown,
): StaleEntry[] {
  return clearStale(
    spec.meta.stale_artifacts ?? [],
    // The output decides which batch arms actually produced -- a batch can
    // complete with only one arm committed.
    artifactsProducedBy(toolName, output),
    findToolCallParams(events, toolCallId, toolName),
  )
}

/** Shorthand for one entry of the planner's stale-disposition list. */
type StaleDisposition = NonNullable<PlannerOutputLike['stale_dispositions']>[number]

/** The composite (artifact, source_path) key shared by a claim and a ledger entry. */
function dispositionKey(claim: Pick<StaleDisposition, 'artifact' | 'source_path'>): string {
  return `${claim.artifact}::${claim.source_path}`
}

/**
 * The reason to apply for each key that is validly dismissable, keyed by
 * (artifact, source_path).
 *
 * A key qualifies only when it carries EXACTLY ONE claim across the whole
 * output, and that claim is a `dismiss` with a non-blank (post-`.trim()`)
 * reason. Grouping first and checking `claims.length !== 1` covers both a
 * conflicting non-`dismiss` sibling and a duplicate `dismiss` for the same
 * key in one pass -- there is no reason to special-case either, since both
 * mean the same thing: more than one claim about the same entry, so no
 * single claim can be trusted as THE disposition.
 */
function collectDismissableReasons(list: readonly StaleDisposition[]): Map<string, string> {
  const claimsByKey = new Map<string, StaleDisposition[]>()
  for (const claim of list) {
    const key = dispositionKey(claim)
    const claims = claimsByKey.get(key)
    if (claims) {
      claims.push(claim)
    } else {
      claimsByKey.set(key, [claim])
    }
  }
  const reasonsByKey = new Map<string, string>()
  for (const [key, claims] of claimsByKey) {
    if (claims.length !== 1) {
      continue
    }
    const [only] = claims
    const reason = only.disposition === 'dismiss' ? only.reason?.trim() : undefined
    if (reason) {
      reasonsByKey.set(key, reason)
    }
  }
  return reasonsByKey
}

/**
 * Apply the planner's dismissals to the ledger.
 *
 * ONLY `dismiss` is applied. `tool` and `patch` are claims about work in
 * flight; they are discharged by the evidence the fold already watches
 * (tool_completed, and a spec_patched that actually changes a discharge path).
 * Applying the claim itself would be the metric-lying discharge section 4.3
 * rejects: the ledger would report consistency the artifacts do not have.
 *
 * A dismissed entry stops being enforced, which is what stops the
 * dismiss -> re-block -> retry loop. A later change to the same path clears
 * `dismissed_at` in the mark step, so this is not permanent.
 *
 * A claim is refused -- the entry stays live and only real evidence
 * (`tool_completed`, or a value-changing `spec_patched`) can discharge it --
 * in exactly three cases, all detected by `collectDismissableReasons` above:
 *
 * 1. A key that carries a `dismiss` AND a non-dismiss disposition in the SAME
 *    output. `checkStaleDispositionsShape` (planner-contract-consistency.ts)
 *    flags this as malformed, but that guard is record-only on a
 *    non-turn-ending output (e.g. TOOL_CALLS), so it can still reach the fold.
 * 2. Two (or more) `dismiss` claims for the SAME key in one output. There is
 *    no principled way to pick which reason becomes the permanent audit
 *    record, so neither is applied.
 * 3. A `dismiss` whose `reason` is missing, or whitespace-only. The entire
 *    justification for making this tier dismissable is that a logged "I
 *    could not do this well" beats a silent plausible-looking rewrite; a
 *    reasonless dismissal gets the suppression without the log, which
 *    defeats the point.
 */
export function applyStaleDispositions(
  entries: StaleEntry[],
  dispositions: null | readonly StaleDisposition[] | undefined,
  timestamp: string,
): StaleEntry[] {
  const list = dispositions ?? []
  if (list.length === 0) {
    return entries
  }
  const reasonsByKey = collectDismissableReasons(list)
  if (reasonsByKey.size === 0) {
    return entries
  }
  return entries.map((entry) => {
    const reason = reasonsByKey.get(dispositionKey(entry))
    if (reason === undefined) {
      return entry
    }
    return {
      ...entry,
      dismiss_reason: reason,
      dismissed_at: timestamp,
    }
  })
}
