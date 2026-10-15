import { resetGenerationProviderForTesting, setGenerationProvider } from '@reelmakeeasy/llm/registry'

import { generateTTSAudio, resolveTtsModel, resolveVoiceRoute } from './provider-tts.util'

const mockGetFalCounterpartVoiceId = jest.fn()
const mockGetProviderByVoiceId = jest.fn()
const mockGeminiTextToSpeech = jest.fn()
const mockLocalTtsSupports = jest.fn()
const mockViaFal = jest.fn()

jest.mock('@shared/db-access-layer', () => ({
  getUserVoiceCloneDataService: () => ({
    getFalCounterpartVoiceId: (...args: unknown[]) => mockGetFalCounterpartVoiceId(...args),
    getProviderByVoiceId: (...args: unknown[]) => mockGetProviderByVoiceId(...args),
  }),
}))
jest.mock('@reelmakeeasy/common/tts/gemini-tts', () => ({
  geminiTextToSpeech: (...args: unknown[]) => mockGeminiTextToSpeech(...args),
  geminiTtsModelName: () => 'gemini-tts',
}))
jest.mock('@reelmakeeasy/common/tts/local-tts', () => ({
  ...jest.requireActual('@reelmakeeasy/common/tts/local-tts'),
  localTtsSupports: (...args: unknown[]) => mockLocalTtsSupports(...args),
}))
// Phase 2's Eleven v3 on fal. The model name is mocked so a missing guard shows up as a call
// to fal, not as the registry error that `tts.elevenlabs: null` would throw on google.
jest.mock('@reelmakeeasy/common/tts/elevenlabs-fal', () => ({
  elevenLabsFalModelName: () => 'eleven-v3-fal',
  generateElevenLabsViaFal: (...args: unknown[]) => mockViaFal(...args),
}))

const SARAH = 'EXAVITQu4vr4xnSDxMaL'
const ENV = { ...process.env }

beforeEach(() => {
  mockGeminiTextToSpeech.mockReset()
  mockGetFalCounterpartVoiceId.mockReset().mockResolvedValue(null)
  mockGetProviderByVoiceId.mockResolvedValue(null)
  mockLocalTtsSupports.mockResolvedValue(false)
  mockViaFal.mockReset().mockResolvedValue(Buffer.from('fal-mp3'))
  process.env = { ...ENV, GEMINI_API_KEY: 'g' }
  delete process.env['ELEVENLABS_API_KEY']
  delete process.env['FAL_KEY']
})

afterEach(() => {
  process.env = ENV
  resetGenerationProviderForTesting()
})

describe('Gemini voices on Gemini', () => {
  // Gemini TTS speaks only while Gemini makes the voices; 'on fal' below covers the other side.
  beforeEach(() => setGenerationProvider('google'))

  it('route to Gemini TTS', async () => {
    expect(await resolveVoiceRoute('gemini-kore')).toEqual({
      provider: 'gemini',
      voiceId: 'gemini-kore',
    })
    expect(resolveTtsModel('gemini')).toBe('gemini-tts')
  })

  it('speak through geminiTextToSpeech', async () => {
    mockGeminiTextToSpeech.mockResolvedValue({
      audioBuffer: Buffer.from('mp3'),
      model: 'gemini-tts',
    })
    const result = await generateTTSAudio('Hello', 'gemini-kore', 'gemini-tts', 'gemini')
    expect(result.audioBuffer.toString()).toBe('mp3')
    expect(mockGeminiTextToSpeech).toHaveBeenCalledWith({ text: 'Hello', voiceId: 'gemini-kore' })
  })

  it('keep a retired bare Gemini name as that Gemini voice', async () => {
    expect(await resolveVoiceRoute('Leda')).toEqual({
      provider: 'gemini',
      substitutedFrom: 'Leda',
      voiceId: 'gemini-leda',
    })
  })
})

describe('on Gemini, voices that would run on fal', () => {
  beforeEach(() => {
    setGenerationProvider('google')
    process.env['FAL_KEY'] = 'f'
  })

  it('speak as the Gemini default: ElevenLabs without its key', async () => {
    expect(await resolveVoiceRoute(SARAH)).toEqual({
      provider: 'gemini',
      substitutedFrom: SARAH,
      voiceId: 'gemini-achernar',
    })
  })

  it('speak as the Gemini default: Kokoro without the local voices', async () => {
    expect(await resolveVoiceRoute('kokoro-af_heart')).toMatchObject({
      provider: 'gemini',
      voiceId: 'gemini-achernar',
    })
    mockLocalTtsSupports.mockResolvedValue(true)
    expect(await resolveVoiceRoute('kokoro-af_heart')).toEqual({
      provider: 'kokoro',
      voiceId: 'kokoro-af_heart',
    })
  })

  it('speak as the Gemini default: a MiniMax clone', async () => {
    mockGetProviderByVoiceId.mockResolvedValue('fal')
    expect(await resolveVoiceRoute('minimax-clone-1')).toMatchObject({
      provider: 'gemini',
      voiceId: 'gemini-achernar',
    })
  })

  it('speak as the Gemini default: a legacy MiniMax clone, even with a fal re-clone', async () => {
    mockGetProviderByVoiceId.mockResolvedValue('minimax')
    mockGetFalCounterpartVoiceId.mockResolvedValue('fal-reclone-1')
    expect(await resolveVoiceRoute('legacy-minimax-1')).toEqual({
      provider: 'gemini',
      substitutedFrom: 'legacy-minimax-1',
      voiceId: 'gemini-achernar',
    })
    expect(mockGetFalCounterpartVoiceId).not.toHaveBeenCalled()
  })

  it('refuse ElevenLabs speech without its key, before anything reaches fal', async () => {
    await expect(generateTTSAudio('Hello', SARAH, 'eleven-v3-fal', 'elevenlabs')).rejects.toThrow(
      'Needs an ElevenLabs key',
    )
    expect(() => resolveTtsModel('elevenlabs')).toThrow('Needs an ElevenLabs key')
    expect(mockViaFal).not.toHaveBeenCalled()
  })
})

describe('on fal', () => {
  it('ElevenLabs voices still run through fal with FAL_KEY', async () => {
    process.env['FAL_KEY'] = 'f'
    expect(await resolveVoiceRoute(SARAH)).toEqual({ provider: 'elevenlabs', voiceId: SARAH })
    const result = await generateTTSAudio('Hello', SARAH, 'eleven-v3-fal', 'elevenlabs')
    expect(result.audioBuffer.toString()).toBe('fal-mp3')
    expect(mockViaFal).toHaveBeenCalledTimes(1)
  })

  it('a Gemini voice without GEMINI_API_KEY is refused in plain words, never swapped', async () => {
    delete process.env['GEMINI_API_KEY']
    process.env['FAL_KEY'] = 'f'
    await expect(resolveVoiceRoute('gemini-kore')).rejects.toThrow(
      'Needs a Gemini key: add it in Setup',
    )
    expect(mockGeminiTextToSpeech).not.toHaveBeenCalled()
    expect(mockViaFal).not.toHaveBeenCalled()
  })

  it('a Gemini voice speaks with Gemini TTS while fal makes the pictures and clips', async () => {
    // beforeEach set GEMINI_API_KEY; fal stays the generation provider.
    process.env['FAL_KEY'] = 'f'
    mockGeminiTextToSpeech.mockResolvedValue({
      audioBuffer: Buffer.from('gemini-mp3'),
      model: 'gemini-tts',
    })
    const route = await resolveVoiceRoute('gemini-kore')
    expect(route).toEqual({ provider: 'gemini', voiceId: 'gemini-kore' })
    expect(resolveTtsModel(route.provider)).toBe('gemini-tts')
    const result = await generateTTSAudio('Hello', route.voiceId, 'gemini-tts', route.provider)
    expect(result.audioBuffer.toString()).toBe('gemini-mp3')
    expect(mockGeminiTextToSpeech).toHaveBeenCalledWith({ text: 'Hello', voiceId: 'gemini-kore' })
    expect(mockViaFal).not.toHaveBeenCalled()
  })

  it('a retired bare Gemini name speaks as that Gemini voice with GEMINI_API_KEY', async () => {
    process.env['FAL_KEY'] = 'f'
    expect(await resolveVoiceRoute('Leda')).toEqual({
      provider: 'gemini',
      substitutedFrom: 'Leda',
      voiceId: 'gemini-leda',
    })
  })

  it('a retired bare Gemini name still speaks as Sarah without GEMINI_API_KEY', async () => {
    delete process.env['GEMINI_API_KEY']
    process.env['FAL_KEY'] = 'f'
    expect(await resolveVoiceRoute('Leda')).toEqual({
      provider: 'elevenlabs',
      substitutedFrom: 'Leda',
      voiceId: SARAH,
    })
  })

  it('a legacy MiniMax clone still speaks through its fal re-clone', async () => {
    mockGetProviderByVoiceId.mockResolvedValue('minimax')
    mockGetFalCounterpartVoiceId.mockResolvedValue('fal-reclone-1')
    expect(await resolveVoiceRoute('legacy-minimax-1')).toEqual({
      provider: 'fal',
      voiceId: 'fal-reclone-1',
    })
    expect(mockGetFalCounterpartVoiceId).toHaveBeenCalledWith('legacy-minimax-1')
  })
})
