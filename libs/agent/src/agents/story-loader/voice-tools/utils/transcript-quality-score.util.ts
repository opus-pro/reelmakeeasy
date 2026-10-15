export type TranscriptQualityScore = {
  coverage: number
  similarity: number
  tailCoverage: number
}

const transcriptWordSegmenter =
  typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter('und', { granularity: 'word' })
    : null

const unicodeTranscriptTokenPattern = /[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*/gu

export function buildTranscriptQualityScore(
  originalText: string,
  candidateTranscript: null | string | undefined,
): TranscriptQualityScore {
  if (!candidateTranscript?.trim()) {
    return emptyTranscriptQualityScore()
  }

  const originalTokens = normalizeTranscriptTokens(originalText)
  const candidateTokens = normalizeTranscriptTokens(candidateTranscript)
  if (originalTokens.length === 0 || candidateTokens.length === 0) {
    return emptyTranscriptQualityScore()
  }

  const lcsLength = longestCommonSubsequenceLength(originalTokens, candidateTokens)
  const tailSize = Math.min(24, originalTokens.length)
  const candidateTailWindow = Math.min(candidateTokens.length, Math.max(tailSize * 2, 24))
  const tailOriginalTokens = originalTokens.slice(-tailSize)
  const tailCandidateTokens = candidateTokens.slice(-candidateTailWindow)
  const tailLcsLength = longestCommonSubsequenceLength(tailOriginalTokens, tailCandidateTokens)

  return {
    coverage: lcsLength / originalTokens.length,
    similarity: (2 * lcsLength) / (originalTokens.length + candidateTokens.length),
    tailCoverage: tailOriginalTokens.length > 0 ? tailLcsLength / tailOriginalTokens.length : 0,
  }
}

export function emptyTranscriptQualityScore(): TranscriptQualityScore {
  return { coverage: 0, similarity: 0, tailCoverage: 0 }
}

export function normalizeTranscriptTokens(text: string): string[] {
  const normalizedText = text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/['\u2019]+/gu, "'")

  if (transcriptWordSegmenter) {
    const segmentedTokens: string[] = []

    for (const segment of transcriptWordSegmenter.segment(normalizedText)) {
      if (segment.isWordLike) {
        segmentedTokens.push(segment.segment)
      }
    }

    if (segmentedTokens.length > 0) {
      return segmentedTokens
    }
  }

  return normalizedText.match(unicodeTranscriptTokenPattern) ?? []
}

function longestCommonSubsequenceLength(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) {
    return 0
  }

  let previous = new Array<number>(right.length + 1).fill(0)
  let current = new Array<number>(right.length + 1).fill(0)

  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      if (left[i - 1] === right[j - 1]) {
        current[j] = previous[j - 1] + 1
      } else {
        current[j] = Math.max(previous[j], current[j - 1])
      }
    }
    ;[previous, current] = [current, previous]
    current.fill(0)
  }

  return previous[right.length]
}
