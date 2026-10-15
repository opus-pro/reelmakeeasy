import {
  Message,
  PlannerAnchorOperation,
  PlannerAnchorRequest,
  PlannerRecoveryContext,
  PlannerRecoveryFailure,
  PlannerRepairCandidate,
  SessionState,
  UploadedAsset,
} from '../types'

const MAX_RECENT_RECOVERY_FAILURES = 6
const MAX_STORED_RECOVERY_FAILURES = 20

export function buildRecoveryContext(session: SessionState): PlannerRecoveryContext {
  const recentFailures = (session.cached_artifacts.recovery_failures ?? []).slice(
    -MAX_RECENT_RECOVERY_FAILURES,
  )
  const lastFailure = recentFailures.at(-1) ?? null

  return {
    duplicate_invalid_guard_active: recentFailures.some(
      (failure) => failure.failure_stage === 'duplicate_invalid_guard',
    ),
    last_failure: lastFailure,
    recent_failures: recentFailures,
    repair_candidates: buildRepairCandidates(session, lastFailure),
  }
}

/**
 * Refinement-only: each upload referenced in the latest user message MUST
 * end up bound somewhere in spec (`pre_selected_assets` user_upload OR
 * anchor `source_asset_ids` OR `absorbed_upload_ids` history), and any
 * bound upload MUST be described. Other phases have no spec target
 * (mode_confirmation / bootstrap_script) or run their own absorption
 * logic (bootstrap_visual anchor manager).
 *
 * This function always reports the CURRENT set of violations -- it does
 * not dedup against recent_failures. Dedup of recovery-failure records
 * is the caller's responsibility (planner-loop.applyUserUploadBindingGuard),
 * which keeps the "always force a repair iteration while a violation
 * persists" property independent of the "do not spam the same record"
 * property.
 */
export function detectUserUploadBindingViolations(session: SessionState): PlannerRecoveryFailure[] {
  if (session.todo_state?.phase !== 'refinement') {
    return []
  }

  const latestUserMessage = findLatestUserMessage(session.transcript ?? [])
  const uploads = latestUserMessage?.uploaded_assets ?? []
  if (uploads.length === 0) {
    return []
  }

  const boundAssetIds = collectBoundUploadAssetIds(session)
  const describedAssetIds = new Set(
    (session._loaded_asset_descriptions?.items ?? []).map((item) => item.asset_id),
  )

  const failures: PlannerRecoveryFailure[] = []
  const now = new Date().toISOString()

  for (const upload of uploads) {
    const assetId = upload.asset_id
    if (!assetId) {
      continue
    }
    const isBound = boundAssetIds.has(assetId)
    const isDescribed = describedAssetIds.has(assetId)

    if (!isBound) {
      failures.push(buildUserUploadNotBoundFailure({ asset: upload, timestamp: now }))
      continue
    }

    if (!isDescribed) {
      failures.push(buildUserUploadUndescribedFailure({ asset: upload, timestamp: now }))
    }
  }

  return failures
}

/**
 * Returns true if a failure with the same (error_code, asset_id) appears
 * within the recent recovery_failures window. Exported so the planner
 * loop's binding guard can avoid spamming the recovery_failures array
 * while still always forcing a repair iteration when a violation persists.
 */
export function isUserUploadFailureRecentlyRecorded(
  session: SessionState,
  failure: PlannerRecoveryFailure,
): boolean {
  const recentFailures = (session.cached_artifacts.recovery_failures ?? []).slice(
    -MAX_RECENT_RECOVERY_FAILURES,
  )
  const assetId = (failure.normalized_params as null | undefined | { asset_id?: string })?.asset_id
  if (!assetId) {
    return false
  }
  return isFailureRecentlyFired(recentFailures, failure.error_code, assetId)
}

export function recordRecoveryFailure(
  session: SessionState,
  failure: PlannerRecoveryFailure,
): void {
  if (!session.cached_artifacts.recovery_failures) {
    session.cached_artifacts.recovery_failures = []
  }

  session.cached_artifacts.recovery_failures.push(failure)
  if (session.cached_artifacts.recovery_failures.length > MAX_STORED_RECOVERY_FAILURES) {
    session.cached_artifacts.recovery_failures = session.cached_artifacts.recovery_failures.slice(
      -MAX_STORED_RECOVERY_FAILURES,
    )
  }
}

function buildRepairCandidates(
  session: SessionState,
  lastFailure: null | PlannerRecoveryFailure,
): PlannerRepairCandidate[] {
  if (!lastFailure || !isSharedAnchorPlanRecoveryFailure(lastFailure)) {
    return []
  }

  const candidateAnchorId = extractCandidateAnchorId(lastFailure.normalized_params)
  const candidateAnchorType = extractCandidateAnchorType(lastFailure.normalized_params)
  const candidateSourceAssetIds = extractCandidateSourceAssetIds(
    session,
    lastFailure.normalized_params,
  )
  const candidateSourceAssetId =
    extractCandidateSourceAssetId(lastFailure.normalized_params) ??
    candidateSourceAssetIds[0] ??
    null
  const candidateOperation = extractCandidateOperation(lastFailure.normalized_params)

  const candidates: PlannerRepairCandidate[] = []

  if (
    candidateAnchorId &&
    candidateOperation !== 'REMOVE_ANCHOR' &&
    candidateSourceAssetIds.length > 0
  ) {
    candidates.push({
      candidate_anchor_id: candidateAnchorId,
      candidate_anchor_type: candidateAnchorType,
      candidate_recovery_action: 'REPAIR_ANCHOR_BINDING_PARAMS',
      candidate_source_asset_id: candidateSourceAssetId,
      candidate_source_asset_ids: candidateSourceAssetIds,
      failed_tool: lastFailure.failed_tool ?? null,
      reason:
        'Repair generate_anchor_assets by adding anchor_requests with source_asset_ids for the uploaded-image binding.',
    })
  }

  if (candidateAnchorId && candidateOperation !== 'REMOVE_ANCHOR') {
    if (candidateSourceAssetIds.length === 0) {
      candidates.push({
        candidate_anchor_id: candidateAnchorId,
        candidate_anchor_type: candidateAnchorType,
        candidate_recovery_action: 'CONTINUE_ANCHOR_UPSERT_WITHOUT_REFS',
        candidate_source_asset_id: null,
        candidate_source_asset_ids: [],
        failed_tool: lastFailure.failed_tool ?? null,
        reason:
          'Continue with a no-ref UPSERT for this anchor if the intent is concept-driven rather than upload-driven binding.',
      })
    }

    candidates.push({
      candidate_anchor_id: candidateAnchorId,
      candidate_anchor_type: candidateAnchorType,
      candidate_recovery_action: 'EMIT_SHARED_ANCHOR_PLAN_BATCH',
      candidate_source_asset_id: candidateSourceAssetId,
      candidate_source_asset_ids: candidateSourceAssetIds,
      failed_tool: 'generate_anchor_assets',
      reason:
        'Emit one refinement shared Anchor Plan batch: generate_anchor_assets(ANCHOR_IDS, anchor_requests=...) + generate_explainer_visual_script(FULL). Use UPSERT for create/update and include source_asset_ids only for upload-driven source updates.',
    })
  }

  candidates.push({
    candidate_anchor_id: candidateAnchorId,
    candidate_anchor_type: candidateAnchorType,
    candidate_recovery_action: 'ASK_CLARIFY_BINDING',
    candidate_source_asset_id: candidateSourceAssetId,
    candidate_source_asset_ids: candidateSourceAssetIds,
    failed_tool: lastFailure.failed_tool ?? null,
    reason:
      'Ask the user to confirm which uploaded image should bind to the recurring main-character anchor if the binding is ambiguous.',
  })

  return dedupeRepairCandidates(candidates)
}

function buildUserUploadNotBoundFailure(params: {
  asset: UploadedAsset
  timestamp: string
}): PlannerRecoveryFailure {
  const { asset, timestamp } = params
  return {
    error_code: 'USER_UPLOAD_NOT_BOUND',
    failed_tool: null,
    failure_stage: 'post_step_invariant',
    intent_signature: `user_upload_not_bound:${asset.asset_id}`,
    message: `User-attached upload '${asset.asset_id}' (${asset.file_name}) from the latest refinement message is not referenced anywhere in spec. The user expects to see this file used; binding it to a semantically-equivalent existing anchor_id instead of writing this exact asset_id is not a substitute.`,
    missing_fields: ['pre_selected_assets.user_upload', 'anchor.source_asset_ids'],
    normalized_params: {
      asset_id: asset.asset_id,
      file_name: asset.file_name,
    },
    repair_hint:
      'Bind this asset_id via Path A (PATCH_SPEC add_preselected_asset with source: user_upload on the target shot) or Path B (generate_anchor_assets UPSERT with source_update_mode: APPEND adding this asset_id to an existing anchor source_asset_ids). See unified-planner-prompt §7.3 "Upload preservation rule".',
    retryable: true,
    timestamp,
  }
}

function buildUserUploadUndescribedFailure(params: {
  asset: UploadedAsset
  timestamp: string
}): PlannerRecoveryFailure {
  const { asset, timestamp } = params
  return {
    error_code: 'USER_UPLOAD_UNDESCRIBED_BEFORE_SPEC_BIND',
    failed_tool: null,
    failure_stage: 'post_step_invariant',
    intent_signature: `user_upload_undescribed:${asset.asset_id}`,
    message: `Upload '${asset.asset_id}' (${asset.file_name}) was bound into spec without an asset description. Downstream visual-script / keyframe generation needs the text description as prompt context.`,
    missing_fields: ['asset_description'],
    normalized_params: {
      asset_id: asset.asset_id,
      file_name: asset.file_name,
    },
    repair_hint: `Call describe_uploaded_images for '${asset.asset_id}' in the next step before keeping it bound in spec.`,
    retryable: true,
    timestamp,
  }
}

function collectBoundUploadAssetIds(session: SessionState): Set<string> {
  const bound = new Set<string>()

  for (const shot of session.spec?.visual_script?.shots ?? []) {
    for (const psa of shot.pre_selected_assets ?? []) {
      if (psa.source === 'user_upload' && psa.asset_id) {
        bound.add(psa.asset_id)
      }
    }
  }

  const anchorCandidates = session.cached_artifacts.anchor_plan?.candidates ?? []
  for (const candidate of anchorCandidates) {
    if (candidate.source_asset_id) {
      bound.add(candidate.source_asset_id)
    }
    for (const sid of candidate.source_asset_ids ?? []) {
      if (sid) {
        bound.add(sid)
      }
    }
  }

  // Uploads once absorbed into an anchor (see generate-anchor-assets.ts
  // mergeAbsorbedUploadIds) count as bound so a revisit does not trip the guard.
  for (const aid of session.cached_artifacts.absorbed_upload_ids ?? []) {
    if (aid) {
      bound.add(aid)
    }
  }

  return bound
}

function dedupeRepairCandidates(candidates: PlannerRepairCandidate[]): PlannerRepairCandidate[] {
  const seen = new Set<string>()
  return candidates.filter((candidate) => {
    const key = JSON.stringify(candidate)
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

function extractAnchorRequests(
  normalizedParams: null | Record<string, unknown> | undefined,
): PlannerAnchorRequest[] {
  const nestedParams = getNestedToolParams(normalizedParams)
  if (nestedParams) {
    return extractAnchorRequests(nestedParams)
  }

  const rawRequests = normalizedParams?.anchor_requests
  if (!Array.isArray(rawRequests)) {
    return []
  }

  return rawRequests
    .filter((request): request is PlannerAnchorRequest =>
      Boolean(request && typeof request === 'object'),
    )
    .map((request) => request)
}

function extractCandidateAnchorId(
  normalizedParams: null | Record<string, unknown> | undefined,
): null | string {
  const nestedParams = getNestedToolParams(normalizedParams)
  if (nestedParams) {
    return extractCandidateAnchorId(nestedParams)
  }

  const requestAnchorId = extractAnchorRequests(normalizedParams)
    .map((request) => request.anchor_id?.trim())
    .find((anchorId) => Boolean(anchorId))
  if (requestAnchorId) {
    return requestAnchorId
  }

  const anchorIds = normalizedParams?.anchor_ids
  if (!Array.isArray(anchorIds)) {
    return null
  }

  const firstAnchorId = anchorIds.find(
    (anchorId): anchorId is string => typeof anchorId === 'string' && anchorId.trim().length > 0,
  )
  return firstAnchorId?.trim() ?? null
}

function extractCandidateAnchorType(
  normalizedParams: null | Record<string, unknown> | undefined,
): 'CHARACTER' | 'OBJECT' | null {
  const nestedParams = getNestedToolParams(normalizedParams)
  if (nestedParams) {
    return extractCandidateAnchorType(nestedParams)
  }

  const requestType = extractAnchorRequests(normalizedParams)
    .map((request) => request.type ?? null)
    .find((type) => type === 'CHARACTER' || type === 'OBJECT')
  if (requestType) {
    return requestType
  }
  return null
}

function extractCandidateOperation(
  normalizedParams: null | Record<string, unknown> | undefined,
): PlannerAnchorOperation {
  const nestedParams = getNestedToolParams(normalizedParams)
  if (nestedParams) {
    return extractCandidateOperation(nestedParams)
  }

  const requestOperation = extractAnchorRequests(normalizedParams)
    .map((request) => request.operation)
    .find((operation) => operation === 'REMOVE_ANCHOR' || operation === 'UPSERT')

  return requestOperation === 'REMOVE_ANCHOR' ? 'REMOVE_ANCHOR' : 'UPSERT'
}

function extractCandidateSourceAssetId(
  normalizedParams: null | Record<string, unknown> | undefined,
): null | string {
  const nestedParams = getNestedToolParams(normalizedParams)
  if (nestedParams) {
    return extractCandidateSourceAssetId(nestedParams)
  }

  const requestSourceAssetId = extractAnchorRequests(normalizedParams)
    .map((request) => request.source_asset_id?.trim() ?? '')
    .find((assetId) => assetId.length > 0)
  return requestSourceAssetId ?? null
}

function extractCandidateSourceAssetIds(
  session: SessionState,
  normalizedParams: null | Record<string, unknown> | undefined,
): string[] {
  const nestedParams = getNestedToolParams(normalizedParams)
  if (nestedParams) {
    return extractCandidateSourceAssetIds(session, nestedParams)
  }

  const fromRequests = extractAnchorRequests(normalizedParams)
    .flatMap((request) => request.source_asset_ids ?? [])
    .map((assetId) => assetId.trim())
    .filter((assetId) => assetId.length > 0)

  if (fromRequests.length > 0) {
    return Array.from(new Set(fromRequests))
  }

  // Defensive nullish guard: the workflow bootstrap path historically
  // landed assets in cached_artifacts without normalizing `uploaded_at`
  // (see workflow.ts buildInitialSessionState comment). Old sessions that
  // hit that code path may still carry `uploaded_at=undefined` in their
  // persisted state, and recovery context is built on every planner step
  // -- a bare `b.uploaded_at.localeCompare(...)` would crash the entire
  // planner loop instead of just falling back to "no newest-asset hint".
  const uploadedAssets = [...(session.cached_artifacts.uploaded_assets ?? [])].sort((a, b) =>
    (b.uploaded_at ?? '').localeCompare(a.uploaded_at ?? ''),
  )
  const newestAssetId = uploadedAssets[0]?.asset_id
  return newestAssetId ? [newestAssetId] : []
}

function findLatestUserMessage(transcript: Message[]): Message | undefined {
  for (let i = transcript.length - 1; i >= 0; i--) {
    const msg = transcript[i]
    if (msg.role === 'user') {
      return msg
    }
  }
  return undefined
}

function getNestedToolParams(
  normalizedParams: null | Record<string, unknown> | undefined,
): null | Record<string, unknown> {
  const batch = normalizedParams?.batch
  if (!Array.isArray(batch)) {
    return null
  }

  const anchorToolEntry = batch.find(
    (entry): entry is { params: Record<string, unknown>; tool: string } =>
      Boolean(entry) &&
      typeof entry === 'object' &&
      'tool' in entry &&
      (entry as { tool?: unknown }).tool === 'generate_anchor_assets' &&
      'params' in entry &&
      typeof (entry as { params?: unknown }).params === 'object' &&
      (entry as { params?: unknown }).params !== null,
  )

  return anchorToolEntry?.params ?? null
}

function isFailureRecentlyFired(
  recentFailures: PlannerRecoveryFailure[],
  errorCode: PlannerRecoveryFailure['error_code'],
  assetId: string,
): boolean {
  return recentFailures.some((failure) => {
    if (failure.error_code !== errorCode) {
      return false
    }
    const params = failure.normalized_params
    return Boolean(params && (params as { asset_id?: unknown }).asset_id === assetId)
  })
}

function isSharedAnchorPlanRecoveryFailure(failure: PlannerRecoveryFailure): boolean {
  if (failure.failed_tool === 'generate_anchor_assets') {
    return true
  }
  if (
    failure.failed_tool === 'generate_explainer_visual_script' &&
    failure.message.toLowerCase().includes('anchor plan')
  ) {
    return true
  }

  const missingFields = new Set(failure.missing_fields ?? [])
  if (missingFields.has('anchor_requests') || missingFields.has('source_asset_ids')) {
    return true
  }

  const normalizedMessage = failure.message.toLowerCase()
  return (
    normalizedMessage.includes('shared-anchor-plan') ||
    normalizedMessage.includes('anchor_requests') ||
    normalizedMessage.includes('source_asset_ids') ||
    normalizedMessage.includes('uploaded-image binding')
  )
}
