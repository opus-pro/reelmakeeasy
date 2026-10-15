// Session checkpoint loader for the continueAsNew compaction boundary.
//
// A compacted event log (after a continueAsNew handoff) no longer contains the
// early events that built the spec / staged the cached artifacts, so replaying
// it onto the creation-time snapshot silently reverts any state whose source
// event was truncated -- spec state (mode_state, global_constraints, shots, ...)
// AND cached_artifacts (anchor_plan, uploaded_assets, working_script, pending_*).
// Instead we pin the flushed spec version on the compaction marker and, on the
// next run, reseed foldSession's base spec + cached_artifacts from the IMMUTABLE
// spec/versions/v{N}/{spec,cached-artifacts}.json written at that boundary. See
// foldSession (session-state.ts) for how the loaded snapshot is applied.
//
// Activity-side only (does storage I/O); foldSession itself stays pure and just
// receives the resolved snapshot.

import { createSubLogger } from '@reelmakeeasy/common/logger'
import type { CachedArtifacts, Spec } from '@reelmakeeasy/uip-planner-runtime'

import { latestCompactionCheckpoint } from '../../workflows/uip-v2/compaction'
import type { AgentEvent, SessionInitializedEvent } from '../../workflows/uip-v2/types'
import { fileStore } from '@reelmakeeasy/common/storage/file-store'

const logger = createSubLogger('uip-v2:spec-checkpoint')

/**
 * Snapshot pinned by a compaction boundary. `cachedArtifacts` is null when the
 * versioned dump is absent (a version older than the cached-artifacts dump): foldSession
 * then reseeds only the spec and folds cached_artifacts from events as before.
 */
export interface SessionCheckpoint {
  cachedArtifacts: CachedArtifacts | null
  spec: Spec
}

/** The file store the UIP session is persisted to (see persist-session.ts). */
function uipBucket() {
  return fileStore
}

// NOT cached by (projectId, version): persistSessionSnapshot rewrites
// spec/versions/v{N}/*.json on every normal persist, and state can change without
// bumping spec_version (uploads, working-script updates, direct mode/music
// mutations that don't route through applyPatch). So v{N} is NOT content-stable
// across persists, and a per-version cache could return a stale snapshot the
// reset then discards. We read fresh each fold instead -- bounded, as
// this only runs post-compaction.

/**
 * A storage "object not found" (404) means the versioned snapshot genuinely does not
 * exist (a version that never got a versioned write -- a rare edge, or a
 * legacy version for cached-artifacts.json). Any other failure (network /
 * 5xx / truncated body / parse) is transient and must not be swallowed.
 */
function isNotFoundError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    // A null/undefined/primitive rejection is not a 404; let loadVersionedJson
    // propagate it cleanly rather than masking it with a TypeError from `.code`.
    return false
  }
  const code = (error as { code?: number | string }).code
  return code === 404 || code === '404'
}

/**
 * Load one immutable versioned file for `version`, or null when it genuinely does
 * not exist (404). A *transient* failure (network / 5xx / truncated body / parse)
 * throws so the activity is retried rather than folding + persisting stale
 * state over the versioned checkpoint.
 */
async function loadVersionedJson<T>(
  projectId: string,
  version: number,
  filename: string,
): Promise<null | T> {
  const path = `projects/${projectId}/user-intent-planner/spec/versions/v${version}/${filename}`
  try {
    const buf = await uipBucket().file(path).read()
    return JSON.parse(buf.toString('utf8')) as T
  } catch (error) {
    if (isNotFoundError(error)) {
      logger.warn(`[${projectId}] checkpoint ${filename} v${version} not found (${path})`)
      return null
    }
    logger.warn(
      `[${projectId}] checkpoint ${filename} v${version} load failed (${path}); propagating for activity retry: ${
        error instanceof Error ? error.message : String(error)
      }`,
    )
    throw error
  }
}

/**
 * Resolve the snapshot pinned by the latest compaction boundary in `events`, or
 * null when there is no boundary / the spec snapshot genuinely does not exist
 * (caller then folds from the creation snapshot + full event replay, i.e.
 * legacy behavior).
 *
 * projectId + version are read straight from the carried events
 * (`session_initialized.params.projectId` and the compaction marker), so no
 * caller needs to plumb them in.
 */
export async function resolveSpecCheckpoint(
  events: AgentEvent[],
): Promise<null | SessionCheckpoint> {
  // Latest pinned checkpoint wins (a session may have handed off more than once;
  // each marker points at the spec version flushed at its own boundary).
  const version = latestCompactionCheckpoint(events)?.version
  if (version === undefined) {
    return null
  }

  const init = events.find((e): e is SessionInitializedEvent => e.type === 'session_initialized')
  const projectId = init?.params.projectId
  if (!projectId) {
    return null
  }

  const spec = await loadVersionedJson<Spec>(projectId, version, 'spec.json')
  if (!spec) {
    // No spec checkpoint (genuine 404) -> legacy behavior for the whole fold.
    return null
  }
  const cachedArtifacts = await loadVersionedJson<CachedArtifacts>(
    projectId,
    version,
    'cached-artifacts.json',
  )
  return { cachedArtifacts, spec }
}
