import {
  DEFAULT_MOTION_MUSIC_ENGINE,
  MOTION_MUSIC_ENGINE_INFO,
  MOTION_MUSIC_ENGINES,
  motionMusicEngineOf,
} from './reel-config'

describe('the ways the agent makes music', () => {
  it('offers the composer first, free, as the default; the music models stay', () => {
    expect(MOTION_MUSIC_ENGINES).toEqual(['composer', 'eleven-music', 'ace-step'])
    expect(DEFAULT_MOTION_MUSIC_ENGINE).toBe('composer')
    expect(MOTION_MUSIC_ENGINE_INFO.composer).toMatchObject({
      cost: 'free',
      label: 'Composed by the agent',
    })
    expect(MOTION_MUSIC_ENGINE_INFO.composer.description).toMatch(/note by note/)
  })

  it('reads a saved "code" engine, or none, as the composer', () => {
    expect(motionMusicEngineOf('code')).toBe('composer')
    expect(motionMusicEngineOf(undefined)).toBe('composer')
    expect(motionMusicEngineOf('ace-step')).toBe('ace-step')
  })
})
