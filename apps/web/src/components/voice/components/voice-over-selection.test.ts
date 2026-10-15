import { DEFAULT_AUTO_SELECT_VOICE_ID, defaultVoiceIdFrom } from './voice-over-selection'

describe('defaultVoiceIdFrom', () => {
  it('uses the voice the API flags as default (a Gemini voice on Gemini)', () => {
    expect(
      defaultVoiceIdFrom([{ value: 'kokoro-af_heart' }, { default: true, value: 'gemini-kore' }]),
    ).toBe('gemini-kore')
  })

  it('falls back to Sarah before the list loads', () => {
    expect(defaultVoiceIdFrom([])).toBe(DEFAULT_AUTO_SELECT_VOICE_ID)
  })
})
