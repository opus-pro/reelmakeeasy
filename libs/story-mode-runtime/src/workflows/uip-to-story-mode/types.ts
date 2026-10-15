/**
 * Types for the UIP-to-Story-Mode handoff workflow.
 *
 * This workflow runs on the STORY_MODE_TASK_QUEUE (not UIP queue),
 * reusing existing story-mode stage functions and activities.
 */

import type { GenerationResolution } from '@reelmakeeasy/common/media/types'
import type { LongVideoAttemptSource } from '@reelmakeeasy/common/story-mode/long-video-attribution'
import type { ModelSelectorAnalyticsTier } from '@shared/types/model-selector-analytics-tier'
import type { DebugSettings } from '@shared/types/project/debug-settings'

import type { LongTakeIntentMode, LongTakePromptRoute } from '../../long-take-prompt-router'
import type { GeneratedAnchorCounts } from '../long-take/stages/video-consistency'
import type { LongTakeUserAssetCatalogItem } from '../long-take/types'

/**
 * UIP-derived intent analysis. Mirrors NST `IdentifyLongTakeIntentActivityResult.intentAnalysis`.
 * Produced by UIP's `generate_intent_context` and shipped at confirm time so the
 * story-mode workflow can inject it into the pipeline context.
 */
export type UipIntentAnalysis = string

/**
 * UIP-derived style analysis. Shape matches NST `IdentifyLongTakeStyleActivityResult`
 * so it can be passed straight to `applyStyleResultToPipelineContext`.
 * Produced by the UIP `analyze_style` tool when a style image is provided.
 */
export interface UipStyleAnalysis {
  colorPalette: Record<string, { hex: string; percentage: string }>
  keyStyleTags: string[]
  reproductionGuidance: null | string
  reusableStylePrompt: string
  styleDescription: string
}

/**
 * UIP-derived genre classification. Shape matches NST `ClassifyLongTakeGenreActivityResult`
 * so it can feed the same downstream pipeline-context entries.
 * Produced by the UIP `classify_genre` tool.
 */
export interface UipGenreAnalysis {
  primaryGenre: string
  scriptwriterGuidance: string
  secondaryGenre: string
  styleApplication: string
}

export interface UipToStoryModeWorkflowParams {
  admissionTier?: 'free' | 'paid'
  /** Aspect ratio -- '1:1' | '9:16' | '16:9'. */
  aspectRatio?: string

  /**
   * Per-project BGM toggle recorded on the Project row at creation
   * and threaded here by confirm orchestration. When true (and the project is
   * not on the music route), the workflow generates and persists a Lyria BGM
   * bed sized to the voiceover duration. Omitted for projects that
   * predate the toggle, which keeps BGM off. Export-mix consumption is wired
   * separately.
   */
  bgmEnabled?: boolean | null

  /**
   * Brand anchor-library coordinates for render-side anchor store +
   * reuse. Present ONLY for a saved-brand session (brand_bank_source.kind ===
   * 'brand_library') that has an effective style, resolved once at confirm so
   * the render side lands on the SAME (brief, style) storage key the planner store
   * uses -- keeping fast-path and standard-path videos consistent.
   * Absent => render-side store/reuse is a no-op (non-brand or classic path).
   */
  brandAnchorLibrary?: {
    // The current brand bank's exact staged-asset ids -- the store's allowlist for
    // which generated anchors may enter the org-shared library (matches the
    // planner's brandStagedAssetIds; not a mere id-shape test).
    brandStagedAssetIds: string[]
    briefId: string
    styleHash: string
    // Style display name, recorded on the stored manifest for
    // debuggability (metadata only, never part of the storage key).
    styleName?: null | string
  }

  // Raw hostname from URL-input brand sessions; null for freeform or non-brand.
  // Opaque pass-through for downstream telemetry.
  brandDomain?: null | string

  /** Whether the user picked a custom style (vs preset) at project creation. Tracking-only. */
  customStyle?: boolean

  /**
   * Debug panel overrides persisted on the Project at UIP session creation,
   * sanitized by the API to carry only the `llm` model-switch map.
   * Threaded to the transitions stage, where the transition activity turns
   * `debugSettings.llm` into the JobContext modelSwitch that `getModelName`
   * honors at highest priority -- so the debug panel's `video-generate` model
   * takes effect in the UIP path, matching the classic create flow. Undefined
   * for normal sessions.
   */
  debugSettings?: DebugSettings

  /** Prompt-box caption preference recorded on the project. */
  enableCaption?: boolean | null

  /**
   * Per-category counts of UIP-generated anchors, computed in confirm
   * orchestration (UIP skips the in-workflow anchor stage). Tracking-only.
   */
  generatedAnchorCounts?: GeneratedAnchorCounts

  /**
   * Per-project generation-resolution setting, resolved at confirm
   * time from the UIP session. Activities apply precedence (this value >
   * defaults); the final render canvas stays 1080p.
   */
  generationResolution?: GenerationResolution

  /**
   * UIP-produced genre classification. Populated when the UIP `classify_genre`
   * tool ran during the planner session. Consumed by the workflow to enrich
   * pipeline context for downstream LLM stages.
   */
  genreAnalysis?: UipGenreAnalysis

  /**
   * Image generation model id chosen by the user at project creation. Carried
   * here so story mode can honor it end-to-end. Consumed by the generation
   * surfaces in a later ticket; set today so the selection is not
   * dropped between the API and the workflow.
   */
  imageModel?: string

  /**
   * Raw client image-model selection, telemetry-only. Set on the direct
   * (Path 2) start path. The UIP path persists only the resolved value, so
   * this is absent here (D1); declared for shape parity with the direct
   * workflow params.
   */
  imageModelSelected?: string

  /**
   * Per-session value of the UIP improved visual-script gate. Tracking-only:
   * `promptRoute` still carries the runtime route used by downstream stages.
   */
  improvedVisualScriptEnabled?: boolean

  /**
   * UIP-produced intent analysis (free-form prose). Populated by UIP's
   * `generate_intent_context`. Consumed by the workflow to enrich pipeline
   * context.
   */
  intentAnalysis?: UipIntentAnalysis

  /** Whether the session is on the brand path. Tracking-only. */
  isBrandProject?: boolean
  /** Whether brand assets were used in transitions. Tracking-only. */
  isBrandVideo?: boolean
  /**
   * Confirmed music intent from UIP (`spec.meta.is_music` or
   * `mode_state.input_type=audio_music`). When true, the music route
   * resolution treats the session as music without waiting for the
   * audio-verdict classification (tracking only: `resolveMusicVideoRoute`
   * keeps the text route).
   * Fixed input parameter.
   */
  isMusic?: boolean
  /** Keyframe image model variant; threaded into keyframe generation and tracked on completion. */
  keyframeImageModel?: string

  /** Tracking-only source for long-video attempts, derived at UIP confirm/start time. */
  longVideoAttemptSource?: LongVideoAttemptSource

  /** Final normalized model-selector tier, tracking-only. */
  modelSelectorTier?: ModelSelectorAnalyticsTier

  /**
   * Fixed UIP route-eligibility override. When set, the workflow must not enter
   * the music route even if the downstream audio classifier hears music.
   * This keeps confirmed ads on the text route. Undefined preserves the legacy
   * behavior for old workflow inputs.
   */
  musicRouteIneligibleReason?: 'ads_mode'

  /**
   * Which signal carried the session's music intent (song-to-video preset,
   * planner audio_music classification, content detector, or none). Computed
   * at confirm from the spec; tracking-only attribution stamped on
   * `project.long_take.completed`.
   */
  musicSignalSource?: 'content_detector' | 'none' | 'planner_audio_music' | 'preset'

  /**
   * `@img[...]` mentions summed across UIP's multi-turn chat (classic
   * counts a single userPrompt). Computed in confirm orchestration.
   * Tracking-only.
   */
  numAssetMentions?: number

  /** Number of brand files uploaded in the UIP session. Tracking-only. */
  numBrandfilesUploaded?: number

  /**
   * Owning org id, carried for org-keyed image-model config reads at
   * generation time (e.g. getImageModelFallbackChain(imageModel, orgId)).
   * Forwarded alongside imageModel so the gated generation surfaces resolve
   * the right fallback chain. Set today so the value is not dropped between
   * the API and the workflow.
   */
  orgId?: string

  /** Original UIP user intent text, used only if the handoff has to reclassify prompt route. */
  originalUserInput?: string
  /**
   * TTS audio generated and approved in the UIP transcript preview. When
   * present, the story-mode voiceover stage treats it like an existing audio
   * source and runs ASR/alignment, instead of generating TTS again.
   */
  previewVoiceover?: {
    audioPath: string
    scriptText: string
    source: 'tts_preview'
  }

  /**
   * Handoff from the UIP pre-voiceover pipeline (Case 2.1, user-uploaded
   * audio). When present, the story-mode pipeline short-circuits its
   * voiceover stage -- the voiceover, transcript, and script were already
   * written to storage by UIP, so it just flips the stage to completed and
   * proceeds to experts / shot-plan with the existing artifacts.
   */
  preVoiceover?: {
    /**
     * Full uploaded-audio duration in seconds as measured by ffprobe on the
     * normalized mp3 (NOT the ASR last-word timestamp). Threaded into
     * `runTransitionsStage` -> `buildTransitionPlan` so the final transition
     * extends past the last spoken word and the rendered mp4 covers the
     * entire audio track, including any trailing silence the user left in.
     * Without this, the render clips at `maxShotEnd` (= ASR last-word end)
     * and trailing silence is dropped.
     */
    audioDurationSeconds?: number
    scriptText: string
    source: 'user_audio'
    /**
     * UIP transcript-editor speed selected by the user. Values outside the
     * supported preview range are clamped by the runtime before ffmpeg.
     */
    speed?: number
    transcriptPath: string
    voiceOverPath: string
  }
  projectId: string

  /**
   * UIP-resolved prompt route. When present, the handoff workflow reuses it
   * instead of reclassifying so downstream keyframes / shot plan / transitions
   * stay aligned with UIP's route-aware prompts.
   */
  promptRoute?: LongTakePromptRoute

  /**
   * Raw UIP prompt-route classification. Tracking-only: gate-off sessions may
   * classify as ads/abstract while still using `promptRoute: general` downstream.
   */
  promptRouteClassified?: LongTakePromptRoute

  /** Tracking-only requested duration from UIP mode_state, when provided. */
  requestedDurationSeconds?: number
  /**
   * UIP-derived rich style prompt. When set, the workflow uses this
   * (instead of raw `styleText`) for keyframe and transition activities, and
   * also calls `applyStyleResultToPipelineContext` with `styleAnalysis`.
   */
  reusableStylePrompt?: string
  /** Voice-over script text -- shots[].audio_vo joined from UIP spec. */
  script: string
  /**
   * How the applied style was selected when `styleSource` is 'auto' /
   * 'auto_switched', plus 'user_prompt' -- the one value pairing with
   * styleSource 'manual', meaning the user named the style in their prompt and
   * the brief applied it before the auto pick ran. Computed at
   * confirm time from `spec.global_constraints.selection_method`. Tracking-only,
   * stamped on `project.long_take.completed` so the Animation de-concentration /
   * "style-attributed regens down" guardrail metrics are computable.
   */
  selectionMethod?: 'fallback_default' | 'heuristic_fallback' | 'llm' | 'user_prompt'
  /**
   * Full UIP style analysis result. Shape matches NST so it can be passed
   * directly to `applyStyleResultToPipelineContext` for richer Style entries
   * in the pipeline context.
   */
  styleAnalysis?: UipStyleAnalysis

  /**
   * Auto Style Selection: the agent's ranked style candidates
   * (top pick first), as style names. Computed at confirm time from
   * `spec.global_constraints.style_candidates`. Tracking-only, stamped on
   * `project.long_take.completed` so decision quality (did the shipped style
   * come from the agent's set, and at what rank, or off-list) is computable.
   */
  styleCandidates?: string[]

  /** Style from UIP global_constraints. */
  styleName?: string

  /**
   * Style reference image URLs. UIP supports a single image today; the array
   * shape mirrors the NST contract (`LongTakeWorkflowParams.styleReferenceImageUrls`)
   * so downstream code can treat both entrypoints uniformly.
   */
  styleReferenceImageUrls?: string[]

  /**
   * Auto Style Selection provenance (Task 2/6): how `styleName` was
   * chosen -- 'auto' (Auto Style Selection picked it), 'auto_switched' (user
   * overrode the Auto pick), or 'manual' (user picked a preset directly).
   * Computed at confirm time from `spec.global_constraints.style_source`.
   * Tracking-only, undefined for sessions that predate Auto Style Selection.
   */
  styleSource?: 'auto' | 'auto_switched' | 'manual'

  styleText?: string

  /**
   * Transition video model variant (e.g. dreamina seedance 2.0 id) chosen
   * by the user at project-creation time. Forwarded to the transitions
   * stage, which uses it to pick the generation model.
   */
  transitionVideoModel?: string

  /**
   * User-confirmed high-level UIP mode. Used as an intent boundary for prompt
   * routing so storytelling/explainer sessions are not pulled into ads
   * templates merely because generated copy mentions a brand, object, or CTA.
   */
  uipMode?: LongTakeIntentMode | null

  /** User's brand description from the UIP brand bank. Tracking-only. */
  uipUserBrandDescription?: null | string

  /** User's website from the UIP brand bank. Tracking-only. */
  uipUserWebsite?: null | string

  /**
   * User asset catalog built in confirm orchestration. Tracking-only on
   * the UIP path.
   */
  userAssetCatalog?: LongTakeUserAssetCatalogItem[]
  userEmail?: string

  userId: string

  /** Number of shots in the visual script. */
  visualScriptItemCount: number

  /** store path to the UIP visual script JSON. */
  visualScriptPath: string

  /** Voice ID for TTS. */
  voiceId?: string
}

/**
 * A user-uploaded asset from the UIP session, passed to the fast-path workflow
 * so it can seed the story-mode anchor index without running the full bootstrap_visual pipeline.
 * The caller (API layer) is responsible for resolving the full store:// URI.
 */
export interface UipFastPathUploadedAsset {
  /** UIP asset_id, used as anchor asset_id in story-mode. */
  assetId: string
  /** MIME type, e.g. 'image/jpeg'. Only image/* assets are written to the anchor index. */
  contentType: string
  /** Original file name, used as prompt_text label in anchor lookup. */
  fileName?: null | string
  /** Full store address, e.g. store://projects/<projectId>/user-intent-planner/uploads/... */
  fileUri: string
}

/**
 * Params for the fast-path workflow that skips HITL (bootstrap_visual + refinement).
 * Identical to UipToStoryModeWorkflowParams except the pre-generated artifact
 * fields are omitted -- the workflow generates visual script and anchor assets itself.
 * Pass uploadedAssets so the workflow can seed the anchor index with user-uploaded
 * reference images, equivalent to what executeConfirmOrchestration does in the full flow.
 */
export type UipToStoryModeFastWorkflowParams = Omit<
  UipToStoryModeWorkflowParams,
  'generatedAnchorCounts' | 'visualScriptItemCount' | 'visualScriptPath'
> & {
  /** User-uploaded images from the UIP session. Written to the anchor index by the workflow. */
  uploadedAssets?: UipFastPathUploadedAsset[]
}

export interface UipToStoryModeWorkflowResult {
  status: 'completed' | 'failed'
  videoUri?: string
}
