import { DEFAULT_VOICE_ID } from '@reelmakeeasy/common/tts/preset-voices'

interface ViaFalInput {
  languageCode?: string
  text: string
  voiceId: string
}

const mockViaFal = jest.fn(async (_input: ViaFalInput) => Buffer.from('fal-mp3'))
const mockDirect = jest.fn(
  async (_text: string, _voiceId: string, _modelId: string, _languageCode?: string) => ({
    audioBuffer: Buffer.from('direct-mp3'),
  }),
)
const mockCloneProvider = jest.fn(async (_voiceId: string): Promise<null | string> => null)

jest.mock('@shared/db-access-layer', () => ({
  getUserVoiceCloneDataService: () => ({
    getFalCounterpartVoiceId: async () => null,
    getProviderByVoiceId: (voiceId: string) => mockCloneProvider(voiceId),
    getQwen3Speaker: async () => null,
  }),
}))
jest.mock('@reelmakeeasy/common/tts/elevenlabs-fal', () => ({
  elevenLabsFalModelName: () => 'eleven-v3-fal',
  generateElevenLabsViaFal: (input: ViaFalInput) => mockViaFal(input),
}))
jest.mock('@reelmakeeasy/common/tts/qwen3-voice', () => ({ qwen3VoiceReference: () => ({}) }))
jest.mock('./elevenlabs-audio-pipeline.util', () => ({
  generateTTSAudio: (text: string, voiceId: string, modelId: string, languageCode?: string) =>
    mockDirect(text, voiceId, modelId, languageCode),
}))

import { generateTTSAudio, resolveTtsModel, resolveVoiceRoute } from './provider-tts.util'

const KEY = 'ELEVENLABS_API_KEY'
const savedKey = process.env[KEY]

beforeEach(() => {
  mockViaFal.mockClear()
  mockDirect.mockClear()
  mockCloneProvider.mockReset().mockResolvedValue(null)
})

afterAll(() => {
  if (savedKey === undefined) delete process.env[KEY]
  else process.env[KEY] = savedKey
})

describe('ElevenLabs voices without a key', () => {
  beforeEach(() => {
    delete process.env[KEY]
  })

  it('speaks through fal, with the script language', async () => {
    const result = await generateTTSAudio(
      'Hello there.',
      DEFAULT_VOICE_ID,
      'eleven-v3-fal',
      'elevenlabs',
      undefined,
      { languageCode: 'en' },
    )
    expect(mockViaFal).toHaveBeenCalledWith({
      languageCode: 'en',
      text: 'Hello there.',
      voiceId: DEFAULT_VOICE_ID,
    })
    expect(mockDirect).not.toHaveBeenCalled()
    expect(result).toEqual({ audioBuffer: Buffer.from('fal-mp3') })
  })

  it('names the fal model', () => {
    expect(resolveTtsModel('elevenlabs')).toBe('eleven-v3-fal')
  })

  it('keeps an ElevenLabs preset', async () => {
    await expect(resolveVoiceRoute(DEFAULT_VOICE_ID)).resolves.toEqual({
      provider: 'elevenlabs',
      voiceId: DEFAULT_VOICE_ID,
    })
  })

  it('replaces a cloned ElevenLabs voice with the default voice', async () => {
    mockCloneProvider.mockResolvedValueOnce('elevenlabs')
    await expect(resolveVoiceRoute('myElevenClone')).resolves.toEqual({
      provider: 'elevenlabs',
      substitutedFrom: 'myElevenClone',
      voiceId: DEFAULT_VOICE_ID,
    })
  })

  it('replaces any other ElevenLabs id with the default voice', async () => {
    await expect(resolveVoiceRoute('someLibraryVoiceId')).resolves.toEqual({
      provider: 'elevenlabs',
      substitutedFrom: 'someLibraryVoiceId',
      voiceId: DEFAULT_VOICE_ID,
    })
  })
})

describe('ElevenLabs voices with a key', () => {
  beforeEach(() => {
    process.env[KEY] = 'el-test'
  })

  it('calls ElevenLabs directly', async () => {
    const result = await generateTTSAudio(
      'Hello there.',
      DEFAULT_VOICE_ID,
      'eleven_v3',
      'elevenlabs',
    )
    expect(mockDirect).toHaveBeenCalledWith(
      'Hello there.',
      DEFAULT_VOICE_ID,
      'eleven_v3',
      undefined,
    )
    expect(mockViaFal).not.toHaveBeenCalled()
    expect(result.audioBuffer.toString()).toBe('direct-mp3')
  })

  it('keeps cloned and other ElevenLabs voices', async () => {
    mockCloneProvider.mockResolvedValueOnce('elevenlabs')
    await expect(resolveVoiceRoute('myElevenClone')).resolves.toEqual({
      provider: 'elevenlabs',
      voiceId: 'myElevenClone',
    })
    await expect(resolveVoiceRoute('someLibraryVoiceId')).resolves.toEqual({
      provider: 'elevenlabs',
      voiceId: 'someLibraryVoiceId',
    })
  })

  it('reports the ElevenLabs model id', () => {
    expect(resolveTtsModel('elevenlabs')).toBe('eleven_v3')
  })
})
