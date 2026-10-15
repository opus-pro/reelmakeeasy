const mockCompletion = jest.fn()
const mockWriteJsonFile = jest.fn(async () => undefined)

jest.mock('@reelmakeeasy/common/agent-v2/storage/storage', () => ({
  createStorage: jest.fn(async () => ({ writeJsonFile: mockWriteJsonFile })),
}))
jest.mock('@reelmakeeasy/common/llm', () => ({
  completion: (...args: unknown[]) => mockCompletion(...args),
}))

import type { TranscriptData } from '@shared/types/agent/transcript'

import { correctTranscriptAndValidateTTSQuality } from './common.util'

type StoredWord = [word: string, start: number, end: number]

/** An edit the correction LLM made to one word, found by the word's start time. */
interface StoredEdit {
  end?: number
  start: number
  word?: string
}

// Two stored ASR transcripts of real voiceovers, as [word, start, end] per
// segment (one speaker throughout). The correction LLM sent each back with a
// word's end time rewritten: "for" (98.82-98.92 s) came back ending at 8.92 s,
// and "also" (97.94-98.24 s) at 8.24 s, so the word ended before it started.

// The segment the 8.92 s rewrite hit (the last of 13): one correction call.
const CLOSING_LINE: StoredWord[][] = [
  [
    ['It', 89.04, 89.1],
    ['is', 89.14, 89.26],
    ['time', 89.34, 89.6],
    ['to', 89.64, 89.7],
    ['demand', 89.74, 90.1],
    ['a', 90.14, 90.2],
    ['system', 90.24, 90.64],
    ['that', 90.94, 91.04],
    ['prioritizes', 91.08, 91.98],
    ['human', 92.04, 92.36],
    ['life', 92.4, 92.72],
    ['over', 92.94, 93.12],
    ['corporate', 93.18, 93.48],
    ['margins,', 93.52, 94.02],
    ['ensuring', 94.52, 95.02],
    ['that', 95.08, 95.2],
    ['healthcare', 95.26, 95.8],
    ['is', 95.84, 95.92],
    ['a', 95.96, 96.06],
    ['fundamental', 96.14, 96.66],
    ['right,', 96.76, 97],
    ['not', 97.5, 97.64],
    ['a', 97.68, 97.74],
    ['luxury', 97.78, 98.26],
    ['reserved', 98.3, 98.78],
    ['for', 98.82, 98.92],
    ['those', 98.96, 99.24],
    ['who', 99.28, 99.36],
    ['can', 99.38, 99.48],
    ['afford', 99.52, 99.84],
    ['to', 99.9, 99.98],
    ['navigate', 100.04, 100.46],
    ['the', 100.5, 100.56],
    ['crisis.', 100.6, 101.1],
  ],
]

// 19 segments: over 15, so correction runs in two chunks (15 + 4).
const GAME_THEORY: StoredWord[][] = [
  [
    ['Imagine', 0.38, 0.78],
    ['you', 0.9, 1.06],
    ['and', 1.08, 1.16],
    ['an', 1.18, 1.24],
    ['accomplice', 1.28, 1.82],
    ['are', 1.84, 1.94],
    ['caught', 1.98, 2.18],
    ['for', 2.22, 2.28],
    ['a', 2.32, 2.38],
    ['crime,', 2.42, 2.74],
    ['placed', 3.08, 3.4],
    ['in', 3.44, 3.58],
    ['separate', 3.64, 3.94],
    ['interrogation', 3.98, 4.64],
    ['rooms', 4.7, 4.98],
    ['with', 5.04, 5.16],
    ['no', 5.2, 5.34],
    ['way', 5.38, 5.48],
    ['to', 5.52, 5.58],
    ['communicate.', 5.62, 6.2],
  ],
  [
    ['The', 6.76, 6.84],
    ['prosecutor', 6.86, 7.48],
    ['offers', 7.56, 7.84],
    ['you', 7.88, 7.98],
    ['both', 8.02, 8.2],
    ['a', 8.24, 8.3],
    ['deal.', 8.34, 8.56],
  ],
  [
    ['If', 9.16, 9.24],
    ['you', 9.26, 9.3],
    ['stay', 9.4, 9.62],
    ['silent', 9.68, 10.1],
    ['and', 10.22, 10.3],
    ['your', 10.32, 10.44],
    ['partner', 10.48, 10.8],
    ['rats', 10.9, 11.12],
    ['you', 11.16, 11.22],
    ['out,', 11.3, 11.46],
    ['you', 11.64, 11.7],
    ['get', 11.72, 11.88],
    ['ten', 11.96, 12.16],
    ['years', 12.2, 12.42],
    ['in', 12.46, 12.56],
    ['prison', 12.6, 12.94],
    ['while', 12.98, 13.1],
    ['they', 13.14, 13.24],
    ['walk', 13.28, 13.46],
    ['free.', 13.54, 13.78],
  ],
  [
    ['If', 14.42, 14.5],
    ['you', 14.52, 14.62],
    ['rat', 14.66, 14.86],
    ['them', 14.88, 14.98],
    ['out', 15.06, 15.24],
    ['and', 15.28, 15.34],
    ['they', 15.38, 15.5],
    ['stay', 15.56, 15.7],
    ['silent,', 15.84, 16.2],
    ['you', 16.42, 16.48],
    ['go', 16.52, 16.68],
    ['free', 16.74, 17.04],
    ['and', 17.06, 17.14],
    ['they', 17.18, 17.3],
    ['do', 17.34, 17.48],
    ['ten', 17.54, 17.7],
    ['years.', 17.76, 18.06],
  ],
  [
    ['If', 18.46, 18.52],
    ['you', 18.56, 18.62],
    ['both', 18.66, 18.88],
    ['confess,', 18.92, 19.42],
    ['you', 19.52, 19.6],
    ['both', 19.64, 19.86],
    ['get', 19.9, 20.08],
    ['five', 20.14, 20.4],
    ['years.', 20.46, 20.76],
  ],
  [
    ['But', 21.22, 21.28],
    ['if', 21.32, 21.38],
    ['you', 21.4, 21.48],
    ['both', 21.52, 21.74],
    ['keep', 21.78, 21.92],
    ['your', 21.96, 22.04],
    ['mouths', 22.08, 22.34],
    ['shut,', 22.38, 22.64],
    ['there', 22.94, 23.06],
    ['is', 23.1, 23.22],
    ['only', 23.3, 23.48],
    ['enough', 23.54, 23.8],
    ['evidence', 23.88, 24.22],
    ['to', 24.26, 24.34],
    ['hold', 24.38, 24.58],
    ['you', 24.6, 24.7],
    ['both', 24.74, 24.98],
    ['for', 25.02, 25.12],
    ['one', 25.2, 25.34],
    ['year.', 25.38, 25.56],
  ],
  [
    ['What', 26.1, 26.18],
    ['do', 26.2, 26.26],
    ['you', 26.3, 26.36],
    ['do?', 26.4, 26.54],
  ],
  [
    ['This', 27.34, 27.48],
    ['classic', 27.52, 27.88],
    ['scenario', 27.92, 28.48],
    ['is', 28.52, 28.6],
    ['the', 28.64, 28.72],
    ["prisoner's", 28.76, 29.16],
    ['dilemma,', 29.2, 29.58],
    ['and', 30.02, 30.1],
    ['it', 30.16, 30.22],
    ['is', 30.26, 30.36],
    ['the', 30.42, 30.48],
    ['beating', 30.52, 30.78],
    ['heart', 30.84, 31.06],
    ['of', 31.1, 31.2],
    ['game', 31.24, 31.46],
    ['theory.', 31.5, 31.78],
  ],
  [
    ['At', 32.4, 32.46],
    ['its', 32.479, 32.619],
    ['core,', 32.7, 32.94],
    ['game', 33.4, 33.62],
    ['theory', 33.66, 33.94],
    ['is', 34, 34.1],
    ['not', 34.14, 34.26],
    ['about', 34.3, 34.48],
    ['playing', 34.52, 34.86],
    ['chess', 34.92, 35.24],
    ['or', 35.3, 35.38],
    ['video', 35.42, 35.66],
    ['games.', 35.76, 36.12],
  ],
  [
    ['It', 36.58, 36.64],
    ['is', 36.68, 36.76],
    ['the', 36.82, 36.9],
    ['mathematical', 36.96, 37.64],
    ['study', 37.76, 38.06],
    ['of', 38.1, 38.16],
    ['strategic', 38.22, 38.64],
    ['decision-making.', 38.68, 39.44],
  ],
  [
    ['Whenever', 40.06, 40.36],
    ['the', 40.4, 40.52],
    ['outcome', 40.6, 40.84],
    ['of', 40.88, 40.94],
    ['your', 40.98, 41.06],
    ['choice', 41.1, 41.36],
    ['depends', 41.42, 41.74],
    ['on', 41.78, 41.84],
    ['the', 41.86, 41.94],
    ['choices', 41.98, 42.3],
    ['of', 42.34, 42.4],
    ['others,', 42.48, 42.78],
    ['you', 43.14, 43.2],
    ['are', 43.24, 43.34],
    ['playing', 43.38, 43.64],
    ['a', 43.7, 43.74],
    ['game.', 43.8, 44.06],
  ],
  [
    ['Created', 44.78, 45.16],
    ['by', 45.2, 45.32],
    ['mathematician', 45.38, 46.16],
    ['John', 46.24, 46.44],
    ['von', 46.5, 46.64],
    ['Neumann', 46.7, 47.02],
    ['and', 47.38, 47.44],
    ['expanded', 47.5, 48.06],
    ['by', 48.1, 48.24],
    ['John', 48.3, 48.52],
    ['Nash,', 48.58, 48.94],
    ['game', 49.36, 49.6],
    ['theory', 49.64, 49.92],
    ['assumes', 49.98, 50.4],
    ['players', 50.44, 50.88],
    ['are', 50.92, 51.04],
    ['rational', 51.12, 51.76],
    ['and', 51.82, 51.9],
    ['trying', 51.96, 52.2],
    ['to', 52.24, 52.32],
    ['maximize', 52.38, 52.98],
    ['their', 53.02, 53.2],
    ['own', 53.28, 53.44],
    ['self-interest.', 53.5, 54.18],
  ],
  [
    ['But', 54.94, 55.02],
    ['as', 55.08, 55.18],
    ['the', 55.22, 55.3],
    ["prisoner's", 55.34, 55.76],
    ['dilemma', 55.8, 56.2],
    ['proves,', 56.24, 56.62],
    ['pure', 57.04, 57.28],
    ['self-interest', 57.36, 58.02],
    ['often', 58.12, 58.38],
    ['leads', 58.44, 58.72],
    ['to', 58.76, 58.8],
    ['a', 58.84, 58.88],
    ['trap.', 58.94, 59.26],
  ],
  [
    ['Rationally,', 59.88, 60.38],
    ['confessing', 60.72, 61.34],
    ['is', 61.4, 61.48],
    ['your', 61.5, 61.62],
    ['best', 61.66, 61.92],
    ['move', 61.98, 62.18],
    ['regardless', 62.22, 62.8],
    ['of', 62.86, 62.94],
    ['what', 62.96, 63.08],
    ['your', 63.12, 63.22],
    ['partner', 63.28, 63.62],
    ['does.', 63.66, 63.94],
  ],
  [
    ['Because', 64.5, 64.78],
    ['both', 64.819, 65],
    ['of', 65.04, 65.099],
    ['you', 65.14, 65.239],
    ['think', 65.28, 65.48],
    ['this', 65.519, 65.68],
    ['way,', 65.74, 65.94],
    ['you', 66.32, 66.38],
    ['both', 66.42, 66.62],
    ['confess', 66.66, 67.2],
    ['and', 67.24, 67.34],
    ['get', 67.38, 67.56],
    ['five', 67.64, 67.9],
    ['years,', 67.96, 68.28],
    ['missing', 68.72, 68.98],
    ['out', 69.04, 69.16],
    ['on', 69.2, 69.26],
    ['the', 69.3, 69.38],
    ['one-year', 69.46, 69.78],
    ['sentence', 69.84, 70.3],
    ['you', 70.36, 70.42],
    ['could', 70.46, 70.54],
    ['have', 70.56, 70.68],
    ['shared', 70.74, 71],
    ['through', 71.04, 71.22],
    ['trust.', 71.28, 71.72],
  ],
  [
    ['This', 72.4, 72.52],
    ['state', 72.58, 72.76],
    ['of', 72.8, 72.88],
    ['deadlock', 72.92, 73.4],
    ['is', 73.46, 73.56],
    ['called', 73.62, 73.82],
    ['the', 73.86, 73.92],
    ['Nash', 73.98, 74.28],
    ['equilibrium,', 74.34, 74.88],
    ['a', 75.34, 75.38],
    ['point', 75.44, 75.64],
    ['where', 75.66, 75.78],
    ['no', 75.82, 75.96],
    ['player', 76.02, 76.4],
    ['has', 76.44, 76.56],
    ['an', 76.58, 76.64],
    ['incentive', 76.68, 77.24],
    ['to', 77.28, 77.38],
    ['change', 77.44, 77.76],
    ['their', 77.8, 77.96],
    ['strategy', 78.04, 78.5],
    ['on', 78.54, 78.62],
    ['their', 78.66, 78.78],
    ['own.', 78.86, 79.06],
  ],
  [
    ['We', 79.88, 79.98],
    ['see', 80.04, 80.18],
    ['game', 80.24, 80.48],
    ['theory', 80.52, 80.78],
    ['play', 80.82, 81],
    ['out', 81.08, 81.24],
    ['everywhere:', 81.32, 81.76],
    ['in', 82.26, 82.32],
    ['economics,', 82.38, 82.98],
    ['where', 83.12, 83.28],
    ['rival', 83.34, 83.64],
    ['companies', 83.68, 84.1],
    ['set', 84.14, 84.3],
    ['prices,', 84.34, 84.84],
    ['in', 85.2, 85.28],
    ['biology,', 85.32, 85.86],
    ['where', 86.08, 86.2],
    ['species', 86.26, 86.64],
    ['compete', 86.68, 87.04],
    ['for', 87.08, 87.2],
    ['survival,', 87.24, 87.7],
    ['and', 88.18, 88.26],
    ['in', 88.3, 88.4],
    ['international', 88.46, 89.04],
    ['relations,', 89.08, 89.66],
    ['where', 89.98, 90.1],
    ['nations', 90.16, 90.62],
    ['build', 90.66, 90.9],
    ['arsenals', 90.98, 91.46],
    ['during', 91.5, 91.7],
    ['a', 91.74, 91.82],
    ['nuclear', 91.88, 92.26],
    ['standoff.', 92.38, 92.92],
  ],
  [
    ['Understanding', 93.72, 94.28],
    ['game', 94.32, 94.56],
    ['theory', 94.6, 94.88],
    ['does', 94.92, 95.08],
    ['not', 95.12, 95.3],
    ['just', 95.36, 95.5],
    ['reveal', 95.54, 95.92],
    ['why', 95.96, 96.12],
    ['people', 96.16, 96.44],
    ['act', 96.54, 96.7],
    ['selfishly,', 96.76, 97.3],
    ['it', 97.8, 97.86],
    ['also', 97.94, 98.24],
    ['shows', 98.28, 98.58],
    ['how', 98.62, 98.78],
    ['cooperation', 98.84, 99.58],
    ['can', 99.62, 99.72],
    ['emerge.', 99.76, 100.18],
  ],
  [
    ['When', 100.84, 100.94],
    ['people', 101, 101.26],
    ['know', 101.32, 101.48],
    ['they', 101.52, 101.62],
    ['have', 101.68, 101.82],
    ['to', 101.86, 101.96],
    ['interact', 102, 102.42],
    ['repeatedly,', 102.46, 103],
    ['trust', 103.44, 103.76],
    ['suddenly', 103.92, 104.24],
    ['becomes', 104.28, 104.68],
    ['the', 104.72, 104.84],
    ['smartest', 104.92, 105.32],
    ['strategy', 105.4, 105.8],
    ['of', 105.86, 105.92],
    ['all.', 106, 106.14],
  ],
]

function toTranscript(segments: StoredWord[][]): TranscriptData {
  return {
    language: 'eng',
    segments: segments.map((words) => ({
      end: words[words.length - 1][2],
      start: words[0][1],
      text: words.map(([word]) => word).join(' '),
      words: words.map(([word, start, end]) => ({ end, speaker: 'speaker_0', start, word })),
    })),
  }
}

/** Every time the transcript carries: segment bounds, then each word's start, end and speaker. */
function timesOf(transcript: TranscriptData) {
  return transcript.segments.map((segment) => ({
    end: segment.end,
    start: segment.start,
    words: segment.words.map(({ end, speaker, start }) => [start, end, speaker]),
  }))
}

/**
 * Plays the correction LLM: echoes the transcript it was sent with the stored
 * edits applied, the way the stored corrected transcripts came back.
 */
function llmReturns(edits: StoredEdit[]) {
  mockCompletion.mockImplementation(async ({ prompt }: { prompt: string }) => {
    const sent = prompt.split('TRANSCRIPT JSON TO CORRECT:\n')[1].split('\n\nTASK 1')[0]
    const transcript = JSON.parse(sent) as TranscriptData
    for (const segment of transcript.segments) {
      for (const word of segment.words) {
        const edit = edits.find((candidate) => candidate.start === word.start)
        if (edit?.word !== undefined) word.word = edit.word
        if (edit?.end !== undefined) word.end = edit.end
      }
      segment.text = segment.words.map(({ word }) => word).join(' ')
    }
    return {
      correctedTranscript: transcript,
      qualityValidation: {
        confidence: 1,
        explanation: 'No hallucinations.',
        issues: [],
        isValid: true,
      },
    }
  })
}

function scriptOf(transcript: TranscriptData): string {
  return transcript.segments.map(({ text }) => text).join(' ')
}

beforeEach(() => {
  mockCompletion.mockReset()
  mockWriteJsonFile.mockClear()
})

describe('correctTranscriptAndValidateTTSQuality', () => {
  it('keeps the ASR word times when the LLM rewrites one (98.92 s came back as 8.92 s)', async () => {
    llmReturns([{ start: 98.82, end: 8.92 }])
    const transcript = toTranscript(CLOSING_LINE)

    const result = await correctTranscriptAndValidateTTSQuality(
      transcript,
      scriptOf(transcript),
      'story_loader/transcript/debug',
      'project-a',
    )

    expect(mockCompletion).toHaveBeenCalledTimes(1)
    const llmOutput = (await mockCompletion.mock.results[0].value) as {
      correctedTranscript: TranscriptData
    }
    expect(llmOutput.correctedTranscript.segments[0].words[25]).toMatchObject({
      end: 8.92,
      word: 'for',
    })
    expect(result.correctedTranscript).toEqual(toTranscript(CLOSING_LINE))
    expect(result.correctedTranscript.segments[0].words[25]).toEqual({
      end: 98.92,
      speaker: 'speaker_0',
      start: 98.82,
      word: 'for',
    })
    expect(result.hasCorrections).toBe(false)
    expect(result.qualityValidation.isValid).toBe(true)
  })

  it('takes the corrected spelling but keeps every time in chunked correction', async () => {
    llmReturns([
      { start: 74.34, word: 'Equilibrium,' },
      { start: 97.94, end: 8.24 },
    ])
    const transcript = toTranscript(GAME_THEORY)

    const result = await correctTranscriptAndValidateTTSQuality(
      transcript,
      scriptOf(transcript),
      'story_loader/transcript/debug',
      'project-b',
    )

    // 19 segments: two correction calls (15 + 4).
    expect(mockCompletion).toHaveBeenCalledTimes(2)
    const corrected = result.correctedTranscript
    expect(timesOf(corrected)).toEqual(timesOf(toTranscript(GAME_THEORY)))
    expect(corrected.segments[15].words[8]).toEqual({
      end: 74.88,
      speaker: 'speaker_0',
      start: 74.34,
      word: 'Equilibrium,',
    })
    expect(corrected.segments[15].text).toContain('called the Nash Equilibrium, a point')
    expect(corrected.segments[17].words[12]).toEqual({
      end: 98.24,
      speaker: 'speaker_0',
      start: 97.94,
      word: 'also',
    })
    expect(result.hasCorrections).toBe(true)
    // The debug copy of the corrected transcript holds the times that were kept.
    expect(mockWriteJsonFile).toHaveBeenCalledWith(
      expect.stringMatching(/^story_loader\/transcript\/debug\/corrected-/),
      corrected,
    )
  })

  it('keeps the segment bounds, speakers and language from the ASR transcript', async () => {
    mockCompletion.mockImplementation(async ({ prompt }: { prompt: string }) => {
      const sent = prompt.split('TRANSCRIPT JSON TO CORRECT:\n')[1].split('\n\nTASK 1')[0]
      const transcript = JSON.parse(sent) as TranscriptData
      const [segment] = transcript.segments
      segment.start = 0
      segment.end = 9.1
      segment.words[0] = { ...segment.words[0], speaker: 'speaker_1', start: 0.04 }
      return {
        correctedTranscript: { ...transcript, language: 'en' },
        qualityValidation: { confidence: 1, explanation: '', issues: [], isValid: true },
      }
    })
    const transcript = toTranscript(CLOSING_LINE)

    const result = await correctTranscriptAndValidateTTSQuality(
      transcript,
      scriptOf(transcript),
      'story_loader/transcript/debug',
      'project-c',
    )

    expect(result.correctedTranscript).toEqual(toTranscript(CLOSING_LINE))
  })
})
