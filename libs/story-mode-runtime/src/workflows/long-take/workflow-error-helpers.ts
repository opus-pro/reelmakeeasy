import type { LongTakeAdmissionTier } from '@reelmakeeasy/common/long-take/types'
import { findLlmNotSetUp } from '@reelmakeeasy/common/utils/llm-not-set-up'
import {
  ActivityFailure,
  ApplicationFailure,
  workflowInfo,
} from '@reelmakeeasy/workflow-engine/workflow'

import { isPolicyBlockedError, isViduModerationBlockError } from './policy-block'
import type { LongTakeWorkflowLogFn, LongTakeWorkflowRuntime } from './workflow-runtime'

export async function handleWorkflowError(params: {
  admissionTier?: LongTakeAdmissionTier
  error: unknown
  logError: LongTakeWorkflowLogFn
  projectId: string
  runtime: LongTakeWorkflowRuntime
  workflowStartedAt: number
}): Promise<void> {
  const { admissionTier, error, logError, projectId, runtime, workflowStartedAt } = params
  const message = error instanceof Error ? error.message : String(error)
  const elapsedMs = Date.now() - workflowStartedAt
  const stage = runtime.getCurrentStage()
  const workflowId = workflowInfo().workflowId
  const isNonSpeechRejected = isNonSpeechAudioError(error)
  // Vidu's AuditSubmitIllegal counts as a policy block too.
  const isPolicyRejected = isPolicyBlockedError(error) || isViduModerationBlockError(error)
  const isRejected = isNonSpeechRejected || isPolicyRejected

  logError(
    isNonSpeechRejected
      ? 'longTakeWorkflow rejected (non-speech audio)'
      : isRejected
        ? 'longTakeWorkflow rejected (policy block)'
        : 'longTakeWorkflow failed',
    {
      elapsedMs,
      errorMessage: message,
      stage,
    },
  )

  await runtime.releaseSlot({ admissionTier, projectId, workflowId })
  if (isRejected) {
    await runtime.setWorkflowRejected(
      isNonSpeechRejected ? 'NON_SPEECH_AUDIO' : cleanPolicyBlockRejectionDetail(message),
    )
  } else {
    await runtime.setWorkflowError(classifyWorkflowErrorDetail(error, message))
  }
}

export function isNonSpeechAudioError(error: unknown): boolean {
  if (error instanceof ActivityFailure && error.cause instanceof ApplicationFailure) {
    return error.cause.type === 'NON_SPEECH_AUDIO'
  }
  return false
}

export function isPoisonedReferenceFailure(error: unknown): boolean {
  if (error instanceof ActivityFailure && error.cause instanceof ApplicationFailure) {
    return error.cause.type === 'REFERENCE_FETCH_FAILED'
  }
  return false
}

export function isTtsFailedError(error: unknown): boolean {
  if (error instanceof ActivityFailure && error.cause instanceof ApplicationFailure) {
    return error.cause.type === 'TTS_FAILED'
  }
  return false
}

// An ActivityFailure only ever says "Activity task failed"; the activity
// type plus the wrapped cause is what identifies the failure downstream.
export function unwrapActivityFailure(
  error: unknown,
): null | { activityType: string; cause: Error } {
  if (error instanceof ActivityFailure && error.cause instanceof Error) {
    return { activityType: error.activityType, cause: error.cause }
  }
  return null
}

/** The status detail of a failed video whose LLM step had no AI to run on. The reason (phase
 *  1's words) follows after ": " when the failure carries one. */
export const LLM_NOT_SET_UP_DETAIL = 'LLM_NOT_SET_UP'

// Shared by the long-take and uip-to-story-mode catch paths so the TTS_FAILED and
// LLM_NOT_SET_UP classification stays in one place.
export function classifyWorkflowErrorDetail(error: unknown, fallback: string): string {
  if (isTtsFailedError(error)) return 'TTS_FAILED'
  const notSetUp = findLlmNotSetUp(error)
  if (!notSetUp) return fallback
  const reason = notSetUp.message.trim()
  return reason ? `${LLM_NOT_SET_UP_DETAIL}: ${reason}` : LLM_NOT_SET_UP_DETAIL
}

const VIDU_TASK_FAILED_MESSAGE_PREFIX = 'Vidu task failed:'

// Vidu's raw message is the entire provider response JSON. Ark and Google
// policy-block messages are already human-readable and must pass through
// unchanged, so only the Vidu-shaped message is rewritten.
export function cleanPolicyBlockRejectionDetail(message: string): string {
  return message.startsWith(VIDU_TASK_FAILED_MESSAGE_PREFIX)
    ? 'Content blocked by provider moderation review.'
    : message
}
