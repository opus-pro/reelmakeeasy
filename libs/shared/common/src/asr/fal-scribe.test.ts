const FAL_URL = 'https://fal.media/files/voice.wav'
const mockSubscribe = jest.fn()
const mockUpload = jest.fn(async (_file: Blob) => FAL_URL)

jest.mock('@reelmakeeasy/llm', () => ({
  fal: {
    storage: { upload: (file: Blob) => mockUpload(file) },
    subscribe: (...args: unknown[]) => mockSubscribe(...args),
  },
}))
jest.mock('@reelmakeeasy/llm/registry', () => ({
  resolveRole: (role: string) => ({
    endpoint:
      role === 'speech.transcribe'
        ? 'fal-ai/elevenlabs/speech-to-text/scribe-v2'
        : 'fal-ai/elevenlabs/forced-alignment',
    endpoints: {},
    input: {},
    key: role,
    kind: 'align',
    label: role,
    provider: 'fal',
  }),
}))

import { falForcedAlignment, falSpeechToText, sniffAudioFile } from './fal-scribe'

const ascii = (text: string) => new Uint8Array(Buffer.from(text, 'latin1'))
const WAV = new Blob([ascii('RIFF\u0000\u0000\u0000\u0000WAVEfmt ')])

beforeEach(() => {
  mockSubscribe.mockReset()
  mockUpload.mockClear()
})

describe('sniffAudioFile', () => {
  it('names common audio containers from their first bytes', () => {
    expect(sniffAudioFile(ascii('RIFF\u0000\u0000\u0000\u0000WAVEfmt '))).toEqual({
      ext: '.wav',
      type: 'audio/wav',
    })
    expect(sniffAudioFile(ascii('ID3\u0004\u0000\u0000'))).toEqual({
      ext: '.mp3',
      type: 'audio/mpeg',
    })
    expect(sniffAudioFile(ascii('OggS\u0000\u0002'))).toEqual({ ext: '.ogg', type: 'audio/ogg' })
    expect(sniffAudioFile(ascii('fLaC\u0000\u0000'))).toEqual({ ext: '.flac', type: 'audio/flac' })
    expect(sniffAudioFile(ascii('\u0000\u0000\u0000 ftypM4A '))).toEqual({
      ext: '.m4a',
      type: 'audio/mp4',
    })
    expect(sniffAudioFile(new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 0x01]))).toEqual({
      ext: '.webm',
      type: 'audio/webm',
    })
  })
})

describe('falSpeechToText', () => {
  it('uploads a named audio file and maps Scribe words to the client shape', async () => {
    mockSubscribe.mockResolvedValue({
      data: {
        language_code: 'eng',
        language_probability: 0.98,
        text: 'Hey there',
        words: [
          { end: 0.5, speaker_id: 'speaker_0', start: 0.1, text: 'Hey', type: 'word' },
          { end: 0.6, speaker_id: 'speaker_0', start: 0.5, text: ' ', type: 'spacing' },
          { end: 1, start: 0.6, text: 'there', type: 'word' },
        ],
      },
      requestId: 'r1',
    })

    const result = await falSpeechToText(WAV, { diarize: true, tagAudioEvents: true })

    const uploaded = mockUpload.mock.calls[0]?.[0] as File
    expect(uploaded.name).toBe('audio.wav')
    expect(uploaded.type).toBe('audio/wav')
    const [endpoint, options] = mockSubscribe.mock.calls[0] as [string, { input: object }]
    expect(endpoint).toBe('fal-ai/elevenlabs/speech-to-text/scribe-v2')
    expect(options.input).toEqual({ audio_url: FAL_URL, diarize: true, tag_audio_events: true })
    expect(result).toEqual({
      languageCode: 'eng',
      languageProbability: 0.98,
      text: 'Hey there',
      words: [
        { end: 0.5, speakerId: 'speaker_0', start: 0.1, text: 'Hey', type: 'word' },
        { end: 0.6, speakerId: 'speaker_0', start: 0.5, text: ' ', type: 'spacing' },
        { end: 1, start: 0.6, text: 'there', type: 'word' },
      ],
    })
  })

  it('uses the direct API defaults: no speaker labels, audio events tagged', async () => {
    mockSubscribe.mockResolvedValue({ data: { words: [] }, requestId: 'r2' })
    const result = await falSpeechToText(WAV, { languageCode: 'eng' })
    expect(mockSubscribe.mock.calls[0]?.[1].input).toEqual({
      audio_url: FAL_URL,
      diarize: false,
      language_code: 'eng',
      tag_audio_events: true,
    })
    expect(result).toEqual({ languageCode: '', languageProbability: 0, text: '', words: [] })
  })

  it('keeps the file name and type a caller gave', async () => {
    mockSubscribe.mockResolvedValue({ data: { words: [] }, requestId: 'r3' })
    await falSpeechToText(new File([ascii('ID3')], 'take-1.mp3', { type: 'audio/mpeg' }))
    const uploaded = mockUpload.mock.calls[0]?.[0] as File
    expect(uploaded.name).toBe('take-1.mp3')
    expect(uploaded.type).toBe('audio/mpeg')
  })
})

describe('falForcedAlignment', () => {
  it('aligns a known script on fal', async () => {
    const data = {
      characters: [{ end: 0.2, start: 0.1, text: 'H' }],
      loss: 0.1,
      words: [{ end: 0.5, loss: 0.1, start: 0.1, text: 'Hey' }],
    }
    mockSubscribe.mockResolvedValue({ data, requestId: 'r4' })
    const result = await falForcedAlignment(WAV, 'Hey')
    const [endpoint, options] = mockSubscribe.mock.calls[0] as [string, { input: object }]
    expect(endpoint).toBe('fal-ai/elevenlabs/forced-alignment')
    expect(options.input).toEqual({ audio_url: FAL_URL, text: 'Hey' })
    expect(result).toEqual(data)
  })
})
