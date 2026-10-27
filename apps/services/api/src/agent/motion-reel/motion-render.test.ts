import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import type { ReelJson } from '@reelmakeeasy/common/motion-reel/reel-config'

import { beatAt, beatTime, frameOfBeat, gridReport, pulseRefusal } from './motion-render'

const reel = (over: Partial<ReelJson> = {}): ReelJson => ({
  bars: 2,
  beats: [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5],
  beatsPerBar: 4,
  bpm: 120,
  downbeats: [0, 2],
  durationInFrames: 120,
  events: { chords: [], kicks: [], melody: [], sections: [], snares: [] },
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

describe('pulseRefusal (no pulse on every kick, snare or note)', () => {
  let dir: string
  const scene = (name: string, code: string) => {
    fs.mkdirSync(path.join(dir, 'src', 'scenes'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'src', 'scenes', name), code)
  }
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'motion-pulse-'))
  })
  afterEach(() => fs.rmSync(dir, { force: true, recursive: true }))

  it("refuses the rejected reel's per-note pulse, and a pulse on every kick or snare", () => {
    scene('Clips.tsx', 'const a = 1\n  const kick = usePulse(melody(0.8), 0.45)\n')
    scene('Depth.tsx', 'const k = usePulse( kicks() )\nconst s = usePulse(snares())\n')
    const why = pulseRefusal(dir)
    expect(why).toMatch(
      /^Not rendered: src\/scenes\/Clips\.tsx:2 \(const kick = usePulse\(melody\(0\.8\), 0\.45\)\); src\/scenes\/Depth\.tsx:1 .*; src\/scenes\/Depth\.tsx:2 .* pulses an element on every kick, snare or note/,
    )
    expect(why).toMatch(/answer the music with new things/)
  })

  it("lets a few chosen accents through, and reads only the reel's own sources", () => {
    scene(
      'Drop.tsx',
      'const p = usePulse([bar(8)])\nconst q = usePulse(eventsBetween(melody(0.8), a, b))\n',
    )
    // The kit documents the rejected call; it is ReelMakeEasy's file, not the agent's.
    fs.writeFileSync(path.join(dir, 'src', 'kit.tsx'), '// never `usePulse(kicks())`\n')
    expect(pulseRefusal(dir)).toBeNull()
    expect(pulseRefusal(path.join(dir, 'missing'))).toBeNull()
  })
})
