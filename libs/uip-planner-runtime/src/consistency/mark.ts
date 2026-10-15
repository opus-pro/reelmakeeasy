import type { PatchOp } from '../patch-op-types'

import { changedPathsForOps } from './changed-paths'
import type { ConsistencyEdge } from './dependency-graph'
import { edgesForPath } from './dependency-graph'
import type { ArtifactId, StaleEntry } from './ledger-types'

export interface MarkContext {
  /** spec.meta.audio_source === 'user_audio'. Suppresses script marking. */
  audioMode: boolean
  /**
   * Paths whose VALUE actually changed. When supplied, a path absent from it is
   * not marked: a patch that names a field but leaves it unchanged (an autosave
   * re-sending the current topic) invalidates nothing, and marking from it
   * manufactures staleness out of a no-op. Omitted means "not computed", and
   * every changed path marks.
   */
  changedPaths?: readonly string[]
  /**
   * Artifacts that exist right now. A dependent absent from this list is marked
   * `marked_while_absent`, so its first build discharges the entry.
   * Omitted means "unknown", which is treated as present (the conservative
   * choice: the entry then needs its params matched to clear).
   */
  existingArtifacts?: readonly ArtifactId[]
  /** spec.meta.locked_at != null. Suppresses all marking. */
  locked: boolean
  /**
   * Per-source-path description of what the current mutation changed,
   * keyed by source path. Absent for sources whose delta is not observable at
   * mark time -- a patch already names its ops, so only the opaque
   * cached_artifacts sources supply one.
   */
  sourceChanges?: Readonly<Record<string, string>>
  /** Artifacts written by the current fold step; their own writes must not re-mark. */
  suppressedArtifacts?: readonly ArtifactId[]
  /** Source paths already discharged this step; provenance-keyed suppression. */
  suppressedSourcePaths?: readonly string[]
  timestamp: string
}

/**
 * Whether this edge must not produce an entry right now.
 *
 * Audio mode: audio_vo is locked to the uploaded track (patch-apply.ts:378), so
 * the script cannot drift, and demanding the script tool would deadlock against
 * checkAudioSelfScriptToolCall.
 *
 * Artifact suppression: a tool's own writes must not re-mark the artifact it
 * just produced, or the anchor pair contract livelocks -- satisfying an anchor
 * entry requires a same-batch VS whose arm mutates shots and re-marks anchors.
 */
function isEdgeSuppressed(edge: ConsistencyEdge, ctx: MarkContext): boolean {
  if (ctx.audioMode && edge.dependent === 'script') {
    return true
  }
  return ctx.suppressedArtifacts?.includes(edge.dependent) === true
}

function toEntry(
  edge: ConsistencyEdge,
  sourcePath: string,
  timestamp: string,
  existingArtifacts: MarkContext['existingArtifacts'],
  sourceChange?: string,
): StaleEntry {
  const absent = existingArtifacts !== undefined && !existingArtifacts.includes(edge.dependent)
  return {
    artifact: edge.dependent,
    since: timestamp,
    ...(absent ? { marked_while_absent: true } : {}),
    ...(sourceChange ? { source_change: sourceChange } : {}),
    source_path: sourcePath,
    tier: edge.tier,
    urgency: edge.urgency,
    ...(edge.dischargePaths ? { discharge_paths: [...edge.dischargePaths] } : {}),
    ...(edge.requiredParams ? { required_params: { ...edge.requiredParams } } : {}),
  }
}

/**
 * Upsert one entry, keyed by (artifact, source_path) rather than by artifact
 * alone.
 *
 * Replacing rather than merging is deliberate: a later change to the same path
 * revives a dismissal, because the dismissal was a judgment about the PREVIOUS
 * change and never a permanent exemption.
 */
function upsert(entries: StaleEntry[], fresh: StaleEntry): void {
  const index = entries.findIndex(
    (entry) => entry.artifact === fresh.artifact && entry.source_path === fresh.source_path,
  )
  if (index !== -1) {
    entries[index] = fresh
    return
  }
  entries.push(fresh)
}

/**
 * Record what a spec mutation invalidated.
 *
 * Pure: everything it reads is an argument, so the same event log always folds
 * to the same ledger. Returns a new array; never mutates the input.
 */
export function markStale(
  entries: readonly StaleEntry[],
  ops: PatchOp[],
  ctx: MarkContext,
): StaleEntry[] {
  return markStaleFromSourcePaths(entries, changedPathsForOps(ops), ctx)
}

/**
 * Record what a mutation invalidated, given the source keys directly instead of
 * deriving them from patch ops.
 *
 * `markStale` is the ops-shaped door onto this and every suppression rule is
 * shared, deliberately: a caller that arrives without ops must not get weaker
 * lock / audio-mode / self-write handling than one that arrives with them.
 *
 * The door exists because not every real artifact mutation is a patch. A manual
 * GUI script edit writes `cached_artifacts.working_script.script` and emits no
 * `PatchOp` at all, so `changedPathsForOps` has nothing to convert and the edit
 * is invisible to the ledger -- the planner then wakes to an empty stale[] and
 * correctly does nothing while the brief still describes the old subject.
 */
export function markStaleFromSourcePaths(
  entries: readonly StaleEntry[],
  sourcePaths: readonly string[],
  ctx: MarkContext,
): StaleEntry[] {
  // Nothing can act on an entry once the session is locked.
  if (ctx.locked) {
    return [...entries]
  }
  const next = [...entries]
  for (const path of sourcePaths) {
    if (ctx.suppressedSourcePaths?.includes(path)) {
      continue
    }
    if (ctx.changedPaths !== undefined && !ctx.changedPaths.includes(path)) {
      continue
    }
    for (const edge of edgesForPath(path)) {
      if (!isEdgeSuppressed(edge, ctx)) {
        upsert(
          next,
          toEntry(edge, path, ctx.timestamp, ctx.existingArtifacts, ctx.sourceChanges?.[path]),
        )
      }
    }
  }
  return next
}
