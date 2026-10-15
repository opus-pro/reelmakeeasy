import { SessionControlCommand, SessionState } from '../types'

import {
  GuardUndescribedAssetsDeps,
  IntentRoutingGuardOptions,
  PlannerOutputLike,
  PlannerStepResultLike,
} from './runtime.types'

/**
 * Guard design note
 * -----------------
 * Historically this module had keyword-based routing guards that set
 * forceContinueNextStep: true on mismatch. Those were deleted because
 * keyword classification was strictly weaker than the LLM planner and
 * produced retry storms when regex disagreed with compound-intent
 * recognition (r03s02 MERGE, r03s03 "update all narration").
 *
 * What remains:
 *
 *   - guardUndescribedAssetsBeforeAction -- real state prerequisite.
 *
 *   - guardSessionControlBeforeAction -- structural-only checks
 *     (command present, not a duplicate within this turn).
 *
 *   - guardIntentRoutingBeforeAction -- #4/#5 global-field refresh
 *     advisory. The ONLY guard that still inspects user message
 *     content, and it uses a "first hint, then defer" pattern:
 *       First call with a given (action, tool, scope) signature:
 *         return POLICY_HINT (no forceContinueNextStep).
 *       Second call with the same signature in the same turn:
 *         return null (guard defers; planner's confidence wins).
 *     This preserves the "confirm-before-refresh" UX when the planner
 *     was just being careless, but never deadlocks when the planner
 *     is confident (e.g. user authorized refresh via a phrase the
 *     permission regex doesn't recognize).
 *
 * The loop-level deadlock counter (planner-loop.ts
 * MAX_SAME_GUARD_BLOCK_RETRIES) backstops any future guard regression.
 */

const GLOBAL_REWRITE_PERMISSION_PATTERNS = [
  /\bredesign\s+(?:the\s+)?whole\b/i,
  /\bredesign\s+all\s+visuals\b/i,
  /\bregenerate\s+everything\b/i,
  /\brewrite\s+(?:the\s+)?whole\b/i,
  /\brefresh\s+all\s+visuals\b/i,
  /\b(?:refresh|regenerate|rewrite)\b[\s\S]{0,40}\b(?:script|visuals?|visual script|shots?|whole video|all shots)\b/i,
]
const PATCH_ONLY_GLOBAL_FIELDS = new Set(['pacing', 'style'])
const CONFIRM_BEFORE_REFRESH_GLOBAL_FIELDS = new Set([
  'brand_scope',
  'geo_scope',
  'key_entities',
  'must_not_violate',
  'script_category',
  'target_audience',
  'time_scope',
  'tone',
  'topic',
  'video_type',
])
const EXPLICIT_GLOBAL_FIELD_PATTERNS: Array<[string, RegExp]> = [
  ['tone', /\btone\b/i],
  ['style', /\bstyle\b/i],
  ['pacing', /\bpacing\b/i],
  ['target_audience', /\btarget audience\b|\baudience\b/i],
  ['topic', /\btopic\b/i],
  ['video_type', /\bvideo type\b/i],
  ['brand_scope', /\bbrand scope\b/i],
  ['geo_scope', /\bgeo(?:graphic)? scope\b|\bgeographic scope\b/i],
  ['time_scope', /\btime scope\b/i],
  ['key_entities', /\bkey (?:entity|entities)\b/i],
  ['must_not_violate', /\bmust(?:\s+not|\s*-\s*not)\s+violate\b/i],
  ['script_category', /\bscript category\b/i],
]
const ASSET_DESCRIPTION_MISSING_MESSAGE =
  'Undescribed uploaded assets exist; call describe_uploaded_images first.'
const ASSET_DESCRIPTION_MISSING_KEYS = ['asset_descriptions']
const SILHOUETTE_INFERENCE_ACCEPTANCE_PREFIX = 'silhouette_inference_acceptance:'
const SILHOUETTE_UPLOAD_OPTION_ID = 'upload_clear_reference'
const SILHOUETTE_INFERENCE_OPTION_ID = 'continue_with_inference'

/**
 * Runtime-owned safety gate for identity-sensitive silhouette uploads.
 *
 * The planner prompt also explains this rule, but bootstrap_visual normally
 * forbids ASK_CLARIFY while its runtime-owned todo items are pending. Leaving
 * the behavior prompt-only therefore made the warning unreachable in the real
 * silhouette-upload flow. Normalize the first anchor-generation decision into the
 * clarification so the model cannot silently skip it.
 */
export function enforceSilhouetteIdentityClarification(
  session: SessionState,
  output: PlannerOutputLike,
): PlannerOutputLike {
  const acceptedAssetIds = getAcceptedSilhouetteAssetIds(session)
  if (acceptedAssetIds.length > 0) {
    output.conversation_summary_update = appendSilhouetteAcceptanceMarkers(
      output.conversation_summary_update,
      acceptedAssetIds,
    )
  }

  if (!startsAnchorGeneration(output)) {
    return output
  }

  const assetIds = getUnacceptedIdentitySensitiveSilhouetteAssetIds(session)
  if (assetIds.length === 0) {
    return output
  }

  if (latestUserAcceptedSilhouetteInference(session)) {
    output.conversation_summary_update = appendSilhouetteAcceptanceMarkers(
      output.conversation_summary_update,
      assetIds,
    )
    return output
  }

  return {
    ...output,
    action: 'ASK_CLARIFY',
    expect_assets: true,
    ops: null,
    options: [
      {
        expect_assets: true,
        id: SILHOUETTE_UPLOAD_OPTION_ID,
        label: 'Upload a clear front-facing photo',
      },
      {
        id: SILHOUETTE_INFERENCE_OPTION_ID,
        label: 'Continue with inferred appearance',
      },
    ],
    reply:
      'The uploaded character image is silhouette-only and does not show reliable identity details. For stable character roles, please upload a clear front-facing photo, or explicitly continue with an inferred appearance that may differ from the real people.',
    reply_question: 'How would you like to continue?',
    session_control: null,
    stale_dispositions: null,
    structure_edit: null,
    todo_snapshot: null,
    todo_update: {
      clear: null,
      phase: session.todo_state.phase,
      set_item_status: null,
    },
    tool_calls: null,
  }
}

export function guardIntentRoutingBeforeAction(
  options: IntentRoutingGuardOptions,
): null | PlannerStepResultLike {
  const phase = options.session.todo_state?.phase ?? 'refinement'
  if (phase !== 'refinement') {
    return null
  }

  const latestUserMessage = getLatestUserMessage(options.session, options.userMessage)
  const explicitGlobalFields = inferExplicitGlobalFields(latestUserMessage)
  const hint = advisePolicyHint(options.output, latestUserMessage, explicitGlobalFields)
  if (!hint) {
    return null
  }

  // First-hint-then-defer: key the signature on planner intent (action +
  // tool + scope), not on the hint text. If the planner has already been
  // hinted for this exact intent once this turn, trust it this time.
  const signature = buildPolicyHintSignature(options.output)
  if (options.policyHintedSignatures.has(signature)) {
    return null
  }
  options.policyHintedSignatures.add(signature)
  return {
    shouldStop: false,
    lastActionResult: hint,
  }
}

export function guardSessionControlBeforeAction(options: {
  hasSpecMutationThisTurn: boolean
  output: PlannerOutputLike
  session: SessionState
  successfulSessionControlsThisTurn: Set<SessionControlCommand>
  userMessage: string
}): null | PlannerStepResultLike {
  const { output, successfulSessionControlsThisTurn } = options
  if (output.action !== 'SESSION_CONTROL') {
    return null
  }

  const command = output.session_control?.command as SessionControlCommand
  if (!command) {
    return {
      shouldStop: false,
      lastActionResult: 'INVALID_SESSION_CONTROL_INTENT: session_control.command is missing.',
    }
  }

  if (successfulSessionControlsThisTurn.has(command)) {
    return {
      shouldStop: false,
      lastActionResult: `Duplicate SESSION_CONTROL skipped (${command}) because this command already ran in this turn.`,
    }
  }

  successfulSessionControlsThisTurn.add(command)
  return null
}

export function guardUndescribedAssetsBeforeAction(
  output: PlannerOutputLike,
  session: SessionState,
  deps: GuardUndescribedAssetsDeps,
): null | PlannerStepResultLike {
  if (
    output.action === 'ASK_CLARIFY' ||
    output.action === 'MODE_CONFIRMED' ||
    output.action === 'SESSION_CONTROL' ||
    output.action === 'TODO_UPDATE_ONLY'
  ) {
    return null
  }
  const undescribed = deps.getUndescribedUploadedAssets(session)
  if (undescribed.length === 0) {
    return null
  }
  // After brand extraction completes, every user_upload asset that went
  // through Stage 2 freeform is represented in brand_bank.staged_assets
  // with a description (filename). The extraction LLM has already
  // classified them into logo/character/product. Treat those as
  // sufficiently "described" so the planner can act on brand_review
  // requests without blocking on describe_uploaded_images for every
  // freeform attachment.
  if (allUndescribedInStagedAssets(undescribed, session)) {
    return null
  }

  // Brand-setup-only PATCH ops configure brand extraction and never read an
  // image description -- brand extraction classifies/describes uploads itself.
  // Without this exemption an undescribed upload blocks the brand_video_type
  // PATCH and deadlocks turn 1 of every brand video with a logo. The op set
  // lives in isBrandSetupOnlyPatch (shared with handlePatchAction's
  // forceContinue chaining).
  //
  // brand_review chat-edit ops get the same exemption: they operate on the
  // synthesized bank / extraction source, never on image descriptions. This
  // matters on the brand-carry path: no extraction child runs,
  // so a prompt upload is never described or folded into staged_assets, and
  // without the exemption every review edit (rename, re-extract) is blocked
  // for the rest of the session.
  if (
    output.action === 'PATCH_SPEC' &&
    (isBrandSetupOnlyPatch(output.ops) || isBrandReviewEditOnlyPatch(output.ops))
  ) {
    return null
  }

  if (output.action === 'TOOL_CALLS') {
    const toolCalls = output.tool_calls ?? []
    const hasDescribe = toolCalls.some((tc) => tc.tool === 'describe_uploaded_images')
    if (hasDescribe) {
      const allAllowed = toolCalls.every(
        (tc) => tc.tool === 'describe_uploaded_images' || tc.tool === 'generate_intent_context',
      )
      if (allAllowed) {
        return null
      }
    }
    const tool = toolCalls[0]?.tool
    if (tool) {
      deps.recordToolEvent(session, {
        tool,
        status: 'error',
        code: 'MISSING_DEPENDENCY',
        retryable: true,
        missing: ASSET_DESCRIPTION_MISSING_KEYS,
        message: ASSET_DESCRIPTION_MISSING_MESSAGE,
        timestamp: new Date().toISOString(),
      })
    }
  }

  return {
    shouldStop: false,
    lastActionResult: `Action blocked: code=MISSING_DEPENDENCY retryable=true missing=[${ASSET_DESCRIPTION_MISSING_KEYS.join(',')}] message=${ASSET_DESCRIPTION_MISSING_MESSAGE}`,
  }
}

export function isSilhouetteIdentityClarification(output: PlannerOutputLike): boolean {
  if (output.action !== 'ASK_CLARIFY' || !Array.isArray(output.options)) {
    return false
  }
  const optionIds = new Set(output.options.map((option) => option.id))
  return (
    optionIds.size === 2 &&
    optionIds.has(SILHOUETTE_UPLOAD_OPTION_ID) &&
    optionIds.has(SILHOUETTE_INFERENCE_OPTION_ID)
  )
}

export function normalizeText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function advisePolicyHint(
  output: PlannerOutputLike,
  latestUserMessage: string,
  explicitGlobalFields: string[],
): null | string {
  if (explicitGlobalFields.length === 0) {
    return null
  }
  if (matchesAny(GLOBAL_REWRITE_PERMISSION_PATTERNS, latestUserMessage)) {
    return null
  }

  const triggersScriptOrVisualRefresh =
    output.action === 'TOOL_CALLS' &&
    (output.tool_calls ?? []).some(
      (call) =>
        call.tool === 'generate_explainer_script' ||
        call.tool === 'generate_explainer_visual_script',
    )
  if (!triggersScriptOrVisualRefresh) {
    return null
  }

  const includesPatchOnlyField = explicitGlobalFields.some((field) =>
    PATCH_ONLY_GLOBAL_FIELDS.has(field),
  )
  if (includesPatchOnlyField) {
    return 'POLICY_HINT: style/pacing are typically patch-only; consider PATCH_SPEC update_global_field first unless the user explicitly asked to refresh the script or visuals. If you are confident this refresh is what the user wants, repeat the same action on the next step and the guard will defer.'
  }

  const includesConfirmBeforeRefreshField = explicitGlobalFields.some((field) =>
    CONFIRM_BEFORE_REFRESH_GLOBAL_FIELDS.has(field),
  )
  if (includesConfirmBeforeRefreshField) {
    return 'POLICY_HINT: topic/video_type/script_category/key_entities/geo_scope/time_scope/brand_scope/target_audience/tone/must_not_violate changes usually want a PATCH_SPEC first, then ASK_CLARIFY whether to refresh. If the user already authorized regeneration and you are confident, repeat the same action on the next step and the guard will defer.'
  }

  return null
}

function allUndescribedInStagedAssets(
  undescribed: ReadonlyArray<{ asset_id: string }>,
  session: SessionState,
): boolean {
  const status = session.spec?.global_constraints?.brand_extraction_status
  if (status !== 'completed') {
    return false
  }
  const staged = session.spec?.global_constraints?.brand_bank?.staged_assets
  if (!staged) {
    return false
  }
  const stagingUris: string[] = []
  for (const bucket of [staged.logo, staged.character, staged.product]) {
    if (!Array.isArray(bucket)) {
      continue
    }
    for (const ref of bucket) {
      if (ref && typeof ref.staging_uri === 'string') {
        stagingUris.push(ref.staging_uri)
      }
    }
  }
  return undescribed.every((asset) => stagingUris.some((uri) => uri.includes(asset.asset_id)))
}

function appendSilhouetteAcceptanceMarkers(
  conversationSummaryUpdate: string | undefined,
  assetIds: string[],
): string {
  const existing = conversationSummaryUpdate?.trim() ?? ''
  const markers = assetIds.map((assetId) => `${SILHOUETTE_INFERENCE_ACCEPTANCE_PREFIX}${assetId}`)
  return [existing, ...markers.filter((marker) => !existing.includes(marker))]
    .filter(Boolean)
    .join('\n')
}

function buildPolicyHintSignature(output: PlannerOutputLike): string {
  if (output.action === 'TOOL_CALLS') {
    const firstCall = output.tool_calls?.[0]
    const tool = firstCall?.tool ?? '<none>'
    const scope = firstCall?.params?.scope ?? '<none>'
    return `TOOL_CALLS:${tool}:${scope}`
  }
  return `${output.action}:<none>:<none>`
}

function getAcceptedSilhouetteAssetIds(session: SessionState): string[] {
  const conversationSummary = session.conversation_summary ?? ''
  return (session._loaded_asset_descriptions?.items ?? [])
    .filter((item) => item.quality?.identity_clarity === 'silhouette_only')
    .map((item) => item.asset_id)
    .filter((assetId) =>
      conversationSummary.includes(`${SILHOUETTE_INFERENCE_ACCEPTANCE_PREFIX}${assetId}`),
    )
}

function getLatestUserMessage(session: SessionState, fallbackMessage: string): string {
  for (let i = session.transcript.length - 1; i >= 0; i -= 1) {
    const message = session.transcript[i]
    if (message.role === 'user') {
      return message.content.trim()
    }
  }
  return fallbackMessage
}

function getUnacceptedIdentitySensitiveSilhouetteAssetIds(session: SessionState): string[] {
  if (
    !isIdentitySensitiveCharacterIntent(session) ||
    isExplicitlyDecorativeSilhouetteIntent(session)
  ) {
    return []
  }

  const conversationSummary = session.conversation_summary ?? ''
  return (session._loaded_asset_descriptions?.items ?? [])
    .filter(
      (item) =>
        item.quality?.identity_clarity === 'silhouette_only' &&
        (item.brand_asset_kind === 'character' || (item.entities?.characters?.length ?? 0) > 0),
    )
    .map((item) => item.asset_id)
    .filter(
      (assetId) =>
        !conversationSummary.includes(`${SILHOUETTE_INFERENCE_ACCEPTANCE_PREFIX}${assetId}`),
    )
}

function inferExplicitGlobalFields(latestUserMessage: string): string[] {
  const fields = new Set<string>()
  for (const [field, pattern] of EXPLICIT_GLOBAL_FIELD_PATTERNS) {
    if (pattern.test(latestUserMessage)) {
      fields.add(field)
    }
  }
  return [...fields]
}

function isExplicitlyDecorativeSilhouetteIntent(session: SessionState): boolean {
  const latestUserMessage = getLatestUserMessage(session, '')
  return /\b(anonymous|decorative|background silhouettes?|identity (?:does not|doesn't) matter|no persistent identity)\b/i.test(
    latestUserMessage,
  )
}

function isIdentitySensitiveCharacterIntent(session: SessionState): boolean {
  const constraints = session.spec.global_constraints
  const text = normalizeText(
    [
      ...session.transcript.map((message) => message.content),
      session.cached_artifacts.working_script?.script,
      constraints.topic,
      constraints.video_type,
      constraints.brand_scope,
      ...(constraints.directives ?? []),
      ...(constraints.key_entities ?? []),
      ...(constraints.must_not_violate ?? []),
      ...session.spec.visual_script.shots.flatMap((shot) => [
        shot.audio_vo,
        shot.visual_primary.core_description,
      ]),
    ]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .join('\n'),
  )

  const hasPersistentRole =
    /\b(actor|character|host|presenter|identity|misrepresent|recurring|same person|same character)\b/.test(
      text,
    )
  const hasRelationalOrSpatialRole =
    /\b(wife|husband|spouse|marriage|married|couple|partner|mother|father|parent|brother|sister|host left|host right|left host|right host)\b/.test(
      text,
    )
  return hasPersistentRole && hasRelationalOrSpatialRole
}

function latestUserAcceptedSilhouetteInference(session: SessionState): boolean {
  const latestUserMessage = normalizeText(getLatestUserMessage(session, ''))
  return (
    latestUserMessage.includes('continue with inferred appearance') ||
    latestUserMessage.includes('continue with inference')
  )
}

function startsAnchorGeneration(output: PlannerOutputLike): boolean {
  return (
    output.action === 'TOOL_CALLS' &&
    (output.tool_calls ?? []).some((toolCall) => toolCall.tool === 'generate_anchor_assets')
  )
}

// Single source of truth for the brand-setup op set: consumed by the
// undescribed-asset guard exemption above AND handlePatchAction's
// forceContinue chaining (planner-actions.ts). The two MUST agree -- if they
// drift, a brand-setup PATCH can pass one gate but not the other and the
// turn half-deadlocks.
export function isBrandSetupOnlyPatch(ops: PlannerOutputLike['ops']): boolean {
  if (!ops || ops.length === 0) {
    return false
  }
  return ops.every(
    (op) =>
      op.op === 'set_brand_extraction_input' ||
      op.op === 'apply_brand_carry' ||
      (op.op === 'update_global_field' && op.path === 'brand_video_type'),
  )
}

// brand_review chat-edit ops (Tier 1 bank edits + the source
// redirect). Kept separate from isBrandSetupOnlyPatch on purpose: that set
// also drives handlePatchAction's forceContinue chaining, and review edits
// must NOT inherit that behavior -- they only share the undescribed-asset
// guard exemption above.
function isBrandReviewEditOnlyPatch(ops: PlannerOutputLike['ops']): boolean {
  if (!ops || ops.length === 0) {
    return false
  }
  return ops.every(
    (op) => op.op === 'update_brand_bank_field' || op.op === 'change_brand_extraction_source',
  )
}

function matchesAny(patterns: RegExp[], value: string): boolean {
  return patterns.some((pattern) => pattern.test(value))
}
