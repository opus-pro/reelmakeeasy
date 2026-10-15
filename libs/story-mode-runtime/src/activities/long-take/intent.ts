import { JobContext } from '@reelmakeeasy/common/job-context'
import { z } from 'zod'

import type {
  IdentifyLongTakeIntentActivityParams,
  IdentifyLongTakeIntentActivityResult,
} from '../../workflows/long-take/types'
import { runLongTakeCompletionWithRecord } from '../long-take-generation-record'
import { buildLongTakeIntentPrompt } from '../prompts/long-take-intent-prompt'

import {
  formatError,
  formatLogFields,
  logger,
  withActivityHeartbeat,
  withLongTakeContext,
} from './common'
import { createLongTakeStorage, LONG_TAKE_INTENT_ANALYSIS_PATH } from './storage'

const IntentAnalysisSchema = z.object({
  intent_analysis: z
    .string()
    .describe(
      "A comprehensive analysis and interpretation of the user's intent, goals, and the fundamental nature of the video content they wish to create",
    ),
})

export async function identifyLongTakeIntent(
  params: IdentifyLongTakeIntentActivityParams,
): Promise<IdentifyLongTakeIntentActivityResult | null> {
  const { projectId, userId, userPrompt } = params
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
              prompt: buildLongTakeIntentPrompt(userPrompt),
              responseFormat: IntentAnalysisSchema,
              task: 'long-take-intent-analysis',
              temperature: 0,
            },
          }),
        )

        await storage.ensureDir('long_take')
        await storage.writeJsonFile(LONG_TAKE_INTENT_ANALYSIS_PATH, result)

        logger.info(
          `[long-take] Intent analysis completed ${formatLogFields({
            projectId,
            durationMs: Date.now() - startedAt,
          })}`,
        )

        return {
          intentAnalysis: result.intent_analysis,
          outputPath: LONG_TAKE_INTENT_ANALYSIS_PATH,
        }
      } catch (error) {
        logger.warn(
          `[long-take] Intent analysis failed ${formatLogFields({
            projectId,
            err: formatError(error),
          })}`,
        )
        return null
      }
    }),
  )
}
