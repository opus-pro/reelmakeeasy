import { JobContext } from '@reelmakeeasy/common/job-context'
import { z } from 'zod'

import type {
  ClassifyLongTakeGenreActivityParams,
  ClassifyLongTakeGenreActivityResult,
} from '../../workflows/long-take/types'
import { runLongTakeCompletionWithRecord } from '../long-take-generation-record'
import { buildLongTakeGenrePrompt } from '../prompts/long-take-genre-prompt'

import {
  formatError,
  formatLogFields,
  logger,
  withActivityHeartbeat,
  withLongTakeContext,
} from './common'
import { createLongTakeStorage, LONG_TAKE_GENRE_CLASSIFICATION_PATH } from './storage'

const GenreClassificationSchema = z.object({
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

export async function classifyLongTakeGenre(
  params: ClassifyLongTakeGenreActivityParams,
): Promise<ClassifyLongTakeGenreActivityResult | null> {
  const { projectId, userId } = params

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
              prompt: buildLongTakeGenrePrompt(),
              responseFormat: GenreClassificationSchema,
              task: 'long-take-genre-classification',
              temperature: 0,
            },
          }),
        )

        await storage.ensureDir('long_take')
        await storage.writeJsonFile(LONG_TAKE_GENRE_CLASSIFICATION_PATH, result)

        logger.info(
          `[long-take] Genre classification completed ${formatLogFields({
            projectId,
            primaryGenre: result.primary_genre,
            durationMs: Date.now() - startedAt,
          })}`,
        )

        return {
          outputPath: LONG_TAKE_GENRE_CLASSIFICATION_PATH,
          primaryGenre: result.primary_genre,
          scriptwriterGuidance: JSON.stringify(result.scriptwriter_guidance),
          secondaryGenre: result.secondary_genre,
          styleApplication: JSON.stringify(result.style_application),
        }
      } catch (error) {
        logger.warn(
          `[long-take] Genre classification failed ${formatLogFields({
            projectId,
            err: formatError(error),
          })}`,
        )
        return null
      }
    }),
  )
}
