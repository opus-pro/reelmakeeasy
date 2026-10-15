import { JobContext } from '@reelmakeeasy/common/job-context'
import { z } from 'zod'

import type {
  GenerateLongTakeMotionPromptsActivityParams,
  GenerateLongTakeMotionPromptsActivityResult,
} from '../../workflows/long-take/types'
import { runLongTakeCompletionWithRecord } from '../long-take-generation-record'
import {
  buildLongTakeMotionPromptsSystemPrompt,
  buildLongTakeMotionPromptsUserPrompt,
} from '../prompts/long-take-motion-prompts-prompt'

import {
  formatError,
  formatLogFields,
  logger,
  withActivityHeartbeat,
  withLongTakeContext,
} from './common'
import { createLongTakeStorage, LONG_TAKE_MOTION_PROMPTS_PATH } from './storage'

const MotionPromptsSchema = z.object({
  motion_prompts: z.array(z.string()),
})

export async function generateLongTakeMotionPrompts(
  params: GenerateLongTakeMotionPromptsActivityParams,
): Promise<GenerateLongTakeMotionPromptsActivityResult | null> {
  const { panels, projectId, promptRoute, userId } = params

  if (panels.length < 2) {
    logger.warn(
      `[long-take] Motion prompts skipped — fewer than 2 panels ${formatLogFields({ projectId })}`,
    )
    return null
  }

  return withLongTakeContext({ projectId, userId }, () =>
    withActivityHeartbeat(async () => {
      const startedAt = Date.now()
      const storage = createLongTakeStorage(projectId)

      const userPrompt = buildLongTakeMotionPromptsUserPrompt({ panels })

      try {
        const result = await JobContext.run({ projectId, userId }, async () =>
          runLongTakeCompletionWithRecord({
            projectId,
            userId,
            options: {
              models: ['gemini-3.8-flash', 'gpt-5'],
              prompt: `${buildLongTakeMotionPromptsSystemPrompt({
                promptRoute,
              })}\n\n---\n\n${userPrompt}`,
              responseFormat: MotionPromptsSchema,
              task: 'long-take-motion-prompts',
              temperature: 0.3,
            },
          }),
        )

        const expectedCount = panels.length - 1
        const motionPrompts = result.motion_prompts.slice(0, expectedCount)

        await storage.ensureDir('long_take')
        await storage.writeJsonFile(LONG_TAKE_MOTION_PROMPTS_PATH, {
          motion_prompts: motionPrompts,
        })

        logger.info(
          `[long-take] Motion prompts generated ${formatLogFields({
            projectId,
            promptCount: motionPrompts.length,
            expectedCount,
            durationMs: Date.now() - startedAt,
          })}`,
        )

        return {
          motionPrompts,
          outputPath: LONG_TAKE_MOTION_PROMPTS_PATH,
        }
      } catch (error) {
        logger.warn(
          `[long-take] Motion prompts generation failed ${formatLogFields({
            projectId,
            err: formatError(error),
          })}`,
        )
        return null
      }
    }),
  )
}
