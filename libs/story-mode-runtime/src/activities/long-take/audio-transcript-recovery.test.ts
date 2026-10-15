import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { runFfmpeg } from '@reelmakeeasy/common/utils/cmdline'

const mockGenerateASRTranscription = jest.fn()
const mockGenerateForcedAlignment = jest.fn()
const mockLocalForcedAlignment = jest.fn()
const mockResolveAsrBackend = jest.fn()

jest.mock('@reelmakeeasy/common/asr/elevenlabs', () => ({
  generateASRTranscription: (...args: unknown[]) => mockGenerateASRTranscription(...args),
  generateForcedAlignment: (...args: unknown[]) => mockGenerateForcedAlignment(...args),
}))
jest.mock('@reelmakeeasy/common/asr/asr-backend', () => ({
  resolveAsrBackend: (...args: unknown[]) => mockResolveAsrBackend(...args),
}))
jest.mock('@reelmakeeasy/common/asr/local-asr', () => ({
  ...jest.requireActual('@reelmakeeasy/common/asr/local-asr'),
  localForcedAlignment: (...args: unknown[]) => mockLocalForcedAlignment(...args),
}))

import { performAsrAndDeriveScript, retimeTranscriptOnScript } from './audio-transcript-recovery'

const SCRIPT = 'Older than trees. Really old.'

/** 0.4 s of silence, 3 s of sound, 0.3 s of silence, 2 s of sound. */
let audioPath: string
let dir: string

const alignerWords = (thanEnd: number) => ({
  characters: [],
  source: 'local-aligner',
  words: [
    { end: 1.2, start: 0.4, text: 'Older' },
    { end: thanEnd, start: 1.2, text: 'than' },
    { end: 1.9, start: thanEnd, text: 'trees.' },
    { end: 4.2, start: 3.7, text: 'Really' },
    { end: 4.8, start: 4.2, text: 'old.' },
  ],
})

const words = (data: { segments: { words: { end: number; start: number; word: string }[] }[] }) =>
  data.segments.flatMap((segment) => segment.words)

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'transcript-recovery-test-'))
  audioPath = path.join(dir, 'voice_over.wav')
  await runFfmpeg(
    '-f',
    'lavfi',
    '-i',
    "aevalsrc='0.2*sin(2*PI*300*t)*not(between(t,0,0.4)+between(t,3.4,3.7))':s=16000:d=5.7",
    '-c:a',
    'pcm_s16le',
    audioPath,
  )
}, 30_000)

afterAll(async () => {
  await rm(dir, { force: true, recursive: true })
})

beforeEach(() => {
  jest.resetAllMocks()
  mockResolveAsrBackend.mockResolvedValue('local')
  mockGenerateForcedAlignment.mockRejectedValue(new Error('No alignment expected here'))
  mockLocalForcedAlignment.mockRejectedValue(new Error('No local alignment expected here'))
})

describe('performAsrAndDeriveScript', () => {
  it('recovers word times from the script on this computer when ASR fails', async () => {
    mockGenerateASRTranscription.mockRejectedValue(new Error('Scribe is down'))
    mockGenerateForcedAlignment.mockResolvedValue(alignerWords(1.2))

    const result = await performAsrAndDeriveScript(audioPath, SCRIPT, 'p1', 5.7)

    expect(result.scriptSource).toBe('forced_alignment')
    expect(result.scriptText).toBe(SCRIPT)
    expect(result.transcriptData.segments.map((s) => s.text)).toEqual([
      'Older than trees.',
      'Really old.',
    ])
    // The aligner's zero-length "than" got the 80 ms repair.
    for (const word of words(result.transcriptData)) {
      expect(word.end - word.start).toBeGreaterThanOrEqual(0.06 - 1e-9)
    }
  })

  it('times the script from punctuation and pauses instead of failing when alignment fails too', async () => {
    mockGenerateASRTranscription.mockRejectedValue(new Error('Scribe is down'))
    mockGenerateForcedAlignment.mockRejectedValue(new Error('alignment is down'))

    const result = await performAsrAndDeriveScript(audioPath, SCRIPT, 'p1', 5.7)

    expect(result.scriptSource).toBe('forced_alignment')
    const [first, second] = result.transcriptData.segments
    expect(first?.start).toBeCloseTo(0.4, 1)
    expect(second?.start).toBeCloseTo(3.7, 1)
    expect(second?.end).toBeCloseTo(5.7, 1)
  })

  it('still fails when ASR fails and there is no script to time', async () => {
    mockGenerateASRTranscription.mockRejectedValue(new Error('Scribe is down'))

    await expect(performAsrAndDeriveScript(audioPath, undefined, 'p1', 5.7)).rejects.toThrow(
      'Scribe is down',
    )
    expect(mockGenerateForcedAlignment).not.toHaveBeenCalled()
  })

  it('times the confirmed script when ASR heard no words', async () => {
    mockGenerateASRTranscription.mockResolvedValue({
      languageCode: 'eng',
      languageProbability: 1,
      text: '',
      words: [],
    })
    mockGenerateForcedAlignment.mockResolvedValue(alignerWords(1.5))

    const result = await performAsrAndDeriveScript(audioPath, SCRIPT, 'p1', 5.7)

    expect(result.scriptSource).toBe('forced_alignment')
    expect(words(result.transcriptData).map((w) => w.word)).toEqual([
      'Older',
      'than',
      'trees.',
      'Really',
      'old.',
    ])
  })

  it("keeps a real ASR transcript (a user's recording can differ from the script)", async () => {
    mockGenerateASRTranscription.mockResolvedValue({
      languageCode: 'eng',
      languageProbability: 1,
      text: 'Older than trees.',
      words: [
        { end: 1.2, start: 0.4, text: 'Older', type: 'word' },
        { end: 1.5, start: 1.2, text: 'than', type: 'word' },
        { end: 1.9, start: 1.5, text: 'trees.', type: 'word' },
      ],
    })

    const result = await performAsrAndDeriveScript(audioPath, SCRIPT, 'p1', 5.7)

    expect(result.scriptSource).toBe('asr')
    expect(result.scriptText).toBe('Older than trees.')
    expect(mockGenerateForcedAlignment).not.toHaveBeenCalled()
  })
})

describe('retimeTranscriptOnScript', () => {
  it('times the script on this computer', async () => {
    mockLocalForcedAlignment.mockResolvedValue(alignerWords(1.5))

    const data = await retimeTranscriptOnScript({
      durationSeconds: 5.7,
      language: 'eng',
      localAudioPath: audioPath,
      projectId: 'p1',
      script: SCRIPT,
    })

    expect(data?.language).toBe('eng')
    expect(data?.segments.map((s) => [s.text, s.start, s.end])).toEqual([
      ['Older than trees.', 0.4, 1.9],
      ['Really old.', 3.7, 4.8],
    ])
  })

  it("leaves the ASR transcript alone when captions aren't timed on this computer", async () => {
    mockResolveAsrBackend.mockResolvedValue('elevenlabs')

    const data = await retimeTranscriptOnScript({
      localAudioPath: audioPath,
      projectId: 'p1',
      script: SCRIPT,
    })

    expect(data).toBeNull()
    expect(mockLocalForcedAlignment).not.toHaveBeenCalled()
  })

  it('leaves the ASR transcript alone when the local server fails, never asking a paid aligner', async () => {
    mockLocalForcedAlignment.mockRejectedValue(new Error('Local alignment failed (HTTP 500)'))

    const data = await retimeTranscriptOnScript({
      localAudioPath: audioPath,
      projectId: 'p1',
      script: SCRIPT,
    })

    expect(data).toBeNull()
    expect(mockGenerateForcedAlignment).not.toHaveBeenCalled()
  })
})
