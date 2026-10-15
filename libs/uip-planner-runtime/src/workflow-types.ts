/**
 * UIP Workflow signal payload types.
 *
 * Defined here in @reelmakeeasy/uip-planner-runtime so the API layer can import
 * them without depending on @reelmakeeasy/story-mode-runtime (module boundary).
 * The story-mode-runtime workflow re-exports from here.
 */

import type { VoiceProfile } from '@shared/types/api/voice-profile'
import type { ModelSelectorAnalyticsTier } from '@shared/types/model-selector-analytics-tier'

import type { StylePreset } from './tool-internals/style-catalog'
import type { BrandBank, BrandCarryState, GlobalConstraints, UploadedAsset } from './types'

// -- Workflow params --

/** See `UipSessionWorkflowParams.savedBrandBrief`. */
export interface CancelQueuedItemSignalPayload {
  queuedItemId: string
}

export interface ContinueUipDraftSignalPayload {
  gateToken: string
}

export interface SavedBrandBriefParam {
  // How the brief got attached to this session. 'explicit' -- the
  // user picked it in the pre-UIP selector; 'auto_detect' -- the
  // runtime matched it from the prompt (brand-brief-matching, enable_brand_reuse).
  // Surfaced into spec.brand_bank_source.attached_via so the planner can honor
  // the never-silent rule: an auto-detected brief MUST announce itself, an
  // explicit pick needs no surprise-explanation.
  attachedVia: 'auto_detect' | 'explicit'
  bank: BrandBank
  briefId: string
  lockedAt: string
}

export interface UipSessionWorkflowParams {
  /**
   * `uip_article_extraction_enabled` feature-gate snapshot from session creation.
   * When true AND the session entered via the
   * news-article-to-video front door, the workflow runs the article-extraction
   * activity on the first pasted URL instead of brand auto-extraction.
   * Snapshot semantics like brandExtractionEnabled.
   */
  articleExtractionEnabled?: boolean
  /**
   * Task queue where extractArticleActivity runs (the brand-extraction
   * worker's queue -- Playwright lives there). Resolved at intake only when
   * `articleExtractionEnabled === true`; absent otherwise.
   */
  articleExtractionTaskQueue?: string
  /**
   * Client-measured length of the uploaded audio track in whole seconds, sent at
   * session creation. Audio sessions only. Informational: mode_state.duration_seconds
   * is seeded null and filled by the runtime ASR.
   */
  audioDurationSeconds?: number
  /**
   * Vendor marker found in the uploaded audio's ID3 metadata at session
   * creation (e.g. 'suno' from a "made with suno" comment frame). Pinned
   * onto `spec.meta.audio_is_music` and forwarded to the pre-voiceover
   * child so the content-detection tiers can short-circuit. Only set when
   * the music gate is on and no `isMusic` preset exists.
   */
  audioIsMusicVendorTag?: string
  audioPath?: string
  /**
   * Initial per-session auto-continue setting. When false, the
   * workflow arms no auto-continue / auto-lock timer at any review gate
   * (script_review, refinement, seeded brand_review) -- the planner waits for
   * explicit user action at every stage instead. Absent/true = legacy behavior
   * (5-min timers fire). This is only the value at session creation: the user
   * can flip it mid-session via POST /uip-sessions/{id}/auto-continue, which lands a
   * user_auto_continue_changed event that foldAutoContinueEnabled prefers over
   * this snapshot. Absent = the always-on default.
   */
  autoContinueEnabled?: boolean
  /**
   * Resolved value of the `auto_style_selection` feature gate at session
   * creation (spec, "preset-only" V1). Set by the API service (gates are read
   * outside the workflow) and pinned onto
   * `spec.meta.auto_style_enabled`. When false, `styleMode` is forced
   * 'manual' by the API layer regardless of the composer's selection. Absent
   * = disabled (legacy manual-only style flow).
   */
  autoStyleEnabled?: boolean
  /**
   * Structured brand carry for a brand remix. Present only when the
   * source had a valid brand source + shape AND brandExtractionEnabled is true
   * for the new session. The carry's bank is already CLONED into the target
   * workspace at this point (resolveRemixBrandCarry ran at session create).
   * Seeded into `global_constraints.brand_carry_state` by session-init, which
   * adds the runtime-owned fields: status 'pending' and applied_via null.
   * Staged for direct apply on turn 1; the planner applies it (same brand) or
   * discards it by setting a new brand input. Must stay in sync
   * with the mirror in the other workflow-types file.
   */
  // Intentional subset of BrandCarryState: status and applied_via are NOT
  // carried in params; session-init seeds both. carried_asset_keys IS carried
  // (computed API-side by qualifyBrandCarry -- workflow code cannot
  // value-import the lib's key builder). Omit excludes the two runtime-owned
  // fields; a future runtime-owned field must be added here and seeded in
  // session-init.
  brandCarryState?: Omit<BrandCarryState, 'applied_via' | 'status'>
  /**
   * Feature gate snapshot from session creation. When true
   * the workflow subscribes to brand-extraction child signals and routes
   * the session through `bootstrap_brand` / `brand_review`. Snapshot
   * semantics: in-flight sessions keep their evaluation even if the gate
   * flips later. Must match the field on the workflow-side mirror in
   * libs/story-mode-runtime/src/workflows/uip/types.ts.
   */
  brandExtractionEnabled?: boolean
  /**
   * Task queue where BrandExtractionWorkflow runs. Resolved at intake
   * only when `brandExtractionEnabled === true`; absent otherwise.
   */
  brandExtractionTaskQueue?: string
  /**
   * The `uip_consistency_guard` feature gate, resolved once by the API at session
   * creation and pinned onto `spec.meta.consistency_guard_enabled`. Absent =
   * record-only (the rollout step 2 default).
   */
  consistencyGuardEnabled?: boolean
  /**
   * Creation tab / entry use case the session was started from (web
   * CreateUseCaseKey, e.g. 'news-article-to-video'). Sanitized AND
   * allowlisted by the API (WORKFLOW_ENTRY_USE_CASES in uip-create-session.ts)
   * because buildInitialSpec pins it onto LLM-visible
   * `spec.meta.entry_use_case`. Absent on older sessions, unknown
   * tabs, and tab-less sessions; undefined is dropped in serialization (same
   * treatment as autoContinueEnabled).
   */
  entryUseCase?: string
  /**
   * Per-project generation-resolution setting, sanitized by the API
   * service at session creation. Snapshot semantics like imageModel.
   */
  generationResolution?: { imageSize?: string; videoResolution?: string }
  /**
   * Image-model snapshot from session creation. Resolved by the API
   * service (image-model selection is read outside the
   * workflow) and forwarded into SessionState so anchor
   * generation can honor the user-selected image model. Absent = legacy
   * style-based generation path.
   */
  imageModel?: string
  /**
   * Resolved value of the `enable_improved_visual_script` feature gate at
   * session creation. Set by the API service (gates are read
   * outside the workflow) and pinned onto
   * `spec.meta.improved_visual_script_enabled` so prompt-route classification
   * and subsequent planner turns see a stable value. Absent =
   * disabled (effective prompt route behaves like the legacy IVS-off path).
   */
  improvedVisualScriptEnabled?: boolean
  initialMessage?: string
  initialMessageId?: string
  initialMessageSentAt?: string
  /**
   * True when the session was created via the song-to-video entry point
   * (`CreateUipSessionDto.is_music` with an audio upload). Pinned onto
   * `spec.meta.is_music` and pre-seeds `mode_state.input_type='audio_music'`
   * so prompt routing short-circuits to the music route. Effective routing
   * stays gated by `musicVideoImprovementEnabled`.
   */
  isMusic?: boolean
  /**
   * User-facing quality tier selected at submission (standard | standard_plus
   * | premium | ultra), snapshotted by the API at session creation. Snapshot
   * semantics like imageModel. Previously this rode along only as an
   * analytics-only column on the UipSession row; it is now also an execution
   * input, keying the visual-script tool's primary model in the
   * `uip_script_model` dynamic config. Absent on older sessions and on
   * sessions submitted without a tier, both of which keep the compiled-in
   * model chain.
   */
  modelSelectorTier?: ModelSelectorAnalyticsTier
  /**
   * Resolved value of the `enable_music_video_improvement` feature gate at
   * session creation. Pinned onto `spec.meta.music_video_improvement_enabled`
   * so UIP music-video routing and pure-music fallback see a stable value.
   */
  musicVideoImprovementEnabled?: boolean
  /**
   * Org that owns the session, snapshotted at session creation. Forwarded
   * into SessionState so org-keyed config reads (image-model fallback
   * chain) at anchor generation are scoped to the right org. Absent =
   * legacy style-based generation path.
   */
  orgId?: string
  projectId: string
  /**
   * Deterministic carry-over summary of a source UIP session, built by the
   * API service (`summarizeRemixSource`) inside `createUipSession` from the
   * source's saved spec fields (type / length / topic / audience) when the
   * request includes `remix_project_id`. No LLM step. Carries forward the
   * prior decisions so the new UIP session starts with informed defaults the
   * user may override. Absent on non-Remix sessions.
   *
   * Seeded into `SessionState.bootstrap.remix_context` at session init and
   * rendered via `buildRemixContextBlock`.
   */
  remixContext?: string
  /**
   * Saved brand brief injected at session start (brand auto-reuse). Present
   * only when the user's prompt matched a brief in their brand library at
   * session creation (gate + match resolved API-side). The bank's asset
   * staging URIs already point at the durable brand-library prefix. Seeded
   * pre-LOCKED into `global_constraints` by session init: bank +
   * `brand_bank_locked_at` + status 'locked' + `brand_bank_source`;
   * `brand_extraction_input` stays null so the session routes to
   * bootstrap_script (never bootstrap_brand / brand_review) and the
   * extraction auto-start stays suppressed. Must match the mirror in
   * libs/story-mode-runtime/src/workflows/uip/types.ts.
   */
  savedBrandBrief?: SavedBrandBriefParam
  /**
   * @deprecated Replaced by the pre-voiceover pipeline (audio-mode) or
   * `generate_explainer_script` (no-audio-mode). Still accepted; the workflow
   * ignores it.
   */
  seedScriptText?: string
  /**
   * Optional structured style seed from session creation.
   * Used as prompt context to anchor `global_constraints.style` generation.
   */
  seedStyleInstruction?: {
    style_image_uri?: string
    style_name?: string
    style_text?: string
    style_thumbnail_url?: string
  }
  /**
   * Task queue name where the story-mode long-take workflow worker is
   * registered. The pre-voiceover child workflow routes here so that its
   * audio activities (`runAsrForUploadedAudio`, `finalizeVoiceoverAudioArtifacts`)
   * find a worker -- the UIP worker only registers lightweight LLM
   * activities. Omitted for no-audio sessions (child never starts).
   */
  storyModeTaskQueue?: string
  /**
   * Pinned `enable_story_mode_v3` evaluation (Story Mode 3.0, step 1). Read by
   * the API service at session creation and stored on
   * `spec.meta.story_mode_v3_enabled`, so the visual-script contract a session
   * starts on is the one it keeps. Absent = the V2 three-phase contract.
   */
  storyModeV3Enabled?: boolean
  /**
   * Preset style ranking catalog (presets/story-mode/styles.json), resolved
   * ONCE at session creation (spec, Task 6B) -- ONLY when `autoStyleEnabled`
   * is true, to avoid the catalog read for non-auto sessions. Resolved by
   * the API service outside the workflow and pinned onto
   * `spec.meta.style_catalog` so the `select_auto_style` activity can rank
   * over it purely from folded session state -- no catalog I/O in the
   * activity. Absent = gate off (or a pre-feature caller); the activity
   * folds absent to `[]`.
   */
  styleCatalog?: StylePreset[]
  /**
   * Style seed mode resolved at session creation (spec, "preset-only"
   * V1): 'manual' when the composer's selection seeds a concrete style (the
   * legacy default), 'auto' when the user opted to let the runtime
   * auto-select from generated candidates. Comes from the composer via
   * `CreateUipSessionDto.style_mode`, but the API layer forces 'manual'
   * whenever `autoStyleEnabled` is false -- workflow code must not trust the
   * caller's `styleMode` alone. Pinned onto `spec.global_constraints.style_mode`.
   * Absent = 'manual' (legacy pre-feature behavior).
   */
  styleMode?: 'auto' | 'manual'
  /**
   * Resolved value of the `enable_transcript_voice_preview` feature gate at
   * session creation. Pinned onto `spec.meta.transcript_voice_preview_enabled`
   * so the script tool may allow inline TTS markup only for gated sessions.
   * Absent = disabled.
   */
  transcriptVoicePreviewEnabled?: boolean
  /**
   * User-selected transition/video generation model resolved by the API at
   * session creation. Snapshot semantics like imageModel so UIP visual-script
   * prompts can use model-specific planning guidance deterministically.
   */
  transitionVideoModel?: string
  uploadedAssets?: UploadedAsset[]
  userEmail?: string
  userId: string
  /** Voice ID pre-selected at project creation; forwarded to pre-voiceover pipeline. */
  voiceId?: string
  /**
   * Structured voice metadata derived from the selected voice (preset /
   * temp clone / saved clone / uploaded audio). When present, the UIP
   * workflow writes it onto SessionState.voiceProfile so anchor
   * generation can soft-bias narrator visual characteristics (gender /
   * age / qualities) to match the voice. Resolved by the API service
   * from `project.voiceOverJson.voiceProfile`.
   */
  voiceProfile?: VoiceProfile
  /** Written at session creation; routes activity to the API-inbox path vs the old signal-payload path. */
  workflowProtocolVersion?: string
}

/**
 * Confirm Brand Profile signal. Sent by the API when the
 * user clicks the Confirm button on the brand_review card. The workflow
 * drains this and the planner activity applies the `lock_brand_bank`
 * patch then advances phase from `brand_review` to `bootstrap_script`
 * via `activateBootstrapScript`, atomically in the same turn. Locking
 * happens inside the activity, not API-side -- matches the
 * `submitBrandBrief` convention.
 *
 * Confirm carries edits: the FE may include pending brand-bank
 * edits in the same Confirm payload. The activity builds ONE atomic
 * patch from `[...edits, lock_brand_bank]`; any edit that fails reverts
 * the whole batch (no lock, no phase advance) so the bank never lands
 * in a partial state. Omit `edits` for the no-pending-changes path.
 */
export interface ConfirmBrandReviewSignalPayload {
  // CDN URL of the previewed "apply brand colors" image. Carried
  // on every confirm where a preview rendered, regardless of which tile the
  // user picked, so reloads and the post-creation view can re-render the
  // two-up without regenerating the image.
  brandStylePreviewUrl?: string
  // Pre-generated brand style text the user previewed. When the
  // user picks the "apply brand colors" card, the FE carries the exact text
  // that produced the preview so bootstrap_script locks it in instead of
  // regenerating -- keeping the previewed look and the rendered video
  // consistent. Omit when the original style is chosen.
  brandStyleText?: string
  edits?: BrandBankEditSignalPayload[]
  gateToken: string
  // Style directive (Apply brand colors toggle) bundled into Confirm so
  // the FE doesn't fire a separate `brand_style_directive` signal that
  // would trigger an extra planner turn in brand_review. Omit to leave
  // the field untouched; `null` clears it.
  styleDirective?: 'hybrid' | 'keep_existing_style' | null
}

export interface ScriptReviewUpdateSignalPayload {
  gateToken: string
  globalConstraints?: Partial<GlobalConstraints>
  /** API-generated UUID correlating this signal to a gui_edit timeline event. */
  requestId?: string
  script?: string
}

export interface UserMessageSignalPayload {
  answerToMessageId?: string
  // Pending brand-bank draft edits flushed from the GUI alongside this
  // message. Applied in-band in the planner-turn activity before
  // runPlannerLoop so the agent reads the post-flush brand_bank. Only
  // honored while the session is still in brand_review. Mirror of the
  // field in story-mode-runtime/workflows/uip/types.ts -- keep both in
  // sync (signals serialize by shape, not by type identity).
  brandDraftEdits?: BrandBankEditSignalPayload[]
  message: string
  messageId: string
  sentAt?: string
  uploadedAssets?: UploadedAsset[]
}

/**
 * Stage 2 modal submit. The API sends this when the user
 * picks `paste_url` / `write_description` in the Stage 1 brand prompt and
 * submits the modal. The workflow's planner activity applies
 * `add_brand_asset` patches for any pre-staged user uploads then patches
 * `global_constraints.brand_extraction_input` last -- the input flip is
 * what arms the post-turn hook that fires BrandExtractionWorkflow. Path B
 * uploads (freeform-with-files) are not supported; only URL + freeform
 * text are.
 */
export interface BrandBriefSubmitSignalPayload {
  answerToMessageId?: string
  input: { kind: 'freeform'; text: string } | { kind: 'url'; url: string }
  requestId?: string
  uploadedAssets?: UploadedAsset[]
}

/**
 * Brand-bank Tier 1 edit. The API sends this when the user
 * edits the brand_review card -- either a scalar/array field (business
 * name, about-us summary, CTAs) or an asset add/remove. The patch-apply
 * layer gates each variant on `phase === 'brand_review' &&
 * brand_extraction_status === 'completed'`; out-of-window signals are
 * also dropped by the workflow stale filter so the activity layer
 * never sees a post-Confirm edit. Single-edit per request, atomic,
 * idempotent -- no draft/commit semantics.
 */
export type BrandBankEditSignalPayload =
  | {
      add_asset: {
        asset_kind: 'character' | 'logo' | 'product'
        description: null | string
        file_path: string
      }
      kind: 'add_asset'
      requestId?: string
    }
  | {
      field: {
        path: 'basic_info.about_us_summary' | 'basic_info.business_name' | 'ctas'
        value: unknown
      }
      kind: 'field'
      requestId?: string
    }
  | {
      kind: 'remove_asset'
      remove_asset: {
        asset_kind: 'character' | 'logo' | 'product'
        staging_uri: string
      }
      requestId?: string
    }
  | {
      kind: 'style_directive'
      requestId?: string
      style_directive: 'hybrid' | 'keep_existing_style'
    }

// -- Internal signal union (used by workflow main loop) --

export const SHORTENED_SESSION_IDLE_TIMEOUT_MS = 3 * 60 * 60 * 1000
