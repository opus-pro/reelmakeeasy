/**
 * Caption chunks for loop shorts (beat-loop skill, section 7): 1-3 words at a time, broken
 * after punctuation, each chunk on screen until the next one and never past its own clip, with
 * one accent word per chunk (the longest word that isn't filler).
 *
 * Words are split as caption timing splits them (`captionWords`), so a line timed by
 * `timeCaptionWords` maps word for word. A clip's caption can read differently from what is
 * spoken ("2560 BC" for "twenty-five sixty B.C."). Its words are then timed from the spoken words
 * with the aligner the caller passes (`alignTextToWords`), word for word when the counts match,
 * or else spread over the speech by spoken length (a number of d digits takes as long as 4d+3
 * letters, BC/AD as 5).
 */
import { captionWords, spokenLength } from '../asr/align-text'

import {
  BEAT_CLIP_SECONDS,
  BEAT_LINE_OFFSET_SECONDS,
  BEAT_SPEECH_END_SECONDS,
} from './beat-loop-timing'

export interface BeatCaptionChunk {
  /** The accent word's index in `words`. */
  accentIndex: number
  /** The clip (0-based) the chunk shows in. */
  clipIndex: number
  /** When the next chunk starts, or the clip ends. */
  end: number
  start: number
  /** The chunk as shown: its words joined by spaces. */
  text: string
  words: BeatTimedWord[]
}

/** One clip's caption on the video's clock. */
export interface BeatCaptionClip {
  /** What is shown when it differs from the narration; null or blank shows the narration. */
  caption?: null | string
  clipEnd: number
  clipIndex: number
  clipStart: number
  narration: string
  /** The narration's words, timed on the video's clock (seconds). */
  words: BeatTimedWord[]
}

/** One narration line, timed on its own audio's clock (0 = the line's first sample). */
export interface BeatCaptionLine {
  caption?: null | string
  narration: string
  words: BeatTimedWord[]
}

export interface BeatCaptionOptions {
  /** Times a text's words from heard words (`alignTextToWords`). Its result is used only when it
   *  has one finite, ordered time per shown word. */
  align?: (text: string, heard: BeatTimedWord[]) => BeatTimedWord[]
}

export interface BeatTimedWord {
  end: number
  start: number
  text: string
}

/** Words that never take the accent, unless a chunk has nothing else. */
const FILLER = new Set(
  (
    'a an the and or but nor so yet of to in on at by for with from into onto over under up down ' +
    'out off about around through across than then as is are was were be been being am it its ' +
    "it's that this these those there here what which who whom whose when where why how i you he " +
    'she we they me him her us them my your his our their has have had do does did will would can ' +
    'could shall should may might must just very really not no all some any each every more most ' +
    'much many only also too still even ever again if while after before since until because like'
  ).split(' '),
)

/** Breaks after a token ending in punctuation (closing quotes and brackets allowed after it). */
const BREAK_AFTER = /[!,.:;?–—…-]["')\]’”]*$/
/** Abbreviations that end in a full stop without ending a phrase ("c. 2560 BC"). */
const ABBREVIATION = /^(?:[a-z]\.|(?:approx|ca|dr|mr|mrs|ms|st|vs)\.)$/i

/** Accent: the chunk's longest non-filler word, the first one on a tie; the longest word when
 *  all of them are filler. */
export function accentWordIndex(words: string[]): number {
  let best = -1
  let bestFiller = 0
  words.forEach((word, i) => {
    if (!FILLER.has(bare(word).toLowerCase()) && (best < 0 || letters(word) > letters(words[best])))
      best = i
    if (letters(word) > letters(words[bestFiller])) bestFiller = i
  })
  return best >= 0 ? best : bestFiller
}

/** The whole loop's chunks: line k is placed 0.15 s into clip k, each clip is 4 s. */
export function beatLoopCaptionChunks(
  lines: BeatCaptionLine[],
  opts: BeatCaptionOptions = {},
): BeatCaptionChunk[] {
  return lines.flatMap((line, clipIndex) => {
    const clipStart = clipIndex * BEAT_CLIP_SECONDS
    const offset = clipStart + BEAT_LINE_OFFSET_SECONDS
    return clipCaptionChunks(
      {
        caption: line.caption,
        clipEnd: clipStart + BEAT_CLIP_SECONDS,
        clipIndex,
        clipStart,
        narration: line.narration,
        words: line.words.map((w) => ({
          end: w.end + offset,
          start: w.start + offset,
          text: w.text,
        })),
      },
      opts,
    )
  })
}

/** Groups shown words into chunks of 1-3: phrases end after punctuation, and a longer phrase is
 *  split evenly (4 words show as 2 + 2, never 3 + 1). */
export function chunkCaptionWords(tokens: string[]): string[][] {
  let at = 0
  return chunkSizes(tokens).map((size) => tokens.slice(at, (at += size)))
}

/** One clip's chunks, on the video's clock. */
export function clipCaptionChunks(
  clip: BeatCaptionClip,
  opts: BeatCaptionOptions = {},
): BeatCaptionChunk[] {
  const shown = captionWords(clip.caption?.trim() || clip.narration)
  if (!shown.length) return []
  const times = wordTimes(shown, clip, opts).map((w) => {
    const start = clamp(w.start, clip.clipStart, clip.clipEnd)
    return { end: round(clamp(w.end, start, clip.clipEnd)), start: round(start), text: w.text }
  })
  let at = 0
  const chunks = chunkSizes(shown).map((size) => {
    const words = times.slice(at, (at += size))
    const text = words.map((w) => w.text)
    return {
      accentIndex: accentWordIndex(text),
      clipIndex: clip.clipIndex,
      end: clip.clipEnd,
      start: words[0].start,
      text: text.join(' '),
      words,
    }
  })
  chunks.forEach((chunk, i) => (chunk.end = chunks[i + 1]?.start ?? round(clip.clipEnd)))
  return chunks
}

function bare(word: string): string {
  return word.replaceAll(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
}

function chunkSizes(tokens: string[]): number[] {
  return phraseLengths(tokens).flatMap((length) => {
    const count = Math.ceil(length / 3)
    const base = Math.floor(length / count)
    return Array.from({ length: count }, (_, i) => base + (i < length % count ? 1 : 0))
  })
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

/** One finite, ordered time per word. */
function fits(words: BeatTimedWord[] | undefined, count: number): words is BeatTimedWord[] {
  if (!words || words.length !== count) return false
  return words.every(
    (w, i) =>
      Number.isFinite(w.start) &&
      Number.isFinite(w.end) &&
      w.end >= w.start &&
      (i === 0 || w.start >= words[i - 1].start),
  )
}

const letters = (word: string): number => word.match(/[\p{L}\p{N}]/gu)?.length ?? 0

const normalizedText = (text: string): string =>
  text
    .toLowerCase()
    .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/** Word counts of the phrases, split after punctuation. */
function phraseLengths(tokens: string[]): number[] {
  const lengths: number[] = []
  let length = 0
  tokens.forEach((token, i) => {
    length++
    const ends = BREAK_AFTER.test(token) && !ABBREVIATION.test(token)
    if (ends || i === tokens.length - 1) {
      lengths.push(length)
      length = 0
    }
  })
  return lengths
}

const round = (s: number): number => Math.round(s * 1000) / 1000

/** Words laid end to end from `start` to `end`, each as long as it takes to say. */
function spread(tokens: string[], start: number, end: number): BeatTimedWord[] {
  const weights = tokens.map((token) => spokenLength(token))
  const total = weights.reduce((sum, w) => sum + w, 0)
  let done = 0
  return tokens.map((text, i) => {
    const from = start + ((end - start) * done) / total
    done += weights[i]
    return { end: start + ((end - start) * done) / total, start: from, text }
  })
}

/**
 * The fallback: shown words spread by spoken length over the speech. When the caption and the
 * narration have as many phrases, each shown phrase spreads over its spoken phrase, so the
 * pauses between phrases stay empty.
 */
function spreadOverSpeech(shown: string[], clip: BeatCaptionClip): BeatTimedWord[] {
  const heard = clip.words.filter(
    (w) => Number.isFinite(w.start) && Number.isFinite(w.end) && w.end >= w.start,
  )
  if (!heard.length) {
    const start = clip.clipStart + BEAT_LINE_OFFSET_SECONDS
    return spread(shown, start, Math.min(clip.clipEnd, clip.clipStart + BEAT_SPEECH_END_SECONDS))
  }
  if (fits(clip.words, clip.words.length)) {
    const spokenTokens = captionWords(clip.narration)
    const spoken = phraseLengths(
      spokenTokens.length === clip.words.length ? spokenTokens : clip.words.map((w) => w.text),
    )
    const lengths = phraseLengths(shown)
    if (spoken.length > 1 && spoken.length === lengths.length) {
      let heardAt = 0
      let shownAt = 0
      return lengths.flatMap((length, p) => {
        const phrase = clip.words.slice(heardAt, (heardAt += spoken[p]))
        const words = shown.slice(shownAt, (shownAt += length))
        return spread(words, phrase[0].start, phrase.at(-1)?.end ?? phrase[0].end)
      })
    }
  }
  const start = Math.min(...heard.map((w) => w.start))
  return spread(shown, start, Math.max(...heard.map((w) => w.end)))
}

/** Times for the shown words: the spoken words when they read the same, else the aligner, else
 *  word for word when the counts match, else the spoken-length spread. */
function wordTimes(
  shown: string[],
  clip: BeatCaptionClip,
  opts: BeatCaptionOptions,
): BeatTimedWord[] {
  const label = (times: BeatTimedWord[]): BeatTimedWord[] =>
    times.map((w, i) => ({ end: w.end, start: w.start, text: shown[i] }))
  const sameText =
    !clip.caption?.trim() || normalizedText(clip.caption) === normalizedText(clip.narration)
  if (sameText && fits(clip.words, shown.length)) return label(clip.words)
  if (opts.align && fits(clip.words, clip.words.length) && clip.words.length) {
    const aligned = opts.align(shown.join(' '), clip.words)
    if (fits(aligned, shown.length)) return label(aligned)
  }
  if (fits(clip.words, shown.length)) return label(clip.words)
  return spreadOverSpeech(shown, clip)
}
