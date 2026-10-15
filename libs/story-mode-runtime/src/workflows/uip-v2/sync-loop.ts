/**
 * UIP V2 background session sync loop.
 *
 * Runs concurrently with the main loop, sharing the same `events` array. It owns
 * two responsibilities that used to sit on the main-loop critical path:
 *   1. Persistence (change 1): when a persist-worthy event lands, project + flush
 *      once. Single-writer ordering eliminates multi-writer races; slow storage/HTTP
 *      never blocks planner progress.
 *   2. The auto-continue / auto-lock deadline timer (change 2): sleep until
 *      foldDeadline; on fire append a decision-worthy `deadline_expired` that
 *      wakes the main loop (which routes it by phase: script_review ->
 *      advancePhase auto-continue, refinement -> 7b auto-lock).
 *
 * Concurrency: `projectAndPersistActivity` may run concurrently with the planner
 * step; this loop awaits a single persist at a time. The condition predicate reads
 * only workflow state (no wall-clock); the wall-clock deadline comparison
 * runs once after the timer wakes us.
 *
 * Value imports are local pure modules + `@reelmakeeasy/workflow-engine/workflow`
 * (condition / isCancellation) + the local-activity proxy. No
 * `@reelmakeeasy/uip-planner-runtime` value import.
 */

import type { UipSessionWorkflowParams } from '@reelmakeeasy/uip-planner-runtime'
import { condition, isCancellation } from '@reelmakeeasy/workflow-engine/workflow'

import type { ProjectAndPersistInput } from '../../activities/uip-v2/project-and-persist'

import { appendEvent } from './event-log'
import {
  computeIdleWaitMs,
  countDeadlineExtends,
  foldDeadline,
  foldPhase,
  isAgentTurnBusy,
  isPlannerInFlight,
  isTransientEventType,
  MAX_AUTO_EXTENDS,
  openToolStartedEvents,
} from './folds'
import { foldGuiDebounceDeadline } from './gui-wake-folds'
import { nowIso } from './planner-turn-helpers'
import { isTerminal } from './state-util'
import type { WorkflowState } from './types'

/**
 * The project-and-persist activity, passed in by the workflow. It is a REGULAR
 * activity (created via createPersistProxy with the task queue); the sync loop
 * runs it concurrently with the main loop.
 */
type PersistFn = (input: ProjectAndPersistInput) => Promise<void>

/**
 * Persist trigger (single knob): a revision that increases monotonically with
 * every persist-worthy event. `user_activity` heartbeats are excluded -- they
 * extend the deadline timer but must not flush the DB / refresh the UI.
 */
export function persistRevision(events: WorkflowState['events']): number {
  return events.reduce((n, e) => (isPersistWorthy(e) ? n + 1 : n), 0)
}

/**
 * Persist-worthiness, the single definition shared by persistRevision (count)
 * and unpersistedEvents (skip-walk). The two index into the same event
 * subsequence, so widening this exclusion in one without the other would skew
 * the event_to_publish anchor -- keep it here only.
 */
function isPersistWorthy(e: WorkflowState['events'][number]): boolean {
  return e.type !== 'user_activity'
}

/**
 * The current tick's batch: every persist-worthy event past the previous
 * tick's revision. Single definition of the skip-walk shared by the trigger
 * anchor (oldestUnpersistedEvent) and the transient-batch verdict
 * (unpersistedBatchIsTransient), so the two can never index different
 * subsequences. `persistedRev` is the persistRevision at the PREVIOUS tick
 * (pre-update value; the initial `-1` sentinel clamps to 0).
 */
function* unpersistedEvents(
  events: WorkflowState['events'],
  persistedRev: number,
): Generator<WorkflowState['events'][number]> {
  let skip = Math.max(persistedRev, 0)
  for (const e of events) {
    if (!isPersistWorthy(e)) {
      continue
    }
    if (skip > 0) {
      skip -= 1
      continue
    }
    yield e
  }
}

/**
 * Whether the current tick's batch consists ONLY of transient events
 * (isTransientEventType, folds.ts -- see TRANSIENT_EVENT_TYPES there for the
 * safety argument). If so the tick publishes without persisting, so mid-turn
 * ticks stop serializing behind the storage/Mongo write in the single-writer lock.
 * False for an empty batch: no persist-worthy event means no tick.
 */
export function unpersistedBatchIsTransient(
  events: WorkflowState['events'],
  persistedRev: number,
): boolean {
  let sawAny = false
  for (const e of unpersistedEvents(events, persistedRev)) {
    if (!isTransientEventType(e.type)) {
      return false
    }
    sawAny = true
  }
  return sawAny
}

/**
 * The oldest persist-worthy event not yet covered by a persist tick -- the event
 * that triggered the current tick, and the staleness anchor for the
 * `event_to_publish` stage metric. "Covered" means a tick was attempted for it,
 * which closes the anchor via the tick's PUBLISH (always run), not the persist:
 * a swallowed flush failure still advances the revision, and a skipPersist tick
 * advances it without attempting any persist -- in both cases the events never
 * re-anchor the metric.
 */
export function oldestUnpersistedEvent(
  events: WorkflowState['events'],
  persistedRev: number,
): null | { at: number; type: string } {
  for (const e of unpersistedEvents(events, persistedRev)) {
    return { at: e.at, type: e.type }
  }
  return null
}

/**
 * Background persistence + deadline-timer loop. `persist` is the REGULAR
 * project-and-persist activity (see PersistFn); it runs concurrently with the
 * main loop and is the single writer of session state.
 */
export async function sessionSyncLoop(
  state: WorkflowState,
  params: UipSessionWorkflowParams,
  persist: PersistFn,
): Promise<void> {
  let persistedRev = -1
  try {
    while (!state.mainLoopDone && !isTerminal(state)) {
      const deadlineMs = foldDeadline(state.events, state.currentArtifacts)
      const guiWakeAt = foldGuiDebounceDeadline(state.events)
      const waitMs = computeSyncWaitMs(deadlineMs, guiWakeAt, state.idleTimeoutMs, Date.now())

      // Wake on: main loop done / terminal / a new persist-worthy event. The
      // deadline fires via the waitMs timeout (no wall-clock in the predicate).
      await condition(
        () =>
          state.mainLoopDone || isTerminal(state) || persistRevision(state.events) !== persistedRev,
        waitMs,
      )
      if (state.mainLoopDone || isTerminal(state)) {
        break
      }

      // Deadline check, recomputed after the await (avoid TOCTOU). foldDeadline
      // self-cancels (returns null) once a live deadline_expired is queued, so we
      // never double-append.
      const dl = foldDeadline(state.events, state.currentArtifacts)
      if (dl != null && Date.now() >= dl) {
        const phase = foldPhase(state.events)
        // Busy-defer: if a planner turn or tool is still in flight, the gate is
        // not really idle -- extend instead of firing, so a long refinement
        // regeneration cannot auto-lock mid-flight. deadline_extended is a reset
        // event, so the next foldDeadline re-arms a full delay from now (no spin);
        // it also bumps the persist revision, publishing the pushed-out deadline.
        // The MAX_AUTO_EXTENDS cap (cumulative across the session) prevents a
        // wedged planner from deferring forever: past it we fire deadline_expired,
        // forcing the phase's terminal action (auto-continue / auto-lock).
        const busy =
          isPlannerInFlight(state.events) || openToolStartedEvents(state.events).length > 0
        if (busy && countDeadlineExtends(state.events) < MAX_AUTO_EXTENDS) {
          appendEvent(state, { phase, type: 'deadline_extended' })
        } else {
          appendEvent(state, { phase, type: 'deadline_expired' })
        }
      }

      maybeAppendGuiWake(state)

      // Persist only when a persist-worthy event arrived (naturally batches).
      const rev = persistRevision(state.events)
      if (rev !== persistedRev) {
        await persistOnce(state, params, persist, persistedRev)
        persistedRev = rev
      }
    }

    // Terminal flush: guarantee the final state (locked / cancelled / timed_out)
    // lands in the DB, plus the once-per-session debug event-log dump. Every
    // terminal path appends its terminal event synchronously with its state
    // flag (no await between), so the revision has always advanced here.
    if (persistRevision(state.events) !== persistedRev) {
      await persistOnce(state, params, persist, persistedRev, { writeEventLog: true })
    }
  } catch (err) {
    if (isCancellation(err)) {
      // External cancel: exit quietly. The main loop's catch does the
      // nonCancellable terminal persist fallback.
      return
    }
    throw err
  }
}

/**
 * The sync loop's next wake: whichever of the auto-continue deadline or the
 * debounced GUI wake is sooner (POSITIVE_INFINITY when a timer isn't armed,
 * which computeIdleWaitMs/Math.min then reduce to the other timer alone).
 */
function computeSyncWaitMs(
  deadlineMs: null | number,
  guiWakeAt: null | number,
  idleTimeoutMs: number,
  now: number,
): number {
  const idleWaitMs = computeIdleWaitMs(deadlineMs, idleTimeoutMs, now)
  const guiWaitMs = guiWakeAt == null ? Number.POSITIVE_INFINITY : Math.max(0, guiWakeAt - now)
  return Math.min(idleWaitMs, guiWaitMs)
}

/**
 * The debounced GUI wake. Recomputed after the await for the
 * same TOCTOU reason as the deadline check in the loop body above. No
 * busy-defer: user_wake crosses the same decision boundary as every other
 * decision-worthy event, so the existing queued_items / is_processing
 * machinery queues it behind an in-flight turn rather than racing it.
 */
function maybeAppendGuiWake(state: WorkflowState): void {
  const guiWakeDl = foldGuiDebounceDeadline(state.events)
  if (guiWakeDl != null && Date.now() >= guiWakeDl) {
    appendEvent(state, { type: 'user_gui_wake', timestamp: nowIso() })
  }
}

async function persistOnce(
  state: WorkflowState,
  params: UipSessionWorkflowParams,
  persist: PersistFn,
  prevPersistedRev: number,
  opts?: { writeEventLog?: boolean },
): Promise<void> {
  // Staleness anchor for the event_to_publish stage metric: the tick's trigger
  // event, i.e. how long the user's oldest pending update waited for /status.
  const trigger = oldestUnpersistedEvent(state.events, prevPersistedRev)
  // Publish-only tick for an all-transient batch. Terminal flushes always
  // persist (a terminal event is never transient, but the writeEventLog gate
  // keeps that invariant independent of the whitelist).
  const skipPersist =
    !opts?.writeEventLog && unpersistedBatchIsTransient(state.events, prevPersistedRev)
  // isIdle: exact inverse of is_processing (not mid-turn). Derived from the
  // planner event sequence (isAgentTurnBusy), not point-in-time tool/planner
  // state, which flickered "idle" in sub-turn gaps and flashed the review gate.
  const isIdle = !isAgentTurnBusy(state.events)
  try {
    await persist({
      currentArtifacts: state.currentArtifacts,
      events: state.events,
      isIdle,
      projectId: params.projectId,
      ...(trigger ? { triggerEventAt: trigger.at, triggerEventType: trigger.type } : {}),
      ...(skipPersist ? { skipPersist: true } : {}),
      ...(opts?.writeEventLog ? { writeEventLog: true } : {}),
    })
  } catch (err) {
    if (isCancellation(err)) {
      throw err
    }
    // Swallow: the local activity already exhausted its retry budget; a failed
    // background flush must not brick the session. The next persist-worthy event
    // will try again.
  }
}
