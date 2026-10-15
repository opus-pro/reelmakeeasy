import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type { TimedWord } from '@reelmakeeasy/common/asr/align-text'
import { logger } from '@reelmakeeasy/common/logger'
import { runFfmpeg } from '@reelmakeeasy/common/utils/cmdline'

const mockGenerateForcedAlignment = jest.fn()
const mockResolveAsrBackend = jest.fn()
const mockLocalForcedAlignment = jest.fn()
const mockLocalSpeechToText = jest.fn()
const mockLocalSttSupports = jest.fn()
const mockGenerateTranscriptionStep = jest.fn()

jest.mock('@reelmakeeasy/common/asr/elevenlabs', () => ({
  generateForcedAlignment: (...args: unknown[]) => mockGenerateForcedAlignment(...args),
}))
jest.mock('@reelmakeeasy/common/asr/asr-backend', () => ({
  resolveAsrBackend: (...args: unknown[]) => mockResolveAsrBackend(...args),
}))
jest.mock('@reelmakeeasy/common/asr/local-asr', () => ({
  ...jest.requireActual('@reelmakeeasy/common/asr/local-asr'),
  localForcedAlignment: (...args: unknown[]) => mockLocalForcedAlignment(...args),
  localSpeechToText: (...args: unknown[]) => mockLocalSpeechToText(...args),
}))
jest.mock('@reelmakeeasy/common/tts/local-tts', () => ({
  ...jest.requireActual('@reelmakeeasy/common/tts/local-tts'),
  localSttSupports: (...args: unknown[]) => mockLocalSttSupports(...args),
}))
// Storage paths are local files here.
jest.mock('./common.util', () => ({
  processWithLocalFile: (_projectId: string, file: string, fn: (local: string) => unknown) =>
    fn(file),
}))
jest.mock('./elevenlabs-audio-pipeline.util', () => ({
  generateTranscriptionStep: (...args: unknown[]) => mockGenerateTranscriptionStep(...args),
}))

import {
  localCaptionTranscription,
  resolveBestEffortTranscription,
  timeScriptWords,
} from './forced-alignment-transcription.util'

/** 0.4 s of silence, 3 s of sound, 0.3 s of silence, 2 s of sound. */
let speechPath: string
/** 150 s: silences at 0-0.5, 70-70.6 and 110-110.4 s, sound everywhere else. */
let longPath: string
let dir: string

const SCRIPT = 'Sharks — older than trees. Really old.'
const LABEL = 'Test'

const words = (...entries: [string, number, number][]): TimedWord[] =>
  entries.map(([text, start, end]) => ({ end, start, text }))
const texts = (list: { text: string }[]) => list.map((w) => w.text)

/** A tone with silent stretches, exact to the sample, as 16 kHz mono WAV. */
async function toneWithSilences(file: string, seconds: number, silences: [number, number][]) {
  const quiet = silences.map(([from, to]) => `between(t,${from},${to})`).join('+')
  await runFfmpeg(
    '-f',
    'lavfi',
    '-i',
    `aevalsrc='0.2*sin(2*PI*300*t)*not(${quiet})':s=16000:d=${seconds}`,
    '-ac',
    '1',
    '-c:a',
    'pcm_s16le',
    file,
  )
}

beforeAll(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'forced-alignment-test-'))
  speechPath = path.join(dir, 'speech.wav')
  longPath = path.join(dir, 'long.wav')
  await toneWithSilences(speechPath, 5.7, [
    [0, 0.4],
    [3.4, 3.7],
  ])
  await toneWithSilences(longPath, 150, [
    [0, 0.5],
    [70, 70.6],
    [110, 110.4],
  ])
}, 60_000)

afterAll(async () => {
  await rm(dir, { force: true, recursive: true })
})

beforeEach(() => {
  jest.resetAllMocks()
  mockResolveAsrBackend.mockResolvedValue('local')
  mockGenerateForcedAlignment.mockRejectedValue(new Error('No paid alignment expected here'))
  mockLocalSttSupports.mockResolvedValue(true)
  mockLocalSpeechToText.mockRejectedValue(new Error('Whisper was not expected here'))
  mockLocalForcedAlignment.mockRejectedValue(new Error('No piece alignment expected here'))
})

describe('timeScriptWords', () => {
  it('takes the local aligner words after the 80 ms repair, one word each, no inner spaces', async () => {
    mockGenerateForcedAlignment.mockResolvedValue({
      characters: [],
      source: 'local-aligner',
      words: words(
        ['Sharks—', 0.4, 0.8],
        ['older', 0.8, 1.2],
        ['than', 1.2, 1.2],
        ['trees.', 1.2, 1.9],
        ['Really', 3.7, 4.2],
        ['old.', 4.2, 4.8],
      ),
    })

    const timing = await timeScriptWords({
      audioPath: speechPath,
      providerLabel: LABEL,
      text: SCRIPT,
    })

    expect(timing.source).toBe('aligner')
    expect(timing.rejected).toEqual([])
    expect(texts(timing.words)).toEqual(['Sharks—', 'older', 'than', 'trees.', 'Really', 'old.'])
    for (const word of timing.words)
      expect(word.end - word.start).toBeGreaterThanOrEqual(0.06 - 1e-9)
    expect(mockGenerateForcedAlignment).toHaveBeenCalledWith(speechPath, SCRIPT)
    expect(mockLocalSpeechToText).not.toHaveBeenCalled()
  })

  it('asks local Whisper when the aligner fails the guard, moving the first word to the onset', async () => {
    mockGenerateForcedAlignment.mockResolvedValue({
      characters: [],
      source: 'local-aligner',
      words: words(
        ['Sharks—', 0.4, 0.8],
        ['older', 0.8, 1.2],
        ['than', 1.5, 1.2],
        ['trees.', 1.2, 1.9],
        ['Really', 3.7, 4.2],
        ['old.', 4.2, 4.8],
      ),
    })
    mockLocalSpeechToText.mockResolvedValue({
      languageCode: 'eng',
      languageProbability: 1,
      text: 'Sharks older than trees. Really old.',
      words: [
        ...words(['Sharks', 0, 0.8], ['older', 0.8, 1.2], ['than', 1.2, 1.4]),
        ...words(['trees.', 1.4, 1.9], ['Really', 3.7, 4.2], ['old.', 4.2, 4.8]),
      ].map((w) => ({ ...w, type: 'word' as const })),
    })

    const timing = await timeScriptWords({
      audioPath: speechPath,
      durationSeconds: 5.7,
      providerLabel: LABEL,
      text: SCRIPT,
    })

    expect(timing.source).toBe('whisper')
    expect(timing.rejected).toEqual([{ issues: ['nonmonotonic'], step: 'aligner' }])
    expect(timing.words[0]).toEqual({ end: 0.8, start: expect.closeTo(0.4, 2), text: 'Sharks—' })
    expect(mockGenerateForcedAlignment).toHaveBeenCalledTimes(1)
    expect(mockLocalSpeechToText).toHaveBeenCalledTimes(1)
  })

  it('falls back to punctuation and pauses when the guard turns everything down, and says so', async () => {
    const warn = jest.spyOn(logger, 'warn')
    mockGenerateForcedAlignment.mockResolvedValue({
      characters: [],
      source: 'local-aligner',
      words: words(['Older', 0.4, Number.NaN], ['than', 1, 1.2], ['trees.', 1.2, 1.9]),
    })
    mockLocalSpeechToText.mockResolvedValue({
      languageCode: 'eng',
      languageProbability: 1,
      text: 'Older than trees. Really old.',
      words: words(
        ['Older', 0.4, 1.2],
        ['than', 1.2, 1.2],
        ['trees.', 1.2, 1.9],
        ['Really', 3.7, 4.2],
        ['old.', 4.2, 4.8],
      ).map((w) => ({ ...w, type: 'word' as const })),
    })

    const timing = await timeScriptWords({
      audioPath: speechPath,
      durationSeconds: 5.7,
      providerLabel: LABEL,
      text: 'Older than trees. Really old.',
    })

    expect(timing.source).toBe('fallback')
    expect(timing.fallbackMode).toBe('phrases')
    expect(timing.rejected).toEqual([
      { issues: ['nonfinite'], step: 'aligner' },
      { issues: ['short'], step: 'whisper' },
    ])
    // Each phrase gets its stretch of sound: 0.4-3.4 s and 3.7-5.7 s.
    expect(timing.words[0]?.start).toBeCloseTo(0.4, 1)
    expect(timing.words[3]?.start).toBeCloseTo(3.7, 1)
    expect(timing.words.at(-1)?.end).toBeCloseTo(5.7, 1)
    // Never a paid call: the one alignment request was answered locally.
    expect(mockGenerateForcedAlignment).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(
      expect.stringMatching(/source=fallback .*rejected=aligner:nonfinite,whisper:short/),
    )
  })

  it('falls back when forced alignment fails outright, without throwing', async () => {
    mockGenerateForcedAlignment.mockRejectedValue(new Error('HTTP 500'))

    const timing = await timeScriptWords({
      audioPath: speechPath,
      providerLabel: LABEL,
      text: 'Older than trees. Really old.',
    })

    expect(timing.source).toBe('fallback')
    expect(texts(timing.words)).toEqual(['Older', 'than', 'trees.', 'Really', 'old.'])
  })

  it('measures the audio itself when the length it was given is 0 (a failed ffprobe)', async () => {
    mockGenerateForcedAlignment.mockRejectedValue(new Error('HTTP 500'))

    const timing = await timeScriptWords({
      audioPath: speechPath,
      durationSeconds: 0,
      providerLabel: LABEL,
      text: 'Older than trees. Really old.',
    })

    expect(timing.fallbackMode).toBe('phrases')
    expect(timing.words.at(-1)?.end).toBeCloseTo(5.7, 1)
  })

  it("keeps a cloud aligner's words as they are (the guard is for local timings)", async () => {
    mockResolveAsrBackend.mockResolvedValue('elevenlabs')
    const cloud = words(['Older', 0.4, 0.9], ['than', 0.9, 0.9], ['trees.', 0.9, 1.5])
    mockGenerateForcedAlignment.mockResolvedValue({
      characters: [],
      source: 'elevenlabs',
      words: cloud,
    })

    const timing = await timeScriptWords({
      audioPath: speechPath,
      providerLabel: LABEL,
      text: 'Older than trees.',
    })

    expect(timing).toEqual({ rejected: [], source: 'elevenlabs', words: cloud })
  })

  describe('over 120 s of audio', () => {
    const LONG_SCRIPT = 'Alpha bravo charlie. Delta echo foxtrot golf hotel.'
    // Whisper's words laid over the script (what local alignment returns for long audio).
    const heard = words(
      ['Alpha', 1, 2],
      ['bravo', 30, 31],
      ['charlie.', 60, 61],
      ['Delta', 75, 76],
      ['echo', 100, 101],
      ['foxtrot', 112, 113],
      ['golf', 130, 131],
      ['hotel.', 145, 146],
    )

    beforeEach(() => {
      mockGenerateForcedAlignment.mockResolvedValue({
        characters: [],
        source: 'local-whisper',
        words: heard,
      })
    })

    it('aligns piece by piece, cut in a pause, and shifts the times back', async () => {
      // The aligner answers each piece on its own clock: 0.5 s per word, a second apart.
      mockLocalForcedAlignment.mockImplementation(async (_audio: Blob, text: string) => ({
        characters: [],
        source: 'local-aligner',
        words: text.split(' ').map((word, i) => ({ end: i + 1.5, start: i + 1, text: word })),
      }))

      const timing = await timeScriptWords({
        audioPath: longPath,
        durationSeconds: 150,
        providerLabel: LABEL,
        text: LONG_SCRIPT,
      })

      expect(mockLocalForcedAlignment).toHaveBeenCalledTimes(2)
      const [first, second] = mockLocalForcedAlignment.mock.calls as [Blob, string][]
      expect(first?.[1]).toBe('Alpha bravo charlie. Delta echo')
      expect(second?.[1]).toBe('foxtrot golf hotel.')
      // 16 kHz mono 16-bit: the cut is in the middle of the 110-110.4 s pause.
      expect((first?.[0].size ?? 0) / 32_000).toBeCloseTo(110.2, 1)
      expect((second?.[0].size ?? 0) / 32_000).toBeCloseTo(39.8, 1)
      expect(timing.source).toBe('aligner')
      expect(timing.words.map((w) => w.start)).toEqual(
        [1, 2, 3, 4, 5, 111.2, 112.2, 113.2].map((s) => expect.closeTo(s, 2)),
      )
      expect(timing.words[7]).toEqual({
        end: expect.closeTo(113.7, 2),
        start: expect.closeTo(113.2, 2),
        text: 'hotel.',
      })
    })

    it('keeps Whisper when no aligner is installed', async () => {
      mockLocalSttSupports.mockImplementation(async (job: string) => job !== 'align')

      const timing = await timeScriptWords({
        audioPath: longPath,
        durationSeconds: 150,
        providerLabel: LABEL,
        text: LONG_SCRIPT,
      })

      expect(mockLocalForcedAlignment).not.toHaveBeenCalled()
      expect(timing.source).toBe('whisper')
      expect(timing.words.map((w) => w.start)).toEqual(heard.map((w) => w.start))
    })

    it('keeps Whisper when a piece could not be aligned', async () => {
      mockLocalForcedAlignment
        .mockResolvedValueOnce({
          characters: [],
          source: 'local-aligner',
          words: words(['Alpha', 1, 2], ['bravo', 30, 31], ['charlie.', 60, 61]).concat(
            words(['Delta', 75, 76], ['echo', 100, 101]),
          ),
        })
        .mockResolvedValueOnce({ characters: [], source: 'local-whisper', words: [] })

      const timing = await timeScriptWords({
        audioPath: longPath,
        durationSeconds: 150,
        providerLabel: LABEL,
        text: LONG_SCRIPT,
      })

      expect(mockLocalForcedAlignment).toHaveBeenCalledTimes(2)
      expect(timing.source).toBe('whisper')
    })
  })
})

describe('localCaptionTranscription', () => {
  const asr = {
    languageCode: 'eng',
    languageProbability: 0.98,
    text: 'sharks older than trees really old',
    words: words(['sharks', 0.4, 0.8], ['older', 0.8, 0.8]).map((w) => ({
      ...w,
      type: 'word' as const,
    })),
  }

  it("keeps the ASR transcript when captions aren't timed on this computer", async () => {
    mockResolveAsrBackend.mockResolvedValue('fal')

    const result = await localCaptionTranscription({
      audioPath: speechPath,
      projectId: 'p1',
      providerLabel: LABEL,
      text: SCRIPT,
      transcription: asr,
    })

    expect(result).toBe(asr)
    expect(mockLocalForcedAlignment).not.toHaveBeenCalled()
    expect(mockGenerateForcedAlignment).not.toHaveBeenCalled()
  })

  it('keeps the ASR transcript when the local server fails, never asking a paid aligner', async () => {
    mockLocalForcedAlignment.mockRejectedValue(new Error('Local alignment failed (HTTP 500)'))

    const result = await localCaptionTranscription({
      audioPath: speechPath,
      projectId: 'p1',
      providerLabel: LABEL,
      text: SCRIPT,
      transcription: asr,
    })

    expect(result).toBe(asr)
    expect(mockLocalForcedAlignment).toHaveBeenCalledTimes(1)
    expect(mockGenerateForcedAlignment).not.toHaveBeenCalled()
  })

  it('times the script locally and keeps the detected language', async () => {
    mockLocalForcedAlignment.mockResolvedValue({
      characters: [],
      source: 'local-aligner',
      words: words(
        ['Sharks—', 0.4, 0.8],
        ['older', 0.8, 1.2],
        ['than', 1.2, 1.4],
        ['trees.', 1.4, 1.9],
        ['Really', 3.7, 4.2],
        ['old.', 4.2, 4.8],
      ),
    })

    const result = await localCaptionTranscription({
      audioPath: speechPath,
      projectId: 'p1',
      providerLabel: LABEL,
      text: SCRIPT,
      transcription: asr,
    })

    expect(result?.languageCode).toBe('eng')
    expect(result?.languageProbability).toBe(0.98)
    expect(result?.text).toBe(SCRIPT)
    expect(result?.words.map((w) => [w.text, w.type])).toEqual([
      ['Sharks—', 'word'],
      ['older', 'word'],
      ['than', 'word'],
      ['trees.', 'word'],
      ['Really', 'word'],
      ['old.', 'word'],
    ])
  })
})

describe('delivery markup', () => {
  const TAGGED = '[excited] Sharks — older than trees. [neutral] Really old.'
  const aligned = {
    characters: [],
    source: 'local-aligner',
    words: words(
      ['Sharks—', 0.4, 0.8],
      ['older', 0.8, 1.2],
      ['than', 1.2, 1.4],
      ['trees.', 1.4, 1.9],
      ['Really', 3.7, 4.2],
      ['old.', 4.2, 4.8],
    ),
  }

  it('times the words the voice says: tags are never sent to the aligner or captioned', async () => {
    mockLocalForcedAlignment.mockResolvedValue(aligned)

    const result = await localCaptionTranscription({
      audioPath: speechPath,
      projectId: 'p1',
      providerLabel: LABEL,
      text: TAGGED,
      transcription: null,
    })

    expect(mockLocalForcedAlignment).toHaveBeenCalledWith(expect.anything(), SCRIPT)
    expect(result?.text).toBe(SCRIPT)
    expect(texts(result?.words ?? [])).not.toContain('[excited]')
    expect(texts(result?.words ?? [])).toHaveLength(6)
  })

  it('strips them on every path: the cloud aligner and the punctuation fallback too', async () => {
    mockGenerateForcedAlignment.mockRejectedValue(new Error('aligner down'))

    const timing = await timeScriptWords({
      audioPath: speechPath,
      providerLabel: LABEL,
      text: TAGGED,
    })

    expect(mockGenerateForcedAlignment).toHaveBeenCalledWith(speechPath, SCRIPT)
    expect(timing.source).toBe('fallback')
    expect(texts(timing.words)).toEqual(['Sharks—', 'older', 'than', 'trees.', 'Really', 'old.'])
  })
})

describe('resolveBestEffortTranscription', () => {
  const params = {
    alignmentText: 'Older than trees. Really old.',
    audioPath: '',
    initialTranscription: null,
    projectId: 'p1',
    providerLabel: LABEL,
  }

  it('times the script locally instead of keeping a best-effort ASR transcript', async () => {
    mockLocalForcedAlignment.mockResolvedValue({
      characters: [],
      source: 'local-aligner',
      words: words(
        ['Older', 0.4, 1.2],
        ['than', 1.2, 1.4],
        ['trees.', 1.4, 1.9],
        ['Really', 3.7, 4.2],
        ['old.', 4.2, 4.8],
      ),
    })
    const initial = {
      languageCode: 'eng',
      languageProbability: 1,
      text: 'older then trees',
      words: words(['older', 0.4, 1.2]).map((w) => ({ ...w, type: 'word' as const })),
    }

    const result = await resolveBestEffortTranscription({
      ...params,
      audioPath: speechPath,
      initialTranscription: initial,
    })

    expect(texts(result.words)).toEqual(['Older', 'than', 'trees.', 'Really', 'old.'])
    expect(mockGenerateTranscriptionStep).not.toHaveBeenCalled()
    expect(mockGenerateForcedAlignment).not.toHaveBeenCalled()
  })

  it('keeps the best-effort ASR transcript when the local server fails', async () => {
    mockLocalForcedAlignment.mockRejectedValue(new Error('Local alignment failed (HTTP 500)'))
    const initial = {
      languageCode: 'eng',
      languageProbability: 1,
      text: 'older then trees',
      words: words(['older', 0.4, 1.2]).map((w) => ({ ...w, type: 'word' as const })),
    }

    const result = await resolveBestEffortTranscription({
      ...params,
      audioPath: speechPath,
      initialTranscription: initial,
    })

    expect(result).toBe(initial)
    expect(mockGenerateForcedAlignment).not.toHaveBeenCalled()
  })

  it('keeps a cloud ASR transcript as it is', async () => {
    mockResolveAsrBackend.mockResolvedValue('fal')
    const initial = {
      languageCode: 'eng',
      languageProbability: 1,
      text: 'older than trees',
      words: words(['older', 0.4, 1.2]).map((w) => ({ ...w, type: 'word' as const })),
    }

    const result = await resolveBestEffortTranscription({
      ...params,
      audioPath: speechPath,
      initialTranscription: initial,
    })

    expect(result).toBe(initial)
    expect(mockGenerateForcedAlignment).not.toHaveBeenCalled()
  })

  it('times captions from punctuation and pauses instead of failing when ASR and alignment fail', async () => {
    mockResolveAsrBackend.mockResolvedValue('fal')
    mockGenerateTranscriptionStep.mockResolvedValue({ issues: ['ASR down'], transcription: null })
    mockGenerateForcedAlignment.mockRejectedValue(new Error('alignment down'))

    const result = await resolveBestEffortTranscription({ ...params, audioPath: speechPath })

    expect(result.text).toBe('Older than trees. Really old.')
    expect(texts(result.words)).toEqual(['Older', 'than', 'trees.', 'Really', 'old.'])
    expect(result.words[3]?.start).toBeCloseTo(3.7, 1)
  })
})
