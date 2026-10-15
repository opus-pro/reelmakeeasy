import { countWords as countWordsShared } from '@reelmakeeasy/common/utils/text'

export interface WordCountBudget {
  allowed_max: number
  allowed_min: number
  max_observed: number
  min_observed: number
}

export function computeWordCountBudget(lines: string[]): null | WordCountBudget {
  const counts = lines
    .map((line) => countWords(line))
    .filter((count) => Number.isFinite(count) && count > 0)
  if (counts.length === 0) {
    return null
  }

  const minObserved = Math.min(...counts)
  const maxObserved = Math.max(...counts)

  const maxDelta = Math.max(Math.ceil(maxObserved * 0.2), 4)
  const minDelta = Math.max(Math.ceil(minObserved * 0.2), 4)

  return {
    min_observed: minObserved,
    max_observed: maxObserved,
    allowed_min: Math.max(1, minObserved - minDelta),
    allowed_max: maxObserved + maxDelta,
  }
}

/**
 * Count words in a script, stripping Unicode punctuation before splitting.
 *
 * Delegates to the shared `@reelmakeeasy/common/utils/text#countWords` so that the
 * backend word-cap audit (`syncScriptWordCapAudit`) and the frontend
 * Transcript card (`ScriptTranscriptBlockItem`) both report the same number.
 *
 * The previous implementation used a bare `split(/\s+/)` which counted
 * standalone punctuation tokens (e.g. em-dashes surrounded by spaces) as
 * words, inflating the count relative to what users see in the UI.
 */
export function countWords(text: string): number {
  return countWordsShared(text)
}
