import { writeFile } from 'node:fs/promises'

const mockSubscribe = jest.fn()
const mockDownload = jest.fn()
const mockRunFfmpeg = jest.fn()
const mockFalVoice = jest.fn((voiceId: string): null | string => voiceId)

jest.mock('@reelmakeeasy/llm/fal', () => ({
  download: (url: string) => mockDownload(url),
  fal: {
    storage: { upload: jest.fn() },
    subscribe: (...args: unknown[]) => mockSubscribe(...args),
  },
}))
jest.mock('@reelmakeeasy/llm/registry', () => ({
  ...jest.requireActual('@reelmakeeasy/llm/registry'),
  resolveRole: () => ({
    adapter: 'elevenlabs-tts',
    endpoint: 'fal-ai/elevenlabs/tts/eleven-v3',
    endpoints: {},
    input: {},
    key: 'eleven-v3-fal',
    kind: 'tts',
    label: 'ElevenLabs v3 (on fal)',
    provider: 'fal',
  }),
}))
// No FFmpeg in CI: every FFmpeg run writes a marker to its output path (the last argument).
jest.mock('../utils/cmdline', () => ({
  runFfmpeg: (...args: string[]) => mockRunFfmpeg(...args),
}))
jest.mock('./preset-voices', () => ({
  falElevenLabsVoice: (voiceId: string) => mockFalVoice(voiceId),
}))

import {
  elevenLabsFalModelName,
  generateElevenLabsViaFal,
  isElevenLabsFalModel,
} from './elevenlabs-fal'

const MP3 = Buffer.from('fal-mp3')
const VOICE_ID = 'EXAVITQu4vr4xnSDxMaL'
const falAudio = (audio: { content_type?: string; url: string }) => ({
  data: { audio },
  requestId: 'fal-1',
})

beforeEach(() => {
  mockSubscribe
    .mockReset()
    .mockResolvedValue(falAudio({ content_type: 'audio/mpeg', url: 'https://fal.media/out.mp3' }))
  mockDownload.mockReset().mockResolvedValue(MP3)
  mockRunFfmpeg.mockReset().mockImplementation(async (...args: string[]) => {
    await writeFile(args[args.length - 1] as string, Buffer.from('ffmpeg-out'))
  })
  mockFalVoice.mockReset().mockImplementation((voiceId) => voiceId)
})

describe('generateElevenLabsViaFal', () => {
  it('sends the voice fal takes for the preset, with text and stability, and returns the MP3', async () => {
    const audio = await generateElevenLabsViaFal({ text: 'Hello there', voiceId: VOICE_ID })
    expect(mockSubscribe).toHaveBeenCalledWith(
      'fal-ai/elevenlabs/tts/eleven-v3',
      expect.objectContaining({
        input: { stability: 0.5, text: 'Hello there', voice: VOICE_ID },
      }),
    )
    expect(mockDownload).toHaveBeenCalledWith('https://fal.media/out.mp3')
    expect(audio.equals(MP3)).toBe(true)
    expect(mockRunFfmpeg).not.toHaveBeenCalled()
  })

  it('sends a recorded fal name, and the script language', async () => {
    mockFalVoice.mockReturnValueOnce('Sarah')
    await generateElevenLabsViaFal({ languageCode: 'en', text: 'Hi', voiceId: VOICE_ID })
    expect(mockSubscribe.mock.calls[0]?.[1].input).toEqual({
      language_code: 'en',
      stability: 0.5,
      text: 'Hi',
      voice: 'Sarah',
    })
  })

  it('refuses a voice fal cannot speak without calling fal', async () => {
    mockFalVoice.mockReturnValueOnce(null)
    await expect(
      generateElevenLabsViaFal({ text: 'Hi', voiceId: 'myElevenClone' }),
    ).rejects.toThrow('Needs an ElevenLabs key')
    expect(mockSubscribe).not.toHaveBeenCalled()
  })

  it('passes a fal failure straight through after one call', async () => {
    mockSubscribe.mockRejectedValueOnce(new Error('fal result failed (500): upstream error'))
    await expect(generateElevenLabsViaFal({ text: 'Hi', voiceId: VOICE_ID })).rejects.toThrow(
      'failed (500)',
    )
    expect(mockSubscribe).toHaveBeenCalledTimes(1)
  })

  it('converts audio that is not MP3', async () => {
    mockSubscribe.mockResolvedValueOnce(
      falAudio({ content_type: 'audio/wav', url: 'https://fal.media/out.wav' }),
    )
    const audio = await generateElevenLabsViaFal({ text: 'Hi', voiceId: VOICE_ID })
    expect(mockRunFfmpeg).toHaveBeenCalledWith(
      '-i',
      expect.stringMatching(/in\.wav$/),
      '-codec:a',
      'libmp3lame',
      '-b:a',
      '192k',
      expect.stringMatching(/out\.mp3$/),
    )
    expect(audio.toString()).toBe('ffmpeg-out')
  })

  it('applies a speed other than 1 with FFmpeg', async () => {
    await generateElevenLabsViaFal({ speed: 1.1, text: 'Hi', voiceId: VOICE_ID })
    expect(mockRunFfmpeg).toHaveBeenCalledWith(
      '-i',
      expect.stringMatching(/in\.mp3$/),
      '-filter:a',
      'atempo=1.1',
      '-codec:a',
      'libmp3lame',
      '-b:a',
      '192k',
      expect.stringMatching(/out\.mp3$/),
    )
  })

  it('names the fal model', () => {
    expect(elevenLabsFalModelName()).toBe('eleven-v3-fal')
    expect(isElevenLabsFalModel('eleven-v3-fal')).toBe(true)
    expect(isElevenLabsFalModel('eleven_v3')).toBe(false)
  })
})
