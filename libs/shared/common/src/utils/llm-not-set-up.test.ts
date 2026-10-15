import { findLlmNotSetUp, isLlmNotSetUpError, LLM_NOT_SET_UP_TYPE } from './llm-not-set-up'
import { ProviderError } from './provider-error'

const NONE = 'No AI is set up for writing and planning: open Setup'
const STALE = "Claude Code can't write and plan right now (Not installed): open Setup"

/** libs/llm's error, as the transport throws it. */
const notSetUp = (message = NONE) =>
  Object.assign(new Error(message), { name: LLM_NOT_SET_UP_TYPE })

/** The shape of `ApplicationFailure.nonRetryable(message, type)`: no cause, the type set. */
const applicationFailure = (message: string, type: string) =>
  Object.assign(new Error(message), { name: 'ApplicationFailure', type })

describe('findLlmNotSetUp', () => {
  it('finds the error itself and returns it, with its words', () => {
    const error = notSetUp(STALE)
    expect(findLlmNotSetUp(error)).toBe(error)
  })

  it('finds it under normalizeLlmError and an outer wrapper', () => {
    const cause = notSetUp()
    const wrapped = new ProviderError({
      cause,
      message: cause.message,
      provider: 'llm',
      providerCode: 'task_failed',
    })
    expect(wrapped.message).toBe(`[task_failed] ${NONE}`)
    expect(findLlmNotSetUp(new Error('Activity task failed', { cause: wrapped }))).toBe(cause)
  })

  it("finds the long-take record wrapper's failure by its type, keeping the reason", () => {
    const failure = applicationFailure(STALE, LLM_NOT_SET_UP_TYPE)
    const found = findLlmNotSetUp(new Error('Activity task failed', { cause: failure }))
    expect(found?.message).toBe(STALE)
  })

  it("ignores phase 3's generation message and every other failure", () => {
    const generation = Object.assign(
      new Error('No AI is set up to make pictures, clips and voices: open Setup'),
      { name: 'GenerationNotSetUpError' },
    )
    expect(isLlmNotSetUpError(generation)).toBe(false)
    expect(isLlmNotSetUpError(applicationFailure('voice failed', 'TTS_FAILED'))).toBe(false)
    expect(isLlmNotSetUpError(new Error('fal returned 500'))).toBe(false)
    expect(isLlmNotSetUpError(NONE)).toBe(false)
    expect(isLlmNotSetUpError(undefined)).toBe(false)
  })
})
