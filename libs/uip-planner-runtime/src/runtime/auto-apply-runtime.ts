import { canonicalizeGlobalConstraintValue, normalizeShotId } from '../normalization'
import { getToolManifest } from '../tool-manifest'
import { AssetAssignmentPlanAction, PatchOp, PlannerToolCall, SessionState } from '../types'

import { buildVisualScriptAutoApplyOps } from './visual-auto-apply-runtime'

const GLOBAL_CONSTRAINT_ARTIFACT_FIELDS = [
  'video_type',
  'script_category',
  'topic',
  'key_entities',
  'geo_scope',
  'time_scope',
  'brand_scope',
  'target_audience',
  'tone',
  'script_language',
  'style',
  // Auto Style Selection. Written by select_auto_style alongside
  // `style` (which is already in this list): the ranked candidate list, the
  // provenance of the current `style` value, and how it was chosen. NOT
  // included: `style_mode`, which is seed-time-only (set once at session
  // creation from the feature gate) and never produced by a tool.
  'style_candidates',
  'style_source',
  'selection_method',
  'pacing',
  'directives',
  'must_not_violate',
] as const

// The three fields ONLY select_auto_style (and the
// bootstrap_visual fallback) may legitimately produce. generate_intent_context's
// LLM schema never yields them, so on a brief RE-RUN (brand_review ->
// bootstrap_script) the shared mapper would otherwise emit update_global_field
// ops carrying `undefined` for all three -- wiping a prior auto pick's
// provenance + candidate list. They are excluded from generate_intent_context's
// per-tool artifact field set (see globalConstraintArtifactFieldsForTool), never
// globally removed (select_auto_style still needs them).
const AUTO_SELECTION_ONLY_ARTIFACT_FIELDS = new Set<string>([
  'selection_method',
  'style_candidates',
  'style_source',
])

type ArtifactToOpsMapper = (session: SessionState, tool: PlannerToolCall['tool']) => PatchOp[]
type MapperName =
  | 'asset_assignment_to_ops'
  | 'global_constraints_to_ops'
  | 'script_to_ops'
  | 'visual_script_to_ops'

const MAPPERS: Record<MapperName, ArtifactToOpsMapper> = {
  asset_assignment_to_ops: mapAssetAssignmentPlanArtifactToOps,
  global_constraints_to_ops: mapGlobalConstraintsArtifactToOps,
  script_to_ops: mapScriptArtifactToOps,
  visual_script_to_ops: mapVisualScriptArtifactToOps,
}

export function buildAutoApplyOpsForTool(
  session: SessionState,
  tool: PlannerToolCall['tool'],
): PatchOp[] {
  const manifest = getToolManifest(tool)
  if (!manifest.auto_apply?.enabled) {
    return []
  }
  return MAPPERS[manifest.auto_apply.mapper](session, tool)
}

function applyAssetAssignmentAction(params: {
  action: AssetAssignmentPlanAction
  assignedByShotId: Map<string, Set<string>>
  ops: PatchOp[]
  uploadedAssetIds: Set<string>
}): void {
  const { action, assignedByShotId, ops, uploadedAssetIds } = params
  const normalizedShotId = normalizeShotId(action.shot_id) ?? action.shot_id
  const assignedSet = assignedByShotId.get(normalizedShotId)
  if (!assignedSet) {
    return
  }

  if (action.op === 'ADD') {
    const assignedKey = buildAssignedAssetKey(action.asset_id, action.asset_source)
    if (
      (action.asset_source === 'user_upload' && !uploadedAssetIds.has(action.asset_id)) ||
      assignedSet.has(assignedKey)
    ) {
      return
    }
    ops.push({
      op: 'add_preselected_asset',
      shot_id: normalizedShotId,
      asset: {
        asset_id: action.asset_id,
        source: action.asset_source,
        usage: action.usage,
      },
    })
    assignedSet.add(assignedKey)
    return
  }

  const assignedKey = buildAssignedAssetKey(action.asset_id, action.asset_source)
  if (!assignedSet.has(assignedKey)) {
    return
  }
  ops.push({
    op: 'remove_preselected_asset',
    shot_id: normalizedShotId,
    asset_id: action.asset_id,
    asset_source: action.asset_source,
  })
  assignedSet.delete(assignedKey)
}

function buildAssignedAssetKey(
  assetId: string,
  assetSource: 'anchor_asset' | 'user_upload',
): string {
  return `${assetSource}::${assetId}`
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function mapAssetAssignmentPlanArtifactToOps(session: SessionState): PatchOp[] {
  const artifact = session.cached_artifacts.pending_asset_assignment_plan
  if (!artifact?.actions?.length) {
    return []
  }

  const uploadedAssetIds = new Set(
    (session.cached_artifacts.uploaded_assets ?? []).map((asset) => asset.asset_id),
  )
  const assignedByShotId = new Map<string, Set<string>>(
    session.spec.visual_script.shots.map((shot) => [
      normalizeShotId(shot.shot_id) ?? shot.shot_id,
      new Set(
        shot.pre_selected_assets.map((asset) =>
          buildAssignedAssetKey(asset.asset_id, asset.source),
        ),
      ),
    ]),
  )

  const ops: PatchOp[] = []
  for (const action of artifact.actions) {
    applyAssetAssignmentAction({
      action,
      assignedByShotId,
      ops,
      uploadedAssetIds,
    })
  }
  return ops
}

function mapGlobalConstraintsArtifactToOps(
  session: SessionState,
  tool: PlannerToolCall['tool'],
): PatchOp[] {
  const artifact = session.cached_artifacts.pending_global_constraints
  if (!artifact) {
    return []
  }

  if (jsonEqual(artifact, session.spec.global_constraints)) {
    return []
  }

  return globalConstraintArtifactFieldsForTool(session, tool, artifact).map((path) => ({
    op: 'update_global_field',
    path,
    value: canonicalizeGlobalConstraintValue(path, artifact[path]),
  }))
}

/**
 * The global_constraints fields a given tool's auto-apply may write.
 *
 * select_auto_style writes ONLY the four style-selection fields it owns. Its
 * output is folded from the event-log SNAPSHOT taken when the child was
 * dispatched (start-auto-style-child.ts passes `events: [...state.events]`), so
 * every other field in the full set would be written back at its dispatch-time
 * value -- reverting anything the user changed while the pick was in flight
 * (a script-review brief edit to topic/tone/directives, say). `style` /
 * `style_source` are additionally dropped when
 * the user has already committed a switch, so a late-landing pick cannot
 * downgrade 'auto_switched' / 'manual' back to 'auto' -- the same protection
 * generate_intent_context already has. `style_candidates` + `selection_method`
 * still land: they describe the agent's offer and how it was ranked, which stays
 * true (and analytically useful) even when the user overrode the result.
 *
 * Every other non-intent tool uses the full set. generate_intent_context uses a
 * REDUCED set:
 *   - it never writes style_candidates (that stays select_auto_style's), and
 *     writes style_source / selection_method only in the case: a style
 *     the user named in their prompt, captured on a first run (no provenance
 *     yet). On a re-run over an existing provenance all three stay excluded, so
 *     a brief re-run still cannot wipe a prior pick, and
 *   - it writes `style` ONLY while the style has NO provenance yet (style_source
 *     unset, i.e. first run). Once a pick landed ('auto'), the user switched
 *     ('auto_switched' / 'manual'), or the fallback seeded one, the style is
 *     PRESERVED: the pick runs at most once per session, so a reset here could
 *     never be refilled and would strand the session unstyled.
 */
function globalConstraintArtifactFieldsForTool(
  session: SessionState,
  tool: PlannerToolCall['tool'],
  artifact: SessionState['spec']['global_constraints'],
): readonly (keyof SessionState['spec']['global_constraints'])[] {
  const currentSource = session.spec.global_constraints.style_source
  const userCommitted = currentSource === 'auto_switched' || currentSource === 'manual'
  // Once the style has a provenance -- an auto pick landed, the user switched, or
  // the bootstrap_visual fallback seeded one -- generate_intent_context must never
  // rewrite it. The pick runs at most once per session
  // (UIP_V2_AUTO_STYLE_SINGLE_PICK_PATCH), so a reset-to-empty-seed here can no
  // longer be refilled: it would simply strand the session unstyled. Before any
  // provenance exists (first run) the brief-derived style is still written.
  const preserveStyle = currentSource != null
  if (tool === 'select_auto_style') {
    return GLOBAL_CONSTRAINT_ARTIFACT_FIELDS.filter((path) => {
      if (!AUTO_SELECTION_ONLY_ARTIFACT_FIELDS.has(path) && path !== 'style') {
        return false
      }
      return !(userCommitted && (path === 'style' || path === 'style_source'))
    })
  }
  if (tool !== 'generate_intent_context') {
    return GLOBAL_CONSTRAINT_ARTIFACT_FIELDS
  }
  // The one case where the brief legitimately owns the provenance
  // fields -- it captured a style the user named in the prompt, so `style`
  // comes with `style_source: 'manual'` + `selection_method: 'user_prompt'` and
  // those two must land with it (they are what stops the concurrent auto pick
  // from overwriting it, and what exempts it from the once-per-brief re-pick).
  // Still barred on a re-run over an existing provenance (`preserveStyle`), so
  // the invariant this exclusion exists for -- a brief re-run never wipes a
  // prior pick -- is unchanged. `style_candidates` stays select_auto_style's
  // alone in every case.
  const capturedPromptStyle = !preserveStyle && artifact.selection_method === 'user_prompt'
  return GLOBAL_CONSTRAINT_ARTIFACT_FIELDS.filter((path) => {
    if (AUTO_SELECTION_ONLY_ARTIFACT_FIELDS.has(path)) {
      return capturedPromptStyle && (path === 'selection_method' || path === 'style_source')
    }
    if (preserveStyle && path === 'style') {
      return false
    }
    return true
  })
}

function mapScriptArtifactToOps(session: SessionState): PatchOp[] {
  const artifact = session.cached_artifacts.working_script
  if (!artifact?.shot_edits?.length) {
    return []
  }
  if (artifact.scope.scope === 'FULL') {
    return []
  }

  const specShotIds = new Set(session.spec.visual_script.shots.map((shot) => shot.shot_id))
  const ops: PatchOp[] = []
  for (const edit of artifact.shot_edits) {
    if (!specShotIds.has(edit.shot_id)) {
      continue
    }
    const current = session.spec.visual_script.shots.find((shot) => shot.shot_id === edit.shot_id)
    if (!current || current.audio_vo === edit.audio_vo) {
      continue
    }
    ops.push({
      op: 'update_shot_field',
      shot_id: edit.shot_id,
      field: 'audio_vo',
      value: edit.audio_vo,
    })
  }
  return ops
}

function mapVisualScriptArtifactToOps(session: SessionState): PatchOp[] {
  const artifact = session.cached_artifacts.pending_visual_script_shots
  if (!artifact) {
    return []
  }

  return buildVisualScriptAutoApplyOps({
    currentShots: session.spec.visual_script.shots,
    nextShots: JSON.parse(JSON.stringify(artifact)),
    scope: session.cached_artifacts.pending_visual_script_scope ?? { scope: 'FULL' },
  })
}
