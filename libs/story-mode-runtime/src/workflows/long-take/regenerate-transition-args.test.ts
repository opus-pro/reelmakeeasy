import {
  regenerateOutputName,
  transitionActivityArgs,
  transitionVideoPath,
} from './regenerate-transition-args'

const item = {
  endMs: 12050,
  firstFrameUri: 'store://k2.png',
  fromShotId: '2',
  lastFrameUri: 'store://k3.png',
  prompt: 'Make the astronaut wave.',
  startMs: 7060,
  toShotId: '3',
  transitionId: 'transition_1',
}

describe('regenerate transition args', () => {
  it('names a regenerated clip after its id and a stamp, under the transitions folder', () => {
    expect(regenerateOutputName('transition_1', 'k7x')).toBe('transition_1-rk7x')
    expect(transitionVideoPath('transition_1-rk7x')).toBe(
      'long_take/transitions/transition_1-rk7x.mp4',
    )
  })

  it("the agent's final prompt skips the rewrite and keeps the clip's place", () => {
    const args = transitionActivityArgs(
      {
        cameraStyle: 'dynamic',
        projectId: 'p',
        promptIsFinal: true,
        transitionList: [item],
        userId: 'u',
      },
      { ...item, outputName: 'transition_1-rk7x' },
    )
    expect(args).toMatchObject({
      cameraStyle: 'dynamic',
      dropFirstFrame: true,
      durationSeconds: 4.99,
      outputName: 'transition_1-rk7x',
      preparedPrompt: 'Make the astronaut wave.',
      prompt: 'Make the astronaut wave.',
      transitionId: 'transition_1',
    })
    expect(args.fromPrompt).toBeUndefined()
  })

  it("the editor's instruction becomes the planned motion, with the shots' scenes and narration", () => {
    const args = transitionActivityArgs(
      { projectId: 'p', transitionList: [item], userId: 'u' },
      {
        ...item,
        fromAudio: 'NASA will test the pit.',
        fromKeyframePrompt: 'An astronaut at a pit.',
        startMs: 0,
        toAudio: 'Imagine a cutaway.',
        toKeyframePrompt: 'A cutaway of rock layers.',
      },
    )
    expect(args).toMatchObject({
      dropFirstFrame: false,
      fromAudio: 'NASA will test the pit.',
      fromKeyframePrompt: 'An astronaut at a pit.',
      fromPrompt: 'Make the astronaut wave.',
      toAudio: 'Imagine a cutaway.',
      toKeyframePrompt: 'A cutaway of rock layers.',
    })
    expect(args.preparedPrompt).toBeUndefined()
    expect(args.cameraStyle).toBeUndefined()
  })
})
