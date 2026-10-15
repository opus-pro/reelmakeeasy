import { z } from 'zod'

export type Asset = {
  assetId?: string
  data_path: string
  description: string
  evaluation?: Evaluation
  id: string
  metadata: {
    low_quality?: boolean
    matchedSentence?: string
    metadata?: Record<string, unknown>
    requiredByUser?: boolean
    source?: {
      link?: string // example: https://www.medium.com/p/1234567890
      logo?: string // example: 'https://www.medium.com/favicon.ico'
      name?: string // example: 'medium', 'quora', 'youtube'
      title?: string // example: 'How to become a millionaire'
    }
    source_query?: string
    sourceFilePath?: string
    sourceTag?: SourceTag
    text_heavy_infographic?: boolean
    watermark?: string
  }
  preview_path: string
  preview_url?: string // cdn url
  type: 'article_animation' | 'image' | 'tweet' | 'unknown' | 'video'
}
export type AssetGroup = {
  assets: Asset[]
  intent: string
  intentId: string
  intentRationale: string
  relatedSceneIds?: string[]
}

type Evaluation = {
  overall_score: string
  reasoning: string
  recommendation: string
  relevance_score: string
}

export const evalSchema = z.object({
  asset_evals: z.array(
    z.object({
      asset_id: z.string(),
      overall_score: z.number().describe('The overall score of the asset, 0-10'),
      relevance_score: z.number().describe('The relevance score of the asset, 0-10'),
      reasoning: z.string().describe('The reasoning for the score'),
      recommendation: z
        .enum(['use', 'reject', 'maybe', 'duplicate'])
        .describe('The recommendation for the asset'),
    }),
  ),
  intent_coverage: z.number().describe('The coverage of the intent, 0-10'),
  intent_coverage_rationale: z.string().describe('The rationale for the intent coverage'),
  // intent_relevance: z.number().describe('The relevance of the intent, 0-10'),
  // intent_relevance_rationale: z.string().describe('The rationale for the intent relevance'),
  next_step: z.enum(['continue', 'stop']).describe('The next step to be taken'),
  plan_suggestion: z
    .string()
    .describe(
      'The suggestion for the search plan, if the current plan is not good enough, what should be done to improve it',
    ),
})

export type EvalType = z.infer<typeof evalSchema>

export const SEARCH_TOOLS = [
  'image_search',
  'video_search',
  'news_search',
  'article_search',
  'stock_video_search',
] as const

export const searchPlanSchema = z.object({
  searchTools: z
    .array(
      z.object({
        name: z.enum(SEARCH_TOOLS),
        queries: z.array(z.string()).describe('The queries to be made'),
      }),
    )
    .describe('The function calls to be made, can be empty if the intent is fulfilled'),
  rationale: z
    .string()
    .describe(
      'The rationale for the search plan, why you made the search plan, why the plan is better than the previous plan if there is one',
    ),
})

export enum SourceTag {
  GROUNDING_URL = 'grounding_url',
  REQUIRED_BY_USER = 'required_by_user',
  USER_INPUT_URL = 'user_input_url',
  USER_UPLOADED = 'user_uploaded',
}

export type SearchPlan = z.infer<typeof searchPlanSchema>
