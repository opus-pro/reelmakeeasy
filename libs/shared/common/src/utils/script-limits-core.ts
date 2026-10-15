import { countWords } from './text'

// These are the LEGACY Story Mode product ceilings -- the safe defaults
// for any consumer that hasn't been threaded through the per-user
// `getStoryModeUserLimits()` / `useStoryModeUserLimits()` resolution.
// Users on the expanded 10-min / 1700-word product (`enable_long_story_mode_video`)
// must read their effective cap from EXPANDED_STORY_MODE_LIMITS instead;
// see libs/shared/common/src/story-mode/user-limits.ts.
export const ABSOLUTE_MAX_SCRIPT_WORDS = 450
export const MAX_SCRIPT_WORDS = 300
export const MAX_SCRIPT_CHARS = 3000

export interface ScriptLimitResult {
  chars: number
  exceeded: boolean
  exceededBy: Array<'chars' | 'words'>
  overflowStartIndex: number // == withinLimitText.length (the cut boundary)
  withinLimitText: string
  words: number
}

/**
 * Evaluates script against word and character limits, and returns trimmed version if exceeded.
 * This is a pure, deterministic function used by both frontend and backend.
 *
 * @param text - The script text to evaluate
 * @param options - Optional limits (defaults: 300 words, 3000 chars)
 * @returns ScriptLimitResult with evaluation metrics and trimmed text
 */
export function evaluateAndTrimScript(
  text: string,
  options?: { maxChars?: number; maxWords?: number },
): ScriptLimitResult {
  const maxWords = options?.maxWords ?? MAX_SCRIPT_WORDS
  const maxChars = options?.maxChars ?? MAX_SCRIPT_CHARS

  const words = countWords(text)
  const chars = text.length

  const exceededBy: Array<'chars' | 'words'> = []
  if (words > maxWords) {
    exceededBy.push('words')
  }
  if (chars > maxChars) {
    exceededBy.push('chars')
  }
  const exceeded = exceededBy.length > 0

  if (!exceeded) {
    return {
      words,
      chars,
      exceeded: false,
      exceededBy: [],
      withinLimitText: text,
      overflowStartIndex: text.length,
    }
  }

  // Apply truncation strategy: char limit first, then word limit
  let trimmed = text
  if (chars > maxChars) {
    trimmed = trimByChars(trimmed, maxChars)
  }

  const trimmedWords = countWords(trimmed)
  if (trimmedWords > maxWords) {
    trimmed = trimByWords(trimmed, maxWords)
  }

  return {
    words,
    chars,
    exceeded: true,
    exceededBy,
    withinLimitText: trimmed,
    overflowStartIndex: trimmed.length,
  }
}

/**
 * Trim text to character limit, preferring sentence boundaries
 */
function trimByChars(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text
  }

  const hardCut = text.slice(0, Math.max(0, maxChars))
  const sentenceBoundary = findSentenceCutIndex(hardCut, 0.9)

  return sentenceBoundary >= 0
    ? text.slice(0, Math.max(0, sentenceBoundary + 1)).trim()
    : hardCut.trim()
}

/**
 * Trim text to word limit, preferring sentence boundaries
 */
function trimByWords(text: string, maxWords: number): string {
  if (countWords(text) <= maxWords) {
    return text
  }

  const charIndexAtWordLimit = findCharIndexAtWordLimit(text, maxWords)
  const truncated = text.slice(0, Math.max(0, charIndexAtWordLimit))
  const sentenceBoundary = findSentenceCutIndex(truncated, 0.9)

  return sentenceBoundary >= 0
    ? text.slice(0, Math.max(0, sentenceBoundary + 1)).trim()
    : truncated.trim()
}

/**
 * Find the last sentence ending within the preferred ratio of text length.
 * Recognizes both ASCII sentence enders (period, exclamation, question mark)
 * and their CJK / fullwidth equivalents (U+3002, U+FF01, U+FF1F) plus the
 * ellipsis (U+2026), so Chinese/Japanese scripts trim on a sentence boundary
 * instead of getting a hard mid-sentence cut.
 * @param text - Text to search
 * @param preferFromRatio - Search for sentence endings starting from this ratio (e.g., 0.9 = last 10%)
 * @returns Index of sentence ending character, or -1 if none found
 */
function findSentenceCutIndex(text: string, preferFromRatio: number): number {
  const minBoundary = Math.floor(text.length * preferFromRatio)
  const searchText = text.slice(Math.max(0, minBoundary))
  const sentenceEndings = /[.!?。！？…]/g
  let lastBoundary = -1
  let match: null | RegExpExecArray

  while ((match = sentenceEndings.exec(searchText)) !== null) {
    lastBoundary = minBoundary + match.index
  }

  return lastBoundary
}

/**
 * Find the largest character index such that countWords(text.slice(0, index).trim()) <= maxWords.
 * Uses the shared countWords so trim results align with display and validation.
 */
function findCharIndexAtWordLimit(text: string, maxWords: number): number {
  let low = 0
  let high = text.length
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (countWords(text.slice(0, mid).trim()) <= maxWords) {
      low = mid
    } else {
      high = mid - 1
    }
  }
  return low
}
