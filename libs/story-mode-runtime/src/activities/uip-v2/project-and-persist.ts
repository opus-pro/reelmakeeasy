// Do NOT import from workflow.ts
//
// projectAndPersistActivity is the V2 single activity that fuses the V1
// persistSessionSnapshot + publishSessionStatus boundary. It runs on the activity (Node)
// side, so VALUE imports of foldSession + the V1 persistence activities are
// allowed. Keep it out of workflow files (foldSession pulls in the V1
// reasoning kernel).
//
// Contract (events-based, required-rule A): the workflow passes only events +
// currentArtifacts; foldSession runs here on the activity side. The workflow
// also supplies the transient/terminal flags it knows but foldSession does not
// derive from events (isIdle / cancelled), plus skipPersist to publish status
// without writing storage (the V1 publishSessionStatus-only path).
//
// It reuses persistSessionSnapshot + publishSessionStatus VERBATIM (relocated
// from activities/uip into sibling modules in the v1 cleanup) -- no
// persistence logic is reimplemented here.

import { createSubLogger } from '@reelmakeeasy/common/logger'

import type { AgentEvent, ArtifactSlot } from '../../workflows/uip-v2/types'

import { persistSessionSnapshot } from './persist-session'
import { publishSessionStatus } from './publish-status'
import { foldSession } from './session-state'
import { resolveSpecCheckpoint } from './spec-checkpoint'
import { fileStore } from '@reelmakeeasy/common/storage/file-store'

const logger = createSubLogger('uip-v2-project-and-persist')

export interface ProjectAndPersistInput {
  cancelled?: boolean
  currentArtifacts: Record<string, ArtifactSlot>
  events: AgentEvent[]
  isIdle?: boolean
  projectId: string
  /**
   * Publish status without writing storage/Mongo (the V1 publishSessionStatus-only
   * path). Set by the sync loop for all-transient ticks. Ignored on
   * terminal ticks: writeEventLog forces a full persist.
   */
  skipPersist?: boolean
  /**
   * `at` / `type` of the tick's trigger event (the oldest unpersisted event,
   * stamped by the workflow) -- anchors the `event_to_publish` staleness stage.
   * Optional: absent on callers that cannot know the trigger (e.g. the
   * external-cancel terminal flush in workflow.ts) -- those ticks simply emit
   * no staleness sample.
   */
  triggerEventAt?: number
  triggerEventType?: string
  /**
   * Write the once-per-session debug event-log dump to storage. Set only by the
   * terminal call sites (sync-loop terminal flush, workflow.ts external-cancel
   * fallback) -- regular ticks never write it (the dump held the
   * single-writer lock ~3.3s p50 per tick with no runtime consumer). Also
   * forces a full persist: skipPersist is ignored on terminal ticks.
   */
  writeEventLog?: boolean
}

/** stored file path for a session's debug event-log dump. */
export function eventLogStorePath(projectId: string): string {
  return `projects/${projectId}/debug/event_log/event_log.json`
}

/**
 * How and when the session ended, derived purely from the event log -- feeds
 * `agent.v2.session.duration`. Duration = terminal event `at` minus
 * first event `at` (both workflow-stamped: one clock, immune to publish/persist
 * delays). Reasons: session_locked splits into fast_pass (a `user_confirm` with
 * `fast: true`) / auto_lock (autoLocked, the review-deadline timer) /
 * user_confirm; session_cancelled -> user_cancel; session_timed_out ->
 * idle_timeout (3h; included -- dashboards filter it); session_failed ->
 * failed. No terminal event: external workflow cancel (`cancelled` flag) ->
 * external_cancel, anchored on the LAST event's `at`; otherwise unknown, so a
 * taxonomy gap shows up in the data instead of vanishing.
 */
export function deriveSessionEnd(
  events: AgentEvent[],
  cancelled?: boolean,
): null | { durationMs: number; reason: string } {
  const first = events[0]
  if (!first) {
    return null
  }
  const durationTo = (at: number): number => Math.max(0, at - first.at)
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const e = events[i]
    if (e.type === 'session_locked') {
      // The latest user_confirm AT-OR-BEFORE the lock decides fast vs normal:
      // an earlier fast confirm can be stale (e.g. its orchestration failed),
      // and a confirm landing AFTER the lock (late signal race) is not the one
      // that caused it.
      const lastConfirm = events.slice(0, i).findLast((ev) => ev.type === 'user_confirm')
      let reason = 'user_confirm'
      if (lastConfirm?.type === 'user_confirm' && lastConfirm.fast === true) {
        reason = 'fast_pass'
      } else if (e.autoLocked) {
        reason = 'auto_lock'
      }
      return { durationMs: durationTo(e.at), reason }
    }
    if (e.type === 'session_cancelled') {
      return { durationMs: durationTo(e.at), reason: 'user_cancel' }
    }
    if (e.type === 'session_timed_out') {
      return { durationMs: durationTo(e.at), reason: 'idle_timeout' }
    }
    if (e.type === 'session_failed') {
      return { durationMs: durationTo(e.at), reason: 'failed' }
    }
  }
  const last = events[events.length - 1] as AgentEvent
  return { durationMs: durationTo(last.at), reason: cancelled ? 'external_cancel' : 'unknown' }
}

/**
 * Persist the raw V2 event log to storage for debugging, at
 * `{projectId}/debug/event_log/event_log.json` -- written once per session END
 * (terminal ticks only), so a live session has no dump until it ends and a
 * project's dump shows its most recently ended session. Nothing in the app
 * reads it; it is a debugging aid for inspecting a finished session.
 * Best-effort: a storage failure is logged and swallowed so it never blocks the
 * session (mirrors persistSessionSnapshot's storage-write handling).
 */
async function persistEventLogToStore(projectId: string, events: AgentEvent[]): Promise<void> {
  if (process.env['NODE_ENV'] === 'test') {
    return
  }
  try {
    await fileStore
      .file(eventLogStorePath(projectId))
      .write(JSON.stringify(events), { contentType: 'application/json' })
  } catch (err) {
    logger.warn(`[${projectId}] Failed to persist event log to storage: ${err}`)
  }
}

/**
 * Project the V2 event log into a V1 SessionState, then publish status and
 * (unless skipPersist) persist a snapshot via the reused V1 activities.
 *
 * Order matches the V1 / design contract: status first (fast SSE path), then
 * storage persist. isIdle/cancelled overrides are applied to the projected state
 * before it is handed to both V1 activities.
 */
export async function projectAndPersistActivity(input: ProjectAndPersistInput): Promise<void> {
  const { cancelled, currentArtifacts, events, isIdle, projectId, writeEventLog } = input
  // Terminal ticks (writeEventLog) must always persist the final state; the
  // sync loop never combines the two flags, but enforce it here too so no
  // future caller can end a session with its last state unpersisted.
  const skipPersist = input.skipPersist === true && writeEventLog !== true

  const checkpointSpec = await resolveSpecCheckpoint(events)
  const sessionState = foldSession(events, currentArtifacts, checkpointSpec)
  // is_idle is a SessionState field the main loop sets before condition(); only
  // override when the workflow actually supplied it (undefined = leave as-is).
  if (isIdle !== undefined) {
    sessionState.is_idle = isIdle
  }
  // _cancelled is a workflow terminal flag persistSessionSnapshot reads.
  if (cancelled) {
    sessionState._cancelled = true
  }
  await publishSessionStatus({ projectId, sessionState })
  // 2. Persist snapshot to storage + /persist callback (unless skipPersist), and
  //    on terminal ticks the once-per-session debug event-log dump -- run in
  //    PARALLEL: the dump is best-effort and independent of the snapshot, so
  //    the terminal flush pays max() instead of sum(). allSettled keeps the
  //    dump write from dangling past the activity when persist rejects; a
  //    retry rewrites identical content (input events are fixed), so the
  //    always-attempted dump is idempotent.
  const tasks: Promise<void>[] = []
  if (!skipPersist) {
    tasks.push(
      (async () => {
        await persistSessionSnapshot({ projectId, sessionState })
      })(),
    )
  }
  if (writeEventLog) {
    tasks.push(
      (async () => {
        await persistEventLogToStore(projectId, events)
      })(),
    )
  }
  const settled = await Promise.allSettled(tasks)
  const failed = settled.find((r): r is PromiseRejectedResult => r.status === 'rejected')
  if (failed) {
    throw failed.reason
  }
}
