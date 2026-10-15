/**
 * Anchor + asset-plan artifact types for the UIP planner runtime. Split out
 * of types.ts; re-exported there (`export * from './anchor-types'`) so the
 * package barrel and existing `../types` consumers see them unchanged.
 */

import type { VoiceProfileGender } from '@shared/types/api/voice-profile'

import type { PlannerAnchorRequest } from './types'

export interface AnchorAssetCandidate {
  anchor_id: string
  edit_instruction?: null | string
  // Ordered history of user edit instructions applied to this anchor,
  // oldest first. Code appends on each UPSERT (dedup vs the immediately
  // preceding entry) and clears it on a source rebind. Phase B applies
  // them in order (a later instruction overrides an earlier one on any
  // attribute they both name) so sequential edits ACCUMULATE instead of
  // the latest one silently dropping earlier ones -- the previous anchor
  // image is no longer attached as a reference. `edit_instruction`
  // stays as the latest single entry for display / back-compat.
  edit_instructions?: string[]
  // `is_multi_angle: true` marks this candidate as ONE view of a
  // multi-angle set (sibling anchor_ids carry other views). Downstream
  // Phase B prompt spec uses it to emit a single-hero-shot reference
  // instead of a multi-view grid.
  is_multi_angle: boolean
  // Short `The <X>` label for logging and UI, e.g. "The Runner".
  keyword: string
  label: string
  // `passthrough: true` means the source image is already a finished
  // reference (logo / icon / brand mark) and Phase C must skip Nano
  // Banana and copy the source URI directly to `anchor_assets/final`.
  passthrough: boolean
  // The form the user's PINNED PROMPT asks this subject to take, e.g.
  // "a pirate". null / absent means the as-uploaded appearance. Phase B applies
  // it as the FIRST entry of the edit-instruction Override chain, so later user
  // edits win on any attribute they both name. Unlike `edit_instructions` it is
  // NOT cleared on a source rebind: swapping which photo of Sam we use does
  // not retract "make him a pirate". Optional so a plan persisted before this
  // field existed still satisfies the type.
  prompt_transform?: null | string
  // Specific named entity (person / brand / product) if the script or
  // user input named one; otherwise null. Drives VS "Identity Priority".
  proper_name: null | string
  reason: string
  source_asset_id: null | string
  source_asset_ids: string[]
  // Structured gender for CHARACTER anchors, declared by the asset
  // manager alongside the `visual_reference` prose. Phase B validates its
  // emitted `depicted_gender` against this instead of reading gender back
  // out of prompt text. `'unknown'` disables the check.
  subject_gender?: VoiceProfileGender
  type: 'CHARACTER' | 'OBJECT'
  // Demographics / physiology description only (no style, no mood).
  // Source of truth for "preserve exact appearance" in Phase B prompt.
  visual_reference: string
  // 3-word Title Case functional identifier, e.g. "Male Athletic Runner".
  // Used by Phase B reference-sheet header and by VS for Subject
  // Substitution (replace Proper Name -> visual_tag in shot descriptions).
  visual_tag: string
}

export interface AnchorAssetPlanArtifact {
  candidates: AnchorAssetCandidate[]
  generated_at: string
}

export interface AnchorAssetPromptSpec {
  anchor_id: string
  // Gender the prompt-spec LLM declared `generation_prompt` depicts.
  // Persisted so a wrong anchor can be diagnosed from the artifact
  // without re-reading the prompt prose.
  depicted_gender?: VoiceProfileGender
  generation_prompt: string
  // Carried through from candidate so Phase C can decide aspect ratio
  // and pass the right reference-sheet geometry without re-loading the
  // plan. Used by `resolveAnchorAspectRatio` and by `generateSingleAnchorImage`.
  is_multi_angle: boolean
  label: string
  // `passthrough: true` means Phase C should copy source image as anchor
  // without calling the image generator.
  passthrough: boolean
  // Verbatim text strings extracted from the source reference images
  // (via `describe_uploaded_images`'s `entities.brands_or_text`). Phase C
  // appends a "render this text verbatim" directive when present, so the
  // image generator preserves logo / packaging / brand text exactly
  // rather than letting the LLM rewrite it. Mirrors story-mode's
  // `LongTakeAnchorAssetTask.printed_text` in anchors.ts.
  printed_text?: string[]
  prompt_spec: string
  source_asset_id: null | string
  source_asset_ids: string[]
  type: 'CHARACTER' | 'OBJECT'
}

export interface AnchorAssetPromptSpecsArtifact {
  generated_at: string
  items: AnchorAssetPromptSpec[]
}

export interface AnchorAssetsSummary {
  anchors: AnchorAssetSummaryItem[]
  generated_at: string
  ready_count: number
  status: 'failed' | 'partial' | 'success'
  total_count: number
}

export interface AnchorAssetSummaryItem {
  anchor_id: string
  // Mirrors AnchorAssetCandidate.is_multi_angle so downstream (VS /
  // bridge-anchors / UI) can reason without re-loading the full plan.
  is_multi_angle: boolean
  keyword: string
  label: string
  // `passthrough: true` means the preview image is the user's original
  // upload (no Nano Banana pass). This field is for bookkeeping only.
  passthrough: boolean
  preview_asset_id?: null | string
  preview_relative_path?: null | string
  preview_url?: null | string
  // Mirrors AnchorAssetCandidate.prompt_transform. The summary is a
  // separate projection from the plan, and it is what the anchor library and
  // `plan-asset-assignment` read -- a transformed anchor is invisible to them
  // unless the field is carried here too. Optional / null for replayed and
  // pre-feature summaries.
  prompt_transform?: null | string
  proper_name: null | string
  // This anchor's image was rehydrated verbatim from the brand
  // library (a prior video for the same brand + style generated it), not
  // freshly generated this session. Drives the "reused from brand" UI badge.
  // Optional / defaults to absent so replayed and pre-feature summaries keep
  // their shape.
  reused?: boolean
  source_asset_id: null | string
  source_asset_ids: string[]
  status: 'failed' | 'generating' | 'planned' | 'ready'
  type: 'CHARACTER' | 'OBJECT'
  visual_tag: string
}

export interface AnchorPlanUpdateRequest {
  anchor_requests: PlannerAnchorRequest[]
  target_anchor_ids: string[]
}

export interface AssetAssignmentPlanAction {
  asset_id: string
  asset_source: 'anchor_asset' | 'user_upload'
  op: 'ADD' | 'REMOVE'
  reason: string
  shot_id: string
  usage: string
}

export interface AssetAssignmentPlanArtifact {
  actions: AssetAssignmentPlanAction[]
  generated_at: string
}

export type AssetIdentityClarity = 'clear' | 'limited' | 'not_applicable' | 'silhouette_only'

/**
 * Per-asset image description produced by `describeUploadedImages`.
 *
 * Body fields (description / tags / entities / quality / usage_guidance)
 * derive from the image-understanding prompt output.
 * UIP-native metadata (asset_id, content_type, file_name, file_path) is
 * kept on the same item for convenience. `summary` is a derived one-liner
 * used by UIP's context-builder for lightweight planner context; it is
 * NOT part of the LLM output contract.
 */
export interface AssetDescriptionItem {
  asset_id: string
  /**
   * LLM classification of the image's brand role (logo / product / character),
   * or null when generic. Used to bucket folded user uploads in the brand card.
   */
  brand_asset_kind?: 'character' | 'logo' | 'product' | null
  content_type: string
  description: null | string
  entities: {
    brands_or_text: string[]
    characters: string[]
    objects: string[]
  }
  file_name: string
  file_path: string
  quality: {
    /**
     * Whether a person upload carries enough observable identity detail for
     * recurring-character generation. Optional for persisted older
     * artifacts; new descriptions always populate it.
     */
    identity_clarity?: AssetIdentityClarity
    text_heavy_infographic: boolean
  }
  /**
   * Present only on `actor`-bucket uploads captioned under the
   * ao_asset_setting_intent gate: the place the photo was taken, split out of
   * the subject fields. Absent means the item was never split -- either a
   * non-actor bucket, or captioned before the gate. Its ABSENCE is therefore
   * not a statement that the photo had no setting.
   */
  setting?: {
    description: string
    tags: string[]
    text: string[]
  }
  summary: string
  tags: string[]
  usage_guidance: null | string
}

export interface AssetDescriptionsArtifact {
  generated_at: string
  items: AssetDescriptionItem[]
  /**
   * `2` marks an artifact produced by a build that applies the actor
   * policy. Absent or < 2 means every item is a legacy blended caption. Written
   * only under the gate, so gate-off output is byte-identical to before.
   * Permanent: with no backfill, the < 2 population never reaches zero.
   */
  schema_version?: number
}
