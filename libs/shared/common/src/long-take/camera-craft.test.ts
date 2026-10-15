import { RETIME_MAX_SPEED_MULTIPLIER } from '../utils/retime-constants'

import {
  buildDynamicBeatRanges,
  buildDynamicTransitionRewritePrompt,
  CAMERA_MOVES,
  cameraMoveFor,
  cameraSeed,
  cleanDynamicTransitionPrompt,
  DYNAMIC_MOVEMENT_RULES,
  hailuoGenerationSeconds,
  preferredShotRhythm,
  retimeMaxSpeedFor,
  sanitizeCameraStyle,
} from './camera-craft'

describe('sanitizeCameraStyle', () => {
  it('keeps the two styles and turns anything else into calm', () => {
    expect(sanitizeCameraStyle('dynamic')).toBe('dynamic')
    expect(sanitizeCameraStyle('calm')).toBe('calm')
    for (const v of [undefined, null, '', 'Dynamic', 'wild', 3]) {
      expect(sanitizeCameraStyle(v)).toBe('calm')
    }
  })
})

describe('cameraMoveFor', () => {
  it('never gives neighbouring clips the same move', () => {
    for (const seed of [0, 1, 7, 12345]) {
      for (let i = 1; i < 25; i++) {
        const { move, previousMove } = cameraMoveFor(i, seed)
        expect(previousMove).toBe(cameraMoveFor(i - 1, seed).move)
        expect(move).not.toBe(previousMove)
      }
    }
  })

  it('has no previous move for the first clip and only uses the listed moves', () => {
    expect(cameraMoveFor(0, 3).previousMove).toBeUndefined()
    expect(CAMERA_MOVES).toContain(cameraMoveFor(4, 3).move)
  })

  it('starts different videos on different moves', () => {
    const firsts = new Set(
      ['a', 'b', 'c', 'd', 'e'].map((id) => cameraMoveFor(0, cameraSeed(`10081533-${id}`)).move),
    )
    expect(firsts.size).toBeGreaterThan(1)
  })
})

describe('hailuoGenerationSeconds', () => {
  it('rounds up to Hailuo whole seconds between 5 and 15', () => {
    expect(hailuoGenerationSeconds(3.65)).toBe(5)
    expect(hailuoGenerationSeconds(5)).toBe(5)
    expect(hailuoGenerationSeconds(7.06)).toBe(8)
    expect(hailuoGenerationSeconds(22)).toBe(15)
  })
})

describe('buildDynamicBeatRanges', () => {
  it('splits a short clip into two even beats and a long one into three', () => {
    expect(buildDynamicBeatRanges(6)).toEqual(['[0:00.000-0:03.000]', '[0:03.000-0:06.000]'])
    expect(buildDynamicBeatRanges(9)).toEqual([
      '[0:00.000-0:03.000]',
      '[0:03.000-0:06.000]',
      '[0:06.000-0:09.000]',
    ])
  })

  it('puts the narration change on a beat edge', () => {
    expect(buildDynamicBeatRanges(5, 3.347)).toEqual(['[0:00.000-0:03.347]', '[0:03.347-0:05.000]'])
    expect(buildDynamicBeatRanges(10, 2)).toEqual([
      '[0:00.000-0:02.000]',
      '[0:02.000-0:06.000]',
      '[0:06.000-0:10.000]',
    ])
  })

  it('ignores a narration change within half a second of either end', () => {
    expect(buildDynamicBeatRanges(6, 0.3)).toEqual(buildDynamicBeatRanges(6))
    expect(buildDynamicBeatRanges(6, 5.7)).toEqual(buildDynamicBeatRanges(6))
  })
})

describe('buildDynamicTransitionRewritePrompt', () => {
  const prompt = buildDynamicTransitionRewritePrompt({
    beatBoundarySeconds: 3.347,
    durationSeconds: 5,
    move: 'a crane up',
    previousMove: 'an orbit around the subject',
    vibe: 'Marcinelle-school comic, saturated gouache',
    visualScript: 'Outgoing keyframe: an astronaut at a pit.\nIncoming keyframe: a cutaway.',
  })

  it('carries the movement rules, the beats and the narration edge', () => {
    expect(prompt).toContain(DYNAMIC_MOVEMENT_RULES)
    expect(prompt).toContain('[0:00.000-0:03.347], [0:03.347-0:05.000]')
    expect(prompt).toContain('the narration beat changes at the edge between the first and second')
    expect(prompt).toContain('Vibe: Marcinelle-school comic, saturated gouache')
    expect(prompt).toContain('Visual script: Outgoing keyframe: an astronaut at a pit.')
  })

  it('assigns the move and forbids the previous one', () => {
    expect(prompt).toContain('Camera move for this clip: a crane up.')
    expect(prompt).toContain('but never an orbit around the subject, which the previous clip used')
  })

  it('asks for beats without labels and keeps narration off screen', () => {
    expect(prompt).toContain('each "[m:ss.sss-m:ss.sss] text"')
    expect(prompt).not.toMatch(/LABEL/)
    expect(prompt).toContain('X5. Never put narration, captions or any words into the frame')
  })

  it('omits the previous-move clause for the first clip', () => {
    const first = buildDynamicTransitionRewritePrompt({
      durationSeconds: 6,
      move: 'a crane up',
      visualScript: 'x',
    })
    expect(first).toContain('Camera move for this clip: a crane up.')
    expect(first).not.toContain('which the previous clip used')
    expect(first).not.toContain('VO beat boundary')
    expect(first).toContain('Vibe: match the visual style of the two keyframes')
  })
})

describe('cleanDynamicTransitionPrompt', () => {
  const beats =
    '[0:00.000-0:02.500] The camera cranes up fast.\n\n[0:02.500-0:05.000] Still rising, it tilts down.'

  it('keeps the beats and drops fences and preambles', () => {
    expect(cleanDynamicTransitionPrompt(`Here is the prompt:\n\`\`\`text\n${beats}\n\`\`\``)).toBe(
      beats,
    )
  })

  it('returns empty text when there are no timecodes', () => {
    expect(cleanDynamicTransitionPrompt('The camera slowly pushes in.')).toBe('')
  })

  it('cuts an over-long prompt after the last whole beat that fits', () => {
    const long = `[0:00.000-0:02.500] ${'Rocks tumble. '.repeat(10)}\n[0:02.500-0:05.000] ${'Dust swirls. '.repeat(400)}`
    const cleaned = cleanDynamicTransitionPrompt(long, 400)
    expect(cleaned.startsWith('[0:00.000-0:02.500]')).toBe(true)
    expect(cleaned).not.toContain('[0:02.500-0:05.000]')
    expect(cleaned.length).toBeLessThanOrEqual(400)
  })

  it('cuts a single over-long beat at a sentence end', () => {
    const cleaned = cleanDynamicTransitionPrompt(
      `[0:00.000-0:05.000] ${'The camera dives. '.repeat(50)}`,
      200,
    )
    expect(cleaned.length).toBeLessThanOrEqual(200)
    expect(cleaned.endsWith('.')).toBe(true)
  })
})

describe('preferredShotRhythm', () => {
  it('prefers 3-6s for dynamic and 5-8s otherwise', () => {
    expect(preferredShotRhythm('dynamic')).toBe('3-6s')
    expect(preferredShotRhythm('calm')).toBe('5-8s')
    expect(preferredShotRhythm(undefined)).toBe('5-8s')
  })
})

describe('retimeMaxSpeedFor', () => {
  it('lets Dynamic clips play up to 1.6x faster and keeps the default cap for Calm', () => {
    expect(retimeMaxSpeedFor('dynamic')).toBe(1.6)
    expect(retimeMaxSpeedFor('calm')).toBe(RETIME_MAX_SPEED_MULTIPLIER)
    expect(retimeMaxSpeedFor(undefined)).toBe(RETIME_MAX_SPEED_MULTIPLIER)
  })
})
