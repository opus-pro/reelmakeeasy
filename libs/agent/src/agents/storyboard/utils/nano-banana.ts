import { writeFile } from 'node:fs/promises'

import type { CircuitBreakerInstance } from '@reelmakeeasy/common/circuit-breaker'
import { ClientImageGenerationOptions, Content, generateImage } from '@reelmakeeasy/common/llm'
import { logger } from '@reelmakeeasy/common/logger'
import type { AspectRatio } from '@reelmakeeasy/common/media/types'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import { fallbacksFor, resolveModel } from '@reelmakeeasy/llm/registry'

import { retry } from '../../common/utils'

type NanoBananaErrorCode = 'IMAGE_EMPTY_CONTENT' | 'IMAGE_GEN_FAILED' | 'IMAGE_POLICY_BLOCKED'

type ProviderErrorLike = Error & {
  cause?: unknown
  code?: string
  http_status?: number
  httpStatus?: number
  response?: { status?: number }
  status?: number
  statusCode?: number
}

function extractHttpStatus(error: ProviderErrorLike): number | undefined {
  return normalizeHttpStatus(
    error.http_status ||
      error.httpStatus ||
      error.status ||
      error.statusCode ||
      error.response?.status,
  )
}

function isBreakerSkipError(error: unknown): boolean {
  return error instanceof Error && error.message.includes('All models failed for image generation')
}

function normalizeHttpStatus(status?: number): number | undefined {
  if (!Number.isFinite(status)) {
    return undefined
  }
  const normalized = Number(status)
  if (normalized < 100 || normalized > 599) {
    return undefined
  }
  return normalized
}

function resolveNanoBananaErrorCode(message: string): NanoBananaErrorCode {
  if (message.includes('IMAGE_PROHIBITED_CONTENT')) {
    return 'IMAGE_POLICY_BLOCKED'
  }
  if (message.includes('[Error!') || message.includes('No image content returned')) {
    return 'IMAGE_EMPTY_CONTENT'
  }
  return 'IMAGE_GEN_FAILED'
}

function wrapNanoBananaError(params: {
  code: NanoBananaErrorCode
  sourceError: ProviderErrorLike
}): ProviderErrorLike {
  const { code, sourceError } = params
  const wrapped = new Error(
    `No image content returned (${code}): ${sourceError.message}`,
  ) as ProviderErrorLike
  wrapped.code = code
  wrapped.cause = sourceError

  const status = extractHttpStatus(sourceError)
  if (status !== undefined) {
    wrapped.http_status = status
    wrapped.httpStatus = status
    wrapped.status = status
    wrapped.statusCode = status
    wrapped.response = {
      ...sourceError.response,
      status,
    }
  }

  return wrapped
}
// Throttle outbound image-generation calls to avoid network send failures

export async function nanoBananaTool(
  prompt: string,
  contents: Content[],
  outputPath: string,
  task?: string,
  customModel?: string,
  aspectRatio: AspectRatio = '9:16',
  imageOptions?: Pick<ClientImageGenerationOptions, 'grounding' | 'imageSize'>,
  breakerOptions?: {
    breaker?: CircuitBreakerInstance
    breakerScope?: string
    /** Called with the actual model used after model resolution and retry fallback */
    onModelResolved?: (model: string) => void
  },
) {
  if (customModel) {
    logger.info(`[nanoBananaTool] Using custom model: ${customModel}`)
  }

  // Resolve to a registry key up front (legacy ids and an absent model land on
  // the image.edit role) so classification, telemetry and the provider call
  // all agree.
  const primary = resolveModel('image', customModel, { role: 'image.edit' })
  // Retries move to the registry's first fallback for this model, if any.
  const retryModel = fallbacksFor(primary.key)[0]?.key ?? primary.key
  let model = primary.key

  // Report resolved model immediately so callers can attribute correctly
  // even if the API call fails
  breakerOptions?.onModelResolved?.(model)

  try {
    // Nano Banana on fal or on the Gemini API: each retry attempt is capped at 80 s.
    const isNanoBanana = primary.adapter === 'nano-banana' || primary.adapter === 'gemini-image'
    const runGenerate = async (attempt: number) => {
      if (attempt > 1 && model !== retryModel) {
        logger.warn(
          `[nanoBananaTool] Model ${model} failed after retries, falling back to ${retryModel}`,
        )
        model = retryModel
        breakerOptions?.onModelResolved?.(model)
      }
      const result = await generateImage({
        models: [model],
        aspectRatio,
        breaker: breakerOptions?.breaker,
        breakerScope: breakerOptions?.breakerScope,
        contents,
        grounding: imageOptions?.grounding,
        imageSize: imageOptions?.imageSize,
        prompt,
        task: task ?? 'storyboard-nano_banana_tool',
      })

      return result.imageBase64
    }

    let ImageBase64: string
    try {
      // Breaker-skip errors should fast-fail/fallback instead of burning retry backoff.
      ImageBase64 = await runGenerate(0)
    } catch (error) {
      if (isBreakerSkipError(error)) {
        throw error
      }
      ImageBase64 = await retry(async (attempt) => runGenerate(attempt + 1), {
        delay: 1000,
        factor: 2,
        retries: 2,
        timeoutMs: isNanoBanana ? 1000 * 80 : undefined,
      })
    }
    const buffer = Buffer.from(ImageBase64, 'base64')
    await writeFile(outputPath, buffer as NodeJS.ArrayBufferView)
    return outputPath
  } catch (error) {
    const sourceError = ensureError(error) as ProviderErrorLike
    const code = resolveNanoBananaErrorCode(sourceError.message)
    logger.error(
      `[nanoBananaTool] No image content returned, ${task}: ${sourceError.message}, prompt: ${prompt}`,
    )
    throw wrapNanoBananaError({ code, sourceError })
  }
}
