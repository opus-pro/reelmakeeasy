import type { PatchOp } from '../patch-op-types'

/**
 * Normalise patch ops to the stable path strings the dependency graph is keyed
 * on. Shot ids are dropped: an edge cares that `audio_vo` changed,
 * not which shot.
 *
 * `retime_shot` is deliberately absent. Only `withDeterministicRetimeForScriptChanges`
 * emits it (tool-internals/visual-script-timing.ts:91-92) and the planner op
 * schema has no such literal, so it is runtime-owned derive output and must
 * never mark staleness. Brand ops are absent for the same reason the graph has
 * no brand edges.
 */
export function changedPathsForOps(ops: PatchOp[]): string[] {
  const seen: string[] = []
  const add = (path: string): void => {
    if (!seen.includes(path)) {
      seen.push(path)
    }
  }
  for (const op of ops) {
    switch (op.op) {
      case 'add_preselected_asset':
      case 'remove_preselected_asset': {
        add('visual_script.shots.pre_selected_assets')
        break
      }
      case 'delete_shots':
      case 'reorder_shots':
      case 'replace_all_shots':
      case 'replace_shots_range': {
        add('visual_script.shots')
        break
      }
      case 'update_global_field': {
        add(`global_constraints.${op.path}`)
        break
      }
      case 'update_shot_field': {
        add(`visual_script.shots.${op.field}`)
        break
      }
      default: {
        break
      }
    }
  }
  return seen
}
