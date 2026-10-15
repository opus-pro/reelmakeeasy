import { createSubLogger } from '@reelmakeeasy/common/logger'

import { resolveFixedSegmentEditsFromWorkingScript } from '../tool-internals/generate-visual-script-full-scope-story-runtime'
import { extractUserUploadBrandAssetIds } from '../tool-internals/visual-script-asset-ids'
import {
  ensureCanonicalAnchorPlan,
  ensureUpdatedAnchorPlan,
  MissingAnchorPlanError,
  UnresolvedAnchorTargetsError,
} from '../tools/generate-anchor-assets'
import {
  AnchorAssetsSummary,
  AssetDescriptionsArtifact,
  PlannerStructureEdit,
  PlannerToolCall,
  PlannerToolParams,
  ScriptShotEdit,
  SessionState,
  Shot,
  UploadedAsset,
} from '../types'
import { computeWordCountBudget, countWords } from '../word-budget'

import { collapseWhitespace } from './planner-contract-helpers'
import { remapDirectiveShotIds } from './planner-directive-reconcile'
import { plannerLog } from './planner-log'
import { ToolCallResult } from './runtime.types'
import { toScopeSpec } from './session-runtime'
import { getSharedArtifactBatchContext } from './shared-artifact-batch-context'
import { applyStructureEditToVisualScript } from './structure-runtime'
import { isFullCoverageScope } from './visual-auto-apply-runtime'

const logger = createSubLogger('user-intent-planner')

type VisualScriptAnchorPlan = Awaited<ReturnType<typeof ensureCanonicalAnchorPlan>>['assetPlan']

export function mapLoadedAssetDescriptionsToImageAnalyses(
  session: SessionState,
): Array<{ description: string; filename?: string }> | undefined {
  const items = session._loaded_asset_descriptions?.items
  if (!items || items.length === 0) {
    return undefined
  }
  return items
    .filter((item) => (item.description?.trim() ?? '').length > 0)
    .map((item) => ({ description: item.description ?? '', filename: item.file_name }))
}

/**
 * Build the user-visible failure message for `generate_anchor_assets`
 * when at least one anchor came back with `status === 'failed'`.
 *
 * The legacy message was `"Generated anchor assets with N failure(s)
 * (R/T ready)."` -- it told the planner HOW MANY anchors failed but
 * not WHICH ones, so the planner had no way to tell whether the
 * failure affected the anchor(s) it was actually working on. One session
 * hit this: the user was swapping two character anchors (`char_hero`,
 * `char_sidekick`) while the failure was on an unrelated `obj_acme_logo`
 * (a passthrough Phase-C bug).
 * The planner read `"1 failure(s) (8/9 ready)"` as "my swap failed"
 * and re-emitted the same batch ~20 times across a single user turn.
 *
 * The enriched message lists both the failed AND the successful
 * anchor_ids so the planner can cross-reference its own request:
 * if every anchor it asked for appears in `Successful anchor_id(s):`,
 * the operation effectively succeeded and the unrelated failure can
 * be ignored / reported separately.
 *
 * Anchor IDs are sorted alphabetically so the resulting message hashes
 * deterministically (the existing tool-failure loop cap keys on
 * `intent_signature`, not the message, so this is just a
 * readability convention; tests rely on it for stable expected values).
 */
export function buildAnchorFailureMessage(summary: AnchorAssetsSummary): string {
  const failedAnchorIds = summary.anchors
    .filter((anchor) => anchor.status === 'failed')
    .map((anchor) => anchor.anchor_id)
    .sort()
  const succeededAnchorIds = summary.anchors
    .filter((anchor) => anchor.status === 'ready')
    .map((anchor) => anchor.anchor_id)
    .sort()
  const base = `Generated anchor assets with ${failedAnchorIds.length} failure(s) (${summary.ready_count}/${summary.total_count} ready).`
  const failedPart =
    failedAnchorIds.length > 0 ? ` Failed anchor_id(s): ${failedAnchorIds.join(', ')}.` : ''
  const succeededPart =
    succeededAnchorIds.length > 0
      ? ` Successful anchor_id(s): ${succeededAnchorIds.join(', ')}.`
      : ''
  return `${base}${failedPart}${succeededPart}`
}

export function collectVisualScriptMissingDependencies(
  shouldInjectDirectives: boolean,
  directives: null | unknown,
  script: null | string | undefined,
  constraints: null | unknown,
): string[] {
  const missing: string[] = []
  if (shouldInjectDirectives && !directives) {
    missing.push('directives')
  }
  if (!script) {
    missing.push('script')
  }
  if (!constraints) {
    missing.push('global_constraints')
  }
  return missing
}

/**
 * Filter `asset_descriptions.items` so the VS prompt's "Allowed Direct
 * Uploaded Asset IDs" list never exposes an upload that has been
 * absorbed into an anchor candidate.
 *
 * Two sources contribute to the exclusion set:
 *
 * 1. Current `anchorPlan.candidates[*].source_asset_ids` -- uploads
 *    actively wired into an anchor right now.
 *
 * 2. Session-cumulative `absorbed_upload_ids` -- uploads that were once
 *    a source for some anchor but have since been REPLACE-d off the
 *    candidate. These linger in `uploaded_assets` and
 *    `_loaded_asset_descriptions` (we never delete uploads), so without
 *    this second source they would leak back into the VS prompt as a
 *    free direct upload -- and the VS LLM would happily bind a shot to
 *    the leftover image even though an anchor for the same subject now
 *    exists. See `recordAbsorbedUploadIds`.
 */
export function excludeCanonicalizedAnchorSourceAssets(
  assetDescriptionsJson: string,
  anchorPlan: null | {
    candidates: Array<{ source_asset_id: null | string; source_asset_ids?: string[] }>
  },
  absorbedUploadIds?: null | string[],
): string {
  const planSourceIds =
    anchorPlan?.candidates?.flatMap((candidate) => {
      const ids = candidate.source_asset_ids?.length
        ? candidate.source_asset_ids
        : [candidate.source_asset_id ?? '']
      return ids.map((assetId) => assetId?.trim() ?? '').filter((assetId) => assetId.length > 0)
    }) ?? []
  const historicalIds =
    absorbedUploadIds?.map((id) => id?.trim() ?? '').filter((id) => id.length > 0) ?? []
  const absorbedAssetIds = new Set([...historicalIds, ...planSourceIds])
  if (absorbedAssetIds.size === 0) {
    return assetDescriptionsJson
  }

  try {
    const parsed = JSON.parse(assetDescriptionsJson) as AssetDescriptionsArtifact
    return JSON.stringify(
      {
        ...parsed,
        items: (parsed.items ?? []).filter((item) => !absorbedAssetIds.has(item.asset_id)),
      } satisfies AssetDescriptionsArtifact,
      null,
      2,
    )
  } catch {
    return assetDescriptionsJson
  }
}

export function hasPendingRefinementSharedAnchorPlanWork(session: SessionState): boolean {
  const pendingItems = session.todo_state.items.filter((item) => item.status === 'pending')
  const hasPendingAnchorBind = pendingItems.some(
    (item) =>
      item.executor_hint?.executor_type === 'TOOL_CALLS' &&
      item.executor_hint.executor_tool === 'generate_anchor_assets' &&
      item.executor_hint.scope_hint === 'ANCHOR_IDS',
  )
  const hasPendingFullPropagation = pendingItems.some(
    (item) =>
      item.executor_hint?.executor_type === 'TOOL_CALLS' &&
      item.executor_hint.executor_tool === 'generate_explainer_visual_script' &&
      item.executor_hint.scope_hint === 'FULL',
  )

  return hasPendingAnchorBind && hasPendingFullPropagation
}

export function hasUsablePendingAnchorPlanUpdateRequest(session: SessionState): boolean {
  const request = session.cached_artifacts.pending_anchor_plan_update_request
  return Boolean(request && request.anchor_requests.length > 0)
}

export function maybeBuildRefinementPropagationBlockResult(
  session: SessionState,
  params: PlannerToolParams,
  structureEdit?: null | PlannerStructureEdit,
): null | ToolCallResult {
  const refinementAnchorPropagationBlocked =
    !structureEdit &&
    params.scope === 'FULL' &&
    session.todo_state.phase === 'refinement' &&
    hasPendingRefinementSharedAnchorPlanWork(session) &&
    !hasUsablePendingAnchorPlanUpdateRequest(session)

  if (!refinementAnchorPropagationBlocked) {
    return null
  }

  return {
    ok: false,
    code: 'INVALID_INPUT',
    retryable: false,
    message:
      'generate_explainer_visual_script cannot propagate refinement anchor changes without an updated anchor plan. Emit generate_anchor_assets(scope=ANCHOR_IDS, anchor_requests using UPSERT or REMOVE_ANCHOR) in the same shared batch first. Include source_asset_ids only for upload-driven source updates.',
  }
}

export function mergeVisualScriptShots(
  session: SessionState,
  params: PlannerToolParams,
  structureEdit: null | PlannerStructureEdit | undefined,
  constraints: SessionState['spec']['global_constraints'],
  shots: Shot[],
  options?: {
    transcriptWords?: import('@shared/types/agent/transcript').TranscriptWord[]
  },
):
  | { finalScope: ReturnType<typeof toScopeSpec>; finalShots: Shot[]; ok: true }
  | { ok: false; result: ToolCallResult } {
  if (!structureEdit) {
    const finalScope = toScopeSpec(params)
    const currentShotIds = session.spec.visual_script.shots.map((shot) => shot.shot_id)
    if (shots.length === 0 && isFullCoverageScope(finalScope, currentShotIds)) {
      return {
        ok: false,
        result: {
          ok: false,
          code: 'TOOL_RUNTIME_ERROR',
          retryable: true,
          message:
            'generate_explainer_visual_script returned 0 shots for a scope covering all current shots.',
        },
      }
    }
    return { ok: true, finalShots: shots, finalScope }
  }

  const mergedResult = applyStructureEditToVisualScript({
    constraints,
    currentShots: session.spec.visual_script.shots,
    generatedShots: shots,
    structureEdit,
    transcriptWords: options?.transcriptWords,
  })
  if (!mergedResult.ok || !mergedResult.shots) {
    return {
      ok: false,
      result: {
        ok: false,
        code: mergedResult.code ?? 'INVALID_INPUT',
        retryable: mergedResult.code === 'OUT_OF_SCOPE_MUTATION',
        message: mergedResult.message,
      },
    }
  }

  if (mergedResult.shotIdMapping) {
    remapDirectiveShotIds(session, mergedResult.shotIdMapping)
  }

  return {
    ok: true,
    finalShots: mergedResult.shots,
    finalScope: { scope: 'FULL' },
  }
}

export function missingDependencyResult(
  tool: PlannerToolCall['tool'],
  missing: string[],
  stageId?: string,
): ToolCallResult {
  const stagePart = stageId ? ` (stage: ${stageId})` : ''
  return {
    ok: false,
    code: 'MISSING_DEPENDENCY',
    retryable: true,
    missing,
    message: `${tool}${stagePart} requires missing dependencies: ${missing.join(', ')}`,
  }
}

/**
 * Re-pin `audio_vo` (and its timing) onto the VS tool's output from the
 * authoritative existing spec shots. The VS tool's job is visuals;
 * narration (VO) may only change via the script tool
 * (`generate_explainer_script`) or the initial generation. Without this,
 * a visual edit could silently rewrite VO -- in non-audio PARTIAL /
 * FULL-without-staged-script the LLM output was trusted verbatim, and in
 * audio mode the (now-removed) edit_mode coercion was the only thing
 * nudging VO to stay put.
 *
 * When the VS LLM drifted the VO, its `time` was computed from that
 * drifted text (WPM estimate, or ASR-token alignment in audio mode). So
 * restoring the VO without restoring the timing would leave durations
 * that reflect discarded narration. A visual-only edit changes neither
 * VO nor the timeline, so we restore the existing shot's `time` together
 * with its `audio_vo`.
 *
 * Match is by `shot_id`: PARTIAL output is forced to the target shot_ids
 * upstream (generate-visual-script.ts), and a 1:1 FULL re-gen emits
 * shot_1..N matching the existing spec order, so shot_id is a reliable
 * key. Any output shot whose id is not in the existing spec (e.g. a FULL
 * that changed the shot count) keeps its own VO -- pass-through, logged.
 *
 * `skipRepin` is set by the caller for the legitimate VO-(re)write paths:
 * structure edits (deterministic VO + shot_id renumbering), staged-script
 * FULL refresh (`pending_vs_apply`), and global re-segmentation
 * (`refresh_beat_sheet`). Bootstrap first-gen (no existing shots) has
 * nothing to pin from.
 */
export function repinPreservedAudioVo(
  session: SessionState,
  finalShots: Shot[],
  options: { skipRepin: boolean },
): Shot[] {
  if (options.skipRepin) {
    return finalShots
  }
  const existingShots = session.spec.visual_script.shots
  if (existingShots.length === 0) {
    return finalShots
  }
  const existingById = new Map(existingShots.map((shot) => [shot.shot_id, shot]))
  return finalShots.map((shot) => {
    const existing = existingById.get(shot.shot_id)
    if (
      existing === undefined ||
      collapseWhitespace(existing.audio_vo) === collapseWhitespace(shot.audio_vo)
    ) {
      return shot
    }
    logger.info(
      plannerLog(session.sessionId, '[vs-repin] restored audio_vo (VS tool must not change VO)', {
        shotId: shot.shot_id,
      }),
    )
    // Restore VO and its timeline together: the existing shot's timing is
    // correct for the existing VO we are restoring; the drift-derived time
    // is not.
    return { ...shot, audio_vo: existing.audio_vo, time: existing.time }
  })
}

/**
 * Preserve authoritative shot bindings across visual-only rewrites.
 *
 * The visual-script model returns whole shots, but omission is not an asset
 * removal contract. Explicit removals happen through PATCH_SPEC,
 * plan_asset_assignment, or REMOVE_ANCHOR. Generated bindings win (including
 * updated usage); missing bindings are restored from the current spec.
 */
export function repinPreservedPreSelectedAssets(
  session: SessionState,
  finalShots: Shot[],
  options: { anchorPlan?: null | VisualScriptAnchorPlan; skipRepin?: boolean } = {},
): Shot[] {
  const existingById = new Map(
    session.spec.visual_script.shots.map((shot) => [shot.shot_id, shot] as const),
  )
  const anchorCandidates =
    options.anchorPlan?.candidates ?? session.cached_artifacts.anchor_plan?.candidates ?? []
  const validAnchorIds = new Set(anchorCandidates.map((candidate) => candidate.anchor_id))
  const sourceIdsByAnchor = new Map(
    anchorCandidates.map((candidate) => [
      candidate.anchor_id,
      new Set(
        candidate.source_asset_ids?.length
          ? candidate.source_asset_ids
          : candidate.source_asset_id
            ? [candidate.source_asset_id]
            : [],
      ),
    ]),
  )

  const filteredShots = finalShots.map((shot) => ({
    ...shot,
    pre_selected_assets: shot.pre_selected_assets.filter(
      (asset) => asset.source !== 'anchor_asset' || validAnchorIds.has(asset.asset_id),
    ),
  }))
  if (options.skipRepin) {
    return filteredShots
  }

  return filteredShots.map((shot) => {
    const existing = existingById.get(shot.shot_id)
    if (!existing || existing.pre_selected_assets.length === 0) {
      return shot
    }

    const next = shot.pre_selected_assets.map((asset) => ({ ...asset }))
    const keys = new Set(next.map((asset) => `${asset.source}:${asset.asset_id}`))
    const boundAnchorIds = new Set(
      next.filter((asset) => asset.source === 'anchor_asset').map((asset) => asset.asset_id),
    )
    for (const asset of existing.pre_selected_assets) {
      if (asset.source === 'anchor_asset' && validAnchorIds.has(asset.asset_id)) {
        boundAnchorIds.add(asset.asset_id)
      }
    }

    for (const asset of existing.pre_selected_assets) {
      const key = `${asset.source}:${asset.asset_id}`
      if (keys.has(key)) {
        continue
      }
      if (asset.source === 'anchor_asset' && !validAnchorIds.has(asset.asset_id)) {
        continue
      }
      if (
        asset.source === 'user_upload' &&
        [...boundAnchorIds].some((anchorId) => sourceIdsByAnchor.get(anchorId)?.has(asset.asset_id))
      ) {
        continue
      }
      next.push({ ...asset })
      keys.add(key)
    }

    return { ...shot, pre_selected_assets: next }
  })
}

/** Return raw user-upload ids that would disappear from the replaced domain. */
export function findDroppedUserUploadBindings(
  session: SessionState,
  finalShots: Shot[],
  replaceAll: boolean,
  anchorPlan?: null | VisualScriptAnchorPlan,
): string[] {
  const finalShotIds = new Set(finalShots.map((shot) => shot.shot_id))
  const replacedExistingShots = replaceAll
    ? session.spec.visual_script.shots
    : session.spec.visual_script.shots.filter((shot) => finalShotIds.has(shot.shot_id))
  const requiredIds = new Set([
    ...(replaceAll
      ? extractUserUploadBrandAssetIds(session.spec.global_constraints.brand_bank ?? null)
      : []),
    ...replacedExistingShots.flatMap((shot) =>
      shot.pre_selected_assets
        .filter((asset) => asset.source === 'user_upload')
        .map((asset) => asset.asset_id),
    ),
  ])
  if (requiredIds.size === 0) {
    return []
  }

  const directIds = new Set(
    finalShots.flatMap((shot) =>
      shot.pre_selected_assets
        .filter((asset) => asset.source === 'user_upload')
        .map((asset) => asset.asset_id),
    ),
  )
  const boundAnchorIds = new Set(
    finalShots.flatMap((shot) =>
      shot.pre_selected_assets
        .filter((asset) => asset.source === 'anchor_asset')
        .map((asset) => asset.asset_id),
    ),
  )
  const consumedIds = new Set(
    (anchorPlan?.candidates ?? session.cached_artifacts.anchor_plan?.candidates ?? [])
      .filter((candidate) => boundAnchorIds.has(candidate.anchor_id))
      .flatMap((candidate) =>
        candidate.source_asset_ids?.length
          ? candidate.source_asset_ids
          : candidate.source_asset_id
            ? [candidate.source_asset_id]
            : [],
      ),
  )

  return [...requiredIds].filter((id) => !directIds.has(id) && !consumedIds.has(id)).sort()
}

export async function resolveAnchorPlanForVisualScript(params: {
  assetDescriptionsJson: string
  conversationContext: string
  params: PlannerToolParams
  script: string
  session: SessionState
  sharedBatchContext?: ReturnType<typeof getSharedArtifactBatchContext>
  structureEdit?: null | PlannerStructureEdit
  /**
   * Anchor upload pool (real uploads + brand/article synthetics), built by
   * the caller via buildAnchorUploadPool. Invariant: this MUST be
   * the same pool the anchor arm generates from, or the plan can ground on
   * a source the anchor arm never used (and vice versa: article
   * key image / publisher logo were invisible to the standalone-VS plan).
   */
  uploadedAssetPool: UploadedAsset[]
}): Promise<
  { anchorPlan: null | VisualScriptAnchorPlan; ok: true } | { ok: false; result: ToolCallResult }
> {
  const fallbackDescriptions: AssetDescriptionsArtifact = {
    generated_at: new Date().toISOString(),
    items: [],
  }

  if (params.structureEdit || params.params.scope !== 'FULL') {
    // Partial-scope VS (SHOT_IDS / SHOT_RANGE) and structure_edit do
    // not run a fresh canonicalization pass -- those write paths only
    // exist for FULL scope. But the VS prompt still needs to see the
    // current anchor catalog so the LLM can bind shots to existing
    // (and same-batch newly-bound) anchors instead of falling back to
    // user_upload.
    //
    // Race-safety: when the planner emits this partial VS in the same
    // TOOL_CALLS batch as a generate_anchor_assets ANCHOR_IDS UPSERT
    // (refinement bind+propagate to a subset / structure_edit), the
    // anchor tool writes session.cached_artifacts.anchor_plan
    // asynchronously. Reading the session field directly is therefore
    // racy -- if VS reaches this line before anchor's await chain
    // settles, it sees the stale plan and the new anchor_id is missing
    // from the LLM's allow-list. Going through ensureUpdatedAnchorPlan
    // (which is itself wrapped by withSharedArtifactResult and an
    // inflight per-session promise map) joins the same Promise as the
    // anchor tool: only one merge runs, both callers get the post-
    // merge plan. When no pending request exists (VS-only batch /
    // anchor not in batch), fall back to the persisted session field.
    const pendingRequest = params.session.cached_artifacts.pending_anchor_plan_update_request
    if (!pendingRequest) {
      return { ok: true, anchorPlan: params.session.cached_artifacts.anchor_plan ?? null }
    }
    try {
      const updated = await ensureUpdatedAnchorPlan({
        assetDescriptions: params.session._loaded_asset_descriptions ?? fallbackDescriptions,
        request: pendingRequest,
        session: params.session,
        sharedBatchContext: params.sharedBatchContext,
        uploadedAssets: params.uploadedAssetPool,
      })
      return { ok: true, anchorPlan: updated.assetPlan }
    } catch (error) {
      if (error instanceof MissingAnchorPlanError) {
        // No persisted plan yet (defensive -- shouldn't happen in
        // refinement). Fall through to "no anchor list" rather than
        // surfacing as MISSING_DEPENDENCY: partial VS without an anchor
        // catalog is still better than blocking the whole batch.
        return { ok: true, anchorPlan: null }
      }
      // UnresolvedAnchorTargetsError must surface the same way as the
      // FULL path so the planner gets actionable feedback.
      throw error
    }
  }

  try {
    const useCanonicalPlan =
      params.session.todo_state.phase === 'bootstrap_visual' ||
      params.sharedBatchContext?.forceFreshAnchorPlan === true
    const assetPlan = useCanonicalPlan
      ? (
          await ensureCanonicalAnchorPlan({
            assetDescriptions: params.session._loaded_asset_descriptions ?? fallbackDescriptions,
            conversationContext: params.conversationContext,
            params: params.params,
            script: params.script,
            session: params.session,
            sharedBatchContext: params.sharedBatchContext,
            uploadedAssets: params.uploadedAssetPool,
            worldBibleAssetDescriptionsJson: params.assetDescriptionsJson,
          })
        ).assetPlan
      : (
          await ensureUpdatedAnchorPlan({
            assetDescriptions: params.session._loaded_asset_descriptions ?? fallbackDescriptions,
            request: params.session.cached_artifacts.pending_anchor_plan_update_request ?? null,
            session: params.session,
            sharedBatchContext: params.sharedBatchContext,
            uploadedAssets: params.uploadedAssetPool,
          })
        ).assetPlan

    return { ok: true, anchorPlan: assetPlan }
  } catch (error) {
    if (error instanceof MissingAnchorPlanError) {
      return {
        ok: false,
        result: missingDependencyResult('generate_explainer_visual_script', ['anchor_plan']),
      }
    }
    if (error instanceof UnresolvedAnchorTargetsError) {
      return {
        ok: false,
        result: {
          ok: false,
          code: 'INVALID_INPUT',
          retryable: false,
          message: `generate_explainer_visual_script could not resolve target anchor_ids: ${error.anchorIds.join(', ')}. Run generate_anchor_assets with anchor_requests first; include source_asset_ids only for upload-driven source updates.`,
        },
      }
    }
    throw error
  }
}

export async function resolveFixedSegmentsForFullVs(
  params: PlannerToolParams,
  structureEdit: null | PlannerStructureEdit | undefined,
  session: SessionState,
): Promise<ScriptShotEdit[]> {
  if (structureEdit || params.scope !== 'FULL') {
    return []
  }

  const scriptArtifact = session.cached_artifacts.working_script
  if (
    !scriptArtifact ||
    scriptArtifact.scope.scope !== 'FULL' ||
    scriptArtifact.pending_vs_apply !== true
  ) {
    return []
  }

  return resolveFixedSegmentEditsFromWorkingScript(session)
}

export function validatePreservedUserUploadBindings(
  session: SessionState,
  finalShots: Shot[],
  replaceAll: boolean,
  anchorPlan?: null | VisualScriptAnchorPlan,
): null | ToolCallResult {
  const droppedIds = findDroppedUserUploadBindings(session, finalShots, replaceAll, anchorPlan)
  return droppedIds.length === 0
    ? null
    : {
        ok: false,
        code: 'INVALID_INPUT',
        retryable: true,
        message: `Visual-script update dropped mandatory user-upload bindings: ${droppedIds.join(', ')}. Preserve them directly or bind an anchor that consumes each upload.`,
      }
}

export function validateScriptWordBudget(
  session: SessionState,
  shotEdits: Array<{ audio_vo: string; shot_id: string }>,
): null | ToolCallResult {
  if (shotEdits.length === 0) {
    return null
  }

  const budget = computeWordCountBudget(
    session.spec.visual_script.shots.map((shot) => shot.audio_vo),
  )
  if (!budget) {
    return null
  }

  const violations = shotEdits
    .map((edit) => ({
      shot_id: edit.shot_id,
      word_count: countWords(edit.audio_vo),
    }))
    .filter((item) => item.word_count < budget.allowed_min || item.word_count > budget.allowed_max)

  if (violations.length === 0) {
    return null
  }

  const details = violations.map((item) => `${item.shot_id}=${item.word_count}`).join(', ')
  return {
    ok: false,
    code: 'INVALID_INPUT',
    retryable: true,
    message: `Script word-count budget violation: allowed ${budget.allowed_min}-${budget.allowed_max} words from existing shot range (${budget.min_observed}-${budget.max_observed}). Offending shot_edits: ${details}.`,
  }
}

// Every video is voiceover-driven, so a generated script
// MUST carry a real voiceover. A "no voiceover" request degenerates the script
// to empty or a sentinel like "[calm] NO VOICEOVER" (2 words), which then ships
// a silent video. Reject a
// whole-script generation whose word count is implausibly low for the target
// duration. Floor = 25% of the words a 150-wpm voiceover fills the duration with
// (the system's canonical speaking rate, kept in sync with beat-sheet /
// visual-script timing), with a small absolute minimum so the 2-word sentinel is
// caught at very short durations too. Far below any natural speaking pace, so it
// never trips a real script. user_audio sessions never reach
// the script tool (contract guard), so they are inherently exempt.
const VOICEOVER_FLOOR_WPM = 150
const VOICEOVER_FLOOR_FRACTION = 0.25
const VOICEOVER_FLOOR_ABS_MIN = 4

// Whether a script generation covers the WHOLE video (so its total word count
// can be floored against the full duration): FULL, bootstrap (no shots yet), or
// -- per the prompt's "SHOT_IDS/SHOT_RANGE covering all shots == FULL" contract
// (unified-planner-prompt.ts ~426) -- a partial scope that actually targets every
// existing shot. A genuine partial edit (a subset of shots) is NOT whole-script
// and must not be floored against the full duration.
export function validateScriptVoiceoverFloor(
  session: SessionState,
  script: string,
  params: PlannerToolParams,
): null | ToolCallResult {
  if (!isWholeScriptGeneration(session, params)) {
    return null
  }
  const durationSeconds = session.spec.meta.mode_state.duration_seconds ?? 0
  const floor = Math.max(
    VOICEOVER_FLOOR_ABS_MIN,
    Math.round(((VOICEOVER_FLOOR_WPM * durationSeconds) / 60) * VOICEOVER_FLOOR_FRACTION),
  )
  const words = countWords(script)
  if (words >= floor) {
    return null
  }
  return {
    ok: false,
    code: 'INVALID_INPUT',
    retryable: false,
    message:
      `Generated script has only ${words} word(s) -- far below the ${floor} a ${durationSeconds}s video needs. ` +
      'Every video is voiceover-driven; a no-voiceover / silent / text-only video is not supported. ' +
      'Do NOT regenerate an empty or placeholder script ("NO VOICEOVER"); use ASK_CLARIFY to explain the video requires a voiceover.',
  }
}

export function validateVisualScriptStructureEdit(
  structureEdit?: null | PlannerStructureEdit,
): null | ToolCallResult {
  if (structureEdit?.op !== 'DELETE') {
    return null
  }

  return {
    ok: false,
    code: 'INVALID_INPUT',
    retryable: false,
    message: 'DELETE structure_edit must be executed via PATCH_SPEC delete_shots.',
  }
}

function isWholeScriptGeneration(session: SessionState, params: PlannerToolParams): boolean {
  const shots = session.spec.visual_script.shots
  if (params.scope === 'FULL' || shots.length === 0) {
    return true
  }
  if (params.scope === 'SHOT_IDS') {
    const targeted = new Set((params.shot_ids ?? []).map((id) => String(id)))
    return shots.every((shot) => targeted.has(shot.shot_id))
  }
  if (params.scope === 'SHOT_RANGE') {
    const ordered = [...shots].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    return (
      params.from_shot_id === ordered[0]?.shot_id &&
      params.to_shot_id === ordered[ordered.length - 1]?.shot_id
    )
  }
  return false
}
