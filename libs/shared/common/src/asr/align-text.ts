/**
 * Lays a known text over timed words: the script over what a speech-to-text model heard
 * (Gemini Transcribe, local Whisper), or a caption ("2560 BC") over the timed narration
 * ("twenty-five sixty B.C."). Also the one word split that the aligners, the caption-timing
 * guard and the captions share.
 */

/** How many heard words ahead a script word may match (skips misheard or extra words). */
const MATCH_WINDOW = 4
/** An em or en dash followed by a word, maybe behind opening punctuation such as a quote. */
const DASH_BEFORE_WORD = /([—–])(?=[^\s\p{L}\p{N}]*[\p{L}\p{N}])/gu

export interface TimedWord {
  end: number
  start: number
  text: string
}

/**
 * Times the known text's words with the heard words: each script word takes the time of the next
 * heard word that reads the same (within a few words). A run of script words that matches
 * nothing ("three thousand" heard as "3,000") shares, evenly, the time of the heard words
 * between its matched neighbours. Heard entries without letters or digits (spacing) are skipped.
 */
export function alignTextToWords(text: string, heard: TimedWord[]): TimedWord[] {
  const tokens = captionWords(text)
  const spoken = heard.filter((word) => normalizedWord(word.text))
  const { heardIndex, times } = matchWords(tokens, spoken)
  fillGaps(times, heardIndex, spoken)
  return tokens.map((token, i) => ({
    end: round(times[i]?.end ?? 0),
    start: round(times[i]?.start ?? 0),
    text: captionWordText(token),
  }))
}

/**
 * A caption word as a timed word's text: one word, so without the spaces `captionWords` keeps
 * around a lone dash or sign ("trees &" becomes "trees&"). Transcripts and the editor read
 * each timed word as one whitespace-free word.
 */
export function captionWordText(word: string): string {
  return word.replaceAll(/\s+/g, '')
}

/**
 * The words of a script or caption, as everything here counts them: whitespace-separated, with
 * their punctuation, "3,000" and "twenty-five" whole. Words joined by an em or en dash are two
 * words, the dash staying on the first, as the voice server's aligners split them; a dash
 * followed only by punctuation (a closing quote) splits nothing, so the quote stays on its word.
 * A dash or sign standing on its own (a spaced dash, "&") is not a word: it stays with the word
 * before it, or the one after it at the start, so captions still show it.
 * Send `captionWords(text).join(' ')` to an aligner so its word count matches.
 */
export function captionWords(text: string): string[] {
  const words: string[] = []
  let lead = ''
  for (const token of text.replaceAll(DASH_BEFORE_WORD, '$1 ').split(/\s+/)) {
    if (!token) continue
    if (!normalizedWord(token)) {
      if (words.length > 0) words[words.length - 1] += ` ${token}`
      else lead = lead ? `${lead} ${token}` : token
      continue
    }
    words.push(lead ? `${lead} ${token}` : token)
    lead = ''
  }
  return words
}

/** Lowercase letters and digits only, so "Hello," matches "hello" and "B.C." matches "BC". */
export function normalizedWord(word: string): string {
  return word.toLowerCase().replaceAll(/[^\p{L}\p{N}]/gu, '')
}

/**
 * How long a word takes to say, in letters: its letters, plus 4d+3 for each number of d digits
 * ("2560" is "twenty-five sixty"; "3,000" is one number), and 5 for an era: BC, AD, BCE or CE in
 * capitals, or written with full stops ("b.c."), so the word "ad" stays 2. The caption-timing
 * fallback and the loop captions spread words by it.
 */
export function spokenLength(word: string): number {
  const bare = word.replaceAll(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
  const era = bare.replaceAll('.', '')
  if (/^(?:AD|BCE?|CE)$/.test(era) || (bare.includes('.') && /^(?:ad|bce?|ce)$/i.test(era))) {
    return 5
  }
  const numbers = bare.match(/\p{N}(?:[\p{N},.]*\p{N})?/gu) ?? []
  const digits = numbers.reduce(
    (sum, number) => sum + 4 * number.replaceAll(/[^\p{N}]/gu, '').length + 3,
    0,
  )
  const rest = numbers.reduce((left, number) => left.replace(number, ''), bare)
  return Math.max(1, digits + (rest.match(/\p{L}/gu)?.length ?? 0))
}

/** Gives each unmatched run of script words an even share of the time between its neighbours. */
function fillGaps(
  times: (null | Omit<TimedWord, 'text'>)[],
  heardIndex: number[],
  heard: TimedWord[],
): void {
  for (let i = 0; i < times.length; ) {
    if (times[i]) {
      i++
      continue
    }
    let j = i
    while (j < times.length && !times[j]) j++
    const skipped = heard.slice((heardIndex[i - 1] ?? -1) + 1, heardIndex[j] ?? heard.length)
    const from = skipped[0]?.start ?? times[i - 1]?.end ?? heard[0]?.start ?? 0
    const to = Math.max(from, skipped.at(-1)?.end ?? times[j]?.start ?? heard.at(-1)?.end ?? from)
    const step = (to - from) / (j - i)
    for (let k = i; k < j; k++) {
      times[k] = { end: from + step * (k - i + 1), start: from + step * (k - i) }
    }
    i = j
  }
}

/** Each script word's time from the next heard word that reads the same, within a few words. */
function matchWords(
  tokens: string[],
  heard: TimedWord[],
): { heardIndex: number[]; times: (null | Omit<TimedWord, 'text'>)[] } {
  const times: (null | Omit<TimedWord, 'text'>)[] = tokens.map(() => null)
  const heardIndex = tokens.map(() => -1)
  let next = 0
  for (const [i, token] of tokens.entries()) {
    const want = normalizedWord(token)
    const last = Math.min(heard.length, next + MATCH_WINDOW)
    for (let k = next; k < last; k++) {
      const word = heard[k]
      if (!word || normalizedWord(word.text) !== want) continue
      times[i] = { end: word.end, start: word.start }
      heardIndex[i] = k
      next = k + 1
      break
    }
  }
  return { heardIndex, times }
}

const round = (s: number): number => Math.round(s * 1000) / 1000
