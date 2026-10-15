import {
  ENGINE_LABELS,
  engineCostLabel,
  engineCostTitle,
  NEEDS_GEMINI_KEY_LABEL,
  standardCloneOption,
  voiceUnavailableReason,
} from './tts-engine-copy'

describe('standardCloneOption', () => {
  it('keeps the general wording until the engines load', () => {
    expect(standardCloneOption(undefined)).toEqual({
      description: 'ElevenLabs or MiniMax · 15 s recording',
    })
  })

  it('names the service that clones', () => {
    expect(standardCloneOption({ standardClone: 'elevenlabs' })).toEqual({
      description: 'ElevenLabs · 15 s recording',
    })
    expect(standardCloneOption({ standardClone: 'minimax' })).toEqual({
      description: 'MiniMax on fal · 15 s recording',
    })
  })

  it('is unavailable when no key can clone', () => {
    expect(standardCloneOption({ standardClone: null })).toEqual({
      description: 'ElevenLabs · 15 s recording',
      disabledReason: 'Needs an ElevenLabs key',
    })
  })
})

describe('engineCostLabel', () => {
  it("names who bills only for fal: Gemini and the user's own ElevenLabs account are plain Paid", () => {
    expect(engineCostLabel({ free: true, runsOn: 'local' })).toBe('Free')
    expect(engineCostLabel({ free: false, runsOn: 'fal' })).toBe('Paid · fal')
    expect(engineCostLabel({ free: false, runsOn: 'google' })).toBe('Paid')
    expect(engineCostLabel({ free: false, runsOn: 'elevenlabs' })).toBe('Paid')
  })
})

describe('engineCostTitle', () => {
  it('says who bills for ElevenLabs voices', () => {
    expect(engineCostTitle('elevenlabs', { free: false, runsOn: 'elevenlabs' })).toBe(
      'ElevenLabs bills your account per character.',
    )
    expect(engineCostTitle('elevenlabs', { free: false, runsOn: 'fal' })).toBe(
      'ElevenLabs voices run through fal (no ElevenLabs key needed), billed per character.',
    )
  })

  it('keeps the wording for Kokoro and Qwen', () => {
    expect(engineCostTitle('kokoro', { free: true, runsOn: 'local' })).toBe(
      'Kokoro runs on your computer. No per-use cost.',
    )
    expect(engineCostTitle('qwen3', { free: false, runsOn: 'fal' })).toBe(
      'Qwen runs on fal, billed per character. Run `pnpm reelmakeeasy setup` to make it free on this computer.',
    )
  })

  it('names Gemini, and bills Gemini voices to the Gemini API key, never fal', () => {
    expect(ENGINE_LABELS.gemini).toBe('Gemini')
    expect(engineCostTitle('gemini', { free: false, runsOn: 'google' })).toBe(
      'Gemini voices are billed to your Gemini API key.',
    )
  })
})

describe('voiceUnavailableReason', () => {
  const elevenLabsClone = { provider: 'elevenlabs', voiceCloneId: 'clone-1' }
  const geminiPreset = { provider: 'gemini' }

  it('greys out Gemini voices without a Gemini key, whoever makes the videos, saying how to fix it', () => {
    for (const generationProvider of ['fal', 'google'] as const) {
      expect(
        voiceUnavailableReason(geminiPreset, {
          elevenlabsKey: false,
          geminiKey: false,
          generationProvider,
        }),
      ).toBe('Needs a Gemini key: add it in Setup')
    }
    expect(NEEDS_GEMINI_KEY_LABEL).toBe('Needs a Gemini key: add it in Setup')
  })

  it('lets Gemini voices be picked with a Gemini key, also while fal makes the videos', () => {
    expect(
      voiceUnavailableReason(geminiPreset, {
        elevenlabsKey: false,
        geminiKey: true,
        generationProvider: 'fal',
      }),
    ).toBeUndefined()
    // Until the engines report loads, nothing is greyed out.
    expect(voiceUnavailableReason(geminiPreset, undefined)).toBeUndefined()
  })

  it("greys out a Gemini voice by the API's own reason, before the engines report loads", () => {
    const keyless = { ...geminiPreset, unavailableReason: NEEDS_GEMINI_KEY_LABEL }
    expect(voiceUnavailableReason(keyless, undefined)).toBe(NEEDS_GEMINI_KEY_LABEL)
    expect(
      voiceUnavailableReason(keyless, {
        elevenlabsKey: false,
        geminiKey: false,
        generationProvider: 'fal',
      }),
    ).toBe(NEEDS_GEMINI_KEY_LABEL)
  })

  it('greys out voices cloned on ElevenLabs when there is no key', () => {
    expect(voiceUnavailableReason(elevenLabsClone, { elevenlabsKey: false })).toBe(
      'Needs an ElevenLabs key',
    )
  })

  it('keeps presets, other clones, and everything with a key or before the report loads', () => {
    expect(
      voiceUnavailableReason({ provider: 'elevenlabs' }, { elevenlabsKey: false }),
    ).toBeUndefined()
    expect(
      voiceUnavailableReason(
        { provider: 'fal', voiceCloneId: 'clone-2' },
        { elevenlabsKey: false },
      ),
    ).toBeUndefined()
    expect(voiceUnavailableReason(elevenLabsClone, { elevenlabsKey: true })).toBeUndefined()
    expect(voiceUnavailableReason(elevenLabsClone, undefined)).toBeUndefined()
  })

  /** The engines report while Gemini makes the voices, without an ElevenLabs key. */
  const onGemini = (qwen3Clone: { available: boolean; reason?: string }) => ({
    elevenlabsKey: false,
    generationProvider: 'google' as const,
    qwen3Clone,
  })
  const LOCAL = 'Needs the free local voices: run pnpm reelmakeeasy setup'

  it('on Gemini, greys out MiniMax clones, which run on fal', () => {
    const report = onGemini({ available: true })
    expect(voiceUnavailableReason({ provider: 'fal', voiceCloneId: 'clone-2' }, report)).toBe(
      'Runs on fal: pick fal in Setup',
    )
    expect(voiceUnavailableReason({ provider: 'minimax', voiceCloneId: 'clone-3' }, report)).toBe(
      'Runs on fal: pick fal in Setup',
    )
    // On fal they speak as before.
    expect(
      voiceUnavailableReason(
        { provider: 'fal', voiceCloneId: 'clone-2' },
        { ...report, generationProvider: 'fal' },
      ),
    ).toBeUndefined()
  })

  it('on Gemini, greys out Qwen3 clones without the local voices, and never presets', () => {
    const qwen3Clone = { provider: 'qwen3', voiceCloneId: 'clone-4' }
    expect(voiceUnavailableReason(qwen3Clone, onGemini({ available: false, reason: LOCAL }))).toBe(
      LOCAL,
    )
    expect(voiceUnavailableReason(qwen3Clone, onGemini({ available: true }))).toBeUndefined()
    // The API lists only the presets that can speak, so preset rows are left alone.
    expect(
      voiceUnavailableReason({ provider: 'qwen3' }, onGemini({ available: false, reason: LOCAL })),
    ).toBeUndefined()
    expect(
      voiceUnavailableReason({ provider: 'gemini' }, onGemini({ available: false, reason: LOCAL })),
    ).toBeUndefined()
  })
})
