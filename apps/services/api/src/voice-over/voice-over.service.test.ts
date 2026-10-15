import { DEFAULT_VOICE_ID } from '@reelmakeeasy/common/tts/preset-voices'

interface ViaFalInput {
  speed?: number
  stability?: number
  text: string
  voiceId: string
}

const mockViaFal = jest.fn(async (_input: ViaFalInput) => Buffer.from('fal-mp3'))
const mockFetch = jest.fn(
  async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(new Uint8Array([1, 2, 3])),
)

jest.mock('@agent-lib/agents/story-loader/voice-tools/utils/provider-tts.util', () => ({
  generateTTSAudio: jest.fn(),
  resolveTtsModel: jest.fn(),
  resolveVoiceRoute: async (voiceId: string) => ({ provider: 'elevenlabs', voiceId }),
}))
jest.mock('@reelmakeeasy/common/tts/elevenlabs-fal', () => ({
  elevenLabsFalModelName: () => 'eleven-v3-fal',
  generateElevenLabsViaFal: (input: ViaFalInput) => mockViaFal(input),
  isElevenLabsFalModel: (name: string) => name === 'eleven-v3-fal',
}))
jest.mock('@reelmakeeasy/common/tts/local-tts', () => ({ localTtsHealth: async () => null }))
jest.mock('../prisma/prisma.service', () => ({ PrismaService: class {} }))
jest.mock('../util/audio-duration', () => ({ getAudioDurationSecondsFromBuffer: async () => 1.5 }))

import { VoiceOverService } from './voice-over.service'

const ENV_KEYS = ['ELEVENLABS_API_KEY', 'FAL_KEY'] as const
const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]))
const sentModel = () =>
  (JSON.parse(String(mockFetch.mock.calls[0]?.[1]?.body)) as { model_id: string }).model_id

beforeEach(() => {
  mockViaFal.mockClear()
  mockFetch.mockClear()
  global.fetch = mockFetch as unknown as typeof fetch
})

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = saved[key]
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('ElevenLabs previews without a key', () => {
  beforeEach(() => {
    delete process.env['ELEVENLABS_API_KEY']
  })

  it('speaks a preset voice through fal', async () => {
    const result = await new VoiceOverService().generateTtsPreview({
      text: 'Hello there',
      voiceId: DEFAULT_VOICE_ID,
    })
    expect(mockViaFal).toHaveBeenCalledWith({
      speed: 1,
      stability: 0.5,
      text: 'Hello there',
      voiceId: DEFAULT_VOICE_ID,
    })
    expect(mockFetch).not.toHaveBeenCalled()
    expect(result).toMatchObject({
      audioBase64: Buffer.from('fal-mp3').toString('base64'),
      model: 'eleven-v3-fal',
      provider: 'elevenlabs',
      voiceId: DEFAULT_VOICE_ID,
    })
  })

  it('refuses a voice cloned on ElevenLabs', async () => {
    await expect(
      new VoiceOverService().generateTtsPreview({
        provider: 'elevenlabs',
        text: 'Hello there',
        voiceId: 'myElevenClone',
      }),
    ).rejects.toThrow('Needs an ElevenLabs key')
    expect(mockViaFal).not.toHaveBeenCalled()
  })
})

describe('ElevenLabs previews with a key', () => {
  beforeEach(() => {
    process.env['ELEVENLABS_API_KEY'] = 'el-test'
  })

  it('calls ElevenLabs directly', async () => {
    const result = await new VoiceOverService().generateTtsPreview({
      text: 'Hello there',
      voiceId: DEFAULT_VOICE_ID,
    })
    expect(String(mockFetch.mock.calls[0]?.[0])).toBe(
      `https://api.elevenlabs.io/v1/text-to-speech/${DEFAULT_VOICE_ID}?output_format=mp3_44100_128`,
    )
    expect(mockViaFal).not.toHaveBeenCalled()
    expect(result.model).toBe('eleven_v3')
  })

  it('swaps the fal model a keyless preview saved for the ElevenLabs one', async () => {
    const result = await new VoiceOverService().generateTtsPreview({
      model: 'eleven-v3-fal',
      text: 'Hello there',
      voiceId: DEFAULT_VOICE_ID,
    })
    expect(sentModel()).toBe('eleven_v3')
    expect(result.model).toBe('eleven_v3')
  })
})

describe('getTtsEngines', () => {
  it('reports ElevenLabs through fal without a key, and always lists Gemini', async () => {
    delete process.env['ELEVENLABS_API_KEY']
    delete process.env['GEMINI_API_KEY']
    process.env['FAL_KEY'] = 'fal-test'
    await expect(new VoiceOverService().getTtsEngines()).resolves.toEqual({
      elevenlabsKey: false,
      engines: {
        elevenlabs: { free: false, runsOn: 'fal' },
        gemini: { free: false, runsOn: 'google' },
        kokoro: { free: false, runsOn: 'fal' },
        qwen3: { free: false, runsOn: 'fal' },
      },
      geminiKey: false,
      generationProvider: 'fal',
      qwen3Clone: { available: true },
      shown: ['gemini', 'kokoro', 'qwen3', 'elevenlabs'],
      standardClone: 'minimax',
    })
  })

  it("reports the user's own ElevenLabs account with a key", async () => {
    process.env['ELEVENLABS_API_KEY'] = 'el-test'
    delete process.env['FAL_KEY']
    const engines = await new VoiceOverService().getTtsEngines()
    expect(engines.elevenlabsKey).toBe(true)
    expect(engines.engines.elevenlabs).toEqual({ free: false, runsOn: 'elevenlabs' })
    expect(engines.standardClone).toBe('elevenlabs')
  })
})
