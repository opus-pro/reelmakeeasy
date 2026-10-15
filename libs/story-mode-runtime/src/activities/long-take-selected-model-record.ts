import { generateWithSelectedModel } from '@agent-lib/agents/storyboard/utils/generate-with-selected-model'
import { type ClientImageGenerationOptions, type Content } from '@reelmakeeasy/common/llm'
import { Logger } from '@reelmakeeasy/common/logger'
import type { LongTakeAdmissionTier } from '@reelmakeeasy/common/long-take/types'
import type { AspectRatio, ImageSizeTier } from '@reelmakeeasy/common/media/types'
import { getProviderCode } from '@reelmakeeasy/common/utils/provider-error'
import { ApplicationFailure } from '@reelmakeeasy/workflow-engine/activity'
import { v4 as uuidV4 } from 'uuid'

import { resolveBreakerScope, storyModeBreaker } from './circuit-breaker'
import { asReferenceFetchFailure } from './long-take-generation-errors'
import {
  extractContentUris,
  formatError,
  recordGenerationCall,
} from './long-take-generation-record-staging'

const logger = new Logger('story-mode:selected-model-record')

/**
 * Selected-model (gate-on) twin of runImageGenerationWithRecord's
 * record-keeping. The orchestrator owns routing, fallback chains and
 * the breaker; this wrapper adds the generation records the story-mode report
 * reads (the "model | attempt N" annotation next to the latest successful
 * image prompt) and the provider metric emits.
 *
 * Records are written AFTER the orchestrator settles: its callbacks are
 * fire-and-forget (safeNotify), so awaited I/O inside them would float past
 * the end of the activity. Attempt indices are per orchestrator candidate
 * (primary = 1, each fallback +1), mirroring the legacy wrapper's numbering.
 */
export async function runSelectedModelWithRecord(params: {
  aspectRatio: AspectRatio
  contents: Content[]
  grounding?: ClientImageGenerationOptions['grounding']
  onModelUsed?: (model: string) => void
  orgId: null | string | undefined
  outputPath: string
  outputUri?: string
  projectId: string
  prompt: string
  /** Image size tier; forwarded to the selected-model orchestrator. */
  resolutionTier?: ImageSizeTier
  selectedModel: string
  shotId: string
  stage: string
  task: string
  taskId?: string
  tier?: LongTakeAdmissionTier
  userId?: string
}): Promise<string> {
  const {
    aspectRatio,
    contents,
    grounding,
    onModelUsed,
    orgId,
    outputPath,
    outputUri,
    projectId,
    prompt,
    resolutionTier,
    selectedModel,
    shotId,
    stage,
    task,
    taskId = uuidV4(),
    userId,
  } = params
  const inputRefs = extractContentUris(contents)
  const resolvedOutputRef = outputUri || outputPath
  const attempts: Array<{
    error?: unknown
    model: string
    outcome: 'failure' | 'rejected' | 'success'
  }> = []

  const writeAttemptRecords = async () => {
    for (const [index, attempt] of attempts.entries()) {
      const succeeded = attempt.outcome === 'success'
      await recordGenerationCall({
        anchorId: shotId,
        anchorType: 'shot',
        attempt: index + 1,
        // No live stack for detail-less rejections: a synthetic Error here
        // would point at this closure, not at the orchestrator's rejection
        // site, which misleads post-hoc debugging from the record.
        error: succeeded
          ? undefined
          : attempt.error
            ? formatError(attempt.error)
            : { message: `provider ${attempt.outcome} (no error detail)`, name: 'ProviderOutcome' },
        inputRefs,
        inputText: prompt,
        model: attempt.model,
        outputRefs: succeeded ? [resolvedOutputRef] : undefined,
        projectId,
        status: succeeded ? 'success' : 'failed',
        task,
        taskId,
        type: 'image',
        userId,
      })
    }
  }

  // Guards the synchronous-callback contract below: if the orchestrator ever
  // stopped invoking the callbacks before its promise settles, the report
  // would silently lose its records. Track the used model independently so a
  // success can still be recorded (with a loud warning) in that case.
  let usedModel: string | undefined

  const ensureTerminalAttemptObserved = (fallback: {
    error?: unknown
    outcome: 'failure' | 'success'
  }) => {
    const last = attempts[attempts.length - 1]
    // Success settled: the terminal observed attempt must BE that success --
    // the report only reads success records, so a lost terminal callback
    // would otherwise leave the report empty even after earlier failure
    // callbacks were observed. Failure settled: any observed attempt
    // suffices (failed records are debug-only; the report filters them out).
    const terminalObserved =
      fallback.outcome === 'success' ? last?.outcome === 'success' : last !== undefined
    if (terminalObserved) {
      return
    }
    logger.warn(
      '[runSelectedModelWithRecord] orchestrator settled without reporting its terminal attempt; ' +
        `synthesizing a ${fallback.outcome} record (selected=${selectedModel}, task=${task}, ` +
        `observedAttempts=${attempts.length})`,
    )
    attempts.push({ error: fallback.error, model: usedModel ?? selectedModel, ...fallback })
  }

  try {
    const resultPath = await generateWithSelectedModel({
      aspectRatio,
      breaker: storyModeBreaker,
      breakerScope: resolveBreakerScope(),
      contents,
      grounding,
      onModelUsed: (model) => {
        usedModel = model
        onModelUsed?.(model)
      },
      onProviderResponse: (event) => {
        // Synchronous bookkeeping only -- the orchestrator does not await this.
        attempts.push({ error: event.error, model: event.model, outcome: event.outcome })
      },
      orgId: orgId ?? null,
      outputPath,
      prompt,
      resolutionTier,
      selectedModel,
      stage,
      task,
    })
    ensureTerminalAttemptObserved({ outcome: 'success' })
    await writeAttemptRecords()
    return resultPath
  } catch (error) {
    ensureTerminalAttemptObserved({ error, outcome: 'failure' })
    await writeAttemptRecords()
    const poisoned = asReferenceFetchFailure(error, inputRefs)
    if (poisoned) {
      throw poisoned
    }
    // Every candidate refused this exact request. An activity retry reruns the
    // identical input through the identical chain, so it can only refuse again.
    const failedAttempts = attempts.filter((attempt) => attempt.outcome === 'failure')
    if (
      failedAttempts.length === attempts.length &&
      failedAttempts.length > 0 &&
      failedAttempts.every((attempt) => getProviderCode(attempt.error) === 'invalid_input')
    ) {
      throw ApplicationFailure.nonRetryable(
        `All models rejected the request as invalid input (selected=${selectedModel}, stage=${stage}).`,
        'IMAGE_GENERATION_INVALID_INPUT',
      )
    }
    throw error
  }
}
