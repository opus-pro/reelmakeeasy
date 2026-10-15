/**
 * Anchor asset-manager LLM completion runtime: runs the asset-manager call
 * (multimodal -> text-only fallback), guards against collapsed visual_tag
 * output by retrying on the next model in the cascade. Extracted from
 * anchor-generation.ts; reuses its AnchorAssetManagerOutputSchema.
 */

import type { Content, Model } from '@reelmakeeasy/common/llm'
import { completion } from '@reelmakeeasy/common/llm/completion'
import { createSubLogger } from '@reelmakeeasy/common/logger'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import type { ModelSelectorAnalyticsTier } from '@shared/types/model-selector-analytics-tier'
import { z } from 'zod'

import { PLANNER_TOOL_MODELS } from '../model-config'
import { formatLogFields } from '../runtime/planner-log'

import {
  type AnchorAssetManagerOutputSchema,
  AnchorAssetManagerOutputSchemaLegacy,
} from './anchor-generation'

const logger = createSubLogger('user-intent-planner')

// Collapsed-output detection: we saw cases where the LLM emitted N
// anchor objects but with non-conformant JSON (Unicode smart quotes,
// double-escaped quotes), so the structured-output parser silently kept only
// the first anchor and absorbed the remaining N-1 anchors into that first
// anchor's `visual_tag` string. The user then saw 1 of N assets render.
//
// Detector heuristic: visual_tag is contractually a "3-word Title Case
// identifier" (typically <= 30 chars). Real outputs containing JSON braces,
// quote chars, or known schema keys like `anchor_id` / `visual_reference`
// inside visual_tag are structurally invalid and indicate the collapse.
const COLLAPSED_VISUAL_TAG_MAX_CHARS = 60
// JSON-structural characters (ASCII double quote U+0022, Unicode smart double
// quotes U+201C/U+201D, braces, brackets) plus known schema keys leaking into
// the string field. Escaped as \u so a re-encode/quote-normalizing editor
// can't silently change the matched set (the test file uses the same escapes).
// `'` (apostrophe) is intentionally NOT a marker -- legitimate tags like
// "McDonald's Logo" must pass.
const COLLAPSED_VISUAL_TAG_MARKERS =
  /[\u0022\u201C\u201D{}[\]]|anchor_id|visual_reference|source_asset_id/i

export function detectCollapsedAnchorOutput(
  result: z.infer<typeof AnchorAssetManagerOutputSchema>,
): boolean {
  return result.anchors.some(
    (anchor) =>
      anchor.visual_tag.length > COLLAPSED_VISUAL_TAG_MAX_CHARS ||
      COLLAPSED_VISUAL_TAG_MARKERS.test(anchor.visual_tag),
  )
}

const ANCHOR_ASSET_MANAGER_TIMEOUTS = {
  fallbackTimeoutMs: 30_000,
  multimodalTimeoutMs: 60_000,
  textOnlyTimeoutMs: 30_000,
} as const

export async function runAnchorAssetManagerCompletion(params: {
  assetManagerContents: Content[]
  assetManagerPrompt: string
  /** Quality tier for model routing. Absent = compiled-in chain. */
  modelSelectorTier?: ModelSelectorAnalyticsTier
  sessionId: string
}): Promise<z.infer<typeof AnchorAssetManagerOutputSchema>> {
  const timeouts = ANCHOR_ASSET_MANAGER_TIMEOUTS

  // No-image path: lighter, only text prompt. Same default timeout as the
  // text-only fallback path below.
  if (params.assetManagerContents.length === 0) {
    logger.info(
      `[uip-anchor-asset-manager] start mode=text-only sessionId=${params.sessionId} promptChars=${params.assetManagerPrompt.length} timeoutMs=${timeouts.textOnlyTimeoutMs}`,
    )
    const startedAt = Date.now()
    const result = await completionWithCollapseGuard({
      mode: 'text-only',
      modelSelectorTier: params.modelSelectorTier,
      prompt: params.assetManagerPrompt,
      sessionId: params.sessionId,
      task: 'user-intent-planner-anchor-asset-manager',
      timeout: timeouts.textOnlyTimeoutMs,
    })
    logger.info(
      `[uip-anchor-asset-manager] done mode=text-only durationMs=${Date.now() - startedAt} sessionId=${params.sessionId}`,
    )
    return result
  }

  // Multimodal path: 60s. A typical call takes 9-17s, but without a timeout one
  // can run for many minutes (gemini-pro 504 + 5min default x 3 retries); the cap
  // keeps headroom for the typical multimodal call without unbounded retries.
  logger.info(
    `[uip-anchor-asset-manager] start mode=multimodal sessionId=${params.sessionId} contents=${params.assetManagerContents.length} promptChars=${params.assetManagerPrompt.length} timeoutMs=${timeouts.multimodalTimeoutMs}`,
  )
  const multimodalStartedAt = Date.now()
  try {
    const result = await completionWithCollapseGuard({
      contents: params.assetManagerContents,
      mode: 'multimodal',
      modelSelectorTier: params.modelSelectorTier,
      prompt: params.assetManagerPrompt,
      sessionId: params.sessionId,
      task: 'user-intent-planner-anchor-asset-manager',
      timeout: timeouts.multimodalTimeoutMs,
    })
    logger.info(
      `[uip-anchor-asset-manager] done mode=multimodal durationMs=${Date.now() - multimodalStartedAt} sessionId=${params.sessionId}`,
    )
    return result
  } catch (multimodalError) {
    const ensuredError = ensureError(multimodalError)
    const zodIssues = summarizeZodIssues(multimodalError)
    logger.warn(
      `[user-intent-planner] anchor asset manager multimodal path failed; falling back to text-only ${formatLogFields(
        {
          assetManagerContentCount: params.assetManagerContents.length,
          assetManagerImageBytes: params.assetManagerContents.reduce((total, content) => {
            if (content.type !== 'image_url' || !content.imageUrl.startsWith('data:')) {
              return total
            }
            const base64Payload = content.imageUrl.split(',')[1] ?? ''
            return total + base64Payload.length
          }, 0),
          errorMessage: ensuredError.message,
          errorName: ensuredError.name,
          errorStack: ensuredError.stack,
          sessionId: params.sessionId,
          ...(zodIssues ? { zodIssues } : {}),
        },
      )}`,
    )

    const fallbackStartedAt = Date.now()
    logger.info(
      `[uip-anchor-asset-manager] start mode=text-only-fallback sessionId=${params.sessionId} timeoutMs=${timeouts.fallbackTimeoutMs}`,
    )
    try {
      const result = await completionWithCollapseGuard({
        mode: 'text-only-fallback',
        modelSelectorTier: params.modelSelectorTier,
        prompt: params.assetManagerPrompt,
        sessionId: params.sessionId,
        task: 'user-intent-planner-anchor-asset-manager-fallback',
        timeout: timeouts.fallbackTimeoutMs,
      })
      logger.info(
        `[uip-anchor-asset-manager] done mode=text-only-fallback durationMs=${Date.now() - fallbackStartedAt} sessionId=${params.sessionId}`,
      )
      return result
    } catch (fallbackError) {
      const multimodalMessage =
        multimodalError instanceof Error ? multimodalError.message : JSON.stringify(multimodalError)
      const fallbackMessage =
        fallbackError instanceof Error ? fallbackError.message : JSON.stringify(fallbackError)
      throw new Error(
        `anchor asset manager failed: multimodal=${multimodalMessage}; fallback=${fallbackMessage}`,
      )
    }
  }
}

export function summarizeZodIssues(error: unknown): undefined | unknown[] {
  if (!(error instanceof z.ZodError)) {
    return undefined
  }

  return error.issues.map((issue) => ({
    code: issue.code,
    message: issue.message,
    path: issue.path.join('.'),
  }))
}

async function completionWithCollapseGuard(args: {
  contents?: Content[]
  mode: string
  /** Quality tier for model routing. */
  modelSelectorTier?: ModelSelectorAnalyticsTier
  prompt: string
  sessionId: string
  task: string
  timeout: number
}): Promise<z.infer<typeof AnchorAssetManagerOutputSchema>> {
  const baseArgs = {
    prompt: args.prompt,
    reasoningEffort: 'low' as const,
    responseFormat: AnchorAssetManagerOutputSchemaLegacy,
    temperature: 0.1,
    timeout: args.timeout,
    ...(args.contents ? { contents: args.contents } : {}),
  }
  const firstResult = await completion({
    ...baseArgs,
    models: PLANNER_TOOL_MODELS,
    task: args.task,
  })
  if (!detectCollapsedAnchorOutput(firstResult)) {
    return firstResult
  }

  // Collapse is a content-quality failure, not a transient one, so
  // completion()'s built-in retry won't help -- it would just re-run the same
  // model with the same prompt. Instead, retry with the next model in the
  // cascade (PLANNER_TOOL_MODELS is ordered primary -> fallback), which is a
  // real remediation if the failure mode is model-specific (e.g. Gemini
  // emitting Unicode quotes that GPT wouldn't).
  const fallbackModels = PLANNER_TOOL_MODELS.slice(1)
  const firstLongest = firstResult.anchors.reduce(
    (max, anchor) => Math.max(max, anchor.visual_tag.length),
    0,
  )
  if (fallbackModels.length === 0) {
    throw new Error(
      `anchor asset manager produced collapsed output (visual_tag exceeds ${COLLAPSED_VISUAL_TAG_MAX_CHARS} chars or contains structural markers); mode=${args.mode} sessionId=${args.sessionId} longestVisualTagChars=${firstLongest}; no fallback model configured`,
    )
  }
  logger.warn(
    `[uip-anchor-asset-manager] collapsed output detected mode=${args.mode} sessionId=${args.sessionId} longestVisualTagChars=${firstLongest}; retrying with fallback model=${fallbackModels[0]}`,
  )
  // After the fallback-model retry, return whatever we got. If the retry
  // is also collapsed, the result is no worse than today's silent
  // partial-data behavior, and surfacing a hard error would lose the
  // partially-usable first anchor. The warn log above is the signal for
  // tracking sustained collapse rates.
  return completion({
    ...baseArgs,
    // Single-model fallback list -- the SDK refuses one-item `models[]`
    // without this flag.
    ignoreFallbackModel: true,
    // Keep `task` unchanged so the retry participates in the same
    // task-based model routing, experiments, and metric streams as the
    // primary call. The model switch is already visible via the warn
    // log above and via completion()'s per-call model telemetry.
    // Length-checked above (throws when empty); cast to satisfy the
    // non-empty tuple type CompletionOptions requires.
    models: fallbackModels as [Model, ...Model[]],
    task: args.task,
  })
}
