import { ProviderError } from '@reelmakeeasy/common/utils/provider-error'
import { LlmNotSetUpError, setChatTransportResolver } from '@reelmakeeasy/llm'
import { ApplicationFailure } from '@reelmakeeasy/workflow-engine/activity'
import { z } from 'zod'

import { runLongTakeCompletionWithRecord } from './long-take-generation-record'

const mockRecord = jest.fn()
jest.mock('./long-take-generation-record-staging', () => ({
  ...jest.requireActual('./long-take-generation-record-staging'),
  recordGenerationCall: (...args: unknown[]) => mockRecord(...args),
}))

/** One LLM call through the record wrapper, its transport failing with `error`. */
function callFailingWith(error: Error) {
  setChatTransportResolver(() => ({ name: 'test', send: () => Promise.reject(error) }))
  return runLongTakeCompletionWithRecord({
    options: { models: ['flash', 'pro'], prompt: 'hi', responseFormat: z.string(), task: 'test' },
    pipelineContext: false,
    projectId: 'p1',
  })
}

describe('runLongTakeCompletionWithRecord failures', () => {
  beforeEach(() => mockRecord.mockReset().mockResolvedValue(undefined))
  afterEach(() => setChatTransportResolver(null))

  it('fails the activity for good when no AI is set up, keeping the reason', async () => {
    const call = callFailingWith(new LlmNotSetUpError('No AI is set up: open Setup'))
    await expect(call).rejects.toBeInstanceOf(ApplicationFailure)
    await expect(call).rejects.toMatchObject({
      message: 'No AI is set up: open Setup',
      nonRetryable: true,
      type: 'LlmNotSetUpError',
    })
    expect(mockRecord).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }))
  })

  it('still wraps any other failure as a retryable ProviderError', async () => {
    await expect(callFailingWith(new Error('boom'))).rejects.toBeInstanceOf(ProviderError)
  })
})
