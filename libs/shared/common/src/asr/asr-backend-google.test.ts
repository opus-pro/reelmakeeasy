import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import {
  resetGenerationProviderForTesting,
  setGenerationProvider,
  setGenerationUnavailable,
} from '@reelmakeeasy/llm/registry'

import { asrBackend, resolveAsrBackend } from './asr-backend'
import { generateASRTranscription, generateForcedAlignment, speechToText } from './elevenlabs'

const mockGeminiTranscribeBlob = jest.fn()
const mockGeminiForcedAlignment = jest.fn()
const mockLocalSttSupports = jest.fn(async (_kind: string) => false)

jest.mock('./gemini-transcribe', () => ({
  geminiForcedAlignment: (...args: unknown[]) => mockGeminiForcedAlignment(...args),
  geminiTranscribeBlob: (...args: unknown[]) => mockGeminiTranscribeBlob(...args),
}))
jest.mock('../tts/local-tts', () => ({
  forgetLocalTtsHealth: jest.fn(),
  localSttSupports: (kind: string) => mockLocalSttSupports(kind),
}))

beforeEach(() => mockLocalSttSupports.mockReset().mockResolvedValue(false))
afterEach(() => resetGenerationProviderForTesting())

describe('resolveAsrBackend', () => {
  it('times captions locally without asking whether generation can run', async () => {
    setGenerationProvider('google')
    setGenerationUnavailable('Gemini is chosen in Setup but GEMINI_API_KEY is missing')
    mockLocalSttSupports.mockResolvedValue(true)
    await expect(resolveAsrBackend({ env: {} })).resolves.toBe('local')
    mockLocalSttSupports.mockResolvedValue(false)
    await expect(resolveAsrBackend({ env: {} })).rejects.toThrow(/GEMINI_API_KEY is missing/)
  })

  it('falls through to Gemini on google when nothing runs locally', async () => {
    setGenerationProvider('google')
    await expect(resolveAsrBackend({ env: {} })).resolves.toBe('google')
    await expect(resolveAsrBackend({ env: { LOCAL_ASR: 'off' } })).resolves.toBe('google')
  })
})

describe('asrBackend', () => {
  it('prefers the ElevenLabs key, then Gemini on google, else fal', () => {
    expect(asrBackend({ ELEVENLABS_API_KEY: 'e' })).toBe('elevenlabs')
    expect(asrBackend({})).toBe('fal')
    setGenerationProvider('google')
    expect(asrBackend({})).toBe('google')
    expect(asrBackend({ ELEVENLABS_API_KEY: 'e' })).toBe('elevenlabs')
  })

  it('refuses with the Setup reason without an ElevenLabs key when generation cannot run', () => {
    setGenerationProvider('google')
    setGenerationUnavailable('Gemini is chosen in Setup but GEMINI_API_KEY is missing')
    expect(() => asrBackend({})).toThrow(/GEMINI_API_KEY is missing/)
    expect(asrBackend({ ELEVENLABS_API_KEY: 'e' })).toBe('elevenlabs')
  })
})

describe('caption timing on google without an ElevenLabs key', () => {
  const saved = process.env['ELEVENLABS_API_KEY']
  let dir = ''
  let audio = ''

  beforeEach(async () => {
    delete process.env['ELEVENLABS_API_KEY']
    setGenerationProvider('google')
    mockGeminiTranscribeBlob.mockReset()
    mockGeminiForcedAlignment.mockReset()
    dir = await mkdtemp(path.join(os.tmpdir(), 'asr-google-test-'))
    audio = path.join(dir, 'voice.mp3')
    await writeFile(audio, Buffer.from('mp3'))
  })

  afterEach(async () => {
    if (saved !== undefined) process.env['ELEVENLABS_API_KEY'] = saved
    await rm(dir, { force: true, recursive: true })
  })

  it('goes to Gemini Transcribe for transcripts, uploads and alignment', async () => {
    const transcript = { languageCode: 'eng', languageProbability: 1, text: 'Hi', words: [] }
    mockGeminiTranscribeBlob.mockResolvedValue(transcript)
    mockGeminiForcedAlignment.mockResolvedValue({ characters: [], words: [] })
    // generateASRTranscription reads the file and goes through speechToText's google case.
    await expect(generateASRTranscription(audio)).resolves.toBe(transcript)
    await expect(
      speechToText({ file: new Blob(['x']) } as Parameters<typeof speechToText>[0]),
    ).resolves.toBe(transcript)
    await generateForcedAlignment(audio, 'Hi')
    expect(mockGeminiTranscribeBlob).toHaveBeenCalledTimes(2)
    expect(mockGeminiForcedAlignment).toHaveBeenCalledWith(audio, 'Hi')
  })
})
