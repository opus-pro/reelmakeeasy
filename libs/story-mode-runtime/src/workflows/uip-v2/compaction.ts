/**
 * UIP V2 continueAsNew compaction.
 *
 * `shouldContinueAsNew` decides when to hand off (primarily workflow history
 * size; events.length is a secondary safety valve). `compactEvents` produces the
 * minimal event set the new run needs to rebuild control flow + re-derive spec:
 * the init event, a compaction boundary marker, the last phase_changed (phase
 * baseline), the last reset event (deadline anchor), every still-open
 * tool_started, and the most recent COMPACT_TAIL_KEEP events. spec itself is NOT
 * snapshotted -- it is re-derived in the new run from the carried
 * currentArtifacts (the activity side folds them).
 *
 * Pure: no `@reelmakeeasy/workflow-engine` / `@reelmakeeasy/uip-planner-runtime` import. The caller
 * passes the live history length; `continueAsNew` itself is invoked in
 * workflow.ts (which owns the workflow-fn type).
 */

import { dedupeById, findLast, nowMs, openToolStartedEvents } from './folds'
import type { AgentEvent, CompactionEvent, WorkflowState } from './types'

/** Most recent original events kept verbatim across a continueAsNew handoff. */
export const COMPACT_TAIL_KEEP = 100

/**
 * The latest compaction marker that pinned a spec checkpoint, as
 * `{ index, version }`, or undefined when none. foldSession resets the base spec
 * at `index`; resolveSpecCheckpoint + compactEvents read `version`. Shared so the
 * three sites agree on which marker is authoritative. Lives here (the pure
 * compaction module) so both the workflow and the activity-side folds can
 * import it without dragging in workflow-engine or planner-runtime deps.
 */
export function latestCompactionCheckpoint(
  events: AgentEvent[],
): undefined | { index: number; version: number } {
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i]
    if (event.type === 'compaction' && typeof event.specCheckpointVersion === 'number') {
      return { index: i, version: event.specCheckpointVersion }
    }
  }
  return undefined
}

/**
 * global_constraints paths whose update_global_field writes the
 * auto-style dispatch gate (maybeStartAutoStyleChild) folds: a concrete style
 * (`hasSelectedStyle`), a committed brand look (`hasCommittedBrandLook`), or the
 * style provenance (`foldStyleSource`, which the re-selection gate reads to
 * preserve a user-committed 'auto_switched' / 'manual' pick). `style_source` is
 * co-written with `style` by every setStyle / fallback spec_patched today, but a
 * lone `style_source` write must ALSO survive compaction -- do not rely on the
 * co-occurrence. Kept in sync with the fold paths in start-auto-style-child.ts.
 */
const AUTO_STYLE_GATE_GLOBAL_PATHS = new Set([
  'brand_style_directive',
  'brand_style_text',
  'style',
  'style.style_name',
  'style.style_text',
  'style_source',
])

/**
 * Whether an event is load-bearing for the auto-style dispatch gate: the
 * select_auto_style dispatch marker AND its terminal (completed / failed /
 * cancelled), or a spec_patched that set a concrete style / committed a brand
 * look. Pure op-shape scan (no value import of patch-apply), mirroring
 * the folds in start-auto-style-child.ts.
 *
 * The terminal must be kept alongside the start: autoStyleSelectionPending()
 * matches the start to its terminal by toolCallId (a preserved start with a
 * dropped terminal folds as still-pending and blocks bootstrap_script forever),
 * and foldGlobalStyle() recovers the picked style from the tool_completed OUTPUT
 * (dropping it loses the pick, so the bootstrap_visual fallback clobbers it).
 */
function isAutoStyleGateEvent(event: AgentEvent): boolean {
  if (
    (event.type === 'tool_started' ||
      event.type === 'tool_completed' ||
      event.type === 'tool_failed' ||
      event.type === 'tool_cancelled') &&
    event.toolName === 'select_auto_style'
  ) {
    return true
  }
  if (event.type === 'spec_patched') {
    return event.ops.some(
      (op) => op.op === 'update_global_field' && AUTO_STYLE_GATE_GLOBAL_PATHS.has(op.path),
    )
  }
  return false
}

/** Workflow history length (event count) at which we hand off. */
export const CONTINUE_AS_NEW_HISTORY_THRESHOLD = 10_000

/** events.length secondary safety valve for the continueAsNew payload size. */
export const CONTINUE_AS_NEW_EVENTS_THRESHOLD = 5_000

/**
 * History BYTE-size ceiling at which we hand off. Large per-event payloads
 * (e.g. inlined tool outputs) grow history bytes at only a few thousand events,
 * long before the count thresholds above, so this explicit ceiling bounds them.
 * 40 MB leaves ~10 MB of headroom under a ~50 MB cap -- safe because
 * shouldContinueAsNew runs every workflow iteration, so per-iteration byte
 * growth (bounded) cannot overshoot between checks. A lower ceiling (20 MB,
 * plus a `continueAsNewSuggested` trigger) made bootstrap sessions on the
 * O(N^2) inline transport hand off very frequently, and that churn was itself a
 * bug source.
 */
export const CONTINUE_AS_NEW_HISTORY_SIZE_THRESHOLD = 40_000_000

/**
 * Live handoff signals read from `workflowInfo()` by the caller (kept out of
 * this pure fn for testability).
 */
export interface ContinueAsNewSignals {
  historyLength: number
  historySize?: number
}

/**
 * Whether to continueAsNew now. Trips on event COUNT (historyLength /
 * events.length) OR the BYTE-SIZE dimension (an explicit history-size
 * ceiling), which protects against large per-event payloads the count
 * thresholds miss.
 */
export function shouldContinueAsNew(state: WorkflowState, signals: ContinueAsNewSignals): boolean {
  const { historyLength, historySize } = signals
  if (historyLength > CONTINUE_AS_NEW_HISTORY_THRESHOLD) {
    return true
  }
  if (state.events.length > CONTINUE_AS_NEW_EVENTS_THRESHOLD) {
    return true
  }
  if (historySize !== undefined && historySize > CONTINUE_AS_NEW_HISTORY_SIZE_THRESHOLD) {
    return true
  }
  return false
}

/**
 * Compact the event log for handoff. Keeps the minimum needed to rebuild context
 * + re-derive spec; emits the compaction boundary marker itself. Returns events
 * deduped by identity and stably sorted by `at`.
 */
export function compactEvents(events: AgentEvent[], specCheckpointVersion?: number): AgentEvent[] {
  const initEvent = events.find((e) => e.type === 'session_initialized')
  if (!initEvent) {
    // Defensive: no init means an unexpected log shape; do not compact.
    return events
  }

  const lastPhaseChanged = findLast(events, (e) => e.type === 'phase_changed')
  const openToolStarts = openToolStartedEvents(events)

  // Keep the last reset event so the new run computes the SAME deadline
  // (foldDeadline = last reset.at + delay). Without it the new run falls back to
  // phaseEnteredAt and may spuriously auto-fire after the handoff. The reset set
  // mirrors foldDeadline's (incl. planner_decided + deadline_extended).
  const lastResetEvent = findLast(
    events,
    (e) =>
      e.type === 'user_message' ||
      e.type === 'user_activity' ||
      e.type === 'planner_decided' ||
      e.type === 'tool_completed' ||
      e.type === 'deadline_extended' ||
      e.type === 'phase_changed',
  )

  // Keep ALL deadline_extended events (bounded by MAX_AUTO_EXTENDS) so
  // countDeadlineExtends -- the cumulative auto-extend budget -- survives the
  // continueAsNew handoff. Without this the cap would silently reset on every
  // compaction, letting a wedged session defer the gate indefinitely.
  const deadlineExtends = events.filter((e) => e.type === 'deadline_extended')

  // Keep gate_deadline_dispatched markers so the dispatch dedup survives a
  // continueAsNew that lands in the brief window between a deadline_expired and
  // the phase advance; without it routeGateDeadline could re-dispatch post-handoff.
  // Bounded (a couple per session) and dropped naturally once the phase advances.
  const gateDispatched = events.filter((e) => e.type === 'gate_deadline_dispatched')

  // Keep the commit signals (continue / confirm / confirm_fast) so
  // sessionCommitted() survives the handoff. A committed session whose commit
  // scrolled out of the COMPACT_TAIL_KEEP window would otherwise look uncommitted,
  // and a later idle timeout in bootstrap_visual/refinement would be mislogged at
  // ERROR (the false alert this removes). Re-including them is safe: they are
  // decision-worthy and processedDecisionCount is recomputed as countDecisionWorthy
  // on restore, so they never re-trigger a lock/advance. Bounded: at most one
  // continue + one confirm per session.
  const commitSignals = events.filter(
    (e) => e.type === 'user_continue_draft' || e.type === 'user_confirm',
  )

  // Keep the article-extraction pair so bootstrap.article_context
  // (foldSession projects it from the completed event) and the at-most-once
  // trigger guard (hasArticleExtractionRun reads the started event) both
  // survive the handoff. Without this a long news session loses its article
  // grounding at continueAsNew. Bounded: at most one started + one completed
  // per session.
  const articleEvents = events.filter(
    (e) => e.type === 'article_extraction_completed' || e.type === 'article_extraction_started',
  )

  // Keep the latest auto-continue flip so foldAutoContinueEnabled does
  // not revert to the session_initialized default when the flip scrolls out of
  // the tail -- the setting would otherwise silently flip back across the handoff.
  // (Not carried in the cached_artifacts checkpoint; it is a projected scalar, so
  // it rides the keep-list.) Bounded: one latest flip.
  const lastAutoContinue = findLast(events, (e) => e.type === 'user_auto_continue_changed')

  // Keep the FIRST and the LONGEST user_message. getPinnedUserPrompt
  // (context-builder.ts) pins BOTH -- the first is "the original request", the
  // longest is "the most detailed instruction" -- and that pinned prompt feeds
  // the planner (Gemini fallback), prompt-route, and the anchor / visual-script /
  // intent-context / script tools. It lives ONLY in the transcript (not in spec,
  // cached_artifacts, or session_initialized.params), so without this either one
  // scrolls out of the tail and the pinned prompt silently degrades across the
  // handoff. Keeping both makes them stable across every continueAsNew (the
  // carried-forward messages stay first / longest). Bounded: at most two.
  const userMessages = events.filter(
    (e): e is Extract<AgentEvent, { type: 'user_message' }> => e.type === 'user_message',
  )
  const firstUserMessage = userMessages[0]
  const longestUserMessage = userMessages.reduce<(typeof userMessages)[number] | undefined>(
    (longest, e) =>
      (e.message ?? '').trim().length > (longest?.message ?? '').trim().length ? e : longest,
    undefined,
  )

  // Keep the latest describe_uploaded_images completion. foldSession
  // stages session._loaded_asset_descriptions (a TOP-LEVEL field -- not spec, not
  // cached_artifacts, so neither checkpoint covers it) from this event's output.
  // describe runs once, early, so without this it scrolls out of the tail and the
  // planner + anchor / visual-script tools lose every uploaded-image description
  // across the handoff (has_asset_descriptions flips false, undescribed-asset
  // detection wrong, asset_catalog summaries blank). Bounded: one latest
  // completion; the fold REPLACES the field, so the last describe output suffices.
  const lastDescribe = findLast(
    events,
    (e) => e.type === 'tool_completed' && e.toolName === 'describe_uploaded_images',
  )
  // Keep the auto-style dispatch gate's fold inputs -- the
  // select_auto_style dispatch marker + its terminal (completed/failed/cancelled)
  // and the spec_patched events that set a concrete style or committed a brand
  // look. These writes happen early (brand
  // confirm / style pick) and would otherwise scroll out of COMPACT_TAIL_KEEP,
  // leaving a deferred auto-style wake in the new run to fold hasSelectedStyle /
  // hasCommittedBrandLook / autoStyleDispatched as false and misfire onto an
  // already-styled or committed-brand session (fail-open across the handoff).
  // Bounded: a handful of style/brand writes + at most one dispatch per session.
  const autoStyleGateEvents = events.filter(isAutoStyleGateEvent)
  // Keep the latest generate_intent_context completion. Like the
  // select_auto_style terminal above it carries an auto-applied
  // global_constraints.style in its OUTPUT (never a spec_patched), and
  // foldGlobalStyle reads it so a committed brand style
  // suppresses the bootstrap_visual empty-style fallback. The brief runs early, so
  // without this it scrolls out of COMPACT_TAIL_KEEP and the new run refolds the
  // session as unstyled and clobbers the user's brand style with the first catalog
  // preset -- the exact bug the fold fixes, reintroduced across the handoff (note
  // brand_style_directive DOES survive, so the pick stays suppressed: fold and
  // dispatch gate would disagree). Bounded: one latest completion; the fold takes
  // the last non-empty style, so the newest brief output suffices.
  const lastBriefCompleted = findLast(
    events,
    (e) => e.type === 'tool_completed' && e.toolName === 'generate_intent_context',
  )
  // Additionally keep the latest brief completion that CAPTURED a
  // prompt-expressed style. Its output is the only place `style_source` /
  // `selection_method` live for that path (the brief auto-applies
  // activity-side, never as a spec_patched), and hasPromptExpressedStyle reads
  // them to keep the once-per-brief re-pick off a style the user asked for by
  // name. A LATER brief that captured nothing takes the `lastBriefCompleted`
  // slot, so without this the marker scrolls out at the handoff and the next
  // topic change silently re-picks over the user's own style -- the original
  // complaint, reintroduced across continueAsNew. Bounded: one extra event, and
  // it collapses into the same slot when the latest brief is the capturing one.
  const lastBriefWithStyleProvenance = findLast(
    events,
    (e) =>
      e.type === 'tool_completed' &&
      e.toolName === 'generate_intent_context' &&
      typeof (e.output as undefined | { global_constraints?: { style_source?: unknown } })
        ?.global_constraints?.style_source === 'string',
  )

  const at = nowMs(events)
  // Carry the checkpoint version forward across handoffs. The caller's
  // `specCheckpointVersion` (currentSpecVersion) reads the newest spec_patched in
  // the log, which on a LATER handoff may have been truncated below the true
  // version; the prior compaction marker still records it, and spec_version is
  // monotonic, so max() recovers the real version (whose spec/versions file was
  // flushed when that version was reached).
  const effectiveCheckpointVersion =
    specCheckpointVersion === undefined
      ? undefined
      : Math.max(
          specCheckpointVersion,
          latestCompactionCheckpoint(events)?.version ?? specCheckpointVersion,
        )

  const compactionMarker: CompactionEvent = {
    at,
    timestamp: new Date(at).toISOString(),
    truncatedBefore: Math.max(0, events.length - COMPACT_TAIL_KEEP),
    type: 'compaction',
    // Pin the spec checkpoint so the next run seeds its base spec from
    // the flushed spec/versions/v{N}/spec.json instead of replaying truncated
    // events onto the creation snapshot. Omitted when the caller has no version
    // (defensive / pre-flush) -> falls back to the old replay behavior.
    ...(effectiveCheckpointVersion === undefined
      ? {}
      : { specCheckpointVersion: effectiveCheckpointVersion }),
  }

  const kept: AgentEvent[] = [
    initEvent,
    ...(lastPhaseChanged ? [lastPhaseChanged] : []),
    ...(lastResetEvent ? [lastResetEvent] : []),
    ...openToolStarts,
    ...deadlineExtends,
    ...gateDispatched,
    ...commitSignals,
    ...articleEvents,
    ...autoStyleGateEvents,
    ...(lastAutoContinue ? [lastAutoContinue] : []),
    ...(firstUserMessage ? [firstUserMessage] : []),
    ...(longestUserMessage ? [longestUserMessage] : []),
    ...(lastDescribe ? [lastDescribe] : []),
    ...(lastBriefCompleted ? [lastBriefCompleted] : []),
    ...(lastBriefWithStyleProvenance ? [lastBriefWithStyleProvenance] : []),
    ...events.slice(-COMPACT_TAIL_KEEP),
  ]

  // Sort by `at`, then force the compaction marker LAST. foldSession
  // resets the base spec AT the marker and the next run appends its events after
  // this array, so the marker must fold AFTER every truncated old event
  // (including any sharing its `at` -- e.g. a final same-ms spec_patched) and
  // BEFORE the next run's events. The marker's `at` ties the newest event, so a
  // stable sort alone would put it before that tie; pin it explicitly at the end.
  const sorted = dedupeById(kept).sort((a, b) => a.at - b.at)
  return [...sorted, compactionMarker]
}
