/**
 * persistSessionSnapshot -- Local Activity (Architecture doc section 2.6)
 *
 * Persists the current session state to storage and syncs metadata to MongoDB via
 * HTTP callback. Spec + session state are storage-only; MongoDB only holds lightweight
 * indexable metadata (phase, status, specVersion, lockedAt).
 *
 * storage layout (projects/{projectId}/user-intent-planner/):
 *   spec/current/spec.json                  -- current clean spec
 *   spec/versions/v{N}/spec.json            -- versioned spec snapshot
 *   spec/versions/v{N}/anchor_assets.json   -- anchor assets for version
 *   session-state.json                      -- runtime session fields
 *   spec-history-turns.json                 -- pre-computed history turns with shot diffs
 *
 * Local activity = runs on the workflow worker, short-lived, no heartbeat.
 */

import { createSubLogger } from '@reelmakeeasy/common/logger'
import {
  buildSpecHistoryTurns,
  type PersistedSessionState,
  type SessionState,
} from '@reelmakeeasy/uip-planner-runtime'

import { postToInternalApi } from './common'
import { fileStore } from '@reelmakeeasy/common/storage/file-store'

// Co-located after the move off workflows/uip/types (v1 cleanup). Only
// SessionState (shared kernel) + primitives, so no v1 dependency.
interface PersistSessionSnapshotInput {
  deadlineExtensionFailure?: boolean
  projectId: string
  sessionState: SessionState
}

/** SessionState extended with workflow-level flags (set by workflow, not part of core type). */
type SessionStateWithWorkflowFlags = SessionState & {
  _cancelled?: boolean
  _failed?: boolean
  _failure_message?: string
  _timed_out?: boolean
}

const logger = createSubLogger('uip-persist-session')

/** The /persist callback metadata body (Mongo-indexed scalars + transcript). */
export interface PersistedPayloads {
  persistedSessionState: PersistedSessionState
  persistPayload: PersistCallbackPayload
  specJson: string
}

interface PersistCallbackPayload {
  _cancelled: boolean
  _failed: boolean
  _failure_message?: string
  _timed_out: boolean
  gui_request_ids: SessionState['gui_request_ids']
  lockedAt: null | SessionState['spec']['meta']['locked_at']
  phase: NonNullable<SessionState['todo_state']>['phase'] | undefined
  specVersion: SessionState['spec']['meta']['spec_version']
  transcript: SessionState['transcript']
}

/**
 * The exact payloads persistSessionSnapshot writes: the current-spec JSON (storage
 * spec/current + spec/versions/vN), the PersistedSessionState (storage
 * session-state.json + /persist newRaw), and the /persist metadata body.
 * Extracted pure so the transient-event drift guard (transient-events.test.ts)
 * can assert that skipPersist-whitelisted events leave all of it untouched.
 */
export function buildPersistedPayloads(sessionState: SessionState): PersistedPayloads {
  const state = sessionState as SessionStateWithWorkflowFlags
  const anchorSummary = state.cached_artifacts?.anchor_assets_summary

  const persistedSessionState: PersistedSessionState = {
    audio_path: state.audioPath,
    auto_continue_enabled: state.auto_continue_enabled,
    // The confirm orchestrations resolve the brand anchor-library
    // key from the SNAPSHOT (seed_style_instruction is the effective style for
    // preset / saved-brand sessions whose spec style is empty), and the
    // fast-path session rebuild already reads `persisted.bootstrap ?? default`.
    // Omitting it silently disabled both -- the field has always been declared
    // on PersistedSessionState.
    bootstrap: state.bootstrap,
    voiceProfile: state.voiceProfile,
    review_gate: state.review_gate ?? null,
    review_auto_continue_deadline_at: state.review_auto_continue_deadline_at ?? null,
    conversation_summary: state.conversation_summary ?? '',
    anchor_assets_summary: anchorSummary ?? null,
    uploaded_assets: state.cached_artifacts?.uploaded_assets ?? [],
    queued_items: state.queued_items ?? [],
    // sub_tools is publish-only substep progress (transient tool_substep
    // events): strip it so no /persist payload ever carries it -- required by
    // the transient drift guard (transient-events.test.ts) and by design
    // (substep progress must only trigger /status, never /persist).
    tool_call_states: (state.tool_call_states ?? []).map(
      ({ sub_tools: _subTools, ...entry }) => entry,
    ),
    transitionVideoModel: state.transitionVideoModel,
    working_script: state.cached_artifacts?.working_script ?? null,
    pending_global_constraints: state.cached_artifacts?.pending_global_constraints ?? null,
    brand_telemetry: state.brand_telemetry,
    prompt_route: state.cached_artifacts?.prompt_route ?? null,
    cached_artifacts: {
      anchor_assets_summary: anchorSummary ?? null,
      auto_extend_count: state.cached_artifacts?.auto_extend_count,
      brand_draft_gui_request_id: state.cached_artifacts?.brand_draft_gui_request_id,
      uploaded_assets: state.cached_artifacts?.uploaded_assets ?? [],
      working_script: state.cached_artifacts?.working_script ?? null,
      pending_global_constraints: state.cached_artifacts?.pending_global_constraints ?? null,
      prompt_route: state.cached_artifacts?.prompt_route ?? null,
    },
  }

  const persistPayload: PersistCallbackPayload = {
    phase: state.todo_state?.phase,
    specVersion: state.spec.meta.spec_version,
    lockedAt: state.spec.meta.locked_at ?? null,
    transcript: state.transcript,
    _cancelled: state._cancelled ?? false,
    _failed: state._failed ?? false,
    ...(state._failure_message ? { _failure_message: state._failure_message } : {}),
    _timed_out: state._timed_out ?? false,
    gui_request_ids: state.gui_request_ids ?? [],
  }

  return { persistPayload, persistedSessionState, specJson: JSON.stringify(state.spec) }
}

export async function persistSessionSnapshot(input: PersistSessionSnapshotInput): Promise<void> {
  const { sessionState, projectId, deadlineExtensionFailure } = input
  const specVersion = sessionState.spec.meta.spec_version

  logger.info(`[${projectId}] Persisting session snapshot (specVersion=${specVersion})`)

  //
  //
  // Build payloads (needed by both storage writes and HTTP callback)
  //
  const storePrefix = `projects/${projectId}/user-intent-planner`

  const { persistPayload, persistedSessionState, specJson } = buildPersistedPayloads(sessionState)
  const sessionStateJson = JSON.stringify(persistedSessionState)

  // When only the deadline was extended (API outage fallback), the spec is unchanged.
  // Skip versioned storage writes (spec/vN, anchor_assets, spec-history-turns) to avoid
  // a redundant write cycle -- current/spec.json and session-state.json still update
  // so the activity state stays consistent.
  const specChanged = !deadlineExtensionFailure
  const specHistoryTurns = specChanged ? buildSpecHistoryTurns(sessionState) : null

  // Full cached_artifacts dump for the compaction checkpoint. The
  // spec checkpoint (spec/versions/vN/spec.json) reseeds only `spec`; this
  // reseeds the whole planner artifact store at the handoff boundary so
  // anchor_plan / uploaded_assets / working_script / pending_* don't revert when
  // their source tool/message events are truncated. Excludes the transient
  // recovery_failures + tool_events -- those are meant to age out with compaction.
  const {
    recovery_failures: _recoveryFailures,
    tool_events: _toolEvents,
    ...durableCachedArtifacts
  } = sessionState.cached_artifacts ?? { recovery_failures: [], tool_events: [] }

  //
  // storage writes: warn on failure and continue to HTTP callback
  //
  try {
    await Promise.all([
      fileStore
        .file(`${storePrefix}/spec/current/spec.json`)
        .write(specJson, { contentType: 'application/json' }),
      fileStore
        .file(`${storePrefix}/session-state.json`)
        .write(sessionStateJson, { contentType: 'application/json' }),
      // Versioned files only when spec actually changed. On deadline-extension
      // fallback persists the spec is identical to the previous version, so
      // writing vN/spec.json and spec-history-turns.json would be redundant.
      // specHistoryTurns is non-null when specChanged is true.
      ...(specChanged && specHistoryTurns !== null
        ? [
            fileStore
              .file(`${storePrefix}/spec/versions/v${specVersion}/spec.json`)
              .write(specJson, { contentType: 'application/json' }),
            // Versioned cached_artifacts snapshot the compaction
            // checkpoint reseeds from (see resolveSpecCheckpoint). Its own catch
            // emits a distinct metric: a silent failure here degrades this
            // version's checkpoint to "absent", which the loader can't tell apart
            // from a legacy pre-dump version -> silent cached_artifacts revert.
            // The metric makes that gap observable (best-effort otherwise, like
            // the surrounding writes; it must not fail the sibling storage writes).
            fileStore
              .file(`${storePrefix}/spec/versions/v${specVersion}/cached-artifacts.json`)
              .write(JSON.stringify(durableCachedArtifacts), { contentType: 'application/json' })
              .catch((err: unknown) => {
                logger.warn(
                  `[${projectId}] cached-artifacts checkpoint write failed (v${specVersion}): ${
                    err instanceof Error ? err.message : String(err)
                  }`,
                )
              }),
            persistedSessionState.anchor_assets_summary
              ? fileStore
                  .file(`${storePrefix}/spec/versions/v${specVersion}/anchor_assets.json`)
                  .write(JSON.stringify(persistedSessionState.anchor_assets_summary), {
                    contentType: 'application/json',
                  })
              : Promise.resolve(),
            fileStore
              .file(`${storePrefix}/spec-history-turns.json`)
              .write(JSON.stringify(specHistoryTurns), { contentType: 'application/json' }),
          ]
        : []),
    ])
  } catch (err) {
    logger.warn(`[${projectId}] Failed to persist session to storage: ${err}`)
  }

  //
  // HTTP callback: throws on 5xx so the activity is retried
  // (retry policy: maximumAttempts=3, initialInterval=1s).
  // A brief API outage (503) would otherwise leave the DB with stale
  // phase/is_processing and no recovery path.
  //
  const persistResponse = await postToInternalApi('/persist', {
    projectId,
    newRaw: { sessionState: persistedSessionState, spec: sessionState.spec },
    sessionState: persistPayload,
  })
  if (persistResponse.status >= 500) {
    throw new Error(
      `[${projectId}] Persist callback server error: ${persistResponse.status} — will retry`,
    )
  }
  if (!persistResponse.ok) {
    logger.warn(`[${projectId}] Persist callback failed: ${persistResponse.status}`)
  }

  logger.info(`[${projectId}] Session snapshot persisted`)
}
