// Do NOT import from workflow.ts
//
// UIP V2 -- anchor + vs BATCHED TOOL ACTIVITY.
//
// In v1, generate_anchor_assets and generate_explainer_visual_script run
// concurrently inside a single activity via Promise.allSettled,
// sharing an in-memory SharedArtifactBatchContext (WeakMap) so anchor
// generation happens exactly once and the VS tool reuses its result. In v2 each
// tool is an independent child workflow (different processes); the WeakMap
// context breaks.
//
// Fix: this single activity handles both tools in one process, exactly mirroring
// v1's executeBatchToolCalls in planner-actions-batch.ts:
//   1. If refinement (anchor scope=ANCHOR_IDS), build and set
//      pending_anchor_plan_update_request before the parallel run.
//   2. Create SharedArtifactBatchContext, seed with anchor params, set on runtime.
//   3. Promise.allSettled([anchor, vs]) -- SharedArtifactBatchContext dedup works
//      naturally (same process, same WeakMap).
//   4. Clear context + pending request in .finally().
//   5. Apply shouldDiscardBatchVisualScript: if refinement anchor fails and VS
//      succeeded, discard the VS result (vs: { ok: false, cancelled: true }).
//
// Output is AnchorVsBatchOutput -- a per-tool settled result. The parent
// UipV2ToolRunnerWorkflow sends ONE terminal signal. A batch (both arms
// requested) reports tool_completed only if BOTH arms committed; otherwise it
// reports tool_failed so the planner's failure-loop backstop can see it.
// foldSession's applyToolOutput unpacks
// 'anchor_vs_batch' from EITHER signal and recursively applies each sub-tool's
// artifacts via the existing per-tool paths (anchor: stage only; vs: stage +
// auto_apply visual_script_to_ops).

import type {
  AnchorAssetPlanArtifact,
  AnchorAssetsSummary,
  AnchorPlanUpdateRequest,
  PlannerStructureEdit,
  PlannerToolParams,
  PromptRouteArtifact,
  SessionState,
  SharedArtifactBatchContext,
} from '@reelmakeeasy/uip-planner-runtime'
import {
  ANCHOR_ASSETS_TOOL_PARAMS_BATCH_KEY,
  buildAnchorPlanUpdateRequest,
  clearSharedArtifactBatchContext,
  createSharedArtifactBatchContext,
  hasActiveFullAnchorRecovery,
  runGenerateAnchorAssetsTool,
  runGenerateVisualScriptTool,
  setSharedArtifactBatchContext,
} from '@reelmakeeasy/uip-planner-runtime'
// Deep import: ToolCallResult is not in the package barrel (same pattern as
// runtime.ts). Type-only -- no runtime cost.
import type { ToolCallResult } from '@reelmakeeasy/uip-planner-runtime/runtime/runtime.types'

import { buildAnchorRemovalCleanupOps, normalizeToolParams, prepareToolRuntime } from './runtime'
import type { ToolActivityInput, ToolActivityResult } from './types'

/**
 * Input shape for the anchor+vs batch tool. Passed as `toolInput` on the
 * single UipV2ToolRunnerWorkflow child spawned for the batch.
 */
export interface AnchorVsBatchInput {
  anchor: unknown // generate_anchor_assets planner params
  anchorToolCallId: string
  structure_edit?: null | PlannerStructureEdit
  vs: unknown // generate_explainer_visual_script planner params
  vsToolCallId: string
}

/** Per-tool outcome within the batch. */
export type AnchorVsBatchToolOutcome =
  | {
      // `artifacts` is present on a soft failure too: V1 keeps whatever the tool
      // staged on the session (e.g. an anchor partial-image failure still leaves
      // the plan/summary), so foldSession re-stages it. The failure itself is
      // surfaced via getLastActionResult reading the batch output.
      artifacts?: unknown
      cancelled: false
      errorCode: string
      errorMessage: string
      ok: false
      retryable: boolean
    }
  | { artifacts: unknown; ok: true }
  | { cancelled: true; ok: false } // vs only: anchor failed in refinement batch

/**
 * Combined output returned as the single toolCompletedSignal payload.
 * foldSession.applyToolOutput unpacks this into two recursive per-tool applies.
 */
export interface AnchorVsBatchOutput {
  anchor: AnchorVsBatchToolOutcome
  anchorToolCallId: string
  vs: AnchorVsBatchToolOutcome
  vsToolCallId: string
}

type AtomicRebuildSnapshot = Pick<
  SessionState['cached_artifacts'],
  | 'absorbed_upload_ids'
  | 'anchor_assets_summary'
  | 'anchor_plan'
  | 'pending_visual_script_scope'
  | 'pending_visual_script_shots'
>

export async function anchorAndVisualScriptBatchActivity(
  input: ToolActivityInput,
): Promise<ToolActivityResult> {
  const batchInput = input.toolInput as AnchorVsBatchInput
  const { runtime, session, userMessage } = await prepareToolRuntime(input)
  return runAnchorVsBatch({ batchInput, runtime, session, userMessage })
}

async function commitAtomicRebuild(params: {
  anchorOutcome: AnchorVsBatchToolOutcome
  sharedBatchContext: SharedArtifactBatchContext
  vsOutcome: AnchorVsBatchToolOutcome
}): Promise<{
  anchorOutcome: AnchorVsBatchToolOutcome
  vsOutcome: AnchorVsBatchToolOutcome
}> {
  if (!params.anchorOutcome.ok || !params.vsOutcome.ok) {
    return params
  }
  try {
    if (!params.sharedBatchContext.deferredAnchorCommit) {
      throw new Error('Atomic anchor rebuild produced no deferred commit.')
    }
    await params.sharedBatchContext.deferredAnchorCommit()
    return params
  } catch (error) {
    return {
      anchorOutcome: {
        ok: false,
        cancelled: false,
        errorCode: 'ANCHOR_REBUILD_COMMIT_FAILED',
        errorMessage: error instanceof Error ? error.message : String(error),
        retryable: true,
      },
      vsOutcome: { ok: false, cancelled: true },
    }
  }
}

async function finalizeAtomicRebuild(params: {
  anchorOutcome: AnchorVsBatchToolOutcome
  enabled: boolean
  session: SessionState
  sharedBatchContext: SharedArtifactBatchContext
  snapshot: AtomicRebuildSnapshot
  vsOutcome: AnchorVsBatchToolOutcome
}): Promise<{
  anchorOutcome: AnchorVsBatchToolOutcome
  vsOutcome: AnchorVsBatchToolOutcome
}> {
  if (!params.enabled) {
    return { anchorOutcome: params.anchorOutcome, vsOutcome: params.vsOutcome }
  }
  const committed = await commitAtomicRebuild(params)
  if (committed.anchorOutcome.ok && committed.vsOutcome.ok) {
    return committed
  }
  return rollbackAtomicRebuild({ ...params, ...committed })
}

function restoreAtomicRebuild(session: SessionState, snapshot: AtomicRebuildSnapshot): void {
  Object.assign(session.cached_artifacts, snapshot)
}

async function rollbackAtomicRebuild(params: {
  anchorOutcome: AnchorVsBatchToolOutcome
  session: SessionState
  sharedBatchContext: SharedArtifactBatchContext
  snapshot: AtomicRebuildSnapshot
  vsOutcome: AnchorVsBatchToolOutcome
}): Promise<{
  anchorOutcome: AnchorVsBatchToolOutcome
  vsOutcome: AnchorVsBatchToolOutcome
}> {
  let { anchorOutcome, vsOutcome } = params
  try {
    await params.sharedBatchContext.rollbackAnchorRebuild?.()
  } catch (error) {
    anchorOutcome = {
      ok: false,
      cancelled: false,
      errorCode: 'ANCHOR_REBUILD_ROLLBACK_FAILED',
      errorMessage: error instanceof Error ? error.message : String(error),
      retryable: true,
      artifacts: undefined,
    }
  }
  restoreAtomicRebuild(params.session, params.snapshot)
  if (anchorOutcome.ok) {
    anchorOutcome = {
      ok: false,
      cancelled: false,
      errorCode: 'ANCHOR_REBUILD_ROLLED_BACK',
      errorMessage: 'Anchor rebuild rolled back because the paired visual rebuild failed.',
      retryable: true,
      artifacts: undefined,
    }
  } else if (!anchorOutcome.cancelled) {
    anchorOutcome = { ...anchorOutcome, artifacts: undefined }
  }
  if (vsOutcome.ok) {
    vsOutcome = { ok: false, cancelled: true }
  }
  return { anchorOutcome, vsOutcome }
}

function snapshotAtomicRebuild(session: SessionState): AtomicRebuildSnapshot {
  return {
    absorbed_upload_ids: session.cached_artifacts.absorbed_upload_ids,
    anchor_assets_summary: session.cached_artifacts.anchor_assets_summary,
    anchor_plan: session.cached_artifacts.anchor_plan,
    pending_visual_script_scope: session.cached_artifacts.pending_visual_script_scope,
    pending_visual_script_shots: session.cached_artifacts.pending_visual_script_shots,
  }
}

/**
 * The anchor + VS batch CORE, decoupled from event-sourcing. Given a
 * ready-to-use runtime facade and a SessionState, it runs both arms exactly as
 * v1's executeBatchToolCalls does (shared SharedArtifactBatchContext, refinement
 * pending-plan seed, shouldDiscardBatchVisualScript, both-arms success bar) and
 * returns the combined per-tool outcome.
 *
 * `anchorAndVisualScriptBatchActivity` calls this after `prepareToolRuntime`
 * folds the event log into the session. The UIP fast path
 * (`generateUipFastAnchorVsBatchActivity`) calls it with a SessionState built
 * from storage (no event log) -- so both paths run byte-identical anchor+VS
 * generation with zero drift. `prepareToolRuntime` is the ONLY event-sourcing
 * step and stays out of here.
 */
export async function runAnchorVsBatch(args: {
  batchInput: AnchorVsBatchInput
  runtime: object
  session: SessionState
  userMessage: string
}): Promise<ToolActivityResult> {
  const { batchInput, runtime, session, userMessage } = args

  const anchorParams = normalizeToolParams('generate_anchor_assets', batchInput.anchor)
  const vsParams = normalizeToolParams('generate_explainer_visual_script', batchInput.vs)
  const structureEdit = batchInput.structure_edit == null ? undefined : batchInput.structure_edit
  const isRefinementFullRebuild =
    session.todo_state.phase === 'refinement' &&
    anchorParams.scope === 'FULL' &&
    vsParams.scope === 'FULL' &&
    hasActiveFullAnchorRecovery(session)
  if (isRefinementFullRebuild && vsParams.refresh_world_bible === true) {
    return {
      output: {
        anchor: { ok: false, cancelled: true },
        anchorToolCallId: batchInput.anchorToolCallId,
        vs: { ok: false, cancelled: true },
        vsToolCallId: batchInput.vsToolCallId,
      },
      toolResult: {
        ok: false,
        code: 'INVALID_INPUT',
        message: 'Atomic FULL anchor recovery cannot refresh_world_bible in the same batch.',
        retryable: false,
      },
    }
  }
  const atomicRebuildSnapshot = snapshotAtomicRebuild(session)

  // Refinement path: set pending_anchor_plan_update_request BEFORE the parallel
  // run so the VS tool's resolveAnchorPlanForVisualScript finds it and joins the
  // same ensureUpdatedAnchorPlan promise via withSharedArtifactResult dedup
  // (mirrors v1 executeBatchToolCalls lines 518-520).
  const isRefinementBatch = anchorParams.scope === 'ANCHOR_IDS'
  const anchorPlanUpdate = isRefinementBatch ? buildAnchorPlanUpdateRequest(anchorParams) : null
  if (anchorPlanUpdate) {
    session.cached_artifacts.pending_anchor_plan_update_request = anchorPlanUpdate
  }
  // Snapshot which anchors ALREADY have a generated ('ready') asset
  // BEFORE the arms run (the anchor arm mutates anchor_assets_summary in place).
  // discardVs uses this to distinguish a safe regeneration of an existing anchor
  // from a brand-new anchor: a source-less UPSERT is ambiguous (it can create a NEW
  // generated anchor, not only regenerate one), so only a target that was ready
  // pre-batch is safe to keep the VS for on an anchor failure.
  const preBatchReadyAnchorIds = new Set(
    (session.cached_artifacts.anchor_assets_summary?.anchors ?? [])
      .filter((a) => a.status === 'ready')
      .map((a) => a.anchor_id),
  )

  // Mirror v1: create context, seed anchor params, set on runtime.
  // Both tools call getSharedArtifactBatchContext(runtime) internally to access
  // the same dedup map: the anchor arm and the VS arm each resolve the SAME
  // anchor plan (ensureCanonical/ensureUpdatedAnchorPlan) and world bible
  // exactly once via withSharedArtifactResult, so vs_main grounds on the plan
  // the anchor arm actually generated -- no divergence, no double LLM work. The
  // VS arm feeds vs_main the plan's raw source images, so it no longer awaits
  // the anchor arm's image generation.
  const sharedBatchContext = createSharedArtifactBatchContext()
  sharedBatchContext.forceFreshAnchorPlan = isRefinementFullRebuild
  sharedBatchContext.resolved.set(ANCHOR_ASSETS_TOOL_PARAMS_BATCH_KEY, anchorParams)
  // World-bible refresh is a VS-owned flag; seed it into the shared context
  // BEFORE the arms run so whichever arm reaches ensureWorldBible first honors
  // it (no "which arm first" race) and the other reuses the fresh canon. Anchor
  // never reads refresh_world_bible itself (a canon change never arrives via a
  // standalone anchor edit). Batch coordination.
  sharedBatchContext.forceWorldBibleRefresh = vsParams.refresh_world_bible === true
  setSharedArtifactBatchContext(runtime, sharedBatchContext)

  const [anchorSettled, vsSettled] = await Promise.allSettled([
    runGenerateAnchorAssetsTool(runtime, session, userMessage, anchorParams),
    runGenerateVisualScriptTool(runtime, session, userMessage, vsParams, structureEdit),
  ]).finally(() => {
    clearSharedArtifactBatchContext(runtime)
    session.cached_artifacts.pending_anchor_plan_update_request = undefined
  })

  // shouldDiscardBatchVisualScript: in a refinement shared-batch, if anchor
  // failed but VS succeeded, discard the VS result -- it bound shots to anchors
  // that failed to generate, producing an inconsistent state (v1 parity).
  // Anchor "failed" = threw (rejected) OR returned ok:false (soft failure).
  const anchorFailed = anchorSettled.status === 'rejected' || anchorSettled.value.ok === false
  // Narrow the discard to anchor ops that MUTATE the plan the VS was
  // built against. Only a pure image-regeneration retry of an ALREADY-generated
  // anchor is safe to keep the VS for; a new anchor (or a rebind/removal) whose
  // image then fails leaves shots pointing at an anchor with no valid asset ->
  // discard.
  const discardVs =
    isRefinementBatch &&
    anchorFailed &&
    anchorPlanUpdateMutatesPlan(anchorPlanUpdate, preBatchReadyAnchorIds)

  // Build per-tool outcomes.
  const initialAnchorOutcome: AnchorVsBatchToolOutcome = buildAnchorOutcome(
    anchorSettled,
    session,
    anchorParams,
  )
  const initialVsOutcome: AnchorVsBatchToolOutcome = discardVs
    ? { ok: false, cancelled: true }
    : buildVsOutcome(vsSettled, session)
  const finalized = await finalizeAtomicRebuild({
    anchorOutcome: initialAnchorOutcome,
    enabled: isRefinementFullRebuild,
    session,
    sharedBatchContext,
    snapshot: atomicRebuildSnapshot,
    vsOutcome: initialVsOutcome,
  })
  const anchorOutcome =
    isRefinementFullRebuild && finalized.anchorOutcome.ok
      ? buildAnchorOutcome(anchorSettled, session, anchorParams)
      : finalized.anchorOutcome
  const vsOutcome = finalized.vsOutcome

  const output: AnchorVsBatchOutput = {
    anchor: anchorOutcome,
    anchorToolCallId: batchInput.anchorToolCallId,
    vs: vsOutcome,
    vsToolCallId: batchInput.vsToolCallId,
  }

  // Wrapper-level ok determines tool_completed vs tool_failed. A batch requests
  // BOTH arms, so it succeeds only when BOTH committed (ok = anchor.ok && vs.ok).
  // An arm failure -> tool_failed, which is what makes the anchor-fail/vs-ok
  // batch (the silent stall) visible to the phase machine (no advance ->
  // re-run the failed arm) AND to the give-up backstop below.
  //
  // The tool_failed path exists so the batch does not emit a single
  // tool_completed for every outcome, which would hide repeated whole-batch
  // failures from the planner's `consecutiveIdenticalFailures` backstop (it only
  // counts tool_failed). The contract force-re-batches, so without this the
  // deterministic give-up guard is blind to a persistently-failing batch. `output` still rides on tool_failed
  // (workflow.ts), so any partial artifact staged before the failure is preserved
  // by foldSession's tool_failed apply path -- no artifact loss.
  if (anchorOutcome.ok && vsOutcome.ok) {
    return { output, toolResult: { ok: true, code: 'OK', message: '', retryable: false } }
  }
  const anchorDetail = batchFailureDetail('anchor', anchorOutcome)
  const vsDetail = batchFailureDetail('vs', vsOutcome)
  const reasons = [anchorDetail.reason, vsDetail.reason].filter((r): r is string => r !== null)
  return {
    output,
    toolResult: {
      ok: false,
      code: 'ANCHOR_VS_BATCH_FAILED',
      message: reasons.join(' | ') || 'anchor_vs_batch failed',
      retryable: anchorDetail.retryable || vsDetail.retryable,
    },
  }
}

/**
 * Extract a planner-facing failure reason + retryability from a per-tool batch
 * outcome. Succeeded / discarded (cancelled) outcomes carry no actionable error,
 * so they contribute no reason. Used only on the wholly-failed path; mirrors the
 * non-cancelled failure string batchActionResult (folds.ts) builds for the
 * tool_completed path, so the planner sees an equivalent reason either way.
 */
function batchFailureDetail(
  label: string,
  outcome: AnchorVsBatchToolOutcome,
): { reason: null | string; retryable: boolean } {
  if (outcome.ok || outcome.cancelled) {
    return { reason: null, retryable: false }
  }
  return {
    reason: `${label}:${outcome.errorCode}: ${outcome.errorMessage}`,
    retryable: outcome.retryable,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Whether a refinement anchor op mutates the plan shape the VS was
 * built against -- so a failed anchor arm must discard the (succeeded) VS to avoid
 * shots that reference an anchor with no valid generated asset. Mutations:
 *   - REMOVE_ANCHOR -- drops an anchor the VS may still reference.
 *   - UPSERT with a source change (source_asset_ids present) -- rebinds/adds a
 *     source, so the anchor's identity/content the VS grounded on changes.
 *   - UPSERT of an anchor that was NOT already generated (ready) before the batch --
 *     a source-less UPSERT can be a brand-NEW anchor (checkNewAnchorUpsertHasPaired-
 *     FollowOn permits source-less new anchors), whose failed image gen leaves the
 *     VS pointing at an asset that never existed.
 * Only a pure regeneration of an ALREADY-READY anchor (source-less UPSERT whose
 * anchor_id was ready pre-batch) is safe to keep the VS for: a failed retry leaves
 * the prior asset in place. Unknown anchor_ids err toward discard (conservative).
 * Operates on the normalized buildAnchorPlanUpdateRequest output + the pre-batch
 * ready-anchor snapshot.
 */
function anchorPlanUpdateMutatesPlan(
  request: AnchorPlanUpdateRequest | null,
  preBatchReadyAnchorIds: ReadonlySet<string>,
): boolean {
  return (request?.anchor_requests ?? []).some(
    (r) =>
      r.operation === 'REMOVE_ANCHOR' ||
      (r.source_asset_ids?.length ?? 0) > 0 ||
      !preBatchReadyAnchorIds.has(r.anchor_id),
  )
}

function buildAnchorOutcome(
  settled: PromiseSettledResult<ToolCallResult>,
  session: {
    cached_artifacts: {
      absorbed_upload_ids?: string[]
      anchor_assets_summary?: AnchorAssetsSummary
      anchor_plan?: AnchorAssetPlanArtifact
    }
    spec: {
      visual_script: {
        shots: ReadonlyArray<{
          pre_selected_assets?: ReadonlyArray<{ asset_id: string; source: string }>
          shot_id: string
        }>
      }
    }
  },
  params: PlannerToolParams,
): AnchorVsBatchToolOutcome {
  if (settled.status === 'rejected') {
    // Hard failure (threw): nothing reliably staged, so no artifacts to keep.
    const err = settled.reason
    return {
      ok: false,
      cancelled: false,
      errorCode: extractErrorCode(err),
      errorMessage: err instanceof Error ? err.message : String(err),
      retryable: true,
    }
  }
  const result = settled.value
  // Read back whatever the tool staged on the session. V1 keeps the partial
  // plan/summary even on a soft (ok:false) failure -- e.g. a partial
  // image-generation failure in bootstrap_visual -- and the VS shots that
  // reference the plan are still applied, so foldSession must re-stage the
  // anchor artifacts in both cases. cleanup_ops (deterministic REMOVE_ANCHOR
  // shot cleanup) is only emitted on success, matching V1 which runs that
  // cleanup only after a successful anchor tool.
  const cleanupOps = result.ok
    ? buildAnchorRemovalCleanupOps(params, session.spec.visual_script.shots)
    : []
  const artifacts = {
    absorbed_upload_ids: session.cached_artifacts.absorbed_upload_ids,
    anchor_assets_summary: session.cached_artifacts.anchor_assets_summary,
    anchor_plan: session.cached_artifacts.anchor_plan,
    cleanup_ops: cleanupOps.length > 0 ? cleanupOps : undefined,
  }
  if (!result.ok) {
    return {
      ok: false,
      cancelled: false,
      errorCode: result.code,
      errorMessage: result.message,
      retryable: result.retryable,
      artifacts,
    }
  }
  return { ok: true, artifacts }
}

function buildVsOutcome(
  settled: PromiseSettledResult<ToolCallResult>,
  session: {
    cached_artifacts: {
      pending_visual_script_scope?: unknown
      pending_visual_script_shots?: unknown[]
      prompt_route?: null | PromptRouteArtifact
    }
  },
): AnchorVsBatchToolOutcome {
  if (settled.status === 'rejected') {
    const err = settled.reason
    return {
      ok: false,
      cancelled: false,
      errorCode: extractErrorCode(err),
      errorMessage: err instanceof Error ? err.message : String(err),
      retryable: true,
    }
  }
  const result = settled.value
  if (!result.ok) {
    return {
      ok: false,
      cancelled: false,
      errorCode: result.code,
      errorMessage: result.message,
      retryable: result.retryable,
    }
  }
  const promptRoute = session.cached_artifacts.prompt_route
  const artifacts = {
    scope: session.cached_artifacts.pending_visual_script_scope,
    shots: session.cached_artifacts.pending_visual_script_shots ?? [],
  }
  if (promptRoute === undefined) {
    return { ok: true, artifacts }
  }
  return { ok: true, artifacts: { ...artifacts, prompt_route: promptRoute } }
}

function extractErrorCode(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as { code?: unknown; errorCode?: unknown }
    for (const v of [e.errorCode, e.code]) {
      if (typeof v === 'string' && v.length > 0) {
        return v
      }
    }
  }
  return 'TOOL_ERROR'
}
