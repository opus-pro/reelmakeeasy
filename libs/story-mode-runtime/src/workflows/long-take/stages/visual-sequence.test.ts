import { generateKeyframesWithRetryFallback } from '../keyframe-retry-fallback'
import type { LongTakeWorkflowRuntime } from '../workflow-runtime'

import { generateKeyframes } from './visual-sequence'

jest.mock('../activity-proxies', () => ({
  saveLongTakeKeyframes: jest.fn(async () => undefined),
}))
jest.mock('../keyframe-retry-fallback', () => ({
  generateKeyframesWithRetryFallback: jest.fn(async () => ({
    fallbackCount: 0,
    keyframes: [],
    retryFailureCount: 0,
  })),
}))

describe('generateKeyframes', () => {
  it('generates keyframes on the requested image model', async () => {
    const runtime = {
      setStageCompleted: jest.fn(async () => undefined),
      setStageInProgress: jest.fn(async () => undefined),
    } as unknown as LongTakeWorkflowRuntime

    await generateKeyframes({
      imageConcurrency: 2,
      imageModel: 'requested-model',
      logInfo: jest.fn(),
      projectId: 'p1',
      runtime,
      shotPlanResult: { shotCount: 0, shotPlan: [] },
      stylizeKeyframes: false,
      userId: 'u1',
    })

    expect(generateKeyframesWithRetryFallback).toHaveBeenCalledWith(
      expect.objectContaining({ imageModel: 'requested-model', projectId: 'p1' }),
    )
  })
})
