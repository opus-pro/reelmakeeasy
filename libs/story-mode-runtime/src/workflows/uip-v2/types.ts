/**
 * UIP V2 -- AgentEvent log, projected WorkflowState, continueAsNew params,
 * and V2 signal/query payload types.
 *
 * Source of truth for a V2 session is the append-only `AgentEvent[]` log.
 * All session state is projected from it (folds run on the activity side; the
 * workflow itself only derives lightweight control-flow state).
 *
 * This module is intentionally behavior-free: no `defineSignal`/`defineQuery`
 * (those land in Phase 3) and no workflow-engine import. V1 domain types are
 * pulled in via `import type` ONLY, so nothing here drags runtime code into
 * workflow code.
 *
 * Time-field convention (fix D): every event carries `at: number` (ms epoch) as
 * the authoritative timestamp. `timestamp` (ISO string) is optional and only
 * for readability / frontend convenience. Leaf folds (notably the deadline
 * fold) always read `at`. `appendEvent` stamps `at` for every event, so all
 * event interfaces extend `BaseEvent`. Doc-specified fields such as a required
 * `timestamp`, or `completedAt` / `startedAt` / `failedAt` / `cancelledAt`, are
 * kept as written, but `at` is always present on top.
 */

import type { CancellableToolName } from '@reelmakeeasy/common/workflow/uip-v2-signal-names'
import type {
  ActiveModalKind,
  BrandBriefSubmitSignalPayload,
  ConfirmBrandReviewSignalPayload,
  GlobalConstraints,
  PatchOp,
  PlannerOutput,
  PlannerPhase,
  PlannerTodoState,
  SessionState,
  UipSessionWorkflowParams,
  UploadedAsset,
} from '@reelmakeeasy/uip-planner-runtime'

// Type-only: the activity result shape carried on
// article_extraction_completed events.
import type { ExtractArticleActivityResult } from '../../activities/article-extraction/extract-article'

import type {
  BrandExtractionFailedSignalPayload,
  BrandExtractionReadySignalPayload,
  UserMessageSignalPayload,
} from './signal-payloads'

// ---------------------------------------------------------------------------
// Locally defined V2-only types
// ---------------------------------------------------------------------------

/**
 * Minimal Phase-1 shape; the precise per-artifact-kind slot structure is
 * finalized in Phase 2 when foldSession/mappers consume it.
 *
 * `ArtifactSlot` is not exported from `@reelmakeeasy/uip-planner-runtime` and is a
 * V2-only concept (per-kind current artifact plus optional history), so it is
 * defined locally here.
 */
export interface ArtifactSlot<T = unknown> {
  current: T
  history?: T[]
}

/**
 * Payload sent by the pre-voiceover child workflow (stage 1 -> stage 2
 * boundary) to unblock the bootstrap_script gate before the canonical mp3
 * upload finishes. Mirrors the V1 shape; defined locally so this module avoids
 * importing the V1 types file (which pulls in the workflow engine).
 */
export interface PreVoiceoverScriptReadySignalPayload {
  audioDurationSeconds?: number
  scriptText: string
  transcriptPath: string
}

/**
 * Payload sent by the pre-voiceover child workflow after stage 2 completes.
 * Carries canonical voiceover artifact metadata back to the parent. Mirrors
 * the V1 shape; defined locally for the same reason as above.
 */
export interface PreVoiceoverArtifactsReadySignalPayload {
  audioDurationSeconds?: number
  scriptText: string
  source: 'user_audio'
  transcriptPath: string
  voiceOverPath: string
}

/**
 * Payload from `MusicPreAnalysisWorkflow`. Mirrors the producer-side
 * shape in `workflows/pre-voiceover/signals.ts`; defined locally so this module
 * avoids importing the producer file. Signals serialize by shape.
 */
export interface MusicBeatSheetSignalPayload {
  reason?: string
  status: 'ready' | 'unavailable'
}

/**
 * Snapshot of a single in-flight tool child workflow, returned by the
 * get-active-tool-calls query.
 */
export interface ActiveToolCallInfo {
  childWorkflowId: string
  startedAt: string
  toolCallId: string
  toolName: string
}

/**
 * Lightweight workflow health snapshot, returned by the get-workflow-health
 * query.
 */
export interface WorkflowHealthInfo {
  activeToolCount: number
  eventCount: number
  isTerminal: boolean
  processedDecisionCount: number
}

// ---------------------------------------------------------------------------
// V2 signal payloads (tool lifecycle: child -> parent)
// ---------------------------------------------------------------------------

/** Sent by the tool runner child when a tool call completes successfully. */
export interface ToolCompletedSignalPayload {
  durationMs: number
  output: unknown
  toolCallId: string
  toolName: string
}

/** Sent by the tool runner child when a tool call fails. */
export interface ToolFailedSignalPayload {
  errorCode: string
  errorMessage: string
  // Partial staged artifact on a soft (ok:false) failure; absent for hard
  // exceptions. The parent forwards it onto the tool_failed event so foldSession
  // can stage the partial result (e.g. anchor partial summary).
  output?: unknown
  retryable: boolean
  toolCallId: string
  toolName: string
}

/** Sent by the tool runner child when a tool call is cancelled. */
export interface ToolCancelledSignalPayload {
  toolCallId: string
  toolName: string
}

/**
 * Sent by the tool runner child (from its activity) for an in-flight progress
 * milestone. The parent appends a passive assistant_message tagged with
 * `childWorkflowId`. Deduped by (childWorkflowId, content) so an activity retry
 * re-emitting the same milestone does not duplicate.
 */
export interface ChildProgressMessageSignalPayload {
  childWorkflowId: string
  content: string
}

/**
 * Sent by the tool runner child (from its activity) when an internal substep
 * (LLM call / image-gen phase) starts or finishes. Carries the child workflow
 * id, not the toolCallId -- the activity does not know its toolCallId, and the
 * parent resolves it from activeToolCalls (same sender-identity scheme as
 * childProgressMessage). status only has running/completed: a throwing substep
 * stays 'running' and the tool-level tool_failed freezes the card.
 */
export interface ToolSubstepSignalPayload {
  childWorkflowId: string
  status: 'completed' | 'running'
  substep: string
  toolName: string
}

// ---------------------------------------------------------------------------
// AgentEvent log
// ---------------------------------------------------------------------------

/**
 * Base shape for every AgentEvent. `at` (ms epoch) is the authoritative
 * timestamp stamped by `appendEvent`; `timestamp` (ISO) is optional.
 */
export interface BaseEvent {
  at: number
  timestamp?: string
}

/**
 * Complete AgentEvent union. Maps one-to-one onto the V1 operations. Every
 * variant extends `BaseEvent` so `at` is always present.
 */
// Members are sorted alphabetically to satisfy perfectionist/sort-union-types.
// The grouping (user input / planner / tool lifecycle / brand / phase / session
// lifecycle / activity / deadline / spec / audio / recovery / compaction) is
// documented per-member below.
export type AgentEvent =
  | ArticleExtractionCompletedEvent // passive; article activity result; folds to bootstrap.article_context
  | ArticleExtractionStartedEvent // passive; article activity armed for the pasted URL
  | AssistantMessageEvent // passive; V1: transcript.push({ role: 'assistant', ... })
  | BrandBankEditedEvent // passive; Tier-1 brand_bank edit (underlying op is spec_patched)
  | BrandExtractionFailedEvent // decision-worthy; child -> parent failed (skip to bootstrap_script)
  | BrandExtractionReadyEvent // decision-worthy; child -> parent ready (advance brand_review)
  | CompactionEvent // passive; V2: records where/why continueAsNew happened
  | DeadlineExpiredEvent // decision-worthy; wakes main loop, advancePhase does auto-continue / auto-lock
  | DeadlineExtendedEvent // passive; deadline fired while busy -> re-arm timer + publish, does NOT wake the loop
  | GateDeadlineDispatchedEvent // passive; marks that a fired gate deadline was routed to the API (dispatch dedup)
  | ModeConfirmedEvent // decision-worthy; MODE_CONFIRMED action -> mode/duration/input_type fixed
  | MusicBeatSheetEvent // decision-worthy; child -> parent music beat-sheet ready/unavailable
  | PhaseChangedEvent // passive; V1: activateBootstrapVisual / activateBootstrapScript etc.
  | PlannerDecidedEvent // passive; the planner's decision (PlannerOutput) from each planner step
  | PlannerStartEvent // passive; appended before each planner call; only used to derive is_processing
  | PreVoiceoverArtifactsReadyEvent // passive; V1: preVoiceoverArtifactsReadySignal handler
  | PreVoiceoverScriptReadyEvent // decision-worthy; V1: preVoiceoverScriptReadySignal handler (unlocks bootstrap_script)
  | RecoveryFailureEvent // passive; V1: recordRecoveryFailure()
  | ReviewGateOpenedEvent // passive; opens gate on entering a review phase (carries token)
  | SessionCancelledEvent // passive; V1: _cancelled = true path
  | SessionFailedEvent // passive; V1: _failed = true path (pre-voiceover failure)
  | SessionInitializedEvent // passive; V1: buildInitialSessionState()
  | SessionLockedEvent // passive; V1: spec.meta.locked_at set (confirm path)
  | SessionTimedOutEvent // passive; V1: _timed_out = true path
  | SpecPatchedEvent // passive; V1: applyPatch() (global_constraints writes etc.)
  | TodoUpdatedEvent // passive; TODO_UPDATE_ONLY action -> todo plan update (cross-turn planner memory)
  | ToolCancelledEvent // decision-worthy; V1: tool call cancelled (wakes planner)
  | ToolCompletedEvent // decision-worthy; V1: tool call success (wakes planner)
  | ToolFailedEvent // decision-worthy; V1: tool call failure (wakes planner)
  | ToolStartedEvent // passive; V1: tool call start (activity start)
  | ToolSubstepEvent // passive+transient; child -> parent substep progress; folds into tool_call_states[].sub_tools (publish-only)
  | UrlClassificationCompletedEvent // passive; pasted-URL router verdict; gates the article vs brand door
  | UserActivityEvent // passive; GUI edit / operate heartbeat; resets auto-continue countdown
  | UserAutoContinueChangedEvent // passive; setAutoContinueSignal; resets deadline, does not wake planner
  | UserCancelEvent // decision-worthy; V1: cancelSessionSignal -> cancel_session signal
  | UserCancelQueuedItemEvent // passive (legacy); V1: cancelQueuedItemSignal. New protocol deletes inbox record at the API layer; not a planner wake.
  | UserCancelToolEvent // decision-worthy; cancelToolSignal -> cancel one running tool (session stays alive)
  | UserConfirmBrandReviewEvent // decision-worthy; confirmBrandReview signal (brand_review -> bootstrap_script)
  | UserConfirmEvent // decision-worthy; V1: confirmSignal -> confirm signal
  | UserContinueDraftEvent // decision-worthy; V1: continueUipDraftSignal -> continue_draft signal
  | UserGuiUpdateEvent // passive; V1: guiUpdateSignal (writes transcript GUI edit); extends deadline, does not wake planner
  | UserGuiWakeEvent // decision-worthy; debounced GUI edit -- drives a planner turn, not an inbox pull
  | UserMessageEvent // decision-worthy; V1: userMessageSignal / userMessagesSignal
  | UserScriptReviewUpdateEvent // passive; V1: scriptReviewUpdateSignal (writes working_script); extends deadline, does not wake planner
  | UserTransitionVideoModelChangedEvent // passive; transition-video model selector changed mid-session
  | UserWakeEvent // decision-worthy; V1: wakeSignal (new-protocol API inbox trigger)
  | WorkingScriptSeedEvent // passive; V1: after seedWorkingScriptActivity
  | WorkingScriptUpdatedEvent // passive; V1: applyScriptReviewUpdate writes cached_artifacts.working_script

// -- Detailed event interfaces --

export interface PlannerDecidedEvent extends BaseEvent {
  decision: PlannerOutput // v1 type (v1 action names), not a new union
  modelId?: string // optional (present when plannerStepActivity returns it)
  stepIndex: number
  // Optional: callPlanner (the V1 chain-aware planner call) returns NO token
  // usage, so plannerStepActivity does not populate this. Kept on the event
  // shape only for a future token source (Phase-2 Decision 1).
  tokens?: { inputTokens: number; outputTokens: number }
  type: 'planner_decided'
  // time comes from BaseEvent.at (fix D); no separate decidedAt
}

/**
 * Appended right before each planner call. Carries no payload beyond BaseEvent;
 * its sole purpose is to derive `is_processing`: a planner_start with no
 * planner_decided after it means a turn is in flight (the agent is "Thinking").
 * NOT decision-worthy -- it must never wake the main loop.
 */
export interface PlannerStartEvent extends BaseEvent {
  type: 'planner_start'
}

export interface UserCancelEvent extends BaseEvent {
  actionId?: string
  gateToken: string
  timestamp: string
  type: 'user_cancel'
}

export interface UserCancelQueuedItemEvent extends BaseEvent {
  queuedItemId: string
  timestamp: string
  type: 'user_cancel_queued_item'
}

export interface UserCancelToolEvent extends BaseEvent {
  actionId?: string
  timestamp: string
  toolName: CancellableToolName
  type: 'user_cancel_tool'
}

export interface UserConfirmEvent extends BaseEvent {
  actionId?: string
  // true = confirm_fast (script_review skips HITL; API already started the fast workflow)
  fast?: boolean
  timestamp: string
  type: 'user_confirm'
}

export interface UserContinueDraftEvent extends BaseEvent {
  actionId?: string
  gateToken: string
  timestamp: string
  type: 'user_continue_draft'
}

export interface UserGuiUpdateEvent extends BaseEvent {
  // Summary artifact field edits (topic / directives / must_not_violate) flushed
  // via POST :id/summary. Merged directly into
  // spec.global_constraints by the fold -- no PatchOp, mirrors
  // UserScriptReviewUpdateEvent's globalConstraints merge.
  globalConstraints?: Partial<GlobalConstraints>
  requestId?: string
  timestamp: string
  transcript?: string // working_script.script GUI edit
  type: 'user_gui_update'
}

export interface UserMessageEvent extends BaseEvent {
  actionId?: string
  answerToMessageId?: string
  message: string
  messageId: string
  sentAt?: string
  /** Canvas Edit modal open when the user sent this message. */
  sentFrom?: ActiveModalKind
  timestamp: string
  type: 'user_message'
  uploadedAssets?: UploadedAsset[]
}

export interface UserScriptReviewUpdateEvent extends BaseEvent {
  gateToken: string
  globalConstraints?: Partial<GlobalConstraints>
  requestId?: string
  script?: string
  timestamp: string
  type: 'user_script_review_update'
}

export interface UserTransitionVideoModelChangedEvent extends BaseEvent {
  requestId?: string
  timestamp: string
  transitionVideoModel?: string
  type: 'user_transition_video_model_changed'
}

export interface UserWakeEvent extends BaseEvent {
  timestamp: string
  type: 'user_wake'
}

/**
 * The debounced GUI-edit wake. A SEPARATE type from
 * `user_wake` on purpose: `user_wake` means "an inbox message is queued, pull
 * it", so main-loop step 7c consumes a lone one via triggerNextAction and
 * returns before the planner turn. A GUI edit queues no inbox message, so that
 * path decides 'idle' and the wake does nothing -- observed in a session
 * where three debounced wakes fired on time and left specVersion untouched
 * with no plannerStepActivity. This type is decision-worthy but deliberately
 * absent from `isOnlyUnprocessedWake`, so the boundary falls through 7c into
 * the planner turn that reconciles the edit.
 *
 * Being decision-worthy is NOT a free choice here: `foldGuiDebounceDeadline`
 * disarms on the first decision-worthy event after the edit, so dropping this
 * type from DECISION_WORTHY_EVENT_TYPES makes the sync loop re-append the wake
 * on every iteration -- an unbounded wake loop, not a missing feature.
 */
export interface UserGuiWakeEvent extends BaseEvent {
  timestamp: string
  type: 'user_gui_wake'
}

// Derived from TODO_UPDATE_ONLY action. `clear` / `set_item_status` allow null
// to match the V1 planner schema (PlannerTodoUpdateSchema); foldTodoPlan reads
// them via truthy checks so null behaves like absent.
export interface TodoUpdatedEvent extends BaseEvent {
  snapshot?: PlannerTodoState['items'] // v1 todo_snapshot.items (full replace)
  timestamp: string
  type: 'todo_updated'
  update?: {
    clear?: boolean | null
    // v1 todo_update (incremental)
    phase?: PlannerPhase
    set_item_status?: Array<{ id: string; status: 'done' | 'pending' }> | null
  }
}

// Derived from MODE_CONFIRMED action (decision-worthy: triggers phase advance).
export interface ModeConfirmedEvent extends BaseEvent {
  durationSec: null | number
  durationSource?: PlannerOutput['mode_update']['duration_source']
  inputType: string
  mode: string
  pastedScriptFit?: PlannerOutput['mode_update']['pasted_script_fit']
  timestamp: string
  type: 'mode_confirmed'
  verifiedPastedScript?: {
    script: string
    shotEdits: Array<{ audio_vo: string; shot_id: string }>
  }
}

// Article extraction events (step 2, news-article-to-video door).
// Unlike brand extraction there is no review gate and no spec field: the
// started/completed pair is the whole state machine, and foldSession projects
// the latest completed result onto SessionState.bootstrap.article_context.
export interface ArticleExtractionCompletedEvent extends BaseEvent {
  // Carries failed outcomes too (typed failureKind) so the fold can tell
  // "ran and failed" from "never ran" without a separate failure event.
  result: ExtractArticleActivityResult
  runId: string
  timestamp: string
  type: 'article_extraction_completed'
}

export interface ArticleExtractionStartedEvent extends BaseEvent {
  runId: string
  timestamp: string
  type: 'article_extraction_started'
  url: string
}

// Brand subsystem events (state ultimately flows through spec_patched).
export interface BrandBankEditedEvent extends BaseEvent {
  timestamp: string
  type: 'brand_bank_edited'
}

export interface BrandExtractionFailedEvent extends BaseEvent {
  reason: string
  runId: string
  timestamp: string
  type: 'brand_extraction_failed'
}

export interface BrandExtractionReadyEvent extends BaseEvent {
  runId: string
  timestamp: string
  type: 'brand_extraction_ready'
}

// MusicPreAnalysisWorkflow -> UIP parent. `ready` = music beat sheet
// persisted at long_take/experts/beat_sheet.json; `unavailable` = not music, or
// analysis failed (e.g. beat-grid OOM). Decision-worthy: advancePhase gates the
// script_review -> bootstrap_visual transition for music sessions on this, and
// foldSession projects `status` into spec.meta.music_beat_sheet_status for the
// VS tool to choose beat-locked vs ASR-timing.
export interface MusicBeatSheetEvent extends BaseEvent {
  reason?: string
  status: 'ready' | 'unavailable'
  timestamp: string
  type: 'music_beat_sheet'
}

// The confirmBrandReview signal handler validates gateToken + atomically
// applies [styleDirective?, ...edits, lock_brand_bank], then appends this event
// (decision-worthy); advancePhase's brand_review case advances to
// bootstrap_script based on it.
export interface UserConfirmBrandReviewEvent extends BaseEvent {
  actionId?: string
  gateToken: string
  timestamp?: string
  type: 'user_confirm_brand_review'
}

/** One clickable clarify chip (mirrors V1 ClarifyOption). */
export interface AssistantClarifyOption {
  expect_assets?: boolean | null
  id: string
  label: string
}

// Passive; V1: transcript.push({ role: 'assistant', ... }). Records an assistant
// message at a given phase/specVersion. The optional reply_question / options /
// expect_assets fields preserve the ASK_CLARIFY payload (V1 keeps reply and
// reply_question separate and renders options as clickable chips).
export interface AssistantMessageEvent extends BaseEvent {
  // Originating tool child workflow id when this message is a streamed progress
  // milestone from a tool child (childProgressMessage signal); null/absent when
  // the planner/parent emitted it.
  child_id?: null | string
  content: string
  expectAssets?: boolean | null
  messageId: string
  options?: AssistantClarifyOption[] | null
  phase: PlannerPhase
  replyQuestion?: null | string
  /** Trusted workflow-owned origin marker; planner decision JSON cannot set it. */
  runtimeClarificationKind?:
    | 'pasted_script_duration_cap'
    | 'pasted_script_fit'
    | 'pasted_script_unreadable'
  specVersion: number
  timestamp: string
  /**
   * Turn this message belongs to; mirrored into the transcript's `turn_id`. The
   * API dedups assistant messages by (turn_id, content) to swallow activity
   * retries that re-emit the same reply under a fresh random id
   * (`collectMissingAssistantEvents`, uip-timeline-merge.ts). V2 otherwise never
   * sets a turn id, so that bucket is session-wide: a message whose copy is a
   * FIXED string must carry a distinct turn id per occurrence, or every repeat
   * after the first is silently dropped before it reaches the client.
   */
  turnId?: string
  type: 'assistant_message'
}

export interface PhaseChangedEvent extends BaseEvent {
  fromPhase: PlannerPhase
  reason: string // e.g. 'planner_decision' | 'user_continue_draft' | 'deadline_expired'
  timestamp: string
  toPhase: PlannerPhase
  type: 'phase_changed'
}

// Emitted by openReviewGate on entering a review phase (fix C). Projected to
// session.review_gate; signal handlers read the last token via
// foldCurrentGateToken for validation.
export interface ReviewGateOpenedEvent extends BaseEvent {
  gateKind: 'BRAND_REVIEW' | 'SCRIPT_REVIEW'
  timestamp: string
  token: string
  type: 'review_gate_opened'
}

export interface SessionCancelledEvent extends BaseEvent {
  cancelledAt: string
  timestamp: string
  type: 'session_cancelled'
}

export interface SessionFailedEvent extends BaseEvent {
  failureCode: 'INTERNAL_ERROR' | 'PRE_VOICEOVER_EMPTY' | 'PRE_VOICEOVER_FAILED'
  failureMessage: string
  timestamp: string
  type: 'session_failed'
}

export interface SessionInitializedEvent extends BaseEvent {
  initialSpecSnapshot: SessionState['spec'] // only the initial spec; not carried on every event
  params: Pick<
    UipSessionWorkflowParams,
    | 'audioPath'
    // Initial auto-continue setting at create. foldAutoContinueEnabled
    // starts from this and lets a later user_auto_continue_changed event
    // override it; absent = legacy always-on.
    | 'autoContinueEnabled'
    | 'brandExtractionEnabled'
    // Per-project generation-resolution snapshot; folded back onto
    // SessionState so v2 anchor generation sees the session's image tier.
    | 'generationResolution'
    // Selected image model + owning org. Previously dropped at this
    // boundary, which made v2 mid-planning anchor generation silently ignore
    // the user's model selection; folded back onto SessionState below.
    | 'imageModel'
    | 'improvedVisualScriptEnabled'
    // User-facing quality tier snapshot. Same silent-drop hazard as
    // imageModel above: absent from this Pick means absent from the event log,
    // so the visual-script tool would never see the tier and would always take
    // the compiled-in model chain.
    | 'modelSelectorTier'
    | 'orgId'
    | 'projectId'
    | 'remixContext'
    // Deterministic remix carry-over summary from the source's locked spec.
    // Projected to bootstrap.remix_context so the
    // shared V1 prompt builders render the "Carried over from previous video"
    // block. Absent on non-remix sessions and on in-flight sessions
    // initialized before this wire-up.
    | 'seedStyleInstruction'
    // The user's confirmed style preset. Carried in so foldSession can restore
    // bootstrap.seed_style_instruction -- generate_intent_context reads it and
    // OVERWRITES spec.global_constraints.style on its way out, so dropping it
    // wipes the seeded style for every downstream tool (anchor, visual script).
    | 'transitionVideoModel'
    | 'userEmail'
    | 'userId'
    | 'voiceId' // anchor soft-bias source, carried in at session creation
    | 'voiceProfile'
    | 'workflowProtocolVersion'
  >
  timestamp: string
  type: 'session_initialized'
}

export interface SessionLockedEvent extends BaseEvent {
  autoLocked: boolean // true = deadline auto-trigger, false = explicit user confirm
  lockedAt: string
  timestamp: string
  type: 'session_locked'
}

export interface SessionTimedOutEvent extends BaseEvent {
  timestamp: string
  type: 'session_timed_out'
}

export interface ToolCancelledEvent extends BaseEvent {
  cancelledAt: string
  toolCallId: string
  toolName: string
  type: 'tool_cancelled'
}

export interface ToolCompletedEvent extends BaseEvent {
  completedAt: string
  durationMs: number
  output: unknown
  toolCallId: string
  toolName: string
  type: 'tool_completed'
}

export interface ToolFailedEvent extends BaseEvent {
  errorCode: string
  errorMessage: string
  failedAt: string
  // Optional staged artifact present on a soft (ok:false) failure where the tool
  // staged a partial result before failing (e.g. anchor partial summary).
  // foldSession.applyToolOutput stages it so the planner can inspect the partial
  // artifact alongside the failure reason (V1 parity: V1 stages the summary on
  // the session even on ok:false). Absent for hard exceptions (no output).
  output?: unknown
  retryable: boolean
  toolCallId: string
  toolName: string
  type: 'tool_failed'
}

export interface ToolStartedEvent extends BaseEvent {
  childWorkflowId: string
  startedAt: string
  toolCallId: string
  toolInput: unknown
  toolName: string
  type: 'tool_started'
}

/**
 * Passive + transient: substep progress of an in-flight tool call. Folds into
 * tool_call_states[].sub_tools (publish-only -- buildPersistedPayloads strips
 * sub_tools, so this event never affects a persisted payload). Never wakes
 * the planner.
 */
export interface ToolSubstepEvent extends BaseEvent {
  status: 'completed' | 'running'
  substep: string
  toolCallId: string
  toolName: string
  type: 'tool_substep'
}

// Pasted-URL router verdict: whether the URL in the user's message
// reads as an article/blog/tweet (-> article door) or a company/brand site
// (-> brand extraction). 'error' = the classifier failed; routing then falls
// back to today's behavior (brand auto-start). Certainty is derived by
// callers from `confidence` (see URL_ROUTE_CONFIDENCE_THRESHOLD in
// folds-url-route.ts), so
// an uncertain verdict can be re-classified after the user answers the
// director's clarifying question.
export interface UrlClassificationCompletedEvent extends BaseEvent {
  classification: 'article' | 'brand' | 'error'
  confidence: number
  runId: string
  timestamp: string
  type: 'url_classification_completed'
  url: string
}

// User activity heartbeat: only resets the auto-continue countdown. The
// deadline itself is not stored -- foldDeadline(events) derives it from the
// last reset event + delay. There is no deadline_set event; deadline_extended
// exists only as the busy-defer marker (see DeadlineExtendedEvent), not as a
// stored deadline value.
export interface UserActivityEvent extends BaseEvent {
  kind: 'operate' | 'transcript_edit' // GUI edit vs operate heartbeat
  timestamp: string
  type: 'user_activity'
}

// Mid-session auto-continue flip. foldAutoContinueEnabled takes the
// LATEST of these, falling back to the session_initialized snapshot (the
// initial value chosen at create). Passive (does not wake the planner) but a
// foldDeadline reset: flipping back ON must arm a fresh delay from the flip,
// never fire instantly off a stale pre-flip baseline.
export interface UserAutoContinueChangedEvent extends BaseEvent {
  enabled: boolean
  requestId?: string
  timestamp: string
  type: 'user_auto_continue_changed'
}

// V2-only: records where/why a continueAsNew (compaction) happened. Passive log
// marker; the compaction boundary event is itself carried in _v2CompactedEvents.
// truncatedBefore is the count of events compacted away before this point.
export interface CompactionEvent extends BaseEvent {
  /**
   * spec_version of the spec snapshot persisted (and flushed) at this
   * compaction boundary. When set, foldSession seeds its base spec from the
   * immutable `spec/versions/v{N}/spec.json` at this boundary instead of
   * replaying the (now-truncated) event log onto the creation-time snapshot --
   * so no spec state (mode_state, global_constraints, shots, ...) can silently
   * revert to its build-initial-spec default across a continueAsNew handoff.
   * Absent on older markers -> foldSession falls back to the old
   * creation-snapshot + full-event replay (backward-compatible).
   */
  specCheckpointVersion?: number
  timestamp: string
  truncatedBefore: number // number of events compacted away (history before this point is truncated)
  type: 'compaction'
}

// Appended by the background sync loop when the deadline timer fires.
// Decision-worthy: wakes the main loop so advancePhase performs a phase
// transition (script_review -> bootstrap_visual auto-continue; refinement ->
// session_locked auto-lock). The deadline remains a foldDeadline projection;
// this event is just the "fired" log marker and is used to dedupe repeated fires.
export interface DeadlineExpiredEvent extends BaseEvent {
  phase: PlannerPhase // gate phase at fire time (script_review | refinement)
  timestamp?: string
  type: 'deadline_expired'
}

// Appended by the background sync loop when the deadline fires but the session is
// still busy (a planner turn or tool is in flight). Passive: it does NOT wake the
// main loop -- it only re-arms the timer (foldDeadline treats it as a reset event)
// and bumps the persist revision so the pushed-out deadline reaches the FE.
// Capped at MAX_AUTO_EXTENDS per session (mirrors V1 cached_artifacts.auto_extend_count,
// cumulative across phases); past the cap the sync loop appends deadline_expired
// instead so a stuck planner cannot defer the gate forever.
export interface DeadlineExtendedEvent extends BaseEvent {
  phase: PlannerPhase // gate phase at extend time (script_review | refinement)
  timestamp?: string
  type: 'deadline_extended'
}

// Appended by the main loop right after it routes a fired gate deadline to the API
// (checkDeadlineExpiredActivity). Passive: it does NOT wake the loop. It is the
// explicit "we already dispatched this deadline" marker that gateDeadlineNeedsDispatch
// stops on, so the API's signal-back (uip-continue-draft / uip-confirm) cannot make
// the loop re-dispatch. It is deliberately NOT a foldDeadline / hasPendingDeadlineExpired
// reset: the timer must stay suppressed (null) until the phase actually advances, not
// re-arm off this marker.
export interface GateDeadlineDispatchedEvent extends BaseEvent {
  phase: PlannerPhase // gate phase at dispatch time (script_review | refinement)
  timestamp?: string
  type: 'gate_deadline_dispatched'
}

export interface PreVoiceoverArtifactsReadyEvent extends BaseEvent {
  audioDurationSeconds?: number
  timestamp: string
  transcriptPath: string
  type: 'pre_voiceover_artifacts_ready'
  voiceOverPath: string
}

export interface PreVoiceoverScriptReadyEvent extends BaseEvent {
  audioDurationSeconds?: number
  scriptText: string
  timestamp: string
  transcriptPath: string
  type: 'pre_voiceover_script_ready'
}

export interface RecoveryFailureEvent extends BaseEvent {
  errorCode: string
  failureStage: string
  message: string
  retryable: boolean
  timestamp: string
  type: 'recovery_failure'
}

export interface SpecPatchedEvent extends BaseEvent {
  // ops is the v1 PatchOp union (UpdateShotFieldOp / ReorderShotsOp /
  // ReplaceShotsRangeOp / UpdateBrandBankFieldOp / ...), not a generic
  // {op,path,value} JSON Patch. Keeps v1 semantic ops and their patch-apply
  // invariants (audio_vo lock / BRAND_LOCKED / scope).
  ops: PatchOp[]
  source: 'deadline' | 'planner' | 'session_control' | 'system' | 'user_signal'
  specVersionAfter: number
  timestamp: string
  type: 'spec_patched'
}

export interface WorkingScriptSeedEvent extends BaseEvent {
  audioDurationSeconds?: number
  scriptText: string
  timestamp: string
  transcriptPath: string
  type: 'working_script_seeded'
}

export interface WorkingScriptUpdatedEvent extends BaseEvent {
  requestId?: string
  script: string
  source: 'gui_edit' | 'planner'
  timestamp: string
  type: 'working_script_updated'
}
// Note: there is no CompactedSessionSnapshotEvent. Compaction does not snapshot
// SessionState -- spec is re-derived in the new run from the
// _v2CurrentArtifacts carried by continueAsNew.

// ---------------------------------------------------------------------------
// WorkflowState (projected from events; the full SessionState is NOT here)
// ---------------------------------------------------------------------------

/**
 * Workflow-side state. The complete SessionState is projected by
 * foldSession(events, currentArtifacts) on the activity side only (it
 * value-imports the planner runtime); the main loop only uses leaf folds for
 * control flow.
 */
export interface WorkflowState {
  // New-protocol nextAction records the API is holding for dispatched actions we
  // have now durably received. The main loop claims (clears) each via
  // claimNextActionActivity so a later action (e.g. continue) is not rejected by
  // evaluateActionIntentGuards as a conflicting pending nextAction (V1 parity:
  // run-planner-turn claimAction). Populated by signal handlers, drained by the
  // main loop.
  actionIdsToClaim: string[]
  // -- Active tool tracking --
  // Tool child workflows currently executing (projects is_processing; tool
  // results enter the log directly via handlers).
  activeToolCalls: Map<string, { childWorkflowId: string; startedAt: string; toolName: string }>

  // Feature-gate snapshot from params: gates the news-door article
  // extraction the same way brandExtractionEnabled gates the brand child.
  // Optional (absent = off) so the many existing WorkflowState test literals
  // stay valid; production init always sets it explicitly.
  articleExtractionEnabled?: boolean

  // -- Brand extraction state --
  brandExtractionEnabled: boolean
  brandExtractionPending: boolean // whether the BrandExtractionWorkflow child is in flight

  // Captured brand signal payloads awaiting application as spec_patched ops in
  // the main loop (handlers cannot call activities). Cleared once applied.
  brandFailedPayload: BrandExtractionFailedSignalPayload | null
  brandReadyPayload: BrandExtractionReadySignalPayload | null

  // -- Artifact slots (per-kind current + history) --
  // spec is derived from these on the activity side via mappers; continueAsNew
  // carries the whole map. The main loop only passes it through to activities.
  currentArtifacts: Record<string, ArtifactSlot>

  // User messages deferred while bootstrap_brand extraction is pending; appended
  // to the log once the session enters brand_review (V1 shouldDeferUserMessage).
  deferredUserMessages: UserMessageSignalPayload[]

  // -- Event log (source of truth) --
  events: AgentEvent[]

  // -- Idle / timeout --
  idleTimeoutMs: number // initialized from SHORTENED_SESSION_IDLE_TIMEOUT_MS

  // -- Session terminal flags (projected from events) --
  isCancelled: boolean

  isFailed: boolean
  isLocked: boolean // spec.meta.locked_at is non-null
  // -- Protocol flags --
  isNewProtocol: boolean
  isTimedOut: boolean

  // -- Background sync loop coordination --
  mainLoopDone: boolean // set true after the main loop exits; background loop flushes and exits

  // User-action brand payloads (drain-time): the confirm-review lock+edits and
  // the Stage-2 brief submit. Applied as ops in the main loop, then cleared.
  pendingBrandBrief: BrandBriefSubmitSignalPayload | null
  // deadline timer lives in the background sync loop (foldDeadline projection)

  pendingBrandConfirm: ConfirmBrandReviewSignalPayload | null

  // Grounding fingerprint of the current planner chain: a chain
  // restart is forced when the freshly built system prompt's grounding blocks
  // (article context, unresolved-URL routing question) change mid-segment.
  // Optional: pre-rollout states leave it undefined (read as 'base').
  plannerChainGroundingKey?: string
  plannerChainSegment: 'mode_confirmation' | 'post_confirmation' // force chain reset on segment switch
  // The planner A/B arm this session is pinned to, set from the first
  // planner round's result and then reused for every later round, so a config
  // edit mid-session cannot move a live session onto another model (which would
  // strand its response chain and split its rounds across arms in the metrics).
  // Optional: undefined until the first round of a session completes, and on
  // states carried from before this rollout.
  plannerModel?: string
  plannerOrphanedChainResponseIds: string[] // orphaned chain ids to clean up at session end
  // -- OpenAI Responses API chain state --
  // V2 plannerStep maintains a chain via response_id to cut per-call context
  // resend token cost; updated after each plannerStep, carried by continueAsNew.
  plannerResponseId: null | string
  preVoiceoverArtifactsPayload: null | PreVoiceoverArtifactsReadySignalPayload

  preVoiceoverArtifactsReady: boolean

  preVoiceoverChildFailureMessage: null | string
  preVoiceoverReadyPayload: null | PreVoiceoverScriptReadySignalPayload
  // -- Audio pipeline state (projected from events; cached to avoid O(n) scan) --
  preVoiceoverScriptReady: boolean

  // -- Main-loop consumption boundary (the event log is the queue; no
  //    pendingSignals/pendingToolResults staging). Signal handlers push
  //    directly to events; the main loop uses
  //    hasUnprocessedDecisionEvent(events, processedDecisionCount).
  processedDecisionCount: number

  // -- Core identity --
  projectId: string
  // -- Deduplication --
  seenActionIds: Set<string>
  workflowProtocolVersion?: string
}

// ---------------------------------------------------------------------------
// continueAsNew params
// ---------------------------------------------------------------------------

/**
 * State carried across continueAsNew. Must carry everything that cannot be
 * rebuilt from compacted events.
 */
export interface ContinueAsNewParams extends UipSessionWorkflowParams {
  // Unclaimed dispatched-action ids carried across continueAsNew so the new run
  // still clears the API's nextAction records (see WorkflowState.actionIdsToClaim).
  _v2ActionIdsToClaim?: string[]
  _v2ActiveToolCalls?: Array<{ childWorkflowId: string; toolCallId: string; toolName: string }>
  _v2BrandExtractionEnabled?: boolean
  _v2BrandExtractionPending?: boolean // whether the brand child is in flight (no event; must be carried)
  _v2CompactedEvents?: AgentEvent[] // compacted events (including the compaction boundary event)
  _v2CurrentArtifacts?: Record<string, ArtifactSlot> // artifact slots; spec re-derived from these in the new run
  // M1 fix: pendingBrandBrief has no corresponding event and must be carried
  // explicitly across continueAsNew, otherwise a brief submitted near the
  // compaction boundary is silently lost.
  _v2PendingBrandBrief?: BrandBriefSubmitSignalPayload | null
  _v2PlannerChainGroundingKey?: string // chain grounding fingerprint
  _v2PlannerChainSegment?: 'mode_confirmation' | 'post_confirmation' // chain segment
  _v2PlannerModel?: string // pinned planner A/B arm
  _v2PlannerOrphanedChainResponseIds?: string[] // orphan chain ids to clean up
  // No _v2PendingSignals -- pending signals are events, carried via
  // _v2CompactedEvents; the new run's processedDecisionCount is recomputed from
  // compacted events.
  _v2PlannerResponseId?: null | string // OpenAI Responses chain continuity
  _v2PreVoiceoverChildFailureMessage?: null | string
  _v2SeenActionIds?: string[]
}
