// Beat-sheet segmentation limits. Planning is model-agnostic:
// every model plans against the same 10s max-shot envelope. Model-specific
// behavior (e.g. Seedance 2.5 long clips) belongs to the transition-generation
// stage, not planning. The functions are kept (rather than bare constants) for
// call-site stability.

export const BEAT_SHEET_WORDS_PER_MINUTE = 150
export const BEAT_SHEET_MIN_WORDS_PER_BEAT = 5
export const DEFAULT_BEAT_SHEET_MAX_DURATION_SECONDS = 10

const DEFAULT_PLAIN_TEXT_HARD_MAX_WORDS_PER_BEAT = 27
const DEFAULT_FIXED_SEGMENT_MAX_WORDS = 25

export function resolveBeatSheetMaxDurationSeconds(): number {
  return DEFAULT_BEAT_SHEET_MAX_DURATION_SECONDS
}

export function resolveFixedSegmentWordEnvelope(): {
  maxWords: number
  minWords: number
} {
  return {
    minWords: BEAT_SHEET_MIN_WORDS_PER_BEAT,
    maxWords: DEFAULT_FIXED_SEGMENT_MAX_WORDS,
  }
}

export function resolvePlainTextHardMaxWordsPerBeat(): number {
  return DEFAULT_PLAIN_TEXT_HARD_MAX_WORDS_PER_BEAT
}
