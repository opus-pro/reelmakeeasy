import { ProviderError } from '@reelmakeeasy/common/utils/provider-error'
import { ActivityFailure, ApplicationFailure } from '@reelmakeeasy/workflow-engine/workflow'

import { classifyWorkflowErrorDetail, LLM_NOT_SET_UP_DETAIL } from './workflow-error-helpers'

const NONE = 'No AI is set up for writing and planning: open Setup'
const STALE = "Claude Code can't write and plan right now (Not installed): open Setup"

/** How an activity's error reaches the workflow: wrapped by the engine. */
function fromActivity(cause: Error): ActivityFailure {
  return new ActivityFailure(
    'Activity task failed',
    'generateLongTakeScript',
    '7',
    'NON_RETRYABLE_FAILURE',
    cause,
  )
}

/** libs/llm's error, as the transport throws it. */
const notSetUp = (message = NONE) => Object.assign(new Error(message), { name: 'LlmNotSetUpError' })

describe('classifyWorkflowErrorDetail', () => {
  it("names the long-take record wrapper's failure and keeps the chosen AI's reason", () => {
    // What runLongTakeCompletionWithRecord throws (phase 1 Task 1.10): no cause, only the type.
    const failure = ApplicationFailure.nonRetryable(STALE, 'LlmNotSetUpError')
    expect(classifyWorkflowErrorDetail(fromActivity(failure), 'Activity task failed')).toBe(
      `${LLM_NOT_SET_UP_DETAIL}: ${STALE}`,
    )
  })

  it('finds it through normalizeLlmError and the engine wrapping it', () => {
    const wrapped = new ProviderError({
      cause: notSetUp(),
      message: NONE,
      provider: 'llm',
      providerCode: 'task_failed',
    })
    const failure = fromActivity(ApplicationFailure.fromError(wrapped))
    expect(classifyWorkflowErrorDetail(failure, 'Activity task failed')).toBe(
      `${LLM_NOT_SET_UP_DETAIL}: ${NONE}`,
    )
  })

  it("leaves phase 3's generation failure and other failures alone", () => {
    const generation = Object.assign(
      new Error('No AI is set up to make pictures, clips and voices: open Setup'),
      { name: 'GenerationNotSetUpError' },
    )
    expect(
      classifyWorkflowErrorDetail(fromActivity(ApplicationFailure.fromError(generation)), 'x'),
    ).toBe('x')
    expect(
      classifyWorkflowErrorDetail(
        fromActivity(ApplicationFailure.fromError(new Error('fal 500'))),
        'y',
      ),
    ).toBe('y')
  })

  it('keeps TTS_FAILED and the fallback as before', () => {
    const tts = fromActivity(ApplicationFailure.nonRetryable('voice failed', 'TTS_FAILED'))
    expect(classifyWorkflowErrorDetail(tts, 'x')).toBe('TTS_FAILED')
    expect(classifyWorkflowErrorDetail(new Error('boom'), 'boom')).toBe('boom')
  })
})
