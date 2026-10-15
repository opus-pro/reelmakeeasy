import { z } from 'zod'

/**
 * Video content classification taxonomy (topic / use case / music genre): Story Mode's long-take
 * workflow classifies its script/transcript. The values are stored property values -- never
 * rename one without a migration plan for the classifications already stored.
 * The prompt that instructs the model to pick from these lists is
 * `buildContentClassificationPrompt` in `./content-classification-prompt` -- keep the two in sync.
 */
export const CONTENT_TOPIC_CATEGORIES = [
  'Anime_Fandom_PopCulture',
  'Automotive_Vehicles',
  'Business_Entrepreneurship',
  'Career_Professional_Development',
  'Comedy_Humor_Memes',
  'Consumer_Electronics_Gadgets',
  'Creative_Performance_Drama',
  'DIY_Home_Crafts',
  'Education_Learning',
  'Family_Parenting_Relationships',
  'Fashion_Beauty_Lifestyle',
  'Finance_Investing_Crypto',
  'Food_Drink_Culinary',
  'Gaming_Esports',
  'Health_Fitness_Wellness',
  'History_Geopolitics',
  'Mental_Health_Psychology',
  'Movies_TV_Entertainment',
  'News_Current_Events',
  'Pets_Animals_Wildlife',
  'Politics_Society_Culture',
  'Religion_Spirituality',
  'Science_Space_Nature',
  'Sports_Athletics_Outdoors',
  'Tech_AI_Software',
  'Travel_Culture_Local',
  'True_Crime_Mystery',
] as const

export const CONTENT_USE_CASE_CATEGORIES = [
  'Educational_Explainer',
  'HowTo_Tutorial_Guide',
  'Documentary_DeepDive',
  'Storytime_Personal_Narrative',
  'Drama_Script_Monologue',
  'Product_Showcase_Ad',
  'UGC_Style_Ad',
  'Testimonial_Case_Study',
  'Teaser_Trailer_Promo',
  'Brand_Corporate_Announcement',
  'Hot_Take_Opinion_Piece',
  'Reaction_Commentary_Opinion',
  'News_Recap_Update',
  'Sketch_Comedy_Skit',
  'Meme_Edit_Shitpost',
  'Viral_Trend_Challenge',
  'Motivation_Inspiration_Speech',
  'Aesthetic_Cinematic_Loop',
  'Live_Event_Highlight',
  'Behind_The_Scenes_BTS',
  'Listicle_Ranking_Countdown',
  'AI_Avatar_Generated',
  // Music use-cases (additive) - the PURPOSE of a music/song upload. Songs are
  // routed here (or to a commercial/educational use-case) instead of being
  // dumped into Drama_Script_Monologue. The musical style is the separate
  // `music_genre` field, NOT a use-case. Plain human-readable labels on purpose.
  'Music Video',
  'Worship & Faith',
  'Kids & Nursery',
  'Tribute & Celebration',
  'Motivational Anthem',
] as const

/**
 * The primary/fallback completion pair and decoding temperature every content classification
 * uses. Shared for the same reason as the taxonomy above: classifications are only comparable
 * when the same models produced them, so a model bump here moves every consumer at once instead
 * of silently leaving one behind.
 */
export const CONTENT_CLASSIFICATION_MODELS = ['gemini-3.8-flash', 'gpt-5'] as const
export const CONTENT_CLASSIFICATION_TEMPERATURE = 0

export const ContentClassificationSchema = z.object({
  topic: z.enum(CONTENT_TOPIC_CATEGORIES),
  topic_confidence: z.coerce.number().min(0).max(1),
  use_case: z.enum(CONTENT_USE_CASE_CATEGORIES),
  use_case_confidence: z.coerce.number().min(0).max(1),
  // Music classification (additive). `.nullable().optional()` so classification
  // JSON written before music support still parses (field absent) AND strict
  // structured-output providers accept the schema: OpenAI (the gpt-5 fallback)
  // rejects an `.optional()` field that is not also `.nullable()`, which broke
  // the fallback whenever the primary model was degraded. The trailing
  // `.transform()` normalises the provider's explicit `null` back to `undefined`
  // so the inferred type stays `T | undefined` and downstream consumers are
  // unchanged. `is_music` flags song lyrics; `music_genre` is the musical style
  // ('Not_Music' for spoken content); `music_genre_confidence` is only
  // meaningful when is_music is true (0 otherwise).
  // Use z.boolean() (NOT z.coerce.boolean()): the model emits a true/false JSON
  // literal, and coercion would read the string "false" as true. `music_genre`
  // is a free string (the prompt lists the values) so an off-list genre does
  // not fail the whole classification parse.
  is_music: z
    .boolean()
    .nullable()
    .optional()
    .transform((value) => value ?? undefined),
  music_genre: z
    .string()
    .nullable()
    .optional()
    .transform((value) => value ?? undefined),
  music_genre_confidence: z.coerce
    .number()
    .min(0)
    .max(1)
    .nullable()
    .optional()
    .transform((value) => value ?? undefined),
})

export type ContentClassification = z.infer<typeof ContentClassificationSchema>

/**
 * The canonical property names for a classification, as Story Mode's long-take completed
 * events established them (`promptTopic`, `promptUseCase`, ...). Kept next to the schema so every
 * caller stamps identical names -- a divergent copy silently splits reports into
 * disjoint property sets. Story Mode's workflows still write these names inline (predating this
 * helper); migrate them here when next touched. The optional music fields are omitted when absent
 * (classification JSON written before music support), never emitted as empty values.
 */
export function contentClassificationPromptProps(
  classification: ContentClassification,
): Record<string, boolean | number | string> {
  return {
    promptTopic: classification.topic,
    promptTopicConfidence: classification.topic_confidence,
    promptUseCase: classification.use_case,
    promptUseCaseConfidence: classification.use_case_confidence,
    ...(classification.is_music === undefined ? {} : { promptIsMusic: classification.is_music }),
    ...(classification.music_genre === undefined
      ? {}
      : { promptGenre: classification.music_genre }),
    ...(classification.music_genre_confidence === undefined
      ? {}
      : { promptGenreConfidence: classification.music_genre_confidence }),
  }
}
