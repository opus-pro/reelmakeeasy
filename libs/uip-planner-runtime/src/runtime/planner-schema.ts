import { z } from 'zod'

import type { ArtifactId } from '../consistency'

const ScopeSchema = z.enum(['ANCHOR_IDS', 'FULL', 'SHOT_IDS', 'SHOT_RANGE'])
const EditModeSchema = z.enum(['EXACT', 'CREATIVE'])
const ExactLockSchema = z.object({
  shot_id: z.string(),
  text: z.string(),
})
const AnchorRequestSchema = z.object({
  anchor_id: z.string(),
  edit_instruction: z.string().nullable().optional(),
  label: z.string().nullable().optional(),
  operation: z.enum(['REMOVE_ANCHOR', 'UPSERT']).nullable().optional(),
  type: z.enum(['CHARACTER', 'OBJECT']).nullable().optional(),
  source_asset_id: z.string().nullable().optional(),
  source_asset_ids: z.array(z.string()).nullable().optional(),
  source_update_mode: z.enum(['APPEND', 'REPLACE']).nullable().optional(),
})

const PlannerToolParamsSchema = z
  .object({
    scope: ScopeSchema,
    anchor_ids: z.array(z.string()).nullable(),
    shot_ids: z.array(z.string()).nullable(),
    from_shot_id: z.string().nullable(),
    to_shot_id: z.string().nullable(),
    edit_mode: EditModeSchema,
    exact_locks: z.array(ExactLockSchema).nullable(),
    anchor_requests: z.array(AnchorRequestSchema).nullable().optional(),
    // Only meaningful for `generate_explainer_visual_script` with scope=FULL.
    // Set true when the user explicitly asks to re-segment the storyboard
    // (e.g., "more shots", "tighter cuts", "re-segment") OR pacing was just
    // patched. When false (default) and existing shots are present, the VS
    // tool reuses the current shots' boundaries as the beat-sheet (no LLM
    // re-segmentation). Mutually exclusive with structure_edit -- the planner
    // contract rejects a VS call that has both. See unified-planner-prompt
    // section 7.2 "Segmentation routing".
    refresh_beat_sheet: z.boolean().nullable(),
    // Only meaningful for `generate_explainer_script` in script_review /
    // refinement. Set true whenever the user's latest message contains a full
    // pasted voiceover script (to keep verbatim OR to rewrite); the extractor
    // then decides preserve vs rewrite. Leave false / null (default) for a
    // pure edit instruction with no paste, so the extractor LLM call is
    // skipped and the tool writes/rewrites from intent. Bootstrap ignores
    // this -- it gates the extractor on the confirmed `input_type`. See
    // unified-planner-prompt section 10 "For generate_explainer_script".
    run_extractor: z.boolean().nullable(),
    // Only meaningful for `generate_explainer_visual_script` with scope=FULL.
    // Set true ONLY when the video's underlying WORLD/subject itself changes --
    // a topic/premise pivot large enough that the whole creative canon
    // (thematic core, visual strategy, world physics, guardrails) would be
    // rebuilt differently (e.g. "turn this coffee ad into a fintech
    // explainer"). This is a rare, worldview-level change. Do NOT set it for
    // tone/pacing/style tweaks, wording edits, or detail/narrowing edits to an
    // unchanged subject -- the canon is robust to those and is reused (no LLM).
    // When unsure, do NOT set it (reuse). See unified-planner-prompt section 7.2.
    refresh_world_bible: z.boolean().nullable(),
  })
  // FULL-scope normalization: when the planner LLM picks scope=FULL, the
  // selector field IS the authoritative intent ("operate on all shots /
  // anchors"). The contradicting range/list fields the LLM sometimes also
  // populates (e.g. emitting both `scope: "FULL"` and `from_shot_id: "shot_2"`)
  // are noise -- the response-format schema requires every field to be
  // present (since they are `nullable()` not `nullable().optional()`), so
  // gpt-5.4 / gemini-3.1-pro-preview occasionally fill them with stale or
  // hallucinated values.
  //
  // We previously REJECTED these via superRefine, which forced the completion
  // to retry the same call up to 3 times (each retry costs 5-30s). The
  // retries usually still fail
  // because the LLM cannot recover from this prompt-shape mistake within
  // the same context window.
  //
  // New policy: for scope=FULL we silently null out range/list fields and
  // accept the call. The downstream tools already operate on "all" when
  // these fields are null, so trusting `scope` and dropping the noise
  // produces the same behaviour the LLM intended without the retry tax.
  // For non-FULL scopes the validations remain hard (selector lists must
  // be non-empty for SHOT_IDS / ANCHOR_IDS / SHOT_RANGE).
  .transform((params) => {
    if (params.scope === 'FULL') {
      return {
        ...params,
        anchor_ids: null,
        shot_ids: null,
        from_shot_id: null,
        to_shot_id: null,
      }
    }
    return params
  })
  .superRefine((params, ctx) => {
    if (params.scope === 'FULL') {
      // FULL scope is now coerced by the transform above; nothing to validate.
      return
    }

    if (params.scope === 'ANCHOR_IDS' && (!params.anchor_ids || params.anchor_ids.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'ANCHOR_IDS scope requires non-empty anchor_ids',
      })
    }

    if (params.scope !== 'ANCHOR_IDS' && (params.anchor_requests?.length ?? 0) > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'anchor_requests are only allowed for ANCHOR_IDS scope',
      })
    }

    if (params.scope === 'SHOT_IDS' && (!params.shot_ids || params.shot_ids.length === 0)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'SHOT_IDS scope requires non-empty shot_ids',
      })
    }

    if (
      params.scope === 'SHOT_RANGE' &&
      (!params.from_shot_id?.trim() || !params.to_shot_id?.trim())
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'SHOT_RANGE scope requires from_shot_id and to_shot_id',
      })
    }
  })

const ToolCallSchema = z.object({
  // NB: select_auto_style is deliberately NOT here. It is a RUNTIME-dispatched
  // tool (start-auto-style-child.ts), never planner-emitted -- keeping it out of
  // this enum stops the planner from validating/emitting a tool it must not call.
  // The runtime dispatch path still carries it via PlannerToolCall['tool'] + the
  // tool-runner switch + activity proxy.
  tool: z.enum([
    'describe_uploaded_images',
    'generate_anchor_assets',
    'generate_intent_context',
    'plan_asset_assignment',
    'generate_explainer_script',
    'generate_explainer_visual_script',
  ]),
  params: PlannerToolParamsSchema,
  reason: z.string().nullable(),
})

const JsonScalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])
// z.record() is intentionally avoided here -- OpenAI structured output rejects
// object schemas that lack an explicit 'properties' field. The only non-scalar
// object value sent via update_global_field is 'style', which has a known shape.
const StyleValueSchema = z.object({
  style_name: z.string(),
  style_text: z.string(),
  style_thumbnail_url: z.string(),
})
const JsonValueSchema = z.union([JsonScalarSchema, z.array(JsonScalarSchema), StyleValueSchema])

// `update_brand_bank_field` accepts one of three shapes depending on `path`:
//   basic_info.business_name -> non-empty string
//   basic_info.about_us_summary -> string | null
//   ctas -> Array<{ label, href }> (replace-whole-array)
// Patch-apply validates per-path; this schema just constrains what the LLM
// can emit. Shapes have explicit properties so OpenAI structured output
// accepts the union.
const BrandBankCtaArrayValueSchema = z.array(z.object({ label: z.string(), href: z.string() }))
const BrandBankFieldValueSchema = z.union([z.string(), z.null(), BrandBankCtaArrayValueSchema])

const PlannerShotSchema = z.object({
  shot_id: z.string(),
  order: z.number().int().positive(),
  time: z.object({
    start_s: z.number(),
    end_s: z.number(),
  }),
  audio_vo: z.string(),
  visual_primary: z.object({
    expression_type: z.enum(['Literal', 'Cultural Context', 'Symbolic']),
    aesthetic_mode: z.enum(['Live Action', 'Composited Graphic', 'UI-Infographic']),
    core_description: z.string(),
    entry_action: z.string().nullable(),
    exit_action: z.string().nullable(),
    // Deliberately does NOT emit `availability`, unlike the
    // canonical VisualPrimarySchema (types.ts). That schema's own comment
    // explains the asymmetry: the canonical default exists BECAUSE the
    // planner-side schema never carries this field -- adding it here would
    // change what the LLM is asked to emit for a field no prompt mentions.
    // renderer.ts and story-mode-handoff/index.ts DO read the canonical
    // field, just never on a value that differs from the default, since
    // every canonical shot gets the same 'MED' fallback. The mirror-check gap
    // this leaves is closed on the hand-written side instead: see
    // PlannerEmittedShot in types.ts and its use in runtime.types.ts's
    // PlannerOutputLike.
    notes: z.array(z.string()),
  }),
  pre_selected_assets: z.array(
    z.object({
      asset_id: z.string(),
      source: z.enum(['anchor_asset', 'user_upload']),
      usage: z.string(),
    }),
  ),
})

const PlannerPatchOpSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('update_global_field'),
    path: z.string(),
    value: JsonValueSchema,
  }),
  z.object({
    op: z.literal('update_shot_field'),
    shot_id: z.string(),
    field: z.string(),
    value: JsonValueSchema,
  }),
  z.object({
    op: z.literal('add_preselected_asset'),
    shot_id: z.string(),
    // source was z.string() until the PlannerOutputLike mirror check was
    // restored and caught the drift: PreSelectedAsset.source
    // (types.ts) is already this enum, so a bare string here silently
    // accepted values patch-apply.ts's hand-written type never allowed.
    asset: z.object({
      asset_id: z.string(),
      source: z.enum(['anchor_asset', 'user_upload']),
      usage: z.string(),
    }),
  }),
  z.object({
    op: z.literal('remove_preselected_asset'),
    shot_id: z.string(),
    asset_id: z.string(),
    asset_source: z.enum(['anchor_asset', 'user_upload']),
  }),
  z.object({
    op: z.literal('delete_shots'),
    shot_ids: z.array(z.string()).min(1),
  }),
  z.object({
    op: z.literal('reorder_shots'),
    order: z.array(z.string()),
  }),
  z.object({
    op: z.literal('replace_shots_range'),
    from_shot_id: z.string(),
    to_shot_id: z.string(),
    shots: z.array(PlannerShotSchema),
  }),
  z.object({
    op: z.literal('replace_all_shots'),
    shots: z.array(PlannerShotSchema),
  }),
  // Tier 1 brand-bank edits during the brand_review window.
  // `path` is an enum so the LLM cannot try to write a locked field;
  // patch-apply re-validates the allowlist + the phase/status window.
  z.object({
    op: z.literal('update_brand_bank_field'),
    path: z.enum(['basic_info.business_name', 'basic_info.about_us_summary', 'ctas']),
    value: BrandBankFieldValueSchema,
  }),
  // Brand-intent auto-start (mode_confirmation). Sets brand_extraction_input so
  // extraction starts directly instead of routing through the Stage 1 modal.
  // Primarily applied by the runtime's deterministic brand-URL trigger; the
  // planner may also emit it. `url` is a plain string here (bare domains
  // allowed); patch-apply normalizes + validates and enforces BRAND_INPUT_FROZEN.
  z.object({
    op: z.literal('set_brand_extraction_input'),
    input: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('url'), url: z.string() }),
      z.object({ kind: z.literal('freeform'), text: z.string() }),
    ]),
  }),
  // Re-extract from a different URL. Emitted in brand_review when the
  // user says the original site was wrong; patch-apply enforces the once-only
  // cap, the status window, and URL validity (bare domains allowed).
  z.object({
    op: z.literal('change_brand_extraction_source'),
    url: z.string(),
  }),
  // Apply the staged brand carry directly (mode_confirmation only).
  z.object({ op: z.literal('apply_brand_carry') }),
  // Saved-brief chat ops. Detach ("remove the brand brief") or
  // re-extract ("refresh brand info") an auto-injected brand-library brief.
  // No params -- the target is the session's injected brief. Only valid while a
  // brief is attached (the mode_confirmation prompt opens the PATCH_SPEC door
  // for them); patch-apply rejects them when the bank is not a brand_library
  // injection.
  z.object({ op: z.literal('remove_saved_brand_brief') }),
  z.object({ op: z.literal('reextract_saved_brand_brief') }),
  // Brand-review whole-brand removal. "remove the brand brief" while
  // reviewing a brand (fresh extraction, manual entry, or a saved-library brief
  // in editable review): discard it and continue brand-less. No params -- the
  // target is the session's brand bank. Source-agnostic but only valid in
  // brand_review with status 'completed'; patch-apply rejects it elsewhere.
  z.object({ op: z.literal('discard_brand_in_review') }),
])

const PlannerModeUpdateSchema = z.object({
  mode: z.enum(['explainer', 'narrative_story', 'ads']).nullable(),
  confirmed: z.boolean(),
  duration_seconds: z.number().int().nullable(),
  // Semantic classification from the planner. The runtime uses it to decide
  // whether a pasted script's computed duration can be overridden by a user
  // request; absent values keep historical planner responses compatible.
  duration_source: z.enum(['user_explicit', 'script_estimate', 'other']).nullable().optional(),
  // User's explicit response when a shorter requested duration conflicts with
  // a pasted script. The runtime, not the planner, calculates the conflict.
  pasted_script_fit: z.enum(['preserve', 'rewrite_to_duration']).nullable().optional(),
  // Classification of the user's initial brief shape. Set when the planner
  // first commits MODE_CONFIRMED (mode_confirmation phase, S detection per
  // section 2.3.3 of mode-confirmation-prompt.ts). Null on subsequent
  // turns and for sessions that started before this field was added.
  input_type: z
    .enum(['prompt_only', 'script_only', 'prompt_and_script', 'audio_music', 'audio_script'])
    .nullish(),
  reason: z.string(),
  // Brand-intent classification (UIP Brand Extraction). Flipped
  // true by the mode_confirmation prompt's brand-intent classifier when
  // the user signals interest in branded content; cleared on the next
  // turn after the user replies with refusal free-text or after the Stage 2
  // modal submit patches `brand_extraction_input`. Optional / nullable so
  // the mode_confirmation prompt is the only required write site; other
  // phases leave it undefined and applyAgentMemory preserves the prior
  // value via spread.
  brand_intent_pending: z.boolean().nullable().optional(),
  // Narrative-arc enum for a branded video (UIP Brand Extraction).
  // Set by the mode_confirmation prompt from the user's pick in the single
  // brand-direction question (section 2.6.5) -- a mode_update field, NOT a
  // patch op, so it never collides with the no-ops contract for
  // ASK_CLARIFY / MODE_CONFIRMED. applyAgentMemory writes it through to
  // `global_constraints.brand_video_type`. Optional / nullable: only the
  // brand path writes it; omit (undefined) to preserve the prior value.
  brand_video_type: z
    .enum(['friction_to_flow', 'product_showcase', 'industry_explainer'])
    .nullable()
    .optional(),
  // The detected script / voice-over language as a short BCP-47 tag (e.g. `zh`,
  // `ja`, `en`). Set by the mode_confirmation planner together with (or before) it
  // commits a duration, before generate_intent_context runs in bootstrap_script and
  // writes the authoritative value. Optional / nullable: only mode_confirmation sets
  // it; downstream phases leave it undefined.
  script_language: z.string().nullable().optional(),
})

const PlannerTodoSetStatusSchema = z.object({
  id: z.string(),
  status: z.enum(['pending', 'done']),
})

const PlannerTodoUpdateSchema = z.object({
  phase: z.enum([
    'mode_confirmation',
    'bootstrap_brand',
    'brand_review',
    'bootstrap_script',
    'script_review',
    'bootstrap_visual',
    'refinement',
  ]),
  set_item_status: z.array(PlannerTodoSetStatusSchema).nullable(),
  clear: z.boolean().nullable(),
})

const PlannerTodoSnapshotSchema = z.object({
  phase: z.enum([
    'mode_confirmation',
    'bootstrap_brand',
    'brand_review',
    'bootstrap_script',
    'script_review',
    'bootstrap_visual',
    'refinement',
  ]),
  items: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      status: z.enum(['pending', 'done']),
      executor_hint: z
        .object({
          executor_type: z.enum(['TOOL_CALLS', 'PATCH_SPEC', 'SESSION_CONTROL']),
          // select_auto_style omitted: runtime-dispatched only, never a planner
          // executor hint (see ToolCallSchema above).
          executor_tool: z
            .enum([
              'describe_uploaded_images',
              'generate_anchor_assets',
              'generate_intent_context',
              'plan_asset_assignment',
              'generate_explainer_script',
              'generate_explainer_visual_script',
            ])
            .nullable()
            .optional(),
          executor_patch_ops: z.array(z.string()).nullable().optional(),
          scope_hint: z.string().nullable().optional(),
          shared_batch_key: z.string().nullable().optional(),
        })
        .nullable()
        .optional(),
    }),
  ),
})

const PlannerStructureEditSchema = z
  .object({
    op: z.enum(['INSERT', 'DELETE', 'SPLIT', 'MERGE']),
    shot_ids: z.array(z.string()).nullable(),
    anchor_shot_id: z.string().nullable(),
    position: z.enum(['BEFORE', 'AFTER']).nullable(),
    insert_audio_vo: z.string().nullable().optional(),
    split_audio_segments: z.array(z.string()).nullable(),
  })
  .superRefine((value, ctx) => {
    if (value.op === 'DELETE') {
      if (!value.shot_ids || value.shot_ids.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'DELETE structure_edit requires non-empty shot_ids',
        })
      }
      if (
        value.anchor_shot_id ||
        value.position ||
        value.insert_audio_vo ||
        value.split_audio_segments
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'DELETE structure_edit must not include anchor/position/audio/split fields',
        })
      }
      return
    }

    if (value.op === 'INSERT') {
      if (!value.anchor_shot_id?.trim() || !value.position) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'INSERT structure_edit requires anchor_shot_id and position',
        })
      }
      return
    }

    if (value.op === 'SPLIT') {
      if (!value.shot_ids || value.shot_ids.length !== 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'SPLIT structure_edit requires exactly one shot_id',
        })
      }
      if (!value.split_audio_segments || value.split_audio_segments.length < 2) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'SPLIT structure_edit requires split_audio_segments with length >= 2',
        })
      }
      return
    }

    if (!value.shot_ids || value.shot_ids.length < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'MERGE structure_edit requires shot_ids with length >= 2',
      })
    }
    if (value.insert_audio_vo || value.split_audio_segments) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'MERGE structure_edit must not include insert_audio_vo or split_audio_segments',
      })
    }
  })

const UndoScopeSchema = z.enum(['LAST_CHANGE', 'LAST_USER_TURN', 'COUNT'])

const PlannerSessionControlSchema = z.object({
  command: z.enum(['UNDO_LAST']),
  undo_scope: UndoScopeSchema.nullable(),
  count: z.number().int().positive().nullable(),
})

const ClarifyOptionSchema = z.object({
  expect_assets: z.boolean().nullable().optional(),
  id: z.string(),
  label: z.string(),
})

// Kept in sync with ArtifactId (consistency/ledger-types.ts) in
// BOTH directions. `satisfies` alone only catches a member here that
// ArtifactId no longer allows (rename/removal) -- it does NOT catch
// ArtifactId growing a 5th member this array forgets, which is the failure
// this constant's disposition schema actually cares about: the ledger would
// project the new artifact, z.enum would reject it, and Zod fails the ENTIRE
// PlannerOutputSchema.parse rather than just that one disposition entry. The
// _AllArtifactIdsCovered check below closes that other direction.
const STALE_DISPOSITION_ARTIFACT_IDS = [
  'anchor_bindings',
  'global_constraints',
  'script',
  'visual_script',
] as const satisfies readonly ArtifactId[]

// Closes the direction `satisfies` cannot: every ArtifactId must appear in
// STALE_DISPOSITION_ARTIFACT_IDS, not just the reverse. If a 5th ArtifactId
// is added without updating the array above, this becomes `false` and the
// `true` assignment below fails to compile.
type _AllArtifactIdsCovered = ArtifactId extends (typeof STALE_DISPOSITION_ARTIFACT_IDS)[number]
  ? true
  : false
const _allArtifactIdsCovered: _AllArtifactIdsCovered = true

// How the planner disposed of each enforceable staleness ledger entry
// this turn. Keyed by (artifact, source_path), matching the ledger's dismissal
// key so a same-turn refresh writing new paths cannot revive an earlier
// dismissal. `reason` is required in spirit for `dismiss` (it is the whole
// point of a dismissal being logged), and duplicate (artifact, source_path)
// pairs are rejected too (a {tool} + {dismiss} pair on the same key would let
// the dismiss silently win in applyStaleDispositions while the contract guard
// counted it addressed by the tool). Neither is enforced at the schema layer:
// this schema is the model's `responseFormat`, and libs/llm parses the raw
// completion with it directly, so a `.superRefine()` failure here would cascade through
// the full chain-restart -> Gemini fallback rather than a normal guard
// rejection. checkStaleDispositionsShape in planner-contract-consistency.ts
// enforces both, with a re-promptable message.
const StaleDispositionSchema = z.object({
  artifact: z.enum(STALE_DISPOSITION_ARTIFACT_IDS),
  disposition: z.enum(['ask', 'dismiss', 'patch', 'tool']),
  reason: z.string().nullable().optional(),
  source_path: z.string(),
})

export const PlannerOutputSchema = z.object({
  mode_update: PlannerModeUpdateSchema,
  action: z.enum([
    'ASK_CLARIFY',
    'MODE_CONFIRMED',
    'PATCH_SPEC',
    'SESSION_CONTROL',
    'TODO_UPDATE_ONLY',
    'TOOL_CALLS',
  ]),
  expect_assets: z.boolean().nullable().optional(),
  options: z.array(ClarifyOptionSchema).nullable().optional(),
  reply_question: z.string().nullable().optional(),
  reply: z.string(),
  conversation_summary_update: z.string(),
  todo_update: PlannerTodoUpdateSchema,
  todo_snapshot: PlannerTodoSnapshotSchema.nullable(),
  session_control: PlannerSessionControlSchema.nullable(),
  structure_edit: PlannerStructureEditSchema.nullable().optional(),
  tool_calls: z.array(ToolCallSchema).nullable(),
  ops: z.array(PlannerPatchOpSchema).nullable(),
  stale_dispositions: z.array(StaleDispositionSchema).nullable().optional(),
})

export type PlannerOutput = z.infer<typeof PlannerOutputSchema>
