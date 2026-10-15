/**
 * Counts the number of words in a text, supporting multiple languages
 * - For space-separated languages (English, Spanish, Russian, Arabic, etc.): counts words by splitting on whitespace
 * - For non-space-separated languages (Chinese, Japanese, Korean, Thai): counts each character as a word
 * - Punctuation is not counted as words
 */
export function countWords(text: string): number {
  if (!text || !text.trim()) {
    return 0
  }

  const trimmed = text.trim()

  // Match non-space-separated characters (CJK ideographs, Japanese Kana, Korean Hangul, Thai)
  // Excludes punctuation - only count actual characters as words
  const nonSpaceSeparatedPattern =
    /[\u4E00-\u9FFF\u3400-\u4DBF\u3040-\u309F\u30A0-\u30FF\uAC00-\uD7AF\u0E00-\u0E7F]/g

  // Count non-space-separated characters (each is treated as a word)
  const nonSpaceSeparatedChars = trimmed.match(nonSpaceSeparatedPattern)
  const nonSpaceSeparatedCount = nonSpaceSeparatedChars ? nonSpaceSeparatedChars.length : 0

  // Remove non-space-separated characters and punctuation, then count remaining space-separated words
  const spaceSeparatedText = trimmed
    .replace(nonSpaceSeparatedPattern, ' ') // Remove CJK chars
    .replace(/[\u3000-\u303F\uFF00-\uFFEF\p{P}]/gu, ' ') // Remove punctuation (CJK and general)
    .trim()
  const spaceSeparatedWords = spaceSeparatedText
    ? spaceSeparatedText.split(/\s+/).filter((w) => w.length > 0)
    : []
  const spaceSeparatedCount = spaceSeparatedWords.length

  return nonSpaceSeparatedCount + spaceSeparatedCount
}

export function estimateDuration(wordCount: number): [number, number] {
  return [Math.round(wordCount / 2.75), Math.round(wordCount / 2.25)]
}

/**
 * Truncates to at most `maxCodeUnits` UTF-16 code units, never splitting a
 * surrogate pair. Use this instead of a bare `String.prototype.slice` whenever
 * the result is persisted or crosses a JSON boundary.
 *
 * `slice` cuts by code unit, so cutting inside an astral character (any emoji)
 * leaves a lone high surrogate behind. That is not representable in UTF-8:
 * Prisma's query engine rejects such a payload with serde_json's "unexpected
 * end of hex escape", which reached users as an opaque 500.
 *
 * The budget stays in code units rather than code points so callers keep their
 * existing worst-case output length. Dropping the orphaned high surrogate can
 * make the result one code unit shorter than the limit, never longer.
 */
export function truncateWithoutSplittingSurrogates(text: string, maxCodeUnits: number): string {
  if (maxCodeUnits <= 0) {
    return ''
  }
  if (text.length <= maxCodeUnits) {
    return text
  }
  const cut = text.slice(0, maxCodeUnits)
  const lastCodeUnit = cut.charCodeAt(cut.length - 1)
  const endsOnOrphanedHighSurrogate = lastCodeUnit >= 0xd800 && lastCodeUnit <= 0xdbff
  return endsOnOrphanedHighSurrogate ? cut.slice(0, -1) : cut
}
