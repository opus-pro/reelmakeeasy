import type { PipelineContextEntry } from '@reelmakeeasy/common/job-context'
import { JobContext } from '@reelmakeeasy/common/job-context'
import { z } from 'zod'

import type {
  IdeateVisualTreatmentActivityParams,
  IdeateVisualTreatmentActivityResult,
} from '../../workflows/long-take/types'
import { runLongTakeCompletionWithRecord } from '../long-take-generation-record'
import { buildLongTakeVisualTreatmentPrompt } from '../prompts/long-take-visual-treatment-prompt'

import {
  formatError,
  formatLogFields,
  logger,
  withActivityHeartbeat,
  withLongTakeContext,
} from './common'
import { createLongTakeStorage, LONG_TAKE_VISUAL_TREATMENT_PATH } from './storage'

const VisualTreatmentSchema = z.object({
  expert_recommendations: z.string(),
})

export async function ideateVisualTreatment(
  params: IdeateVisualTreatmentActivityParams,
): Promise<IdeateVisualTreatmentActivityResult | null> {
  const { projectId, userId, pipelineContext } = params

  return withLongTakeContext({ projectId, userId }, () =>
    withActivityHeartbeat(async () => {
      const startedAt = Date.now()
      const storage = createLongTakeStorage(projectId)

      let visualScript: unknown[] = []
      try {
        visualScript = await storage.readJsonFile<unknown[]>('long_take/visual_script.json')
      } catch {
        logger.error(
          `[long-take] Visual script not available, visual treatment will fail ${formatLogFields({
            projectId,
          })}`,
        )
        throw new Error('Visual script not available')
      }

      const userPromptParts = buildUserPromptFromContext(pipelineContext ?? [], visualScript)

      try {
        const result = await JobContext.run({ projectId, userId }, async () =>
          runLongTakeCompletionWithRecord({
            projectId,
            userId,
            options: {
              models: ['gemini-3.8-flash', 'gpt-5'],
              prompt: `${buildLongTakeVisualTreatmentPrompt()}\n\n---\n\n${userPromptParts}`,
              responseFormat: VisualTreatmentSchema,
              task: 'long-take-visual-treatment',
              temperature: 0.4,
            },
          }),
        )

        await storage.ensureDir('long_take')
        await storage.writeJsonFile(LONG_TAKE_VISUAL_TREATMENT_PATH, result)

        logger.info(
          `[long-take] Visual treatment ideation completed ${formatLogFields({
            projectId,
            durationMs: Date.now() - startedAt,
          })}`,
        )

        return {
          expertRecommendations: result.expert_recommendations,
          outputPath: LONG_TAKE_VISUAL_TREATMENT_PATH,
        }
      } catch (error) {
        logger.warn(
          `[long-take] Visual treatment ideation failed ${formatLogFields({
            projectId,
            err: formatError(error),
          })}`,
        )
        return null
      }
    }),
  )
}

function buildUserPromptFromContext(
  _pipelineContext: PipelineContextEntry[],
  visualScript: unknown[],
): string {
  if (visualScript.length === 0) {
    return ''
  }
  return `Visual Script:\n${JSON.stringify(visualScript, null, 2)}`
}
