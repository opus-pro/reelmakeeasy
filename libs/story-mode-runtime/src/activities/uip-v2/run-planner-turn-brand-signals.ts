/**
 * Drain-loop signal-application helpers for runPlannerTurnActivity.
 *
 * These apply the brand-flow signals (brand_brief_submit, brand_bank_edit,
 * confirm_brand_review, GUI brand-draft flushes, lock_brand_bank) onto the
 * session spec via applyPatch, plus the shared upload-merge helper the
 * brand-brief path relies on. Extracted from run-planner-turn.ts so the
 * activity entrypoint stays under the max-lines cap; `_`-prefixed exports
 * are exercised directly by run-planner-turn.test.ts.
 */

import { randomUUID } from 'node:crypto'

import { createSubLogger } from '@reelmakeeasy/common/logger'
import type {
  BrandBankEditSignalPayload,
  BrandBriefSubmitSignalPayload,
  ConfirmBrandReviewSignalPayload,
  UserMessageSignalPayload,
} from '@reelmakeeasy/uip-planner-runtime'
import {
  applyPatch,
  type Patch,
  type SessionState,
  type UploadedAsset,
} from '@reelmakeeasy/uip-planner-runtime'
import {
  activateBootstrapScript,
  isActiveReviewGateToken,
} from '@reelmakeeasy/uip-planner-runtime/runtime/runtime-phase'
import { isStoreUri, storeUri } from '@reelmakeeasy/common/storage/stored-files'

const logger = createSubLogger('uip-planner-turn-activity')

// Apply the Stage 2 brand-brief submit: sets `brand_extraction_input` and folds
// uploads into `brand_bank.staged_assets.logo` in one atomic patch so they roll
// back together if the input is frozen.
function applyBrandBriefSubmit(
  session: SessionState,
  payload: BrandBriefSubmitSignalPayload,
): boolean {
  // `upload.file_path` is relative to `projects/<sessionId>/user-intent-planner/`; the FE expects full store:// URIs.
  const assetOps = (payload.uploadedAssets ?? []).map((upload) => ({
    op: 'add_brand_asset' as const,
    kind: 'logo' as const,
    ref: {
      staging_uri: isStoreUri(upload.file_path)
        ? upload.file_path
        : storeUri(`projects/${session.sessionId}/user-intent-planner/${upload.file_path}`),
      source_url: null,
      width: null,
      height: null,
      size_bytes: null,
      asset_kind: 'logo' as const,
      category: null,
      content_hash: null,
      description: upload.file_name,
      location: null,
      in_home_link: false,
      provenance: 'user_upload' as const,
    },
  }))
  const patch = {
    base_version: session.spec.meta.spec_version,
    diff_summary: 'brand_brief_submit',
    ops: [
      ...assetOps,
      {
        op: 'update_global_field' as const,
        path: 'brand_extraction_input',
        value: payload.input,
      },
    ],
  }
  const result = applyPatch(session.spec, patch, {
    transitionVideoModel: session.transitionVideoModel,
  })
  if (result.error) {
    // Re-submit landed after extraction already started or completed: the
    // input field is frozen. Treat as a no-op; the workflow keeps running
    // against the existing state.
    return false
  }
  session.spec = result.spec
  return true
}

// Append a readable user-role transcript entry. The planner's synthetic
// `__brand_brief_submit__` marker is filtered out by an upstream `startsWith('__')`
// gate, so without this the chat skips straight from Stage 1 to the next question.
function appendBrandBriefUserMessage(
  session: SessionState,
  payload: BrandBriefSubmitSignalPayload,
  turnMeta?: { attempt: number; turnId: string },
): void {
  const content =
    payload.input.kind === 'url'
      ? `Here's my brand site: ${payload.input.url}`
      : `Here's about my brand: ${payload.input.text}`
  if (payload.uploadedAssets?.length) {
    // Mirror into the session-level pool so the FE chip renderer can
    // resolve the preview URL via assetsPoolById; Lexical strips the
    // `|previewUrl` slot from the serialized meta-tag.
    mergeUploadsIntoCachedArtifacts(session, payload.uploadedAssets)
  }
  session.transcript ??= []
  session.transcript.push({
    role: 'user',
    content,
    timestamp: new Date().toISOString(),
    message_id: randomUUID(),
    ...(payload.answerToMessageId ? { answer_to_message_id: payload.answerToMessageId } : {}),
    ...(payload.uploadedAssets?.length ? { uploaded_assets: payload.uploadedAssets } : {}),
    ...(turnMeta ? { turn_id: turnMeta.turnId, attempt: turnMeta.attempt } : {}),
  })
}

// Flip brand_extraction_status -> 'locked'. Swallows the pipeline rejection from
// stale-window double-clicks since the upstream stale filter already guarantees
// the advance is safe.
export function _applyLockBrandBank(session: SessionState): void {
  const patch = {
    base_version: session.spec.meta.spec_version,
    diff_summary: 'lock_brand_bank',
    ops: [
      {
        op: 'lock_brand_bank' as const,
        locked_at: new Date().toISOString(),
      },
    ],
  }
  const result = applyPatch(session.spec, patch, {
    transitionVideoModel: session.transitionVideoModel,
  })
  if (result.error) {
    // Stale-window double-click or out-of-order race: status was not
    // 'completed' at apply time. Log so this stays visible -- the phase
    // advance still proceeds because the upstream stale filter only lets
    // us land here when phase is brand_review / bootstrap_brand.
    logger.warn(
      `[${session.sessionId}] lock_brand_bank skipped (status='${session.spec.global_constraints.brand_extraction_status}'): ${result.error}`,
    )
    return
  }
  session.spec = result.spec
  logger.info(
    `[${session.sessionId}] brand_bank locked (locked_at=${session.spec.global_constraints.brand_bank_locked_at})`,
  )
}

// Apply a Tier 1 brand-bank edit; routes through patch-apply so the
// phase + status gate has the final say. Out-of-window signals are swallowed
// so the activity drain proceeds.
export function _applyBrandBankEdit(
  session: SessionState,
  payload: BrandBankEditSignalPayload,
): boolean {
  const op = brandBankEditPayloadToPatchOp(payload, session.sessionId)
  const patch: Patch = {
    base_version: session.spec.meta.spec_version,
    diff_summary: `brand_bank_edit:${payload.kind}`,
    ops: [op],
  }
  const result = applyPatch(session.spec, patch, {
    phase: session.todo_state.phase,
    transitionVideoModel: session.transitionVideoModel,
  })
  if (result.error) {
    logger.warn(
      `[${session.sessionId}] brand_bank_edit rejected (kind=${payload.kind}, phase='${session.todo_state.phase}', status='${session.spec.global_constraints.brand_extraction_status}'): ${result.error}`,
    )
    return false
  }
  session.spec = result.spec
  return true
}

// Translate a brand-bank-edit payload to a PatchOp. `add_asset` reconstructs the
// full `store://...` URI server-side from the FE's relative file_path.
// Exported for reuse by the UIP V2 brand activity (confirm-review edit ops).
export function brandBankEditPayloadToPatchOp(
  payload: BrandBankEditSignalPayload,
  sessionId: string,
): Patch['ops'][number] {
  if (payload.kind === 'field') {
    return {
      op: 'update_brand_bank_field',
      path: payload.field.path,
      value: payload.field.value,
    }
  }
  if (payload.kind === 'style_directive') {
    return {
      op: 'update_global_field' as const,
      path: 'brand_style_directive' as const,
      value: payload.style_directive,
    }
  }
  if (payload.kind === 'add_asset') {
    const stagingUri = isStoreUri(payload.add_asset.file_path)
      ? payload.add_asset.file_path
      : storeUri(`projects/${sessionId}/user-intent-planner/${payload.add_asset.file_path}`)
    return {
      op: 'add_brand_asset',
      kind: payload.add_asset.asset_kind,
      ref: {
        staging_uri: stagingUri,
        source_url: null,
        width: null,
        height: null,
        size_bytes: null,
        asset_kind: payload.add_asset.asset_kind,
        category: null,
        content_hash: null,
        description: payload.add_asset.description,
        location: null,
        in_home_link: false,
        provenance: 'user_upload',
      },
    }
  }
  return {
    op: 'remove_brand_asset',
    kind: payload.remove_asset.asset_kind,
    staging_uri: payload.remove_asset.staging_uri,
  }
}

// Apply Confirm Brand Profile atomically: one patch of FE's pending edits +
// `lock_brand_bank`. Either everything lands or nothing does; the phase advance
// is gated on this returning `{ error: undefined }`.
export function _applyConfirmBrandReview(
  session: SessionState,
  edits: BrandBankEditSignalPayload[],
  styleDirective?: 'hybrid' | 'keep_existing_style' | null,
  brandStyleText?: string,
  brandStylePreviewUrl?: string,
): { error?: string } {
  const editOps = edits.map((edit) => brandBankEditPayloadToPatchOp(edit, session.sessionId))
  // Style directive (Apply brand colors) composes into the same atomic patch as
  // edits + lock so a Confirm either lands fully or rolls back fully.
  const directiveOps =
    styleDirective === undefined
      ? []
      : [
          {
            op: 'update_global_field' as const,
            path: 'brand_style_directive' as const,
            value: styleDirective,
          },
        ]
  // Lock in the exact style text the user previewed so
  // bootstrap_script reuses it instead of regenerating. Only carried when the
  // user picked the brand-colors variant; same atomic patch as the directive.
  const styleTextOps = brandStyleText
    ? [
        {
          op: 'update_global_field' as const,
          path: 'brand_style_text' as const,
          value: brandStyleText,
        },
      ]
    : []
  // Persist the previewed image URL so the card can re-render the
  // two-up after a reload or in the post-creation view; sent on every confirm
  // where a preview rendered, independent of the chosen tile.
  const previewUrlOps = brandStylePreviewUrl
    ? [
        {
          op: 'update_global_field' as const,
          path: 'brand_style_preview_url' as const,
          value: brandStylePreviewUrl,
        },
      ]
    : []
  const patch: Patch = {
    base_version: session.spec.meta.spec_version,
    diff_summary:
      editOps.length > 0
        ? `confirm_brand_review_with_${editOps.length}_edits`
        : 'confirm_brand_review',
    ops: [
      ...directiveOps,
      ...styleTextOps,
      ...previewUrlOps,
      ...editOps,
      { op: 'lock_brand_bank' as const, locked_at: new Date().toISOString() },
    ],
  }
  const result = applyPatch(session.spec, patch, {
    phase: session.todo_state.phase,
    transitionVideoModel: session.transitionVideoModel,
  })
  if (result.error) {
    return { error: result.error }
  }
  session.spec = result.spec
  logger.info(
    `[${session.sessionId}] confirm_brand_review applied (${editOps.length} edits + lock_brand_bank)`,
  )
  return {}
}

/**
 * Drain-loop helper for the message-signal case. Flushes any pending GUI
 * brand-brief draft edits before the planner reads brand_bank. Applied
 * regardless of whether this message is claimed-for-this-turn or queued:
 * the edits represent user intent that should land on the spec
 * immediately. applyPatch enforces phase + Tier 1 allowlist, so a race
 * past brand_review gracefully no-ops. Extracted from the switch in
 * _extractUserMessageFromSignals to keep that function under the
 * cognitive-complexity cap.
 */
export function applyBrandDraftEditsFromMessageSignal(
  session: SessionState,
  payload: UserMessageSignalPayload,
): void {
  if (!payload.brandDraftEdits || payload.brandDraftEdits.length === 0) {
    return
  }
  const result = _applyBrandDraftEdits(session, payload.brandDraftEdits)
  if (result.error) {
    logger.warn(
      `[${session.sessionId}] brand_draft_edits skipped (${payload.brandDraftEdits.length} edits): ${result.error}`,
    )
  }
}

/**
 * Apply pending brand-bank draft edits carried alongside a user-message
 * signal. Same atomic-patch shape as _applyConfirmBrandReview but without
 * lock_brand_bank -- these flushes don't advance the gate. Fails open: a
 * stale draft (e.g. phase moved past brand_review by the time the signal
 * was processed) is logged and skipped so we don't drop the user's
 * actual chat message over a sync race.
 */
export function _applyBrandDraftEdits(
  session: SessionState,
  edits: BrandBankEditSignalPayload[],
): { error?: string } {
  if (edits.length === 0) {
    return {}
  }
  const editOps = edits.map((edit) => brandBankEditPayloadToPatchOp(edit, session.sessionId))
  const patch: Patch = {
    base_version: session.spec.meta.spec_version,
    diff_summary: `brand_draft_edits_${editOps.length}`,
    ops: editOps,
  }
  const result = applyPatch(session.spec, patch, {
    phase: session.todo_state.phase,
    transitionVideoModel: session.transitionVideoModel,
  })
  if (result.error) {
    return { error: result.error }
  }
  session.spec = result.spec
  // Mark this flush so the resulting session_changed carries an event-only
  // gui_request_id; the FE folds the GUI-edited snapshot into the prior brand
  // card instead of rendering a separate Updated/Outdated version.
  session.cached_artifacts.brand_draft_gui_request_id = randomUUID()
  logger.info(`[${session.sessionId}] brand_draft_edits applied (${editOps.length} edits)`)
  return {}
}

// Drain-loop helper for `brand_brief_submit`. Applies the input patch and surfaces
// the submission as a transcript message; the synthetic marker drives the planner
// turn even when the patch is a no-op (post-extraction the input is frozen).
export function _processBrandBriefSubmitSignal(
  session: SessionState,
  payload: BrandBriefSubmitSignalPayload,
  turnMeta?: { attempt: number; turnId: string },
): void {
  const applied = applyBrandBriefSubmit(session, payload)
  if (applied) {
    session.brand_telemetry = {
      ...session.brand_telemetry,
      files_uploaded_count: payload.uploadedAssets?.length ?? 0,
    }
    appendBrandBriefUserMessage(session, payload, turnMeta)
  }
}

// Drain-loop helper for `brand_bank_edit`. Only claims the user-message slot when
// the patch actually landed so stale-window edits don't trigger wasted planner turns.
export function _processBrandBankEditSignal(
  session: SessionState,
  payload: BrandBankEditSignalPayload,
): { claim: boolean; userMessage?: string } {
  const applied = _applyBrandBankEdit(session, payload)
  if (!applied) {
    return { claim: false }
  }
  session.brand_telemetry = {
    ...session.brand_telemetry,
    brief_edit_count: (session.brand_telemetry?.brief_edit_count ?? 0) + 1,
  }
  return { claim: true, userMessage: '__brand_bank_edit__' }
}

export function processConfirmBrandReviewSignal(
  session: SessionState,
  payload: ConfirmBrandReviewSignalPayload,
  turnMeta?: { attempt: number; turnId: string },
): { claim: boolean; userMessage?: string } {
  // Gate-token validation: a stale token can arrive from an old tab,
  // a workflow re-emitting the gate, or a duplicate click after the
  // gate has already cycled. Silent-drop on mismatch -- throwing would
  // fail the activity and trigger an activity retry loop.
  if (!isActiveReviewGateToken(session, payload.gateToken)) {
    logger.warn(
      `[${session.sessionId}] confirm_brand_review dropped: gate token mismatch (gateToken=${payload.gateToken}, active=${session.review_gate?.token ?? 'null'})`,
    )
    return { claim: false }
  }
  // Confirm-carries-edits: compose ONE atomic patch from the
  // FE's pending edits (if any) followed by lock_brand_bank. Phase
  // advance is gated on patch success.
  const confirmResult = _applyConfirmBrandReview(
    session,
    payload.edits ?? [],
    payload.styleDirective,
    payload.brandStyleText,
    payload.brandStylePreviewUrl,
  )
  if (confirmResult.error) {
    logger.warn(
      `[${session.sessionId}] confirm_brand_review aborted (${(payload.edits ?? []).length} edits): ${confirmResult.error}`,
    )
    // Surface the failure to the user via the transcript so the FE
    // shows something visible after a no-op Confirm click. Claim the
    // user-message slot with an _aborted__ marker so the transcript-
    // push guard still skips the synthetic entry.
    session.transcript ??= []
    session.transcript.push({
      role: 'assistant',
      content: `Couldn't confirm: ${confirmResult.error}. Adjust your changes and try again.`,
      phase: session.todo_state.phase,
      spec_version: session.spec.meta.spec_version,
      timestamp: new Date().toISOString(),
      message_id: randomUUID(),
      ...(turnMeta ? { turn_id: turnMeta.turnId, attempt: turnMeta.attempt } : {}),
    })
    return { claim: true, userMessage: '__cta_confirm_brand_review_aborted__' }
  }
  // Patch landed (edits + lock). Advance phase to bootstrap_script.
  activateBootstrapScript(session, 'cta_confirm_brand_review')
  return { claim: true, userMessage: '__cta_confirm_brand_review__' }
}

/**
 * Dedupe-merge `incoming` uploads into `session.cached_artifacts.uploaded_assets`
 * by asset_id. Later entries overwrite earlier ones, matching prototype
 * behaviour in `session-runtime.ts` and the original inline merge this
 * helper replaced.
 */
export function mergeUploadsIntoCachedArtifacts(
  session: SessionState,
  incoming: UploadedAsset[],
): void {
  if (incoming.length === 0) {
    return
  }
  session.cached_artifacts.uploaded_assets ??= []
  const byId = new Map(
    session.cached_artifacts.uploaded_assets.map((asset) => [asset.asset_id, asset]),
  )
  // The API constructs assets without normalizing `uploaded_at` (optional
  // upstream, incl. the failed-rasterize "Using original path" fallback), and
  // this bootstrap-signal path bypasses session-runtime's merge that would
  // default it. A missing `uploaded_at` later crashes the mode_confirmation
  // image sort, so default it here -- the last gate before cached_artifacts.
  const uploadedAt = new Date().toISOString()
  for (const asset of incoming) {
    byId.set(asset.asset_id, { ...asset, uploaded_at: asset.uploaded_at || uploadedAt })
  }
  session.cached_artifacts.uploaded_assets = [...byId.values()]
}
