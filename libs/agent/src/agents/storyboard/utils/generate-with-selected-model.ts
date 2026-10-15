import { writeFile } from 'node:fs/promises'

import type { CircuitBreakerInstance } from '@reelmakeeasy/common/circuit-breaker'
import {
  ClientImageGenerationOptions,
  Content,
  generateImage,
  Model,
  resolveImageProvider,
} from '@reelmakeeasy/common/llm'
import {
  getImageModelFallbackChain,
  isImageModelFallbackAbsorbed,
  validateImageModelId,
} from '@reelmakeeasy/common/llm/image-model-selection'
import { logger } from '@reelmakeeasy/common/logger'
import type { AspectRatio, ImageSizeTier } from '@reelmakeeasy/common/media/types'
import { asStoreUri } from '@reelmakeeasy/common/storage/address'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import {
  getProviderCode,
  isProviderHealthFailure,
  isReferenceFetchFailure,
  ReferenceFetchFailedError,
} from '@reelmakeeasy/common/utils/provider-error'

export type GenerateWithSelectedModelParams = {
  aspectRatio?: AspectRatio
  breaker?: CircuitBreakerInstance
  breakerScope?: string
  contents: Content[]
  grounding?: ClientImageGenerationOptions['grounding']
  onModelUsed?: (model: string) => void
  onProviderResponse?: (args: ProviderResponseEvent) => void
  orgId: null | string | undefined
  outputPath: string
  prompt: string
  /** Image size tier, forwarded as the model's resolution. */
  resolutionTier?: ImageSizeTier
  selectedModel: string
  size?: string
  stage: string
  task: string
}

// Internal shape passed to tryGenerateWithModel so it can fire onModelUsed
// in the correct order (before onProviderResponse on the success path).
export type ProviderResponseEvent = {
  durationMs: number
  error?: unknown
  model: string
  outcome: 'failure' | 'rejected' | 'success'
  provider: string
  stage: string
}

type TryGenerateArgs = {
  aspectRatio: AspectRatio
  breaker: CircuitBreakerInstance | undefined
  breakerKey: string
  contents: Content[]
  grounding: ClientImageGenerationOptions['grounding'] | undefined
  model: string
  onModelUsed: ((model: string) => void) | undefined
  onProviderResponse: ((e: ProviderResponseEvent) => void) | undefined
  outputPath: string
  prompt: string
  provider: string
  resolutionTier: ImageSizeTier | undefined
  size: string | undefined
  stage: string
  task: string
}

// Instrumentation callbacks are best-effort: a throwing observer must never
// change a generation outcome or stop fallback traversal.
function safeNotify(label: string, notify: (() => void) | undefined): void {
  if (!notify) {
    return
  }
  try {
    notify()
  } catch (error) {
    logger.warn(
      `[generateWithSelectedModel] ${label} callback failed (non-fatal): ${ensureError(error).message}`,
    )
  }
}

/**
 * Model-aware image orchestrator. In-scope generation surfaces call
 * this to generate an image with a caller-selected model through generateImage,
 * walking the model registry's fallbacks for that model and writing the result
 * to a file path.
 *
 * Telemetry and the actually-used model are surfaced ONLY through injected
 * callbacks. This module therefore has no dependency on any runtime package and
 * the used model never leaks back to a client (E26). The onModelUsed callback
 * and the used model it reports are internal-only attribution signals.
 */
export async function generateWithSelectedModel(
  params: GenerateWithSelectedModelParams,
): Promise<string> {
  const {
    aspectRatio = '9:16',
    breaker,
    breakerScope,
    contents,
    grounding,
    onModelUsed,
    onProviderResponse,
    outputPath,
    prompt,
    resolutionTier,
    size,
    stage,
    task,
  } = params

  // A legacy id from a persisted row or in-flight workflow resolves to its
  // registry key once, and that key is used everywhere below, including
  // telemetry, so attribution matches what was actually requested.
  const selectedModel = validateImageModelId(params.selectedModel)

  // Selected model first, then its configured fallbacks. De-dup while
  // preserving order so a model that also appears in the chain is never
  // retried against itself.
  const candidates = dedupePreserveOrder([
    selectedModel,
    ...getImageModelFallbackChain(selectedModel),
  ])

  let lastError: unknown
  // Tracks the PRIMARY model's (selectedModel) non-success outcome so the
  // fallback metric reason tag reflects WHY the selected model was skipped
  // ('rejected') or failed ('failure'), not whatever a later hop did.
  let primaryOutcome: 'failure' | 'rejected' | undefined

  for (const [idx, model] of candidates.entries()) {
    const isPrimary = idx === 0
    const provider = resolveImageProvider(model)
    const breakerKey = breakerScope ? `${breakerScope}:${provider}` : provider

    const skipped = await checkBreaker(breaker, breakerKey, model, provider)
    if (skipped) {
      if (!lastError) {
        lastError = new Error(`circuit breaker open for provider ${provider} (model ${model})`)
      }
      if (isPrimary) {
        primaryOutcome = 'rejected'
      }
      safeNotify(
        'onProviderResponse',
        onProviderResponse &&
          (() =>
            onProviderResponse({ durationMs: 0, model, outcome: 'rejected', provider, stage })),
      )
      continue
    }

    const attempt = await tryGenerateWithModel({
      aspectRatio,
      breaker,
      breakerKey,
      contents,
      grounding,
      model,
      onModelUsed,
      onProviderResponse,
      outputPath,
      prompt,
      provider,
      resolutionTier,
      size,
      stage,
      task,
    })

    if (attempt.ok) {
      // Emit fallback metric only when a non-primary model succeeded.
      // primaryOutcome is set only if the selected model had a non-success
      // outcome, so omitting the tag when it is undefined is correct.
      if (!isPrimary && primaryOutcome !== undefined) {
        emitFallbackMetric(selectedModel, model, primaryOutcome, stage)
      }
      return attempt.path
    }

    lastError = attempt.error
    if (isPrimary) {
      primaryOutcome = 'failure'
    }

    throwIfReferenceFetchFailed(attempt.error, { contents, selectedModel, stage })
  }

  // Whole chain exhausted (E12).
  throw new Error(
    `All models failed for selected-model image generation (selected=${selectedModel}, stage=${stage})`,
    { cause: lastError },
  )
}

function dedupePreserveOrder(values: string[]): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value)
      result.push(value)
    }
  }
  return result
}

// Canonical keys for the request's reference images. File URLs (with or without
// a query string) and store:// forms of the same object all collapse to one key, so a caller can compare
// keys across requests that carried different URL forms of the same asset.
function resolveReferenceKeys(contents: Content[]): string[] {
  const keys = contents.flatMap((content) =>
    content.type === 'image_url' && content.imageUrl ? [asStoreUri(content.imageUrl)] : [],
  )
  return dedupePreserveOrder(keys)
}

// The reference asset, not the model, is what failed: every remaining candidate
// fetches the same URL and gets the same rejection, so walking the chain
// only burns hops and provider quota.
function throwIfReferenceFetchFailed(
  error: unknown,
  args: { contents: Content[]; selectedModel: string; stage: string },
): void {
  if (!isReferenceFetchFailure(error)) {
    return
  }
  throw new ReferenceFetchFailedError({
    cause: error,
    message: `Reference image fetch failed for selected-model image generation (selected=${args.selectedModel}, stage=${args.stage}): ${ensureError(error).message}`,
    referenceKeys: resolveReferenceKeys(args.contents),
  })
}

// Returns true when the breaker is open for the given key (caller should skip
// the attempt), false when the breaker is closed or absent.
async function checkBreaker(
  breaker: CircuitBreakerInstance | undefined,
  breakerKey: string,
  model: string,
  provider: string,
): Promise<boolean> {
  if (!breaker) {
    return false
  }
  const check = await breaker.check(breakerKey, { model, provider })
  return !check.allowed
}

// Attempt one model. Returns { ok: true, path } on success or
// { ok: false, error } on provider failure. Handles breaker recording,
// provider dispatch, and callback emission internally.
//
// Success callback order: onModelUsed -> onProviderResponse.
// Breaker bookkeeping is best-effort: a throw from recordSuccess or
// recordFailure must never affect the generation outcome or chain traversal.
async function tryGenerateWithModel(
  args: TryGenerateArgs,
): Promise<{ error: unknown; ok: false } | { ok: true; path: string }> {
  const {
    aspectRatio,
    breaker,
    breakerKey,
    contents,
    grounding,
    model,
    onModelUsed,
    onProviderResponse,
    outputPath,
    prompt,
    provider,
    resolutionTier,
    size,
    stage,
    task,
  } = args
  const startedAt = Date.now()
  try {
    const path = await runViaGenerateImage({
      aspectRatio,
      contents,
      grounding,
      imageSize: resolutionTier,
      model,
      outputPath,
      prompt,
      size,
      task,
    })
    // Breaker bookkeeping is best-effort -- a throw must not make a successful
    // generation appear failed to the caller.
    await breaker
      ?.recordSuccess(breakerKey, { model, provider })
      .catch((err) =>
        logger.warn(
          `[generateWithSelectedModel] breaker.recordSuccess failed for ${provider} (non-fatal): ${ensureError(err).message}`,
        ),
      )
    // onModelUsed fires BEFORE onProviderResponse so attribution is set before
    // the telemetry event that signals completion.
    safeNotify('onModelUsed', onModelUsed && (() => onModelUsed(model)))
    safeNotify(
      'onProviderResponse',
      onProviderResponse &&
        (() =>
          onProviderResponse({
            durationMs: Date.now() - startedAt,
            model,
            outcome: 'success',
            provider,
            stage,
          })),
    )
    return { ok: true, path }
  } catch (error) {
    // Breaker bookkeeping is best-effort -- a throw must not abort chain
    // traversal and skip a valid fallback. Only provider-health failures count:
    // deterministic request-level rejections (content policy, invalid input)
    // say nothing about availability and must not trip the breaker on rate;
    // they DO prove the provider answered, so record a rejection to resolve a
    // half-open probe instead of leaving its lease to expire.
    const record = isProviderHealthFailure(error)
      ? breaker?.recordFailure(breakerKey, { model, provider })
      : breaker?.recordRejection(breakerKey, getProviderCode(error) ?? 'unknown', {
          model,
          provider,
        })
    await record?.catch((err) =>
      logger.warn(
        `[generateWithSelectedModel] breaker bookkeeping failed for ${provider} (non-fatal): ${ensureError(err).message}`,
      ),
    )
    safeNotify(
      'onProviderResponse',
      onProviderResponse &&
        (() =>
          onProviderResponse({
            durationMs: Date.now() - startedAt,
            error,
            model,
            outcome: 'failure',
            provider,
            stage,
          })),
    )
    logger.warn(
      `[generateWithSelectedModel] model ${model} (provider ${provider}) failed at stage ${stage}: ${ensureError(error).message}`,
    )
    return { error, ok: false }
  }
}

// Emit agent.long_take.image_model_fallback once per generation where a
// fallback model succeeded. `absorbed` is omitted when either model has no
// cost data (callers omit the tag rather than emit 'unknown').
function emitFallbackMetric(
  selectedModel: string,
  fallbackModel: string,
  reason: 'failure' | 'rejected',
  surface: string,
): void {
  const absorbed = isImageModelFallbackAbsorbed(selectedModel, fallbackModel)
  const tags: Record<string, boolean | string> = {
    fallback_model: fallbackModel,
    primary_model: selectedModel,
    reason,
    surface,
  }
  if (absorbed !== undefined) {
    tags['absorbed'] = absorbed
  }
}

// Generate via the shared generateImage pipeline and normalize the base64
// result to a written file path. The orchestrator owns the circuit breaker, so
// we deliberately do NOT pass breaker/breakerScope into generateImage; doing so
// would double-count breaker outcomes.
async function runViaGenerateImage(args: {
  aspectRatio: AspectRatio
  contents: Content[]
  grounding: ClientImageGenerationOptions['grounding']
  imageSize?: ImageSizeTier
  model: string
  outputPath: string
  prompt: string
  size?: string
  task: string
}): Promise<string> {
  const { aspectRatio, contents, grounding, imageSize, model, outputPath, prompt, size, task } =
    args
  const result = await generateImage({
    // candidates are registry keys (selectedModel plus its registry
    // fallbacks), which libs/llm resolves; the cast only satisfies the type.
    models: [model] as Model[],
    aspectRatio,
    contents,
    grounding,
    imageSize,
    prompt,
    // size originates from caller-provided dimension strings (e.g.
    // ratioToImageSize); the cast narrows string to the OpenAI size union.
    size: size as ClientImageGenerationOptions['size'],
    task,
  })
  const buffer = Buffer.from(result.imageBase64, 'base64')
  await writeFile(outputPath, buffer as NodeJS.ArrayBufferView)
  return outputPath
}
