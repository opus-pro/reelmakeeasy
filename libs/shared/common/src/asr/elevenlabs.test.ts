import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  resetGenerationProviderForTesting,
  setGenerationUnavailable,
} from '@reelmakeeasy/llm/registry'

const mockFalSpeechToText = jest.fn()
const mockFalForcedAlignment = jest.fn()
const mockLocalSpeechToText = jest.fn()
const mockLocalForcedAlignment = jest.fn()
const mockLocalSttSupports = jest.fn(async (_kind: string) => false)

jest.mock('./fal-scribe', () => ({
  falForcedAlignment: (...args: unknown[]) => mockFalForcedAlignment(...args),
  falSpeechToText: (...args: unknown[]) => mockFalSpeechToText(...args),
}))
jest.mock('./local-asr', () => ({
  localForcedAlignment: (...args: unknown[]) => mockLocalForcedAlignment(...args),
  localSpeechToText: (...args: unknown[]) => mockLocalSpeechToText(...args),
}))
jest.mock('../tts/local-tts', () => ({
  localSttSupports: (kind: string) => mockLocalSttSupports(kind),
}))

import { generateASRTranscription, generateForcedAlignment, speechToText } from './elevenlabs'

const KEY = 'ELEVENLABS_API_KEY'
const savedKey = process.env[KEY]
const mockFetch = jest.fn(
  async (_input: RequestInfo | URL, _init?: RequestInit) =>
    new Response(
      JSON.stringify({
        characters: [],
        language_code: 'eng',
        language_probability: 1,
        text: 'Hi',
        words: [],
      }),
    ),
)
let audioPath = ''

beforeAll(async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'asr-elevenlabs-'))
  audioPath = path.join(dir, 'voice.mp3')
  await writeFile(audioPath, Buffer.from('ID3-not-really-audio'))
})

beforeEach(() => {
  mockFetch.mockClear()
  global.fetch = mockFetch as unknown as typeof fetch
  mockLocalSttSupports.mockReset().mockResolvedValue(false)
  mockLocalSpeechToText.mockReset()
  mockLocalForcedAlignment.mockReset()
  mockFalSpeechToText
    .mockReset()
    .mockResolvedValue({ languageCode: 'eng', languageProbability: 1, text: 'Hi', words: [] })
  mockFalForcedAlignment
    .mockReset()
    .mockResolvedValue({ characters: [], words: [{ end: 0.4, start: 0.1, text: 'Hi' }] })
})

afterAll(() => {
  if (savedKey === undefined) delete process.env[KEY]
  else process.env[KEY] = savedKey
})

describe('without ELEVENLABS_API_KEY', () => {
  beforeEach(() => {
    delete process.env[KEY]
  })

  it('transcribes on fal with speaker labels and audio events', async () => {
    const result = await generateASRTranscription(audioPath)
    expect(mockFalSpeechToText).toHaveBeenCalledWith(expect.any(Blob), {
      diarize: true,
      languageCode: undefined,
      tagAudioEvents: true,
    })
    expect(mockFetch).not.toHaveBeenCalled()
    expect(result.text).toBe('Hi')
  })

  it('passes a language code through', async () => {
    await speechToText({ file: new Blob(['x']), languageCode: 'eng', modelId: 'scribe_v2' })
    expect(mockFalSpeechToText).toHaveBeenCalledWith(expect.any(Blob), {
      diarize: undefined,
      languageCode: 'eng',
      tagAudioEvents: undefined,
    })
  })

  it('aligns a known script on fal', async () => {
    const result = await generateForcedAlignment(audioPath, 'Hi')
    expect(mockFalForcedAlignment).toHaveBeenCalledWith(expect.any(Blob), 'Hi')
    expect(result.words[0]?.text).toBe('Hi')
    expect(result.source).toBe('fal')
  })
})

describe('with ELEVENLABS_API_KEY', () => {
  beforeEach(() => {
    process.env[KEY] = 'el-test'
  })

  it('transcribes on ElevenLabs directly', async () => {
    await generateASRTranscription(audioPath)
    const [url, init] = mockFetch.mock.calls[0] ?? []
    expect(String(url)).toBe('https://api.elevenlabs.io/v1/speech-to-text')
    expect((init?.headers as Record<string, string>)['xi-api-key']).toBe('el-test')
    expect(mockFalSpeechToText).not.toHaveBeenCalled()
  })

  it('aligns on ElevenLabs directly', async () => {
    const result = await generateForcedAlignment(audioPath, 'Hi')
    expect(String(mockFetch.mock.calls[0]?.[0])).toBe(
      'https://api.elevenlabs.io/v1/forced-alignment',
    )
    expect(mockFalForcedAlignment).not.toHaveBeenCalled()
    expect(result.source).toBe('elevenlabs')
  })
})

describe('with speech to text on this computer', () => {
  const LOCAL_TRANSCRIPT = {
    languageCode: 'eng',
    languageProbability: 1,
    text: 'Hi',
    words: [{ end: 0.4, start: 0.1, text: 'Hi', type: 'word' }],
  }
  const LOCAL_ALIGNMENT = {
    characters: [],
    source: 'local-aligner',
    words: [{ end: 0.4, start: 0.1, text: 'Hi' }],
  }
  const localDown = () => new Error('Local speech to text failed (HTTP 500): out of memory')

  beforeEach(() => {
    delete process.env[KEY]
    delete process.env['LOCAL_ASR']
    mockLocalSttSupports.mockResolvedValue(true)
    mockLocalSpeechToText.mockResolvedValue(LOCAL_TRANSCRIPT)
    mockLocalForcedAlignment.mockResolvedValue(LOCAL_ALIGNMENT)
  })

  afterEach(() => {
    delete process.env['LOCAL_ASR']
    resetGenerationProviderForTesting()
  })

  it('transcribes locally, in the language asked for', async () => {
    const file = new Blob(['x'])
    const result = await speechToText({ file, languageCode: 'eng', modelId: 'scribe_v2' })
    expect(mockLocalSpeechToText).toHaveBeenCalledWith(file, { languageCode: 'eng' })
    expect(result).toBe(LOCAL_TRANSCRIPT)
    expect(mockFalSpeechToText).not.toHaveBeenCalled()
  })

  it('makes the quality-check transcript locally without an ElevenLabs key', async () => {
    await expect(generateASRTranscription(audioPath)).resolves.toBe(LOCAL_TRANSCRIPT)
    expect(mockLocalSpeechToText).toHaveBeenCalledWith(expect.any(Blob), {
      languageCode: undefined,
    })
    expect(mockFalSpeechToText).not.toHaveBeenCalled()
  })

  it('keeps the quality-check transcript on ElevenLabs Scribe when its key is set', async () => {
    process.env[KEY] = 'el-test'
    await generateASRTranscription(audioPath)
    expect(String(mockFetch.mock.calls[0]?.[0])).toBe('https://api.elevenlabs.io/v1/speech-to-text')
    expect(mockLocalSpeechToText).not.toHaveBeenCalled()
  })

  it('transcribes locally with an ElevenLabs key when no speaker labels or events are asked', async () => {
    process.env[KEY] = 'el-test'
    await speechToText({ file: new Blob(['x']), modelId: 'scribe_v2' })
    expect(mockLocalSpeechToText).toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('times a known script locally, even with an ElevenLabs key', async () => {
    process.env[KEY] = 'el-test'
    const result = await generateForcedAlignment(audioPath, 'Hi')
    expect(mockLocalForcedAlignment).toHaveBeenCalledWith(expect.any(Blob), 'Hi')
    expect(result).toBe(LOCAL_ALIGNMENT)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('returns local timings as they are, so a failed timing check never leads to a paid call', async () => {
    const unusable = { ...LOCAL_ALIGNMENT, words: [{ end: 0.1, start: 0.1, text: 'Hi' }] }
    mockLocalForcedAlignment.mockResolvedValue(unusable)
    await expect(generateForcedAlignment(audioPath, 'Hi there')).resolves.toBe(unusable)
    expect(mockFalForcedAlignment).not.toHaveBeenCalled()
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it('falls back to the cloud when local speech to text fails', async () => {
    mockLocalSpeechToText.mockRejectedValue(localDown())
    await expect(
      speechToText({ file: new Blob(['x']), languageCode: 'eng', modelId: 'scribe_v2' }),
    ).resolves.toMatchObject({ text: 'Hi' })
    expect(mockFalSpeechToText).toHaveBeenCalledWith(expect.any(Blob), {
      diarize: undefined,
      languageCode: 'eng',
      tagAudioEvents: undefined,
    })
  })

  it('falls back to the cloud when the local quality-check transcript fails', async () => {
    mockLocalSpeechToText.mockRejectedValue(localDown())
    await generateASRTranscription(audioPath)
    expect(mockFalSpeechToText).toHaveBeenCalledWith(expect.any(Blob), {
      diarize: true,
      languageCode: undefined,
      tagAudioEvents: true,
    })
  })

  it('falls back to the cloud when local alignment fails', async () => {
    mockLocalForcedAlignment.mockRejectedValue(localDown())
    const onFal = await generateForcedAlignment(audioPath, 'Hi')
    expect(mockFalForcedAlignment).toHaveBeenCalledWith(expect.any(Blob), 'Hi')
    expect(onFal.source).toBe('fal')

    process.env[KEY] = 'el-test'
    const direct = await generateForcedAlignment(audioPath, 'Hi')
    expect(String(mockFetch.mock.calls[0]?.[0])).toBe(
      'https://api.elevenlabs.io/v1/forced-alignment',
    )
    expect(direct.source).toBe('elevenlabs')
  })

  it('uses the cloud for all three with LOCAL_ASR=off', async () => {
    process.env['LOCAL_ASR'] = 'off'
    await speechToText({ file: new Blob(['x']), modelId: 'scribe_v2' })
    await generateASRTranscription(audioPath)
    await generateForcedAlignment(audioPath, 'Hi')
    expect(mockLocalSpeechToText).not.toHaveBeenCalled()
    expect(mockLocalForcedAlignment).not.toHaveBeenCalled()
    expect(mockFalSpeechToText).toHaveBeenCalledTimes(2)
    expect(mockFalForcedAlignment).toHaveBeenCalledTimes(1)
  })

  it('runs locally when no cloud backend can run, and says why local failed', async () => {
    setGenerationUnavailable('FAL_KEY is missing')
    await expect(generateForcedAlignment(audioPath, 'Hi')).resolves.toBe(LOCAL_ALIGNMENT)
    mockLocalForcedAlignment.mockRejectedValue(localDown())
    await expect(generateForcedAlignment(audioPath, 'Hi')).rejects.toThrow(/HTTP 500/)
    expect(mockFalForcedAlignment).not.toHaveBeenCalled()
  })
})
