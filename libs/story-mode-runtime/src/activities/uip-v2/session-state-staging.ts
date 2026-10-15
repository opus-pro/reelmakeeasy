/**
 * Tool-output staging for the session fold: put each tool's produced artifact
 * into its cached_artifacts slot. Split out of session-state.ts to keep that
 * file under the max-lines cap; behaviour is unchanged.
 */
import type {
  AnchorAssetPlanArtifact,
  AnchorAssetsSummary,
  AssetDescriptionsArtifact,
  CachedArtifacts,
  GlobalConstraints,
  Shot,
} from '@reelmakeeasy/uip-planner-runtime'

import {
  extractPendingVsApply,
  extractPromptRoute,
  extractScope,
  extractShotEdits,
  extractShots,
  extractString,
} from './session-state-output-extractors'
import type { FoldedSessionState } from './session-state-types'

/**
 * Stage a tool's produced `output` into the matching cached_artifacts slot
 * (/ _loaded_asset_descriptions for describe). Pure staging only -- the
 * auto_apply -> spec step is done by the caller. Extracted from applyToolOutput
 * so the per-tool staging stays within the cognitive-complexity budget.
 */
export function stageToolArtifact(
  state: FoldedSessionState,
  toolName: string,
  output: unknown,
): void {
  switch (toolName) {
    case 'describe_uploaded_images': {
      // output is the merged AssetDescriptionsArtifact ({ generated_at, items })
      // the describe activity read back off session._loaded_asset_descriptions.
      // Stage onto _loaded_asset_descriptions (a SessionState field, not a
      // cached_artifacts slot). No auto_apply mapper -> no spec ops (matching V1:
      // descriptions inform the script/visual prompts, not the spec directly).
      if (output && typeof output === 'object') {
        state._loaded_asset_descriptions = output as AssetDescriptionsArtifact
      }
      break
    }
    case 'generate_anchor_assets': {
      // output is { anchor_plan?, anchor_assets_summary? } the anchor activity
      // read back off cached_artifacts. Stage each present slot. No auto_apply
      // mapper -> no spec ops here; the visual-script tool surfaces anchors into
      // shots later (V1 parity).
      stageAnchorArtifact(state, output)
      break
    }
    case 'generate_explainer_script': {
      stageScriptArtifact(state, output)
      break
    }
    case 'generate_explainer_visual_script': {
      // output is Shot[] or { shots, scope? }.
      const shots = Array.isArray(output) ? (output as Shot[]) : extractShots(output)
      const promptRoute = extractPromptRoute(output)
      if (promptRoute !== undefined) {
        state.cached_artifacts.prompt_route = promptRoute
      }
      if (shots) {
        state.cached_artifacts.pending_visual_script_shots = shots
        const scope = extractScope(output)
        if (scope) {
          state.cached_artifacts.pending_visual_script_scope = scope
        } else {
          state.cached_artifacts.pending_visual_script_scope ??= { scope: 'FULL' }
        }
      }
      break
    }
    // select_auto_style produces the same shape (`{ global_constraints }`) as
    // generate_intent_context -- it field-level-writes style/style_candidates/
    // style_source/selection_method onto the SAME global_constraints object the
    // activity read from the folded session (see runSelectAutoStyleTool) -- so
    // it shares the exact staging path.
    case 'generate_intent_context':
    case 'select_auto_style': {
      stageIntentContextArtifact(state, output)
      break
    }
    case 'plan_asset_assignment': {
      // output is an AssetAssignmentPlanArtifact.
      if (output && typeof output === 'object') {
        state.cached_artifacts.pending_asset_assignment_plan =
          output as CachedArtifacts['pending_asset_assignment_plan']
      }
      break
    }
    default: {
      break
    }
  }
}

/**
 * Stage the intent-context tool's output. intent_context produces
 * global_constraints (which now carries the user's positive `directives`
 * inline, parallel to must_not_violate). The V2 activity returns
 * { global_constraints }; stage it so the auto_apply mapper applies it.
 *
 * Backward-compat: older logs carry a bare GlobalConstraints output (no
 * `global_constraints` key); fall back to treating `output` as the constraints
 * when the wrapper key is absent.
 */
export function stageIntentContextArtifact(state: FoldedSessionState, output: unknown): void {
  if (!output || typeof output !== 'object') {
    return
  }
  const wrapped = output as {
    global_constraints?: GlobalConstraints
  }
  state.cached_artifacts.pending_global_constraints =
    wrapped.global_constraints ?? (output as GlobalConstraints)
}

/**
 * Stage the script tool's { script, shot_edits?, scope?, pending_vs_apply? }
 * output (or a bare script string for legacy logs) into working_script.
 *
 * The script_to_ops mapper is FULL-scope-only (returns [] for FULL), so in
 * bootstrap_script (no shots) the script lives in working_script.script and is
 * auto-applied into shots later by the visual-script tool -- V1 parity.
 *
 * scope + pending_vs_apply are load-bearing for the FULL-scope script ->
 * visual-script two-step dance (shouldPreferFullScriptArtifact requires
 * pending_vs_apply === true). Prefer them when present, falling back to prev /
 * defaults for legacy logs that only carried { script, shot_edits }.
 */
export function stageScriptArtifact(state: FoldedSessionState, output: unknown): void {
  const stringOut = typeof output === 'string'
  const script = stringOut ? output : extractString(output, 'script')
  const shotEdits = extractShotEdits(output)
  const scope = stringOut ? undefined : extractScope(output)
  const pendingVsApply = stringOut ? undefined : extractPendingVsApply(output)
  const prev = state.cached_artifacts.working_script
  state.cached_artifacts.working_script = {
    ...(prev ?? { scope: { scope: 'FULL' }, shot_edits: [] }),
    scope: scope ?? prev?.scope ?? { scope: 'FULL' },
    script: script ?? prev?.script ?? '',
    shot_edits: shotEdits ?? prev?.shot_edits ?? [],
    pending_vs_apply: pendingVsApply ?? prev?.pending_vs_apply,
  }
}

/**
 * Stage the anchor tool's { anchor_plan?, anchor_assets_summary?,
 * absorbed_upload_ids? } output.
 *
 * absorbed_upload_ids is the session-cumulative set of uploads canonicalized
 * into anchors. V1 accumulates it inside the anchor tool (recordAbsorbedUploadIds)
 * and the VS tool / upload-binding checks read it to EXCLUDE already-absorbed
 * uploads from being re-offered as direct uploads. The anchor activity reads it
 * back so foldSession re-stages it; it is cumulative, so we MERGE rather than
 * replace (an earlier anchor call's absorbed ids must survive a later call that
 * absorbed none).
 */
export function stageAnchorArtifact(state: FoldedSessionState, output: unknown): void {
  if (!output || typeof output !== 'object') {
    return
  }
  const anchor = output as {
    absorbed_upload_ids?: string[]
    anchor_assets_summary?: AnchorAssetsSummary
    anchor_plan?: AnchorAssetPlanArtifact
  }
  if (anchor.anchor_plan) {
    state.cached_artifacts.anchor_plan = anchor.anchor_plan
  }
  if (anchor.anchor_assets_summary) {
    state.cached_artifacts.anchor_assets_summary = anchor.anchor_assets_summary
  }
  if (anchor.absorbed_upload_ids?.length) {
    const merged = new Set([
      ...(state.cached_artifacts.absorbed_upload_ids ?? []),
      ...anchor.absorbed_upload_ids,
    ])
    state.cached_artifacts.absorbed_upload_ids = [...merged]
  }
}
