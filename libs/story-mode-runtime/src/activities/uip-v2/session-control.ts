// Do NOT import from workflow.ts
//
// sessionControlActivity resolves a SESSION_CONTROL decision (currently only
// UNDO_LAST) into a set of forward PatchOps the workflow appends as a new
// spec_patched event. It runs
// on the activity (Node) side, so VALUE imports of foldSession + the V1 undo
// resolution helper are allowed. Keep it out of workflow files.
//
// Why forward ops, not a history pop: the V2 event log is append-only, so we
// cannot pop spec_history the way V1 executeUndoLastInternal mutates the
// session in place. Instead we reuse the V1 scope resolution
// (resolveUndoCountByScope) to find how many history entries the undo covers,
// take that target entry's prev_spec, and emit forward ops that transform the
// CURRENT spec into prev_spec. The parent appends them as a spec_patched
// (source: 'session_control'), which becomes its own history entry -- so a
// subsequent UNDO undoes THIS undo (the documented V2 semantic in the design).
//
// Reconstruction approach (pragmatic + correct): rather than reverse-diff each
// op, we fully replace the mutable parts of the spec to match prev_spec:
//   - shots          -> a single replace_all_shots(prev_spec shots)
//   - global fields  -> update_global_field for each changed allowlisted field
// The brand_* global fields are deliberately NOT restored: they carry V1
// freeze/transition guards (BRAND_INPUT_FROZEN, brand_style_directive window,
// brand_video_type phase gate) and only mutate via the named brand ops, so an
// undo of brand state is out of scope here (matches the allowlist surface a
// user-driven undo can legitimately touch).

import type {
  GlobalConstraints,
  PatchOp,
  SessionControlCommand,
  Spec,
  UndoScope,
} from '@reelmakeeasy/uip-planner-runtime'
// Deep import: resolveUndoCountByScope is NOT in the barrel (only the
// side-effecting executeUndoLastInternal is). It is a pure function over
// session.spec_history / transcript, so reusing it on the activity side keeps
// the UNDO scope semantics (LAST_CHANGE / LAST_USER_TURN / COUNT) identical to
// V1. Same deep-import posture as session-state.ts.
import { resolveUndoCountByScope } from '@reelmakeeasy/uip-planner-runtime/runtime/session-runtime'

import type { AgentEvent, ArtifactSlot } from '../../workflows/uip-v2/types'

import { foldSession } from './session-state'
import { resolveSpecCheckpoint } from './spec-checkpoint'

/**
 * The V2 SESSION_CONTROL decision payload, mirroring the V1
 * PlannerSessionControlLike shape (runtime.types.ts) for decision.session_control.
 * command is the V1 SessionControlCommand union ('UNDO_LAST'); undo_scope/count
 * carry the V1 scope semantics consumed by resolveUndoCountByScope.
 */
export interface SessionControlCommandInput {
  command: SessionControlCommand
  count?: null | number
  undo_scope?: null | UndoScope
}

export interface SessionControlInput {
  control: SessionControlCommandInput
  currentArtifacts: Record<string, ArtifactSlot>
  events: AgentEvent[]
}

export interface SessionControlResult {
  // Reason the command produced no change (e.g. nothing to undo). Surfaced to
  // the planner so it can explain to the user instead of an optimistic reply.
  error?: string
  // false when the command could not be carried out (nothing to undo / unknown
  // command). The parent surfaces the failure to the planner; true when ops were
  // produced and a spec_patched should be appended.
  ok: boolean
  ops: PatchOp[]
  specVersionAfter: number
}

const NOTHING_TO_UNDO = 'There is nothing to undo.'
const ONLY_INITIAL_GENERATION_TO_UNDO =
  'The only storyboard change on record is its initial generation, so there is nothing to undo; ' +
  'anchor image and voice changes are not undoable. To change an image, ask for a new one; ' +
  'to remove the storyboard, ask to delete the shots.'

// The non-brand allowlisted update_global_field paths (patch-apply.ts
// ALLOWED_GLOBAL_PATHS minus brand_*). Each is a direct key on GlobalConstraints.
const RESTORABLE_GLOBAL_FIELDS = [
  'directives',
  'geo_scope',
  'key_entities',
  'must_not_violate',
  'pacing',
  'script_category',
  'style',
  'target_audience',
  'time_scope',
  'tone',
  'topic',
  'video_type',
] as const satisfies ReadonlyArray<keyof GlobalConstraints>

/**
 * Resolve a SESSION_CONTROL command into forward PatchOps. For UNDO_LAST we
 * rebuild the session, resolve the undo target via the V1 scope helper, and
 * emit ops that bring the current spec back to that target's prev_spec.
 *
 * Returns ok:false with a reason (and an empty ops list) when there is nothing
 * to undo (no history / scope resolution failed / no diff). The parent surfaces
 * that to the planner instead of appending a spec_patched or an optimistic reply.
 */
export async function sessionControlActivity(
  input: SessionControlInput,
): Promise<SessionControlResult> {
  const { control, currentArtifacts, events } = input
  const checkpointSpec = await resolveSpecCheckpoint(events)
  const session = foldSession(events, currentArtifacts, checkpointSpec)
  const currentVersion = session.spec.meta.spec_version

  if (control.command !== 'UNDO_LAST') {
    // Only UNDO_LAST is defined today; unknown commands are a no-op (no ops).
    return {
      error: 'Unsupported session control command.',
      ok: false,
      ops: [],
      specVersionAfter: currentVersion,
    }
  }

  // Reuse V1 scope resolution to determine how many history entries this undo
  // covers (LAST_CHANGE=1, COUNT=count, LAST_USER_TURN=derived from transcript).
  const undoScope: UndoScope = control.undo_scope ?? 'LAST_CHANGE'
  const resolved = resolveUndoCountByScope(session, undoScope, control.count ?? undefined)
  if (!resolved.ok || !resolved.count || resolved.count <= 0) {
    return { error: NOTHING_TO_UNDO, ok: false, ops: [], specVersionAfter: currentVersion }
  }

  // The undo target is the prev_spec of the OLDEST entry in the undone slice --
  // the spec as it was BEFORE that block of changes (mirrors V1
  // executeUndoLastInternal: slice(-count)[0].prev_spec).
  const targetEntry = session.spec_history.slice(-resolved.count)[0]
  if (!targetEntry) {
    return { error: NOTHING_TO_UNDO, ok: false, ops: [], specVersionAfter: currentVersion }
  }
  const targetSpec = targetEntry.prev_spec

  // A shotless target means the target is the bootstrap spec, i.e. the storyboard
  // generation is the only spec change on record -- anchor image and voice edits
  // never push a spec_history entry, so a user undoing one of those lands here.
  // Undoing would emit replace_all_shots: [] and wipe the plan, so refuse with a
  // reason the planner can turn into a route the user can actually take.
  if (session.spec.visual_script.shots.length > 0 && targetSpec.visual_script.shots.length === 0) {
    return {
      error: ONLY_INITIAL_GENERATION_TO_UNDO,
      ok: false,
      ops: [],
      specVersionAfter: currentVersion,
    }
  }

  const ops = buildOpsToReachSpec(session.spec, targetSpec)
  // Forward ops produce exactly one new spec version (one spec_patched). When
  // nothing actually differs we emit no ops and leave the version unchanged --
  // that reads to the user as "nothing to undo", so report ok:false.
  if (ops.length === 0) {
    return { error: NOTHING_TO_UNDO, ok: false, ops: [], specVersionAfter: currentVersion }
  }
  return { ok: true, ops, specVersionAfter: currentVersion + 1 }
}

/**
 * Build the forward ops that transform `current` into `target`: a full shot
 * replacement plus an update_global_field for each changed restorable global
 * field. Order is shots-then-globals (independent, but stable for readability).
 */
function buildOpsToReachSpec(current: Spec, target: Spec): PatchOp[] {
  const ops: PatchOp[] = []

  // Shots: replace_all_shots is the simplest op that reproduces any shot-level
  // change (add / remove / reorder / edit) in one step. Skip when identical.
  const currentShots = current.visual_script.shots
  const targetShots = target.visual_script.shots
  if (JSON.stringify(currentShots) !== JSON.stringify(targetShots)) {
    ops.push({ op: 'replace_all_shots', shots: targetShots })
  }

  // Global constraints: restore each changed restorable field to its target
  // value. brand_* fields are intentionally excluded (freeze/transition guards).
  const currentGc = current.global_constraints
  const targetGc = target.global_constraints
  for (const field of RESTORABLE_GLOBAL_FIELDS) {
    if (JSON.stringify(currentGc[field]) !== JSON.stringify(targetGc[field])) {
      ops.push({ op: 'update_global_field', path: field, value: targetGc[field] })
    }
  }

  return ops
}
