import { mergeRegeneratedTransitions } from './commit-regenerated-transitions'

describe('mergeRegeneratedTransitions', () => {
  const stored = [
    {
      endMs: 5000,
      fromShotId: '1',
      prompt: 'old a',
      startMs: 0,
      toShotId: '2',
      transitionId: 'transition_0',
      videoUri: 'store://t0.mp4',
    },
    {
      endMs: 9000,
      fromShotId: '2',
      prompt: 'old b',
      startMs: 5000,
      toShotId: '3',
      transitionId: 'transition_1',
      videoUri: 'store://t1.mp4',
    },
  ]

  it('replaces the regenerated clip and keeps the others in order', () => {
    const merged = mergeRegeneratedTransitions(stored, [
      {
        endMs: 9000,
        fromShotId: '2',
        prompt: 'new b',
        startMs: 5000,
        toShotId: '3',
        transitionId: 'transition_1',
        videoHeight: 1344,
        videoUri: 'store://t1-v2.mp4',
        videoWidth: 768,
      },
    ])
    expect(merged.map((t) => t.transitionId)).toEqual(['transition_0', 'transition_1'])
    expect(merged[1]).toMatchObject({
      prompt: 'new b',
      videoHeight: 1344,
      videoUri: 'store://t1-v2.mp4',
      videoWidth: 768,
    })
    expect(merged[0]).toEqual(stored[0])
  })

  it('ignores a result whose id is not stored', () => {
    const merged = mergeRegeneratedTransitions(stored, [
      {
        endMs: 1,
        fromShotId: 'x',
        prompt: 'p',
        startMs: 0,
        toShotId: 'y',
        transitionId: 'transition_9',
        videoUri: 'store://t9.mp4',
      },
    ])
    expect(merged).toEqual(stored)
  })
})
