import { JobContext } from '@reelmakeeasy/common/job-context'
import { z } from 'zod'

import type {
  IdentifyLongTakeStyleActivityParams,
  IdentifyLongTakeStyleActivityResult,
} from '../../workflows/long-take/types'
import { runLongTakeCompletionWithRecord } from '../long-take-generation-record'
import { buildLongTakeStyleAnalysisPrompt } from '../prompts/long-take-style-analysis-prompt'

import {
  formatError,
  formatLogFields,
  logger,
  withActivityHeartbeat,
  withLongTakeContext,
} from './common'
import { createLongTakeStorage, LONG_TAKE_STYLE_ANALYSIS_PATH } from './storage'

const StyleAnalysisSchema = z.object({
  style_description: z.string(),
  key_style_tags: z.array(z.string()),
  color_palette: z.record(z.object({ hex: z.string(), percentage: z.string() })),
  reusable_style_prompt: z.string(),
  reproduction_guidance: z.string().nullable().optional(),
})

export async function identifyLongTakeStyle(
  params: IdentifyLongTakeStyleActivityParams,
): Promise<IdentifyLongTakeStyleActivityResult | null> {
  const { projectId, userId, styleReferenceImageUrls, userPrompt, intentAnalysis, styleText } =
    params

  if (!styleReferenceImageUrls || styleReferenceImageUrls.length === 0) {
    return null
  }

  return withLongTakeContext({ projectId, userId }, () =>
    withActivityHeartbeat(async () => {
      const startedAt = Date.now()
      const storage = createLongTakeStorage(projectId)

      try {
        const result = await JobContext.run({ projectId, userId }, async () =>
          runLongTakeCompletionWithRecord({
            projectId,
            userId,
            options: {
              models: ['gemini-3.8-flash', 'gpt-5'],
              prompt: buildLongTakeStyleAnalysisPrompt(
                userPrompt,
                intentAnalysis,
                styleText ?? null,
              ),
              contents: styleReferenceImageUrls.map((url) => ({
                type: 'image_url' as const,
                imageUrl: url,
              })),
              responseFormat: StyleAnalysisSchema,
              task: 'long-take-style-analysis',
              temperature: 0,
            },
          }),
        )

        await storage.ensureDir('long_take')
        await storage.writeJsonFile(LONG_TAKE_STYLE_ANALYSIS_PATH, result)

        logger.info(
          `[long-take] Style analysis completed ${formatLogFields({
            projectId,
            tagCount: result.key_style_tags.length,
            durationMs: Date.now() - startedAt,
          })}`,
        )

        return {
          colorPalette: result.color_palette,
          keyStyleTags: result.key_style_tags,
          outputPath: LONG_TAKE_STYLE_ANALYSIS_PATH,
          reproductionGuidance: result.reproduction_guidance ?? null,
          reusableStylePrompt: result.reusable_style_prompt,
          styleDescription: result.style_description,
        }
      } catch (error) {
        logger.warn(
          `[long-take] Style analysis failed ${formatLogFields({
            projectId,
            err: formatError(error),
          })}`,
        )
        return null
      }
    }),
  )
}
