import type { ArtifactId, EdgeTier, EdgeUrgency, RealizabilityContext } from '../consistency'
import { isEnforceable, WORKING_SCRIPT_SOURCE_PATH } from '../consistency'
import type { SessionState } from '../types'

import {
  getUndescribedUploadedAssets,
  hasGlobalConstraintsArtifact,
  hasScriptArtifact,
  hasVisualScriptArtifact,
} from './session-runtime'

export interface ConsistencyContext {
  stale: ConsistencyContextEntry[]
}

/** One ledger entry as the planner sees it. */
export interface ConsistencyContextEntry {
  artifact: ArtifactId
  /** Patch tier only: sibling paths whose VALUE must change to discharge this. */
  discharge_paths?: string[]
  /** Already dismissed with a reason; shown for continuity, never enforced. */
  dismissed: boolean
  /**
   * Params the discharging call must carry, or the discharge does not count.
   * Omitted when `marked_while_absent` -- that entry is discharged by ANY
   * production of the artifact (see `ledger-types.ts`), so showing params
   * here would tell the planner to over-constrain a first build that needs
   * none of them.
   */
  required_params?: Record<string, unknown>
  since: string
  /**
   * What the edit that raised this entry changed -- the delta, where
   * `source_value` is the end state. Both are needed and answer different
   * questions: the delta says whether the edit was material, the end state is
   * what a `patch` disposition has to align against.
   */
  source_change?: string
  source_path: string
  /**
   * What the source says RIGHT NOW, for sources the payload does not otherwise
   * carry.
   *
   * Only `cached_artifacts.*` sources get one. A spec-path source is already
   * visible to the planner in the spec the payload carries, so repeating it
   * here would be pure token cost.
   *
   * Without this the planner is asked whether a dependent still matches a
   * source it cannot read: `available_artifacts.script` is a boolean saying a
   * script EXISTS, never its text. Asked that way it answered "topic and key
   * entities already align with the drafted script" about a brief on volcanoes
   * and a script on geysers -- the only answer available to it.
   */
  source_value?: string
  /**
   * `enforceable` = the guard may require a disposition for it this turn.
   * `deferred` = informational only (artifact absent, phase forbids the
   * executor, an action guard blocks, or it was dismissed).
   */
  status: 'deferred' | 'enforceable'
  tier: EdgeTier
  urgency: EdgeUrgency
}

/**
 * Which artifacts currently exist, using the shipped predicates rather than
 * hand-rolled field tests -- hasVisualScriptArtifact also counts
 * cached_artifacts.pending_visual_script_shots, so a bare shots.length > 0
 * would defer a storyboard that exists but has not auto-applied yet.
 *
 * Anchor bindings live in cached_artifacts, which no spec path addresses, so
 * they are keyed on their spec shadow (shots[].pre_selected_assets) exactly as
 * the dependency graph keys their edges.
 */
export function existingArtifactsOf(session: SessionState): ArtifactId[] {
  const present: ArtifactId[] = []
  if (hasGlobalConstraintsArtifact(session)) {
    present.push('global_constraints')
  }
  if (hasScriptArtifact(session)) {
    present.push('script')
  }
  if (hasVisualScriptArtifact(session)) {
    present.push('visual_script')
  }
  if (
    session.cached_artifacts.anchor_plan?.candidates.length ||
    session.cached_artifacts.anchor_assets_summary?.anchors.length ||
    session.spec.visual_script.shots.some((shot) => shot.pre_selected_assets?.length)
  ) {
    present.push('anchor_bindings')
  }
  return present
}

/**
 * Project the stored ledger into what the planner is shown (section
 * 4.7 W4).
 *
 * Enforceability is DERIVED here, never stored: the mark step runs mid-fold,
 * where `todo_state.phase` is the phase as of the event being folded, not the
 * current one. A stored flag would freeze a historical predicate; deriving it
 * makes deferred -> enforceable on a phase change automatic on every fold.
 */
/**
 * The current text of a stale entry's source, for the sources that live outside
 * the spec.
 *
 * Deliberately a whitelist, not a generic path walk: everything addressable by
 * a spec path is already in the payload, so a walk would duplicate the whole
 * brief onto every brief-sourced entry. Today the pre-refinement script is the
 * only source with no spec address -- in refinement the same text lives at
 * `visual_script.shots[].audio_vo`, which the payload does carry, and the entry
 * there is keyed on that path instead.
 *
 * Not truncated. `SCRIPT_WORD_CAP` already bounds the text, and a truncated
 * script is worse than none for this job: the divergence the planner is being
 * asked about may sit past the cut, which turns "I read it and they match" into
 * a defensible-looking wrong answer.
 */
export function buildConsistencyContext(session: SessionState): ConsistencyContext {
  const entries = session.spec.meta.stale_artifacts ?? []
  if (entries.length === 0) {
    return { stale: [] }
  }
  const ctx: RealizabilityContext = {
    existingArtifacts: existingArtifactsOf(session),
    hasUndescribedUploads: getUndescribedUploadedAssets(session).length > 0,
    phase: session.todo_state.phase,
  }
  return {
    stale: entries.map((entry) => {
      const dismissed = entry.dismissed_at != null
      return {
        artifact: entry.artifact,
        ...(entry.discharge_paths ? { discharge_paths: entry.discharge_paths } : {}),
        dismissed,
        ...(entry.required_params && !entry.marked_while_absent
          ? { required_params: entry.required_params }
          : {}),
        since: entry.since,
        source_path: entry.source_path,
        ...sourceValueFor(session, entry.source_path, dismissed),
        ...(entry.source_change && !dismissed ? { source_change: entry.source_change } : {}),
        status: !dismissed && isEnforceable(entry, ctx) ? 'enforceable' : 'deferred',
        tier: entry.tier,
        urgency: entry.urgency,
      }
    }),
  }
}

function sourceValueFor(
  session: SessionState,
  sourcePath: string,
  dismissed: boolean,
): { source_value?: string } {
  // A dismissed entry stays listed for continuity but is owed no decision, and
  // whatever hangs off it rides along on every later planner call. The script
  // can run to SCRIPT_WORD_CAP, so that is a standing token cost for material
  // nobody is going to use.
  if (dismissed || sourcePath !== WORKING_SCRIPT_SOURCE_PATH) {
    return {}
  }
  // `?? undefined` rather than a truthiness test: an emptied script is a state
  // the planner has to be able to see. A large deletion's delta degrades to
  // counts, so without this it would know something was removed but not that
  // nothing is left.
  const script = session.cached_artifacts.working_script?.script
  return script === undefined ? {} : { source_value: script }
}
