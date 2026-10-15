import { z } from 'zod'

export type LongTakeAdmissionTier = 'free' | 'paid'

export const LongTakeAnchorIndexSchema = z.object({
  assets: z
    .array(
      z.object({
        anchor_uri: z.string().nullable().optional(),
        asset_id: z.string(),
        effective_anchor_uri: z.string().nullable().optional(),
        prompt_text: z.string().nullable().optional(),
        raw_anchor_uri: z.string().nullable().optional(),
        source_file_ids: z.array(z.string()).default([]),
        source_image_uris: z.array(z.string()).default([]),
        // Must stay in the schema: zod strips unknown keys, so omitting it made
        // every read-modify-write of the index (e.g. the UIP fast-path upload
        // merge) silently drop the passthrough marker written by the anchor
        // generators, which disables verbatim logo compositing downstream.
        source_passthrough: z.boolean().optional(),
        status: z.string().nullable().optional(),
        styled_anchor_uri: z.string().nullable().optional(),
      }),
    )
    .default([]),
})

export type LongTakeAnchorIndex = z.infer<typeof LongTakeAnchorIndexSchema>

export const LongTakeHumanPresenceSchema = z
  .enum([
    'none',
    'anonymous_crowd',
    'background_people',
    'specific_character',
    'singer_performance',
    'unknown',
  ])
  .catch('unknown')

export type LongTakeHumanPresence = z.infer<typeof LongTakeHumanPresenceSchema>

export const LongTakeVisualScriptSchema = z.array(
  z.object({
    audio: z.string(),
    human_presence: LongTakeHumanPresenceSchema.optional(),
    shot_id: z.string(),
    /**
     * The planner's own shot timing, carried through the handoff.
     * In audio mode it is already ASR-aligned; in text mode it is a 150-wpm
     * estimate made before any audio existed. Story Mode 3.0 uses it only as
     * the fallback for shots its transcript alignment cannot place -- the
     * measured boundaries always win. Absent on older artifacts.
     */
    time: z.object({ end_s: z.number(), start_s: z.number() }).nullable().optional(),
    used_asset_id: z.array(z.string()).default([]),
    visual: z.object({
      aesthetic_mode: z.string().nullable().default(null),
      availability: z.string().nullable().default(null),
      core_description: z.string().nullable().default(null),
      /**
       * Legacy alias of `core_description`, kept READ-ONLY. The UIP handoff
       * converter stopped writing it: the value was identical, and
       * this artifact is serialized verbatim into the keyframe-prompt LLM call,
       * so the duplicate put every shot's description in that payload twice.
       * Still parsed so older artifacts in storage keep resolving through the
       * `core_description || description` fallbacks.
       *
       * `.nullable().default(null).transform(...)` rather than a bare
       * `.optional()`: this schema is reused inside a `responseFormat`, where a
       * bare optional throws in `zodResponseFormat` on the OpenAI fallback.
       * The transform keeps the inferred type
       * `string | undefined` so the converter can omit the key.
       */
      description: z
        .string()
        .nullable()
        .default(null)
        .transform((value) => value ?? undefined),
      entry_action: z.string().nullable().default(null),
      exit_action: z.string().nullable().default(null),
      expression_type: z.string().nullable().default(null),
      notes: z.array(z.string()).nullable().default(null),
      /**
       * Story Mode 3.0 hand-off to the next shot. Absent on every V2
       * shot -- V2 has no hand-off concept -- and null on the last V3 shot.
       */
      transition_to_next: z.enum(['cut', 'continuous']).nullable().optional(),
    }),
  }),
)

export type LongTakeVisualScriptItem = z.infer<typeof LongTakeVisualScriptSchema>[number]
