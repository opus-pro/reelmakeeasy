import { type CompletionOptions } from '@reelmakeeasy/common/llm'
import { Logger } from '@reelmakeeasy/common/logger'
import type { LongTakeAdmissionTier } from '@reelmakeeasy/common/long-take/types'
import type { AspectRatio, VideoResolution } from '@reelmakeeasy/common/media/types'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import { type GenVideoOutput, resolveVideoProvider } from '@reelmakeeasy/common/veo3/gen-video'
import { isSeedance25Model } from '@reelmakeeasy/common/veo3/model'
import { getVideoModelFallbackChain } from '@reelmakeeasy/common/veo3/video-model-selection'
import { videoPromptMaxChars } from '@reelmakeeasy/common/video-models/registry'
import { LLM } from '@reelmakeeasy/llm'
import { resolveRole } from '@reelmakeeasy/llm/registry'
import { ApplicationFailure } from '@reelmakeeasy/workflow-engine/activity'
import { v4 as uuidV4 } from 'uuid'
import { z } from 'zod'

import {
  enforceTransitionPromptCharacterLimit,
  rewritePromptForSeedance2,
  shouldRunSeedance2PromptRewrite,
} from './long-take/common'
import { formatPipelineContext } from './long-take/pipeline-context'
import { resolveBreakerScope, storyModeBreaker } from './circuit-breaker'
import { normalizeLlmError } from './long-take-generation-errors'
import {
  extractContentUris,
  formatError,
  formatLogFields,
  getCompletionModelLabel,
  getDefaultTransitionVideoModel,
  recordGenerationCall,
  resolvePrimaryFailureFallbackModel,
  selectTransitionVideoGenerator,
  toRecordText,
  toTransitionClipResult,
  type TransitionClipResult,
} from './long-take-generation-record-staging'
import {
  requireTransitionVideoOutput,
  resolveTransitionVideoModelForRequest,
} from './long-take-transition-video-request'

export { runImageGenerationWithRecord } from './long-take-image-generation-record'

const logger = new Logger('story-mode:long-take-generation-record')
const SEEDANCE25_EXTRA_IMAGE_REFERENCE_LINE_REGEX =
  /^\s*(?:[-*]\s*)?(?:.*@Image(?:[3-9]|\d{2,})(?:\+|\b).*|Pass through each waypoint frame's composition.*)$/i

/**
 * Normalize an LLM error to ProviderError so that policy blocks are detectable
 * by the workflow after activity error serialization.
 *
 * Handles:
 *   - SafetyBlockError from Gemini -> policy_blocked
 *   - AllModelsFailedError wrapping a SafetyBlockError -> policy_blocked
 *   - All other errors -> message-based ProviderCode detection, fallback task_failed
 */
type RunGenerateFn = (params: {
  attempt: number
  modelOverride?: string
  usedPrompt: string
}) => Promise<GenVideoOutput[]>

type TransitionGenerationRecoveryResult =
  | { currentPrompt: string; kind: 'outputs'; outputs: Awaited<ReturnType<RunGenerateFn>> }
  | { kind: 'clip'; result: TransitionClipResult }

export async function generateTransitionVideoClipWithRecord(params: {
  aspectRatio?: AspectRatio
  defaultAspectRatio: AspectRatio
  firstFramePath: string
  firstFrameUri?: string
  isImageSensitiveError?: (error: unknown) => boolean
  isSensitivePromptError: (error: unknown) => boolean
  /** Absent for a Story Mode 3.0 `cut` clip, generated i2v-only. */
  lastFramePath?: string
  lastFrameUri?: string
  /** Org id for config-first runtime fallback resolution. */
  orgId?: string
  projectId: string
  prompt: string
  referenceImageUrls?: string[]
  /** Effective video resolution, already clamped at the primary model; reused by every fallback chain. */
  resolution?: VideoResolution
  rewritePromptForSafety: (prompt: string, projectId: string) => Promise<string>
  safeDuration: number
  /** Set when the caller has already run rewritePromptForSeedance2 for this transition. */
  seedance2PromptAlreadyRewritten?: boolean
  taskId?: string
  tempDir: string
  tier?: LongTakeAdmissionTier
  transitionId: string
  transitionUri?: string
  transitionVideoModel?: string
  userEmail?: string
  userId?: string
}): Promise<TransitionClipResult> {
  const {
    aspectRatio,
    defaultAspectRatio,
    firstFrameUri,
    firstFramePath,
    isImageSensitiveError,
    isSensitivePromptError,
    lastFrameUri,
    lastFramePath,
    orgId,
    projectId,
    prompt,
    referenceImageUrls,
    resolution,
    rewritePromptForSafety,
    safeDuration,
    seedance2PromptAlreadyRewritten,
    taskId = uuidV4(),
    tempDir,
    transitionId,
    transitionUri,
    transitionVideoModel,
    userId,
  } = params
  // API override takes highest priority
  const {
    model: resolvedTransitionVideoModel,
    configuredModel,
    modelSource,
  } = resolveTransitionVideoModelForRequest({ transitionVideoModel })
  logger.info(
    `[long-take] Transition video model resolved ${formatLogFields({
      configuredTransitionVideoModel: configuredModel,
      modelSource,
      projectId,
      resolvedTransitionVideoModel,
      transitionId,
    })}`,
  )
  const transitionTask = 'long-take-transition'
  const breakerScope = resolveBreakerScope()
  const transitionInputRefs = [
    firstFrameUri || firstFramePath,
    lastFrameUri || lastFramePath,
  ].filter((value): value is string => Boolean(value))
  const runGenerate = async (params: {
    attempt: number
    modelOverride?: string
    usedPrompt: string
  }) => {
    const { attempt, modelOverride, usedPrompt } = params
    const requestedModel = modelOverride || resolvedTransitionVideoModel
    // Reference-image generation runs on the video.reference role; with that
    // role disabled (the default) every clip takes the first-last path.
    const referenceModel = referenceImageUrls?.length ? resolveRole('video.reference') : null
    const referenceImageUrlsForModel = referenceModel ? referenceImageUrls : undefined
    const inputRefs = referenceImageUrlsForModel?.length
      ? referenceImageUrlsForModel
      : transitionInputRefs

    try {
      const outputs = referenceModel
        ? await generateReferenceTransitionVideo({
            breakerScope,
            duration: safeDuration,
            imageUrls: referenceImageUrlsForModel,
            model: referenceModel.key,
            outputDir: tempDir,
            prompt: usedPrompt,
            resolution,
            targetFilePath: transitionId,
            tempDir,
          })
        : await selectTransitionVideoGenerator(requestedModel)(
            {
              aspectRatio: aspectRatio ?? defaultAspectRatio,
              debugOutputDir: tempDir,
              duration: safeDuration,
              firstFramePath,
              lastFramePath,
              model: requestedModel,
              outputDir: tempDir,
              prompt: usedPrompt,
              resolution,
              sampleCount: 1,
              targetFilePaths: [transitionId],
            },
            'long-take-transition',
            { breaker: storyModeBreaker, breakerScope },
          )
      const output = requireTransitionVideoOutput(outputs, transitionId)
      // Use the actual model from router (may differ if breaker triggered fallback)
      const actualModel = output.resolvedModel || requestedModel
      await recordGenerationCall({
        anchorId: transitionId,
        anchorType: 'transition',
        attempt,
        inputRefs,
        inputText: usedPrompt,
        model: actualModel,
        outputRefs: [transitionUri || output.path],
        projectId,
        status: 'success',
        task: transitionTask,
        taskId,
        type: 'video',
        userId,
      })
      return outputs
    } catch (error) {
      // Detect breaker rejection from generateVideo ("all providers open")
      const isBreakerReject =
        error instanceof Error &&
        error.message.includes('All video providers have circuit breaker open')
      if (!isBreakerReject) {
        // Use actual model from router error if available (breaker may have triggered fallback)
        const failModel =
          (error as Error & { resolvedModel?: string })?.resolvedModel || requestedModel
        await recordGenerationCall({
          anchorId: transitionId,
          anchorType: 'transition',
          attempt,
          error: formatError(error),
          inputRefs,
          inputText: usedPrompt,
          model: failModel,
          projectId,
          status: 'failed',
          task: transitionTask,
          taskId,
          type: 'video',
          userId,
        })
      }
      // Wrap breaker rejections as non-retryable to fast-fail
      throw isBreakerReject
        ? ApplicationFailure.nonRetryable(error.message, 'circuit_breaker_open')
        : error
    }
  }

  // Proactive Seedance 2.0 prompt optimization
  let currentPrompt = prompt
  if (
    shouldRunSeedance2PromptRewrite({
      model: resolvedTransitionVideoModel,
      promptAlreadyRewritten: seedance2PromptAlreadyRewritten,
    })
  ) {
    currentPrompt = await rewritePromptForSeedance2({
      durationSeconds: safeDuration,
      firstFramePath,
      firstFrameUri,
      lastFramePath,
      lastFrameUri,
      projectId,
      prompt: currentPrompt,
      transitionVideoModel: resolvedTransitionVideoModel,
      userId,
    })
  }

  let outputs: Awaited<ReturnType<typeof runGenerate>>
  try {
    outputs = await runGenerate({ attempt: 1, usedPrompt: currentPrompt })
  } catch (error) {
    logger.error(
      { error: ensureError(error) },
      '[long-take] Transition video generation failed at attempt 1',
    )

    const recovery = await recoverTransitionVideoGenerationFailure({
      currentPrompt,
      error,
      isImageSensitiveError,
      isSensitivePromptError,
      orgId,
      projectId,
      resolvedTransitionVideoModel,
      rewritePromptForSafety,
      runGenerate,
      safeDuration,
      transitionId,
    })
    if (recovery.kind === 'clip') {
      return recovery.result
    }
    currentPrompt = recovery.currentPrompt
    outputs = recovery.outputs
  }

  return toTransitionClipResult(outputs[0], resolvedTransitionVideoModel)
}

export async function runLongTakeCompletionWithRecord<T extends z.ZodTypeAny>(params: {
  anchorId?: string
  anchorType?: string
  options: CompletionOptions<T>
  /** Prepend the accumulated pipeline context to the prompt (default true). */
  pipelineContext?: boolean
  projectId: string
  taskId?: string
  userId?: string
}): Promise<z.infer<T>> {
  const { anchorId, anchorType, projectId, userId } = params
  const taskId = params.taskId || uuidV4()

  // Pipeline context injection: prepend accumulated context to prompt
  let options = params.options
  const contextText = params.pipelineContext === false ? null : formatPipelineContext()
  if (contextText) {
    options = { ...options, prompt: `${contextText}\n\n${options.prompt}` }
  }

  try {
    const { model: resolvedModel, result: response } = await LLM.completionWithMeta(options)
    await recordGenerationCall({
      anchorId,
      anchorType,
      attempt: 1,
      inputRefs: extractContentUris(options.contents),
      inputText: options.prompt,
      model: resolvedModel,
      outputText: toRecordText(response),
      projectId,
      status: 'success',
      task: options.task,
      taskId,
      type: 'llm',
      userId,
    })
    return response
  } catch (error) {
    await recordGenerationCall({
      anchorId,
      anchorType,
      attempt: 1,
      error: formatError(error),
      inputRefs: extractContentUris(options.contents),
      inputText: options.prompt,
      model: getCompletionModelLabel(options.models),
      projectId,
      status: 'failed',
      task: options.task,
      taskId,
      type: 'llm',
      userId,
    })
    // No AI is set up for writing and planning: retrying the activity can't help, so the
    // workflow fails it now with the plain-words reason.
    if (ensureError(error).name === 'LlmNotSetUpError') {
      throw ApplicationFailure.nonRetryable(ensureError(error).message, 'LlmNotSetUpError')
    }
    throw normalizeLlmError(error, 'llm')
  }
}

function assertSensitivePromptError(
  error: unknown,
  isSensitivePromptError: (error: unknown) => boolean,
): void {
  if (!isSensitivePromptError(error)) {
    throw error
  }
}

async function assertVideoBreakerClosed(params: {
  breakerScope: string
  model: string
}): Promise<void> {
  const provider = resolveVideoProvider(params.model)
  const id = `${params.breakerScope}:${provider}`
  const result = await storyModeBreaker.check(id, { provider, model: params.model })
  if (result.allowed) {
    return
  }
  throw ApplicationFailure.nonRetryable(
    `[long-take] Video provider circuit breaker ${result.reason}`,
    'circuit_breaker_open',
  )
}

async function generateReferenceTransitionVideo(params: {
  breakerScope: string
  duration: number
  imageUrls?: string[]
  model: string
  outputDir: string
  prompt: string
  resolution?: VideoResolution
  targetFilePath: string
  tempDir: string
}): ReturnType<RunGenerateFn> {
  if (!params.imageUrls?.length) {
    throw new Error('Reference-to-video requires reference images')
  }

  await assertVideoBreakerClosed({
    breakerScope: params.breakerScope,
    model: params.model,
  })

  const output = await LLM.generateVideo({
    aspectRatio: 'adaptive',
    debugOutputDir: params.tempDir,
    debugOutputPrefix: params.targetFilePath,
    durationSeconds: params.duration,
    imageUrls: params.imageUrls,
    models: [params.model],
    role: 'video.reference',
    outputPath: `${params.outputDir}/${params.targetFilePath}.mp4`,
    prompt: params.prompt,
    resolution: params.resolution,
    task: 'long-take-transition',
  })

  return [{ ...output, resolvedModel: params.model }]
}

/**
 * After a transition clip fails: the primary's fallback model, then the image-safety
 * fallback or a safety rewrite of the prompt. Exported for tests.
 */
export async function recoverTransitionVideoGenerationFailure(params: {
  currentPrompt: string
  error: unknown
  isImageSensitiveError?: (error: unknown) => boolean
  isSensitivePromptError: (error: unknown) => boolean
  orgId?: string
  projectId: string
  resolvedTransitionVideoModel: string
  rewritePromptForSafety: (prompt: string, projectId: string) => Promise<string>
  runGenerate: RunGenerateFn
  safeDuration: number
  transitionId: string
}): Promise<TransitionGenerationRecoveryResult> {
  const {
    currentPrompt,
    error,
    isImageSensitiveError,
    isSensitivePromptError,
    orgId,
    projectId,
    resolvedTransitionVideoModel,
    runGenerate,
    transitionId,
  } = params

  // The alternate-model chain runs for every model, Seedance 2.5 included:
  // a fallback model with a shorter cap produces a clamped clip
  // that retimeTransitionVideoIfNeeded stretches back to the slot, so
  // duration mismatches are absorbed downstream rather than gated here.
  const fallbackResult = await tryPrimaryFailureModelFallback({
    currentPrompt,
    errorForSafetyCheck: error,
    nextAttempt: 2,
    orgId,
    projectId,
    resolvedTransitionVideoModel,
    runGenerate,
    transitionId,
  })
  if (fallbackResult.kind === 'clip') {
    return fallbackResult
  }
  // tryPrimaryFailureModelFallback replaces the original error with the fallback
  // model's error on a miss, which loses the original provider's moderation verdict
  // (e.g. Vidu AuditSubmitIllegal) once a non-moderation fallback error (e.g. a plain
  // kling-3.0 422) takes its place. Recover it, prioritizing by KIND rather than by
  // which attempt produced it: an image-side block cannot be resolved by rewriting
  // the prompt (the retry would resubmit the same blocked frames), so an image
  // verdict from either candidate outranks a prompt verdict from either candidate.
  // Only when neither candidate is a moderation block does the fallback's own error
  // fall through unchanged, matching today's non-moderation behavior exactly.
  const candidatesForSafetyCheck = [error, fallbackResult.errorForSafetyCheck]
  const errorForSafetyCheck =
    candidatesForSafetyCheck.find((candidate) => isImageSensitiveError?.(candidate) === true) ??
    candidatesForSafetyCheck.find((candidate) => isSensitivePromptError(candidate)) ??
    fallbackResult.errorForSafetyCheck
  const nextAttempt = fallbackResult.nextAttempt

  if (isImageSensitiveError?.(errorForSafetyCheck)) {
    return {
      kind: 'clip',
      result: await runImageSensitiveFallback({
        nextAttempt,
        projectId,
        resolvedTransitionVideoModel,
        runGenerate,
        transitionId,
        usedPrompt: currentPrompt,
      }),
    }
  }

  assertSensitivePromptError(errorForSafetyCheck, isSensitivePromptError)
  const rewrittenPrompt = await params.rewritePromptForSafety(currentPrompt, projectId)
  try {
    const outputs = await runGenerate({ attempt: nextAttempt, usedPrompt: rewrittenPrompt })
    return { currentPrompt: rewrittenPrompt, kind: 'outputs', outputs }
  } catch (secondError) {
    logger.error(
      { error: ensureError(secondError) },
      `[long-take] Transition video generation failed at attempt ${nextAttempt}`,
    )
    if (!isSensitivePromptError(secondError)) {
      throw secondError
    }
    // Last resort: the rewritten prompt on the primary's registry fallback.
    const sensitivePromptFallbackModel = resolvePrimaryFailureFallbackModel(
      resolvedTransitionVideoModel,
    )
    if (!sensitivePromptFallbackModel) {
      throw secondError
    }
    const outputs = await runGenerate({
      attempt: nextAttempt + 1,
      usedPrompt: rewrittenPrompt,
      modelOverride: sensitivePromptFallbackModel,
    })
    return { currentPrompt: rewrittenPrompt, kind: 'outputs', outputs }
  }
}

function resolveFallbackPrompt(params: {
  currentPrompt: string
  fallbackModel: string
  projectId: string
  transitionId: string
}): string {
  const { currentPrompt, fallbackModel, projectId, transitionId } = params
  const promptForModel = isSeedance25Model(fallbackModel)
    ? currentPrompt
    : stripSeedance25ExtraImageReferenceInstructions(currentPrompt)
  if (promptForModel.length < currentPrompt.length) {
    logger.info(
      `[long-take] Removed Seedance 2.5-only image references from fallback prompt ${formatLogFields(
        {
          fallbackModel,
          originalLength: currentPrompt.length,
          projectId,
          transitionId,
          rewrittenLength: promptForModel.length,
        },
      )}`,
    )
  }
  const maxChars = videoPromptMaxChars(fallbackModel)
  const trimmed = enforceTransitionPromptCharacterLimit(promptForModel, maxChars)
  if (trimmed.length < promptForModel.length) {
    logger.info(
      `[long-take] Trimmed transition prompt for fallback model ${formatLogFields({
        fallbackModel,
        maxChars,
        originalLength: promptForModel.length,
        projectId,
        transitionId,
        trimmedLength: trimmed.length,
      })}`,
    )
  }
  return trimmed
}

async function runImageSensitiveFallback(params: {
  nextAttempt: number
  projectId: string
  resolvedTransitionVideoModel: string
  runGenerate: RunGenerateFn
  transitionId: string
  usedPrompt: string
}): Promise<TransitionClipResult> {
  // The default model, then its registry fallbacks, skipping the primary:
  // retrying the same model on the same sensitive image is pointless. Note
  // kling pro is a distinct endpoint from kling standard, so an API-override
  // primary of kling pro still retries kling standard here.
  // No duration filter: a shorter-capped fallback yields a clamped clip that
  // retimeTransitionVideoIfNeeded stretches back to the slot.
  const defaultModel = getDefaultTransitionVideoModel()
  const chain = [...new Set([defaultModel, ...getVideoModelFallbackChain(defaultModel)])].filter(
    (model) => model !== params.resolvedTransitionVideoModel,
  )
  logger.warn(
    `[long-take] Image-level sensitive content detected, skipping rewrite ${formatLogFields({
      fallbackChain: chain,
      projectId: params.projectId,
      transitionId: params.transitionId,
    })}`,
  )
  let lastError: unknown
  for (const [i, fallbackModel] of chain.entries()) {
    const fallbackUsedPrompt = resolveFallbackPrompt({
      currentPrompt: params.usedPrompt,
      fallbackModel,
      projectId: params.projectId,
      transitionId: params.transitionId,
    })
    try {
      const outputs = await params.runGenerate({
        attempt: params.nextAttempt + i,
        modelOverride: fallbackModel,
        usedPrompt: fallbackUsedPrompt,
      })
      return toTransitionClipResult(outputs[0], fallbackModel)
    } catch (imageFallbackError) {
      logger.error(
        { error: ensureError(imageFallbackError), fallbackModel },
        '[long-take] Image-sensitive fallback attempt failed',
      )
      lastError = imageFallbackError
    }
  }
  throw ensureError(lastError)
}

function stripSeedance25ExtraImageReferenceInstructions(prompt: string): string {
  const lines = prompt.split('\n')
  const filteredLines = lines.filter(
    (line) => !SEEDANCE25_EXTRA_IMAGE_REFERENCE_LINE_REGEX.test(line),
  )
  if (filteredLines.length === lines.length) {
    return prompt
  }
  return filteredLines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

async function tryPrimaryFailureModelFallback(params: {
  currentPrompt: string
  errorForSafetyCheck: unknown
  nextAttempt: number
  orgId?: string
  projectId: string
  resolvedTransitionVideoModel: string
  runGenerate: RunGenerateFn
  transitionId: string
}): Promise<
  | { errorForSafetyCheck: unknown; kind: 'miss'; nextAttempt: number }
  | { kind: 'clip'; result: TransitionClipResult }
> {
  const primaryFailureFallbackModel = resolvePrimaryFailureFallbackModel(
    params.resolvedTransitionVideoModel,
  )
  if (!primaryFailureFallbackModel) {
    return {
      errorForSafetyCheck: params.errorForSafetyCheck,
      kind: 'miss',
      nextAttempt: params.nextAttempt,
    }
  }

  logger.warn(
    `[long-take] Primary transition model failed, falling back ${formatLogFields({
      fallbackModel: primaryFailureFallbackModel,
      projectId: params.projectId,
      resolvedTransitionVideoModel: params.resolvedTransitionVideoModel,
      transitionId: params.transitionId,
    })}`,
  )
  const fallbackUsedPrompt = resolveFallbackPrompt({
    currentPrompt: params.currentPrompt,
    fallbackModel: primaryFailureFallbackModel,
    projectId: params.projectId,
    transitionId: params.transitionId,
  })
  try {
    const fallbackOutputs = await params.runGenerate({
      attempt: params.nextAttempt,
      modelOverride: primaryFailureFallbackModel,
      usedPrompt: fallbackUsedPrompt,
    })
    return {
      kind: 'clip',
      result: toTransitionClipResult(fallbackOutputs[0], primaryFailureFallbackModel),
    }
  } catch (fallbackError) {
    logger.error(
      { error: ensureError(fallbackError) },
      '[long-take] Primary-failure fallback also failed',
    )
    return {
      errorForSafetyCheck: fallbackError,
      kind: 'miss',
      nextAttempt: params.nextAttempt + 1,
    }
  }
}
