import { resetGenerationProviderForTesting, setGenerationProvider } from '@reelmakeeasy/llm/registry'

import { defaultVoice, defaultVoiceId } from './default-voice'
import {
  GEMINI_DEFAULT_VOICE_ID,
  GEMINI_PRESET_VOICES,
  geminiPresetIdForLegacyName,
  geminiVoiceName,
  isGeminiVoiceId,
} from './gemini-voices'
import { isRetiredVoiceId, LEGACY_GEMINI_PRESET_VOICE_IDS } from './legacy-voices'
import { DEFAULT_VOICE_ID, PRESET_VOICES, presetVoiceProvider } from './preset-voices'

afterEach(() => resetGenerationProviderForTesting())

describe('Gemini voice presets', () => {
  it('lists the 30 prebuilt voices as gemini presets', () => {
    expect(GEMINI_PRESET_VOICES).toHaveLength(30)
    expect(PRESET_VOICES.filter((v) => v.provider === 'gemini')).toHaveLength(30)
    expect(presetVoiceProvider('gemini-kore')).toBe('gemini')
  })

  it('maps ids to Gemini voice names', () => {
    expect(geminiVoiceName('gemini-kore')).toBe('Kore')
    expect(geminiVoiceName('gemini-zubenelgenubi')).toBe('Zubenelgenubi')
    expect(geminiVoiceName('Kore')).toBeNull()
    expect(isGeminiVoiceId('gemini-nobody')).toBe(false)
  })

  it('never collides with the retired bare Gemini names, and maps each of them back', () => {
    for (const voice of GEMINI_PRESET_VOICES) expect(isRetiredVoiceId(voice.id)).toBe(false)
    for (const name of LEGACY_GEMINI_PRESET_VOICE_IDS) {
      expect(geminiPresetIdForLegacyName(name)).toBe(`gemini-${name.toLowerCase()}`)
    }
    expect(geminiPresetIdForLegacyName('Nobody')).toBeNull()
  })

  it('labels each voice with a gender and its tone', () => {
    for (const voice of GEMINI_PRESET_VOICES) {
      expect(['Female', 'Male']).toContain(voice.labels[1])
      expect(voice.labels[3]).toBe(voice.tone)
    }
  })
})

describe('default voice', () => {
  it('is ElevenLabs Sarah on fal and a Gemini voice on google', () => {
    expect(defaultVoice()).toEqual({ provider: 'elevenlabs', voiceId: DEFAULT_VOICE_ID })
    setGenerationProvider('google')
    expect(defaultVoiceId()).toBe(GEMINI_DEFAULT_VOICE_ID)
    expect(isGeminiVoiceId(GEMINI_DEFAULT_VOICE_ID)).toBe(true)
  })
})
