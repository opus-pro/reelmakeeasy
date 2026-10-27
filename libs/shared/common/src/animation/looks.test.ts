import {
  AGENT_TOOL_MODES,
  isAnimationMode,
  isCodeVideoMode,
  toolOfMode,
} from '@shared/types/api/agent'

import { motionReelTrack } from '../motion-reel/music'

import {
  ANIMATION_DEFAULT_SEC,
  ANIMATION_LOOKS,
  ANIMATION_MAX_SEC,
  ANIMATION_MIN_SEC,
  animationLook,
  renderLookCard,
} from './looks'

describe('animation modes', () => {
  it('puts both animation modes under the animation tool', () => {
    expect(toolOfMode('animation')).toBe('animation')
    expect(toolOfMode('animation_free')).toBe('animation')
    expect(AGENT_TOOL_MODES.animation).toEqual({ advanced: 'animation_free', easy: 'animation' })
  })

  it('counts Motion Reel and Claude Animation as code-video chats, nothing else', () => {
    expect(isAnimationMode('animation_free')).toBe(true)
    expect(isAnimationMode('motion')).toBe(false)
    expect(isCodeVideoMode('motion')).toBe(true)
    expect(isCodeVideoMode('animation')).toBe(true)
    expect(isCodeVideoMode('free')).toBe(false)
    expect(isCodeVideoMode(null)).toBe(false)
  })
})

describe('animation looks', () => {
  it('has exactly the three looks, in order', () => {
    expect(ANIMATION_LOOKS.map((l) => [l.id, l.label])).toEqual([
      ['2d', '2D'],
      ['3d', '3D'],
      ['8bit', '8-bit'],
    ])
  })

  it('offers 15 to 90 s for every look, any whole number from 10 to 90 typed in', () => {
    for (const look of ANIMATION_LOOKS) expect(look.lengths).toEqual([15, 30, 45, 60, 90])
    expect([ANIMATION_MIN_SEC, ANIMATION_MAX_SEC, ANIMATION_DEFAULT_SEC]).toEqual([10, 90, 30])
  })

  it('casts two characters in 2D and a narrator in 3D and 8-bit', () => {
    expect(ANIMATION_LOOKS.map((l) => l.cast)).toEqual(['duo', 'narrator', 'narrator'])
  })

  it('picks library tracks that exist', () => {
    for (const look of ANIMATION_LOOKS)
      if (look.defaultTrackId) expect(motionReelTrack(look.defaultTrackId)).toBeTruthy()
  })

  it('names its skill and palette on the look card', () => {
    const card = renderLookCard(animationLook('8bit')!)
    expect(card).toContain('reelmakeeasy-animation-8bit')
    for (const colour of animationLook('8bit')!.palette) expect(card).toContain(colour)
  })
})
