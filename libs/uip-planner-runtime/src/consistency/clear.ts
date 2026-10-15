import type { ArtifactId, StaleEntry } from './ledger-types'

/**
 * Which artifacts a completed tool call produced.
 *
 * Keyed on the artifact, not on the manifest, because the anchor+VS pair
 * dispatches as ONE synthetic tool named `anchor_vs_batch`
 * (execute-decision.ts:326-379) whose name is absent from
 * `PlannerToolCall['tool']`, so `getToolManifest` cannot resolve it. That batch
 * is mandatory for bootstrap_visual's first visual generation
 * (unified-planner-prompt.ts:391), so a toolName-keyed clear would miss the
 * dominant path entirely.
 *
 * An unknown tool returns [] rather than throwing: a renamed or future tool in a
 * replayed log must never brick the projection.
 */
export function artifactsProducedBy(toolName: string, output?: unknown): readonly ArtifactId[] {
  switch (toolName) {
    case 'anchor_vs_batch': {
      return anchorVsBatchArms(output)
    }
    case 'generate_anchor_assets': {
      return ['anchor_bindings']
    }
    case 'generate_explainer_script': {
      return ['script']
    }
    case 'generate_explainer_visual_script': {
      return ['visual_script']
    }
    case 'generate_intent_context': {
      return ['global_constraints']
    }
    case 'plan_asset_assignment': {
      return ['anchor_bindings']
    }
    default: {
      return []
    }
  }
}

/**
 * Which arms of an `anchor_vs_batch` actually produced their artifact.
 *
 * Each arm reports its own `ok`, so read them rather than assuming both
 * committed. Clearing both regardless would discharge staleness a failed arm
 * never addressed, which is exactly the silent metric-lying discharge the
 * scope-aware clear exists to prevent.
 *
 * An unreadable output falls back to both arms: that matches the pre-existing
 * behaviour and only ever over-clears in a shape we cannot inspect, which is
 * preferable to stranding entries on every batch whose payload we misparse.
 */
function anchorVsBatchArms(output: unknown): readonly ArtifactId[] {
  if (!output || typeof output !== 'object') {
    return ['visual_script', 'anchor_bindings']
  }
  const batch = output as { anchor?: { ok?: boolean }; vs?: { ok?: boolean } }
  if (batch.anchor === undefined && batch.vs === undefined) {
    return ['visual_script', 'anchor_bindings']
  }
  const arms: ArtifactId[] = []
  if (batch.vs?.ok !== false) {
    arms.push('visual_script')
  }
  if (batch.anchor?.ok !== false) {
    arms.push('anchor_bindings')
  }
  return arms
}

/**
 * Discharge entries the completed call actually satisfied.
 *
 * Scope-aware: an entry carrying `required_params` is discharged ONLY when the
 * call carried every one of them. Without this a surgical SHOT_IDS structure
 * edit would discharge a mandatory pacing entry, and the re-segmentation would
 * never run while the ledger reported clean.
 *
 * Unknown call params keep a param-carrying entry: the alternative -- clearing
 * anyway -- is exactly the silent metric-lying discharge this rule prevents.
 */
export function clearStale(
  entries: readonly StaleEntry[],
  produced: readonly ArtifactId[],
  callParams: Readonly<Record<string, unknown>> | undefined,
): StaleEntry[] {
  return entries.filter((entry) => {
    if (!produced.includes(entry.artifact)) {
      return true
    }
    // A patch-tier entry is discharged by a PATCH_SPEC, never by a tool run.
    if (entry.tier === 'patch') {
      return true
    }
    if (!entry.required_params) {
      return false
    }
    // A first build discharges regardless of params: the artifact did not exist
    // when the entry was marked, so it is built fresh from current state and
    // cannot be stale relative to the source that marked it.
    if (entry.marked_while_absent) {
      return false
    }
    if (!callParams) {
      return true
    }
    const satisfied = Object.entries(entry.required_params).every(([key, value]) => {
      if (
        entry.artifact === 'anchor_bindings' &&
        key === 'scope' &&
        value === 'ANCHOR_IDS' &&
        callParams[key] === 'FULL'
      ) {
        return true
      }
      return callParams[key] === value
    })
    return !satisfied
  })
}

/**
 * Discharge patch-tier entries. `changedPaths` must be
 * paths whose VALUE actually changed, not merely paths the patch named --
 * otherwise echoing the stale values back would clear the entry, which is the
 * cheapest form of the garbage-discharge hole. The caller computes this from the
 * pre-image the fold already holds.
 *
 * "At least one" rather than "all": the planner may legitimately judge that only
 * some siblings needed updating, and forcing all five would push it toward
 * writing filler into the rest.
 */
export function clearStaleByPatch(
  entries: readonly StaleEntry[],
  changedPaths: readonly string[],
): StaleEntry[] {
  return entries.filter((entry) => {
    if (entry.tier !== 'patch' || !entry.discharge_paths) {
      return true
    }
    return !entry.discharge_paths.some((path) => changedPaths.includes(path))
  })
}
