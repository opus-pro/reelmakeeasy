import { EXPANDED_STORY_MODE_LIMITS } from '@reelmakeeasy/common/story-mode/user-limits'
import {
  ACTIVE_MODAL_KIND_VALUES,
  type ActiveModalKind,
} from '@reelmakeeasy/common/uip/active-modal-kind'
import type { SubstepStatus } from '@reelmakeeasy/common/utils/tool-step-timing'
import type { VoiceProfile } from '@shared/types/api/voice-profile'
import type { ModelSelectorAnalyticsTier } from '@shared/types/model-selector-analytics-tier'
import { z } from 'zod'

import type { StylePreset } from './tool-internals/style-catalog'
import type {
  AnchorAssetPlanArtifact,
  AnchorAssetsSummary,
  AnchorPlanUpdateRequest,
  AssetAssignmentPlanArtifact,
  AssetDescriptionsArtifact,
} from './anchor-types'
import type { PatchOp } from './patch-op-types'
import type { PlannerRecoveryFailure } from './recovery-types'

// Anchor + asset-plan artifact types moved to ./anchor-types; re-export so the
// barrel and existing `../types` consumers keep resolving them from here.
export * from './anchor-types'

// Planner recovery/repair types moved to ./recovery-types; re-export so the
// barrel and existing `../types` consumers keep resolving them from here.
export * from './recovery-types'

// Patch-operation types moved to ./patch-op-types; re-export so the barrel and
// existing `../types` consumers keep resolving them from here.
export * from './patch-op-types'

export const UIP_PROMPT_ROUTES = [
  'abstract',
  'ads-tangible',
  'ads-intangible',
  'general',
  'music',
] as const

export interface PromptRouteArtifact {
  /**
   * Route actually used by downstream prompt templates. When the improved
   * visual-script gate is off, we still classify `prompt_route` for analysis,
   * but generation must remain on the general route.
   */
  effective_prompt_route?: UipPromptRoute
  gate_enabled: boolean
  generated_at: string
  /**
   * Snapshot of the music-video gate at route time. A raw `music`
   * classification only becomes the effective route when this is true.
   */
  music_video_improvement_enabled?: boolean
  /** Raw content classification route, used for analytics segmentation. */
  prompt_route: UipPromptRoute
  reasoning: string
  script_hash: string
}

export type UipPromptRoute = (typeof UIP_PROMPT_ROUTES)[number]

// Visual Script Schemas

export const VisualPrimarySchema = z.object({
  expression_type: z.enum(['Literal', 'Cultural Context', 'Symbolic']),
  aesthetic_mode: z.enum(['Live Action', 'Composited Graphic', 'UI-Infographic']),
  core_description: z.string(),
  entry_action: z.string().nullable().default(null),
  exit_action: z.string().nullable().default(null),
  // How this shot hands off to the next one (Story Mode 3.0). Absent on every
  // V2 shot -- V2 has no hand-off concept -- and null on the last V3 shot, so
  // both shapes parse through the one canonical Shot without a migration.
  // Optional rather than defaulted so the ~15 existing Shot literals stay valid;
  // safe because VisualPrimarySchema is never a responseFormat (the VS output
  // schema is the separate inline one in tools/generate-visual-script.ts), and
  // it is `.nullable()` regardless.
  transition_to_next: z.enum(['cut', 'continuous']).nullable().optional(),
  // Legacy generation hint. The VS output + planner shot schemas no longer
  // emit it, so it is always the 'MED' default in practice -- renderer.ts's
  // change detection compares it and story-mode-handoff/index.ts forwards it,
  // but since every canonical shot carries the same default, neither ever
  // observes a real difference. Default it here to keep the canonical Shot
  // valid on every build/parse path.
  availability: z.enum(['HIGH', 'MED', 'LOW']).default('MED'),
  notes: z.array(z.string()).default([]),
})

export const PreSelectedAssetSchema = z.object({
  asset_id: z.string(),
  source: z.enum(['anchor_asset', 'user_upload']),
  usage: z.string(),
})

export const ShotSchema = z.object({
  shot_id: z.string(),
  order: z.number().int().positive(),
  time: z.object({
    start_s: z.number(),
    end_s: z.number(),
  }),
  audio_vo: z.string(),
  // Set by beat-locked (music) normalization for beats with no lyrics: marks that the empty
  // audio_vo is intentional silence, so validators do not flag it as a missing voice-over.
  is_instrumental: z.boolean().optional(),
  visual_primary: VisualPrimarySchema,
  pre_selected_assets: z.array(PreSelectedAssetSchema).default([]),
})

export const VisualScriptSchema = z.object({
  shots: z.array(ShotSchema),
})

// Global Constraints Schema

/**
 * Visual pacing for beat-sheet segmentation. The value names the target shot
 * duration range; beat-sheet experts (story-mode long-take beat-sheet,
 * UIP-internal VS tool beat-sheet) consume this to decide cut granularity.
 * Does NOT drive voice-over duration -- TTS word-rate uses a fixed default
 * WPM (see DEFAULT_PACING_WPM).
 */
export const PacingSchema = z.enum([
  'active (3-6s per shot)',
  'fast (2-4s per shot)',
  'moderate (4-8s per shot)',
])

export type Pacing = z.infer<typeof PacingSchema>

// Style analysis fields below mirror the NST `StyleAnalysisSchema` in
// `libs/story-mode-runtime/src/activities/long-take/style-analysis.ts`.
// Populated by the UIP `analyze_style` tool when a style image is provided;
// consumed by anchor generation, world bible, and `UipToStoryModeWorkflow`
// to drive the new style-transfer pipeline end-to-end.
export const StyleSchema = z.object({
  style_name: z.string().optional(),
  style_text: z.string().optional(),
  style_thumbnail_url: z.string().optional(),
  reusable_prompt: z.string().optional(),
  style_description: z.string().optional(),
  key_style_tags: z.array(z.string()).optional(),
  color_palette: z.record(z.object({ hex: z.string(), percentage: z.string() })).optional(),
  reproduction_guidance: z.string().nullable().optional(),
})

// Auto Style Selection (spec, "preset-only" V1). Canonical mirrors of
// the FE (`apps/web/.../adapter/api-types.ts`) and backend
// (`apps/services/api/src/uip/uip-timeline-types.ts`) wire copies -- keep all
// three field-for-field identical. This is the source of truth the
// `select_auto_style` tool (`./tools/select-auto-style.ts`) and its activity
// wrapper (`libs/story-mode-runtime/src/activities/uip-v2/tools/select-auto-style.ts`)
// build against.

/** Agent-picked style candidate offered alongside the applied `style`. */
export const StyleCandidateSchema = z.object({
  is_top_pick: z.boolean(),
  label: z.string(),
  rationale: z.string().optional(),
  style_name: z.string(),
  style_text: z.string(),
  // NB: a candidate uses `thumbnail_url`; the applied style (StyleSchema)
  // uses `style_thumbnail_url` -- the two are not renames of each other, they
  // are different fields on different objects. Do not rename to match.
  thumbnail_url: z.string(),
})
export type StyleCandidate = z.infer<typeof StyleCandidateSchema>

/** Provenance of the applied style: agent auto-pick, agent auto-switch, or user override. */
export const StyleSourceSchema = z.enum(['auto', 'auto_switched', 'manual'])
export type StyleSource = z.infer<typeof StyleSourceSchema>

/**
 * How the applied style was chosen. 'user_prompt' means the user
 * named the style in their prompt and generate_intent_context applied it before
 * the auto pick ran -- the one value that pairs with `style_source: 'manual'`.
 */
export const StyleSelectionMethodSchema = z.enum([
  'fallback_default',
  'heuristic_fallback',
  'llm',
  'user_prompt',
])
export type StyleSelectionMethod = z.infer<typeof StyleSelectionMethodSchema>

// Genre classification mirrors NST `GenreClassificationSchema` in
// `libs/story-mode-runtime/src/activities/long-take/genre.ts`.
// Populated by the UIP `classify_genre` tool; consumed by world bible,
// `UipToStoryModeWorkflow` pipeline context, and downstream LLM stages.
export const GenreClassificationSchema = z.object({
  confidence: z.number(),
  primary_genre: z.string(),
  secondary_genre: z.string(),
  reasoning: z.string(),
  style_application: z.object({
    overall_feel: z.string(),
    how_style_should_influence_script: z.array(z.string()),
  }),
  scriptwriter_guidance: z.object({
    core_goal: z.string(),
    genre_specific_requirements: z.array(z.string()),
    structure_guidance: z.string(),
    audience_considerations: z.array(z.string()),
    pitfalls_to_avoid: z.array(z.string()),
  }),
})

export type GenreClassification = z.infer<typeof GenreClassificationSchema>

// Brand extraction schemas. Once `brand_extraction_status === 'locked'` all brand
// fields become immutable (enforced in `patch-apply.ts`).
const StagedAssetCategorySchema = z.enum([
  'primary_brand_mark',
  'favicon',
  'og_image',
  'hero',
  'product_screenshot',
  'team_photo',
  'testimonial_portrait',
  'press_logo',
  'partner_logo',
])
export type StagedAssetCategory = z.infer<typeof StagedAssetCategorySchema>

export const StagedAssetRefSchema = z.object({
  staging_uri: z.string(),
  source_url: z.string().nullable(),
  width: z.number().int().nullable(),
  height: z.number().int().nullable(),
  size_bytes: z.number().int().nullable(),
  asset_kind: z.enum(['logo', 'product', 'character']),
  /**
   * Sub-classification within `asset_kind`. A logo can be a primary_brand_mark,
   * favicon, or og_image variant. A product can be a hero / screenshot /
   * portrait. The picker uses this to group and to pre-select the canonical
   * mark. `null` means the signal wasn't strong enough to commit; the picker
   * shows these in a "Miscellaneous" lane.
   */
  category: StagedAssetCategorySchema.nullable().default(null),
  /**
   * Short caption for tooltip / picker label. Defaults to the source `alt`
   * text when present; falls back to a structural label like "Header brand
   * mark" or "Favicon".
   */
  description: z.string().nullable().default(null),
  /**
   * Where in the page chrome the asset was scanned from. Only meaningful for
   * logos - lets the picker rank header above footer.
   */
  location: z.enum(['header', 'footer', 'favicon']).nullable().default(null),
  /**
   * `<img>` whose closest `<a>` resolves to the site root. Strongest single
   * signal that this is THE canonical brand mark - every CMS template wraps
   * the logo in `<a href="/">`. The picker pre-selects an in_home_link +
   * header asset if one exists.
   */
  in_home_link: z.boolean().default(false),
  /**
   * Where this asset entered the bank. `crawl` is the default -- extracted
   * by the BrandExtractionWorkflow from the user-provided URL. `user_upload`
   * marks assets the user attached via the Stage 2 modal (Path B freeform);
   * downstream selection logic preserves user uploads over auto-extracted
   * candidates when there is a conflict.
   */
  provenance: z.enum(['crawl', 'user_upload']).default('crawl'),
  /**
   * Content hash of the original image bytes (md5, first 12 hex chars).
   * Primary key for cross-source dedup: collapses the same image whether it
   * arrives as a crawl extraction, an init-prompt upload, or a brand-brief
   * upload. Optional + backward-compatible -- refs minted before this field
   * existed fall back to staging_uri / description matching. For crawl refs
   * this reuses the hash the crawler already embeds in the staging filename;
   * for uploads it is computed from the downloaded bytes at fold time.
   */
  content_hash: z.string().nullable().default(null),
})

// Extracted so `update_brand_bank_field` with `path: 'ctas'` validates against the
// same source of truth as `BrandBankSchema.ctas`.
export const BrandBankCtasSchema = z.array(z.object({ label: z.string(), href: z.string() }))

// Content-only; the input that produced it lives on `GlobalConstraints.brand_extraction_input`.
export const BrandBankSchema = z.object({
  basic_info: z.object({
    business_name: z.string(),
    founders: z.array(z.string()).default([]),
    target_audience: z.array(z.string()).default([]),
    pain_points_addressed: z.array(z.string()).default([]),
    vision_and_values: z
      .object({
        mission: z.string().nullable(),
        values: z.array(z.string()).default([]),
      })
      .default({ mission: null, values: [] }),
    about_us_summary: z.string().nullable(),
    origin_quotes: z.array(z.string()).default([]),
    location: z.string().nullable(),
  }),
  product_offerings: z.record(z.unknown()).default({}),
  testimonials: z.array(z.object({ name: z.string(), quote: z.string() })).default([]),
  voice: z.object({
    persona: z.string().nullable(),
    signature_phrases: z.array(z.string()).default([]),
  }),
  palette: z
    .array(
      z.object({
        hex: z.string(),
        role: z.string(),
        frequency: z.number(),
      }),
    )
    .default([]),
  ctas: BrandBankCtasSchema.default([]),
  socials: z.record(z.string()).default({}),
  staged_assets: z.object({
    logo: z.array(StagedAssetRefSchema).default([]),
    product: z.array(StagedAssetRefSchema).default([]),
    character: z.array(StagedAssetRefSchema).default([]),
  }),
  derived_style_text: z.string().nullable().default(null),
})

export const BRAND_VIDEO_TYPE_VALUES = [
  'friction_to_flow',
  'product_showcase',
  'industry_explainer',
] as const

export const BrandCarryStateSchema = z.object({
  // Source project the carry came from (tracking + provenance).
  source_project_id: z.string(),
  // Carried brand source, held here (NOT in GlobalConstraints.brand_extraction_input)
  // until apply_brand_carry copies it over, so extraction cannot fire early.
  source_brand_extraction_input: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('url'), url: z.string().url() }),
    z.object({ kind: z.literal('freeform'), text: z.string() }),
  ]),
  // Carried narrative arc. Nullable: the shape is best-effort on the source
  // (pre-shape-era projects locked without it), and a missing shape must not
  // disqualify the whole carry -- the bank is the carry's substance. When null,
  // the planner collects the shape via the section 2.6.5 ask before
  // MODE_CONFIRMED (checkBrandVideoTypeBeforeConfirm enforces it).
  source_brand_video_type: z.enum(BRAND_VIDEO_TYPE_VALUES).nullable(),
  // The source's extracted brand bank, with staged-asset images already CLONED
  // into the target project's workspace (staging_uri rewritten at session
  // create; see apps/services/api/src/uip/uip-brand-remix-assets.ts). Applying
  // the carry seeds this directly as global_constraints.brand_bank.
  // Null once the carry is resolved (applied/discarded): the bank is dropped
  // from the carry record then -- an applied carry's live copy is
  // global_constraints.brand_bank, and keeping a second copy here would double
  // the bank's bytes in every spec persist and activity payload for the rest
  // of the session. Always non-null while status === 'pending'.
  source_brand_bank: BrandBankSchema.nullable(),
  // pending = staged, not yet resolved; applied = carried bank seeded, extraction
  // skipped; discarded = the prompt introduced a different brand, fresh
  // extraction runs instead. Brand carry v2 (v1's confirm/change gate is removed).
  status: z.enum(['pending', 'applied', 'discarded']),
  // Identity keys (`hash:<content_hash>` / `name:<source basename>`) of every
  // image in the carried bank, computed at session-init (buildBrandCarryAssetKeys)
  // and kept after the bank itself is dropped on resolve. The extraction fold
  // uses them to SKIP init-prompt uploads that are the remix FE's re-attachments
  // of the carried brand's images -- without this, a brand switch
  // (change_brand_extraction_source, or a discarded carry's fresh extraction)
  // re-folds the OLD brand's logo into the NEW brand's bank.
  carried_asset_keys: z.array(z.string()).default([]),
  // How a pending carry got applied: 'op' = planner emitted apply_brand_carry;
  // 'fallback' = the runtime applied it at MODE_CONFIRMED (carry-by-default).
  applied_via: z.enum(['op', 'fallback']).nullable().default(null),
})

export const GlobalConstraintsSchema = z.object({
  video_type: z.string().default(''),
  script_category: z.enum(['object_centric', 'concept_centric']).optional(),
  topic: z.string().default(''),
  key_entities: z.array(z.string()).default([]),
  geo_scope: z.string().default(''),
  time_scope: z.string().default(''),
  brand_scope: z.string().default(''),
  target_audience: z.string().default(''),
  tone: z.string().default(''),
  // BCP-47 tag of the voice-over language. English only for now: normalization.ts
  // pins every value to `en` (caption fonts cover English only); multi-language later.
  script_language: z.string().optional(),
  style: StyleSchema.default({}),
  // Auto Style Selection (spec, "preset-only" V1). Snapshot of whether
  // this session's style came from a manual pick ('manual', the legacy
  // default) or was left for the runtime to auto-select from generated
  // candidates ('auto'). Set once at session creation from the feature-gated
  // `UipSessionWorkflowParams.styleMode` (see build-initial-spec.ts); optional
  // so pre-feature sessions fold to undefined (treated as 'manual' by
  // readers). style_candidates/style_source/selection_method (added
  // alongside the FE/SSE projection in a prior task) are the auto-selection
  // machinery itself and are NOT part of this field.
  style_mode: z.enum(['auto', 'manual']).optional(),
  // Up to 3 ranked candidates produced by the `select_auto_style` tool
  // (best fit first, `is_top_pick` marks the one copied onto `style`).
  // Optional: absent on manual-style sessions and on sessions that predate
  // Auto Style Selection.
  style_candidates: z.array(StyleCandidateSchema).optional(),
  // Provenance of the CURRENT `style` value. Optional so pre-feature
  // sessions fold to undefined (readers treat that as 'manual').
  style_source: StyleSourceSchema.optional(),
  // How `style` was chosen when `style_source` is 'auto'/'auto_switched'.
  // Optional: absent for 'manual' style and pre-feature sessions.
  selection_method: StyleSelectionMethodSchema.optional(),
  pacing: PacingSchema.nullable().default(null),
  genre: GenreClassificationSchema.optional(),
  // Positive hard requirements -- specific things the video MUST include /
  // do, even when worded with "must" (opening / ending moments, colors,
  // transitions, character appearances, a required soundtrack). The
  // counterpart to `must_not_violate`: directives = "do this", must_not_-
  // violate = "never do this". Flat advisory list rendered on the brief
  // card and dumped into the script / visual-script prompts.
  directives: z.array(z.string()).default([]),
  // Hard content / compliance PROHIBITIONS -- violations make the video
  // unshippable (e.g. "no profanity", "no unverified health claims",
  // "avoid competitor mentions"). Positive creative requirements (even if
  // the user says "must") belong in `directives`, NOT here. Soft aesthetic
  // / tone / pacing rails are NOT stored here either; they live on the
  // world-bible artifact as `global_context.creative_guardrails`.
  must_not_violate: z.array(z.string()).default([]),
  // Brand extraction (UIP Brand Extraction). `brand_extraction_input` is
  // a discriminated union -- URL or freeform-text input set by the planner
  // once it classifies brand intent. The workflow owns
  // `brand_extraction_status` transitions (pending -> completed / failed
  // -> locked). `brand_bank` is seeded from the extraction signal and
  // locked at Continue UIP Draft promotion.
  brand_extraction_input: z
    .discriminatedUnion('kind', [
      z.object({ kind: z.literal('url'), url: z.string().url() }),
      z.object({ kind: z.literal('freeform'), text: z.string() }),
    ])
    .nullable()
    .default(null),
  brand_extraction_status: z
    .enum(['pending', 'completed', 'failed', 'locked'])
    .nullable()
    .default(null),
  // Failure reason set by the workflow when status transitions to 'failed'.
  // Null otherwise. Kept as a sibling of `brand_bank` (rather than embedded
  // sentinels in the bank) so consumers check status / reason in one place
  // and the bank stays content-only.
  brand_extraction_failure_reason: z.string().nullable().default(null),
  brand_extraction_started_at: z.string().nullable().default(null),
  brand_extraction_run_id: z.string().nullable().default(null),
  // Re-extraction bookkeeping. `retry_count` counts automatic
  // retries the runtime fired after a transient extraction failure; capped so
  // a persistently-failing crawl falls through to the manual-entry card.
  // `source_change_count` counts user-driven "re-extract from a different URL"
  // requests (allowed once). `reextraction_pending` is the deterministic
  // trigger flag: when true the workflow fires a fresh extraction child and
  // clears it, mirroring the null-status head-start trigger for the first run.
  brand_extraction_retry_count: z.number().int().nonnegative().default(0),
  brand_source_change_count: z.number().int().nonnegative().default(0),
  brand_reextraction_pending: z.boolean().default(false),
  // Set true when the user detaches an auto-injected saved brief via the
  // "remove the brand brief" / "don't use the brand info" chat op:
  // the brief is cleared and this session proceeds with NO brand. The
  // deterministic auto-extraction trigger (v1 maybeAutoStartBrandExtractionFromPrompt,
  // v2 buildOps('auto_start')) bails on it, so a brand URL still in the prompt
  // is treated as plain content and never re-fires extraction. The sibling
  // "re-extract" op leaves this false (it WANTS a fresh extraction). Defaulted
  // so sessions that predate the field fold to false.
  brand_extraction_declined: z.boolean().default(false),
  brand_bank: BrandBankSchema.nullable().default(null),
  brand_bank_locked_at: z.string().nullable().default(null),
  // Provenance of a pre-seeded bank. 'brand_library' marks a saved brief
  // injected at session start, and confirm-time auto-save must not re-save the
  // bank it came from. Null for banks built by in-session extraction.
  // `attached_via` records HOW it was attached: 'explicit' -- picked
  // in the pre-UIP selector; 'auto_detect' -- matched from the prompt
  // (enable_brand_reuse). The planner reads it to honor never-silent (announce
  // an auto-detected brief). Optional: legacy snapshots seeded before this field
  // read as undefined and the planner falls back to the silent 'explicit' path.
  brand_bank_source: z
    .object({
      attached_via: z.enum(['auto_detect', 'explicit']).optional(),
      brief_id: z.string(),
      kind: z.literal('brand_library'),
    })
    .nullable()
    .default(null),
  // User intent on how aggressively to apply brand styling to the video.
  // Captured before downstream tools consume the bank; null means
  // the user has not expressed a preference yet.
  brand_style_directive: z.enum(['keep_existing_style', 'hybrid']).nullable().default(null),
  // Brand-styled style text carried in from the brand card's preview picker.
  // When the user confirms with the "apply brand colors" tile
  // selected, the exact styling text behind the previewed image lands here
  // so bootstrap_script locks in the same look the user saw. Null means no
  // preview was carried (bootstrap regenerates the styling as before).
  brand_style_text: z.string().nullable().default(null),
  // CDN URL of the brand-styled preview image behind the brand card's
  // "Apply brand colors" tile. Persisted at confirm regardless of
  // which tile the user picked, so the card can re-render the two-up after
  // a reload or in the post-creation view; the FE-only preview atom does
  // not survive a reload. Null means no preview rendered before confirm.
  brand_style_preview_url: z.string().nullable().default(null),
  // Narrative arc for a branded video. Captured during mode_confirmation
  // and frozen at MODE_CONFIRMED so bootstrap_script sees a stable value
  // aligned with the section 2.6.6 refinement answers. Null means the
  // user has not picked yet -- either the session is not on the brand
  // path, or the planner has not converged on a type yet. Three values:
  //   - friction_to_flow:   Problem -> Solution arc.
  //   - product_showcase:   spotlight features / use cases / proof.
  //   - industry_explainer: break down a concept, trend, or topic.
  brand_video_type: z.enum(BRAND_VIDEO_TYPE_VALUES).nullable().default(null),
  // Remix carry-over of a brand source, pending the confirmation gate. Null on
  // non-brand-remix sessions. Internal planner state (not surfaced to the
  // timeline); status records the terminal outcome.
  brand_carry_state: BrandCarryStateSchema.nullable().default(null),
})

// Mode State

export const ModeSchema = z.enum(['explainer', 'narrative_story', 'ads'])
export type Mode = z.infer<typeof ModeSchema>

export const ModeStateSchema = z.object({
  mode: ModeSchema.nullable().default(null),
  confirmed: z.boolean().default(false),
  duration_seconds: z.number().int().nullable().default(null),
  // Runtime-persisted provenance for duration_seconds. Optional so older
  // sessions retain their historical serialized shape.
  duration_source: z.enum(['user_explicit', 'script_estimate', 'other']).nullable().optional(),
  // Explicit resolution of a pasted script that exceeds a shorter requested
  // duration. Only rewrite_to_duration authorizes a duration-derived rewrite.
  pasted_script_fit: z.enum(['preserve', 'rewrite_to_duration']).nullable().optional(),
  // Runtime-verified extraction reused by bootstrap so a second LLM extractor
  // failure cannot turn an authorized preserve into a creative rewrite.
  verified_pasted_script: z
    .object({
      script: z.string().min(1),
      shotEdits: z.array(z.object({ shot_id: z.string(), audio_vo: z.string() })),
    })
    .nullable()
    .optional(),
  // Set once at MODE_CONFIRMED by the planner per section 2.3.3 of
  // mode-confirmation-prompt.ts. Null for sessions that started before
  // this field was added or that have not yet reached MODE_CONFIRMED.
  input_type: z
    .enum(['prompt_only', 'script_only', 'prompt_and_script', 'audio_music', 'audio_script'])
    .nullish(),
  // True when the planner has detected brand intent but is still waiting
  // for the user to provide the brand URL.
  // Cleared once `global_constraints.brand_extraction_input` is set.
  brand_intent_pending: z.boolean().default(false),
})

// Open Question

export const OpenQuestionSchema = z.object({
  id: z.string(),
  question: z.string(),
  blocking: z.boolean(),
  missing_paths: z.array(z.string()),
})

// Style Preset (Auto Style Selection)

/**
 * Zod mirror of `tool-internals/style-catalog.ts`'s `StylePreset` interface --
 * kept here (not in tool-internals) so `MetaSchema.style_catalog` can validate
 * the shape seeded onto `spec.meta` at session creation. All fields required
 * strings: `resolveStyleCatalog` (apps/services/api/src/uip/uip-feature-gates.ts)
 * defaults missing optional catalog fields (shortDescription/useCase/
 * thumbnailUrl) to `''` before this ever gets seeded, so there is no
 * meaningful "absent" value to model here.
 */
export const StylePresetSchema = z.object({
  id: z.string(),
  label: z.string(),
  shortDescription: z.string(),
  useCase: z.string(),
  styleText: z.string(),
  thumbnailUrl: z.string(),
})

// Compile-time guard: keeps `StylePresetSchema` in sync with the `StylePreset`
// interface in tool-internals/style-catalog.ts -- fails to compile if the two
// shapes ever drift apart.
const _stylePresetShapeGuard: StylePreset = {} as z.infer<typeof StylePresetSchema>

// Meta Schema

/**
 * One consistency-ledger entry. Recorded facts only -- whether an
 * entry is enforceable is derived at read time (consistency/realizability.ts),
 * never stored, because the mark step runs mid-fold where the phase is
 * historical.
 */
export const StaleEntrySchema = z.object({
  artifact: z.enum(['anchor_bindings', 'global_constraints', 'script', 'visual_script']),
  discharge_paths: z.array(z.string()).optional(),
  dismiss_reason: z.string().optional(),
  dismissed_at: z.string().optional(),
  marked_while_absent: z.boolean().optional(),
  required_params: z.record(z.unknown()).optional(),
  since: z.string(),
  // What the edit that raised this entry changed. Optional so
  // pre-feature entries parse unchanged, and so sources whose delta
  // is not observable at mark time simply omit it.
  source_change: z.string().optional(),
  source_path: z.string(),
  tier: z.enum(['patch', 'tool']),
  urgency: z.enum(['confirm', 'mandatory']),
})

export const MetaSchema = z.object({
  spec_version: z.number().int().default(0),
  locked_at: z.string().nullable().default(null),
  mode_state: ModeStateSchema.default({}),
  auto_lock_deadline_at: z.string().nullable().default(null),
  blocking: z.boolean().default(true),
  open_questions: z.array(OpenQuestionSchema).default([]),
  // Audio-mode marker. Set to 'user_audio' when the session was created with
  // user-uploaded audio and the pre-voiceover pipeline has seeded the script
  // from ASR. In this mode the script (audio_vo across shots) is locked for
  // the rest of the session -- see unified-planner-prompt.ts audio-mode rules
  // and patch.ts update_shot_field(audio_vo) reject.
  audio_source: z.enum(['user_audio']).nullable().default(null),
  /**
   * Pinned snapshot of the `uip_consistency_guard` feature gate.
   * Read activity-side by the consistency contract guard. While false the guard
   * is record-only: it computes the rejection and logs it, and never blocks a
   * turn. Snapshot semantics -- an in-flight session keeps the value it started
   * with, so a mid-session flag flip cannot change a running workflow.
   */
  consistency_guard_enabled: z.boolean().default(false),
  // Per-session snapshot of the `enable_improved_visual_script` feature
  // gate, pinned at session creation.
  // When `true`, prompt-route classification can use the classified route;
  // when `false`, the effective prompt route stays legacy. Default `false`
  // keeps older sessions on the legacy route.
  improved_visual_script_enabled: z.boolean().default(false),
  story_mode_v3_enabled: z.boolean().default(false),
  // Per-session snapshot of the `enable_music_video_improvement` feature
  // gate. Music-video prompt routing and pure-music beat fallback require this
  // to be true; default false keeps older sessions on the non-music path.
  music_video_improvement_enabled: z.boolean().default(false),
  // Entry-point music declaration. True when the session was created via the
  // song-to-video front door (`CreateUipSessionDto.is_music`): prompt-route
  // resolution short-circuits to 'music' without calling the classifier.
  // Effective routing still requires `music_video_improvement_enabled`.
  // Default false keeps older sessions on classifier-driven routing.
  is_music: z.boolean().default(false),
  // Creation tab / entry use case the session was started from (web
  // CreateUseCaseKey, e.g. 'news-article-to-video'), sanitized AND
  // allowlisted API-side because it reaches the planner LLM every turn via
  // the wholesale spec.meta context payload. Pinned at session creation by
  // buildInitialSpec; session-constant, runtime-owned (NOT in the
  // PATCH_SPEC allow-list). Optional with no default: absent (key dropped
  // in serialization) on older sessions and tab-less sessions, so
  // legacy specs keep their shape.
  entry_use_case: z.string().optional(),
  // Content-detected music verdict for the uploaded audio (tiered detector:
  // ID3 vendor tag at session creation, then YAMNet / LLM in the
  // pre-voiceover pipeline). Unlike `is_music` (user intent) and
  // `mode_state.input_type='audio_music'` (planner classification, which by
  // construction implies a filename/brief topic anchor), this flag carries NO
  // topic-source semantics -- it only feeds `hasUipMusicSignal` so routing
  // can catch music uploads with junk filenames.
  audio_is_music: z.boolean().default(false),
  // Music beat-sheet readiness, folded from the MusicPreAnalysisWorkflow ->
  // UIP `music_beat_sheet` signal. 'ready' = beat sheet persisted at
  // long_take/experts/beat_sheet.json; 'unavailable' = not music / analysis
  // failed -> the VS tool uses the ASR-timing fallback. Undefined for non-music
  // sessions and before the signal lands. Replaces the old artifact-polling.
  music_beat_sheet_status: z.enum(['ready', 'unavailable']).optional(),
  // Per-session snapshot of the `enable_transcript_voice_preview` feature
  // gate. Pinned at session creation so the script tool can allow inline
  // TTS markup only for gated users, and older sessions keep the
  // legacy "pure spoken text only" prompt.
  transcript_voice_preview_enabled: z.boolean().default(false),
  // TTS vendor hard cap on script word count. Runtime audits after every
  // script-content mutation (script tool / VS tool / PATCH_SPEC shot ops)
  // and sets `exceeded: true` when the total script word count exceeds
  // `cap`. When exceeded, runtime blocks script_review auto-continue and
  // refinement auto_lock_deadline, and removes the "Create video" CTA
  // option from the review gate. Null means "not audited yet" (audio
  // mode -- never audited -- or pre-script session). See
  // tool-internals/script-word-cap-audit.ts. Runtime-managed; NOT in
  // PATCH_SPEC allow-list.
  script_word_cap: z
    .object({
      exceeded: z.boolean().default(false),
      word_count: z.number().int().nonnegative().default(0),
      // Defense-only default for an externally-deserialized `script_word_cap`
      // that omits `cap`. The runtime audit (`writeScriptWordCapAudit`) always
      // populates `cap` explicitly from `getEffectiveScriptWordCap`, so this
      // default is a safety net for storage / patch paths, not a behavioral knob.
      cap: z.number().int().positive().default(EXPANDED_STORY_MODE_LIMITS.absoluteMaxScriptWords),
    })
    .nullable()
    .default(null),
  // Per-session snapshot of the `auto_style_selection` feature gate (auto-style
  // spec, "preset-only" V1). Pinned at session creation from
  // `UipSessionWorkflowParams.autoStyleEnabled`; when false,
  // `global_constraints.style_mode` is forced 'manual' regardless of the
  // composer's selection. Optional so pre-feature sessions fold to
  // undefined (treated as disabled).
  auto_style_enabled: z.boolean().optional(),
  // Auto Style Selection ranking catalog (spec, Task 6B): the
  // preset style catalog (presets/story-mode/styles.json), resolved ONCE by the
  // API service at session creation (only when `auto_style_enabled` is true)
  // and pinned here so the `select_auto_style` activity can rank over it
  // purely from folded session state, with no catalog I/O in the activity.
  // Absent when the gate is off, or for pre-feature sessions; the activity
  // folds absent to `[]`.
  style_catalog: z.array(StylePresetSchema).optional(),
  // The consistency ledger. Optional so pre-feature sessions fold to
  // undefined.
  stale_artifacts: z.array(StaleEntrySchema).optional(),
})

// Spec (single source of truth)

export const SpecSchema = z.object({
  global_constraints: GlobalConstraintsSchema,
  visual_script: VisualScriptSchema,
  meta: MetaSchema,
})

// TypeScript Types

export type BrandBank = z.infer<typeof BrandBankSchema>
export type BrandCarryState = z.infer<typeof BrandCarryStateSchema>
export type GlobalConstraints = z.infer<typeof GlobalConstraintsSchema>
export interface Meta
  extends Omit<
    MetaBase,
    | 'audio_is_music'
    | 'audio_source'
    | 'is_music'
    | 'locked_at'
    | 'script_word_cap'
    | 'transcript_voice_preview_enabled'
  > {
  /**
   * Optional. True when the uploaded audio was detected as music by content
   * (ID3 vendor tag / YAMNet / LLM tiers). Routing signal only -- carries no
   * topic-source semantics. See MetaSchema `audio_is_music`.
   */
  audio_is_music?: boolean
  /**
   * Optional. 'user_audio' when the session was created with user-uploaded
   * audio; null/undefined for standard TTS sessions. See MetaSchema.
   */
  audio_source?: 'user_audio' | null
  /**
   * Optional. True when the session was created via the song-to-video entry
   * point (entry-level music declaration). See MetaSchema `is_music`.
   */
  is_music?: boolean
  locked_at?: null | string
  /**
   * Optional. TTS vendor word-cap audit result. See MetaSchema
   * `script_word_cap` comment and tool-internals/script-word-cap-audit.ts.
   */
  script_word_cap?: null | {
    cap: number
    exceeded: boolean
    word_count: number
  }
  transcript_voice_preview_enabled?: boolean
}
export type ModeState = z.infer<typeof ModeStateSchema>
export type OpenQuestion = z.infer<typeof OpenQuestionSchema>
export type PreSelectedAsset = z.infer<typeof PreSelectedAssetSchema>
export type Shot = z.infer<typeof ShotSchema>
// The shape PlannerShotSchema (planner-schema.ts) actually infers
// for a planner-emitted shot -- everything Shot has, minus
// visual_primary.availability. That field is intentionally absent from the
// planner's Zod schema (see VisualPrimarySchema's comment above: the
// canonical default exists BECAUSE the planner-side schema doesn't carry
// it), so PlannerOutputLike's ops union uses this instead of Shot for
// replace_all_shots / replace_shots_range -- keeping the mirror check honest
// without asking the model to emit a field no prompt mentions. Do not use
// this type outside the PlannerOutputLike mirror: every runtime consumer,
// patch applier, and spec writer takes the canonical Shot.
export type PlannerEmittedShot = Omit<Shot, 'visual_primary'> & {
  visual_primary: Omit<Shot['visual_primary'], 'availability'>
}
export interface Spec extends Omit<SpecBase, 'meta'> {
  meta: Meta
}
export type StagedAssetRef = z.infer<typeof StagedAssetRefSchema>
export type VisualScript = z.infer<typeof VisualScriptSchema>
type MetaBase = z.infer<typeof MetaSchema>
type SpecBase = z.infer<typeof SpecSchema>

// Message

export interface ClarifyOption {
  /** True when selecting this specific option implies the user will upload assets next. */
  expect_assets?: boolean | null
  id: string
  label: string
}

export type EditMode = 'CREATIVE' | 'EXACT'
export interface ExactLock {
  shot_id: string
  text: string
}

// Re-exported from @reelmakeeasy/common/uip/active-modal-kind's SOT.
export { ACTIVE_MODAL_KIND_VALUES, type ActiveModalKind }

export interface Message {
  /** For user replies: which assistant message (with options) this answers. */
  answer_to_message_id?: string
  /** Activity attempt number (1-based). Increments on retry. */
  attempt?: number
  content: string
  /** Activity execution id that produced this message. Stable across retries. */
  exec_id?: string
  /**
   * True when this assistant clarify turn expects the user's next reply to
   * include newly uploaded assets (for example: "I'll upload the references").
   */
  expect_assets?: boolean
  message_id?: string
  options?: ClarifyOption[]
  /** Phase at the time this message was created (assistant messages only). */
  phase?: PlannerPhase
  /** Character index in `content` where the question part begins. Undefined when there is no ack/question split. */
  question_index?: number
  role: 'assistant' | 'user'
  /** Canvas Edit modal open when this user message was sent. User messages only. */
  sent_from?: ActiveModalKind
  /** Spec version at the time this message was created (assistant messages only). */
  spec_version?: number
  timestamp: string
  /** Logical turn identifier -- reserved for a future turn-level ID distinct from exec_id. Currently mirrors exec_id. */
  turn_id?: string
  uploaded_assets?: UploadedAsset[]
  /** Original user-send timestamp (user messages). Optional for backward compatibility. */
  user_timestamp?: string
}

export type PlannerAnchorOperation = 'REMOVE_ANCHOR' | 'UPSERT'

export interface PlannerAnchorRequest {
  anchor_id: string
  edit_instruction?: null | string
  label?: null | string
  operation?: null | PlannerAnchorOperation
  source_asset_id?: null | string
  // Was `string[]` (no `| null`) -- restoring the PlannerOutputLike
  // mirror check surfaced that AnchorRequestSchema (planner-schema.ts) has
  // always allowed null here, like every sibling field on this interface.
  source_asset_ids?: null | string[]
  source_update_mode?: null | PlannerAnchorSourceUpdateMode
  type?: 'CHARACTER' | 'OBJECT' | null
}
export type PlannerAnchorSourceUpdateMode = 'APPEND' | 'REPLACE'

export type PlannerScope = 'ANCHOR_IDS' | 'FULL' | 'SHOT_IDS' | 'SHOT_RANGE'

export interface PlannerScopeSpec {
  anchor_ids?: null | string[]
  from_shot_id?: null | string
  scope: PlannerScope
  shot_ids?: null | string[]
  to_shot_id?: null | string
}

export interface PlannerToolParams extends PlannerScopeSpec {
  anchor_requests?: null | PlannerAnchorRequest[]
  edit_mode: EditMode
  // Was `ExactLock[]` (no `| null`) -- restoring the
  // PlannerOutputLike mirror check surfaced that PlannerToolParamsSchema
  // (planner-schema.ts) has always emitted this key as nullable, not omitted.
  exact_locks?: ExactLock[] | null
  // Only meaningful for `generate_explainer_visual_script` with scope=FULL.
  // See `PlannerToolParamsSchema.refresh_beat_sheet` doc comment.
  refresh_beat_sheet?: boolean | null
  // Only meaningful for `generate_explainer_visual_script` with scope=FULL.
  // See `PlannerToolParamsSchema.refresh_world_bible` doc comment.
  refresh_world_bible?: boolean | null
  // Only meaningful for `generate_explainer_script` in script_review /
  // refinement. See `PlannerToolParamsSchema.run_extractor` doc comment.
  run_extractor?: boolean | null
}

export interface ReviewGate {
  kind: 'BRAND_REVIEW' | 'SCRIPT_REVIEW'
  options: ClarifyOption[]
  status: 'WAITING_FOR_USER'
  token: string
}

export interface ScriptArtifact {
  gui_request_id?: string
  pending_vs_apply?: boolean
  scope: PlannerScopeSpec
  script: string
  shot_edits: ScriptShotEdit[]
  /**
   * The script as it read when the OUTSTANDING staleness entry was raised.
   * Edits accumulate against this, not against the immediately
   * previous text: the ledger upserts by (artifact, source_path), so a typo fix
   * landing after a rewrite would otherwise replace the rewrite's delta with its
   * own and let the planner dismiss both. Cleared implicitly -- once the entry is
   * discharged, the next edit starts a fresh baseline.
   */
  stale_baseline?: string
}

export interface ScriptReviewContext {
  global_constraints: GlobalConstraints
  script: string
}

export interface ScriptShotEdit {
  audio_vo: string
  shot_id: string
}

// Session State

export interface CachedArtifacts {
  /**
   * Session-cumulative set of upload asset IDs that have ever been
   * absorbed as a source for any anchor candidate. Includes uploads
   * dropped from the current `anchor_plan` via REPLACE rebinds -- the
   * VS prompt's "Allowed Direct Uploaded Asset IDs" must keep filtering
   * those out so the LLM does not bind shots to a leftover upload that
   * is now represented by a generated anchor (story-mode does not have
   * this leak because story-mode does a single-shot anchor generation;
   * UIP's iterative refinement made this surface). See
   * `excludeCanonicalizedAnchorSourceAssets`.
   */
  absorbed_upload_ids?: string[]
  anchor_assets_summary?: AnchorAssetsSummary
  anchor_plan?: AnchorAssetPlanArtifact
  /**
   * Cumulative count of deadline auto-extends fired by the workflow's
   * deadline-expiry handler across the session lifetime (script_review +
   * refinement phases combined; the counter does not reset between phases).
   * Capped by the workflow (see `handleDeadlineExpiry` in
   * `libs/story-mode-runtime/src/workflows/uip/turn-executor.ts`) to prevent
   * unbounded session lifetime. Past the cap the workflow auto-continues
   * (script_review) or auto-confirms (refinement) instead of extending.
   */
  auto_extend_count?: number
  /**
   * Marker for the most recent brand-brief GUI draft-edit flush. Surfaced as an
   * event-only `gui_request_id` on the resulting session_changed so the FE folds
   * that snapshot into the prior brand card instead of rendering it as a separate
   * Updated/Outdated version. Set per flush (fresh id); only re-emitted when it
   * changes, so the agent's genuine rewrite (no new flush) is never folded.
   */
  brand_draft_gui_request_id?: string
  pending_anchor_plan_update_request?: AnchorPlanUpdateRequest
  pending_asset_assignment_plan?: AssetAssignmentPlanArtifact
  pending_global_constraints?: GlobalConstraints
  pending_visual_script_scope?: PlannerScopeSpec
  pending_visual_script_shots?: Shot[]
  /**
   * Which prompt segment the current `planner_response_id` belongs to.
   * Used to detect the mode_confirmation -> post_confirmation crossing
   * inside the planner loop: when the runtime sees a stored segment of
   * `'mode_confirmation'` while the session is now in a post-confirmed
   * phase, it deletes the old chain id and starts a fresh chain with
   * the post-confirmation system prompt.
   */
  planner_chain_segment?: 'mode_confirmation' | 'post_confirmation'
  /**
   * Abandoned-but-not-yet-deleted chain response ids accumulated during
   * the session. Two append paths:
   *
   *   1. mode_confirmation -> post_confirmation boundary restart -- the
   *      mode_confirmation chain's last id is pushed here before
   *      `planner_response_id` is reset to undefined.
   *   2. Gemini Layer 2 fallback -- when a chain call fails and the
   *      Gemini fallback succeeds, the chain we were continuing has
   *      been abandoned; its last successful id (the
   *      `previousResponseId` we passed in) is pushed here.
   *
   * Drained by `cleanupPlannerChainActivity` calls at workflow exit so
   * orphan chains do not linger at OpenAI past session lifetime. The
   * 30-day OpenAI TTL is the floor; this list is the eager-cleanup
   * mechanism that keeps data residency to the session lifetime.
   *
   * Optional + read defensively: pre-patch sessions leave it undefined
   * (treated as empty array). Bounded in practice: 1 mode_conf orphan
   * + N rare Gemini-fallback orphans per session; we do NOT cap the
   * list size because hitting double digits would indicate a separate
   * infra problem worth surfacing rather than silently truncating.
   */
  planner_orphaned_chain_response_ids?: string[]
  /**
   * OpenAI Responses API chain id of the most recent planner LLM call.
   * Optional + read defensively: pre-chain sessions and Gemini-fallback
   * paths leave this undefined. Threaded through every planner step so
   * the chain spans the whole session; cleared at the mode_confirmation
   * -> post_confirmation boundary so the next segment starts fresh.
   * Cleared (and the chain deleted via `cleanupPlannerChainActivity`)
   * when the workflow exits.
   */
  planner_response_id?: string
  prompt_route?: null | PromptRouteArtifact
  recovery_failures?: PlannerRecoveryFailure[]
  tool_events: ToolExecutionEvent[]
  uploaded_assets?: UploadedAsset[]
  working_script?: ScriptArtifact
}

export type PlannerPhase =
  | 'bootstrap_brand'
  | 'bootstrap_script'
  | 'bootstrap_visual'
  | 'brand_review'
  | 'mode_confirmation'
  | 'refinement'
  | 'script_review'

export interface PlannerTodoItem {
  executor_hint?: null | TodoExecutorHint
  id: string
  status: 'done' | 'pending'
  title: string
}

export interface PlannerTodoState {
  items: PlannerTodoItem[]
  phase: PlannerPhase
}

export interface QueuedUserItem {
  answer_to_message_id?: string
  created_at: string
  id: string
  message: string
  /** Original user-send time, if provided by ingress. */
  sent_at?: string
  /** Canvas Edit modal open when this queued message was sent. */
  sent_from?: ActiveModalKind
  uploaded_assets: UploadedAsset[]
}

export interface SessionBootstrapState {
  /**
   * Extraction result of the article the user pasted into a
   * news-article-to-video session. Projected by foldSession
   * from the latest completed `article_extraction_completed` event; absent /
   * null on non-news sessions, on older sessions, and until the
   * extraction lands. Step-3 consumers (generate_intent_context /
   * generate_explainer_script grounding, asset candidates) read it from here;
   * the full text lives at `text_artifact_path` in storage -- only the excerpt
   * rides in state.
   */
  article_context?: null | {
    author: null | string
    date: null | string
    /**
     * In-body article photos, excluding key image + logo.
     * Optional: sessions bootstrapped before this field existed omit it, and the
     * readers default it to [].
     */
    image_staging_uris?: string[]
    key_image_staging_uri: null | string
    logo_staging_uri: null | string
    site_name: null | string
    text_artifact_path: string
    text_excerpt: string
    title: string
    url: string
    word_count: number
  }
  /**
   * Deterministic carry-over summary of the source UIP session when this
   * session was created via Remix (`remix_project_id`). Built by the API
   * service (`summarizeRemixSource`) from the source's saved spec fields and
   * seeded here by `buildInitialSessionState`; rendered into planner prompts
   * via `buildRemixContextBlock` (presented to the user + used as inheritable
   * defaults). `null` on non-Remix sessions.
   */
  remix_context: null | string
  /**
   * Structured style seed captured at session creation. This is runtime
   * context (not the canonical spec field) and may be used by tools as a
   * fallback or guidance source.
   */
  seed_style_instruction: null | {
    style_image_uri?: string
    style_name?: string
    style_text?: string
    style_thumbnail_url?: string
  }
  /**
   * Pasted-URL router verdict, projected by
   * foldSession from the latest url_classification_completed event. Optional:
   * absent on pre-router sessions and until the classifier runs. The
   * mode-confirmation prompt renders the 2-option routing question while the
   * verdict is below the confidence floor.
   */
  url_route?: null | {
    classification: 'article' | 'brand' | 'error'
    confidence: number
    url: string
  }
}

export interface SessionState {
  _loaded_asset_descriptions?: AssetDescriptionsArtifact
  audioPath?: string
  /**
   * Per-session auto-continue setting, projected from the
   * session_initialized snapshot by foldSession. False = the user opted out of
   * auto-continue before entering UIP, so no review-gate timer fires. Read by
   * the API-side deadline writers (send-message / transcript-editing) to skip
   * re-arming a countdown the workflow will never honor. Absent/true = legacy
   * always-on behavior.
   */
  auto_continue_enabled?: boolean
  bootstrap: SessionBootstrapState
  brand_telemetry?: { brief_edit_count?: number; files_uploaded_count?: number }
  /**
   * Snapshot of the `uip_brand_extraction_enabled` feature gate, captured at
   * session creation from `UipSessionWorkflowParams.brandExtractionEnabled`.
   * When false the brand-intent classifier in mode-confirmation-prompt is a
   * no-op and the workflow does not subscribe to brand signals or fire the
   * extraction child. Snapshot semantics ensure in-flight sessions keep their
   * evaluation even if the gate flips later.
   */
  brandExtractionEnabled?: boolean
  cached_artifacts: CachedArtifacts
  conversation_summary: string
  created_at: string
  /**
   * Per-project generation-resolution setting. Populated at session
   * creation from UipSessionWorkflowParams; snapshot semantics so in-flight
   * sessions keep their value. Consumed by anchor generation to pick the
   * image size tier. Absent = current default sizing.
   */
  generationResolution?: { imageSize?: string; videoResolution?: string }
  /** Cumulative list of GUI request IDs that the workflow has finished processing. */
  gui_request_ids?: string[]
  /**
   * Populated at session creation from UipSessionWorkflowParams; snapshot
   * semantics so in-flight sessions keep their value. Consumed by anchor
   * generation to honor the user-selected image model. Absent = legacy
   * style-based generation path.
   */
  imageModel?: string
  /**
   * True while the workflow is blocked inside condition() waiting for user signals.
   * False during planner turns, deadline handling, pre-voiceover gate, and all
   * other internal transitions. Frontend uses this to freeze the countdown timer.
   */
  is_idle?: boolean
  is_processing: boolean
  is_running_planner_loop?: boolean
  /**
   * Snapshot of the user-facing quality tier for this session (standard |
   * standard_plus | premium | ultra). Read by the visual-script tool to key its
   * primary model in the `uip_script_model` dynamic config; absent keeps the
   * compiled-in chain.
   */
  modelSelectorTier?: ModelSelectorAnalyticsTier
  /**
   * Populated at session creation from UipSessionWorkflowParams; snapshot
   * semantics so in-flight sessions keep their value. Scopes org-keyed
   * config reads (image-model fallback chain) at anchor generation. Absent
   * = legacy style-based generation path.
   */
  orgId?: string
  processing_run_id?: null | string
  queued_items?: QueuedUserItem[]
  review_auto_continue_deadline_at: null | string
  review_gate?: null | ReviewGate
  sessionId: string
  spec: Spec
  spec_history: SpecHistoryEntry[]
  todo_state: PlannerTodoState
  tool_call_states?: ToolCallStateEntry[]
  transcript: Message[]
  /**
   * Snapshot of the selected transition/video generation model. Visual-script
   * prompt builders use this for model-specific pacing guidance; absent keeps
   * legacy prompt behavior.
   */
  transitionVideoModel?: string
  updated_at: string
  voice_over_artifacts_ready?: boolean
  voice_over_ready?: boolean
  /**
   * Structured voice metadata for the selected voice (preset / temp clone
   * / saved clone / uploaded audio). Populated at session creation from
   * `UipSessionWorkflowParams.voiceProfile`. Consumed by anchor
   * generation to soft-bias narrator visual characteristics in the
   * non-audio path. For audio mode, the canonical source is
   * `long_take/voice_character.json` written by the pre-voiceover
   * workflow's voice character analysis stage; this field still carries
   * the same structured metadata as a fallback / cross-check.
   */
  voiceProfile?: VoiceProfile
  /** Written once at session creation; controls new-protocol vs legacy signal paths. */
  workflow_protocol_version?: string
}

/**
 * Snapshot stored in storage `session-state.json`.
 * Keep backward-compatible optional top-level fields while allowing
 * newer `cached_artifacts`-scoped structure.
 */
export interface PersistedSessionState {
  anchor_assets_summary?: AnchorAssetsSummary | null
  audio_path?: string
  /** Backend-owned review mode used by persistence consumers and notification emitters. */
  auto_continue_enabled?: boolean
  bootstrap?: SessionBootstrapState
  brand_telemetry?: { brief_edit_count?: number; files_uploaded_count?: number }
  cached_artifacts?: {
    anchor_assets_summary?: AnchorAssetsSummary | null
    auto_extend_count?: number
    brand_draft_gui_request_id?: string
    pending_global_constraints?: GlobalConstraints | null
    prompt_route?: null | PromptRouteArtifact
    uploaded_assets?: UploadedAsset[]
    working_script?: null | ScriptArtifact
  }
  conversation_summary?: string
  pending_global_constraints?: GlobalConstraints | null
  prompt_route?: null | PromptRouteArtifact
  queued_items?: QueuedUserItem[]
  review_auto_continue_deadline_at?: null | string
  review_gate?: null | ReviewGate
  tool_call_states?: ToolCallStateEntry[]
  transitionVideoModel?: string
  uploaded_assets?: UploadedAsset[]
  /** Mirrors SessionState.voiceProfile so the value survives session-snapshot round-trip. */
  voiceProfile?: VoiceProfile
  working_script?: null | ScriptArtifact
}

export interface SpecHistoryChange {
  diff_summary: string
  ops?: PatchOp[]
  source: string
  spec_version: number
  timestamp: string
}

export interface SpecHistoryEntry {
  diff_summary: string
  ops?: PatchOp[]
  prev_spec: Spec
  source: SpecHistorySource
  timestamp: string
}

export type SpecHistorySource = 'PATCH_SPEC' | 'SYSTEM' | 'TOOL_ARTIFACT' | 'UNDO'

export interface SpecHistoryTurn {
  changes: SpecHistoryChange[]
  spec_version_after: number
  spec_version_before: number
  turn_end_time: null | string
  turn_start_time: string
  user_message_preview: string
}

export interface TodoExecutorHint {
  executor_patch_ops?: null | string[]
  executor_tool?: null | PlannerToolCall['tool']
  executor_type: TodoExecutorType
  scope_hint?: null | string
  shared_batch_key?: null | string
}

export type TodoExecutorType = 'PATCH_SPEC' | 'SESSION_CONTROL' | 'TOOL_CALLS'

// Tier 1 brand-bank edits during brand_review. Path is a literal union for
// compile-time allowlist; patch-apply re-checks at runtime.
export interface PlannerStructureEdit {
  anchor_shot_id?: null | string
  insert_audio_vo?: null | string
  op: StructureEditOp
  position?: 'AFTER' | 'BEFORE' | null
  shot_ids?: null | string[]
  split_audio_segments?: null | string[]
}

export interface PlannerToolCall {
  params: PlannerToolParams
  reason: null | string
  tool:
    | 'describe_uploaded_images'
    | 'generate_anchor_assets'
    | 'generate_explainer_script'
    | 'generate_explainer_visual_script'
    | 'generate_intent_context'
    | 'plan_asset_assignment'
    | 'select_auto_style'
}

// Session-control directive commands. Historically also included 'LOCK_PLAN'
// (a language-triggered lock), but that path only set `meta.locked_at` without
// starting the story-mode production orchestration -- a half-baked lock. The
// planner is now instructed to redirect lock/proceed intents to the UI button
// via ASK_CLARIFY (see unified-planner-prompt). `UNDO_LAST` is the only
// remaining session-control command.
export type SessionControlCommand = 'UNDO_LAST'

export type StructureEditOp = 'DELETE' | 'INSERT' | 'MERGE' | 'SPLIT'

/**
 * One substep's projected progress: a human-readable `description` (from the
 * substep catalog, raw name as fallback) plus its lifecycle `status`.
 */
export interface SubstepState {
  description: string
  status: SubstepStatus
}

/**
 * Publish-only substep progress of one tool within a tool call ("subTools" on
 * the FE). id mirrors the entry's `tools` values ('anchor_vs_batch' for the
 * batch, whose two arms merge into one map). Stripped from every persisted
 * payload by buildPersistedPayloads -- lives only in the live /status flow.
 */
export interface SubToolState {
  id: string
  sub_step_states: Record<string, SubstepState>
}

export interface ToolCallStateEntry {
  ended_at?: null | string
  error_code?: ToolErrorCode
  id: string
  message?: string
  started_at: string
  status: 'failed' | 'running' | 'succeeded'
  sub_tools?: SubToolState[]
  tools: PlannerToolCall['tool'][]
}

export type ToolErrorCode =
  | 'INVALID_INPUT'
  | 'MISSING_DEPENDENCY'
  | 'OUT_OF_SCOPE_MUTATION'
  | 'TOOL_RUNTIME_ERROR'

export interface ToolExecutionEvent {
  code?: 'OK' | ToolErrorCode
  message: string
  missing?: string[]
  retryable?: boolean
  status: 'error' | 'success'
  timestamp: string
  tool: PlannerToolCall['tool']
}

export type UndoScope = 'COUNT' | 'LAST_CHANGE' | 'LAST_USER_TURN'

export interface UploadedAsset {
  asset_id: string
  /**
   * Optional md5 (first 12 hex chars) of the asset bytes. Populated for brand
   * assets so the anchor/upload pool can dedup the same image across sources
   * (a real user upload and its brand-staged synthetic, or an upload that is
   * byte-identical to a website extraction). Absent on assets that were never
   * hashed; pool dedup then falls back to file_path / asset_id.
   */
  content_hash?: string
  content_type: string
  file_name: string
  file_path: string
  uploaded_at: string
}

// Session API Response

export interface SessionResponse {
  anchor_assets: AnchorAssetsSummary | null
  audio_path?: string
  auto_lock_deadline_at: null | string
  blocking: boolean
  can_undo: boolean
  diff_summary: string
  /**
   * Human-readable failure reason. Populated only when `status === 'failed'`
   * (e.g. pre-voiceover ASR failure). Surface this to the user directly.
   */
  failure_message?: string
  /**
   * Event-only marker for the latest brand-brief GUI draft-edit flush, surfaced
   * so the live (/status) session_changed carries it just like the persist path.
   * The FE folds that snapshot into the prior brand card instead of rendering a
   * separate Updated/Outdated version.
   */
  gui_request_id?: string
  is_idle: boolean
  is_processing: boolean
  is_running_planner_loop?: boolean
  locked_at: null | string
  mode_state: ModeState
  open_questions: OpenQuestion[]
  phase: PlannerPhase
  plan_md: string
  queued_items: QueuedUserItem[]
  reply: string
  reply_expect_assets: boolean
  reply_options: ClarifyOption[]
  review_auto_continue_deadline_at: null | string
  review_gate?: null | ReviewGate
  script_review_context?: null | ScriptReviewContext
  script_word_cap_exceeded: boolean
  session_id: string
  spec: Spec
  spec_history_turns: SpecHistoryTurn[]
  status: SessionStatus
  tool_call_states?: ToolCallStateEntry[]
  transcript: Message[]
  uploaded_assets: UploadedAsset[]
}

export type SessionStatus = 'active' | 'cancelled' | 'completed' | 'failed' | 'timed_out'

// Validator Output

export interface ValidationResult {
  blocking: boolean
  open_questions: OpenQuestion[]
  warnings: string[]
}
