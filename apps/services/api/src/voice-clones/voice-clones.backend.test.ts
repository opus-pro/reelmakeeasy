import { standardCloneBackend } from './voice-clones.backend'

describe('standardCloneBackend', () => {
  it('clones on ElevenLabs with its key outside development', () => {
    expect(
      standardCloneBackend({ ELEVENLABS_API_KEY: 'el-test', FAL_KEY: 'fal-test' }, false),
    ).toBe('elevenlabs')
  })

  it('keeps development clones on MiniMax when fal is set', () => {
    expect(standardCloneBackend({ ELEVENLABS_API_KEY: 'el-test', FAL_KEY: 'fal-test' }, true)).toBe(
      'minimax',
    )
  })

  it('clones on MiniMax through fal without an ElevenLabs key', () => {
    expect(standardCloneBackend({ FAL_KEY: 'fal-test' }, false)).toBe('minimax')
  })

  it('uses ElevenLabs in development when it is the only key', () => {
    expect(standardCloneBackend({ ELEVENLABS_API_KEY: 'el-test' }, true)).toBe('elevenlabs')
  })

  it('has nothing to clone with when neither key is set', () => {
    expect(standardCloneBackend({ ELEVENLABS_API_KEY: ' ', FAL_KEY: '' }, false)).toBeNull()
  })
})
