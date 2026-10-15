import type { SpeechToTextChunkResponseModel } from '@reelmakeeasy/common/elevenlabs/client'

const mockLocalCaptionTranscription = jest.fn()
const mockResolveBestEffortTranscription = jest.fn()
const mockGenerateTTSAudio = jest.fn()
const mockTranscriptionStep = jest.fn()
const mockValidateTranscript = jest.fn()
const mockChunked = jest.fn()
const files = new Map<string, Buffer>()
/** Whether the voiceover was saved each time its captions were timed. */
const savedWhenTimed: boolean[] = []

jest.mock('./forced-alignment-transcription.util', () => ({
  localCaptionTranscription: (...args: unknown[]) => mockLocalCaptionTranscription(...args),
  resolveBestEffortTranscription: (...args: unknown[]) =>
    mockResolveBestEffortTranscription(...args),
}))
jest.mock('@reelmakeeasy/common/agent-v2/storage/storage', () => ({
  createStorage: async () => ({
    readFile: async (file: string) => files.get(file) ?? Buffer.alloc(0),
    writeFile: async (file: string, data: Buffer | string) => {
      files.set(file, Buffer.from(data))
    },
    writeJsonFile: async () => undefined,
  }),
}))
jest.mock('@reelmakeeasy/common/tts/minimax-text', () => ({
  optimizeScriptForSpeech: async (text: string) => text,
}))
jest.mock('./provider-tts.util', () => ({
  generateTTSAudio: (...args: unknown[]) => mockGenerateTTSAudio(...args),
  getProviderForVoice: jest.fn(),
  isGeminiPresetVoiceId: jest.fn(),
  resolveTtsModel: () => 'kokoro-v1',
  resolveVoiceRoute: async (voiceId: string) => ({ provider: 'kokoro', voiceId }),
}))
jest.mock('./elevenlabs-audio-pipeline.util', () => ({
  applyVolumeNormalization: async () => [],
  generateTranscriptionStep: (...args: unknown[]) => mockTranscriptionStep(...args),
  removeAudioPausesStep: async () => [],
  saveQualityIssuesToDebugFile: async () => undefined,
  saveTimestampsIfAvailable: async () => [],
  validateTranscriptQualityStep: (...args: unknown[]) => mockValidateTranscript(...args),
}))
jest.mock('./chunked-tts.util', () => ({
  countWords: (text: string) => text.trim().split(/\s+/).filter(Boolean).length,
  generateChunkedAudioAndTranscriptWithRetries: (...args: unknown[]) => mockChunked(...args),
  MIN_LONG_TTS_WORDS: 420,
}))

import { generateAudioAndTranscriptWithRetries } from './provider-router.util'

const VOICE_OVER = 'story_loader/audio/voice_over.mp3'

const transcript = (text: string): SpeechToTextChunkResponseModel => ({
  languageCode: 'eng',
  languageProbability: 1,
  text,
  words: text.split(' ').map((word, i) => ({ end: i + 0.5, start: i, text: word, type: 'word' })),
})

const asr = transcript('older then trees')
const timed = transcript('Older than trees.')

beforeEach(() => {
  jest.resetAllMocks()
  files.clear()
  savedWhenTimed.length = 0
  mockGenerateTTSAudio.mockResolvedValue({
    audioBuffer: Buffer.from('mp3'),
    preprocessedText: 'Older than trees.',
  })
  mockTranscriptionStep.mockResolvedValue({ issues: [], transcription: asr })
  mockValidateTranscript.mockResolvedValue({
    explanation: '',
    hasTagLeakage: false,
    isValid: true,
    issues: [],
  })
  mockLocalCaptionTranscription.mockImplementation(async () => {
    savedWhenTimed.push(files.has(VOICE_OVER))
    return timed
  })
})

describe('generateAudioAndTranscriptWithRetries caption timing', () => {
  it("times the saved voiceover's spoken text for the captions", async () => {
    const result = await generateAudioAndTranscriptWithRetries(
      'Older than trees.',
      'af_heart',
      'p1',
    )

    expect(mockLocalCaptionTranscription).toHaveBeenCalledWith({
      audioPath: VOICE_OVER,
      projectId: 'p1',
      providerLabel: 'Kokoro',
      text: 'Older than trees.',
      transcription: asr,
    })
    expect(savedWhenTimed).toEqual([true])
    expect(result.isValid).toBe(true)
    expect(result.transcription).toBe(timed)
  })

  it('times the audio at the path the caller asked for', async () => {
    const round2 = 'story_loader/audio/voice_over_round2.mp3'
    mockLocalCaptionTranscription.mockResolvedValue(timed)

    await generateAudioAndTranscriptWithRetries(
      'Older than trees.',
      'af_heart',
      'p1',
      undefined,
      round2,
    )

    expect(mockLocalCaptionTranscription).toHaveBeenCalledWith(
      expect.objectContaining({ audioPath: round2 }),
    )
  })

  it('times a long voiceover once, on the stitched audio, not chunk by chunk', async () => {
    const script = Array.from({ length: 430 }, (_, i) => `word${i}`).join(' ')
    mockChunked.mockImplementation(
      async (params: { generateChunk: (text: string, path: string) => Promise<unknown> }) => {
        await params.generateChunk(
          'word0 word1',
          'story_loader/audio/chunks/voice_over_chunk_000.mp3',
        )
        files.set(VOICE_OVER, Buffer.from('stitched'))
        return { attempt: 0, isValid: true, qualityIssues: [], transcription: asr }
      },
    )

    const result = await generateAudioAndTranscriptWithRetries(script, 'af_heart', 'p1')

    expect(mockLocalCaptionTranscription).toHaveBeenCalledTimes(1)
    expect(mockLocalCaptionTranscription).toHaveBeenCalledWith(
      expect.objectContaining({ audioPath: VOICE_OVER, text: script, transcription: asr }),
    )
    expect(savedWhenTimed).toEqual([true])
    expect(result.transcription).toBe(timed)
  })

  it('leaves a best-effort voiceover to resolveBestEffortTranscription, which times it', async () => {
    mockValidateTranscript.mockResolvedValue({
      explanation: 'missed a word',
      hasTagLeakage: false,
      isValid: false,
      issues: ['missed a word'],
    })
    mockResolveBestEffortTranscription.mockResolvedValue(timed)

    const result = await generateAudioAndTranscriptWithRetries(
      'Older than trees.',
      'af_heart',
      'p1',
    )

    expect(mockResolveBestEffortTranscription).toHaveBeenCalledWith(
      expect.objectContaining({ alignmentText: 'Older than trees.', localTiming: true }),
    )
    expect(mockLocalCaptionTranscription).not.toHaveBeenCalled()
    expect(result.isValid).toBe(false)
    expect(result.transcription).toBe(timed)
  })

  it("doesn't time a best-effort chunk: the stitched audio is timed once", async () => {
    const script = Array.from({ length: 430 }, (_, i) => `word${i}`).join(' ')
    mockValidateTranscript.mockResolvedValue({
      explanation: '',
      hasTagLeakage: false,
      isValid: false,
      issues: ['bad chunk'],
    })
    mockResolveBestEffortTranscription.mockResolvedValue(asr)
    mockChunked.mockImplementation(
      async (params: { generateChunk: (text: string, path: string) => Promise<unknown> }) => {
        await params.generateChunk(
          'word0 word1',
          'story_loader/audio/chunks/voice_over_chunk_000.mp3',
        )
        files.set(VOICE_OVER, Buffer.from('stitched'))
        return { attempt: 2, isValid: false, qualityIssues: [], transcription: asr }
      },
    )

    await generateAudioAndTranscriptWithRetries(script, 'af_heart', 'p1')

    expect(mockResolveBestEffortTranscription).toHaveBeenCalledWith(
      expect.objectContaining({ localTiming: false }),
    )
    expect(mockLocalCaptionTranscription).toHaveBeenCalledTimes(1)
  })
})
