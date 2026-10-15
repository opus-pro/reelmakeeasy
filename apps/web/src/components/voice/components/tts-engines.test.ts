import { engineFilters, filterVoicesByEngine, voiceEngine } from './tts-engines'

describe('voice engines in the picker', () => {
  it('maps Gemini presets to the gemini engine', () => {
    expect(voiceEngine({ provider: 'gemini', value: 'gemini-kore' })).toBe('gemini')
    expect(voiceEngine({ value: 'gemini-sulafat' })).toBe('gemini')
    expect(voiceEngine({ value: 'EXAVITQu4vr4xnSDxMaL' })).toBe('elevenlabs')
  })

  it('shows chips only for the engines the API lists', () => {
    expect(engineFilters(['gemini', 'kokoro'])).toEqual(['all', 'kokoro', 'gemini'])
    // The paid engines after the free ones: Gemini just before ElevenLabs.
    expect(engineFilters(['gemini', 'kokoro', 'qwen3', 'elevenlabs'])).toEqual([
      'all',
      'kokoro',
      'qwen3',
      'gemini',
      'elevenlabs',
    ])
    expect(engineFilters(['kokoro', 'qwen3', 'elevenlabs'])).toEqual([
      'all',
      'kokoro',
      'qwen3',
      'elevenlabs',
    ])
  })

  it('filters by gemini and keeps auto-select', () => {
    const voices = [
      { name: 'Auto', value: 'auto-select' },
      { name: 'Gemini Kore', provider: 'gemini', value: 'gemini-kore' },
      { name: 'Sarah', value: 'EXAVITQu4vr4xnSDxMaL' },
    ]
    expect(filterVoicesByEngine(voices, 'gemini').map((v) => v.value)).toEqual([
      'auto-select',
      'gemini-kore',
    ])
  })
})
