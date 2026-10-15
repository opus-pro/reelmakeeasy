import {
  falTtsProviderForVoiceId,
  isQwen3UserVoiceId,
  kokoroEndpoint,
  qwen3Language,
  qwen3PresetSpeaker,
} from './fal-tts'
import { PRESET_VOICES, presetVoiceProvider } from './preset-voices'

describe('fal TTS voice ids', () => {
  it('routes by prefix', () => {
    expect(falTtsProviderForVoiceId('kokoro-af_heart')).toBe('kokoro')
    expect(falTtsProviderForVoiceId('qwen3-vivian')).toBe('qwen3')
    expect(falTtsProviderForVoiceId('qwen3-clone-1234')).toBe('qwen3')
    expect(falTtsProviderForVoiceId('EXAVITQu4vr4xnSDxMaL')).toBeNull()
  })

  it('maps Qwen3 presets to speakers, never user voices', () => {
    expect(qwen3PresetSpeaker('qwen3-uncle_fu')).toBe('Uncle_Fu')
    expect(qwen3PresetSpeaker('qwen3-clone-1234')).toBeNull()
    expect(qwen3PresetSpeaker('qwen3-unknown')).toBeNull()
    expect(isQwen3UserVoiceId('qwen3-clone-1234')).toBe(true)
  })

  it('sends British Kokoro voices to the british-english endpoint', () => {
    const us = 'fal-ai/kokoro/american-english'
    expect(kokoroEndpoint(us, 'af_heart')).toBe(us)
    expect(kokoroEndpoint(us, 'bf_emma')).toBe('fal-ai/kokoro/british-english')
    expect(kokoroEndpoint(us, 'bm_george')).toBe('fal-ai/kokoro/british-english')
  })

  it('maps BCP-47 codes to Qwen3 languages', () => {
    expect(qwen3Language('de-DE')).toBe('German')
    expect(qwen3Language('zh')).toBe('Chinese')
    expect(qwen3Language('eng')).toBe('English')
    expect(qwen3Language('jpn')).toBe('Japanese')
    expect(qwen3Language('nl')).toBe('Auto')
    expect(qwen3Language(undefined)).toBe('Auto')
  })
})

describe('preset catalog', () => {
  it('gives every Kokoro and Qwen3 preset a routable id', () => {
    for (const voice of PRESET_VOICES) {
      const provider = presetVoiceProvider(voice.id)
      if (provider === 'kokoro') expect(voice.id).toMatch(/^kokoro-[ab][fm]_/)
      if (provider === 'qwen3') expect(qwen3PresetSpeaker(voice.id)).not.toBeNull()
      if (provider === 'elevenlabs') expect(falTtsProviderForVoiceId(voice.id)).toBeNull()
    }
  })

  it('has unique ids', () => {
    const ids = PRESET_VOICES.map((voice) => voice.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
