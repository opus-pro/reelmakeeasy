// Do NOT import VALUES from @reelmakeeasy/uip-planner-runtime here -- this file is part
// of the v2 workflow code (types-only imports from the planner runtime).
//
// Brand-extraction child orchestration for the v2 session workflow: applying
// brand patch ops, the initial extraction child start, and the re-extraction
// re-fire. Extracted from workflow.ts to keep that file under the
// max-lines cap.

import type { UipSessionWorkflowParams } from '@reelmakeeasy/uip-planner-runtime'
import {
  ParentClosePolicy,
  startChild,
  uuid4,
  workflowInfo,
} from '@reelmakeeasy/workflow-engine/workflow'

import type { BrandPatchAction } from '../../activities/uip-v2/brand'
import type { BrandExtractionInput } from '../brand-extraction/types'
import { BrandExtractionWorkflow } from '../brand-extraction/workflow'

import { applyBrandPatchActivity } from './activity-proxies'
import { appendEvent } from './event-log'
import {
  brandReextractionPending,
  brandStatus,
  foldPhase,
  hasBrandInput,
  hasUploadedAssets,
  seededEditableBrandReview,
} from './folds'
import { changePhase } from './phase-machine'
import { nowIso } from './planner-turn-helpers'
import type { AgentEvent, WorkflowState } from './types'

export async function applyBrandOps(state: WorkflowState, action: BrandPatchAction): Promise<void> {
  const res = await applyBrandPatchActivity({
    action,
    currentArtifacts: state.currentArtifacts,
    events: state.events,
  })
  if (res.ok && res.ops.length) {
    appendEvent(state, {
      type: 'spec_patched',
      ops: res.ops,
      source: 'system',
      specVersionAfter: res.specVersionAfter,
      timestamp: nowIso(),
    })
  }
}

/**
 * Arm + start the BrandExtractionWorkflow child once the planner has set
 * brand_extraction_input. Idempotent: only fires when the gate is on, no child
 * is in flight, status is still null, input is set, and we are in
 * mode_confirmation. Applies start_brand_extraction (null->pending) first.
 */
export async function maybeStartBrandChild(
  state: WorkflowState,
  params: UipSessionWorkflowParams,
  _taskQueue: string,
): Promise<void> {
  if (
    !state.brandExtractionEnabled ||
    state.brandExtractionPending ||
    brandStatus(state.events) !== null ||
    !hasBrandInput(state.events) ||
    foldPhase(state.events) !== 'mode_confirmation'
  ) {
    return
  }
  const input = latestBrandInput(state.events)
  if (!input) {
    return
  }
  const runId = uuid4()
  await applyBrandOps(state, { kind: 'started', runId, startedAt: nowIso() })
  if (brandStatus(state.events) !== 'pending') {
    return // start_brand_extraction was rejected -- bail.
  }
  state.brandExtractionPending = true
  await startChild(BrandExtractionWorkflow, {
    args: [
      {
        input,
        parentWorkflowId: workflowInfo().workflowId,
        projectId: params.projectId,
        runId,
        userEmail: params.userEmail,
        userId: params.userId,
      },
    ],
    parentClosePolicy: ParentClosePolicy.ABANDON,
    workflowId: `ao:${params.projectId}:brand-extract:${runId}`,
    workflowRunTimeout: '20 minutes',
    ...(params.brandExtractionTaskQueue ? { taskQueue: params.brandExtractionTaskQueue } : {}),
  })
}

/**
 * Re-fire the BrandExtractionWorkflow child for a re-extraction (port of
 * v1's maybeStartBrandReExtractionChild). change_brand_extraction_source /
 * retry_brand_extraction raise brand_reextraction_pending with status already
 * 'pending' and a fresh brand_extraction_input -- so, unlike the initial
 * maybeStartBrandChild, this fires regardless of phase (re-extraction happens in
 * brand_review). v1 owned this and it was never ported when v2 launched, so a
 * user-requested re-extraction reset the bank to pending but never re-extracted.
 * Stamps the new run via
 * mark_brand_reextraction_started (lowers the flag) BEFORE startChild.
 */
export async function maybeReExtractBrandChild(
  state: WorkflowState,
  params: UipSessionWorkflowParams,
): Promise<void> {
  if (
    !state.brandExtractionEnabled ||
    state.brandExtractionPending ||
    !brandReextractionPending(state.events)
  ) {
    return
  }
  const input = latestBrandInput(state.events)
  if (!input) {
    return
  }
  const runId = uuid4()
  await applyBrandOps(state, { kind: 'reextraction_started', runId, startedAt: nowIso() })
  // Guard: if the mark op was rejected, the flag is still set -- bail rather than
  // fire a child whose run the spec does not reflect (mirrors v1).
  if (brandReextractionPending(state.events)) {
    return
  }
  // v1 reenterBootstrapBrand parity: drop back to bootstrap_brand so the
  // FE re-renders the "Learning about your brand..." extracting state and collapses
  // the stale brief to "Outdated", instead of leaving the empty (bank-cleared)
  // brand_review card on screen. The new phase_changed retires the prior
  // review_gate_opened (v2 gates are scoped "since the last phase_changed"), and
  // advanceBootstrapBrand re-runs bootstrap_brand -> brand_review once the fresh
  // brand_extraction_ready lands. Only the source-change path is in brand_review;
  // an auto-retry on a transient failure is already in bootstrap_brand, so guard
  // on the live phase rather than emit a spurious bootstrap_brand -> bootstrap_brand.
  if (foldPhase(state.events) === 'brand_review') {
    changePhase(state, 'brand_review', 'bootstrap_brand', 'brand_reextraction')
  }
  state.brandExtractionPending = true
  await startChild(BrandExtractionWorkflow, {
    args: [
      {
        input,
        parentWorkflowId: workflowInfo().workflowId,
        projectId: params.projectId,
        runId,
        userEmail: params.userEmail,
        userId: params.userId,
      },
    ],
    parentClosePolicy: ParentClosePolicy.ABANDON,
    workflowId: `ao:${params.projectId}:brand-extract:${runId}`,
    workflowRunTimeout: '20 minutes',
    ...(params.brandExtractionTaskQueue ? { taskQueue: params.brandExtractionTaskQueue } : {}),
  })
}

/**
 * Fold the user's init-prompt uploads into a reused saved brief's bank.
 * Fired once at brand_review entry. Self-gates to the saved-brief editable-review
 * path (seededEditableBrandReview) so the fresh path -- which already folds uploads
 * on the 'ready' signal -- is untouched. No-ops when there are no uploads; the
 * add_brand_asset dedup makes a re-run harmless if brand_review is re-entered.
 */
export async function maybeFoldSavedBriefUploads(state: WorkflowState): Promise<void> {
  if (!seededEditableBrandReview(state.events) || !hasUploadedAssets(state.events)) {
    return
  }
  await applyBrandOps(state, { kind: 'fold_uploads' })
}

/** The most recent brand_extraction_input value set via a spec_patched op. */
function latestBrandInput(events: AgentEvent[]): BrandExtractionInput | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.type !== 'spec_patched') {
      continue
    }
    for (let j = e.ops.length - 1; j >= 0; j--) {
      const op = e.ops[j]
      if (op.op === 'set_brand_extraction_input') {
        // SetBrandExtractionInputOp stores the payload under `input` (not `value`).
        return (op as { input?: unknown }).input as BrandExtractionInput
      }
      // A re-extraction changes the source via change_brand_extraction_source,
      // which carries the new URL under `url` (patch-apply normalizes it into
      // brand_extraction_input). It is the most recent input, so re-extraction
      // crawls the new site, not the stale one.
      if (op.op === 'change_brand_extraction_source') {
        return { kind: 'url', url: (op as { url?: string }).url ?? '' } as BrandExtractionInput
      }
      if (op.op === 'update_global_field' && op.path?.includes('brand_extraction_input')) {
        return (op as { value?: unknown }).value as BrandExtractionInput
      }
    }
  }
  return null
}
