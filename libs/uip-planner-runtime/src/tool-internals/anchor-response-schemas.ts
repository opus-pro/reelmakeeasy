/**
 * The anchor tool's structured-output (responseFormat) schemas, in their
 * strict and legacy wire shapes. The anchor calls send the legacy shapes.
 *
 * Split out of anchor-generation.ts, which is otherwise prompt text and
 * orchestration: these schemas are what the model is contractually asked for,
 * and their `required` list is the thing the guard tests assert on.
 */

import { VoiceProfileGenderSchema } from '@shared/types/api/voice-profile'
import { z } from 'zod'

// The omit-tolerance these fields used to get from `.default()` now
// lives here instead, so every field can be REQUIRED in the emitted JSON
// Schema. `.default()` reads like the safe way to keep a field tolerant, but
// zod-to-json-schema drops any defaulted key out of `required` -- byte for
// byte the wire shape `.optional()` produces, i.e. exactly what the old
// comments here claimed to be avoiding. A non-required field is one the model
// is free to skip silently, and it did: on the grounding case every
// anchor came back with prompt_transform, proper_name, keyword and
// visual_reference unset, so the transform feature had no input at all and
// the anchor library's match keys had been degrading unnoticed. Required
// plus this preprocess keeps both properties -- the model has to answer, and a
// response that still omits a key parses instead of failing the whole plan.
const ANCHOR_ITEM_DEFAULTS = {
  is_multi_angle: false,
  keyword: '',
  passthrough: false,
  prompt_transform: null,
  proper_name: null,
  source_asset_id: null,
  source_asset_ids: [],
  subject_gender: null,
  visual_reference: '',
  visual_tag: '',
}

function withDefaults(defaults: Record<string, unknown>) {
  return (value: unknown): unknown =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? { ...defaults, ...value }
      : value
}

// The anchor item's fields, declared ONCE so the two wire variants below cannot
// drift apart. Every field here is required; the legacy variant re-attaches the
// `.default()` calls that used to sit inline.
const ANCHOR_ITEM_FIELDS = {
  anchor_id: z.string().trim().min(1),
  label: z.string().trim().min(1),
  type: z.enum(['CHARACTER', 'OBJECT']),
  reason: z.string().trim().min(1),
  source_asset_id: z.string().trim().nullable(),
  source_asset_ids: z.array(z.string().trim().min(1)),
  // Story-mode manifest parity: rich metadata surfaced here so the downstream
  // Phase B prompt spec and the VS prompt can reason about subjects without
  // re-deriving them.
  visual_tag: z.string().trim(),
  visual_reference: z.string().trim(),
  keyword: z.string().trim(),
  proper_name: z.string().trim().nullable(),
  is_multi_angle: z.boolean(),
  passthrough: z.boolean(),
  // The form the user's PINNED PROMPT asks this anchor's subject to take, e.g.
  // "a pirate". null means the as-uploaded / as-scripted appearance. Before this
  // field the only transform channel was `edit_instructions`, gated to
  // scope === 'ANCHOR_IDS', so a first full-scope generation could never honor
  // "make Sam a pirate" and rendered the uploaded clothing instead. Nullable
  // rather than defaulted-empty because null is the
  // meaningful value here, not a missing one.
  prompt_transform: z.string().trim().nullable(),
  // Structured mirror of the gender already stated in prose inside
  // visual_reference, so Phase B can be checked against it by equality.
  // The `.transform()` normalises `null` back to `undefined` so the
  // inferred type is unchanged.
  subject_gender: VoiceProfileGenderSchema.nullable().transform((value) => value ?? undefined),
}

/**
 * The strict wire schema: every field lands in the emitted JSON Schema's
 * `required`, so the model must answer each one and OpenAI strict mode accepts
 * the request. Omit-tolerance moves into the preprocess, so a model that still
 * skips a key degrades to the old default instead of failing the plan.
 */
export const AnchorAssetManagerOutputSchema = z.preprocess(
  withDefaults({ anchors: [] }),
  z.object({
    anchors: z.array(
      z.preprocess(withDefaults(ANCHOR_ITEM_DEFAULTS), z.object(ANCHOR_ITEM_FIELDS)),
    ),
  }),
)

/**
 * The legacy wire schema, which the anchor asset-manager call sends.
 * Built from the same field definitions with the `.default()` calls
 * re-attached, which is what drops each key out of `required` -- the shape
 * that lets the model skip prompt_transform and that OpenAI rejects.
 */
export const AnchorAssetManagerOutputSchemaLegacy = z.object({
  anchors: z
    .array(
      z.object({
        ...ANCHOR_ITEM_FIELDS,
        is_multi_angle: ANCHOR_ITEM_FIELDS.is_multi_angle.default(false),
        keyword: ANCHOR_ITEM_FIELDS.keyword.default(''),
        passthrough: ANCHOR_ITEM_FIELDS.passthrough.default(false),
        prompt_transform: ANCHOR_ITEM_FIELDS.prompt_transform.default(null),
        proper_name: ANCHOR_ITEM_FIELDS.proper_name.default(null),
        source_asset_id: ANCHOR_ITEM_FIELDS.source_asset_id.default(null),
        source_asset_ids: ANCHOR_ITEM_FIELDS.source_asset_ids.default([]),
        subject_gender: VoiceProfileGenderSchema.nullable()
          .default(null)
          .transform((value) => value ?? undefined),
        visual_reference: ANCHOR_ITEM_FIELDS.visual_reference.default(''),
        visual_tag: ANCHOR_ITEM_FIELDS.visual_tag.default(''),
      }),
    )
    .default([]),
})

const PROMPT_SPEC_FIELDS = {
  // Declared gender of the subject in `generation_prompt`. Compared by equality
  // against the resolved gender; never parsed back out of the prompt text.
  depicted_gender: VoiceProfileGenderSchema.nullable().transform((value) => value ?? undefined),
  generation_prompt: z.string().trim().min(1),
  prompt_spec: z.string().trim().min(1),
}

/** @internal exported for the strict-schema guard test */
export const AnchorPromptSpecOutputSchema = z.preprocess(
  withDefaults({ depicted_gender: null }),
  z.object(PROMPT_SPEC_FIELDS),
)

/** @internal the legacy shape; see `AnchorAssetManagerOutputSchemaLegacy`. */
export const AnchorPromptSpecOutputSchemaLegacy = z.object({
  ...PROMPT_SPEC_FIELDS,
  depicted_gender: VoiceProfileGenderSchema.nullable()
    .default(null)
    .transform((value) => value ?? undefined),
})
