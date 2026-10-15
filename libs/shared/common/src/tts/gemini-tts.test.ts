const mockGenerateContent = jest.fn()
const mockAssertGenerationReady = jest.fn()

jest.mock('@reelmakeeasy/llm', () => ({
  fal: { storage: { upload: jest.fn() }, subscribe: jest.fn() },
  inlineParts: jest.requireActual('@reelmakeeasy/llm/google').inlineParts,
  runGoogle: { generateContent: (...args: unknown[]) => mockGenerateContent(...args) },
}))
jest.mock('@reelmakeeasy/llm/registry', () => ({
  assertGenerationReady: () => mockAssertGenerationReady(),
  resolveRole: (role: string) =>
    role === 'tts.gemini'
      ? {
          endpoints: {},
          input: {},
          key: 'gemini-tts',
          kind: 'tts',
          label: 'Gemini TTS',
          model: 'gemini-3.8-flash-tts',
          provider: 'google',
        }
      : null,
}))
// No FFmpeg in CI: "transcoding" copies the input to the output path.
jest.mock('../utils/cmdline', () => ({
  runFfmpeg: async (...args: string[]) => {
    const { copyFile } = jest.requireActual<typeof import('node:fs/promises')>('node:fs/promises')
    await copyFile(args[args.indexOf('-i') + 1] as string, args[args.length - 1] as string)
  },
}))

type GeminiTts = typeof import('./gemini-tts')

let tts: GeminiTts
const pcm = Buffer.alloc(480) // 10 ms of silence at 24 kHz, 16-bit

beforeEach(() => {
  mockGenerateContent.mockReset()
  mockAssertGenerationReady.mockReset()
  jest.isolateModules(() => {
    tts = require('./gemini-tts')
  })
})

const answer = (data: Buffer, mimeType: string) => ({
  candidates: [
    { content: { parts: [{ inlineData: { data: data.toString('base64'), mimeType } }] } },
  ],
})

describe('Gemini TTS', () => {
  it('speaks with the prebuilt voice and drops delivery tags', async () => {
    mockGenerateContent.mockResolvedValue(answer(tts.pcmToWav(pcm), 'audio/wav'))
    const result = await tts.geminiTextToSpeech({
      text: '[excited] Hello there!',
      voiceId: 'gemini-kore',
    })
    expect(mockGenerateContent).toHaveBeenCalledWith('gemini-3.8-flash-tts', {
      contents: [{ parts: [{ text: 'Hello there!' }], role: 'user' }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: { voiceConfig: { voice: 'Kore' } },
      },
    })
    expect(result.model).toBe('gemini-tts')
    expect(result.audioBuffer.subarray(0, 4).toString('ascii')).toBe('RIFF')
  })

  it('wraps raw PCM in a WAV header before converting', async () => {
    mockGenerateContent.mockResolvedValue(answer(pcm, 'audio/L16;codec=pcm;rate=24000'))
    const result = await tts.geminiTextToSpeech({ text: 'Hi', voiceId: 'gemini-puck' })
    expect(result.audioBuffer.length).toBe(pcm.length + 44)
    expect(result.audioBuffer.readUInt32LE(24)).toBe(24000)
  })

  it('refuses ids that are not Gemini voices', async () => {
    await expect(
      tts.geminiTextToSpeech({ text: 'Hi', voiceId: 'EXAVITQu4vr4xnSDxMaL' }),
    ).rejects.toThrow(/Not a Gemini voice id/)
  })

  it('fails with the Setup reason, before calling Gemini, when generation cannot run', async () => {
    mockAssertGenerationReady.mockImplementation(() => {
      throw new Error('GEMINI_API_KEY is missing')
    })
    await expect(tts.geminiTextToSpeech({ text: 'Hi', voiceId: 'gemini-kore' })).rejects.toThrow(
      /GEMINI_API_KEY is missing/,
    )
    expect(mockGenerateContent).not.toHaveBeenCalled()
  })
})
