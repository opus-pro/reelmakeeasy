import { z } from 'zod'

// Zod Schema definitions for structured output
export const VisualOptionSchema = z.object({
  expression_type: z
    .enum(['Literal', 'Cultural Context', 'Symbolic'])
    .describe('The visual expression type for this shot'),
  aesthetic_mode: z
    .enum(['Live Action', 'Composited Graphic', 'UI-Infographic'])
    .describe('The aesthetic mode / visual presentation form'),
  description: z.string().describe('Freeform but concrete visual description'),
  availability: z
    .enum(['HIGH', 'MED', 'LOW'])
    .describe('RWA availability: HIGH=common, MED=niche, LOW=rare/GenAI-dependent'),
  notes: z
    .array(z.string())
    .optional()
    .describe('List of additional notes (continuity anchors, motion hints, etc.)'),
})

// Global constraints schema for visual planning
export const GlobalConstraintsSchema = z.object({
  video_type: z.string().describe('Type of video: news / promotional / educational, etc'),
  script_category: z.enum(['object_centric', 'concept_centric']).describe('Category of the script'),
  topic: z.string().describe('One sentence describing the subject and theme'),
  key_entities: z
    .array(z.string())
    .describe('Companies, people, institutions, industries mentioned'),
  geo_scope: z.string().describe('Countries/cities relevant to the topic'),
  time_scope: z.string().describe('Past event / current news / future projection'),
  brand_scope: z.string().describe('Service/product brand'),
  target_audience: z.string().describe('General public / professionals / customers'),
  tone: z.string().describe('Serious / neutral / inspiring / urgent / friendly'),
  directives: z
    .array(z.string())
    .optional()
    .describe('Positive requirements the video must include (forwarded from UIP)'),
  must_not_violate: z.array(z.string()).describe('3-6 constraints that must not be violated'),
  script_language: z
    .string()
    .optional()
    .describe(
      'BCP-47 tag of the source script (voice-over) language. Always "en" for now: ReelMakeEasy is English-only until the caption render fonts cover other scripts (the planner runtime pins any other value to "en"). Used downstream to keep on-screen typography in the script language.',
    ),
})

// Visual dashboard schema - array of visual plans for each shot
export const VisualDashboardSchema = z.array(
  z.object({
    shot_id: z.string().describe('The shot ID from split_shots.json'),
    audio_vo: z.string().describe('The voice-over text for this shot'),
    visual_primary: VisualOptionSchema.describe('The primary visual plan for this shot'),
  }),
)

// TypeScript types inferred from Zod schemas
export type GlobalConstraints = z.infer<typeof GlobalConstraintsSchema>
export type VisualDashboard = z.infer<typeof VisualDashboardSchema>
export type VisualOption = z.infer<typeof VisualOptionSchema>

// Ranked asset type for visual script keyframe generation
export type RankedAsset = {
  assetId: string
  ranking: number
  reasoning?: string
}
