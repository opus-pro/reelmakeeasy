import type { ReelJson } from '@reelmakeeasy/common/motion-reel/reel-config'

import { beatAt, beatTime, frameOfBeat, gridReport } from './motion-render'

const reel = (over: Partial<ReelJson> = {}): ReelJson => ({
  bars: 2,
  beats: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5],
  beatsPerBar: 4,
  bpm: 120,
  downbeats: [0, 2],
  durationInFrames: 120,
  fadeOutSec: 0.5,
  fps: 30,
  height: 1080,
  lengthSec: 4,
  music: 'music.wav',
  ratio: '16:9',
  strongHits: [],
  subject: 'x',
  width: 1920,
  ...over,
})

describe('beat timing', () => {
  it('reads beats and fractions, and runs on at the tempo past the last beat', () => {
    expect(beatTime(reel(), 2)).toBe(1)
    expect(beatTime(reel(), 2.5)).toBe(1.25)
    expect(beatTime(reel(), 9)).toBeCloseTo(4.5)
    expect(beatAt(reel(), 1.25)).toBe(2.5)
    expect(frameOfBeat(reel(), 4)).toBe(60)
    expect(frameOfBeat(reel(), 100)).toBe(119)
  })
})

describe('gridReport', () => {
  it('counts cuts on beats and half beats, and names the ones off the grid', () => {
    expect(gridReport(reel(), [0, 1, 2.01, 2.75, 3.4])).toBe(
      '4 cuts: 2 on a beat, 1 on a half beat, 1 off the grid (at beats 6.8).',
    )
    expect(gridReport(reel(), [1, 2])).toBe('2 cuts: 2 on a beat, none off the grid.')
    expect(gridReport(reel(), [])).toMatch(/No hard cuts/)
  })
})
