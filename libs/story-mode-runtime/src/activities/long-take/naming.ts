import { JobContext } from '@reelmakeeasy/common/job-context'
import { renderPrompt } from '@reelmakeeasy/common/llm/prompt'
import { Logger } from '@reelmakeeasy/common/logger'
import { getProjectDataService } from '@shared/db-access-layer'
import { z } from 'zod'

import type { GenerateAndUpdateLongTakeProjectNameActivityParams } from '../../workflows/long-take/types'
import { runLongTakeCompletionWithRecord } from '../long-take-generation-record'

import {
  deriveProjectNameFromScript,
  formatError,
  formatLogFields,
  withActivityHeartbeat,
  withLongTakeContext,
} from './common'

const logger = new Logger('story-mode:long-take:naming')

const PROJECT_NAME_PROMPT_TEMPLATE = `You are a YouTube content creator with a deep understanding of user psychology, skilled at attracting viewers with concise and impactful titles. Each of your videos consistently receives over 100k views.
Now, based on the script I provide, you need to generate only one title with the greatest potential to go viral, one that will make viewers want to click immediately.
Please keep the title perfectly matched to the script. The original meaning of the script must not be altered in any way.
Output format:
- One title only
- Each title <= 15 words, without emoji
- Titles must be clear, concise, and engaging, without personal opinion
- Capture the core idea and user value of the script

Script:
{{scriptText}}`

export async function generateAndUpdateLongTakeProjectName(
  params: GenerateAndUpdateLongTakeProjectNameActivityParams,
): Promise<void> {
  const { projectId, scriptText, userId } = params

  return withLongTakeContext({ projectId, userId }, () =>
    withActivityHeartbeat(async () => {
      const trimmedScript = scriptText.trim()
      if (!trimmedScript) {
        return
      }

      const generatedName = await generateLongTakeProjectNameFromScript({
        projectId,
        scriptText: trimmedScript,
        userId,
      })
      if (!generatedName) {
        return
      }

      await getProjectDataService().replaceProjectName(projectId, generatedName)
      logger.info(
        `[long-take] Project name updated from script ${formatLogFields({
          generatedName,
          projectId,
        })}`,
      )
    }),
  )
}

export async function generateLongTakeProjectNameFromScript(params: {
  projectId: string
  scriptText: string
  userId: string
}): Promise<string> {
  const { projectId, scriptText, userId } = params

  try {
    const prompt = renderPrompt(PROJECT_NAME_PROMPT_TEMPLATE, { scriptText })
    const llmName = await JobContext.run({ projectId, userId }, async () =>
      runLongTakeCompletionWithRecord({
        projectId,
        userId,
        options: {
          models: ['gpt-5', 'gpt-4o-mini', 'gemini-2.5-flash'],
          prompt,
          responseFormat: z.string(),
          task: 'long-take-generate-project-name',
          temperature: 0.2,
        },
      }),
    )

    const normalizedName = llmName.trim()
    if (normalizedName) {
      return normalizedName
    }
  } catch (error) {
    logger.warn(
      `[long-take] Failed to generate project name with LLM, using fallback ${formatLogFields({
        err: formatError(error),
        projectId,
      })}`,
    )
  }

  return deriveProjectNameFromScript(scriptText)
}
