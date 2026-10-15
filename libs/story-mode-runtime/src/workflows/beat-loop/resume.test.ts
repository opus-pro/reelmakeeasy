import type { BeatLoopQaFile, BeatLoopTake } from '../../activities/beat-loop'

import { planBeatLoopResume } from './resume'

const CLIP_IDS = ['c1', 'c2', 'c3', 'c4']

function record(
  clips: {
    clipIndex?: number
    flagged?: boolean
    generation?: number
    keepAfterRedo?: boolean
    keptTake?: number
    takes: BeatLoopTake[]
  }[],
): BeatLoopQaFile {
  return {
    clips: clips.map((clip) => ({
      clipId: CLIP_IDS[clip.clipIndex ?? clip.takes[0].clipIndex],
      clipIndex: clip.clipIndex ?? clip.takes[0].clipIndex,
      ...(clip.flagged === undefined ? {} : { flagged: clip.flagged }),
      ...(clip.generation === undefined ? {} : { generation: clip.generation }),
      ...(clip.keepAfterRedo === undefined ? {} : { keepAfterRedo: clip.keepAfterRedo }),
      ...(clip.keptTake === undefined ? {} : { keptTake: clip.keptTake }),
      takes: clip.takes,
    })),
    spend: { estimatedUsd: 0, takes: 0 },
    updatedAt: '',
    version: 1,
  }
}

function take(
  clipIndex: number,
  number: number,
  fields: Partial<BeatLoopTake> & { minute: number },
): BeatLoopTake {
  const { minute, ...rest } = fields
  const clipId = CLIP_IDS[clipIndex]
  const name = number > 1 ? `${clipId}_take${number}` : clipId
  return {
    attempts: [],
    clipId,
    clipIndex,
    createdAt: `2026-10-11T10:${String(minute).padStart(2, '0')}:00.000Z`,
    failed: [],
    failures: [],
    model: 'minimax-h3-max-turbo',
    passed: true,
    prompt: 'p',
    provider: 'fal',
    qa: null,
    spend: {
      estimatedUsd: 0.16,
      model: 'minimax-h3-max-turbo',
      provider: 'fal',
      requestedSeconds: 4,
      usdPerSecond: 0.04,
    },
    take: number,
    transition: {
      endMs: (clipIndex + 1) * 4000,
      fromShotId: `f${clipIndex}`,
      lastFrameUri: `store://long_take/transitions/${name}_last.png`,
      prompt: 'p',
      qualityCheck: { hasGibberish: false, severity: 'none' },
      startMs: clipIndex * 4000,
      toShotId: `f${clipIndex + 1}`,
      transitionId: clipId,
      videoUri: `store://long_take/transitions/${name}.mp4`,
    },
    ...rest,
  }
}

const storyboard = { clips: CLIP_IDS.map((id) => ({ id })) }

describe('planBeatLoopResume', () => {
  const fresh = {
    generations: [1, 1, 1, 1],
    kept: [],
    keptAfterRedo: [],
    nextTakes: [1, 1, 1, 1],
    pendingTakes: [],
    rerollsSpent: 0,
  }

  it('starts from clip 1 when nothing is stored', () => {
    expect(planBeatLoopResume(storyboard, record([]))).toEqual(fresh)
  })

  it('reuses the kept clips in order and hands on the takes of the first unfinished one', () => {
    const c3 = take(2, 1, { failed: ['beatShape'], minute: 9, passed: false })
    const plan = planBeatLoopResume(
      storyboard,
      record([
        { keptTake: 1, takes: [take(0, 1, { firstFrameUri: 'store://c1_first.png', minute: 1 })] },
        {
          flagged: true,
          keptTake: 1,
          takes: [
            take(1, 1, { failures: ['Hard cut.'], minute: 3, passed: false }),
            take(1, 2, { minute: 5, passed: false }),
          ],
        },
        { takes: [c3] },
      ]),
    )
    expect(plan.kept).toEqual([
      expect.objectContaining({
        clipId: 'c1',
        firstFrameUri: 'store://c1_first.png',
        flagged: false,
        keptTake: 1,
        lastFrameUri: 'store://long_take/transitions/c1_last.png',
        rerolls: 0,
      }),
      expect.objectContaining({
        clipId: 'c2',
        failures: ['Hard cut.'],
        flagged: true,
        keptTake: 1,
        lastFrameUri: 'store://long_take/transitions/c2_last.png',
        rerolls: 1,
      }),
    ])
    expect(plan.pendingTakes).toEqual([c3])
    expect(plan.rerollsSpent).toBe(1)
  })

  it('never reuses a flagged clip 1: it failed the gate, so it is made again', () => {
    const takes = [
      take(0, 1, { minute: 1, passed: false }),
      take(0, 2, { minute: 2, passed: false }),
    ]
    const plan = planBeatLoopResume(storyboard, record([{ flagged: true, keptTake: 2, takes }]))
    expect(plan.kept).toEqual([])
    // Its takes failed the gate: none of them is kept or counted again.
    expect(plan.pendingTakes).toEqual([])
    expect(plan.nextTakes[0]).toBe(3)
  })

  it('stops at a clip made before the clip it follows: its first frame no longer matches', () => {
    const plan = planBeatLoopResume(
      storyboard,
      record([
        { keptTake: 2, takes: [take(0, 1, { minute: 1 }), take(0, 2, { minute: 30 })] },
        { keptTake: 1, takes: [take(1, 1, { minute: 4 })] },
      ]),
    )
    expect(plan.kept.map((clip) => clip.clipId)).toEqual(['c1'])
    // Clip 2's take started from a frame clip 1 no longer ends on.
    expect(plan.pendingTakes).toEqual([])
  })

  it('ignores a kept take that left no clip, and takes of another storyboard', () => {
    const plan = planBeatLoopResume(
      storyboard,
      record([{ keptTake: 1, takes: [take(0, 1, { minute: 1, transition: null })] }]),
    )
    expect(plan.kept).toEqual([])
    const other = planBeatLoopResume(
      { clips: [{ id: 'x1' }, { id: 'x2' }] },
      record([{ keptTake: 1, takes: [take(0, 1, { minute: 1 })] }]),
    )
    expect(other).toEqual({ ...fresh, generations: [1, 1], nextTakes: [1, 1] })
  })

  /** A take that records the frame it started from. */
  const chained = (clipIndex: number, number: number, from: string, fields = {}) =>
    take(clipIndex, number, { minute: 10 + clipIndex, startFrameUri: from, ...fields })
  const lastOf = (clipId: string, number = 1) => {
    const name = number > 1 ? `${clipId}_take${number}` : clipId
    return `store://long_take/transitions/${name}_last.png`
  }

  it('chains takes by the frame they started from, not by when they were made', () => {
    const plan = planBeatLoopResume(
      storyboard,
      record([
        { keptTake: 1, takes: [chained(0, 1, 'store://f0.png', { minute: 50 })] },
        // Made "before" clip 1 by the clock, but from clip 1's last frame: it chains.
        { keptTake: 1, takes: [chained(1, 1, lastOf('c1'), { minute: 1 })] },
        // From a frame clip 2 doesn't end on: not reused, and not handed on either.
        { keptTake: 1, takes: [chained(2, 1, lastOf('c2', 9))] },
      ]),
    )
    expect(plan.kept.map((clip) => clip.clipId)).toEqual(['c1', 'c2'])
    expect(plan.pendingTakes).toEqual([])
  })

  it("counts only takes of the clip's current generation, and numbers new takes after every take", () => {
    // Clip 2 was redone: generation 2, its generation-1 takes kept on record only.
    const old = [chained(1, 1, lastOf('c1')), chained(1, 2, lastOf('c1'))]
    const plan = planBeatLoopResume(
      storyboard,
      record([
        { keptTake: 1, takes: [chained(0, 1, 'store://f0.png')] },
        { clipIndex: 1, generation: 2, takes: old },
      ]),
    )
    expect(plan.kept.map((clip) => clip.clipId)).toEqual(['c1'])
    expect(plan.pendingTakes).toEqual([])
    expect(plan.generations).toEqual([1, 2, 1, 1])
    expect(plan.nextTakes).toEqual([2, 3, 1, 1])
  })

  it('reuses clips kept on purpose after a redone clip, right after the gap and in a row', () => {
    const plan = planBeatLoopResume(
      storyboard,
      record([
        { keptTake: 1, takes: [chained(0, 1, 'store://f0.png')] },
        { clipIndex: 1, generation: 2, takes: [chained(1, 1, lastOf('c1'))] },
        { keepAfterRedo: true, keptTake: 1, takes: [chained(2, 1, lastOf('c2'))] },
        { keepAfterRedo: true, keptTake: 3, takes: [chained(3, 3, lastOf('c3'))] },
      ]),
    )
    expect(plan.kept.map((clip) => clip.clipId)).toEqual(['c1'])
    expect(plan.keptAfterRedo.map((clip) => [clip.clipId, clip.keptTake])).toEqual([
      ['c3', 1],
      ['c4', 3],
    ])
    expect(plan.nextTakes).toEqual([2, 2, 2, 4])
  })

  it('keeps a clip kept after a redo on later runs too, although it starts from the old frame', () => {
    const plan = planBeatLoopResume(
      storyboard,
      record([
        { keptTake: 1, takes: [chained(0, 1, 'store://f0.png')] },
        { generation: 2, keptTake: 2, takes: [chained(1, 2, lastOf('c1'), { generation: 2 })] },
        { keepAfterRedo: true, keptTake: 1, takes: [chained(2, 1, lastOf('c2'))] },
      ]),
    )
    expect(plan.kept.map((clip) => [clip.clipId, clip.keptTake])).toEqual([
      ['c1', 1],
      ['c2', 2],
      ['c3', 1],
    ])
  })

  it('does not reuse a clip after the gap that was not kept on purpose', () => {
    const plan = planBeatLoopResume(
      storyboard,
      record([
        { keptTake: 1, takes: [chained(0, 1, 'store://f0.png')] },
        { clipIndex: 1, generation: 2, takes: [chained(1, 1, lastOf('c1'))] },
        { keptTake: 1, takes: [chained(2, 1, lastOf('c2'))] },
        { keepAfterRedo: true, keptTake: 1, takes: [chained(3, 1, lastOf('c3'))] },
      ]),
    )
    expect(plan.keptAfterRedo).toEqual([])
  })

  it('starts every clip over in a new generation when the keyframes were made again', () => {
    const plan = planBeatLoopResume(
      storyboard,
      record([
        { keptTake: 1, takes: [chained(0, 1, 'store://f0.png')] },
        { generation: 2, keptTake: 2, takes: [chained(1, 2, lastOf('c1'), { generation: 2 })] },
      ]),
      { restart: true },
    )
    expect(plan).toEqual({
      ...fresh,
      generations: [2, 3, 2, 2],
      nextTakes: [2, 3, 1, 1],
    })
  })

  it("holds no clip to the model its stored takes used: every new take tries Setup's first", () => {
    const plan = planBeatLoopResume(
      storyboard,
      record([{ takes: [take(0, 1, { minute: 1, model: 'gemini-omni-flash', passed: false })] }]),
    )
    expect(plan).not.toHaveProperty('model')
  })
})
