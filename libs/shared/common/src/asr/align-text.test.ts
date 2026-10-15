import {
  alignTextToWords,
  captionWords,
  captionWordText,
  normalizedWord,
  spokenLength,
} from './align-text'
import * as fromGemini from './gemini-transcribe'

describe('captionWords', () => {
  it('splits on spaces and keeps punctuation on the word', () => {
    expect(captionWords('  Hello,   world! ')).toEqual(['Hello,', 'world!'])
  })

  it('keeps numbers, hyphenated words and contractions whole', () => {
    expect(captionWords("It's 3,000 years: twenty-five sixty B.C.")).toEqual([
      "It's",
      '3,000',
      'years:',
      'twenty-five',
      'sixty',
      'B.C.',
    ])
  })

  it('splits words joined by an em or en dash, keeping the dash on the word before it', () => {
    expect(captionWords('a year—but not 1990–1999')).toEqual([
      'a',
      'year—',
      'but',
      'not',
      '1990–',
      '1999',
    ])
  })

  it('keeps a dash or sign on its own with the word before it, so captions still show it', () => {
    expect(captionWords('Sharks — older than trees & ferns')).toEqual([
      'Sharks —',
      'older',
      'than',
      'trees &',
      'ferns',
    ])
    expect(captionWords('— Sharks —')).toEqual(['— Sharks —'])
    expect(captionWords(' — & ')).toEqual([])
  })

  it('counts the same words as the voice server, which splits at dashes and drops signs', () => {
    expect(captionWords('a year—but not 1990–1999 — or &')).toHaveLength(7)
  })

  it('keeps a closing quote on a word that ends in a dash, without a space before it', () => {
    expect(captionWords('"Wait—" she said')).toEqual(['"Wait—"', 'she', 'said'])
    expect(captionWords('it ended—)')).toEqual(['it', 'ended—)'])
  })

  it('still splits a dash followed by an opening quote and a word', () => {
    expect(captionWords('He said—"Yes."')).toEqual(['He', 'said—', '"Yes."'])
  })
})

describe('captionWordText', () => {
  it('drops the spaces inside a caption word, so it stays one word', () => {
    expect(captionWordText('Sharks —')).toBe('Sharks—')
    expect(captionWordText('— Sharks —')).toBe('—Sharks—')
    expect(captionWordText('trees &')).toBe('trees&')
    expect(captionWordText('year—')).toBe('year—')
  })
})

describe('spokenLength', () => {
  it('counts letters for a word, without its punctuation', () => {
    expect(spokenLength('Hello,')).toBe(5)
    expect(spokenLength('year—')).toBe(4)
    expect(spokenLength('Sharks —')).toBe(6)
  })

  it('counts a number of d digits as 4d + 3 letters, with its commas and decimal point', () => {
    expect(spokenLength('2560')).toBe(19)
    expect(spokenLength('3,000')).toBe(19)
    expect(spokenLength('~65')).toBe(11)
    expect(spokenLength('450M')).toBe(16)
    expect(spokenLength('1990–')).toBe(19)
  })

  it('counts BC, AD, BCE and CE as 5, but not the word "ad"', () => {
    for (const era of ['BC', 'B.C.', 'b.c.', 'AD,', 'A.D.', 'BCE', 'CE.']) {
      expect(spokenLength(era)).toBe(5)
    }
    expect(spokenLength('ad')).toBe(2)
  })

  it('is at least 1', () => {
    expect(spokenLength('—')).toBe(1)
  })
})

describe('normalizedWord', () => {
  it('compares words by their letters and digits only', () => {
    expect(normalizedWord('Hello,')).toBe('hello')
    expect(normalizedWord('B.C.')).toBe(normalizedWord('BC'))
    expect(normalizedWord('3,000')).toBe('3000')
    expect(normalizedWord('—')).toBe('')
  })
})

describe('alignTextToWords', () => {
  it('gives each script word the time of the heard word that reads the same', () => {
    expect(
      alignTextToWords('Hello world', [
        { end: 0.45, start: 0.1, text: ' Hello,' },
        { end: 0.9, start: 0.5, text: ' world.' },
      ]),
    ).toEqual([
      { end: 0.45, start: 0.1, text: 'Hello' },
      { end: 0.9, start: 0.5, text: 'world' },
    ])
  })

  it('gives script words that were not heard a share of the gap', () => {
    expect(
      alignTextToWords('Hello there world', [
        { end: 0.45, start: 0.1, text: 'Hello' },
        { end: 0.9, start: 0.5, text: 'world' },
      ]),
    ).toEqual([
      { end: 0.45, start: 0.1, text: 'Hello' },
      { end: 0.5, start: 0.45, text: 'there' },
      { end: 0.9, start: 0.5, text: 'world' },
    ])
  })

  it('shares a heard number between the spoken words it stands for', () => {
    const heard = [
      { end: 0.2, start: 0, text: 'It' },
      { end: 0.4, start: 0.25, text: 'is' },
      { end: 1.1, start: 0.5, text: '3,000' },
      { end: 1.5, start: 1.2, text: 'years' },
    ]
    expect(alignTextToWords('It is three thousand years', heard).slice(2, 4)).toEqual([
      { end: 0.8, start: 0.5, text: 'three' },
      { end: 1.1, start: 0.8, text: 'thousand' },
    ])
  })

  it('gives a written number the time of the spoken words (caption against narration)', () => {
    const narration = [
      { end: 1.68, start: 1.2, text: 'finished' },
      { end: 2.08, start: 1.76, text: 'around' },
      { end: 2.56, start: 2.08, text: 'twenty-five' },
      { end: 2.96, start: 2.56, text: 'sixty' },
      { end: 3.44, start: 2.96, text: 'B.C.' },
    ]
    expect(alignTextToWords('finished around 2560 BC.', narration)).toEqual([
      { end: 1.68, start: 1.2, text: 'finished' },
      { end: 2.08, start: 1.76, text: 'around' },
      { end: 2.96, start: 2.08, text: '2560' },
      { end: 3.44, start: 2.96, text: 'BC.' },
    ])
  })

  it('times both halves of a dashed word', () => {
    expect(
      alignTextToWords('the year—but', [
        { end: 0.2, start: 0, text: 'the' },
        { end: 0.5, start: 0.25, text: 'year,' },
        { end: 0.9, start: 0.7, text: 'but' },
      ]),
    ).toEqual([
      { end: 0.2, start: 0, text: 'the' },
      { end: 0.5, start: 0.25, text: 'year—' },
      { end: 0.9, start: 0.7, text: 'but' },
    ])
  })

  it('skips heard entries without letters or digits (spacing, a lone dash)', () => {
    const spacing = (at: number) => ({ end: at + 0.05, start: at, text: ' ' })
    expect(
      alignTextToWords('Hi there', [
        { end: 0.3, start: 0.1, text: 'Hi' },
        spacing(0.3),
        { end: 0.4, start: 0.35, text: '—' },
        spacing(0.4),
        spacing(0.45),
        { end: 0.9, start: 0.6, text: 'there' },
      ]),
    ).toEqual([
      { end: 0.3, start: 0.1, text: 'Hi' },
      { end: 0.9, start: 0.6, text: 'there' },
    ])
  })

  it('returns words without spaces inside them, a lone dash or sign joined on', () => {
    const heard = ['Sharks', 'older', 'than', 'trees', 'ferns'].map((text, i) => ({
      end: i * 0.5 + 0.4,
      start: i * 0.5,
      text,
    }))
    const words = alignTextToWords('Sharks — older than trees & ferns', heard)
    expect(words.map((w) => w.text)).toEqual(['Sharks—', 'older', 'than', 'trees&', 'ferns'])
    expect(words[0]).toEqual({ end: 0.4, start: 0, text: 'Sharks—' })
  })

  it('is still exported from gemini-transcribe for old imports', () => {
    expect(fromGemini.alignTextToWords).toBe(alignTextToWords)
  })
})
