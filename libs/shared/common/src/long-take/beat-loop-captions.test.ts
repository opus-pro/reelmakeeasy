import { captionWords } from '../asr/align-text'

import {
  accentWordIndex,
  beatLoopCaptionChunks,
  type BeatTimedWord,
  chunkCaptionWords,
  clipCaptionChunks,
} from './beat-loop-captions'

/** Words timed back to back from `start`, each `durations[i]` long. */
function timed(text: string, durations: number[], start = 0): BeatTimedWord[] {
  let at = start
  return text.split(' ').map((word, i) => {
    const w = {
      end: Number((at + durations[i]).toFixed(3)),
      start: Number(at.toFixed(3)),
      text: word,
    }
    at += durations[i]
    return w
  })
}

const texts = (groups: string[][]): string[] => groups.map((g) => g.join(' '))

describe('chunkCaptionWords', () => {
  it('shows 1-3 words at a time, evenly, never leaving a lone word behind', () => {
    expect(
      texts(
        chunkCaptionWords(
          captionWords('Sharks have been swimming longer than trees have been standing.'),
        ),
      ),
    ).toEqual(['Sharks have been', 'swimming longer than', 'trees have', 'been standing.'])
    expect(texts(chunkCaptionWords(captionWords('Sharks are older still')))).toEqual([
      'Sharks are',
      'older still',
    ])
    expect(
      texts(chunkCaptionWords(captionWords('Every forest on Earth is younger than the shark.'))),
    ).toEqual(['Every forest on', 'Earth is younger', 'than the shark.'])
  })

  it('breaks after punctuation', () => {
    expect(texts(chunkCaptionWords(captionWords('The pyramid, the queen, and the Moon.')))).toEqual(
      ['The pyramid,', 'the queen,', 'and the Moon.'],
    )
    expect(texts(chunkCaptionWords(captionWords('Sharks — older than trees!')))).toEqual([
      'Sharks —',
      'older than trees!',
    ])
  })

  it('does not break after an abbreviation such as "c."', () => {
    expect(texts(chunkCaptionWords(captionWords('Finished c. 2560 BC')))).toEqual([
      'Finished c.',
      '2560 BC',
    ])
    expect(
      texts(chunkCaptionWords(captionWords('The Great Pyramid was finished around 2560 BC.'))),
    ).toEqual(['The Great Pyramid', 'was finished around', '2560 BC.'])
  })
})

describe('captionWords', () => {
  it('keeps a lone dash with the word before it', () => {
    expect(captionWords('  Sharks —  older ')).toEqual(['Sharks —', 'older'])
    expect(captionWords('— Sharks')).toEqual(['— Sharks'])
  })
})

describe('accentWordIndex', () => {
  it('picks the longest non-filler word, the first on a tie', () => {
    expect(accentWordIndex(['The', 'Great', 'Pyramid'])).toBe(2)
    expect(accentWordIndex(['was', 'finished', 'around'])).toBe(1)
    expect(accentWordIndex(['big', 'red'])).toBe(0)
    expect(accentWordIndex(['through', 'the', 'ice.'])).toBe(2)
    expect(accentWordIndex(['2560', 'BC.'])).toBe(0)
  })

  it('falls back to the longest word when every word is filler', () => {
    expect(accentWordIndex(['of', 'the'])).toBe(1)
  })
})

describe('beatLoopCaptionChunks', () => {
  const line1 = {
    narration: 'Sharks are older than trees.',
    words: timed('Sharks are older than trees.', [0.3, 0.15, 0.35, 0.15, 0.55]),
  }
  const line2 = {
    narration: 'Every forest on Earth is younger than the shark.',
    words: timed(
      'Every forest on Earth is younger than the shark.',
      [0.3, 0.4, 0.1, 0.3, 0.1, 0.4, 0.2, 0.1, 0.5],
    ),
  }

  it('places line k 0.15 s into clip k and holds each chunk until the next one', () => {
    const chunks = beatLoopCaptionChunks([line1, line2])
    expect(chunks.map((c) => [c.clipIndex, c.text, c.start, c.end])).toEqual([
      [0, 'Sharks are older', 0.15, 0.95],
      [0, 'than trees.', 0.95, 4],
      [1, 'Every forest on', 4.15, 4.95],
      [1, 'Earth is younger', 4.95, 5.75],
      [1, 'than the shark.', 5.75, 8],
    ])
    expect(chunks[0].words.map((w) => w.text)).toEqual(['Sharks', 'are', 'older'])
    expect(chunks[0].words[2]).toEqual({ end: 0.95, start: 0.6, text: 'older' })
    expect(chunks.map((c) => c.words[c.accentIndex].text)).toEqual([
      'Sharks',
      'trees.',
      'forest',
      'younger',
      'shark.',
    ])
  })

  it('never shows a chunk past its own clip', () => {
    const late = {
      narration: 'Sharks are older than trees.',
      words: timed('Sharks are older than trees.', [0.8, 0.8, 0.8, 0.8, 0.8], 0.2),
    }
    const [first, second] = beatLoopCaptionChunks([late])
    expect(first.end).toBe(second.start)
    expect(second.end).toBe(4)
    expect(Math.max(...second.words.map((w) => w.end))).toBeLessThanOrEqual(4)
  })

  it('times a caption that reads differently through the aligner', () => {
    const narration = 'The first sharks swam four hundred fifty million years ago.'
    const words = timed(narration, [0.1, 0.25, 0.35, 0.3, 0.3, 0.35, 0.3, 0.35, 0.3, 0.3])
    const align = jest.fn((text: string, heard: BeatTimedWord[]) =>
      text.split(' ').map((token, i) => {
        // "450" takes "four hundred fifty"; the rest match one to one.
        const from = i < 4 ? i : i === 4 ? 4 : i + 2
        const to = i === 4 ? 6 : from
        return { end: heard[to].end, start: heard[from].start, text: token }
      }),
    )
    const chunks = beatLoopCaptionChunks(
      [{ caption: 'The first sharks swam 450 million years ago.', narration, words }],
      { align },
    )
    expect(align).toHaveBeenCalledWith(
      'The first sharks swam 450 million years ago.',
      expect.any(Array),
    )
    expect(texts(chunks.map((c) => c.words.map((w) => w.text)))).toEqual([
      'The first sharks',
      'swam 450 million',
      'years ago.',
    ])
    const n450 = chunks[1].words[1]
    expect(n450.start).toBeCloseTo(0.15 + 1, 3)
    expect(n450.end).toBeCloseTo(0.15 + 1.95, 3)
    expect(chunks[1].words[chunks[1].accentIndex].text).toBe('million')
  })

  it('spreads a differing caption by spoken length when there is no aligner', () => {
    const narration = 'The Great Pyramid was finished around twenty-five sixty B.C.'
    const words = timed(narration, [0.1, 0.3, 0.4, 0.15, 0.4, 0.3, 0.45, 0.4, 0.5])
    const chunks = beatLoopCaptionChunks([
      { caption: 'The Great Pyramid was finished around 2560 BC.', narration, words },
    ])
    const shown = chunks.flatMap((c) => c.words)
    expect(shown.map((w) => w.text)).toEqual([
      'The',
      'Great',
      'Pyramid',
      'was',
      'finished',
      'around',
      '2560',
      'BC.',
    ])
    expect(shown[0].start).toBeCloseTo(0.15, 3)
    expect(shown.at(-1)?.end).toBeCloseTo(0.15 + 3, 3)
    for (let i = 1; i < shown.length; i++) expect(shown[i].start).toBeCloseTo(shown[i - 1].end, 3)
    // 2560 is said as "twenty-five sixty": 19 of the 56 spoken characters.
    expect(shown[6].end - shown[6].start).toBeCloseTo((3 * 19) / 56, 2)
  })

  it('keeps each spread phrase inside its spoken phrase, so pauses stay empty', () => {
    const narration = 'Sharks came first, trees came later.'
    const words = [
      { end: 0.4, start: 0, text: 'Sharks' },
      { end: 0.6, start: 0.4, text: 'came' },
      { end: 1, start: 0.6, text: 'first' },
      { end: 1.9, start: 1.5, text: 'trees' },
      { end: 2.1, start: 1.9, text: 'came' },
      { end: 2.6, start: 2.1, text: 'later' },
    ]
    const shown = beatLoopCaptionChunks([
      { caption: 'Sharks 450M years ago, trees 385M years ago.', narration, words },
    ]).flatMap((c) => c.words)
    expect(shown.map((w) => w.text)).toEqual([
      'Sharks',
      '450M',
      'years',
      'ago,',
      'trees',
      '385M',
      'years',
      'ago.',
    ])
    expect(shown[3].end).toBeCloseTo(0.15 + 1, 3)
    expect(shown[4].start).toBeCloseTo(0.15 + 1.5, 3)
    expect(shown[7].end).toBeCloseTo(0.15 + 2.6, 3)
  })

  it('maps word for word when only the spelling differs', () => {
    const narration = 'Sharks survived all five mass extinctions.'
    const words = timed(narration, [0.4, 0.5, 0.2, 0.3, 0.3, 0.7])
    const shown = beatLoopCaptionChunks([
      { caption: 'Sharks survived all 5 mass extinctions.', narration, words },
    ]).flatMap((c) => c.words)
    expect(shown[3]).toEqual({ end: 1.55, start: 1.25, text: '5' })
  })

  it('spreads over the speech window when the line has no usable times', () => {
    const chunks = clipCaptionChunks({
      clipEnd: 8,
      clipIndex: 1,
      clipStart: 4,
      narration: 'Every forest on Earth is younger than the shark.',
      words: [{ end: Number.NaN, start: 0, text: 'Every' }],
    })
    expect(chunks[0].start).toBeCloseTo(4.15, 3)
    expect(chunks.at(-1)?.words.at(-1)?.end).toBeCloseTo(7.6, 3)
    expect(chunks.at(-1)?.end).toBe(8)
  })

  it('splits words the way caption timing does, so its word times are used as they are', () => {
    // timeCaptionWords times two words joined by a dash as two words (captionWords).
    const narration = 'Sharks swam a year—but trees came later.'
    const words = timed(captionWords(narration).join(' '), [0.4, 0.3, 0.1, 0.3, 0.2, 0.4, 0.3, 0.5])
    const shown = beatLoopCaptionChunks([{ narration, words }]).flatMap((c) => c.words)
    expect(shown.map((w) => w.text)).toEqual(captionWords(narration))
    expect(shown[3]).toEqual({ end: 1.25, start: 0.95, text: 'year—' })
    expect(shown[4]).toEqual({ end: 1.45, start: 1.25, text: 'but' })
  })

  it('ignores an aligner result that does not fit the caption', () => {
    const narration = 'Sharks survived all five mass extinctions.'
    const words = timed(narration, [0.4, 0.5, 0.2, 0.3, 0.3, 0.7])
    const shown = beatLoopCaptionChunks(
      [{ caption: 'Sharks survived all 5 mass extinctions.', narration, words }],
      { align: () => [{ end: 9, start: 8, text: 'Sharks' }] },
    ).flatMap((c) => c.words)
    expect(shown).toHaveLength(6)
    expect(shown[3]).toEqual({ end: 1.55, start: 1.25, text: '5' })
  })
})
