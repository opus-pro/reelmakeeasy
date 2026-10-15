import type { TimedWord } from './align-text'
import {
  ALIGNER_REPAIR_SECONDS,
  checkCaptionTiming,
  fallbackCaptionTiming,
  MIN_CAPTION_WORD_SECONDS,
  moveFirstWordToOnset,
  repairShortWords,
  splitPhrases,
  spokenLength,
  timeCaptionWords,
  timeCaptionWordsFromAudio,
  WHISPER_REPAIR_SECONDS,
} from './caption-timing'

const mockDetectSilences = jest.fn()
jest.mock('../utils/silence', () => ({
  ...jest.requireActual('../utils/silence'),
  detectSilences: (...args: unknown[]) => mockDetectSilences(...args),
}))

const w = (text: string, start: number, end: number): TimedWord => ({ end, start, text })
const texts = (words: TimedWord[]) => words.map((word) => word.text)
const durations = (words: TimedWord[]) => words.map((word) => word.end - word.start)

/** Every word at least 0.06 s, none before the one ahead of it, all inside [from, to]. */
function expectWellFormed(words: TimedWord[], from = 0, to = Number.POSITIVE_INFINITY) {
  let previousEnd = from
  for (const word of words) {
    expect(word.start).toBeGreaterThanOrEqual(previousEnd - 1e-9)
    expect(word.end - word.start).toBeGreaterThanOrEqual(MIN_CAPTION_WORD_SECONDS - 1e-9)
    previousEnd = word.end
  }
  expect(previousEnd).toBeLessThanOrEqual(to + 1e-9)
}

// A measured Kokoro line (L15), 3.95 s. The aligner works on an 80 ms grid, so "the" came
// back with no length; Whisper put the first word at 0.0 s, though speech starts at 0.33 s.
const L15 = 'Woolly mammoths still lived when the pyramids were being built.'
const L15_ALIGNED = [
  w('Woolly', 0.32, 0.56),
  w('mammoths', 0.56, 0.96),
  w('still', 0.96, 1.36),
  w('lived', 1.36, 1.84),
  w('when', 2, 2.16),
  w('the', 2.16, 2.16),
  w('pyramids', 2.16, 2.72),
  w('were', 2.72, 2.8),
  w('being', 2.8, 3.12),
  w('built', 3.12, 3.52),
]
const L15_HEARD = [
  w(' Woolly', 0, 0.54),
  w(' mammoths', 0.54, 1.02),
  w(' still', 1.02, 1.34),
  w(' lived', 1.34, 1.76),
  w(' when', 1.76, 2.12),
  w(' the', 2.12, 2.2),
  w(' pyramids', 2.2, 2.7),
  w(' were', 2.7, 2.82),
  w(' being', 2.82, 3.06),
  w(' built.', 3.06, 3.36),
]
const L15_SILENCES = [
  { end: 0.329937, start: 0 },
  { end: 2.04925, start: 1.799063 },
  { end: 3.95, start: 3.4805 },
]

// A measured Kokoro line (L01), 3.925 s: the caption writes the number the narration says.
const L01 = 'The Great Pyramid was finished around twenty-five sixty B.C.'
const L01_CAPTION = 'The Great Pyramid was finished around 2560 BC.'
const L01_ALIGNED = [
  w('The', 0.32, 0.32),
  w('Great', 0.32, 0.64),
  w('Pyramid', 0.64, 1.04),
  w('was', 1.04, 1.2),
  w('finished', 1.2, 1.68),
  w('around', 1.76, 2.08),
  w('twentyfive', 2.08, 2.56),
  w('sixty', 2.56, 2.96),
  w('BC', 2.96, 3.44),
]
const L01_SILENCES = [
  { end: 0.302, start: 0 },
  { end: 1.754687, start: 1.630937 },
  { end: 3.925, start: 3.372438 },
]

describe('checkCaptionTiming (the guard)', () => {
  it('passes words that match the caption, in order, each long enough', () => {
    expect(checkCaptionTiming([w('Hi', 0.1, 0.3), w('there.', 0.3, 0.7)], 2)).toEqual({
      issues: [],
      ok: true,
    })
  })

  it('fails when the word count differs from the caption', () => {
    expect(checkCaptionTiming([w('Hi', 0.1, 0.3)], 2).issues).toEqual(['count'])
  })

  it('fails on a time that is not a number', () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY, undefined, null]) {
      const words = [w('Hi', 0.1, bad as unknown as number), w('there', 0.3, 0.7)]
      expect(checkCaptionTiming(words, 2)).toEqual({ issues: ['nonfinite'], ok: false })
    }
  })

  it('fails on a negative time', () => {
    expect(checkCaptionTiming([w('Hi', -0.2, 0.3)], 1).issues).toEqual(['negative'])
  })

  it('fails on a word that ends before it starts (the 98.92 s -> 8.92 s corruption)', () => {
    const words = [w('used', 98.3, 98.78), w('for', 98.82, 8.92), w('centuries', 98.95, 99.5)]
    expect(checkCaptionTiming(words, 3).issues).toContain('nonmonotonic')
  })

  it('fails on a word that starts before the one ahead of it ends', () => {
    expect(checkCaptionTiming([w('a', 0, 0.5), w('b', 0.4, 0.9)], 2).issues).toEqual([
      'nonmonotonic',
    ])
  })

  it('fails on a word shorter than 0.06 s, and passes one of exactly 0.06 s', () => {
    expect(checkCaptionTiming([w('a', 0.1, 0.159), w('b', 0.2, 0.5)], 2).issues).toEqual(['short'])
    expect(checkCaptionTiming([w('a', 0.11, 0.17), w('b', 0.2, 0.5)], 2).ok).toBe(true)
  })

  it('reports every problem at once', () => {
    expect(checkCaptionTiming([w('a', 0.5, 0.4), w('b', 0.6, 0.62)], 3).issues).toEqual([
      'count',
      'nonmonotonic',
      'short',
    ])
  })

  it('passes an empty caption with no words', () => {
    expect(checkCaptionTiming([], 0).ok).toBe(true)
  })
})

describe('repairShortWords', () => {
  it('lets a short word borrow from the larger silence next to it', () => {
    const words = [w('a', 0, 0.3), w('b', 0.32, 0.36), w('c', 0.5, 0.9)]
    expect(repairShortWords(words, WHISPER_REPAIR_SECONDS, 1)[1]).toEqual(w('b', 0.32, 0.38))
  })

  it('borrows from both silences when one is too small', () => {
    const words = [w('a', 0, 0.3), w('b', 0.32, 0.35), w('c', 0.365, 0.9)]
    expect(repairShortWords(words, 0.04, 1)).toEqual([
      w('a', 0, 0.3),
      w('b', 0.3, 0.36),
      w('c', 0.365, 0.9),
    ])
  })

  it('leaves a word short rather than take a neighbour under 0.06 s', () => {
    const words = [w('a', 0.24, 0.3), w('b', 0.31, 0.33), w('c', 0.34, 0.4)]
    const repaired = repairShortWords(words, 0.04, 1)
    expect(repaired).toEqual([w('a', 0.24, 0.3), w('b', 0.3, 0.34), w('c', 0.34, 0.4)])
    expect(checkCaptionTiming(repaired, 3).issues).toEqual(['short'])
  })

  it('then takes from its longer neighbour, never leaving it under 0.06 s', () => {
    const repaired = repairShortWords([w('a', 0, 0.07), w('b', 0.07, 0.1), w('c', 0.1, 0.6)], 0.04)
    expect(repaired.map((word) => [word.text, word.start, word.end])).toEqual([
      ['a', 0, 0.07],
      ['b', 0.07, expect.closeTo(0.13)],
      ['c', expect.closeTo(0.13), 0.6],
    ])
    expect(checkCaptionTiming(repaired, 3).ok).toBe(true)
  })

  it('fixes a zero-length aligner word with the 80 ms budget, not with 40 ms', () => {
    expect(checkCaptionTiming(repairShortWords(L15_ALIGNED, 0.04, 3.95), 10).issues).toEqual([
      'short',
    ])
    const repaired = repairShortWords(L15_ALIGNED, ALIGNER_REPAIR_SECONDS, 3.95)
    expect(checkCaptionTiming(repaired, 10).ok).toBe(true)
    expect(repaired[5]).toEqual(w('the', 2.16, expect.closeTo(2.22)))
    expect(repaired[6]?.start).toBeCloseTo(2.22)
  })

  it('keeps the first word after 0 and the last before the end of the audio', () => {
    const [first] = repairShortWords([w('a', 0.01, 0.02), w('b', 0.02, 0.5)], 0.08, 0.5)
    expect(first?.start).toBe(0)
    const repaired = repairShortWords([w('a', 0, 0.47), w('b', 0.47, 0.49)], 0.08, 0.5)
    expect(repaired).toEqual([w('a', 0, 0.44), w('b', 0.44, 0.5)])
  })

  it('leaves alone words it cannot fix: reversed, not numbers, or short past the budget', () => {
    const words = [w('a', 0.5, 0.4), w('b', Number.NaN, 0.9), w('c', 1, 1), w('d', 1.5, 2)]
    const repaired = repairShortWords(words, 0.04, 2)
    expect(repaired.slice(0, 3)).toEqual(words.slice(0, 3))
  })

  it('does not change the words it was given', () => {
    const words = [w('a', 0, 0.3), w('b', 0.32, 0.36)]
    const copy = structuredClone(words)
    repairShortWords(words, 0.04, 1)
    expect(words).toEqual(copy)
  })
})

describe('moveFirstWordToOnset', () => {
  it("moves Whisper's early first word to where the speech starts", () => {
    expect(moveFirstWordToOnset(L15_HEARD, 0.329937)[0]).toEqual(w(' Woolly', 0.329937, 0.54))
  })

  it('leaves it when the onset is outside the word or would make it too short', () => {
    expect(moveFirstWordToOnset([w('a', 0.4, 0.8)], 0.3)[0]).toEqual(w('a', 0.4, 0.8))
    expect(moveFirstWordToOnset([w('a', 0, 0.35)], 0.3)[0]).toEqual(w('a', 0, 0.35))
    expect(moveFirstWordToOnset([], 0.3)).toEqual([])
  })
})

describe('spokenLength', () => {
  it('counts letters for a word', () => {
    expect(spokenLength('Hello,')).toBe(5)
    expect(spokenLength("it's")).toBe(3)
  })

  it('counts a number of d digits as 4d + 3 letters', () => {
    expect(spokenLength('7')).toBe(7)
    expect(spokenLength('2560')).toBe(19)
    expect(spokenLength('3,000')).toBe(19)
    expect(spokenLength('100,000')).toBe(27)
    expect(spokenLength('1960s')).toBe(20)
  })

  it('counts BC and AD as 5', () => {
    expect(spokenLength('BC')).toBe(5)
    expect(spokenLength('B.C.')).toBe(5)
    expect(spokenLength('AD.')).toBe(5)
  })

  it('is at least 1', () => {
    expect(spokenLength('—')).toBe(1)
  })
})

describe('splitPhrases', () => {
  it('breaks after punctuation and at dashes', () => {
    expect(splitPhrases('Bananas are berries — but strawberries, surprisingly, are not.')).toEqual([
      ['Bananas', 'are', 'berries —'],
      ['but', 'strawberries,'],
      ['surprisingly,'],
      ['are', 'not.'],
    ])
  })

  it('does not break inside a number, and breaks after closing quotes', () => {
    expect(splitPhrases('It took 3,000 years. He said "stop!" Then nothing')).toEqual([
      ['It', 'took', '3,000', 'years.'],
      ['He', 'said', '"stop!"'],
      ['Then', 'nothing'],
    ])
  })

  it('has the same words as the caption', () => {
    expect(splitPhrases('year—but — no & more')).toEqual([['year—'], ['but —'], ['no &', 'more']])
    expect(splitPhrases('  ')).toEqual([])
  })
})

describe('fallbackCaptionTiming (punctuation + pauses)', () => {
  it('gives each phrase its own stretch of speech when the pauses match the punctuation', () => {
    const silences = [
      { end: 0.3, start: 0 },
      { end: 1.8, start: 1.5 },
      { end: 3.6, start: 3.4 },
    ]
    const { mode, words } = fallbackCaptionTiming(
      'Bananas are berries, but strawberries are not.',
      silences,
      3.6,
    )
    expect(mode).toBe('phrases')
    expect(texts(words)).toEqual([
      'Bananas',
      'are',
      'berries,',
      'but',
      'strawberries',
      'are',
      'not.',
    ])
    expect(words[0]).toEqual(w('Bananas', 0.3, expect.closeTo(0.794, 3)))
    expect(words[2]?.end).toBeCloseTo(1.5)
    expect(words[3]?.start).toBeCloseTo(1.8)
    expect(words[6]?.end).toBeCloseTo(3.4)
    expectWellFormed(words, 0.3, 3.4)
  })

  it('does not trust a count that matches by chance (a dip inside a word)', () => {
    // Line L10 heard as: 3 stretches of speech, the middle one 0.066 s long.
    const silences = [
      { end: 0.435625, start: 0 },
      { end: 1.493688, start: 1.345125 },
      { end: 1.934063, start: 1.56 },
      { end: 4.7, start: 4.019625 },
    ]
    const { mode, words } = fallbackCaptionTiming(
      'Bananas are berries, but strawberries are surprisingly, not.',
      silences,
      4.7,
    )
    expect(mode).not.toBe('phrases')
    expectWellFormed(words, 0.435625, 4.019625)
  })

  it('otherwise keeps every word inside the speech, never in a pause', () => {
    const silences = [
      { end: 0.2, start: 0 },
      { end: 2.2, start: 1.2 },
      { end: 3.2, start: 3.1 },
    ]
    const { mode, words } = fallbackCaptionTiming('one two three four five six', silences, 3.2)
    expect(mode).toBe('speech')
    for (const word of words) {
      const inPause = silences.some((s) => word.start < s.end - 1e-9 && word.end > s.start + 1e-9)
      expect(inPause).toBe(false)
    }
    expectWellFormed(words, 0.2, 3.1)
  })

  it('spreads words by how long they take to say', () => {
    const { words } = fallbackCaptionTiming('In 2560 BC', [], 2.6)
    // 2 + 19 + 5 = 26 letters over 2.6 s
    expect(words).toEqual([w('In', 0, 0.2), w('2560', 0.2, 2.1), w('BC', 2.1, 2.6)])
  })

  it('gives every word at least 0.06 s when there is room', () => {
    const { words } = fallbackCaptionTiming('a a a a supercalifragilisticexpialidocious', [], 0.6)
    expect(Math.min(...durations(words))).toBeGreaterThanOrEqual(MIN_CAPTION_WORD_SECONDS)
    expectWellFormed(words, 0, 0.6)
  })

  it('handles a dash, a lone symbol and a number with a comma like the caption does', () => {
    const { words } = fallbackCaptionTiming('Honey lasts 3,000 years — & more', [], 3)
    expect(texts(words)).toEqual(['Honey', 'lasts', '3,000', 'years — &', 'more'])
    expect(checkCaptionTiming(words, 5).ok).toBe(true)
  })

  it('never throws: no text, no silence, no audio', () => {
    expect(fallbackCaptionTiming('', [], 3).words).toEqual([])
    const silent = fallbackCaptionTiming('Hello there', [{ end: 2, start: 0 }], 2)
    expectWellFormed(silent.words, 0, 2)
    const empty = fallbackCaptionTiming('Hello there', [], 0)
    expect(texts(empty.words)).toEqual(['Hello', 'there'])
    expect(empty.words.every((word) => word.start === 0 && word.end === 0)).toBe(true)
  })
})

describe('timeCaptionWords (aligner, then Whisper, then the fallback)', () => {
  it('takes the aligner words after the 80 ms repair, with the script spelling', () => {
    const timing = timeCaptionWords({
      aligned: L01_ALIGNED,
      durationSeconds: 3.925,
      heard: [],
      silences: L01_SILENCES,
      text: L01,
    })
    expect(timing.source).toBe('aligner')
    expect(timing.rejected).toEqual([])
    expect(texts(timing.words)).toEqual(L01.split(' '))
    expect(timing.words[0]).toEqual(w('The', expect.closeTo(0.26), 0.32))
    expectWellFormed(timing.words, 0, 3.925)
  })

  it('maps an aligner that split words its own way back onto the script', () => {
    const timing = timeCaptionWords({
      aligned: [
        w('It', 0.1, 0.3),
        w('is', 0.3, 0.5),
        w('three', 0.5, 0.9),
        w('thousand', 0.9, 1.5),
      ],
      durationSeconds: 2,
      silences: [],
      text: 'It is 3,000',
    })
    expect(timing.source).toBe('aligner')
    expect(timing.words).toEqual([w('It', 0.1, 0.3), w('is', 0.3, 0.5), w('3,000', 0.5, 1.5)])
  })

  it('uses Whisper when the aligner fails the guard, with the first word moved to the onset', () => {
    const corrupt = L15_ALIGNED.map((word, i) => (i === 3 ? { ...word, end: 0.84 } : word))
    const timing = timeCaptionWords({
      aligned: corrupt,
      durationSeconds: 3.95,
      heard: L15_HEARD,
      silences: L15_SILENCES,
      text: L15,
    })
    expect(timing.source).toBe('whisper')
    expect(timing.rejected).toEqual([{ issues: ['nonmonotonic'], step: 'aligner' }])
    expect(texts(timing.words)).toEqual(L15.split(' '))
    expect(timing.words[0]).toEqual(w('Woolly', 0.329937, 0.54))
    expectWellFormed(timing.words, 0, 3.95)
  })

  it('falls back to punctuation and pauses when both fail, never to a paid call', () => {
    const timing = timeCaptionWords({
      aligned: L15_ALIGNED.map((word) => ({ ...word, end: Number.NaN })),
      durationSeconds: 3.95,
      heard: [w('Woolly', 0.3, 0.3)],
      silences: L15_SILENCES,
      text: L15,
    })
    expect(timing.source).toBe('fallback')
    expect(timing.rejected.map((r) => r.step)).toEqual(['aligner', 'whisper'])
    expect(timing.fallbackMode).toBeDefined()
    expect(timing.issues).toEqual([])
    expectWellFormed(timing.words, 0.329937, 3.4805)
  })

  it("rejects Whisper's zero-length word: the 40 ms budget cannot fix it", () => {
    const heard = [w('a', 0.1, 0.5), w('b', 0.5, 0.5), w('c', 0.5, 0.9)]
    const timing = timeCaptionWords({ durationSeconds: 1, heard, silences: [], text: 'a b c' })
    expect(timing.rejected).toEqual([{ issues: ['short'], step: 'whisper' }])
    expect(timing.source).toBe('fallback')
  })

  it('goes straight to the fallback when nothing local is installed', () => {
    const timing = timeCaptionWords({ durationSeconds: 2, silences: [], text: 'Hello there.' })
    expect(timing).toMatchObject({ fallbackMode: 'phrases', rejected: [], source: 'fallback' })
    expect(timing.words).toEqual([w('Hello', 0, expect.closeTo(1)), w('there.', 1, 2)])
  })

  it('times a caption that writes numbers against the aligned narration', () => {
    const timing = timeCaptionWords({
      aligned: L01_ALIGNED,
      caption: L01_CAPTION,
      durationSeconds: 3.925,
      silences: L01_SILENCES,
      text: L01,
    })
    expect(timing.source).toBe('aligner')
    expect(texts(timing.words)).toEqual(L01_CAPTION.split(' '))
    expect(timing.words.slice(-2)).toEqual([w('2560', 2.08, 2.96), w('BC.', 2.96, 3.44)])
    expectWellFormed(timing.words, 0, 3.925)
  })

  it('falls back on the caption itself when it cannot be laid over the narration', () => {
    const timing = timeCaptionWords({
      aligned: [w('I', 0.1, 0.3), w('saw', 0.3, 0.8), w('seven', 0.8, 0.88), w('cats', 0.88, 1.5)],
      caption: 'I saw 1 2 3 4 5 cats',
      durationSeconds: 1.5,
      silences: [],
      text: 'I saw seven cats',
    })
    expect(timing.source).toBe('fallback')
    expect(timing.rejected).toEqual([{ issues: ['short'], step: 'caption' }])
    expect(texts(timing.words)).toEqual(['I', 'saw', '1', '2', '3', '4', '5', 'cats'])
    expectWellFormed(timing.words, 0, 1.5)
  })

  it('skips a step that returned no words', () => {
    const timing = timeCaptionWords({
      aligned: [],
      durationSeconds: 3.95,
      heard: L15_HEARD,
      silences: L15_SILENCES,
      text: L15,
    })
    expect(timing).toMatchObject({ rejected: [], source: 'whisper' })
  })

  it('has nothing to time for an empty caption', () => {
    expect(timeCaptionWords({ durationSeconds: 2, silences: [], text: '  ' }).words).toEqual([])
  })
})

describe('timeCaptionWordsFromAudio', () => {
  beforeEach(() => mockDetectSilences.mockReset())

  it('reads the pauses (0.12 s at -35 dB) and the length from the audio', async () => {
    mockDetectSilences.mockResolvedValue({ durationSeconds: 3.95, silences: L15_SILENCES })
    const timing = await timeCaptionWordsFromAudio('/tmp/line.wav', { heard: L15_HEARD, text: L15 })
    expect(mockDetectSilences).toHaveBeenCalledWith('/tmp/line.wav', {
      durationSeconds: undefined,
      minSeconds: 0.12,
      noiseDb: -35,
    })
    expect(timing.source).toBe('whisper')
    expect(timing.words[0]?.start).toBe(0.329937)
  })

  it('still times the words when FFmpeg fails', async () => {
    mockDetectSilences.mockRejectedValue(new Error('ffmpeg: not found'))
    const timing = await timeCaptionWordsFromAudio('/tmp/line.wav', {
      durationSeconds: 2,
      text: 'Hello there.',
    })
    expect(timing.source).toBe('fallback')
    expectWellFormed(timing.words, 0, 2)
  })
})
