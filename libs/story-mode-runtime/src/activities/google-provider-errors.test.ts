import { getFailureClass } from '@reelmakeeasy/common/utils/failure-class'
import { isProviderHealthFailure, ProviderError } from '@reelmakeeasy/common/utils/provider-error'
import { GoogleApiError, googleHttpError, inlineParts } from '@reelmakeeasy/llm'

import { isImageSensitiveError, isSensitivePromptError } from './long-take/common'
import { recoverTransitionVideoGenerationFailure } from './long-take-generation-record'

// No model fallback, so a safety block goes straight to the prompt rewrite.
jest.mock('./long-take-generation-record-staging', () => ({
  ...jest.requireActual('./long-take-generation-record-staging'),
  resolvePrimaryFailureFallbackModel: () => undefined,
}))

/** The GoogleApiError a Gemini answer turns into. */
function blocked(reason: string): GoogleApiError {
  try {
    inlineParts({ promptFeedback: { blockReason: reason } }, 'image')
  } catch (error) {
    if (error instanceof GoogleApiError) return error
  }
  throw new Error('expected a GoogleApiError')
}

describe('Gemini errors in the pipeline', () => {
  it('a blocked prompt takes the safety-rewrite path, a blocked picture the image path', () => {
    expect(isSensitivePromptError(blocked('SAFETY'))).toBe(true)
    expect(isImageSensitiveError(blocked('SAFETY'))).toBe(false)
    expect(isImageSensitiveError(blocked('IMAGE_SAFETY'))).toBe(true)
    expect(isSensitivePromptError(blocked('IMAGE_SAFETY'))).toBe(false)
  })

  it('a quota error is a rate limit, and blocks do not count against provider health', () => {
    const quota = googleHttpError('model veo', 429, 'Resource has been exhausted')
    expect(getFailureClass(quota)).toBe('rate_limit')
    expect(ProviderError.fromUnknown(quota, 'veo')).toMatchObject({
      httpStatus: 429,
      provider: 'google',
      providerCode: 'rate_limit',
    })
    expect(isProviderHealthFailure(blocked('SAFETY'))).toBe(false)
    expect(isProviderHealthFailure(googleHttpError('model veo', 500, 'boom'))).toBe(true)
  })

  it('rewrites the prompt after a Veo safety block, then makes the clip', async () => {
    const runGenerate = jest.fn().mockResolvedValue([{ path: '/tmp/clip.mp4' }])
    const rewritePromptForSafety = jest.fn().mockResolvedValue('a calm, safe prompt')
    const result = await recoverTransitionVideoGenerationFailure({
      currentPrompt: 'the original prompt',
      error: blocked('SAFETY'),
      isImageSensitiveError,
      isSensitivePromptError,
      projectId: 'p1',
      resolvedTransitionVideoModel: 'veo-3.1-fast-google',
      rewritePromptForSafety,
      runGenerate,
      safeDuration: 6,
      transitionId: 't1',
    })
    expect(rewritePromptForSafety).toHaveBeenCalledWith('the original prompt', 'p1')
    expect(runGenerate).toHaveBeenCalledWith({ attempt: 2, usedPrompt: 'a calm, safe prompt' })
    expect(result).toMatchObject({ currentPrompt: 'a calm, safe prompt', kind: 'outputs' })
  })
})
