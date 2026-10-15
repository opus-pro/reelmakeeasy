import { cameraMoveFor, cameraSeed } from '@reelmakeeasy/common/long-take/camera-craft'

import {
  buildHailuoTransitionRewritePrompt,
  cleanHailuoTransitionPrompt,
  fallbackHailuoTransitionPrompt,
  hailuoRewriteRequest,
} from './hailuo-transition-prompt'

describe('Hailuo transition prompt', () => {
  it('asks for one continuous paragraph from the scenes, motion and narration only', () => {
    const request = buildHailuoTransitionRewritePrompt({
      durationSeconds: 6.51,
      fromMotion: 'The queens hold their poses.',
      fromScene: 'Two queens flank a stone tablet.',
      narration: 'Powerful queens like Hatshepsut and Cleopatra.',
      toMotion: 'The pharaoh stands resolute.',
      toScene: 'Ramesses stands before a terracotta arch.',
    })
    expect(request).toContain('Clip length: 7 seconds')
    expect(request).toContain('First frame shows: Two queens flank a stone tablet.')
    expect(request).toContain(
      'Planned motion: The queens hold their poses. The pharaoh stands resolute.',
    )
    expect(request).not.toMatch(/\[\d:\d/)
    expect(request).not.toContain('Notes:')
  })

  it('flattens timestamps, shot labels and headings into one paragraph', () => {
    const text = [
      '"[0:00.000-0:02.490] HIEROGLYPHIC QUEENS',
      'The camera pushes in as the queens slide apart.',
      '',
      '[Shot 2] At 00:02.490 Ramesses slides in from the right."',
    ].join('\n')
    expect(cleanHailuoTransitionPrompt(text)).toBe(
      'The camera pushes in as the queens slide apart. Ramesses slides in from the right.',
    )
  })

  it('keeps long prompts under the limit at a sentence end', () => {
    const cleaned = cleanHailuoTransitionPrompt('The camera pushes in. '.repeat(60))
    expect(cleaned.length).toBeLessThanOrEqual(900)
    expect(cleaned.endsWith('.')).toBe(true)
  })

  it('falls back to the planned motion as one shot', () => {
    expect(
      fallbackHailuoTransitionPrompt({ durationSeconds: 5, fromMotion: 'The queens turn.' }),
    ).toBe('A single continuous shot as the camera slowly pushes in. The queens turn.')
  })
})

describe('hailuoRewriteRequest', () => {
  const base = {
    durationSeconds: 4.99,
    fromMotion: 'The astronaut leans in.',
    fromScene: 'An astronaut at a lunar pit.',
    narration: 'NASA will test the pit.',
    projectId: '01010000-abc',
    toMotion: 'Rock layers rise.',
    toScene: 'A cutaway of rock layers.',
  }

  it("is exactly today's request for calm and for a missing style", () => {
    for (const cameraStyle of ['calm' as const, undefined, null]) {
      const req = hailuoRewriteRequest({ ...base, cameraStyle })
      expect(req.prompt).toBe(buildHailuoTransitionRewritePrompt(base))
      expect(req.models).toEqual(['gemini-3.8-flash', 'gpt-5'])
      expect(req.task).toBe('long-take-hailuo-prompt')
      expect(req.temperature).toBeUndefined()
      expect(req.clean('"[0:00.000-0:02.000] A. B."')).toBe(
        cleanHailuoTransitionPrompt('"[0:00.000-0:02.000] A. B."'),
      )
    }
  })

  it('writes timed beats in the generated clip time, with the narration edge scaled', () => {
    // A 4.99 s slot is generated at 5 s; a 3.333 s boundary scales to 3.34 s.
    const req = hailuoRewriteRequest({
      ...base,
      beatBoundarySeconds: 3.333,
      cameraStyle: 'dynamic',
      clipIndex: 2,
      styleText: 'gouache comic',
      visualScript: 'Transition objective: one continuous bridge.',
    })
    expect(req.prompt).toContain('Clip duration: 5s')
    expect(req.prompt).toContain('[0:00.000-0:03.340], [0:03.340-0:05.000]')
    expect(req.prompt).toContain('Vibe: gouache comic')
    expect(req.prompt).toContain('Visual script: Transition objective: one continuous bridge.')
    const { move, previousMove } = cameraMoveFor(2, cameraSeed('01010000-abc'))
    expect(req.prompt).toContain(`Camera move for this clip: ${move}.`)
    expect(req.prompt).toContain(`but never ${previousMove}`)
    expect(req.models).toEqual(['gemini-3.1-pro-preview', 'gemini-3.8-flash'])
    expect(req.task).toBe('long-take-hailuo-dynamic-prompt')
    expect(req.temperature).toBe(0.3)
  })

  it('scales the narration edge by the real speed-up when the slot is shorter than the clip plays', () => {
    // A 3 s slot is generated at 5 s and played at the 1.6x cap, so only the first 4.8 s show:
    // a 1 s narration edge lands at 1.6 s of the generated clip, not at 5/3 s.
    const req = hailuoRewriteRequest({
      ...base,
      beatBoundarySeconds: 1,
      cameraStyle: 'dynamic',
      durationSeconds: 3,
    })
    expect(req.prompt).toContain('[0:00.000-0:01.600], [0:01.600-0:05.000]')
  })

  it('drops the slot-time VO and music timing lines from the visual script', () => {
    const req = hailuoRewriteRequest({
      ...base,
      cameraStyle: 'dynamic',
      visualScript: [
        'Transition objective: one continuous bridge.',
        'VO timing inside this clip: keep the outgoing beat visually active until 1.5s, then reveal the incoming beat.',
        'Music beat boundary inside this clip: keep the outgoing shot energy active until 1.5s.',
        'Outgoing keyframe: an astronaut.',
      ].join('\n'),
    })
    expect(req.prompt).toContain('Transition objective: one continuous bridge.')
    expect(req.prompt).toContain('Outgoing keyframe: an astronaut.')
    expect(req.prompt).not.toContain('inside this clip')
  })

  it('builds a visual script from the scenes when none is given', () => {
    const req = hailuoRewriteRequest({ ...base, cameraStyle: 'dynamic' })
    expect(req.prompt).toContain('Outgoing keyframe: An astronaut at a lunar pit.')
    expect(req.prompt).toContain('Incoming keyframe: A cutaway of rock layers.')
  })

  it('keeps beats when cleaning and returns empty text for prose', () => {
    const req = hailuoRewriteRequest({ ...base, cameraStyle: 'dynamic' })
    expect(req.clean('Sure:\n[0:00.000-0:05.000] The camera cranes up.')).toBe(
      '[0:00.000-0:05.000] The camera cranes up.',
    )
    expect(req.clean('The camera slowly pushes in.')).toBe('')
  })
})
