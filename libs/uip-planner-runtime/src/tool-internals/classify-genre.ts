import { completion } from '@reelmakeeasy/common/llm/completion'
import { createSubLogger } from '@reelmakeeasy/common/logger'

import { PLANNER_TOOL_MODELS_LIGHT } from '../model-config'
import { type GenreClassification, GenreClassificationSchema } from '../types'

import { buildLongTakeGenrePrompt } from './long-take-genre-prompt'

const logger = createSubLogger('uip-planner-runtime:classify-genre')

/**
 * Run NST's genre-classification prompt against a finalized UIP session.
 * Triggered at confirm time when the new-style-transfer gate is on so
 * `UipToStoryModeWorkflow` can ship the same `genreAnalysis` that
 * non-UIP NST projects produce. Failure logs and returns null --
 * downstream pipeline context simply omits the genre entry in that case.
 *
 * The NST `buildLongTakeGenrePrompt` is a static instruction template
 * (no placeholders) and relies on the caller injecting project context
 * around it. In the story-mode runtime that injection happens via
 * `formatPipelineContext()` inside `runLongTakeCompletionWithRecord`;
 * UIP doesn't have that layer, so we prepend the context block here.
 * Without this the LLM has no project-specific data and returns a
 * generic / arbitrary genre that then contaminates downstream
 * pipeline-context-dependent stages.
 */
export async function classifyGenre(params: {
  intentAnalysis?: null | string
  originalUserInput?: null | string
  projectId: string
  script: string
  styleText?: string
}): Promise<GenreClassification | null> {
  const startedAt = Date.now()
  const contextLines = [
    params.originalUserInput?.trim()
      ? `User initial prompt(Their intent):\n${params.originalUserInput.trim()}`
      : '',
    params.script.trim() ? `Script:\n${params.script.trim()}` : '',
    params.intentAnalysis?.trim() ? `Intent Analysis:\n${params.intentAnalysis.trim()}` : '',
    params.styleText?.trim() ? `Style:\n${params.styleText.trim()}` : '',
  ].filter(Boolean)
  const promptWithContext =
    contextLines.length > 0
      ? `${contextLines.join('\n\n')}\n\n---\n\n${buildLongTakeGenrePrompt()}`
      : buildLongTakeGenrePrompt()

  try {
    const result = await completion({
      models: PLANNER_TOOL_MODELS_LIGHT,
      prompt: promptWithContext,
      reasoningEffort: 'low',
      responseFormat: GenreClassificationSchema,
      task: 'user-intent-planner-classify_genre',
      temperature: 0,
      timeout: 30_000,
    })
    logger.info(
      `[uip-classify-genre] done projectId=${params.projectId} primaryGenre=${result.primary_genre} durationMs=${Date.now() - startedAt}`,
    )
    return result
  } catch (err) {
    logger.warn(
      `[uip-classify-genre] failed projectId=${params.projectId} err=${
        err instanceof Error ? err.message : String(err)
      }`,
    )
    return null
  }
}
