import {
  geminiVoicesUsable,
  NEEDS_GEMINI_KEY,
  NEEDS_LOCAL_VOICES,
  pickedVoiceUnavailableReason,
  presetEngine,
  qwen3CloneStatus,
  shownVoiceEngines,
  type VoiceContext,
} from './voice-engines'

const none: Omit<VoiceContext, 'generation'> = {
  elevenlabsKey: false,
  falKey: false,
  geminiKey: false,
  localEngines: { kokoro: false, qwen3: false },
}

describe('voice engines the picker lists', () => {
  it('on fal: Gemini (always, so people know it is there), then Kokoro, Qwen3 and ElevenLabs', () => {
    expect(shownVoiceEngines({ ...none, falKey: true, generation: 'fal' })).toEqual([
      'gemini',
      'kokoro',
      'qwen3',
      'elevenlabs',
    ])
    expect(
      shownVoiceEngines({ ...none, falKey: true, generation: 'fal', geminiKey: true }),
    ).toEqual(['gemini', 'kokoro', 'qwen3', 'elevenlabs'])
  })

  it('on Gemini: Gemini voices and the local voices that run', () => {
    expect(
      shownVoiceEngines({
        ...none,
        generation: 'google',
        localEngines: { kokoro: true, qwen3: false },
      }),
    ).toEqual(['gemini', 'kokoro'])
  })

  it('on Gemini: FAL_KEY adds no fal voices', () => {
    expect(shownVoiceEngines({ ...none, falKey: true, generation: 'google' })).toEqual(['gemini'])
  })

  it('on Gemini: ElevenLabs only with its own key', () => {
    expect(shownVoiceEngines({ ...none, elevenlabsKey: true, generation: 'google' })).toEqual([
      'gemini',
      'elevenlabs',
    ])
  })
})

describe('Gemini voices', () => {
  it('can be picked only with a Gemini key, whoever makes the videos', () => {
    expect(geminiVoicesUsable({ ...none, falKey: true, generation: 'fal' })).toBe(false)
    expect(geminiVoicesUsable({ ...none, falKey: true, generation: 'fal', geminiKey: true })).toBe(
      true,
    )
    expect(geminiVoicesUsable({ ...none, generation: 'google', geminiKey: true })).toBe(true)
  })

  it('say in plain words how to fix a missing key', () => {
    expect(NEEDS_GEMINI_KEY).toBe('Needs a Gemini key: add it in Setup')
  })

  it('are refused when picked without the key; other voices never are', () => {
    expect(pickedVoiceUnavailableReason('gemini-kore', {})).toBe(NEEDS_GEMINI_KEY)
    expect(pickedVoiceUnavailableReason(' gemini-kore ', { GEMINI_API_KEY: ' ' })).toBe(
      NEEDS_GEMINI_KEY,
    )
    expect(pickedVoiceUnavailableReason('gemini-kore', { GEMINI_API_KEY: 'g' })).toBeUndefined()
    expect(pickedVoiceUnavailableReason('kokoro-af_heart', {})).toBeUndefined()
    expect(pickedVoiceUnavailableReason(undefined, {})).toBeUndefined()
  })
})

describe('Qwen3 cloning', () => {
  it('on Gemini needs the local voices, even with FAL_KEY', () => {
    expect(qwen3CloneStatus({ ...none, falKey: true, generation: 'google' })).toEqual({
      available: false,
      reason: NEEDS_LOCAL_VOICES,
    })
  })

  it('on Gemini clones locally when Qwen3 runs here', () => {
    expect(
      qwen3CloneStatus({
        ...none,
        generation: 'google',
        localEngines: { kokoro: true, qwen3: true },
      }),
    ).toEqual({ available: true })
  })

  it('on fal clones on fal with FAL_KEY, as before', () => {
    expect(qwen3CloneStatus({ ...none, falKey: true, generation: 'fal' })).toEqual({
      available: true,
    })
    expect(qwen3CloneStatus({ ...none, generation: 'fal' }).available).toBe(false)
  })
})

describe('presetEngine', () => {
  it('treats an absent provider as ElevenLabs', () => {
    expect(presetEngine(undefined)).toBe('elevenlabs')
    expect(presetEngine('gemini')).toBe('gemini')
  })
})
