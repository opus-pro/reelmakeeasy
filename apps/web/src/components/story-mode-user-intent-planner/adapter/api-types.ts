import type { ModelSelectorAnalyticsTier } from '@reelmakeeasy/common/model-config/model-selector-analytics-tier'
import type { ProjectVoiceOverJson } from '@shared/types/api/project'

import type { ActiveModalKind } from '../state/atoms/planner'

export interface ActionEvent extends BaseEvent {
  action: 'cancel' | 'confirm' | 'confirm_fast' | 'continue'
  client_id?: string
  reject_reason?: 'word_cap_exceeded'
  status: ActionMutationStatus
  type: 'action'
}

export type ActionMutationStatus = 'accepted' | 'duplicated' | 'pending' | 'rejected'

export interface AnchorAssetSummaryItem {
  anchor_id: string
  label: string
  preview_asset_id?: null | string
  preview_relative_path?: null | string
  preview_url?: null | string
  source_asset_id: null | string
  source_asset_ids: string[]
  status: 'failed' | 'generating' | 'planned' | 'ready'
  type: 'CHARACTER' | 'OBJECT'
}

export interface AssistantMessageEvent extends BaseEvent {
  content: string
  expect_assets?: boolean
  message_id?: string
  options?: ClarifyOption[]
  question_index?: number
  type: 'assistant_message'
}

export interface BaseEvent {
  id: number
  ts: string
  type: string
}

export type BatchChanges =
  | (StateChanges & { kind: 'state' })
  | (TimelineChanges & { kind: 'timeline' })

export interface ClarifyOption {
  expect_assets?: boolean
  id: string
  label: string
}

export interface CreateSessionInput {
  aspect_ratio?: string
  // Client-measured uploaded-audio length in whole seconds, so the
  // backend knows the real length without re-measuring the file. Only sent
  // alongside audio_path.
  audio_duration_seconds?: number
  audio_path?: string
  // Preview transcript of the uploaded audio; the backend matches it (plus the
  // prompt) against the org's saved brand briefs so a spoken/pasted brand
  // reuses its saved brief instead of re-extracting.
  audio_transcript?: string
  // Story-mode "Background music" toggle at creation, gated on
  // enable_bgm by the FE. The API persists it onto the Project row.
  bgm_enabled?: boolean
  // Pre-UIP brand selection (Branding V2 M1): the explicitly chosen
  // brief id, plus any asset staging_uris the user removed from its chips.
  brand_brief_excluded_asset_uris?: string[]
  brand_brief_id?: string
  custom_style?: boolean
  /**
   * Debug panel overrides (admin/dev only), mirroring the classic create flow's
   * `debugSettings`. Today carries only the `llm` model-switch map (tool ->
   * scene -> model) read from localStorage; the backend persists it onto the
   * Project so the UIP transition stage honors the switch via `getModelName`.
   */
  debug_settings?: { llm?: Record<string, Record<string, string>> }
  enable_caption?: boolean
  /**
   * Creation tab / entry use case (`CreateUseCaseKey`, e.g. 'song-to-video').
   * Persisted on the session.
   */
  entry_use_case?: string
  initial_message?: string
  /**
   * Entry-point music declaration: true when the session was started from the
   * song-to-video use case with an uploaded audio file. The backend pins it
   * on the session and routes type classification straight to the music
   * route (gated by enable_music_video_improvement).
   */
  is_music?: boolean
  /** Final normalized quality tier selected when this Story Mode session was submitted. */
  model_selector_tier?: ModelSelectorAnalyticsTier
  /**
   * Client capability marker: true iff the submitting client
   * reconciled the brand-brief selector against the remix source before this
   * submission. Sent only alongside `remix_project_id`.
   */
  remix_brand_aware?: boolean
  /**
   * Source project ID when this UIP session is being created via Remix.
   * Backend authorizes the source, summarizes it, and seeds the summary
   * into the new session's `SessionState.bootstrap.remix_context`.
   */
  remix_project_id?: string
  seed_style_instruction?: {
    style_image_uri?: string
    style_name: string
    style_text: string
    style_thumbnail_url: string
  }
  selected_style_ref?: SelectedStyleRefPayload
  /**
   * Client-generated idempotency key for the create request. Minted
   * once per planner open and reused across retries so a duplicate/retried
   * create returns the already-created session instead of a second Project.
   */
  session_creation_id?: string
  /**
   * Composer's style seed mode (spec, "preset-only" V1). The backend
   * forces 'manual' when the `auto_style_selection` gate is off for this
   * user. Absent = 'manual'. The composer does not yet select this value
   * (wired in a later task); the field is plumbed ahead of that.
   */
  style_mode?: StyleMode
  uploaded_assets?: UploadedAsset[]
  voice?: ProjectVoiceOverJson
}

export interface GenerateUploadUrlsResult {
  uploads: Array<{
    assetId: string
    expiresAt: string
    fileUri: string
    index: number
    signedUrl: string
  }>
}

export interface GuiEditEvent extends BaseEvent {
  kind: 'script_edit'
  request_id: string
  status: 'handled' | 'pending'
  type: 'gui_edit'
}

export interface GuiUpdateInput {
  transcript?: string
  voice?: ProjectVoiceOverJson
  voice_preview_speed?: number
}

export type MessageEventEvent = AssistantMessageEvent | UserMessageEvent

export interface ModeState {
  confirmed: boolean
  duration_seconds: null | number
  mode: null | SessionMode
}

export interface OpenQuestion {
  blocking: boolean
  id: string
  missing_paths: string[]
  question: string
}

export type PlannerPhase =
  | 'bootstrap_brand'
  | 'bootstrap_script'
  | 'bootstrap_visual'
  | 'brand_review'
  | 'mode_confirmation'
  | 'refinement'
  | 'script_review'

export interface QueuedUserItem {
  created_at: string
  id: string
  message: string
  uploaded_assets: UploadedAsset[]
}

export interface ScriptReviewContext {
  global_constraints?: SessionGlobalConstraints
  script: string
}

// POST /uip-sessions/{id}/summary: passively merges edited
// Summary card fields into global_constraints. Only these three fields are
// honored by the backend.
export interface SummaryUpdateInput {
  globalConstraints: {
    directives?: string[]
    must_not_violate?: string[]
    topic?: string
  }
  requestId?: string
}

// Reference to the user's pre-UIP style pick, carried to the session so a saved
// brand brief can reference it at confirm.
export interface SelectedStyleRefPayload {
  kind: 'custom' | 'preset'
  presetId?: string
  userSavedStyleId?: string
}

export interface Session {
  aspect_ratio: null | string
  /**
   * Display-only carried-forward default image model (Wave 4, spec D7):
   * the model this user's first PT-routed project rendered on, else the org
   * config default. The selector shows this for a non-picker (empty
   * `image_model`) WITHOUT persisting it, so PT-routing eligibility is preserved.
   */
  carried_forward_image_model?: null | string
  created_at: string
  image_model?: null | string
  locked_at: null | string
  model_selector_tier?: ModelSelectorAnalyticsTier
  phase: PlannerPhase
  session_id: string
  spec_version: number
  state?: StateChanges['state']
  state_version?: number
  status: SessionStatus
  timeline: TimelineFile
  transition_video_model: null | string
  updated_at: string
  voice?: null | ProjectVoiceOverJson
  voice_id: null | string
}

export interface SessionChangedEvent extends BaseEvent, Partial<SessionState> {
  // Event-only routing annotation for a user GUI draft-edit flush (brand brief).
  // Not part of SessionState, so it is never carried forward onto later events;
  // the brand card built for this one event is folded into the prior version.
  gui_request_id?: string
  /**
   * Staleness ledger snapshot. Absent on a partial update means
   * "unchanged"; an explicit `[]` means the ledger is empty. Do not collapse
   * the two -- treating absent as empty clobbers the list on every unrelated
   * status tick.
   */
  stale_artifacts?: Array<{
    artifact: 'anchor_bindings' | 'global_constraints' | 'script' | 'visual_script'
    dismissed: boolean
    since: string
    source_path: string
    tier: 'patch' | 'tool'
    urgency: 'confirm' | 'mandatory'
  }>
  /** Delta only: new or updated entries since last event. Accumulated by id on replay. */
  tool_call_states?: SessionState['tool_call_states']
  type: 'session_changed'
}

export interface SessionChangedEventAnchorAsset {
  anchor_id: string
  label: string
  preview_asset_id?: null | string
  preview_relative_path?: null | string
  /** A ready-made URL beside the relative path, when the payload carries one. Preferred. */
  preview_url?: null | string
  source_asset_ids: string[]
  status: 'failed' | 'generating' | 'planned' | 'ready'
  type: 'CHARACTER' | 'OBJECT'
}

export interface SessionChangedEventGlobalConstraints {
  brand_bank?: null | unknown
  brand_bank_locked_at?: null | string
  brand_bank_source?: null | {
    // How the saved brief was attached: 'explicit' -- picked
    // in the pre-UIP selector; 'auto_detect' -- matched from the prompt via
    // enable_brand_reuse. Optional: legacy snapshots read as undefined and are
    // treated as 'explicit' (the older silent path).
    attached_via?: 'auto_detect' | 'explicit'
    brief_id: string
    kind: 'brand_library'
  }
  brand_extraction_failure_reason?: null | string
  brand_extraction_input?: null | { kind: 'freeform'; text: string } | { kind: 'url'; url: string }
  brand_extraction_status?: 'completed' | 'failed' | 'locked' | 'pending' | null
  brand_scope?: string
  brand_style_directive?: 'hybrid' | 'keep_existing_style' | null
  brand_style_preview_url?: null | string
  directives: string[]
  geo_scope?: string
  key_entities?: string[]
  must_not_violate: string[]
  pacing: null | string
  script_category?: SessionScriptCategory
  // See SessionGlobalConstraints.script_language -- the diff ships global_constraints whole, so the
  // event carries it too.
  script_language?: string
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
  time_scope?: string
  tone: string
  topic: string
  video_type: string
  voice_actor?: string
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
  pre_selected_assets?: Array<{
    asset_id: string
    source: 'anchor_asset' | 'user_upload'
  }>
  shot_id: string
  /** ASR-aligned shot timing from the spec; absent only for legacy specs persisted without it. */
  time?: { end_s: number; start_s: number }
  visual_primary: { core_description: string }
}

export interface SessionChangedEventUploadedAsset {
  asset_id: string
  content_type: string
  file_name: string
  file_path: string
  preview_asset_id?: null | string
  preview_url?: null | string
  uploaded_at?: string
}

export type SessionChangedReviewGate =
  | { options?: Array<{ id: string }>; status: 'opened'; token?: string }
  | { status: 'closed' }

export type SessionChangedScript = { content: string; gui_request_id?: string }

export interface SessionCreateResult {
  session_id: string
}

export interface SessionGlobalConstraints {
  // Brand extraction fields. Untyped on the FE side --
  // the Brand Brief card dumps the populated bank as JSON, so we accept
  // `unknown` here.
  brand_bank?: null | unknown
  brand_bank_locked_at?: null | string
  brand_bank_source?: null | {
    // How the saved brief was attached: 'explicit' -- picked
    // in the pre-UIP selector; 'auto_detect' -- matched from the prompt via
    // enable_brand_reuse. Optional: legacy snapshots read as undefined and are
    // treated as 'explicit' (the older silent path).
    attached_via?: 'auto_detect' | 'explicit'
    brief_id: string
    kind: 'brand_library'
  }
  brand_extraction_failure_reason?: null | string
  brand_extraction_input?: null | { kind: 'freeform'; text: string } | { kind: 'url'; url: string }
  brand_extraction_status?: 'completed' | 'failed' | 'locked' | 'pending' | null
  brand_scope: string
  brand_style_directive?: 'hybrid' | 'keep_existing_style' | null
  directives: string[]
  geo_scope: string
  key_entities: string[]
  must_not_violate: string[]
  pacing: null | string
  script_category?: SessionScriptCategory
  // The planner's detected BCP-47 tag (`GlobalConstraintsSchema.script_language`). It ships whole
  // on the session_changed diff -- uip-session-changed-diff treats global_constraints as one JSON
  // key with no field allowlist -- so it already reached the client before anything typed it here.
  script_language?: string
  selection_method?: StyleSelectionMethod
  style: {
    style_name: string
    style_text: string
    style_thumbnail_url: string
  }
  style_candidates?: StyleCandidate[]
  style_mode?: StyleMode
  style_source?: StyleSource
  target_audience: string
  time_scope: string
  tone: string
  topic: string
  video_type: string
  voice_actor?: string
}

export type SessionMeta = Pick<Session, 'phase' | 'session_id' | 'status'>

export type SessionMode = 'ads' | 'explainer' | 'narrative_story'
export type SessionScriptCategory = 'concept_centric' | 'object_centric'

export interface SessionShotAssetRef {
  asset_id: string
  source?: 'anchor_asset' | 'user_upload'
  usage?: string
}

export interface SessionShotTime {
  end_s: number
  start_s: number
}

export interface SessionSpec {
  global_constraints: SessionGlobalConstraints
  meta: SessionSpecMeta
  visual_script: SessionVisualScript
}

export interface SessionSpecMeta {
  audio_source?: 'user_audio' | null
  auto_lock_deadline_at?: null | string
  blocking?: boolean
  locked_at?: null | string
  mode_state: ModeState | null
  open_questions?: OpenQuestion[]
  spec_version?: number
}

export interface SessionState {
  anchor_assets: null | SessionChangedEventAnchorAsset[]
  audio_path: null | string
  audio_source: 'user_audio' | null
  /**
   * A ready-made URL beside `audio_path` on the `session_changed` event, when
   * the payload carries one. Preferred over composing from the path.
   *
   * An address only. `audio_path` stays the identity: this URL's query string
   * can change between reads, so a cache key, React key, or `store://` round-trip
   * built from it churns -- and, being percent-encoded, does not round-trip at all.
   */
  audio_url?: null | string
  auto_lock_deadline_at: null | string
  global_constraints: Partial<SessionChangedEventGlobalConstraints>
  is_idle: boolean
  is_processing: boolean
  // Declared nullable to match the event type; the live backend maps unlocked
  // to undefined, so consumers must tolerate '', null, and undefined alike.
  locked_at: null | string
  mode_state: null | SessionChangedEventModeState
  phase: null | PlannerPhase
  queued_items: SessionChangedEventQueuedItem[]
  review_auto_continue_deadline_at: null | string
  review_gate: null | SessionChangedReviewGate
  script: null | SessionChangedScript
  script_word_cap_exceeded: boolean | null
  shots: SessionChangedEventShot[]
  spec_version: number
  status: SessionStatus
  tool_call_states: SessionToolCallState[]
  uploaded_assets: SessionChangedEventUploadedAsset[]
}

export type SessionStatus = 'active' | 'cancelled' | 'completed' | 'failed' | 'timed_out'

export interface SessionStatusResult {
  status: ActionMutationStatus
}

export interface SessionSubstepState {
  description: string
  status: 'completed' | 'not_started' | 'running'
}

export interface SessionSubToolState {
  id: string
  sub_step_states: Record<string, SessionSubstepState>
}

export interface SessionToolCallState {
  ended_at?: null | string
  error_code?:
    | 'INVALID_INPUT'
    | 'MISSING_DEPENDENCY'
    | 'OUT_OF_SCOPE_MUTATION'
    | 'TOOL_RUNTIME_ERROR'
  id: string
  started_at: string
  status: 'failed' | 'running' | 'succeeded'
  /** Publish-only substep progress; never present in persisted snapshots. */
  sub_tools?: SessionSubToolState[]
  tools: Array<
    | 'anchor_vs_batch'
    | 'describe_uploaded_images'
    | 'generate_anchor_assets'
    | 'generate_brand_styling'
    | 'generate_explainer_script'
    | 'generate_explainer_visual_script'
    | 'generate_intent_context'
    | 'plan_asset_assignment'
    | 'select_auto_style'
  >
}

export interface SessionTranscriptEntry {
  content: string
  expect_assets?: boolean
  options?: ClarifyOption[]
  phase?: PlannerPhase
  role: 'assistant' | 'user'
  spec_version?: number
  timestamp?: string
  uploaded_assets?: UploadedAsset[]
}

export interface SessionVisualPrimary {
  aesthetic_mode?: 'Composited Graphic' | 'Live Action' | 'UI-Infographic'
  availability?: 'HIGH' | 'LOW' | 'MED'
  core_description: string
  entry_action?: null | string
  exit_action?: null | string
  expression_type?: 'Cultural Context' | 'Literal' | 'Symbolic'
  notes?: string[]
}

export interface SessionVisualScript {
  shots: SessionVisualShot[]
}

export interface SessionVisualShot {
  audio_vo: string
  order: number
  pre_selected_assets?: SessionShotAssetRef[]
  shot_id: string
  time?: SessionShotTime
  visual_primary?: SessionVisualPrimary
}

export interface StateChanges {
  state: {
    // Per-session auto-continue setting. False = no review gate arms
    // a timer; flipped mid-session via the composer control (PATCH session).
    auto_continue_enabled?: boolean
    input_inbox?: {
      records: UipMessageRecord[]
    }
    is_idle?: boolean
    is_running_planner_loop?: boolean
    operate_at?: Record<string, string>
    pending_action?: 'cancel' | 'confirm' | 'confirm_fast' | 'continue' | null
    phase?: PlannerPhase
    preview_voiceover?: null | StatePreviewVoiceover
    review_gate?: {
      auto_lock_deadline_at?: null | string
      review_auto_continue_deadline_at?: null | string
      token?: string
    }
    status?: SessionStatus
    transcript?: {
      editing_at?: Record<string, string>
    }
    voice_preview_speed?: number
    workflow_protocol_version?: string
  }
  version: number
}

/**
 * The last persisted transcript voice preview, written by the API's /transcript-voice-preview
 * handler. Session state reaches the client unprojected, so fields can be added here without a
 * server change. `audio_path` is storage-relative and already rooted at `user-intent-planner/` --
 * resolve it with `resolveAudioUrlFromPath`, never by joining strings.
 *
 * `provider` and `pronunciation_dict` are what the TTS service *resolved*, not what was requested:
 * provider is normalized, and the dict absorbs inline `{word|pron}` markers found in the text.
 * `voice_id` does round-trip the request.
 */
export interface StatePreviewVoiceover {
  audio_duration_seconds?: number
  audio_path?: string
  /** A ready-made URL beside `audio_path`, when the payload carries one. Preferred. */
  audio_url?: null | string
  content_type?: 'audio/mpeg' | 'audio/wav'
  pronunciation_dict?: string[]
  provider?: string
  script_text?: string
  speed?: number
  voice_id?: string
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

export type TimelineEvent = ActionEvent | GuiEditEvent | MessageEventEvent | SessionChangedEvent

export interface TimelineFile {
  events: TimelineEvent[]
  next_event_id: number
  version: number
}

export type UipInputStatus = 'pending' | 'sending'

export interface UipMessageRecord {
  answer_to_message_id?: string
  client_message_id?: string
  created_at: string
  dispatch_at?: string
  id: string
  message: string
  /** Canvas Edit modal open when this message was sent. */
  sent_from?: ActiveModalKind
  status: UipInputStatus
  uploaded_assets?: UploadedAsset[]
}

// POST /uip-sessions/{id}/style (Auto Style Selection): applies a user-chosen
// style candidate as the session's style. The backend stamps
// style_source='auto_switched'. NB: the candidate carries `thumbnail_url`; the
// applied style (and this payload) uses `style_thumbnail_url`.
export interface UpdateScriptReviewInput {
  gate_token: string
  global_constraints?: Partial<SessionChangedEventGlobalConstraints>
  script?: string
}

export interface UpdateStyleInput {
  style_name: string
  style_text: string
  style_thumbnail_url: string
}

// POST /uip-sessions/{id}/auto-continue: flips the mutable
// auto-continue setting mid-session from the in-session composer control.
export interface SetAutoContinueInput {
  auto_continue_enabled: boolean
}

export interface UploadedAsset {
  asset_id: string
  content_type: string
  file_name: string
  file_path: string
  preview_asset_id?: null | string
  preview_url?: null | string
  uploaded_at?: string
}

export interface UploadFileDescriptor {
  contentType: string
  fileName: string
  index: number
}

export interface UserMessageEvent extends BaseEvent {
  answer_to_message_id?: string
  /** Frontend-generated idempotency key. Only present in SSE push, never persisted to DB. */
  client_id?: string
  message: string
  message_id: string
  /** Canvas modal open at send time, echoed by the backend. */
  sent_from?: ActiveModalKind
  status: 'handled' | 'pending' | 'unqueued'
  type: 'user_message'
  uploaded_assets?: SessionChangedEventUploadedAsset[]
  /** Original user-send timestamp. `ts` may later be updated to handled timeline time; read as `uts ?? ts`. */
  uts?: string
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

/** Type-safe partial update for an existing event -- id required, all other fields optional. */
export type TimelineEventPatch = TimelineEvent extends infer E
  ? E extends BaseEvent
    ? Partial<Omit<E, 'id'>> & Pick<E, 'id'>
    : never
  : never

export type TimelineSessionChangedAnchorAsset = SessionChangedEventAnchorAsset
export type TimelineSessionChangedEvent = SessionChangedEvent
