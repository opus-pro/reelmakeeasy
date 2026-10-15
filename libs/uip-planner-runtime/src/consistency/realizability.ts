import type { PlannerPhase } from '../types'

import type { ArtifactId, StaleEntry } from './ledger-types'

export interface RealizabilityContext {
  /** hasScriptArtifact / hasVisualScriptArtifact / hasGlobalConstraintsArtifact results. */
  existingArtifacts: readonly ArtifactId[]
  /** True while any uploaded asset is still undescribed. */
  hasUndescribedUploads: boolean
  phase: PlannerPhase
}

/**
 * Phases where NO discharge is legal, so every entry defers regardless of tier.
 *
 * mode_confirmation: the pre-confirmation prompt allows only ASK_CLARIFY and
 * MODE_CONFIRMED, and that planner payload does not even carry
 * global_constraints (context-builder.ts:330-333).
 * bootstrap_brand / brand_review: the only valid action is TODO_UPDATE_ONLY
 * (unified-planner-prompt.ts:192).
 */
const NO_DISCHARGE_PHASES: readonly PlannerPhase[] = [
  'mode_confirmation',
  'bootstrap_brand',
  'brand_review',
]

/**
 * Whether the enforcing layer would REJECT a tool discharge for `artifact` in
 * `phase` at the entry's required scope.
 *
 * Mirrors tool-runtime.ts:185-212 and :311-318 cell for cell, deliberately as
 * rejection rules rather than an allow-table: two of the real gates are
 * scope-granular, and an allow-table cannot express them. A flat
 * phase-to-artifact allow-list silently defers realizable edges, and false
 * negatives here are invisible -- the feature simply does not fire and nothing
 * reports it.
 *
 * NOT sourced from ALLOWED_TOOLS_PER_PHASE (phase-machine.ts:97-121): that table
 * is dead code and disagrees with the enforcing layer -- it claims
 * `script_review: []` while script_review permits generate_explainer_script.
 */
function toolDischargeBlocked(
  artifact: ArtifactId,
  phase: PlannerPhase,
  requiredParams: Readonly<Record<string, unknown>> | undefined,
): boolean {
  const scope = requiredParams?.scope
  // FULL anchor-set derivation is legal during bootstrap and for a ledger-
  // driven recovery in refinement. It remains blocked in earlier phases.
  if (
    artifact === 'anchor_bindings' &&
    scope === 'FULL' &&
    phase !== 'bootstrap_visual' &&
    phase !== 'refinement'
  ) {
    return true
  }
  if (phase === 'script_review') {
    // Blocks anchor / visual / asset-assignment; permits intent-context + script.
    return artifact === 'anchor_bindings' || artifact === 'visual_script'
  }
  if (phase === 'bootstrap_script') {
    // Blocks visual + asset-assignment outright, and anchor only at FULL --
    // which the scope rule above already covered.
    return artifact === 'visual_script'
  }
  // bootstrap_visual and refinement block nothing else at this layer.
  return false
}

/**
 * Whether the guard may enforce this entry now. Derived,
 * never stored: the mark step runs mid-fold where the phase is historical.
 */
export function isEnforceable(entry: StaleEntry, ctx: RealizabilityContext): boolean {
  // (1) the artifact must exist -- a storyboard that has not been generated
  //     cannot be stale, and bootstrap_visual reads the brief fresh anyway.
  if (!ctx.existingArtifacts.includes(entry.artifact)) {
    return false
  }
  if (NO_DISCHARGE_PHASES.includes(ctx.phase)) {
    return false
  }
  // (3) action-level guards are state-keyed, not phase-keyed:
  //     guardUndescribedAssetsBeforeAction (planner-guards.ts:141-215) blocks
  //     PATCH_SPEC and TOOL_CALLS in ANY phase while an upload is undescribed.
  if (ctx.hasUndescribedUploads) {
    return false
  }
  // (2) a patch discharge is legal in every remaining phase; a tool discharge is
  //     not.
  if (entry.tier === 'patch') {
    return true
  }
  return !toolDischargeBlocked(entry.artifact, ctx.phase, entry.required_params)
}
