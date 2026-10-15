// Do NOT import from workflow.ts
//
// UIP V2 -- foldSession: the activity-side projection that reconstructs a V1
// SessionState from the V2 AgentEvent[] log. This module runs ONLY on the
// activity (Node) side, so VALUE imports from `@reelmakeeasy/uip-planner-runtime` are
// allowed and expected -- we reuse the V1 reasoning kernel (applyPatch, the
// tool-artifact mappers, the empty-spec builder) rather than reimplementing
// spec mutation. Keep it out of workflow files (workflows/uip-v2/workflow.ts,
// phase-machine.ts, etc.): value imports of the planner runtime would drag
// runtime code into workflow modules, which are kept light.
//
// This file implements the STRUCTURAL projection (Task 2.1, applyStructuralEvent)
// plus the FINISHING projection (Task 2.2: word-cap audit, validation, deadline
// stamping, review_gate, todo_state items, conversation_summary), which runs in
// the load-bearing order at the end of foldSession (mirrors V1
// syncPostSpecMutation).

import { createSubLogger } from '@reelmakeeasy/common/logger'
import type {
  CachedArtifacts,
  ExecutionFailureStage,
  PatchOp,
  PlannerTodoItem,
  PlannerTodoState,
  RecoveryErrorCode,
  ReviewGate,
  Spec,
  SpecHistoryEntry,
  SpecHistorySource,
} from '@reelmakeeasy/uip-planner-runtime'
import {
  applyPatch,
  buildAutoApplyOpsForTool,
  buildEmptySpec,
  describeSourceDelta,
  getAllowedUploadedAssetIds,
  getUipMusicTrackIneligibilityReason,
  validateSpec,
  WORKING_SCRIPT_SOURCE_PATH,
} from '@reelmakeeasy/uip-planner-runtime'
// Deep imports: these V1 finishing helpers are NOT in the barrel. They run on
// the activity (Node) side only -- never imported by any workflow file.
import { applyValidation } from '@reelmakeeasy/uip-planner-runtime/runtime/spec-runtime'
import { writeScriptWordCapAudit } from '@reelmakeeasy/uip-planner-runtime/tool-internals/script-word-cap-audit'

// Phase-1 leaf folds are pure (zero V1 value imports); the activity is allowed
// to reuse them. Do NOT import phase-machine.ts or workflow.ts from here.
import { latestCompactionCheckpoint } from '../../workflows/uip-v2/compaction'
import {
  foldAutoContinueEnabled,
  foldDeadline,
  foldPhase,
  isAgentTurnBusy,
  latestArticleExtraction,
  toolSucceeded,
} from '../../workflows/uip-v2/folds'
import { latestUrlClassification, urlRouteExhausted } from '../../workflows/uip-v2/folds-url-route'
import type { AgentEvent, ArtifactSlot } from '../../workflows/uip-v2/types'

import type { AnchorVsBatchOutput } from './tools/anchor-vs-batch'
import { isBrandExtractionPatch, stableStringify } from './brand-brief-edit'
import { directiveClosedInLog } from './directive-status'
import {
  applyStaleDispositions,
  foldGuiScriptLedger,
  foldPatchLedger,
  foldToolArtifactLedger,
  foldToolCompletedLedger,
  safeLedgerUpdate,
} from './session-state-consistency'
import { stageToolArtifact } from './session-state-staging'
import { updateToolCallState } from './session-state-tool-status'
import type { FoldedSessionState } from './session-state-types'
import type { SessionCheckpoint } from './spec-checkpoint'
import {
  buildStartedToolCallState,
  clearToolSubTools,
  foldToolSubstep,
} from './tool-substep-inventory'

const logger = createSubLogger('uip-v2-fold-session')

const MAX_SPEC_HISTORY = 30

/**
 * Tools that have an auto_apply mapper in `buildAutoApplyOpsForTool`. Only these
 * are routed through the mapper in `applyToolOutput`. `event.toolName` is typed
 * `string`, so a renamed/future/unknown tool in a replayed log would otherwise
 * reach `getToolManifest(tool)` (a bare record lookup returning `undefined`) and
 * throw on `manifest.auto_apply?.enabled`, bricking the projection -- contrary
 * to this module's no-throw-on-bad-history posture (Decision 4). Unknown tools
 * are skipped instead. describe_uploaded_images and generate_anchor_assets have
 * no mapper, so they only STAGE into cached_artifacts (/ _loaded_asset_descriptions)
 * in the switch above and correctly hit the skip path here (no applyPatch).
 */
const AUTO_APPLY_TOOLS = new Set<string>([
  'generate_explainer_script',
  'generate_explainer_visual_script',
  'generate_intent_context',
  'plan_asset_assignment',
  'select_auto_style',
])

/**
 * Decision 2: foldSession returns a V1 SessionState plus the V2 workflow
 * terminal flags. Matches the V1 `WorkflowSessionState` / persist input shape.
 */
export type { FoldedSessionState } from './session-state-types'

/** Deep clone of a Spec (Node 18+ structuredClone). */
export function structuredCloneSpec(spec: Spec): Spec {
  return structuredClone(spec)
}

/**
 * Project a `tool_failed` event: mark the tool-call state failed, record a
 * recovery_failure (feeds the planner's recovery context), and stage any partial
 * artifact the tool produced before failing.
 *
 * Partial-artifact staging is ONLY for non-auto_apply tools (anchor / describe),
 * which stage purely into cached_artifacts with no spec mutation. Auto_apply
 * tools (vs / script / intent / plan_asset) fail-fast BEFORE staging, so their
 * failed output is empty-but-present (e.g. `{ shots: [] }`); staging it would run
 * the auto_apply mapper on empty content and could WIPE the spec. Skip them.
 */
function applyToolFailed(
  state: FoldedSessionState,
  event: Extract<AgentEvent, { type: 'tool_failed' }>,
): void {
  updateToolCallState(state, event.toolCallId, 'failed', event.failedAt, event.errorMessage)
  state.cached_artifacts.recovery_failures ??= []
  state.cached_artifacts.recovery_failures.push({
    error_code: event.errorCode as RecoveryErrorCode,
    failure_stage: 'tool_runtime',
    message: event.errorMessage,
    retryable: event.retryable,
    timestamp: event.failedAt,
  })
  if (event.output !== undefined && !AUTO_APPLY_TOOLS.has(event.toolName)) {
    applyToolOutput(state, event.toolName, event.output, event.failedAt)
  }
}

/**
 * Decision 3: stage a tool's produced artifact into the matching
 * `cached_artifacts` slot, then apply it to the spec by reusing the V1 mapper
 * (`buildAutoApplyOpsForTool`) + `applyPatch`.
 *
 * We deliberately do NOT call V1 `applyToolArtifactsToSpec` here: that helper
 * is async and persists the spec to storage (`persistSpecSnapshot`) as a side
 * effect, which is wrong for a pure replay-side projection. Instead we
 * replicate its core (stage -> build ops -> applyPatch) without persistence.
 *
 * Tools with auto_apply mappers wired here: generate_intent_context and
 * select_auto_style (both global_constraints -- see stageIntentContextArtifact),
 * generate_explainer_script (script -> working_script;
 * the script mapper only emits ops once a visual_script exists, matching V1),
 * generate_explainer_visual_script (visual_script), plan_asset_assignment
 * (asset_assignment_plan). describe_uploaded_images and generate_anchor_assets
 * have no auto_apply mapper -- their outputs are STAGED only (descriptions into
 * _loaded_asset_descriptions; anchor_plan / anchor_assets_summary into
 * cached_artifacts) and the deeper spec reconciliation is driven later by the
 * script / visual-script tools (V1 parity).
 */
export function applyToolOutput(
  state: FoldedSessionState,
  toolName: string,
  output: unknown,
  completedAt: string,
): void {
  state.cached_artifacts ??= emptyCachedArtifacts()

  // Batch unpack: recursively apply each sub-tool's output via the existing
  // per-tool paths so staging and auto_apply (visual_script_to_ops for vs) both
  // run correctly without duplicating any logic.
  if (toolName === 'anchor_vs_batch') {
    const batch = output as AnchorVsBatchOutput
    // Stage anchor artifacts whenever the activity returned them -- V1 keeps the
    // partial anchor plan/summary on the session even when the anchor tool
    // returns ok:false (e.g. a partial image-generation failure in
    // bootstrap_visual, where the VS shots that reference the plan are still
    // applied). The failure is surfaced separately via getLastActionResult.
    const anchorArtifacts = (batch?.anchor as { artifacts?: unknown })?.artifacts
    if (anchorArtifacts !== undefined) {
      applyToolOutput(state, 'generate_anchor_assets', anchorArtifacts, completedAt)
    }
    if (batch?.vs?.ok) {
      applyToolOutput(
        state,
        'generate_explainer_visual_script',
        (batch.vs as { artifacts: unknown }).artifacts,
        completedAt,
      )
    }
    return
  }

  stageToolArtifact(state, toolName, output)

  // generate_anchor_assets has no auto_apply mapper, but a REMOVE_ANCHOR
  // refinement emits deterministic remove_preselected_asset cleanup ops to strip
  // removed anchors from shots (V1 parity:
  // maybeApplyDeterministicAnchorRemovalCleanup, which V1 runs in the
  // planner-actions layer -- outside the raw tool V2 reuses). The activity
  // computed them against the pre-tool committed shots; apply them to the spec.
  if (toolName === 'generate_anchor_assets') {
    const cleanupOps = (output as { cleanup_ops?: PatchOp[] }).cleanup_ops
    if (cleanupOps && cleanupOps.length > 0) {
      applyOpsToSpec(state, cleanupOps, 'TOOL_ARTIFACT', completedAt, toolName)
    }
  }

  // Only known auto_apply tools go through the mapper. Unknown tools (renamed /
  // future / not yet mapped) are skipped rather than thrown on, so a single
  // unknown tool in a replayed log never bricks the projection (Decision 4).
  if (!AUTO_APPLY_TOOLS.has(toolName)) {
    return
  }

  // Apply the staged artifact to the spec via the V1 mapper (auto_apply tools
  // only). buildAutoApplyOpsForTool returns [] for tools without a mapper.
  const ops = buildAutoApplyOpsForTool(
    state,
    toolName as Parameters<typeof buildAutoApplyOpsForTool>[1],
  )
  if (ops.length > 0) {
    applyOpsToSpec(state, ops, 'TOOL_ARTIFACT', completedAt, toolName)
  }

  // The global_constraints these two tools stage have now been absorbed into the
  // spec (or already equalled it), so the staged copy has served its purpose --
  // drop it. V1's clearAppliedPendingArtifacts (spec-runtime.ts) clears the slot
  // right after applyPatch for exactly this reason; the V2 fold never did, so the
  // snapshot lived for the whole session. Left set, it shadows the spec in every
  // `pending_global_constraints ?? spec.global_constraints` projection
  // (message-runtime.ts, the /status publisher's source). A later patch-only
  // pacing/style edit lands on the spec via spec_patched -- never through this
  // artifact -- so pending stays frozen at the pre-edit value and the live
  // /status publisher disagrees with the /persist publisher (which reads the raw
  // spec) for the rest of the turn; the client folds the two in order and the
  // video_brief_card oscillates old/new/old. Clearing also collapses the
  // provenance-less pending a generate_intent_context re-run leaves behind after a
  // committed style pick. Either way both publishers then read the spec and agree.
  // Cleared AFTER apply so the mapper above still sees the artifact; scoped to the
  // two constraints-staging tools so unrelated pending_* artifacts are untouched.
  if (toolName === 'generate_intent_context' || toolName === 'select_auto_style') {
    state.cached_artifacts.pending_global_constraints = undefined
  }
}

/**
 * Merge a user_message's uploaded assets into cached_artifacts.uploaded_assets,
 * accumulating across messages and deduping by asset_id (last write wins so a
 * re-upload of the same id replaces the prior entry). No-op when the event
 * carries no uploads.
 */
function mergeUploadedAssets(
  state: FoldedSessionState,
  incoming: CachedArtifacts['uploaded_assets'],
): void {
  if (!incoming || incoming.length === 0) {
    return
  }
  const byId = new Map((state.cached_artifacts.uploaded_assets ?? []).map((a) => [a.asset_id, a]))
  for (const asset of incoming) {
    byId.set(asset.asset_id, asset)
  }
  state.cached_artifacts.uploaded_assets = [...byId.values()]
}

/**
 * Passively merge a partial global_constraints edit (topic / directives /
 * must_not_violate summary-artifact fields) onto the spec. Shared by
 * user_gui_update and user_script_review_update -- both are live edits folded
 * directly, no PatchOp. No-op when the event carries no globalConstraints.
 */
function mergeGlobalConstraints(
  state: FoldedSessionState,
  globalConstraints: Partial<Spec['global_constraints']> | undefined,
): void {
  if (!globalConstraints) {
    return
  }
  state.spec.global_constraints = {
    ...state.spec.global_constraints,
    ...globalConstraints,
  }
}

/**
 * foldSession -- reconstruct a V1 SessionState from the V2 AgentEvent[] log.
 *
 * Replays the structural events (applyStructuralEvent) and then runs the
 * finishing projection (word-cap audit, validation, deadline, review_gate,
 * todo_state, conversation_summary) in V1's load-bearing order.
 */
export function foldSession(
  events: AgentEvent[],
  currentArtifacts: Record<string, ArtifactSlot>,
  // Session snapshot flushed at the latest compaction boundary
  // (resolved by resolveSpecCheckpoint from the immutable spec/versions/v{N}
  // files). When present, the base spec AND cached_artifacts are reset to it at
  // that boundary so post-continueAsNew folds don't silently revert state whose
  // source events were truncated. Absent (undefined/null) -> legacy
  // behavior: replay all events onto the creation-time initialSpecSnapshot.
  checkpoint?: null | SessionCheckpoint,
): FoldedSessionState {
  const initEvent = events.find((e) => e.type === 'session_initialized')
  const state = buildBaseState(initEvent)

  // Fold every structural event into `state`, applying the checkpoint
  // reset at the compaction boundary and returning the brand brief-edit count
  // (extracted to keep foldSession under the complexity cap).
  const briefEditCount = foldStructuralEvents(state, events, checkpoint ?? null)

  // -- Finishing projection (Task 2.2) -------------------------------------
  // Load-bearing order, mirrors V1 syncPostSpecMutation (Decision 5):
  //   spec done -> word-cap audit -> validation -> deadline stamping.
  // validateSpec + word-cap both depend on the final spec; foldDeadline depends
  // on word-cap (over-cap pauses the countdown). All run on the activity side.

  // (1) is_processing: true while the agent is mid-turn, derived purely from the
  //     planner event sequence (isAgentTurnBusy): planner LLM call in flight, or
  //     the latest decision was TOOL_CALLS (a tool runs and the planner re-wakes
  //     after it). This spans the whole turn -- planner -> tool -> follow-up
  //     planner -- with no point-in-time gap, so the script-review gate never
  //     flashes visible between planner_decided and tool_started (nor between
  //     tool_completed and the next planner_start). The FE gates the CTA on this.
  state.is_processing = isAgentTurnBusy(events)

  // (1b) is_running_planner_loop: the FE gates the "queued message" affordance on
  //      this flag (a `sending` inbox record renders as queued only while it is
  //      true; otherwise as a normal transcript message). V1 sets it for the whole
  //      planner turn; mirror that here with the same busy condition so messages
  //      sent while a tool/planner is in flight surface as queued (V1 parity).
  state.is_running_planner_loop = state.is_processing

  // (2) script_word_cap: re-audit and stamp spec.meta.script_word_cap (audio
  //     mode / no-script -> null; long_video -> cap 1700). Wrapped defensively:
  //     a malformed spec must not brick the projection (no-throw posture).
  try {
    writeScriptWordCapAudit(state)
  } catch (error) {
    logger.warn(`[foldSession] writeScriptWordCapAudit skipped: ${errMsg(error)}`)
  }

  // (3) validateSpec -> applyValidation: recompute meta.open_questions +
  //     meta.blocking from the final spec (load-bearing: the planner loop and
  //     contract check gate on these). Phase suppresses visual-only questions.
  try {
    applyValidation(state.spec.meta, validateSpec(state.spec), [], state.todo_state.phase)
  } catch (error) {
    logger.warn(`[foldSession] applyValidation skipped: ${errMsg(error)}`)
  }

  // (4a) Auto-continue setting. Projected so the API-side deadline
  //      writers (send-message / transcript-editing), which read the persisted
  //      state, skip re-arming a countdown the workflow will never fire.
  state.auto_continue_enabled = foldAutoContinueEnabled(events)

  // (4a.1 / 4a.2) Article + pasted-URL router grounding.
  projectBootstrapGrounding(state, events)

  // (4) Deadline pure projection. foldDeadline returns null outside review/
  //     refinement, when a pending deadline_expired is queued, or when the word
  //     cap is exceeded (so the countdown clears automatically). It also returns
  //     null for the whole session when auto-continue is off.
  const deadlineMs = foldDeadline(events, currentArtifacts)
  const phase = foldPhase(events)
  if (phase === 'script_review') {
    state.review_auto_continue_deadline_at = deadlineMs ? new Date(deadlineMs).toISOString() : null
  } else if (phase === 'refinement') {
    state.spec.meta.auto_lock_deadline_at = deadlineMs ? new Date(deadlineMs).toISOString() : null
  }

  // (5) review_gate: latest review_gate_opened, null once consumed.
  state.review_gate = deriveReviewGate(events)

  // (6) todo_state: plan (planner intent) + computed item statuses. t* stages
  //     are artifact-driven facts; d* directives are planner-closed judgments.
  state.todo_state = foldTodoState(events, state)

  // (7) conversation_summary: last planner_decided.conversation_summary_update.
  state.conversation_summary = foldConversationSummary(events)

  // (8) can_undo is NOT a SessionState field -- it lives on SessionResponse
  //     (types.ts:1052) and is derived in V1 buildResponse from
  //     spec_history.length > 0. Nothing to stamp here; the projected
  //     spec_history already drives it downstream.

  // (9) updated_at: timestamp of the last event (falls back to existing value
  //     for an empty/timestamp-less tail).
  const lastEvent = events[events.length - 1]
  if (lastEvent?.timestamp) {
    state.updated_at = lastEvent.timestamp
  }

  // (10) brand_telemetry.brief_edit_count: number of brand_bank-changing patches
  //      (computed during the replay above) for the brand_brief_modified
  //      telemetry on uipContentModified.
  state.brand_telemetry = {
    ...state.brand_telemetry,
    brief_edit_count: briefEditCount,
  }

  return state
}

/**
 * Project the grounding facts onto the session bootstrap. Extracted
 * from foldSession for the cognitive-complexity budget.
 *
 * (4a.1) Article context (news-article-to-video door). Only a completed run
 *        with an article projects; failed runs leave the field absent so
 *        step-3 consumers treat the session as ungrounded.
 * (4a.2) Pasted-URL router verdict (entrance pivot). The mode-confirmation
 *        prompt renders the 2-option routing question while the verdict sits
 *        below the confidence floor. NOT projected once the re-classification
 *        budget is spent on a still-uncertain verdict (urlRouteExhausted):
 *        the classifier can never run again, so rendering the question would
 *        ask the user forever with no path to progress -- the session falls
 *        back to today's behavior instead (brand auto-start unblocks in
 *        parallel, see urlRouteBlocksBrandAutoStart).
 */
function projectBootstrapGrounding(state: FoldedSessionState, events: AgentEvent[]): void {
  const articleEvt = latestArticleExtraction(events)
  if (articleEvt?.result.outcome === 'completed' && articleEvt.result.article) {
    state.bootstrap.article_context = articleEvt.result.article
  }
  const urlRouteEvt = latestUrlClassification(events)
  if (urlRouteEvt && !urlRouteExhausted(events)) {
    state.bootstrap.url_route = {
      classification: urlRouteEvt.classification,
      confidence: urlRouteEvt.confidence,
      url: urlRouteEvt.url,
    }
  }
}

/**
 * Project an `assistant_message` event into its transcript row.
 *
 * Mirrors V1 handleClarifyAndExit: an ASK_CLARIFY carries a mirror `reply`
 * (event.content) plus a separate `reply_question`; the transcript stores the
 * COMBINED text and a question_index marking where the question starts, and
 * surfaces `options` (clickable chips) + `expect_assets`. Dropping these (as the
 * original projection did) renders a plain message with no question and no chips
 * -- the UI clarify card never appears and mode_confirmation loops (the planner
 * re-asks every turn).
 *
 * Split out of applyStructuralEvent's switch to keep that function inside the
 * cognitive-complexity budget.
 */
function buildAssistantTranscriptMessage(
  event: Extract<AgentEvent, { type: 'assistant_message' }>,
): FoldedSessionState['transcript'][number] {
  return {
    content: event.replyQuestion ? `${event.content} ${event.replyQuestion}` : event.content,
    message_id: event.messageId,
    phase: event.phase,
    role: 'assistant',
    spec_version: event.specVersion,
    timestamp: event.timestamp,
    ...(event.options ? { options: event.options } : {}),
    ...(event.expectAssets ? { expect_assets: true } : {}),
    ...(event.replyQuestion ? { question_index: event.content.length + 1 } : {}),
    // Carries the (turn_id, content) dedup key the API merge reads; see
    // AssistantMessageEvent.turnId. Only fixed-copy runtime messages set it.
    ...(event.turnId ? { turn_id: event.turnId } : {}),
  }
}

function buildPastedScriptDurationState(event: Extract<AgentEvent, { type: 'mode_confirmed' }>) {
  return {
    ...(event.durationSource === undefined ? {} : { duration_source: event.durationSource }),
    ...(event.pastedScriptFit === undefined ? {} : { pasted_script_fit: event.pastedScriptFit }),
    ...(event.verifiedPastedScript ? { verified_pasted_script: event.verifiedPastedScript } : {}),
  }
}

/**
 * Apply a single structural event's mutation to the in-progress projected state.
 * Extracted from foldSession so the keystone projection stays within the
 * cognitive-complexity budget; the switch only mutates `state` and never reads
 * back across events. Passive events (todo_updated / review_gate_opened /
 * planner_decided / brand_* / compaction / user_activity etc.) are folded by the
 * dedicated finishing-projection helpers, not here.
 */
/**
 * A manual script edit: write the script, then mark what it invalidated.
 *
 * Shared by BOTH doors onto this one artifact mutation --
 * `user_gui_update.transcript` (new protocol) and
 * `user_script_review_update.script` (pre-inbox sessions, still draining).
 * `updateScriptReview` picks between them on the session's protocol version, so
 * hooking only one leaves the defect live for every session on the other.
 *
 * The ledger mark exists because a script edit emits no `spec_patched` and no
 * `PatchOp`, so without a hook here it is invisible to the ledger and the brief
 * keeps describing the old subject however many times the planner wakes.
 * Guarded on the VALUE changing: the API sends the field whenever it
 * is present, and marking from an unchanged one manufactures staleness out of a
 * no-op.
 *
 * Also extracted so `applyStructuralEvent` stays inside the repo's
 * cognitive-complexity cap.
 */
function applyScriptEdit(
  state: FoldedSessionState,
  nextScript: string | undefined,
  timestamp: string,
): void {
  if (nextScript === undefined) {
    return
  }
  const previousScript = state.cached_artifacts.working_script?.script
  // Accumulate against the baseline the outstanding entry was raised from, so a
  // later cosmetic edit cannot erase an earlier semantic one (the ledger upserts
  // by artifact + source_path). With no entry outstanding the baseline resets --
  // that is how it is cleared, without needing a hook in the discharge path.
  const entryOutstanding = (state.spec.meta.stale_artifacts ?? []).some(
    (entry) => entry.source_path === WORKING_SCRIPT_SOURCE_PATH && entry.dismissed_at == null,
  )
  const baseline = entryOutstanding
    ? (state.cached_artifacts.working_script?.stale_baseline ?? previousScript)
    : previousScript
  state.cached_artifacts.working_script = {
    ...(state.cached_artifacts.working_script ?? {
      scope: { scope: 'FULL' },
      shot_edits: [],
    }),
    script: nextScript,
    ...(baseline === undefined ? {} : { stale_baseline: baseline }),
  }
  if (nextScript === previousScript) {
    return
  }
  // The entry records what THIS edit changed, not just how the script
  // now reads. Without it a synonym swap and a rewrite are indistinguishable to
  // the planner, which then re-audits the whole artifact and volunteers fixes for
  // gaps that predate the edit.
  const sourceChange = describeSourceDelta(baseline, nextScript)
  state.spec.meta.stale_artifacts = safeLedgerUpdate(
    'foldGuiScriptLedger',
    state.spec.meta.stale_artifacts,
    () => foldGuiScriptLedger(state, timestamp, sourceChange),
  )
}

/**
 * `allEvents` is the raw log the caller is folding. Only the scope-aware
 * consistency clear needs it: `tool_completed` carries no invocation
 * params, so they must be joined back from the matching `tool_started`.
 */
function applyStructuralEvent(
  state: FoldedSessionState,
  event: AgentEvent,
  allEvents: AgentEvent[],
): void {
  switch (event.type) {
    case 'assistant_message': {
      state.transcript.push(buildAssistantTranscriptMessage(event))
      break
    }

    case 'mode_confirmed': {
      // MODE_CONFIRMED flips the planner into the post_confirmation chain
      // segment (load-bearing). Stamp mode/duration/input_type + confirmed.
      // input_type is sticky once classified (V1 `applyAgentMemory` parity):
      // the pre-seeded song-to-video 'audio_music' declaration and any earlier
      // MODE_CONFIRMED classification win over later re-emissions. `||` (not
      // `??`) so an event that omitted input_type (captured as '') neither
      // sticks nor clears an earlier value; absent stays null.
      state.spec.meta.mode_state = {
        ...state.spec.meta.mode_state,
        mode: event.mode as Spec['meta']['mode_state']['mode'],
        confirmed: true,
        // MODE_CONFIRMED keeps the current value when it carries none (audio:
        // durationSec null -> keep the ASR length).
        duration_seconds: event.durationSec ?? state.spec.meta.mode_state.duration_seconds,
        ...buildPastedScriptDurationState(event),
        input_type:
          state.spec.meta.mode_state.input_type ||
          (event.inputType as Spec['meta']['mode_state']['input_type']) ||
          null,
      }
      // Promote the planner's eligible audio_music classification into
      // is_music (V1 parity). Deliberately NOT isUipMusicTrackEligible: that
      // helper now also fires on the content-detected `audio_is_music` flag,
      // and promoting a detector verdict into the entry-point
      // preset field would corrupt musicSignalSource attribution ('preset'
      // instead of 'content_detector') and the prompt-route reasoning.
      state.spec.meta.is_music ||=
        state.spec.meta.mode_state.input_type === 'audio_music' &&
        getUipMusicTrackIneligibilityReason(state.spec) === null
      break
    }

    case 'music_beat_sheet': {
      // Project the music beat-sheet readiness flag so the VS tool can
      // branch (ready -> read beat_sheet.json from storage; unavailable -> ASR-timing
      // fallback) instead of polling the artifact. The beat sheet body itself
      // stays in storage -- only the status is folded.
      state.spec.meta.music_beat_sheet_status = event.status
      break
    }

    case 'phase_changed': {
      state.todo_state.phase = event.toPhase
      break
    }

    case 'planner_decided': {
      // Fold the planner's dismissals back onto the
      // ledger. PlannerDecidedEvent has no own `timestamp` (it relies on
      // BaseEvent.at, see the field comment above), so derive an ISO
      // timestamp from `at` for the dismissed_at stamp.
      //
      // Only touch the field when a ledger already exists. A dismissal can
      // only affect an entry that is already in the ledger -- applying it to
      // an empty/absent one is a no-op -- so gating on definedness here is
      // exactly "only assign when there is actually something to assign".
      // Without this gate, a session with no ledger (stale_artifacts is
      // undefined) would get [] materialized on every planner_decided, which
      // the API's /status publish path (specStaleArtifactsToEventField)
      // would then read as "the ledger just emptied" and publish a false
      // clear over whatever the /persist path already published.
      if (state.spec.meta.stale_artifacts !== undefined) {
        state.spec.meta.stale_artifacts = safeLedgerUpdate(
          'applyStaleDispositions',
          state.spec.meta.stale_artifacts,
          () =>
            applyStaleDispositions(
              state.spec.meta.stale_artifacts ?? [],
              event.decision?.stale_dispositions,
              event.timestamp ?? new Date(event.at).toISOString(),
            ),
        )
      }
      break
    }

    case 'pre_voiceover_artifacts_ready': {
      state.audioPath = event.voiceOverPath
      state.voice_over_artifacts_ready = true
      break
    }

    case 'recovery_failure': {
      state.cached_artifacts.recovery_failures ??= []
      state.cached_artifacts.recovery_failures.push({
        error_code: event.errorCode as RecoveryErrorCode,
        failure_stage: event.failureStage as ExecutionFailureStage,
        message: event.message,
        retryable: event.retryable,
        timestamp: event.timestamp,
      })
      break
    }

    case 'session_cancelled': {
      state._cancelled = true
      state._cancelled_at = event.cancelledAt
      break
    }

    case 'session_failed': {
      state._failed = true
      state._failure_message = event.failureMessage
      break
    }

    case 'session_initialized': {
      // Base state already built from this event above.
      break
    }

    case 'session_locked': {
      state.spec.meta.locked_at = event.lockedAt
      state.spec.meta.auto_lock_deadline_at = null
      break
    }

    case 'session_timed_out': {
      state._timed_out = true
      break
    }

    case 'spec_patched': {
      const prevSpec = structuredCloneSpec(state.spec)
      // Thread the folded phase so phase-gated brand ops (update_brand_bank_field,
      // remove_brand_asset, mode-gated set_brand_video_type) replay during
      // projection exactly as the write path applied them (brand.ts passes the
      // same context). Without it the gate sees phase=undefined, applyPatch is
      // atomic, and the entire spec_patched -- including a bundled lock_brand_bank
      // -- is dropped from the spec the FE and planner read.
      const res = applyPatch(
        state.spec,
        {
          // Thread the uploaded-asset allowlist (same as the write path) so an
          // add_preselected_asset for a source=user_upload asset re-applies
          // here instead of being rejected ("not in uploaded_assets
          // allowlist") and dropping the whole spec_patched on projection. The
          // user_message carrying the upload was folded earlier in this loop,
          // so cached_artifacts.uploaded_assets is already populated.
          allowed_user_upload_asset_ids: getAllowedUploadedAssetIds(state),
          base_version: state.spec.meta.spec_version,
          diff_summary: '',
          ops: event.ops,
        },
        { phase: state.todo_state.phase, transitionVideoModel: state.transitionVideoModel },
      )
      if (res.error) {
        // A bad historical op must not brick projection (Decision 4).
        logger.warn(`[foldSession] spec_patched op skipped: ${res.error} (source=${event.source})`)
        break
      }
      state.spec = res.spec
      pushSpecHistoryEntry(state, {
        diff_summary: '',
        ops: event.ops,
        prev_spec: prevSpec,
        source: mapPatchSourceToHistorySource(event.source),
        timestamp: event.timestamp,
      })
      // Clear then mark; see foldPatchLedger for why the order matters.
      state.spec.meta.stale_artifacts = safeLedgerUpdate(
        'foldPatchLedger',
        state.spec.meta.stale_artifacts,
        () =>
          foldPatchLedger({
            ops: event.ops,
            prevSpec,
            session: state,
            stableStringify,
            timestamp: event.timestamp,
          }),
      )
      break
    }

    case 'tool_cancelled': {
      updateToolCallState(state, event.toolCallId, 'failed', event.cancelledAt, 'cancelled')
      break
    }

    case 'tool_completed': {
      updateToolCallState(state, event.toolCallId, 'succeeded', event.completedAt)
      clearToolSubTools(state.tool_call_states, event.toolCallId)
      applyToolOutput(state, event.toolName, event.output, event.completedAt)
      // Keyed on the OUTER tool name; see foldToolCompletedLedger.
      state.spec.meta.stale_artifacts = safeLedgerUpdate(
        'foldToolCompletedLedger',
        state.spec.meta.stale_artifacts,
        () =>
          foldToolCompletedLedger(
            state.spec,
            allEvents,
            event.toolCallId,
            event.toolName,
            event.output,
          ),
      )
      break
    }

    case 'tool_failed': {
      applyToolFailed(state, event)
      break
    }

    case 'tool_started': {
      state.tool_call_states ??= []
      state.tool_call_states.push(buildStartedToolCallState(event))
      state.is_processing = true
      break
    }

    case 'tool_substep': {
      foldToolSubstep(state.tool_call_states, event)
      break
    }

    case 'user_gui_update': {
      applyScriptEdit(state, event.transcript, event.timestamp)
      // Summary artifact field edits.
      mergeGlobalConstraints(state, event.globalConstraints)
      break
    }

    case 'user_message': {
      state.transcript.push({
        content: event.message,
        message_id: event.messageId,
        role: 'user',
        sent_from: event.sentFrom,
        timestamp: event.timestamp,
      })
      // Uploads ride on the user_message event (workflow init + user_messages
      // signal). Lift them into the cached_artifacts.uploaded_assets slot so the
      // bootstrap recipe adds t0_assets and describe_uploaded_images runs --
      // otherwise the upload is staged in storage but invisible to the planner.
      mergeUploadedAssets(state, event.uploadedAssets)
      break
    }

    case 'user_script_review_update': {
      applyScriptEdit(state, event.script, event.timestamp)
      mergeGlobalConstraints(state, event.globalConstraints)
      break
    }

    case 'user_transition_video_model_changed': {
      state.transitionVideoModel = event.transitionVideoModel
      break
    }

    case 'working_script_seeded': {
      state.cached_artifacts.working_script = {
        scope: { scope: 'FULL' },
        script: event.scriptText,
        shot_edits: [],
      }
      state.spec.meta.audio_source = 'user_audio'
      state.voice_over_ready = true
      if (event.audioDurationSeconds) {
        state.spec.meta.mode_state.duration_seconds = Math.round(event.audioDurationSeconds)
      }
      break
    }

    case 'working_script_updated': {
      state.cached_artifacts.working_script = {
        ...(state.cached_artifacts.working_script ?? {
          scope: { scope: 'FULL' },
          shot_edits: [],
        }),
        script: event.script,
      }
      break
    }

    // Passive in the structural loop. todo_updated / review_gate_opened /
    // planner_decided are folded by dedicated event-replay helpers in the
    // finishing projection below (foldTodoState / deriveReviewGate /
    // foldConversationSummary) rather than mutated here, so the projection is
    // order-independent and re-derivable. brand_*, compaction,
    // pre_voiceover_script_ready, user_activity are pure control events with
    // no SessionState effect here (deadline is a pure foldDeadline projection).
    default: {
      break
    }
  }
}

// ---------------------------------------------------------------------------
// Finishing-projection helpers (Task 2.2)
// ---------------------------------------------------------------------------

/**
 * Last `planner_decided.decision.conversation_summary_update`, or '' if none.
 * Only the mode_confirmation / Gemini-fallback segment needs this; the
 * post-confirmation chain carries its own transcript (V1 parity).
 */
export function foldConversationSummary(events: AgentEvent[]): string {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (e.type === 'planner_decided') {
      const summary = e.decision?.conversation_summary_update
      if (typeof summary === 'string') {
        return summary
      }
    }
  }
  return ''
}

/**
 * Project the review_gate from the log: the last review_gate_opened, unless a
 * later consuming signal cleared it -- user_continue_draft (SCRIPT_REVIEW) or
 * user_confirm_brand_review (BRAND_REVIEW) always consume. A `deadline_expired`
 * consumes the SCRIPT_REVIEW gate too. Mirrors the leaf
 * foldCurrentGateToken consume rule but returns the full V1 ReviewGate shape.
 */
export function deriveReviewGate(events: AgentEvent[]): null | ReviewGate {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]
    if (
      e.type === 'user_continue_draft' ||
      e.type === 'user_confirm_brand_review' ||
      e.type === 'deadline_expired'
    ) {
      return null
    }
    if (e.type === 'review_gate_opened') {
      return {
        kind: e.gateKind,
        // options are surfaced by the planner reply at gate time; foldSession
        // does not synthesize chips here (V1 review_gate.options come from the
        // gate-opening decision, not stored on the event). Empty is the safe
        // default and matches a fresh gate with no extra chips.
        options: [],
        status: 'WAITING_FOR_USER',
        token: e.token,
      }
    }
  }
  return null
}

/**
 * Fold the planner's todo PLAN (intent) from todo_updated events: a `snapshot`
 * fully replaces items; an `update` applies phase / clear / per-item status.
 * The per-item statuses captured here are the planner's claims; the final
 * authoritative statuses are computed in foldTodoState (t* by artifact, d* by
 * explicit close).
 */
function foldTodoPlan(events: AgentEvent[]): PlannerTodoItem[] {
  let items: PlannerTodoItem[] = []
  for (const e of events) {
    if (e.type !== 'todo_updated') {
      continue
    }
    if (e.snapshot) {
      items = e.snapshot.map((it) => ({ ...it }))
      continue
    }
    if (e.update?.clear) {
      items = []
    }
    if (e.update?.set_item_status) {
      for (const { id, status } of e.update.set_item_status) {
        const existing = items.find((it) => it.id === id)
        if (existing) {
          existing.status = status
        }
      }
    }
  }
  return items
}

/**
 * Whether a todo item is a bootstrap (recipe) stage. Discrimination rule (V1):
 * bootstrap-stage ids are prefixed `t` (t1, t2, ...); refinement directives are
 * prefixed `d` (d1, d2, ...). The id prefix is the authoritative, mechanical
 * discriminator; executor_hint is descriptive only in V2. Anything not clearly a `d*` directive is treated as a t* stage so
 * its completion stays artifact-driven (the safe default -- never let the
 * planner phantom-complete a pipeline stage).
 */
function isBootstrapStage(item: PlannerTodoItem): boolean {
  return !item.id.startsWith('d')
}

/**
 * Whether a t* stage's produced artifact exists in the projected session. The
 * stage's executor_hint.executor_tool names the producing tool; the artifact
 * "exists" iff that tool has a tool_completed in the log (mechanical fact). If
 * no executor_tool is declared we cannot prove the artifact mechanically, so the
 * stage stays pending (conservative -- planner cannot override).
 *
 * anchor_vs_batch special case: in V2 the anchor+vs tools are dispatched as a
 * single batched child (anchor_vs_batch) whose tool_completed carries
 * toolName='anchor_vs_batch'. The planner's todo still names the individual
 * tools (generate_anchor_assets / generate_explainer_visual_script) in its
 * executor_hint -- so we need to check the batch name as a fallback.
 */
function artifactExistsFor(item: PlannerTodoItem, events: AgentEvent[]): boolean {
  const tool = item.executor_hint?.executor_tool
  if (!tool) {
    return false
  }
  if (toolSucceeded(events, tool)) {
    return true
  }
  // anchor_vs_batch covers both individual tools; treat completion of the batch
  // as completion of each constituent tool.
  if (tool === 'generate_anchor_assets' || tool === 'generate_explainer_visual_script') {
    return toolSucceeded(events, 'anchor_vs_batch')
  }
  return false
}

/**
 * Fold the authoritative todo_state. Plan comes from the planner (todo_updated);
 * statuses are recomputed deterministically: t* (bootstrap stage) is done iff
 * its artifact exists (mechanical fact, planner cannot phantom-complete); d*
 * (refinement directive) is done iff the planner explicitly closed it in the log
 * (auditable judgment). Phase stays consistent with foldPhase. `_session` is
 * accepted for symmetry with the design signature (artifact existence is derived
 * from events here for determinism); reserved for future spec-based checks.
 */
export function foldTodoState(
  events: AgentEvent[],
  _session?: FoldedSessionState,
): PlannerTodoState {
  const plan = foldTodoPlan(events)
  return {
    items: plan.map((item) => {
      if (isBootstrapStage(item)) {
        return { ...item, status: artifactExistsFor(item, events) ? 'done' : 'pending' }
      }
      return { ...item, status: directiveClosedInLog(item, events) ? 'done' : 'pending' }
    }),
    phase: foldPhase(events),
  }
}

/** Compact error message for no-throw defensive logging. */
function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function applyOpsToSpec(
  state: FoldedSessionState,
  ops: PatchOp[],
  source: SpecHistorySource,
  timestamp: string,
  toolName?: string,
): void {
  const prevSpec = structuredCloneSpec(state.spec)
  // Auto-apply mappers can emit add_preselected_asset for a source=user_upload
  // anchor; without the allowlist patch-apply rejects it and this whole
  // artifact apply is dropped (logged + skipped).
  const patch = {
    allowed_user_upload_asset_ids: getAllowedUploadedAssetIds(state),
    base_version: state.spec.meta.spec_version,
    diff_summary: '',
    ops,
  }
  const res = applyPatch(state.spec, patch, { transitionVideoModel: state.transitionVideoModel })
  if (res.error) {
    logger.warn(`[foldSession] tool artifact apply skipped: ${res.error}`)
    return
  }
  state.spec = res.spec
  pushSpecHistoryEntry(state, {
    diff_summary: '',
    ops,
    prev_spec: prevSpec,
    source,
    // Use the source event's timestamp (not new Date()) so re-folds of the same
    // log are deterministic, mirroring the spec_patched path.
    timestamp,
  })
  // Tool auto-apply emits no spec_patched; see foldToolArtifactLedger.
  state.spec.meta.stale_artifacts = safeLedgerUpdate(
    'foldToolArtifactLedger',
    state.spec.meta.stale_artifacts,
    () => foldToolArtifactLedger(state, ops, timestamp, toolName),
  )
}

/**
 * Fold the structural event stream into `state` (mutating it), returning the
 * brand brief-edit count. When `checkpointSpec` is provided, the base spec is
 * reset to it at the pinned compaction boundary: the marker sorts AFTER the
 * truncated tail, so the reset discards the tail's partial (creation-based)
 * spec-folding -- already captured in the checkpoint -- while leaving
 * transcript / cached_artifacts / counters built from the tail intact; the new
 * run's post-boundary events then fold spec on top.
 */
function buildBaseState(
  initEvent?: Extract<AgentEvent, { type: 'session_initialized' }>,
): FoldedSessionState {
  if (!initEvent) {
    // Defensive: no session_initialized yet. Build an empty-spec-based default
    // mirroring buildInitialSessionState as closely as possible.
    const now = new Date().toISOString()
    return {
      bootstrap: { remix_context: null, seed_style_instruction: null },
      cached_artifacts: emptyCachedArtifacts(),
      conversation_summary: '',
      created_at: now,
      is_processing: false,
      queued_items: [],
      review_auto_continue_deadline_at: null,
      review_gate: null,
      sessionId: '',
      spec: buildEmptySpec(),
      spec_history: [],
      todo_state: { items: [], phase: 'mode_confirmation' },
      tool_call_states: [],
      transcript: [],
      updated_at: now,
    }
  }

  const { initialSpecSnapshot, params, timestamp } = initEvent
  return {
    audioPath: params.audioPath,
    // Restore the user's confirmed style preset (V1 keeps it on the persistent
    // session). generate_intent_context reads bootstrap.seed_style_instruction
    // and OVERWRITES spec.global_constraints.style with it; if this is null the
    // seeded style is wiped for anchor + visual-script generation.
    // Remix carry-over: the deterministic source-spec summary
    // rides session_initialized.params; the shared V1 prompt builders render it
    // from bootstrap.remix_context (buildRemixContextBlock). Null for non-remix
    // sessions and for in-flight sessions initialized before the wire-up.
    bootstrap: {
      remix_context: params.remixContext ?? null,
      seed_style_instruction: params.seedStyleInstruction ?? null,
    },
    brandExtractionEnabled: params.brandExtractionEnabled,
    cached_artifacts: emptyCachedArtifacts(),
    conversation_summary: '',
    created_at: timestamp,
    // Restore the session-creation snapshots. Old event
    // logs without these fields fold to undefined = the prior behavior.
    generationResolution: params.generationResolution,
    imageModel: params.imageModel,
    modelSelectorTier: params.modelSelectorTier,
    orgId: params.orgId,
    transitionVideoModel: params.transitionVideoModel,
    is_processing: false,
    queued_items: [],
    review_auto_continue_deadline_at: null,
    review_gate: null,
    sessionId: params.projectId,
    spec: structuredCloneSpec(initialSpecSnapshot),
    spec_history: [],
    todo_state: { items: [], phase: 'mode_confirmation' },
    tool_call_states: [],
    transcript: [],
    updated_at: timestamp,
    voiceProfile: params.voiceProfile,
    workflow_protocol_version: params.workflowProtocolVersion,
  }
}

function emptyCachedArtifacts(): CachedArtifacts {
  return {
    recovery_failures: [],
    tool_events: [],
  }
}

function foldStructuralEvents(
  state: FoldedSessionState,
  events: AgentEvent[],
  checkpoint: null | SessionCheckpoint,
): number {
  const specCheckpointIdx = checkpoint ? (latestCompactionCheckpoint(events)?.index ?? -1) : -1
  let briefEditCount = 0
  for (let i = 0; i < events.length; i += 1) {
    const event = events[i]
    const bankBefore =
      event.type === 'spec_patched' && !isBrandExtractionPatch(event)
        ? stableStringify(state.spec.global_constraints.brand_bank ?? null)
        : null
    applyStructuralEvent(state, event, events)
    if (i === specCheckpointIdx && checkpoint) {
      state.spec = structuredCloneSpec(checkpoint.spec)
      // Pre-boundary spec_patched events are truncated from the compacted log, so
      // the history entries folded from the surviving tail carry prev_spec values
      // from the reverted (pre-reset) lineage. Leaving them would let an
      // UNDO_LAST right after compaction restore that stale spec
      // (sessionControlActivity reads spec_history[-count].prev_spec). Undo can
      // only target patches reconstructable after the boundary, so start empty.
      state.spec_history = []
      // Reseed the whole planner artifact store from the versioned dump
      // so anchor_plan / uploaded_assets / working_script / pending_* don't revert
      // when their source tool/message events were truncated. Null when the dump
      // is absent (a version older than the cached-artifacts dump) -> fold from events as
      // before. recovery_failures / tool_events stay fresh (they age out with
      // compaction); post-boundary events re-stage everything on top.
      if (checkpoint.cachedArtifacts) {
        state.cached_artifacts = {
          ...emptyCachedArtifacts(),
          ...structuredClone(checkpoint.cachedArtifacts),
          recovery_failures: [],
          tool_events: [],
        }
      }
    }
    if (bankBefore !== null) {
      const bankAfter = stableStringify(state.spec.global_constraints.brand_bank ?? null)
      if (bankAfter !== bankBefore) {
        briefEditCount += 1
      }
    }
  }
  return briefEditCount
}

/**
 * Map a V2 spec_patched source onto the V1 SpecHistoryEntry source enum. The
 * V2 event source vocabulary is finer-grained than V1's SpecHistorySource;
 * collapse to the closest V1 bucket so spec_history stays type-compatible with
 * V1 consumers (FE diff highlight / undo).
 */
function mapPatchSourceToHistorySource(
  source: 'deadline' | 'planner' | 'session_control' | 'system' | 'user_signal',
): SpecHistorySource {
  if (source === 'deadline' || source === 'system') {
    return 'SYSTEM'
  }
  if (source === 'session_control') {
    return 'UNDO'
  }
  return 'PATCH_SPEC'
}

function pushSpecHistoryEntry(state: FoldedSessionState, entry: SpecHistoryEntry): void {
  state.spec_history.push(entry)
  if (state.spec_history.length > MAX_SPEC_HISTORY) {
    state.spec_history = state.spec_history.slice(-MAX_SPEC_HISTORY)
  }
}
