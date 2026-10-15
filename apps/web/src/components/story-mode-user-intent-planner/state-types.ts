import type { ModelSelectorAnalyticsTier } from '@reelmakeeasy/common/model-config/model-selector-analytics-tier'

import type { ActionEvent, StyleCandidate } from './adapter/api-types'
import type { ActiveModalKind } from './state/atoms/planner'

export type AffectedBlockKind =
  | 'anchor_asset_list'
  | 'audio_asset_list'
  | 'message_asset_list'
  | 'script_transcript'
  | 'storyboards'
  | 'video_brief_card'

export interface AnchorAssetListBlock {
  blockStatus: BlockStatus
  id: string
  items: AssetRef[]
  kind: 'anchor_asset_list'
}

export interface AssetRef {
  id: string
  label: string
  previewAssetId?: null | string
  previewUrl?: string
  // Generation outcome, carried from SessionChangedEventAnchorAsset.status. Only
  // anchor assets have one: an uploaded asset is a file the user already has, so it leaves this
  // undefined and reads as ready. It is what lets a run whose anchors all failed render
  // differently from one that planned none.
  status?: AssetStatus
  type: 'audio' | 'file' | 'img' | 'pdf' | 'txt' | 'video' | 'vo'
}

export type AssetStatus = 'failed' | 'generating' | 'planned' | 'ready'

export interface AssistantThinkingBlock {
  id: string
  kind: 'assistant_thinking'
}

export interface AudioAssetListBlock {
  id: string
  items: AssetRef[]
  kind: 'audio_asset_list'
}

export type BlockStatus = 'default' | 'outdated' | 'updated'

export interface BrandBriefAsset {
  // LLM summary from the brand-extraction describe-pass (<=120 chars).
  // Null when missing or on pre-BE-merge sessions where the BE didn't
  // populate the field. Used as the thumbnail's alt text.
  description: null | string
  id: string
  kind: 'character' | 'logo' | 'product'
  // Description for buffered adds. The planner's
  // guardUndescribedAssetsBeforeAction blocks PATCH_SPEC when any
  // staged asset has a null description, so we seed with file.name at
  // pick time to keep the agent unblocked.
  pendingDescription?: string
  // Relative store path captured at upload-time for buffered adds.
  // Set when remoteUri is null (asset not yet in bank); cleared after
  // Continue lands the add_asset patch and the bank rehydrates.
  pendingStorePath?: string
  previewUrl: string
  provenance: 'crawl' | 'user_upload'
  remoteUri: null | string
}

export interface BrandBriefDraft {
  aboutUsSummary: string
  assets: BrandBriefAsset[]
  businessName: string
  ctaHref: string
  ctaLabel: string
}

// FE-only draft for the Summary card's inline-editable fields.
// Never crosses the network -- Task 3 diffs it into a SummaryFieldEdit payload at send time.
export interface SummaryDraft {
  description: string
  directives: string[]
  mustNotViolate: string[]
}

// The style the user picked from a reused saved brief's own saved styles.
// Confirm applies it as the hybrid style; null when no saved
// style is chosen (fresh brief, or a saved brief with no styles).
export interface BrandSelectedSavedStyle {
  previewUrl: null | string
  styleText: null | string
}

export interface MessageAssetListBlock {
  id: string
  items: AssetRef[]
  kind: 'message_asset_list'
}

export interface MessageBlock {
  anchorAssets: AssetRef[]
  id: string
  kind: 'message'
  role: 'assistant' | 'user'
  // Canvas modal that was open when this message was sent.
  sentFrom?: ActiveModalKind
  text: string
  uploadedAssets: AssetRef[]
}

export interface PlannerFatalError {
  type: 'unauthorized'
}

export type PlannerPhase =
  | 'bootstrap_brand'
  | 'bootstrap_script'
  | 'bootstrap_visual'
  | 'brand_review'
  | 'mode_confirmation'
  | 'refinement'
  | 'script_review'

export interface RenderAutoLockGate {
  countdownShowAt?: string
  // Nullable: the refinement gate can be shown with no auto-lock
  // deadline (auto-continue off) -- the confirm button stays, countdown hides.
  deadlineAt: null | string
  hideCountdown?: boolean
  visible?: boolean
}

export interface RenderBrandReviewGate {
  // How a saved-library brief was attached. 'explicit' -- the user
  // picked it; 'auto_detect' -- it was matched from the prompt. Only meaningful
  // when fromSavedBrief is true; drives the gate-card wording.
  attachedVia: 'auto_detect' | 'explicit'
  fromSavedBrief: boolean
  gateToken: null | string
  visible: boolean
}

export interface RenderQueuedMessage {
  hasUploads: boolean
  id: string
  status?: 'pending' | 'sending'
  text: string
}

export interface RenderQuickOption {
  expectAssets?: boolean
  id: string
  text: string
}

export interface RenderScriptReviewGate {
  countdownShowAt?: string
  deadlineAt: null | string
  hideCountdown?: boolean
  visible?: boolean
}

export interface RenderScriptVersion {
  // ISO timestamp of the session_changed event that committed this text.
  committedAt: string
  // 'agent' = a planner/agent-generated script; 'user' = a GUI save (blur or Save button).
  source: 'agent' | 'user'
  text: string
}

export interface RenderState {
  anchorAssetsPool: AssetRef[]
  // True once a session_changed event has actually delivered an anchor asset list, empty or not.
  // An empty pool alone is ambiguous -- it covers both "the arm planned zero anchors"
  // and "the list has not arrived yet" -- and only the first should read as "none needed".
  anchorAssetsReceived?: boolean
  // Display-only aspect ratio the session was created with (Session.aspect_ratio).
  // Surfaced so the canvas Summary chips can show the true current
  // ratio; not persisted from here.
  aspectRatio?: string
  assetsPool: AssetRef[]
  assistantPrompt?: string
  // Per-session auto-continue setting, mirrored from
  // state.auto_continue_enabled. False = no review-gate timer runs; the
  // composer control both displays and flips it. Absent = true (legacy).
  autoContinueEnabled?: boolean
  autoLockGate?: RenderAutoLockGate
  blocks: TimelineRenderBlock[]
  brandExtractionStatus?: 'completed' | 'failed' | 'locked' | 'pending' | null
  brandReviewGate?: RenderBrandReviewGate
  // Display-only carried-forward default image model (Wave 4, spec D7):
  // the model this user's first PT-routed project rendered on, else the org
  // config default. Shown by the selector for a non-picker (empty `imageModel`)
  // WITHOUT being persisted, so PT-routing eligibility is preserved.
  carriedForwardImageModel?: string
  expectAssets?: boolean
  imageModel?: string
  isIdle: boolean
  isLocked: boolean
  isProcessing: boolean
  latest: RenderStateLatest
  modelSelectorTier?: ModelSelectorAnalyticsTier
  // Action submitted but not yet acknowledged (the last action event with status='pending'),
  // including the optimistic event the API bridge appends at click -- the earliest signal a
  // confirm is in flight. Self-reconciling; see adapter/optimistic-events.ts.
  pendingAction?: ActionEvent['action'] | null
  phase: PlannerPhase
  queuedMessages?: RenderQueuedMessage[]
  quickOptions: RenderQuickOption[]
  quickQuestionMessageId?: string
  // The planner's detected BCP-47 script language (`global_constraints.script_language`). Decides
  // which TTS engine renders a voiceover, so it also decides whether a stored preview take was
  // rendered by the right one -- see resolveStoredVoiceoverTake.
  scriptLanguage?: null | string
  scriptReviewGate?: RenderScriptReviewGate
  // All committed transcript versions, oldest-first. Derived from the
  // session_changed event stream (each distinct script.content), so it includes agent
  // rewrites AND user saves -- unlike `blocks`, where user saves are merged into the
  // current card. The last entry is the current text. Optional so existing RenderState
  // literals (defaults/fixtures) need no change; consumers read `?? []`.
  scriptVersions?: RenderScriptVersion[]
  /**
   * Staleness ledger snapshot: the latest session_changed event's
   * stale_artifacts, last-writer-wins across the event stream (see
   * buildStaleArtifactsFromEvents in timeline.ts). Rendering this list is out of
   * scope here -- this only carries it into RenderState for a later UI task.
   */
  staleArtifacts: Array<{
    artifact: 'anchor_bindings' | 'global_constraints' | 'script' | 'visual_script'
    dismissed: boolean
    since: string
    sourcePath: string
    tier: 'patch' | 'tool'
    urgency: 'confirm' | 'mandatory'
  }>
  status: SessionStatus
  // All committed Summary versions, oldest-first (mirrors scriptVersions above).
  // Derived from the session_changed event stream's global_constraints rather than the
  // video_brief_card blocks in `blocks`, so a passive GUI save (which re-projects the same
  // block in place) accrues its own version alongside agent revisions.
  summaryVersions?: RenderSummaryVersion[]
  toolCallStates: RenderToolCallState[]
  transitionVideoModel?: string
  uploadedAssetsPool: AssetRef[]
}

export interface RenderStateLatest {
  script?: RenderStateLatestScript
}

export interface RenderStateLatestScript {
  audioSource?: 'user_audio' | null
  audioUrl?: string
  text: string
}

export interface RenderSubStepState {
  description: string
  status: 'completed' | 'not_started' | 'running'
}

export interface RenderSummaryVersion {
  // The video_brief_card built from this event's global_constraints. Every entry shares the
  // fixed id 'item-video-brief-card' (build-blocks.ts), so callers address a version by its
  // ordinal in RenderState.summaryVersions, not block.id.
  block: VideoBriefCardBlock
  // ISO timestamp of the session_changed event that committed this state.
  committedAt: string
  // 'agent' = a planner/agent-generated summary; 'user' = a GUI save (blur or Save button).
  source: 'agent' | 'user'
}

export type RenderToolCallName =
  | 'anchor_vs_batch'
  | 'describe_uploaded_images'
  | 'generate_anchor_assets'
  | 'generate_brand_styling'
  | 'generate_explainer_script'
  | 'generate_explainer_visual_script'
  | 'generate_intent_context'
  | 'plan_asset_assignment'
  | 'select_auto_style'

// Mirrors the API's SessionChangedEventSubToolState (uip-timeline-types.ts): one entry per
// tool call (id matches the parent's own `tools` value, e.g. 'anchor_vs_batch'), whose
// subStepStates covers every arm of a batched call together with no arm tag on the wire.
// activitiesFor derives a per-section split from the substep names (see SectionArm).
export interface RenderSubTool {
  id: string
  subStepStates: Record<string, RenderSubStepState>
}

export interface RenderToolCallState {
  endedAt?: null | string
  errorCode?:
    | 'INVALID_INPUT'
    | 'MISSING_DEPENDENCY'
    | 'OUT_OF_SCOPE_MUTATION'
    | 'TOOL_RUNTIME_ERROR'
  id: string
  startedAt: string
  status: 'failed' | 'running' | 'succeeded'
  subTools?: RenderSubTool[]
  tools: RenderToolCallName[]
}

// Historical clarify Q&A collapsed into one recap bubble once resolved:
// the agent's question (sliced the same way as the live mirror, via question_index)
// paired with the user's `answer_to_message_id`-linked reply, replacing the two
// separate message blocks so the exchange reads as one neutral-tone bubble.
// answerAnchorAssets/answerUploadedAssets carry over the paired answer's asset
// tags (e.g. an @img[...] answer to an expect_assets question) so the recap can
// still render them inline instead of the raw tag string.
export interface QaRecapBlock {
  answer: string
  answerAnchorAssets: AssetRef[]
  answerUploadedAssets: AssetRef[]
  id: string
  kind: 'qa_recap'
  question: string
}

export interface ScriptTranscriptBlock {
  audioSource?: 'user_audio' | null
  audioUrl?: string
  blockStatus: BlockStatus
  guiRequestId?: string
  id: string
  kind: 'script_transcript'
  text: string
}

export type SessionStatus = 'active' | 'cancelled' | 'completed' | 'failed' | 'timed_out'

export interface StoryboardsBlock {
  blockStatus: BlockStatus
  id: string
  kind: 'storyboards'
  shots: StoryboardShot[]
}

export interface StoryboardShot {
  assets: AssetRef[]
  endSeconds?: number
  id: string
  shotNumber: number
  startSeconds?: number
  title: string
  voiceOver: string
}

export interface StoryModeQuickOption {
  expectAssets?: boolean
  id: string
  leadingLabel?: string
  text: string
}

export interface StoryModeQuickQuestionCardModel {
  expectAssets?: boolean
  id: string
  options: StoryModeQuickOption[]
  showCustomOption: boolean
  stepIndicator?: {
    current: number
    total: number
  }
  title: string
}

export type TimelineRenderBlock =
  | AssistantThinkingBlock
  | AudioAssetListBlock
  | MessageAssetListBlock
  | MessageBlock
  | QaRecapBlock
  | VersionedTimelineRenderBlock

export type VersionedTimelineRenderBlock =
  | AnchorAssetListBlock
  | BrandBriefCardBlock
  | ScriptTranscriptBlock
  | StoryboardsBlock
  | StyleCandidatesBlock
  | VideoBriefCardBlock

// Auto Style Selection: the agent-picked style candidates offered
// alongside the currently applied style. Only built while style_mode==='auto';
// once the session passes the visual-render lock (folded phase >= bootstrap_visual
// or locked_at is stamped) the card renders read-only (`readOnly: true`). Versioned
// like its sibling builders (video_brief_card, etc) so it goes through the same
// per-event outdated/updated tracking (session-view-adapter/timeline.ts).
export interface StyleCandidatesBlock {
  // The style currently applied to the project (global_constraints.style.style_name).
  // Used to highlight the active candidate; null before any style has been applied.
  appliedStyleName: null | string
  blockStatus: BlockStatus
  candidates: StyleCandidate[]
  id: string
  kind: 'style_candidates'
  // The tiles no longer accept a pick. Not a Locked badge: the agent can still
  // switch the style past this point.
  readOnly: boolean
}

/**
 * Placeholder Brand Brief card. Renders a JSON dump of the populated
 * brand_bank plus a "Confirm Brand Profile" button. The polished card
 * replaces this component later; the block shape lives here so the
 * timeline + builder are stable.
 */
export interface BrandBriefCardBlock {
  blockStatus: BlockStatus
  brandBank: null | unknown
  brandBankLockedAt: null | string
  failureReason: null | string
  // A saved brief reused from the org brand library (brand_bank_source.kind ===
  // 'brand_library'). It enters an EDITABLE brand_review; edits are
  // project-only apart from asset re-categorization, which the confirm writes back,
  // so the card shows a note scoped to that and the brief's own saved
  // styles picker.
  fromSavedBrief: boolean
  // Set when this card snapshot originated from a user GUI draft-edit flush.
  // Routing annotation only (excluded from diff); folded into the prior card so
  // GUI edits don't render as a separate Updated/Outdated version.
  guiRequestId?: string
  id: string
  kind: 'brand_brief_card'
  // The saved library brief this card was reused from (brand_bank_source.brief_id).
  // Lets the card fetch and display that brand's own saved styles.
  savedBriefId: null | string
  // The style the user currently has selected for this project (global_constraints
  // .style). Surfaced as a selected card in the brand-styles picker even when it's
  // a style from outside the brand.
  selectedStyleName: null | string
  selectedStyleText: null | string
  status: 'failed' | 'in_progress' | 'pending_input' | 'review_ready'
  styleThumbnailUrl: null | string
  title: string
}

export interface VideoBriefCardBlock {
  blockStatus: BlockStatus
  description: string
  directives: string[]
  durationSecondsFallback: null | number
  id: string
  kind: 'video_brief_card'
  longMetaItems: Array<{ label: string; value: string }>
  metaItems: Array<{ label: string; value: string }>
  mustNotViolate: string[]
  title: string
  videoType: string
}
