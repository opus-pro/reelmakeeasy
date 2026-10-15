/**
 * Caption word timing that never needs a paid call. The order, as measured on real voiceovers:
 *  1. the local forced aligner's words for the known script, after an 80 ms repair (one
 *     aligner frame: it can return a word with no length);
 *  2. local Whisper's words with the script laid over them (`alignTextToWords`), after a 40 ms
 *     repair, with the first word moved to where the speech starts (Whisper puts it early);
 *  3. the beat-loop skill's fallback (section 7): split at punctuation, find the pauses, give
 *     each phrase its stretch of speech, and spread the words by how long they take to say.
 * Each step must pass the guard: one time per caption word, finite, in order, and every word at
 * least 0.06 s. The guard is for script-aligned times only: raw speech-to-text words fail it
 * routinely (20 ms grids). A caption that writes the narration differently ("2560 BC" for
 * "twenty-five sixty B.C.") is laid over the timed narration before falling back.
 */
import { logger } from '../logger'
import { ensureError } from '../utils/error-handler'
import {
  CAPTION_PAUSE,
  detectSilences,
  speechOnset,
  speechSpans,
  type TimeSpan,
} from '../utils/silence'

import {
  alignTextToWords,
  captionWords,
  normalizedWord,
  spokenLength,
  type TimedWord,
} from './align-text'

export { spokenLength } from './align-text'

/** The shortest a caption word may last (beat-loop skill, section 7). */
export const MIN_CAPTION_WORD_SECONDS = 0.06
/** How much a short word may grow when it comes from the forced aligner (one 80 ms frame). */
export const ALIGNER_REPAIR_SECONDS = 0.08
/** How much a short word may grow when it comes from Whisper (or a caption laid over words). */
export const WHISPER_REPAIR_SECONDS = 0.04

export interface CaptionTiming {
  /** Set when `source` is `fallback`. */
  fallbackMode?: FallbackMode
  /** What the guard says about `words`; only the fallback can return a non-empty list. */
  issues: CaptionTimingIssue[]
  /** The steps tried before, and why the guard turned them down (for the logs). */
  rejected: { issues: CaptionTimingIssue[]; step: 'aligner' | 'caption' | 'whisper' }[]
  source: CaptionTimingSource
  words: TimedWord[]
}

export interface CaptionTimingCheck {
  issues: CaptionTimingIssue[]
  ok: boolean
}

export interface CaptionTimingInput {
  /** The local forced aligner's words for `text`, if it ran. */
  aligned?: null | TimedWord[]
  /** What the captions show, when it differs from what is said ("2560 BC"). */
  caption?: null | string
  durationSeconds: number
  /** Local Whisper's words, if it ran. */
  heard?: null | TimedWord[]
  /** Pauses in the audio (`CAPTION_PAUSE`). */
  silences: TimeSpan[]
  /** What the voice says: the script the audio was made from. */
  text: string
}

export type CaptionTimingIssue = 'count' | 'negative' | 'nonfinite' | 'nonmonotonic' | 'short'

export type CaptionTimingSource = 'aligner' | 'fallback' | 'whisper'

/**
 * How the fallback laid the words out: a phrase per stretch of speech, words placed in the
 * speech by their length, or spread over the whole span when the stretches can't hold them.
 */
export type FallbackMode = 'phrases' | 'span' | 'speech'

/** Float slack for "at least 0.06 s" and "in order". */
const EPS = 1e-6
/** The fallback gives words a hair over the minimum, so rounding never takes one under it. */
const FALLBACK_FLOOR_SECONDS = MIN_CAPTION_WORD_SECONDS + 0.001
/** A phrase's stretch of speech may be this much shorter or longer than its words predict. */
const PHRASE_FIT_RATIO = 2
const ISSUE_ORDER: CaptionTimingIssue[] = [
  'count',
  'nonfinite',
  'negative',
  'nonmonotonic',
  'short',
]
/**
 * A word ends a phrase when it ends in one of these (a dash included), maybe followed by closing
 * quotes, and by signs standing on their own (a spaced dash, then "&").
 */
const PHRASE_END = /[!,.:;?…—–]["')\]’”]*(?:\s+[^\p{L}\p{N}\s]+)*$/u

/**
 * The aligner's words as the script's words. An aligner that kept the script's word count is
 * read word for word (it drops punctuation: "twentyfive" for "twenty-five"); one that split
 * words its own way ("three thousand" for "3,000") is laid over the script like heard words.
 */
export function alignedToScript(text: string, aligned: TimedWord[]): TimedWord[] {
  const tokens = captionWords(text)
  const spoken = aligned.filter((word) => normalizedWord(word.text))
  if (spoken.length !== tokens.length) return alignTextToWords(text, spoken)
  return tokens.map((token, i) => ({
    end: spoken[i]?.end ?? Number.NaN,
    start: spoken[i]?.start ?? Number.NaN,
    text: token,
  }))
}

/**
 * The guard: one time per caption word, every time a finite number at or after 0, each word
 * ending after it starts and starting after the one ahead of it ends, and lasting at least
 * 0.06 s. Lists every problem it finds.
 */
export function checkCaptionTiming(words: TimedWord[], expectedCount: number): CaptionTimingCheck {
  const issues = new Set<CaptionTimingIssue>()
  if (words.length !== expectedCount) issues.add('count')
  let previousEnd = Number.NEGATIVE_INFINITY
  for (const { end, start } of words) {
    if (!isTime(start) || !isTime(end)) {
      issues.add('nonfinite')
      continue
    }
    if (start < -EPS) issues.add('negative')
    if (end < start - EPS) {
      issues.add('nonmonotonic')
    } else {
      if (start < previousEnd - EPS) issues.add('nonmonotonic')
      if (end - start < MIN_CAPTION_WORD_SECONDS - EPS) issues.add('short')
    }
    previousEnd = Math.max(previousEnd, end)
  }
  return { issues: ISSUE_ORDER.filter((issue) => issues.has(issue)), ok: issues.size === 0 }
}

/**
 * The skill's fallback (section 7), for when no word times pass the guard. The text is split
 * into phrases at its punctuation and dashes, and the audio into stretches of speech at its
 * pauses.
 * When there are as many stretches as phrases, and each stretch is about as long as its
 * phrase's words predict, each phrase gets its stretch. Otherwise the words go into the
 * stretches in order, by length, so none sits in a pause. Inside a stretch, the words share it
 * by spoken length (a number of d digits counts 4d+3 letters, BC and AD 5), each at least 0.06 s
 * when there is room. Never throws; the words always come out in order.
 */
export function fallbackCaptionTiming(
  text: string,
  silences: TimeSpan[],
  durationSeconds: number,
): { mode: FallbackMode; words: TimedWord[] } {
  const phrases = splitPhrases(text)
  const words = phrases.flat()
  const end = Number.isFinite(durationSeconds) ? Math.max(0, durationSeconds) : 0
  const speech = speechSpans(silences, end, MIN_CAPTION_WORD_SECONDS)
  if (words.length > 0 && speech.length === phrases.length && phrasesFit(phrases, speech)) {
    return { mode: 'phrases', words: spreadGroups(phrases, speech) }
  }
  const groups = wordsBySpeech(words, speech)
  if (groups) return { mode: 'speech', words: spreadGroups(groups, speech) }
  const span = { end: speech.at(-1)?.end ?? end, start: speech[0]?.start ?? 0 }
  return { mode: 'span', words: spread(words, span) }
}

/**
 * Moves the first word's start to the speech onset when the onset falls inside it with room
 * to spare: Whisper puts the first word at the start of its window, 250-425 ms early in our measurements.
 */
export function moveFirstWordToOnset(words: TimedWord[], onsetSeconds: number): TimedWord[] {
  const [first, ...rest] = words.map((word) => ({ ...word }))
  if (!first) return []
  if (first.start < onsetSeconds && onsetSeconds < first.end - MIN_CAPTION_WORD_SECONDS) {
    first.start = onsetSeconds
  }
  return [first, ...rest]
}

/**
 * Lets each word shorter than 0.06 s grow by up to `budgetSeconds`: first into the silence
 * around it (the larger gap first; never before 0 or past the end of the audio), then by
 * taking time from its longer neighbour, never leaving that one under 0.06 s. A word that needs
 * more than the budget, ends before it starts, or has a time that isn't a number is left for
 * the guard to turn down. Returns new words.
 */
export function repairShortWords(
  words: TimedWord[],
  budgetSeconds: number,
  audioEndSeconds?: number,
): TimedWord[] {
  const out = words.map((word) => ({ ...word }))
  for (const [i, word] of out.entries()) {
    const length = word.end - word.start
    if (!isTime(word.start) || !isTime(word.end) || length < 0) continue
    const need = MIN_CAPTION_WORD_SECONDS - length
    if (need <= EPS || need > budgetSeconds + EPS) continue
    const left = borrowFromSilence(out, i, need, audioEndSeconds ?? word.end + budgetSeconds)
    if (left > EPS) borrowFromNeighbours(out, i, left)
  }
  return out.map((word) => ({ ...word, end: roundTime(word.end), start: roundTime(word.start) }))
}

/** The caption's words in phrases, broken after punctuation (",", ".", "?"...) and dashes. */
export function splitPhrases(text: string): string[][] {
  const phrases: string[][] = []
  let phrase: string[] = []
  for (const word of captionWords(text)) {
    phrase.push(word)
    if (PHRASE_END.test(word)) {
      phrases.push(phrase)
      phrase = []
    }
  }
  if (phrase.length > 0) phrases.push(phrase)
  return phrases
}

/**
 * Caption word times from what ran locally, in the order at the top of this file. Pass
 * `caption` when the captions write the narration differently; the words returned are then the
 * caption's. Never throws and never calls a paid service.
 */
export function timeCaptionWords(input: CaptionTimingInput): CaptionTiming {
  const narration = timeNarration(input)
  const caption = input.caption?.trim()
  if (!caption) return narration
  const words = repairShortWords(
    alignTextToWords(caption, narration.words),
    WHISPER_REPAIR_SECONDS,
    input.durationSeconds,
  )
  const check = checkCaptionTiming(words, captionWords(caption).length)
  if (check.ok) return { ...narration, issues: [], words }
  return fallbackTiming(caption, input, [
    ...narration.rejected,
    { issues: check.issues, step: 'caption' },
  ])
}

/**
 * `timeCaptionWords` for an audio file: reads its pauses (`CAPTION_PAUSE`) and length with
 * FFmpeg first. When FFmpeg fails, the words are still timed, without pauses.
 */
export async function timeCaptionWordsFromAudio(
  audioPath: string,
  input: Omit<CaptionTimingInput, 'durationSeconds' | 'silences'> & { durationSeconds?: number },
): Promise<CaptionTiming> {
  let silences: TimeSpan[] = []
  let durationSeconds = input.durationSeconds ?? null
  try {
    const report = await detectSilences(audioPath, {
      ...CAPTION_PAUSE,
      durationSeconds: input.durationSeconds,
    })
    silences = report.silences
    durationSeconds = report.durationSeconds
  } catch (error) {
    logger.warn(
      { audioPath, err: ensureError(error).message },
      '[caption-timing] Could not read the pauses in the audio; timing captions without them',
    )
  }
  return timeCaptionWords({
    ...input,
    durationSeconds: durationSeconds ?? lastWordEnd([input.aligned, input.heard]),
    silences,
  })
}

function borrowFromNeighbours(words: TimedWord[], i: number, need: number): void {
  const word = words[i] as TimedWord
  const neighbours = [words[i - 1], words[i + 1]]
    .map((neighbour, side) => ({ neighbour, side }))
    .filter(({ neighbour }) => neighbour && isTime(neighbour.start) && isTime(neighbour.end))
    .toSorted((a, b) => length(b.neighbour as TimedWord) - length(a.neighbour as TimedWord))
  let left = need
  for (const { neighbour, side } of neighbours) {
    if (left <= EPS || !neighbour) break
    const take = Math.max(0, Math.min(left, length(neighbour) - MIN_CAPTION_WORD_SECONDS))
    if (side === 0) {
      neighbour.end -= take
      word.start -= take
    } else {
      neighbour.start += take
      word.end += take
    }
    left -= take
  }
}

/** Grows the word into the silence on either side, the larger gap first. Returns what's left. */
function borrowFromSilence(
  words: TimedWord[],
  i: number,
  need: number,
  lastWordLimit: number,
): number {
  const word = words[i] as TimedWord
  const previousEnd = i > 0 ? (words[i - 1]?.end ?? Number.NaN) : 0
  const nextStart = i < words.length - 1 ? (words[i + 1]?.start ?? Number.NaN) : lastWordLimit
  const before = gap(word.start - previousEnd)
  const after = gap(nextStart - word.end)
  let left = need
  for (const side of before >= after ? ['before', 'after'] : ['after', 'before']) {
    const take = Math.min(left, side === 'before' ? before : after)
    if (side === 'before') word.start -= take
    else word.end += take
    left -= take
  }
  return left
}

function fallbackTiming(
  text: string,
  input: CaptionTimingInput,
  rejected: CaptionTiming['rejected'],
): CaptionTiming {
  const { mode, words } = fallbackCaptionTiming(text, input.silences, input.durationSeconds)
  const { issues } = checkCaptionTiming(words, words.length)
  return { fallbackMode: mode, issues, rejected, source: 'fallback', words }
}

/** Seconds each word gets of `seconds`, by weight, each at least the floor when there is room. */
function lengthsWithFloor(weights: number[], seconds: number): number[] {
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  if (seconds < weights.length * FALLBACK_FLOOR_SECONDS) {
    return weights.map((weight) => (seconds * weight) / total)
  }
  const floored = weights.map(() => false)
  for (;;) {
    const free = weights.reduce((sum, weight, i) => (floored[i] ? sum : sum + weight), 0)
    const left = seconds - FALLBACK_FLOOR_SECONDS * floored.filter(Boolean).length
    let changed = false
    for (const [i, weight] of weights.entries()) {
      if (!floored[i] && (left * weight) / free < FALLBACK_FLOOR_SECONDS) {
        floored[i] = true
        changed = true
      }
    }
    if (!changed) {
      return weights.map((weight, i) =>
        floored[i] ? FALLBACK_FLOOR_SECONDS : (left * weight) / free,
      )
    }
  }
}

/** Each phrase's stretch holds its words and is within 2x of what their length predicts. */
function phrasesFit(phrases: string[][], speech: TimeSpan[]): boolean {
  const lengths = phrases.map((phrase) => sumOf(phrase.map(spokenLength)))
  const letters = sumOf(lengths)
  const seconds = sumOf(speech.map(spanLength))
  return phrases.every((phrase, k) => {
    const span = spanLength(speech[k] as TimeSpan)
    const expected = (seconds * (lengths[k] ?? 0)) / letters
    return (
      span >= phrase.length * FALLBACK_FLOOR_SECONDS &&
      span * PHRASE_FIT_RATIO >= expected &&
      span <= expected * PHRASE_FIT_RATIO
    )
  })
}

/** The words, one after another, sharing the span by spoken length. */
function spread(words: string[], span: TimeSpan): TimedWord[] {
  const lengths = lengthsWithFloor(words.map(spokenLength), Math.max(0, spanLength(span)))
  let at = span.start
  return words.map((text, i) => {
    const start = at
    at = i === words.length - 1 ? span.end : at + (lengths[i] ?? 0)
    return { end: roundTime(Math.max(start, at)), start: roundTime(start), text }
  })
}

function spreadGroups(groups: string[][], speech: TimeSpan[]): TimedWord[] {
  return groups.flatMap((group, k) =>
    group.length > 0 ? spread(group, speech[k] as TimeSpan) : [],
  )
}

/** Narration word times: the aligner, else Whisper, else the fallback. */
function timeNarration(input: CaptionTimingInput): CaptionTiming {
  const expected = captionWords(input.text).length
  const rejected: CaptionTiming['rejected'] = []
  if (expected === 0)
    return { fallbackMode: 'span', issues: [], rejected, source: 'fallback', words: [] }
  if (input.aligned?.length) {
    const words = repairShortWords(
      alignedToScript(input.text, input.aligned),
      ALIGNER_REPAIR_SECONDS,
      input.durationSeconds,
    )
    const check = checkCaptionTiming(words, expected)
    if (check.ok) return { issues: [], rejected, source: 'aligner', words }
    rejected.push({ issues: check.issues, step: 'aligner' })
  }
  if (input.heard?.length) {
    const repaired = repairShortWords(
      alignTextToWords(input.text, input.heard),
      WHISPER_REPAIR_SECONDS,
      input.durationSeconds,
    )
    const words = moveFirstWordToOnset(repaired, speechOnset(input.silences))
    const check = checkCaptionTiming(words, expected)
    if (check.ok) return { issues: [], rejected, source: 'whisper', words }
    rejected.push({ issues: check.issues, step: 'whisper' })
  }
  return fallbackTiming(input.text, input, rejected)
}

/**
 * The words placed into the stretches of speech in order: laid end to end by spoken length
 * over the speech alone, each goes to the stretch that holds its middle. Null when a stretch
 * gets more words than it has room for.
 */
function wordsBySpeech(words: string[], speech: TimeSpan[]): null | string[][] {
  const weights = words.map(spokenLength)
  const letters = sumOf(weights)
  const seconds = sumOf(speech.map(spanLength))
  if (speech.length === 0 || seconds <= 0) return null
  const groups: string[][] = speech.map(() => [])
  let at = 0
  let k = 0
  let stretchEnd = spanLength(speech[0] as TimeSpan)
  for (const [i, word] of words.entries()) {
    const middle = ((at + (weights[i] ?? 0) / 2) / letters) * seconds
    while (middle > stretchEnd && k < speech.length - 1) {
      k++
      stretchEnd += spanLength(speech[k] as TimeSpan)
    }
    groups[k]?.push(word)
    at += weights[i] ?? 0
  }
  const fits = groups.every(
    (group, j) => spanLength(speech[j] as TimeSpan) >= group.length * FALLBACK_FLOOR_SECONDS,
  )
  return fits ? groups : null
}

/** Silence next to a word, in seconds: 0 when the neighbours overlap or a time is missing. */
const gap = (seconds: number): number => (Number.isFinite(seconds) ? Math.max(0, seconds) : 0)

const isTime = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const lastWordEnd = (lists: (null | TimedWord[] | undefined)[]): number =>
  Math.max(
    0,
    ...lists
      .flatMap((list) => list ?? [])
      .map((word) => word.end)
      .filter(isTime),
  )

const length = (word: TimedWord): number => word.end - word.start

/** To the microsecond: drops float noise from the repair and the fallback. */
const roundTime = (seconds: number): number => Math.round(seconds * 1e6) / 1e6

const spanLength = (span: TimeSpan): number => span.end - span.start

const sumOf = (values: number[]): number => values.reduce((sum, value) => sum + value, 0)
