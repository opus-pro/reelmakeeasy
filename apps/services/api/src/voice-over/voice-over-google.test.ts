import { resetGenerationProviderForTesting, setGenerationProvider } from '@reelmakeeasy/llm/registry'
import { BadRequestException } from '@nestjs/common'

import { defaultVoiceOption } from './voice-over'
import { VoiceOverService } from './voice-over.service'

const mockGeminiTextToSpeech = jest.fn()
const mockViaFal = jest.fn()

jest.mock('@shared/db-access-layer', () => ({
  getUserVoiceCloneDataService: () => ({ getProviderByVoiceId: async () => null }),
}))
jest.mock('@reelmakeeasy/common/tts/gemini-tts', () => ({
  geminiTextToSpeech: (...args: unknown[]) => mockGeminiTextToSpeech(...args),
  geminiTtsModelName: () => 'gemini-tts',
}))
// Phase 2's Eleven v3 on fal. The model name is mocked so a missing guard shows up as a call
// to fal, not as the registry error that `tts.elevenlabs: null` would throw on google.
jest.mock('@reelmakeeasy/common/tts/elevenlabs-fal', () => ({
  elevenLabsFalModelName: () => 'eleven-v3-fal',
  generateElevenLabsViaFal: (...args: unknown[]) => mockViaFal(...args),
  isElevenLabsFalModel: (name: string) => name === 'eleven-v3-fal',
}))
jest.mock('../util/audio-duration', () => ({ getAudioDurationSecondsFromBuffer: async () => 1.5 }))

/** Phase 2's private ElevenLabs preview, called directly: routing never sends a voice there on google. */
type ElevenLabsPreview = (args: {
  body: { voiceId: string }
  pronunciationDict: string[]
  startedAt: number
  text: string
}) => Promise<unknown>

const ENV = { ...process.env }
const SARAH = 'EXAVITQu4vr4xnSDxMaL'

beforeEach(() => {
  process.env = { ...ENV, FAL_KEY: 'f', GEMINI_API_KEY: 'g' }
  for (const name of ['ELEVENLABS_API_KEY', 'LOCAL_TTS_URL']) delete process.env[name]
  setGenerationProvider('google')
  mockGeminiTextToSpeech
    .mockReset()
    .mockResolvedValue({ audioBuffer: Buffer.from('mp3'), model: 'gemini-tts' })
  mockViaFal.mockReset().mockResolvedValue(Buffer.from('fal-mp3'))
})

afterEach(() => {
  process.env = ENV
  resetGenerationProviderForTesting()
})

describe('voices on Gemini', () => {
  it('lists only Gemini voices, even with FAL_KEY, with the Gemini default flagged', async () => {
    const { data } = await new VoiceOverService().getOptions('')
    expect(new Set(data.map((v) => v.provider))).toEqual(new Set(['gemini']))
    expect(data.find((v) => v.default)?.voiceId).toBe('gemini-achernar')
  })

  it('on fal lists the Gemini voices too, keeping the fal default', async () => {
    setGenerationProvider('fal')
    const { data } = await new VoiceOverService().getOptions('')
    const gemini = data.filter((v) => v.provider === 'gemini')
    expect(gemini).toHaveLength(30)
    expect(gemini.every((v) => !v.unavailableReason)).toBe(true)
    expect(data.some((v) => v.provider === 'kokoro')).toBe(true)
    expect(data.find((v) => v.default)?.voiceId).toBe('EXAVITQu4vr4xnSDxMaL')
  })

  it('on fal without GEMINI_API_KEY lists the Gemini voices, each saying why it cannot be picked', async () => {
    setGenerationProvider('fal')
    delete process.env['GEMINI_API_KEY']
    const { data } = await new VoiceOverService().getOptions('')
    const gemini = data.filter((v) => v.provider === 'gemini')
    expect(gemini).toHaveLength(30)
    expect(new Set(gemini.map((v) => v.unavailableReason))).toEqual(
      new Set(['Needs a Gemini key: add it in Setup']),
    )
    // Their stored previews still play: they ship with the app and need no key.
    expect(gemini.every((v) => v.needsPresignedUrl)).toBe(true)
    expect(data.find((v) => v.default)?.voiceId).toBe('EXAVITQu4vr4xnSDxMaL')
  })

  it('previews a Gemini voice with Gemini TTS on fal, with GEMINI_API_KEY', async () => {
    setGenerationProvider('fal')
    expect(
      await new VoiceOverService().generateTtsPreview({
        text: 'Hello there',
        voiceId: 'gemini-puck',
      }),
    ).toMatchObject({ model: 'gemini-tts', provider: 'gemini', voiceId: 'gemini-puck' })
    expect(mockGeminiTextToSpeech).toHaveBeenCalledWith(
      expect.objectContaining({ voiceId: 'gemini-puck' }),
    )
    expect(mockViaFal).not.toHaveBeenCalled()
  })

  it('refuses a Gemini voice preview without GEMINI_API_KEY in plain words', async () => {
    setGenerationProvider('fal')
    delete process.env['GEMINI_API_KEY']
    const preview = new VoiceOverService().generateTtsPreview({
      text: 'Hello there',
      voiceId: 'gemini-puck',
    })
    await expect(preview).rejects.toBeInstanceOf(BadRequestException)
    await expect(preview).rejects.toThrow('Needs a Gemini key: add it in Setup')
    expect(mockGeminiTextToSpeech).not.toHaveBeenCalled()
    expect(mockViaFal).not.toHaveBeenCalled()
  })

  it('on fal always reports Gemini as shown, and whether its key is set', async () => {
    setGenerationProvider('fal')
    const service = new VoiceOverService()
    const withKey = await service.getTtsEngines()
    expect(withKey.generationProvider).toBe('fal')
    expect(withKey.shown).toEqual(['gemini', 'kokoro', 'qwen3', 'elevenlabs'])
    expect(withKey.geminiKey).toBe(true)
    expect(withKey.engines.gemini).toEqual({ free: false, runsOn: 'google' })
    delete process.env['GEMINI_API_KEY']
    const withoutKey = await service.getTtsEngines()
    expect(withoutKey.shown).toContain('gemini')
    expect(withoutKey.geminiKey).toBe(false)
  })

  it('reports the engines, what is listed and which clone engines work', async () => {
    const engines = await new VoiceOverService().getTtsEngines()
    expect(engines.generationProvider).toBe('google')
    expect(engines.shown).toEqual(['gemini'])
    expect(engines.engines.gemini).toEqual({ free: false, runsOn: 'google' })
    expect(engines.qwen3Clone).toEqual({
      available: false,
      reason: 'Needs the free local voices: run pnpm reelmakeeasy setup',
    })
  })

  it('previews a Gemini voice, and the Gemini default when none is given', async () => {
    const service = new VoiceOverService()
    expect(
      await service.generateTtsPreview({ text: 'Hello there', voiceId: 'gemini-puck' }),
    ).toMatchObject({
      contentType: 'audio/mpeg',
      model: 'gemini-tts',
      provider: 'gemini',
      voiceId: 'gemini-puck',
    })
    expect(await service.generateTtsPreview({ text: 'Hello there' })).toMatchObject({
      voiceId: 'gemini-achernar',
    })
  })

  it('falls back to the Gemini default voice for new projects', () => {
    expect(defaultVoiceOption()).toMatchObject({ default: true, voiceId: 'gemini-achernar' })
  })

  it('previews an ElevenLabs voice as the Gemini default, and never runs ElevenLabs on fal', async () => {
    const service = new VoiceOverService()
    expect(await service.generateTtsPreview({ text: 'Hello there', voiceId: SARAH })).toMatchObject(
      { provider: 'gemini', resolvedVoiceId: 'gemini-achernar', voiceId: SARAH },
    )
    // Anything that still reaches the ElevenLabs preview is refused before fal.
    const direct = (
      service as unknown as { generateElevenLabsPreview: ElevenLabsPreview }
    ).generateElevenLabsPreview({
      body: { voiceId: SARAH },
      pronunciationDict: [],
      startedAt: Date.now(),
      text: 'Hello there',
    })
    await expect(direct).rejects.toBeInstanceOf(BadRequestException)
    await expect(direct).rejects.toThrow('Needs an ElevenLabs key')
    expect(mockViaFal).not.toHaveBeenCalled()
  })
})
