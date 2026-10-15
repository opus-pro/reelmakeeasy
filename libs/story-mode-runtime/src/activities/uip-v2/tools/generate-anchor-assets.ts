// Do NOT import from workflow.ts
//
// UIP V2 -- generate_anchor_assets TOOL ACTIVITY (Task 2.6). Most V1-intricate
// of the six.
//
// Path: V1 `runGenerateAnchorAssetsTool` wrapper. The wrapper runs the shared
// anchor generation (plan resolve -> Phase B/C asset generation), writing TWO
// artifacts onto the mutated session as it goes:
//   - `session.cached_artifacts.anchor_plan` (set inside the raw tool /
//     onPlanReady milestone)
//   - `session.cached_artifacts.anchor_assets_summary` (set by the wrapper)
// We read both back off the mutated session and return them together.
//
// Output shape: { anchor_plan?, anchor_assets_summary? }. foldSession
// .applyToolOutput for generate_anchor_assets stages anchor_plan into
// cached_artifacts.anchor_plan and anchor_assets_summary into
// cached_artifacts.anchor_assets_summary. There is NO auto_apply mapper for this
// tool (manifest has no `auto_apply`), so the activity only stages these
// artifacts -- the deeper spec reconciliation (anchor surfacing in shots) is
// driven later by the visual-script tool, same as V1.
//
// Best-effort note (per Task 2.6): the anchor wrapper performs real asset
// generation and may return a non-ok ToolCallResult (partial failures,
// unresolved targets). We still read back whatever artifacts it staged before
// failing so the parent's tool_completed carries the partial plan/summary; the
// ok/failure adjudication itself is the Phase-3 tool-runner's job (it inspects
// the ToolCallResult and decides retry vs surface). The activity does not throw
// on a non-ok result -- it returns the staged artifacts.

import type {
  AnchorAssetPlanArtifact,
  AnchorAssetsSummary,
  PatchOp,
} from '@reelmakeeasy/uip-planner-runtime'
import { runGenerateAnchorAssetsTool } from '@reelmakeeasy/uip-planner-runtime'

import {
  buildAnchorRemovalCleanupOps,
  normalizeToolParams,
  prepareToolRuntime,
  toToolOutcome,
} from './runtime'
import type { ToolActivityInput, ToolActivityResult } from './types'

export interface GenerateAnchorAssetsActivityOutput {
  // Session-cumulative uploads canonicalized into anchors. Read back so
  // foldSession re-stages it (V1's recordAbsorbedUploadIds writes it inside the
  // tool); the VS tool + upload-binding checks read it to exclude already-
  // absorbed uploads. Dropping it (the original bug) let the VS tool re-offer
  // absorbed uploads as direct uploads.
  absorbed_upload_ids?: string[]
  anchor_assets_summary?: AnchorAssetsSummary
  anchor_plan?: AnchorAssetPlanArtifact
  // Deterministic remove_preselected_asset ops for shots that still reference a
  // removed anchor (scope=ANCHOR_IDS REMOVE_ANCHOR). foldSession applies them to
  // the spec. V1 parity: maybeApplyDeterministicAnchorRemovalCleanup. Only
  // populated on a successful anchor run (V1 runs cleanup only on success).
  cleanup_ops?: PatchOp[]
}

export async function generateAnchorAssetsActivity(
  input: ToolActivityInput,
): Promise<ToolActivityResult> {
  const { runtime, session, userMessage } = await prepareToolRuntime(input)
  const params = normalizeToolParams(input.toolName, input.toolInput)

  const result = await runGenerateAnchorAssetsTool(runtime, session, userMessage, params)

  const cleanupOps = result.ok
    ? buildAnchorRemovalCleanupOps(params, session.spec.visual_script.shots)
    : []
  const output: GenerateAnchorAssetsActivityOutput = {
    absorbed_upload_ids: session.cached_artifacts.absorbed_upload_ids,
    anchor_assets_summary: session.cached_artifacts.anchor_assets_summary,
    anchor_plan: session.cached_artifacts.anchor_plan,
    cleanup_ops: cleanupOps.length > 0 ? cleanupOps : undefined,
  }
  return { output, toolResult: toToolOutcome(result) }
}
