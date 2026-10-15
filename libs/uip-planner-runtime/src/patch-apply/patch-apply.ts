import { canonicalizeFreeText, normalizeShotId } from '../normalization'
import { findSameImageRef, flattenStagedAssets } from '../tool-internals/staged-asset-dedup'
import {
  AddBrandAssetOp,
  BrandBank,
  BrandBankCtasSchema,
  ChangeBrandExtractionSourceOp,
  FailBrandExtractionOp,
  LockBrandBankOp,
  MarkBrandReextractionStartedOp,
  Patch,
  PatchOp,
  PlannerPhase,
  SeedBrandSynthesisOp,
  SetBrandExtractionInputOp,
  Shot,
  Spec,
  StartBrandExtractionOp,
  UpdateBrandBankFieldOp,
} from '../types'

import {
  applyDiscardBrandInReview,
  applyReextractSavedBrandBrief,
  applyRemoveSavedBrandBrief,
} from './patch-apply-brand-brief-ops'
import { applyBrandCarry, discardPendingBrandCarry } from './patch-apply-brand-carry'
import { applyUpdateGlobalField } from './patch-apply-global-field'

// Re-extraction caps. Auto-retry covers a single transient failure;
// the user may redirect extraction to a different URL once. The ops own these
// caps; the workflow just probes whether the retry op applied.
const MAX_BRAND_AUTO_RETRIES = 1
const MAX_BRAND_SOURCE_CHANGES = 1

export interface PatchResult {
  error?: string
  spec: Spec
}

type RemoveBrandAssetOp = Extract<PatchOp, { op: 'remove_brand_asset' }>

/**
 * Optional contextual signals an op handler may inspect. Currently carries
 * caller context so phase-gated writes (e.g. `brand_video_type`) can check
 * runtime state that does not live on the spec. Optional + per-op opt-in:
 * existing call sites that pass nothing still work.
 */
export interface PatchContext {
  phase?: PlannerPhase
  transitionVideoModel?: null | string | undefined
}

/**
 * Applies a patch container to the spec.
 * Returns new spec (immutable), or error if base_version mismatches.
 */
export function applyPatch(spec: Spec, patch: Patch, context?: PatchContext): PatchResult {
  if (patch.base_version !== spec.meta.spec_version) {
    return {
      spec,
      error: `Version mismatch: patch base_version=${patch.base_version}, current spec_version=${spec.meta.spec_version}`,
    }
  }

  let updatedSpec: Spec = deepClone(spec)
  const allowedUserUploadAssetIds = new Set(patch.allowed_user_upload_asset_ids ?? [])

  for (const op of patch.ops) {
    const result = applyOp(updatedSpec, op, allowedUserUploadAssetIds, context)
    if (result.error) {
      return { spec, error: result.error }
    }
    updatedSpec = result.spec
  }

  updatedSpec.meta.spec_version += 1

  return {
    spec: updatedSpec,
  }
}

function applyOp(
  spec: Spec,
  op: PatchOp,
  allowedUserUploadAssetIds: Set<string>,
  context?: PatchContext,
): PatchResult {
  const updatedSpec = deepClone(spec)

  switch (op.op) {
    case 'add_brand_asset': {
      return applyAddBrandAsset(updatedSpec, op)
    }

    case 'add_preselected_asset': {
      return applyAddPreselectedAsset(updatedSpec, op.shot_id, op.asset, allowedUserUploadAssetIds)
    }

    case 'apply_brand_carry': {
      return applyBrandCarry(updatedSpec, op.via ?? 'op')
    }

    case 'change_brand_extraction_source': {
      return applyChangeBrandExtractionSource(updatedSpec, op)
    }

    case 'delete_shots': {
      return applyDeleteShots(updatedSpec, op.shot_ids)
    }

    // Brand-review whole-brand removal: discard an extracted bank and
    // continue brand-less. The runtime advances brand_review -> bootstrap_script.
    case 'discard_brand_in_review': {
      return applyDiscardBrandInReview(updatedSpec, op, context)
    }

    case 'fail_brand_extraction': {
      return applyFailBrandExtraction(updatedSpec, op)
    }

    case 'lock_brand_bank': {
      return applyLockBrandBank(updatedSpec, op)
    }

    case 'mark_brand_reextraction_started': {
      return applyMarkBrandReextractionStarted(updatedSpec, op)
    }

    // Saved-brief chat ops: detach or re-extract an injected brief.
    case 'reextract_saved_brand_brief': {
      return applyReextractSavedBrandBrief(updatedSpec, op, context)
    }

    case 'remove_brand_asset': {
      return applyRemoveBrandAsset(updatedSpec, op, context)
    }

    case 'remove_preselected_asset': {
      return applyRemovePreselectedAsset(updatedSpec, op.shot_id, op.asset_id, op.asset_source)
    }

    case 'remove_saved_brand_brief': {
      return applyRemoveSavedBrandBrief(updatedSpec, op, context)
    }

    case 'reorder_shots': {
      // Audio-mode invariant: shot order mirrors the ASR audio timeline.
      // Reordering shots would desync audio_vo from the underlying audio.
      if (updatedSpec.meta.audio_source === 'user_audio') {
        return {
          spec: updatedSpec,
          error:
            'AUDIO_LOCKED: reorder_shots is not allowed in user_audio mode (audio timeline is fixed).',
        }
      }
      return applyReorderShots(updatedSpec, op.order)
    }

    case 'replace_all_shots': {
      return applyReplaceAllShots(updatedSpec, op.shots)
    }

    case 'replace_shots_range': {
      return applyReplaceShotsRange(updatedSpec, op.from_shot_id, op.to_shot_id, op.shots)
    }

    case 'retime_shot': {
      return applyRetimeShot(updatedSpec, op.shot_id, op.start_s, op.end_s)
    }

    case 'retry_brand_extraction': {
      return applyRetryBrandExtraction(updatedSpec)
    }

    case 'seed_brand_synthesis': {
      return applySeedBrandSynthesis(updatedSpec, op)
    }

    case 'seed_manual_brand_entry': {
      return applySeedManualBrandEntry(updatedSpec)
    }

    case 'set_brand_extraction_input': {
      return applySetBrandExtractionInput(updatedSpec, op)
    }

    case 'start_brand_extraction': {
      return applyStartBrandExtraction(updatedSpec, op)
    }

    case 'update_brand_bank_field': {
      return applyUpdateBrandBankField(updatedSpec, op, context)
    }

    case 'update_global_field': {
      return applyUpdateGlobalField(updatedSpec, op.path, op.value, context)
    }

    case 'update_shot_field': {
      return applyUpdateShotField(updatedSpec, op.shot_id, op.field, op.value)
    }

    default: {
      const exhaustiveCheck: never = op
      return { spec, error: `Unknown op: ${(exhaustiveCheck as PatchOp).op}` }
    }
  }
}

// Fine-grained Ops

const ALLOWED_SHOT_FIELDS = new Set(['audio_vo'])

function applyAddPreselectedAsset(
  spec: Spec,
  shot_id: string,
  asset: Shot['pre_selected_assets'][0],
  allowedUserUploadAssetIds: Set<string>,
): PatchResult {
  const normalizedShotId = normalizeShotId(shot_id) ?? canonicalizeFreeText(shot_id)
  if (asset.source === 'user_upload' && !allowedUserUploadAssetIds.has(asset.asset_id)) {
    return {
      spec,
      error: `Asset '${asset.asset_id}' is not in uploaded_assets allowlist for source=user_upload`,
    }
  }

  const shot = spec.visual_script.shots.find(
    (s) => (normalizeShotId(s.shot_id) ?? s.shot_id) === normalizedShotId,
  )
  if (!shot) {
    return { spec, error: `Shot '${normalizedShotId}' not found` }
  }

  shot.pre_selected_assets.push(asset)
  return { spec }
}

function applyDeleteShots(spec: Spec, shotIds: string[]): PatchResult {
  const normalizedShotIds = shotIds
    .map((shotId) => normalizeShotId(shotId) ?? canonicalizeFreeText(shotId))
    .filter((shotId) => shotId.length > 0)

  if (!normalizedShotIds.length) {
    return { spec, error: 'delete_shots requires non-empty shot_ids' }
  }
  const deleteSet = new Set(normalizedShotIds)
  if (deleteSet.size !== normalizedShotIds.length) {
    return { spec, error: 'delete_shots contains duplicate shot_id values' }
  }

  const shots = spec.visual_script.shots
  for (const shotId of deleteSet) {
    if (!shots.some((shot) => (normalizeShotId(shot.shot_id) ?? shot.shot_id) === shotId)) {
      return { spec, error: `Shot '${shotId}' not found` }
    }
  }

  const remaining = shots.filter(
    (shot) => !deleteSet.has(normalizeShotId(shot.shot_id) ?? shot.shot_id),
  )
  spec.visual_script.shots = rebuildShotsWithCanonicalIdsAndContinuousTimeline(remaining)
  return { spec }
}

function applyRemovePreselectedAsset(
  spec: Spec,
  shot_id: string,
  asset_id: string,
  asset_source: Shot['pre_selected_assets'][number]['source'],
): PatchResult {
  const normalizedShotId = normalizeShotId(shot_id) ?? canonicalizeFreeText(shot_id)
  const shot = spec.visual_script.shots.find(
    (s) => (normalizeShotId(s.shot_id) ?? s.shot_id) === normalizedShotId,
  )
  if (!shot) {
    return { spec, error: `Shot '${normalizedShotId}' not found` }
  }

  const assetIndex = shot.pre_selected_assets.findIndex(
    (a) => a.asset_id === asset_id && a.source === asset_source,
  )
  if (assetIndex === -1) {
    return {
      spec,
      error: `Asset '${asset_id}' with source '${asset_source}' not found in shot '${shot_id}'`,
    }
  }

  shot.pre_selected_assets.splice(assetIndex, 1)
  return { spec }
}

function applyReorderShots(spec: Spec, order: string[]): PatchResult {
  const normalizedOrder = order
    .map((shotId) => normalizeShotId(shotId) ?? canonicalizeFreeText(shotId))
    .filter((shotId) => shotId.length > 0)
  const shotMap = new Map(
    spec.visual_script.shots.map((s) => [(normalizeShotId(s.shot_id) ?? s.shot_id) as string, s]),
  )
  const uniqueShotIds = new Set(normalizedOrder)

  if (uniqueShotIds.size !== normalizedOrder.length) {
    return { spec, error: 'Reorder list contains duplicate shot_id values' }
  }

  for (const shot_id of normalizedOrder) {
    if (!shotMap.has(shot_id)) {
      return { spec, error: `Shot '${shot_id}' in reorder list not found in spec` }
    }
  }

  if (normalizedOrder.length !== spec.visual_script.shots.length) {
    return {
      spec,
      error: `Reorder list length (${normalizedOrder.length}) does not match current shot count (${spec.visual_script.shots.length})`,
    }
  }

  const reorderedShots = normalizedOrder.map((shot_id) => {
    const shot = shotMap.get(shot_id)
    if (!shot) {
      throw new Error(`Shot '${shot_id}' not found in shotMap`)
    }
    return { ...shot, shot_id }
  })

  // Re-sequence the timeline so start_s/end_s are continuous in the NEW order
  // (durations preserved) and `order` matches position. Without this each shot
  // keeps its old time slot, so the storyboard shows non-monotonic timecodes --
  // e.g. the shot moved to the front still reads 00:11-00:15 instead of
  // 00:00-00:04. shot_id is left as reordered (NOT re-canonicalized) so a later
  // edit-by-id op on an in-flight session keeps targeting the same shot.
  spec.visual_script.shots = resequenceContinuousTimeline(reorderedShots)
  return { spec }
}

function applyRetimeShot(spec: Spec, shot_id: string, start_s: number, end_s: number): PatchResult {
  const normalizedShotId = normalizeShotId(shot_id) ?? canonicalizeFreeText(shot_id)
  const shot = spec.visual_script.shots.find(
    (s) => (normalizeShotId(s.shot_id) ?? s.shot_id) === normalizedShotId,
  )
  if (!shot) {
    return { spec, error: `Shot '${normalizedShotId}' not found` }
  }

  if (end_s <= start_s) {
    return {
      spec,
      error: `Invalid timing: end_s (${end_s}) must be greater than start_s (${start_s})`,
    }
  }

  shot.time = { start_s, end_s }
  return { spec }
}

function applyUpdateShotField(
  spec: Spec,
  shot_id: string,
  field: string,
  value: unknown,
): PatchResult {
  if (!ALLOWED_SHOT_FIELDS.has(field)) {
    return { spec, error: `Field '${field}' is not in the allowlist for update_shot_field` }
  }

  // Audio-mode script lock (L2-a): when the session was created with
  // user-uploaded audio, audio_vo is derived from ASR and is immutable. See
  // unified-planner-prompt.ts audio-mode section. The planner is instructed
  // not to plan this op in audio mode; this is a defensive runtime net.
  if (field === 'audio_vo' && spec.meta.audio_source === 'user_audio') {
    return {
      spec,
      error:
        'AUDIO_LOCKED: cannot modify audio_vo in user_audio mode ' +
        '(script is derived from uploaded audio)',
    }
  }

  const normalizedShotId = normalizeShotId(shot_id) ?? canonicalizeFreeText(shot_id)
  const shot = spec.visual_script.shots.find(
    (s) => (normalizeShotId(s.shot_id) ?? s.shot_id) === normalizedShotId,
  )
  if (!shot) {
    return { spec, error: `Shot '${normalizedShotId}' not found` }
  }

  if (field.includes('.')) {
    const [parent, child] = field.split('.')
    const shotRecord = shot as Record<string, unknown>
    if (!shotRecord[parent] || typeof shotRecord[parent] !== 'object') {
      shotRecord[parent] = {}
    }
    ;(shotRecord[parent] as Record<string, unknown>)[child] = value
  } else {
    ;(shot as Record<string, unknown>)[field] = value
  }

  return { spec }
}

// Coarse-grained Ops

function applyReplaceAllShots(spec: Spec, newShots: Shot[]): PatchResult {
  if (newShots.length === 0 && spec.visual_script.shots.length > 0) {
    return {
      spec,
      error:
        'replace_all_shots with no shots would empty the storyboard; use delete_shots to remove shots',
    }
  }
  spec.visual_script.shots = newShots.map((s, i) => ({
    ...s,
    shot_id: normalizeShotId(s.shot_id) ?? `shot_${i + 1}`,
    order: i + 1,
  }))
  return { spec }
}

function applyReplaceShotsRange(
  spec: Spec,
  from_shot_id: string,
  to_shot_id: string,
  newShots: Shot[],
): PatchResult {
  const shots = spec.visual_script.shots
  const normalizedFromShotId = normalizeShotId(from_shot_id) ?? canonicalizeFreeText(from_shot_id)
  const normalizedToShotId = normalizeShotId(to_shot_id) ?? canonicalizeFreeText(to_shot_id)
  const fromIdx = shots.findIndex(
    (s) => (normalizeShotId(s.shot_id) ?? s.shot_id) === normalizedFromShotId,
  )
  const toIdx = shots.findIndex(
    (s) => (normalizeShotId(s.shot_id) ?? s.shot_id) === normalizedToShotId,
  )

  if (fromIdx === -1) {
    return { spec, error: `Shot '${normalizedFromShotId}' not found` }
  }
  if (toIdx === -1) {
    return { spec, error: `Shot '${normalizedToShotId}' not found` }
  }
  if (fromIdx > toIdx) {
    return { spec, error: 'from_shot_id must appear before to_shot_id in shot order' }
  }

  // Re-assign order values
  const before = shots.slice(0, fromIdx)
  const after = shots.slice(toIdx + 1)
  const reindexed = newShots.map((s, i) => ({
    ...s,
    shot_id: normalizeShotId(s.shot_id) ?? `shot_${fromIdx + i + 1}`,
    order: fromIdx + i + 1,
  }))
  const remaining = after.map((s, i) => ({ ...s, order: fromIdx + newShots.length + i + 1 }))

  spec.visual_script.shots = [...before, ...reindexed, ...remaining]
  return { spec }
}

// Brand Ops

function applyAddBrandAsset(spec: Spec, op: AddBrandAssetOp): PatchResult {
  const lockErr = assertNotLocked(spec)
  if (lockErr) {
    return { spec, error: lockErr }
  }
  const bank = spec.global_constraints.brand_bank ?? createEmptyBrandBank()
  // Belt-and-suspenders dedup: skip the push when this image already exists in
  // ANY bucket (matched byte-exact by content_hash or staging_uri; semantic
  // re-encode dupes are caught upstream by the LLM dedup pass). Keeps the
  // first-inserted entry so no path -- crawl candidates, init-prompt uploads,
  // brand-brief uploads -- can double-insert the same asset. A skip is a
  // deterministic no-op, not an error.
  if (findSameImageRef(flattenStagedAssets(bank), op.ref)) {
    spec.global_constraints.brand_bank = bank
    return { spec }
  }
  bank.staged_assets[op.kind].push(op.ref)
  spec.global_constraints.brand_bank = bank
  return { spec }
}

function applyFailBrandExtraction(spec: Spec, op: FailBrandExtractionOp): PatchResult {
  if (spec.global_constraints.brand_extraction_status !== 'pending') {
    return {
      spec,
      error: `INVALID_BRAND_TRANSITION: fail_brand_extraction requires status='pending', got '${spec.global_constraints.brand_extraction_status}'`,
    }
  }
  spec.global_constraints.brand_extraction_status = 'failed'
  spec.global_constraints.brand_extraction_failure_reason = op.reason
  return { spec }
}

function applyLockBrandBank(spec: Spec, op: LockBrandBankOp): PatchResult {
  if (spec.global_constraints.brand_extraction_status !== 'completed') {
    return {
      spec,
      error: `INVALID_BRAND_TRANSITION: lock_brand_bank requires status='completed', got '${spec.global_constraints.brand_extraction_status}'`,
    }
  }
  spec.global_constraints.brand_extraction_status = 'locked'
  spec.global_constraints.brand_bank_locked_at = op.locked_at
  return { spec }
}

function applyRemoveBrandAsset(
  spec: Spec,
  op: RemoveBrandAssetOp,
  context?: PatchContext,
): PatchResult {
  const lockErr = assertNotLocked(spec)
  if (lockErr) {
    return { spec, error: lockErr }
  }

  const status = spec.global_constraints.brand_extraction_status
  if (status !== 'completed') {
    return {
      spec,
      error: `remove_brand_asset requires brand_extraction_status === 'completed' (current: ${status ?? 'null'})`,
    }
  }
  const phase = context?.phase
  if (phase !== 'brand_review') {
    return {
      spec,
      error: `remove_brand_asset requires todo_state.phase === 'brand_review' (current: ${phase ?? 'null'})`,
    }
  }

  const bank = spec.global_constraints.brand_bank
  if (!bank) {
    return { spec, error: 'BRAND_BANK_MISSING: brand_bank is null' }
  }

  const bucket = bank.staged_assets[op.kind]
  if (!bucket.some((r) => r.staging_uri === op.staging_uri)) {
    return {
      spec,
      error: `BRAND_ASSET_NOT_FOUND: no ${op.kind} asset with staging_uri='${op.staging_uri}'`,
    }
  }
  bank.staged_assets[op.kind] = bucket.filter((r) => r.staging_uri !== op.staging_uri)
  return { spec }
}

function applySeedBrandSynthesis(spec: Spec, op: SeedBrandSynthesisOp): PatchResult {
  if (spec.global_constraints.brand_extraction_status !== 'pending') {
    return {
      spec,
      error: `INVALID_BRAND_TRANSITION: seed_brand_synthesis requires status='pending', got '${spec.global_constraints.brand_extraction_status}'`,
    }
  }

  // Preserve any pre-existing staged_assets (freeform-intake bundled
  // uploads land in the bank at start; synthesis must NOT trample them).
  const existingAssets = spec.global_constraints.brand_bank?.staged_assets ?? {
    logo: [],
    product: [],
    character: [],
  }
  const merged: BrandBank = {
    ...op.bank_without_assets,
    staged_assets: existingAssets,
  }
  spec.global_constraints.brand_bank = merged
  spec.global_constraints.brand_extraction_status = 'completed'
  return { spec }
}

function applySeedManualBrandEntry(spec: Spec): PatchResult {
  if (spec.global_constraints.brand_extraction_status !== 'failed') {
    return {
      spec,
      error: `INVALID_BRAND_TRANSITION: seed_manual_brand_entry requires status='failed', got '${spec.global_constraints.brand_extraction_status}'`,
    }
  }
  // Preserve any staged_assets already on the bank (e.g. init-prompt uploads
  // that landed before extraction failed) just like seed_brand_synthesis does.
  const existingAssets = spec.global_constraints.brand_bank?.staged_assets ?? {
    logo: [],
    product: [],
    character: [],
  }
  spec.global_constraints.brand_bank = { ...createEmptyBrandBank(), staged_assets: existingAssets }
  spec.global_constraints.brand_extraction_status = 'completed'
  // Clear the stale failure reason so 'completed' keeps a single meaning
  // (bank ready) and no inconsistent status/reason pair leaks downstream.
  spec.global_constraints.brand_extraction_failure_reason = null
  return { spec }
}

function applySetBrandExtractionInput(spec: Spec, op: SetBrandExtractionInputOp): PatchResult {
  // Same freeze as the update_global_field path: once extraction has started
  // (status non-null) the input is pinned.
  if (spec.global_constraints.brand_extraction_status !== null) {
    return {
      spec,
      error: 'BRAND_INPUT_FROZEN: brand_extraction_input cannot change once extraction has started',
    }
  }
  if (op.input.kind === 'url') {
    const normalized = normalizeBrandUrl(op.input.url)
    if (normalized === null) {
      return {
        spec,
        error: `set_brand_extraction_input: '${op.input.url}' is not a valid URL`,
      }
    }
    // Same-source re-paste is NOT a brand change: the carried URL
    // was normalized by this same op when originally set on the source, so
    // strict equality against the normalized form is exact. Convert to
    // applying the carry instead of discarding it and re-extracting.
    // (Preconditions hold: a pending carry implies input/status are still
    // null -- any prior successful set_brand_extraction_input would have
    // discarded the carry.)
    const carry = spec.global_constraints.brand_carry_state
    if (
      carry?.status === 'pending' &&
      carry.source_brand_extraction_input.kind === 'url' &&
      carry.source_brand_extraction_input.url === normalized
    ) {
      return applyBrandCarry(spec)
    }
    spec.global_constraints.brand_extraction_input = { kind: 'url', url: normalized }
    // A DIFFERENT brand input supersedes a staged remix carry.
    discardPendingBrandCarry(spec)
    return { spec }
  }
  const text = op.input.text.trim()
  if (text === '') {
    return { spec, error: 'set_brand_extraction_input: freeform text must be non-empty' }
  }
  const carry = spec.global_constraints.brand_carry_state
  if (
    carry?.status === 'pending' &&
    carry.source_brand_extraction_input.kind === 'freeform' &&
    carry.source_brand_extraction_input.text.trim() === text
  ) {
    return applyBrandCarry(spec)
  }
  spec.global_constraints.brand_extraction_input = { kind: 'freeform', text }
  discardPendingBrandCarry(spec)
  return { spec }
}

function applyStartBrandExtraction(spec: Spec, op: StartBrandExtractionOp): PatchResult {
  if (spec.global_constraints.brand_extraction_status !== null) {
    return {
      spec,
      error: `INVALID_BRAND_TRANSITION: start_brand_extraction requires status=null, got '${spec.global_constraints.brand_extraction_status}'`,
    }
  }
  spec.global_constraints.brand_extraction_status = 'pending'
  spec.global_constraints.brand_extraction_run_id = op.run_id
  spec.global_constraints.brand_extraction_started_at = op.started_at
  return { spec }
}

// Auto-retry a transiently-failed extraction. Applied while
// status is still 'pending' -- the workflow intercepts the child's failed
// signal before fail_brand_extraction would flip status -- so the existing
// seed/fail preconditions stay intact for the re-fired run. The transient-vs-
// permanent decision lives in the workflow; this op only enforces the cap.
function applyRetryBrandExtraction(spec: Spec): PatchResult {
  if (spec.global_constraints.brand_extraction_status !== 'pending') {
    return {
      spec,
      error: `INVALID_BRAND_TRANSITION: retry_brand_extraction requires status='pending', got '${spec.global_constraints.brand_extraction_status}'`,
    }
  }
  if (spec.global_constraints.brand_extraction_retry_count >= MAX_BRAND_AUTO_RETRIES) {
    return {
      spec,
      error: `BRAND_RETRY_EXHAUSTED: brand_extraction_retry_count is already at the cap (${MAX_BRAND_AUTO_RETRIES})`,
    }
  }
  spec.global_constraints.brand_extraction_retry_count += 1
  spec.global_constraints.brand_extraction_failure_reason = null
  spec.global_constraints.brand_reextraction_pending = true
  return { spec }
}

// Redirect extraction to a different URL. The sanctioned
// unfreeze: only valid once a result is showing (status 'completed', i.e. the
// brand_review / manual-entry window) and only once per session. Resets the
// bank for a full re-synthesis from the new site -- the old site's content is
// discarded; init-prompt uploads re-fold from cached_artifacts on the ready
// signal, so they survive.
function applyChangeBrandExtractionSource(
  spec: Spec,
  op: ChangeBrandExtractionSourceOp,
): PatchResult {
  if (spec.global_constraints.brand_extraction_status !== 'completed') {
    return {
      spec,
      error: `INVALID_BRAND_TRANSITION: change_brand_extraction_source requires status='completed', got '${spec.global_constraints.brand_extraction_status}'`,
    }
  }
  if (spec.global_constraints.brand_source_change_count >= MAX_BRAND_SOURCE_CHANGES) {
    return {
      spec,
      error: `BRAND_SOURCE_CHANGE_EXHAUSTED: the extraction source can only be changed ${MAX_BRAND_SOURCE_CHANGES} time(s)`,
    }
  }
  const normalized = normalizeBrandUrl(op.url)
  if (normalized === null) {
    return { spec, error: `change_brand_extraction_source: '${op.url}' is not a valid URL` }
  }
  spec.global_constraints.brand_extraction_input = { kind: 'url', url: normalized }
  spec.global_constraints.brand_bank = null
  spec.global_constraints.brand_extraction_status = 'pending'
  spec.global_constraints.brand_source_change_count += 1
  spec.global_constraints.brand_extraction_failure_reason = null
  // Fresh URL == fresh extraction: hand it back its auto-retry budget so a
  // transient failure on the new site still gets the one retry, even if the
  // original extraction already spent its retry.
  spec.global_constraints.brand_extraction_retry_count = 0
  spec.global_constraints.brand_reextraction_pending = true
  return { spec }
}

// Stamp the new run on a pending re-extraction and lower the trigger flag.
// Applied by the workflow immediately before startChild, the
// re-extraction counterpart of start_brand_extraction's run stamping.
function applyMarkBrandReextractionStarted(
  spec: Spec,
  op: MarkBrandReextractionStartedOp,
): PatchResult {
  if (!spec.global_constraints.brand_reextraction_pending) {
    return {
      spec,
      error:
        'INVALID_BRAND_TRANSITION: mark_brand_reextraction_started requires a pending re-extraction',
    }
  }
  if (spec.global_constraints.brand_extraction_status !== 'pending') {
    return {
      spec,
      error: `INVALID_BRAND_TRANSITION: mark_brand_reextraction_started requires status='pending', got '${spec.global_constraints.brand_extraction_status}'`,
    }
  }
  spec.global_constraints.brand_extraction_run_id = op.run_id
  spec.global_constraints.brand_extraction_started_at = op.started_at
  spec.global_constraints.brand_reextraction_pending = false
  return { spec }
}

// Accept bare domains from the planner ("northwindweekly.com") by defaulting to
// https://; returns a fully-qualified URL string or null when it cannot be
// parsed as an http(s) URL.
function createEmptyBrandBank(): BrandBank {
  return {
    basic_info: {
      business_name: '',
      founders: [],
      target_audience: [],
      pain_points_addressed: [],
      vision_and_values: { mission: null, values: [] },
      about_us_summary: null,
      origin_quotes: [],
      location: null,
    },
    product_offerings: {},
    testimonials: [],
    voice: { persona: null, signature_phrases: [] },
    palette: [],
    ctas: [],
    socials: {},
    staged_assets: { logo: [], product: [], character: [] },
    derived_style_text: null,
  }
}

// Exported for the v2 auto-start activity: choosing apply-vs-set
// requires the same normalization patch-apply uses, and the op payload must
// carry the normalized URL (v2 feeds the LOG op to the extraction child).
export function normalizeBrandUrl(raw: string): null | string {
  const trimmed = raw.trim()
  if (trimmed === '') {
    return null
  }
  const withScheme = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed.replace(/^\/+/, '')}`
  try {
    const parsed = new URL(withScheme)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null
    }
    return parsed.toString()
  } catch {
    return null
  }
}

// Tier 1 brand-bank field paths that are editable during the brand_review
// window. Mirrors the string-literal union on `UpdateBrandBankFieldOp.path`;
// this Set guards the runtime payload after it crosses the wire.
const TIER_1_BRAND_FIELD_PATHS = new Set<UpdateBrandBankFieldOp['path']>([
  'basic_info.about_us_summary',
  'basic_info.business_name',
  'ctas',
])

// Coerce a text-only CTA edit into the canonical `{ label, href }[]` shape.
// A label-only chat edit ("change the CTA to X") may arrive as a bare string
// or an object without `href`; href is optional for video, so default it to
// null rather than rejecting the edit.
function applyUpdateBrandBankField(
  spec: Spec,
  op: UpdateBrandBankFieldOp,
  context?: PatchContext,
): PatchResult {
  const lockErr = assertNotLocked(spec)
  if (lockErr) {
    return { spec, error: lockErr }
  }
  if (!TIER_1_BRAND_FIELD_PATHS.has(op.path)) {
    return {
      spec,
      error: `Field path '${op.path}' is not in the Tier 1 brand-bank allowlist for update_brand_bank_field`,
    }
  }

  // Window gate. Both conditions required: `completed` closes the window
  // pre-extraction (nothing to edit), `brand_review` closes it post-Confirm
  // (bank locks via `lock_brand_bank` which then trips `assertNotLocked`).
  const status = spec.global_constraints.brand_extraction_status
  if (status !== 'completed') {
    return {
      spec,
      error: `update_brand_bank_field requires brand_extraction_status === 'completed' (current: ${status ?? 'null'})`,
    }
  }
  const phase = context?.phase
  if (phase !== 'brand_review') {
    return {
      spec,
      error: `update_brand_bank_field requires todo_state.phase === 'brand_review' (current: ${phase ?? 'null'})`,
    }
  }

  const bank = spec.global_constraints.brand_bank
  if (!bank) {
    return { spec, error: 'BRAND_BANK_MISSING: brand_bank is null' }
  }

  switch (op.path) {
    case 'basic_info.about_us_summary': {
      if (op.value !== null && typeof op.value !== 'string') {
        return { spec, error: 'about_us_summary must be a string or null' }
      }
      // Coalesce whitespace-only strings to null so the bank has ONE
      // empty representation. Otherwise a user sending "   " to clear
      // the field would leave it as "" -- a different empty state than
      // a null write, which complicates downstream "is summary set?"
      // checks. Trim non-empty strings the same way business_name does.
      const trimmed = typeof op.value === 'string' ? op.value.trim() : null
      bank.basic_info.about_us_summary = trimmed === '' ? null : trimmed
      return { spec }
    }
    case 'basic_info.business_name': {
      if (typeof op.value !== 'string' || op.value.trim().length === 0) {
        return { spec, error: 'business_name must be a non-empty string' }
      }
      bank.basic_info.business_name = op.value.trim()
      return { spec }
    }
    case 'ctas': {
      const parsed = BrandBankCtasSchema.safeParse(normalizeCtasValue(op.value))
      if (!parsed.success) {
        return { spec, error: `ctas payload invalid: ${parsed.error.message}` }
      }
      bank.ctas = parsed.data
      return { spec }
    }
  }
}

function assertNotLocked(spec: Spec): null | string {
  return spec.global_constraints.brand_extraction_status === 'locked'
    ? 'BRAND_LOCKED: bank is locked, no further mutations allowed'
    : null
}

// Coerce a text-only CTA edit into the canonical `{ label, href }[]` shape.
// href is never consumed by video generation, so a label-only chat edit
// ("change the CTA to X") that arrives as a bare string or an href-less
// object defaults href to '' rather than being rejected.
function normalizeCtasValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return [{ href: '', label: value }]
  }
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (typeof item === 'string') {
        return { href: '', label: item }
      }
      if (typeof item === 'object' && item !== null) {
        const rec = item as Record<string, unknown>
        return { href: rec['href'] ?? '', label: rec['label'] }
      }
      return item
    })
  }
  return value
}

// Utilities

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj))
}

// Recompute `order` (by position) and a continuous start_s/end_s timeline,
// preserving each shot's duration. Leaves shot_id untouched -- callers that need
// canonical positional ids (e.g. delete_shots) layer that on top.
function rebuildShotsWithCanonicalIdsAndContinuousTimeline(shots: Shot[]): Shot[] {
  return resequenceContinuousTimeline(shots).map((shot, index) => ({
    ...shot,
    shot_id: `shot_${index + 1}`,
  }))
}

function resequenceContinuousTimeline(shots: Shot[]): Shot[] {
  let cursor = 0
  return shots.map((shot, index) => {
    const rawDuration = shot.time.end_s - shot.time.start_s
    const duration = Math.max(0.01, Number.isFinite(rawDuration) ? rawDuration : 0.01)
    const start_s = Number(cursor.toFixed(2))
    const end_s = Number((cursor + duration).toFixed(2))
    cursor = end_s
    return { ...shot, order: index + 1, time: { start_s, end_s } }
  })
}
