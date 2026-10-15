import type { Model } from '@reelmakeeasy/common/llm'
import { completion } from '@reelmakeeasy/common/llm'

import type {
  GeminiVisionParams,
  JudgeContext,
  JudgeResult,
  JudgeRunner,
  JudgeVersion,
} from '../types'

/**
 * Runner strategy: single Gemini Vision LLM call.
 * Each rubric version controls its own response schema and result mapping.
 */
export class GeminiVisionV1Runner implements JudgeRunner {
  readonly name = 'gemini-vision-v1' as const

  async run(
    keyframeUrl: string,
    config: JudgeVersion,
    context?: JudgeContext,
  ): Promise<JudgeResult> {
    const { buildPrompt, mapResult, model, prompt, responseSchema, temperature } =
      config.params as GeminiVisionParams
    // A context-aware rubric falls back to its static prompt when the caller
    // supplies no context, so it stays answerable either way.
    const resolvedPrompt = buildPrompt ? buildPrompt(context) : prompt

    const raw = await completion({
      task: `judge-${config.rubricId}-${config.version}`,
      models: [model as Model],
      ignoreFallbackModel: true,
      contents: [{ type: 'image_url', imageUrl: keyframeUrl }],
      prompt: resolvedPrompt,
      responseFormat: responseSchema,
      ...(temperature !== undefined && { temperature }),
    })

    const rawRecord = raw as Record<string, unknown>
    const mapped = mapResult(rawRecord)
    return {
      ...(mapped.details !== undefined && { details: mapped.details }),
      pass: mapped.pass,
      reason: typeof rawRecord['reason'] === 'string' ? rawRecord['reason'] : '',
      score: typeof rawRecord['score'] === 'number' ? rawRecord['score'] : mapped.pass ? 10 : 0,
    }
  }
}
