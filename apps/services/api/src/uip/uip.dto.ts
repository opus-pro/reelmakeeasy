import {
  MODEL_SELECTOR_ANALYTICS_TIERS,
  type ModelSelectorAnalyticsTier,
} from '@reelmakeeasy/common/model-config/model-selector-analytics-tier'
import { CANCELLABLE_TOOL_NAMES } from '@reelmakeeasy/common/workflow/uip-v2-signal-names'
import { ACTIVE_MODAL_KIND_VALUES, type ActiveModalKind } from '@reelmakeeasy/uip-planner-runtime'
import type { ProjectVoiceOverJson } from '@shared/types/api/project'
import { Type } from 'class-transformer'
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator'

// Per-tool cancel payload. `tool_name` is gated to the runtime tools
// the FE may cancel; the workflow no-ops if no matching tool is running.
export class CancelUipToolDto {
  @IsIn(CANCELLABLE_TOOL_NAMES as unknown as string[])
  @IsString()
  tool_name!: string
}

// Stage 2 modal submit payload: URL or freeform text.
export class BrandBriefSubmitDto {
  @IsOptional()
  @IsString()
  answer_to_message_id?: string

  @IsIn(['url', 'freeform'])
  kind!: 'freeform' | 'url'

  @IsOptional()
  @IsString()
  text?: string

  @IsArray()
  @IsOptional()
  @Type(() => UploadedAssetDto)
  @ValidateNested({ each: true })
  uploaded_assets?: UploadedAssetDto[]

  @IsOptional()
  @IsString()
  url?: string
}

// Brand-card style-preview start payload. The FE passes the selected
// preset's full reference frame to restyle; `style_text` is the preset medium
// anchor (optional -- falls back to the session's seeded style text).
export class BrandStylePreviewStartDto {
  @IsNotEmpty()
  @IsString()
  reference_frame_url!: string

  @IsOptional()
  @IsString()
  style_text?: string
}

// Confirm Brand Profile CTA payload. May include pending brand-bank edits; the
// Reference to the picked style, stored on the saved brief (Branding V2 MS2).
// Discriminated by `kind`; per-kind id coherence is enforced when mapped to the
// domain ref, so a malformed pair is dropped rather than persisted.
export class SelectedStyleRefDto {
  @IsIn(['preset', 'custom'])
  kind!: 'custom' | 'preset'

  @IsOptional()
  @IsString()
  presetId?: string

  @IsOptional()
  @IsString()
  userSavedStyleId?: string
}

// activity composes one atomic patch `[...edits, lock_brand_bank]` and failure
// reverts the whole batch so the user can fix the invalid field and re-Confirm.
export class ConfirmBrandReviewDto {
  // CDN URL of the previewed brand-colors image, persisted so the
  // brand card can re-render the two-up after reload / project creation.
  // Present whenever a preview rendered, independent of the chosen tile.
  @IsOptional()
  @IsString()
  brand_style_preview_url?: string

  // Exact style text the user previewed, carried so bootstrap_script
  // locks it in instead of regenerating. Present only when the brand-colors
  // variant was chosen.
  @IsOptional()
  @IsString()
  brand_style_text?: string

  @IsArray()
  @IsOptional()
  @Type(() => BrandBankEditDto)
  @ValidateNested({ each: true })
  edits?: BrandBankEditDto[]

  @IsNotEmpty()
  @IsString()
  gate_token!: string

  // "Confirm + Save" (Branding V2 M1): persist the confirmed brand
  // brief to the org Brand Library. Honored only when `enable_saved_brand` is
  // on; the confirm itself proceeds regardless of the save outcome.
  @IsBoolean()
  @IsOptional()
  save?: boolean

  // The preset/custom style the user picked; stored as a reference on the saved
  // brief. Consulted only when `save` is set.
  @IsOptional()
  @Type(() => SelectedStyleRefDto)
  @ValidateNested()
  selected_style_ref?: SelectedStyleRefDto

  @IsIn(['keep_existing_style', 'hybrid', null])
  @IsOptional()
  style_directive?: 'hybrid' | 'keep_existing_style' | null
}

// Tier 1 brand-bank field edit. `@IsIn` gates allowlist at DTO; patch-apply repeats it.
export class BrandBankFieldEditDto {
  @IsIn(['basic_info.business_name', 'basic_info.about_us_summary', 'ctas'])
  path!: 'basic_info.about_us_summary' | 'basic_info.business_name' | 'ctas'

  // `value` is `unknown`; per-path shape validation lives in patch-apply.
  value!: unknown
}

// Staged-asset add payload. `file_path` is relative; the activity reconstructs the
// full `store://...` URI server-side.
export class BrandBankAddAssetDto {
  @IsIn(['logo', 'product', 'character'])
  asset_kind!: 'character' | 'logo' | 'product'

  @IsOptional()
  @IsString()
  description!: null | string

  @IsNotEmpty()
  @IsString()
  file_path!: string
}

// Staged-asset removal payload. Splices the ref regardless of provenance.
export class BrandBankRemoveAssetDto {
  @IsIn(['logo', 'product', 'character'])
  asset_kind!: 'character' | 'logo' | 'product'

  @IsNotEmpty()
  @IsString()
  staging_uri!: string
}

// Brand-bank edit envelope; discriminated by `kind` (field / add_asset / remove_asset).
// Single-edit per request, atomic, idempotent.
export class BrandBankEditDto {
  @IsOptional()
  @Type(() => BrandBankAddAssetDto)
  @ValidateNested()
  add_asset?: BrandBankAddAssetDto

  @IsOptional()
  @Type(() => BrandBankFieldEditDto)
  @ValidateNested()
  field?: BrandBankFieldEditDto

  @IsIn(['field', 'add_asset', 'remove_asset', 'style_directive'])
  kind!: 'add_asset' | 'field' | 'remove_asset' | 'style_directive'

  @IsOptional()
  @Type(() => BrandBankRemoveAssetDto)
  @ValidateNested()
  remove_asset?: BrandBankRemoveAssetDto

  @IsIn(['hybrid', 'keep_existing_style'])
  @IsOptional()
  style_directive?: 'hybrid' | 'keep_existing_style'
}

export class SeedStyleInstructionDto {
  @IsOptional()
  @IsString()
  style_image_uri?: string

  @IsString()
  style_name!: string

  @IsString()
  style_text!: string

  @IsString()
  style_thumbnail_url!: string
}

//

export class CreateUipSessionDto {
  /**
   * Aspect ratio chosen at project creation. Persisted on UipSession and
   * forwarded to uipToStoryMode at confirm time to drive rendering pixel
   * dimensions. Not consumed by the UIP planner.
   */
  @IsIn(['1:1', '9:16', '16:9'])
  @IsOptional()
  aspect_ratio?: string

  /**
   * Client-measured length of the uploaded audio track in whole seconds.
   * Decorators are
   * documentation only (no global ValidationPipe); the value is guarded at use
   * in createUipSession (normalizeAudioDurationSeconds).
   */
  @IsNumber()
  @IsOptional()
  audio_duration_seconds?: number

  /**
   * store path to user-uploaded audio file. When present, UIP runs a
   * pre-voiceover pipeline (ASR + forced alignment) in parallel with the
   * planner; the resulting script is locked for the rest of the session.
   */
  @IsOptional()
  @IsString()
  audio_path?: string

  /**
   * Preview transcript of the uploaded audio (the FE's audio-script-preview
   * result). Used only to match the org's saved brand briefs at creation, so
   * a brand spoken in the voiceover reuses its saved brief instead of
   * re-extracting. Never seeds the session script: the workflow runs its own
   * ASR on `audio_path`. Decorators are documentation only (no global
   * ValidationPipe); the type/length guard is enforced at use in
   * resolveSavedBrandBriefForSession.
   */
  @IsOptional()
  @IsString()
  @MaxLength(30000)
  audio_transcript?: string

  // Initial auto-continue setting for the session. When false, no
  // review gate arms an auto-continue / auto-lock timer -- the planner waits
  // for explicit user action at every stage. Absent = legacy behavior (timers
  // fire). Flippable mid-session via POST /uip-sessions/{id}/auto-continue.
  @IsBoolean()
  @IsOptional()
  auto_continue_enabled?: boolean

  // Story-mode "Background music" toggle at creation, gated on
  // enable_bgm by the FE. Persisted onto the Project row via createProject.
  @IsBoolean()
  @IsOptional()
  bgm_enabled?: boolean

  // Asset staging_uris the user removed from the pre-UIP brand chips;
  // dropped from the injected brief bank. Only meaningful with brand_brief_id.
  @IsArray()
  @IsOptional()
  @IsString({ each: true })
  brand_brief_excluded_asset_uris?: string[]

  // Brief the user explicitly selected in the submission box (Branding V2 M1).
  // Saved brands are off, so the server does not inject it.
  @IsOptional()
  @IsString()
  brand_brief_id?: string

  /** Custom-style flag for `project.long_take.completed` tracking parity. */
  @IsBoolean()
  @IsOptional()
  custom_style?: boolean

  /**
   * Debug panel overrides (admin/dev only), mirroring the classic create flow's
   * `debugSettings`. Only the nested `llm` model-switch map is read and
   * persisted onto the Project so the UIP transition stage honors the switch
   * via `getModelName`; every other key is ignored server-side.
   */
  @IsObject()
  @IsOptional()
  debug_settings?: Record<string, unknown>

  @IsBoolean()
  @IsOptional()
  enable_caption?: boolean

  /**
   * Creation tab / entry use case the session was started from (web
   * `CreateUseCaseKey`, e.g. 'song-to-video'). Persisted on UipSession.
   * Untrusted free-form string: sanitized server-side.
   */
  @IsOptional()
  @IsString()
  entry_use_case?: string

  /**
   * Generation-resolution setting chosen at project creation:
   * { videoResolution?: '480p'|'720p'|'1080p', imageSize?: '1K'|'2K'|'4K' }.
   * Sanitized server-side (unknown fields/values dropped); persisted on
   * UipSession + Project and forwarded to story mode at confirm time.
   */
  @IsObject()
  @IsOptional()
  generation_resolution?: Record<string, unknown>

  /**
   * Image generation model chosen at project creation via the model selector.
   * Not honored: sessions always start on the default image model.
   */
  @IsOptional()
  @IsString()
  image_model?: string

  @IsOptional()
  @IsString()
  initial_message?: string

  /**
   * True when the session was created through the song-to-video entry point,
   * declaring the uploaded audio is a song. Pinned onto `spec.meta.is_music`
   * and pre-seeds `mode_state.input_type = 'audio_music'` so prompt-route
   * classification short-circuits to the music route (effective only for
   * sessions pinned with music-video improvement, which new sessions are not). Ignored without
   * `audio_path`.
   */
  @IsBoolean()
  @IsOptional()
  is_music?: boolean

  /** Final normalized quality tier selected when the session is submitted. */
  @IsIn(MODEL_SELECTOR_ANALYTICS_TIERS)
  @IsOptional()
  model_selector_tier?: ModelSelectorAnalyticsTier

  /**
   * Client capability marker: true iff the submitting client
   * reconciled the brand-brief selector against the remix source (adopted the
   * source's brief or emptied a stale pick) before this submission. Read by
   * the remix brand-carry qualification; dormant until that lands. Absent
   * from old bundles, gate-off orgs, and fast submits that beat the
   * carry-context response -- all of which must keep legacy carry behavior.
   * Only meaningful with `remix_project_id`.
   */
  @IsBoolean()
  @IsOptional()
  remix_brand_aware?: boolean

  /**
   * Source project ID when this UIP session is being created via Remix.
   * When present, the API authorizes the source via
   * `projectService.canViewProject` (owner/share OR a public long-take)
   * and builds a deterministic carry-over
   * summary of the source's UIP spec (`summarizeRemixSource`), seeded into
   * `SessionState.bootstrap.remix_context` and presented by the planner on
   * the first turn.
   */
  @IsOptional()
  @IsString()
  remix_project_id?: string

  @IsObject()
  @IsOptional()
  @Type(() => SeedStyleInstructionDto)
  @ValidateNested()
  seed_style_instruction?: SeedStyleInstructionDto

  // The preset/custom style the user picked, persisted on the session and read
  // at brand-review confirm so a saved brief references it.
  @IsObject()
  @IsOptional()
  @Type(() => SelectedStyleRefDto)
  @ValidateNested()
  selected_style_ref?: SelectedStyleRefDto

  /**
   * Client-generated idempotency key for the create request. Minted
   * once per planner open and reused across style tweaks / retries so a
   * duplicate/retried create returns the already-created session instead of
   * minting a second Project. Optional -- legacy clients create as before.
   */
  @IsOptional()
  @IsString()
  session_creation_id?: string

  /**
   * Composer's style seed mode (spec, "preset-only" V1): 'manual'
   * seeds a concrete style pick (legacy default), 'auto' opts into the
   * runtime auto-selecting from generated candidates. The API forces
   * 'manual' when the `auto_style_selection` gate is off for this user,
   * regardless of this value. Absent = 'manual'.
   */
  @IsIn(['auto', 'manual'])
  @IsOptional()
  style_mode?: 'auto' | 'manual'

  /**
   * Transition video model variant (e.g. seedance 2.0 dreamina id) chosen at
   * project creation via the "Seedance 2.0" toggle. Persisted on UipSession
   * and forwarded to uipToStoryMode at confirm time. Not consumed by UIP.
   */
  @IsOptional()
  @IsString()
  transition_video_model?: string

  @IsArray()
  @IsOptional()
  @Type(() => UploadedAssetDto)
  @ValidateNested({ each: true })
  uploaded_assets?: UploadedAssetDto[]

  /**
   * Full voice configuration pre-selected by the user at project-creation time.
   * Persisted as project.voiceOverJson and uipSession.voiceId at creation.
   * Forwarded to uipToStoryMode at confirm time for TTS when the user does not
   * upload audio.
   */
  @IsObject()
  @IsOptional()
  voice?: {
    labels?: string[]
    name: string
    previewAudioUrl?: string
    provider?: string
    type: 'voice-cloned' | 'voice-over' | 'voice-over-attachment'
    voiceCloneId?: string
    voiceId: string
  }
}

export class SendUipMessageDto {
  @IsOptional()
  @IsString()
  answer_to_message_id?: string

  // Pending brand-brief draft edits flushed from the GUI alongside the
  // chat message. Honored only during brand_review; reuses the same
  // BrandBankEditDto shape as confirm-brand-review so the FE can build
  // both payloads from one helper.
  @IsArray()
  @IsOptional()
  @Type(() => BrandBankEditDto)
  @ValidateNested({ each: true })
  brand_draft_edits?: BrandBankEditDto[]

  @IsOptional()
  @IsString()
  client_id?: string

  @IsString()
  message!: string

  // Canvas Edit modal open when this message was sent. Validated
  // against the canonical value set so any client drift 400s rather than
  // silently persisting. Optional: absent = no panel tag.
  @IsIn(ACTIVE_MODAL_KIND_VALUES)
  @IsOptional()
  sent_from?: ActiveModalKind

  @IsArray()
  @IsOptional()
  @Type(() => UploadedAssetDto)
  @ValidateNested({ each: true })
  uploaded_assets?: UploadedAssetDto[]
}

//

export class TranscriptEditingStateDto {
  @IsBoolean()
  active!: boolean

  @IsNotEmpty()
  @IsString()
  client_id!: string
}

export class UserOperationHeartbeatDto {
  @IsNotEmpty()
  @IsString()
  client_id!: string
}

//

export class ScriptReviewGlobalConstraintsDto {
  @IsOptional() @IsString() brand_scope?: string
  @IsOptional() @IsString() geo_scope?: string
  @IsArray() @IsOptional() @IsString({ each: true }) key_entities?: string[]
  @IsArray() @IsOptional() @IsString({ each: true }) must_not_violate?: string[]
  @IsOptional() @IsString() pacing?: string
  @IsOptional() @IsString() script_category?: string
  @IsOptional() @IsString() style?: string
  @IsOptional() @IsString() target_audience?: string
  @IsOptional() @IsString() time_scope?: string
  @IsOptional() @IsString() tone?: string
  @IsOptional() @IsString() topic?: string
  @IsOptional() @IsString() video_type?: string
}

export class UpdateImageModelDto {
  @IsOptional()
  @IsString()
  image_model?: null | string
}

export class UpdateScriptReviewDto {
  @IsNotEmpty()
  @IsString()
  gate_token!: string

  @IsObject()
  @IsOptional()
  @Type(() => ScriptReviewGlobalConstraintsDto)
  @ValidateNested()
  global_constraints?: ScriptReviewGlobalConstraintsDto

  @IsOptional()
  @IsString()
  script?: string
}

export class UpdateTransitionVideoModelDto {
  @IsOptional()
  @IsString()
  transition_video_model?: null | string
}

// POST /uip-sessions/{id}/auto-continue. Flips the mutable auto-continue
// setting mid-session from the in-session control.
export class SetAutoContinueDto {
  @IsBoolean()
  @IsOptional()
  auto_continue_enabled?: boolean
}

// POST /uip-sessions/{id}/style. Explicit user style switch,
// rejected with 409 once the session has passed the visual-render lock.
export class SetStyleDto {
  @IsNotEmpty()
  @IsString()
  style_name!: string

  @IsNotEmpty()
  @IsString()
  style_text!: string

  @IsOptional()
  @IsString()
  style_thumbnail_url?: string
}

//

export class ConfirmPlanDto {
  @IsOptional()
  @IsString()
  client_id?: string
}

/**
 * Cancel is reachable from surfaces that hold no review gate -- the projects
 * grid offers it through the whole pre-confirm window, and in the
 * `bootstrap_*` phases no gate token exists to send. So it takes its own DTO
 * with an OPTIONAL token rather than relaxing `ReviewGateActionDto`, which
 * `continueUipDraft` shares and genuinely needs `@IsNotEmpty()` for.
 *
 * An absent token is already the sanctioned internal shape: the `project.deleted`
 * listener cancels with `gateToken: ''`.
 */
export class CancelSessionDto {
  @IsOptional()
  @IsString()
  client_id?: string

  @IsOptional()
  @IsString()
  gate_token?: string
}

export class ReviewGateActionDto {
  @IsOptional()
  @IsString()
  client_id?: string

  @IsNotEmpty()
  @IsString()
  gate_token!: string
}

//

export class GenerateUploadUrlsDto {
  @IsArray()
  @Type(() => UploadFileDescriptorDto)
  @ValidateNested({ each: true })
  files!: UploadFileDescriptorDto[]
}

export class UploadFileDescriptorDto {
  @IsNotEmpty() @IsString() contentType!: string
  @IsNotEmpty() @IsString() fileName!: string
  @IsNumber() index!: number
}

//

export class GuiUpdateDto {
  @IsOptional() @IsString() transcript?: string
  @IsObject() @IsOptional() voice?: ProjectVoiceOverJson
  @IsNumber() @IsOptional() voice_preview_speed?: number
}

// Summary artifact field edits. Documents the wire shape (topic,
// directives, must_not_violate); the whitelist itself is enforced at runtime
// in sendSummaryUpdateFn (uip-send-summary-update.ts), not by these
// decorators -- this API installs no global ValidationPipe.
export class SummaryGlobalConstraintsDto {
  @IsArray() @IsOptional() @IsString({ each: true }) directives?: string[]
  @IsArray() @IsOptional() @IsString({ each: true }) must_not_violate?: string[]
  @IsOptional() @IsString() topic?: string
}

export class SummaryUpdateDto {
  @IsObject()
  @IsOptional()
  @Type(() => SummaryGlobalConstraintsDto)
  @ValidateNested()
  globalConstraints?: SummaryGlobalConstraintsDto

  @IsOptional()
  @IsString()
  requestId?: string
}

export class TranscriptVoicePreviewDto {
  @IsOptional() @IsString() elevenLabsPronunciationMode?: 'dictionary-locators' | 'replace-text'
  @IsOptional() @IsString() emotion?: string
  @IsOptional() @IsString() model?: string
  @IsBoolean() @IsOptional() persist?: boolean
  @IsArray() @IsOptional() @IsString({ each: true }) pronunciationDict?: string[]
  @IsOptional() @IsString() provider?:
    | 'byteplus'
    | 'elevenlabs'
    | 'fal'
    | 'gemini'
    | 'kokoro'
    | 'minimax'
    | 'qwen3'
  @IsNumber() @IsOptional() speed?: number
  @IsString() text!: string
  @IsOptional() @IsString() voiceId?: string
}

export class UploadedAssetDto {
  @IsNotEmpty() @IsString() asset_id!: string
  @IsNotEmpty() @IsString() content_type!: string
  @IsNotEmpty() @IsString() file_name!: string
  @IsNotEmpty() @IsString() file_path!: string
  @IsOptional() @IsString() uploaded_at?: string
}
