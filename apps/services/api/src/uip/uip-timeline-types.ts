/**
 * Timeline event types for storage projects/{projectId}/user-intent-planner/timeline.json.
 *
 * Writers:
 *   - UserMessageEvent: uip.service.ts sendMessage() -- immediate
 *   - AssistantMessageEvent: uip.service.ts persistFromCallback() -- turn end
 *   - SessionChangedEvent: uip.service.ts publishStatusFromCallback() + persistFromCallback()
 */

import type {
  ActiveModalKind,
  BrandBankEditSignalPayload,
  PlannerPhase,
  PlannerToolCall,
  SessionStatus,
  ToolErrorCode,
} from '@reelmakeeasy/uip-planner-runtime'
import type { DistributiveOmit } from '@shared/types/api/common/type-util'

// ---------------------------------------------------------------------------
// Input inbox types (followup/steering only; answers/actions use separate paths)
// ---------------------------------------------------------------------------

/** Lifecycle stage of a message record in the input inbox. */
export type UipInputStatus = 'pending' | 'sending'

/** A single user message waiting to be materialized into the timeline. */
export type UipMessageRecord = {
  answer_to_message_id?: string
  /** GUI brand-brief draft edits flushed with this message. */
  brandDraftEdits?: BrandBankEditSignalPayload[]
  client_message_id?: string
  created_at: string
  /** Set when status transitions sending -> pending (dispatch time). */
  dispatch_at?: string
  id: string
  message: string
  /** Canvas Edit modal open when this message was sent. */
  sent_from?: ActiveModalKind
  status: UipInputStatus
  uploaded_assets?: unknown[]
}

/** Execution identity triple used when materializing inbox records to timeline. */
export type UipExecutionMeta = {
  attempt: number
  exec_id: string
  turn_id?: string
}

/**
 * Authoritative decision returned by POST /uip-sessions/internal/trigger-next-action.
 * Priority: cancel > confirm > continue > user_message > idle.
 */
export type NextActionDecision =
  | { action: 'cancel' }
  | { action: 'confirm' }
  | { action: 'confirm_fast' }
  | { action: 'continue' }
  | { action: 'idle' }
  | { action: 'user_messages'; messages: NextActionMessage[] }

export type NextActionMessage = {
  answer_to_message_id?: string
  brandDraftEdits?: BrandBankEditSignalPayload[]
  client_message_id?: string
  message: string
  record_id: string
  sent_at: string
  sent_from?: ActiveModalKind
  uploaded_assets?: Array<{
    asset_id: string
    content_type: string
    file_name: string
    file_path: string
  }>
}

/**
 * Durable record of the next action written by selectNextAction.
 * Written atomically with the state mutation; used to make trigger-next-action idempotent.
 * - record present: signal may not have reached the workflow yet; resend on retry.
 * - record absent (null): the workflow called /claim-next-action and cleared it, action is done.
 */
export type NextActionRecord = {
  created_at: string
  decision: NextActionDecision
  id: string
}

// ---------------------------------------------------------------------------
// Session state (uipSession.state JSON field)
// ---------------------------------------------------------------------------

/**
 * High-frequency runtime state stored in uipSession.state.
 * Updated with optimistic locking via stateVersion.
 */
export type UipSessionState = {
  // Mirrors spec.meta.audio_source for fast guards without storage reads.
  audio_source?: 'user_audio' | null
  // Per-session auto-continue setting, projected by foldSession from
  // the session_initialized snapshot. When false, the API-side deadline writers
  // must not re-arm review_auto_continue_deadline_at / auto_lock_deadline_at --
  // the workflow never fires them, so a written deadline is a phantom countdown.
  auto_continue_enabled?: boolean
  brand_telemetry?: null | { brief_edit_count?: number; files_uploaded_count?: number }
  // Staging queue for user messages before they are materialized to the timeline.
  // Followup/steering only; answers and action intents use separate paths.
  input_inbox?: { records: UipMessageRecord[] }
  // True while workflow is at await condition (waiting for signals). Written by publishStatusFromCallback.
  // Surfaced to the frontend via kind:'state' SSE to drive idle/processing render state.
  is_idle?: boolean
  // True while the planner loop is actively running inside an activity turn. Written by publishStatusFromCallback.
  // Used by the frontend to show a processing indicator without waiting for a full REST poll.
  is_running_planner_loop?: boolean
  // { [client_id]: ISO string } -- last active operation per client, used for AFK detection.
  operate_at?: Record<string, string>
  // Which user action is currently optimistically pending (cancel/confirm/continue).
  // Cleared when the action is resolved to accepted or rejected via workflow callback.
  pending_action?: 'cancel' | 'confirm' | 'confirm_fast' | 'continue' | null
  // Set to 'deadline' when pending_action was written by the deadline resolver.
  // Absent/null means the action was initiated by the user endpoint.
  pending_action_source?: 'deadline' | null
  // Current planner phase; SOT. Prisma phase column is synced atomically by withSessionLock.
  phase?: string
  preview_voiceover?: null | {
    audio_duration_seconds?: number
    audio_path: string
    byte_length: number
    // Gemini previews are WAV; the extension of `audio_path` follows this.
    content_type: 'audio/mpeg' | 'audio/wav'
    generated_at: string
    model: string
    normalized_text: string
    pronunciation_dict?: string[]
    provider: 'byteplus' | 'elevenlabs' | 'fal' | 'gemini' | 'kokoro' | 'minimax' | 'qwen3'
    resolved_voice_id?: string
    script_text: string
    speed: number
    voice_id: string
  }
  review_gate?: {
    // Refinement auto-lock deadline managed as backend state SOT.
    auto_lock_deadline_at?: null | string
    // Script-review auto-continue deadline managed as backend state SOT.
    review_auto_continue_deadline_at?: null | string
    // Current script_review gate token, synced from session state on persist callback.
    token?: string
  }
  // Mirrors spec.meta.script_word_cap.exceeded for fast guards without storage reads.
  // Null means not yet audited (pre-script or audio-mode session).
  script_word_cap_exceeded?: boolean | null
  // Session lifecycle status; SOT. Prisma status column is synced atomically by withSessionLock.
  status?: 'active' | 'cancelled' | 'completed' | 'failed' | 'timed_out'
  transcript?: {
    // { [client_id]: ISO string } -- all clients stale means nobody is editing.
    editing_at?: Record<string, string>
  }
  // Current transcript voice-preview speed selected in the UI. Used at confirm
  // time so direct Generate honors edits that were not manually regenerated.
  voice_preview_speed?: number
  // UTC ISO timestamp written at session creation. Used to branch old vs new session behavior.
  workflow_protocol_version?: string
  // Pinned UIP workflow version written at session creation (always 'v2' now).
  // SOT for later signal-routing and the stuck-session sweep to address the right workflow id.
  workflow_version?: 'v1' | 'v2'
}

/** SSE event pushed on state writes. Version filled in by withSessionLock. */
export interface StateChanges {
  state: Partial<UipSessionState>
  version: number
}

// ---------------------------------------------------------------------------
// Session lock types (used by withSessionLock in uip-session-lock.ts)
// ---------------------------------------------------------------------------

export type SessionLockInput = {
  nextAction: NextActionRecord | null
  state: UipSessionState
  timeline: TimelineFile
}

export type SessionLockOutputWrite = {
  nextAction: 'abandon' | NextActionRecord | null
  state: 'abandon' | null | UipSessionState
  timeline: 'abandon' | null | Omit<TimelineFile, 'version'>
}

export type VersionedKey = 'nextAction' | 'state' | 'timeline'

/**
 * SSE events to push after a successful lock write.
 * version and next_event_id are omitted -- withSessionLock fills them in.
 */
export interface ActionEvent extends BaseEvent {
  action: 'cancel' | 'confirm' | 'confirm_fast' | 'continue'
  /** Frontend-generated idempotency key. Only present in SSE push, never persisted to storage. */
  client_id?: string
  reject_reason?: 'word_cap_exceeded'
  status: 'accepted' | 'pending' | 'rejected'
  type: 'action'
}

export interface AssistantMessageEvent extends BaseEvent {
  attempt?: number
  content: string
  /** Activity execution id that materialized this message. */
  exec_id?: string
  expect_assets?: boolean
  message_id?: string
  options?: Array<{ expect_assets?: boolean; id: string; label: string }>
  question_index?: number
  turn_id?: string
  type: 'assistant_message'
}

export interface BaseEvent {
  id: number
  ts: string
  type: string
}

export interface GuiEditEvent extends BaseEvent {
  kind: GuiEditKind
  request_id: string
  status: 'handled' | 'pending'
  type: 'gui_edit'
}

export type GuiEditKind = 'script_edit'

export interface SessionChangedEvent extends BaseEvent {
  anchor_assets?: SessionChangedEventAnchorAsset[]
  audio_path?: string
  audio_source?: 'user_audio' | null
  auto_lock_deadline_at?: null | string
  global_constraints?: SessionChangedEventGlobalConstraints
  // Event-only marker for a brand-brief GUI draft-edit flush. Not part of the
  // persisted session state, so it is never carried forward onto later events.
  gui_request_id?: string
  is_idle?: boolean
  is_processing?: boolean
  is_running_planner_loop?: boolean
  locked_at?: string
  mode_state?: SessionChangedEventModeState
  phase?: PlannerPhase
  queued_items?: SessionChangedEventQueuedItem[]
  review_auto_continue_deadline_at?: null | string
  review_gate?: { status: 'closed' } | { status: 'opened'; token?: string }
  script?: { content: string; gui_request_id?: string }
  /**
   * Whether the latest script content exceeds the TTS 450-word cap.
   * Mirrors `spec.meta.script_word_cap.exceeded`. Frontend uses this to
   * surface the trim banner without paying a storage read for `spec.json`.
   * Null until the cap has been audited at least once.
   */
  script_word_cap_exceeded?: boolean | null
  shots?: SessionChangedEventShot[]
  spec_version?: number
  stale_artifacts?: SessionChangedEventStaleEntry[]
  status?: SessionStatus
  /** Delta only: new or updated entries since last event. Accumulated by id on replay. */
  tool_call_states?: SessionChangedEventToolCallState[]
  type: 'session_changed'
  uploaded_assets?: SessionChangedEventUploadedAsset[]
}

export interface SessionChangedEventAnchorAsset {
  anchor_id: string
  label: string
  preview_asset_id?: null | string
  preview_relative_path?: null | string
  source_asset_ids: string[]
  status: 'failed' | 'generating' | 'planned' | 'ready'
  type: 'CHARACTER' | 'OBJECT'
}

export interface SessionChangedEventGlobalConstraints {
  brand_bank?: null | unknown
  brand_bank_locked_at?: null | string
  brand_bank_source?: null | { brief_id: string; kind: 'brand_library' }
  brand_extraction_failure_reason?: null | string
  brand_extraction_input?: null | { kind: 'freeform'; text: string } | { kind: 'url'; url: string }
  brand_extraction_run_id?: null | string
  brand_extraction_started_at?: null | string
  brand_extraction_status?: 'completed' | 'failed' | 'locked' | 'pending' | null
  brand_style_directive?: 'hybrid' | 'keep_existing_style' | null
  brand_style_preview_url?: null | string
  brand_video_type?: 'friction_to_flow' | 'industry_explainer' | 'product_showcase' | null
  directives: string[]
  must_not_violate: string[]
  pacing: null | string
  selection_method?: StyleSelectionMethod
  style: {
    style_name?: string
    style_text?: string
    style_thumbnail_url?: string
  }
  style_candidates?: StyleCandidate[]
  style_mode?: StyleMode
  style_source?: StyleSource
  target_audience: string
  tone: string
  topic: string
  video_type: string
}

export interface SessionChangedEventModeState {
  confirmed: boolean
  duration_seconds: null | number
  input_type?:
    | 'audio_music'
    | 'audio_script'
    | 'prompt_and_script'
    | 'prompt_only'
    | 'script_only'
    | null
  mode: 'ads' | 'explainer' | 'narrative_story' | null
}

export interface SessionChangedEventQueuedItem {
  created_at: string
  id: string
  message: string
  uploaded_assets: SessionChangedEventUploadedAsset[]
}

export interface SessionChangedEventShot {
  audio_vo: string
  order: number
  pre_selected_assets?: Array<{ asset_id: string; source: string }>
  shot_id: string
  /** ASR-aligned shot timing from the spec; absent only for legacy specs persisted without it. */
  time?: { end_s: number; start_s: number }
  visual_primary: { core_description: string }
}

export interface SessionChangedEventSubstepState {
  description: string
  status: 'completed' | 'not_started' | 'running'
}

export interface SessionChangedEventSubToolState {
  id: string
  sub_step_states: Record<string, SessionChangedEventSubstepState>
}

export interface SessionChangedEventToolCallState {
  ended_at?: null | string
  error_code?: ToolErrorCode
  id: string
  started_at: string
  status: 'failed' | 'running' | 'succeeded'
  /** Publish-only substep progress; never present in persisted snapshots. */
  sub_tools?: SessionChangedEventSubToolState[]
  tools: PlannerToolCall['tool'][]
}

export interface SessionChangedEventUploadedAsset {
  asset_id: string
  content_type: string
  file_name: string
  file_path: string
}

export type SessionLockEvent =
  | (Omit<StateChanges, 'version'> & { kind: 'state' })
  | (Omit<TimelineChanges, 'next_event_id' | 'version'> & { kind: 'timeline' })

export type SessionLockOutput<K extends VersionedKey> = {
  changes: SessionLockEvent[]
  write: Pick<SessionLockOutputWrite, K>
}

export interface SessionLockWriteResult {
  nextAction?: { value: NextActionRecord | null; version: number }
  state?: { value: UipSessionState; version: number }
  timeline?: { value: TimelineFile; version: number }
}

/** Agent-picked style candidate offered alongside the applied `style` (Auto Style Selection). */
export interface StyleCandidate {
  is_top_pick: boolean
  label: string
  rationale?: string
  style_name: string
  style_text: string
  /** NB: candidate uses `thumbnail_url`; the applied style uses `style_thumbnail_url`. */
  thumbnail_url: string
}

/** Whether the user is letting the agent auto-pick the style, or has taken manual control. */
export type StyleMode = 'auto' | 'manual'

/** How the applied style was chosen. */
export type StyleSelectionMethod = 'fallback_default' | 'heuristic_fallback' | 'llm' | 'user_prompt'

/** Provenance of the applied style: agent auto-pick, agent auto-switch, or user override. */
export type StyleSource = 'auto' | 'auto_switched' | 'manual'

export type TimelineEvent =
  | ActionEvent
  | AssistantMessageEvent
  | GuiEditEvent
  | SessionChangedEvent
  | UserMessageEvent

/** Input shape for new events -- id is assigned during timeline lock writes. */
export type TimelineEventInput = DistributiveOmit<TimelineEvent, 'id'>

/** Type-safe partial update for an existing event -- id required, all other fields optional. */
export type TimelineEventPatch = TimelineEvent extends infer E
  ? E extends BaseEvent
    ? Partial<Omit<E, 'id'>> & Pick<E, 'id'>
    : never
  : never

export interface TimelineFile {
  events: TimelineEvent[]
  /** Next auto-increment event id. Initial value is 1 (first event id is 1). */
  next_event_id: number
  version: number
}

/** Incremental patch pushed via SSE timeline_changes. */
export interface TimelineChanges {
  /** New events appended this write (with assigned numeric ids). */
  append: TimelineEvent[]
  /** The next event id after applying these changes. */
  next_event_id: number
  /** Partial updates to existing events, matched by numeric event id. */
  update: TimelineEventPatch[]
  /** Resulting version after applying these changes. */
  version: number
}

/**
 * One staleness ledger entry as the frontend sees it. A flattened,
 * display-oriented view of `spec.meta.stale_artifacts[]` -- `required_params`
 * and `discharge_paths` are deliberately omitted: they are planner-facing
 * mechanics with no UI meaning.
 *
 * `enforceable` is NOT projected. It is derived from the live session (phase,
 * artifact existence, action guards) and a snapshot of it in an SSE event goes
 * stale the moment the phase advances.
 */
export interface SessionChangedEventStaleEntry {
  artifact: 'anchor_bindings' | 'global_constraints' | 'script' | 'visual_script'
  dismissed: boolean
  since: string
  source_path: string
  tier: 'patch' | 'tool'
  urgency: 'confirm' | 'mandatory'
}

/** Input shape for building a SessionChangedEvent -- all fields optional, only changed fields are written. */
export interface SessionChangedEventInput {
  anchor_assets?: SessionChangedEventAnchorAsset[]
  audio_path?: string
  audio_source?: 'user_audio' | null
  auto_lock_deadline_at?: null | string
  global_constraints?: SessionChangedEventGlobalConstraints
  gui_request_id?: string
  is_idle?: boolean
  is_processing?: boolean
  is_running_planner_loop?: boolean
  locked_at?: string
  mode_state?: SessionChangedEventModeState
  phase?: PlannerPhase
  queued_items?: SessionChangedEventQueuedItem[]
  review_auto_continue_deadline_at?: null | string
  review_gate?: SessionChangedEvent['review_gate']
  script?: { content: string; gui_request_id?: string }
  script_word_cap_exceeded?: boolean | null
  shots?: SessionChangedEventShot[]
  spec_version?: number
  stale_artifacts?: SessionChangedEventStaleEntry[]
  status?: SessionStatus
  tool_call_states?: SessionChangedEvent['tool_call_states']
  uploaded_assets?: SessionChangedEventUploadedAsset[]
}

export interface UserMessageEvent extends BaseEvent {
  answer_to_message_id?: string
  attempt?: number
  /** Frontend-generated idempotency key. Only present in SSE push, never persisted to DB. */
  client_id?: string
  /** Activity execution id that materialized this message. */
  exec_id?: string
  message: string
  message_id: string
  /** Canvas Edit modal open when this message was sent. */
  sent_from?: ActiveModalKind
  status: 'handled' | 'pending' | 'unqueued'
  turn_id?: string
  type: 'user_message'
  uploaded_assets?: Array<{
    asset_id: string
    content_type: string
    file_name: string
    file_path: string
  }>
  /** Original user-send timestamp. `ts` may later be updated to handled timeline time; read as `uts ?? ts`. */
  uts?: string
}
