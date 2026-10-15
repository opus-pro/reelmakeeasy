import {
  CONTENT_CLASSIFICATION_MODELS,
  CONTENT_CLASSIFICATION_TEMPERATURE,
} from '@reelmakeeasy/common/classification/content-classification'
import { JobContext } from '@reelmakeeasy/common/job-context'
import { z } from 'zod'

import {
  buildLongTakePromptRouteClassificationPrompt,
  LONG_TAKE_PROMPT_ROUTES,
} from '../../long-take-prompt-router'
import type {
  ClassifyLongTakePromptActivityParams,
  ClassifyLongTakePromptActivityResult,
  ClassifyLongTakePromptRouteActivityParams,
  ClassifyLongTakePromptRouteActivityResult,
} from '../../workflows/long-take/types'
import { runLongTakeCompletionWithRecord } from '../long-take-generation-record'
import { buildLongTakeClassificationPrompt } from '../prompts/long-take-classification-prompt'

import { buildClassificationAudioAnalysis } from './classification-audio-summary'
import {
  formatError,
  formatLogFields,
  logger,
  withActivityHeartbeat,
  withLongTakeContext,
} from './common'
import {
  createLongTakeStorage,
  LONG_TAKE_PROMPT_CLASSIFICATION_PATH,
  LONG_TAKE_PROMPT_ROUTE_CLASSIFICATION_PATH,
  type LongTakePromptClassification,
  LongTakePromptClassificationSchema,
} from './storage'

const LongTakePromptRouteClassificationSchema = z.object({
  prompt_route: z.enum(LONG_TAKE_PROMPT_ROUTES),
  reasoning: z.string(),
})

export async function classifyLongTakePrompt(
  params: ClassifyLongTakePromptActivityParams,
): Promise<ClassifyLongTakePromptActivityResult> {
  const { analyzeAudio, projectId, prompt, userId } = params
  return withLongTakeContext({ projectId, userId }, () =>
    withActivityHeartbeat(async () => {
      const rawInput = prompt?.trim()
      if (!rawInput) {
        return null
      }

      const startedAt = Date.now()
      logger.info(
        `[long-take] Prompt classification started ${formatLogFields({
          projectId,
          userId,
          promptLength: rawInput.length,
          analyzeAudio: Boolean(analyzeAudio),
        })}`,
      )

      try {
        // "Gemini hears the audio" signal. Only attempted when the caller opts
        // in (audio mode, after the voiceover stage has written the mp3).
        // Best-effort: returns undefined on any failure / missing audio, so the
        // classifier falls back to text-only with no behavior change.
        const audioSummary = analyzeAudio
          ? await buildClassificationAudioAnalysis({
              projectId,
              userId,
              audioStoreUri: typeof analyzeAudio === 'string' ? analyzeAudio : undefined,
            })
          : undefined

        const classificationPrompt = buildLongTakeClassificationPrompt(rawInput, audioSummary)
        const response: LongTakePromptClassification = await JobContext.run(
          { projectId, userId },
          async () =>
            runLongTakeCompletionWithRecord({
              projectId,
              userId,
              options: {
                models: [...CONTENT_CLASSIFICATION_MODELS],
                prompt: classificationPrompt,
                responseFormat: LongTakePromptClassificationSchema,
                task: 'long-take-prompt-classification',
                timeout: 120_000,
                temperature: CONTENT_CLASSIFICATION_TEMPERATURE,
              },
            }),
        )

        const storage = createLongTakeStorage(projectId)
        await storage.ensureDir('long_take')
        await storage.writeJsonFile(LONG_TAKE_PROMPT_CLASSIFICATION_PATH, response)

        logger.info(
          `[long-take] Prompt classification saved ${formatLogFields({
            projectId,
            topic: response.topic,
            use_case: response.use_case,
            path: LONG_TAKE_PROMPT_CLASSIFICATION_PATH,
            durationMs: Date.now() - startedAt,
          })}`,
        )

        return response
      } catch (error) {
        logger.warn(
          `[long-take] Prompt classification failed ${formatLogFields({
            projectId,
            err: formatError(error),
          })}`,
        )
        return null
      }
    }),
  )
}

export async function classifyLongTakePromptRoute(
  params: ClassifyLongTakePromptRouteActivityParams,
): Promise<ClassifyLongTakePromptRouteActivityResult> {
  const { originalUserInput, projectId, script, userId } = params
  return withLongTakeContext({ projectId, userId }, () =>
    withActivityHeartbeat(async () => {
      const rawInput = script?.trim()
      if (!rawInput) {
        return {
          promptRoute: 'general',
          reasoning: 'No confirmed script/transcript was available, so the general route was used.',
        }
      }

      const startedAt = Date.now()
      logger.info(
        `[long-take] Prompt route classification started ${formatLogFields({
          originalUserInputLength: originalUserInput?.trim().length ?? 0,
          projectId,
          scriptLength: rawInput.length,
          userId,
        })}`,
      )

      try {
        const routePrompt = params.intentMode
          ? buildLongTakePromptRouteClassificationPrompt(rawInput, originalUserInput, {
              intentMode: params.intentMode,
            })
          : buildLongTakePromptRouteClassificationPrompt(rawInput, originalUserInput)
        const response = await JobContext.run({ projectId, userId }, async () =>
          runLongTakeCompletionWithRecord({
            projectId,
            userId,
            options: {
              models: ['gemini-3.8-flash', 'gpt-5'],
              prompt: routePrompt,
              responseFormat: LongTakePromptRouteClassificationSchema,
              task: 'long-take-prompt-route-classification',
              timeout: 120_000,
              temperature: 0,
            },
          }),
        )

        const result: ClassifyLongTakePromptRouteActivityResult = {
          outputPath: LONG_TAKE_PROMPT_ROUTE_CLASSIFICATION_PATH,
          promptRoute: response.prompt_route,
          reasoning: response.reasoning,
        }

        const storage = createLongTakeStorage(projectId)
        await storage.ensureDir('long_take')
        await storage.writeJsonFile(LONG_TAKE_PROMPT_ROUTE_CLASSIFICATION_PATH, {
          prompt_route: result.promptRoute,
          reasoning: result.reasoning,
        })

        logger.info(
          `[long-take] Prompt route classification saved ${formatLogFields({
            durationMs: Date.now() - startedAt,
            path: LONG_TAKE_PROMPT_ROUTE_CLASSIFICATION_PATH,
            projectId,
            promptRoute: result.promptRoute,
          })}`,
        )

        return result
      } catch (error) {
        logger.warn(
          `[long-take] Prompt route classification failed, falling back to general ${formatLogFields(
            {
              projectId,
              err: formatError(error),
            },
          )}`,
        )
        return {
          promptRoute: 'general',
          reasoning: 'LLM route classification failed, so the general route was used as fallback.',
        }
      }
    }),
  )
}

export async function classifyUploadedAudioMusicForPreVoiceover(params: {
  audioPath: string
  projectId: string
  userId?: string
}): Promise<{ audioAnalysis?: string; isMusic: boolean }> {
  // The Gemini audio analysis (full-track download + up to two model attempts,
  // 120s LLM timeout each) can exceed the proxy's 120s heartbeatTimeout, so
  // without heartbeats the engine kills every attempt at exactly 120s.
  return withLongTakeContext({ projectId: params.projectId, userId: params.userId }, () =>
    withActivityHeartbeat(async () => {
      const audioAnalysis = await buildClassificationAudioAnalysis({
        audioStoreUri: params.audioPath,
        projectId: params.projectId,
        userId: params.userId,
      })
      return {
        audioAnalysis,
        isMusic: /^is_music:\s*true\b/im.test(audioAnalysis ?? ''),
      }
    }),
  )
}
