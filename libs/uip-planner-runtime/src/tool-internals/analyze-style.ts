import { createStorage } from '@reelmakeeasy/common/agent-v2/storage/storage'
import { completion } from '@reelmakeeasy/common/llm/completion'
import { createSubLogger } from '@reelmakeeasy/common/logger'
import type { ModelSelectorAnalyticsTier } from '@shared/types/model-selector-analytics-tier'
import { z } from 'zod'

import { PLANNER_TOOL_MODELS } from '../model-config'

import { buildLongTakeStyleAnalysisPrompt } from './long-take-style-analysis-prompt'

const logger = createSubLogger('uip-planner-runtime:analyze-style')

/**
 * Mirrors `StyleAnalysisSchema` in
 * `libs/story-mode-runtime/src/activities/long-take/style-analysis.ts`.
 * Keeping the shape identical lets us forward the result straight into
 * `applyStyleResultToPipelineContext` and `LongTakeWorkflowParams.styleAnalysis`
 * downstream without any field remapping.
 */
const StyleAnalysisSchema = z.object({
  color_palette: z.record(z.object({ hex: z.string(), percentage: z.string() })),
  key_style_tags: z.array(z.string()),
  reproduction_guidance: z.string().nullable().default(null),
  reusable_style_prompt: z.string(),
  style_description: z.string(),
})

export interface AnalyzeStyleParams {
  /**
   * UIP-internal intent string. UIP doesn't produce NST's free-form
   * `intentAnalysis` directly; we pass `global_constraints.directives` (joined)
   * from `generate_intent_context` so the prompt has narrative context.
   */
  intentAnalysis: null | string
  /** Quality tier for model routing. Absent = compiled-in chain. */
  modelSelectorTier?: ModelSelectorAnalyticsTier
  projectId: string
  /**
   * The UIP session id, and ONLY for model routing. Deliberately separate from
   * `projectId` above, which callers pass as the storage prefix
   * `${sessionId}/user-intent-planner` -- using that as the
   * randomization unit would bucket this tool away from every other call in the
   * same session. Absent keeps the compiled-in chain.
   */
  sessionId?: string
  /**
   * store path to the style reference image. Relative to the project's
   * UIP prefix (`projects/{projectId}/user-intent-planner/`). Read via
   * `createStorage(projectId).readFile(path)`.
   */
  styleImageStorePath: string
  /**
   * User-selected style preset name (e.g. "Marcinelle comic"). When set,
   * the prompt anchors the analysis on this preset instead of letting the
   * user prompt's style language override the reference image.
   */
  styleText?: null | string
  userPrompt: string
}

export type StyleAnalysisResult = z.infer<typeof StyleAnalysisSchema>

/**
 * Run NST's style-analysis prompt against the UIP session's style
 * reference image. Triggered automatically by `generate_intent_context`
 * when a style image is present so downstream UIP tools (anchor image
 * generation, world bible) can ground on the same `reusable_style_prompt`
 * the story-mode pipeline would have produced for a non-UIP project.
 *
 * Returns null on failure: style analysis is best-effort, never fatal.
 */
export async function analyzeStyle(
  params: AnalyzeStyleParams,
): Promise<null | StyleAnalysisResult> {
  const startedAt = Date.now()
  try {
    const imageDataUrl = await readStyleImageAsDataUrl(params.projectId, params.styleImageStorePath)
    const result = await completion({
      contents: [{ imageUrl: imageDataUrl, type: 'image_url' }],
      models: PLANNER_TOOL_MODELS,
      prompt: buildLongTakeStyleAnalysisPrompt(
        params.userPrompt,
        params.intentAnalysis,
        params.styleText ?? null,
      ),
      reasoningEffort: 'low',
      responseFormat: StyleAnalysisSchema,
      task: 'user-intent-planner-analyze_style',
      temperature: 0,
      timeout: 60_000,
    })
    logger.info(
      `[uip-analyze-style] done projectId=${params.projectId} tagCount=${result.key_style_tags.length} durationMs=${Date.now() - startedAt}`,
    )
    return result
  } catch (err) {
    logger.warn(
      `[uip-analyze-style] failed projectId=${params.projectId} err=${
        err instanceof Error ? err.message : String(err)
      }`,
    )
    return null
  }
}

function inferMimeFromPath(path: string): string {
  const lower = path.toLowerCase()
  if (lower.endsWith('.png')) {
    return 'image/png'
  }
  if (lower.endsWith('.webp')) {
    return 'image/webp'
  }
  if (lower.endsWith('.gif')) {
    return 'image/gif'
  }
  return 'image/jpeg'
}

async function readStyleImageAsDataUrl(projectId: string, fileUri: string): Promise<string> {
  const storage = await createStorage(projectId)
  const buffer = await storage.readFile(fileUri)
  const mime = inferMimeFromPath(fileUri)
  return `data:${mime};base64,${buffer.toString('base64')}`
}
