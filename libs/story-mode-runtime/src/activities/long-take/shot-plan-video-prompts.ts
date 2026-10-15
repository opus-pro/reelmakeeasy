import { JobContext } from '@reelmakeeasy/common/job-context'
import type { Model } from '@reelmakeeasy/common/llm'

import { runLongTakeCompletionWithRecord } from '../long-take-generation-record'

import { formatError, formatLogFields, logger } from './common'
import { LongTakeVideoPromptSchema } from './storage'

const VIDEO_PROMPT_MODEL_ATTEMPTS: readonly Model[] = [
  'gemini-3.8-flash',
  'gemini-2.5-pro',
  'gpt-5',
]

export type LongTakeVideoPrompt = {
  prompt: string
  requires_lip_sync?: boolean
  shot_id: string
}

export async function runLongTakeVideoPromptCompletion(params: {
  projectId: string
  prompt: string
  userId: string
}): Promise<LongTakeVideoPrompt[]> {
  const { projectId, prompt, userId } = params
  let lastError: unknown
  let attempt = 1

  for (const model of VIDEO_PROMPT_MODEL_ATTEMPTS) {
    try {
      const response = await JobContext.run({ projectId, userId }, async () =>
        runLongTakeCompletionWithRecord({
          projectId,
          userId,
          options: {
            ignoreFallbackModel: true,
            models: [model],
            prompt,
            responseFormat: LongTakeVideoPromptSchema,
            task: 'long-take-video-prompts',
            temperature: 0,
          },
        }),
      )
      return response.shots
    } catch (error) {
      lastError = error
      logger.warn(
        `[long-take] Video prompt model attempt failed ${formatLogFields({
          attempt,
          model,
          projectId,
          err: formatError(error),
        })}`,
      )
    }
    attempt += 1
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`Video prompt model attempts failed: ${formatError(lastError)}`)
}
