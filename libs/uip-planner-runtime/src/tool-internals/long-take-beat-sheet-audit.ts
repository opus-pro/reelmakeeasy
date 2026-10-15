// Copied verbatim from story-mode-runtime:
// - auditLongTakeBeatSheet / auditNormalizeToken / scanBeatTokens
//   (libs/story-mode-runtime/src/activities/long-take-experts-analysis.ts)
// - buildTimestampedTranscript / flattenTranscriptWordsForAudit
//   (libs/story-mode-runtime/src/activities/long-take/experts.ts)
//
// Nx module boundaries prevent uip-planner-runtime from importing
// story-mode-runtime (the dependency edge is the other way around), so
// we maintain a physical copy. Keep these in sync with the story-mode
// originals if the audit contract changes.
import type { TranscriptData, TranscriptWord } from '@shared/types/agent/transcript'

export type BeatSheetAuditResult = {
  /**
   * Per-beat source-aligned segment text. Populated (non-null) only when
   * the beat's tokens align cleanly to the transcript -- in that case the
   * returned string is the original transcript words at the beat's matched
   * span, joined with single spaces. Null when alignment failed (mismatch
   * or empty beat). Downstream consumers use this to **physically replace**
   * the LLM-emitted `segment_text` with the source words so paraphrase /
   * smoothing drift cannot reach `shot.audio_vo`. Plain-text (TTS) mode:
   * `transcriptWords[].word` is the script's own words at synthesized
   * timestamps, so the slice = canonical script substring. Audio mode:
   * `transcriptWords[].word` is the real ASR token, identical contract.
   */
  correctedSegmentTexts: Array<null | string>
  correctedTimeRanges: Array<null | { end: number; start: number }>
  reasons: string[]
  textOk: boolean
  timeOk: boolean
}

export type BeatSheetForAudit = {
  beat_sheet: Array<{
    beat_id: number
    segment_text: string
    time_range?: { end: number; start: number }
  }>
}

type BeatSheetAuditOptions = {
  maxDurationSeconds?: number
}

/**
 * Fallback WPM for duration estimation when a beat's text mismatches the
 * source transcript and we can't look up real word timestamps. Matches the
 * plain-text path's synthesis WPM (so non-audio audits use the same value
 * for both real-from-synthesis and fallback paths). For audio mode this is
 * a coarse approximation, but reliably distinguishes an over-cap beat (>~28
 * tokens / >11s) from an in-spec one.
 */
const AUDIT_FALLBACK_WPM = 150
const AUDIT_FALLBACK_SECS_PER_WORD = 60 / AUDIT_FALLBACK_WPM

export function auditLongTakeBeatSheet(
  beatSheet: BeatSheetForAudit,
  transcriptWords: Array<{ end: number; start: number; word: string }>,
  options: BeatSheetAuditOptions = {},
): BeatSheetAuditResult {
  const maxDurationSeconds = options.maxDurationSeconds ?? 10
  const upperDurationBound = maxDurationSeconds > 10 ? maxDurationSeconds : maxDurationSeconds + 1
  const reasons: string[] = []
  const correctedTimeRanges: Array<null | { end: number; start: number }> = []
  const correctedSegmentTexts: Array<null | string> = []
  let textOk = true
  let timeOk = true
  let txCursor = 0

  for (const beat of beatSheet.beat_sheet) {
    const beatTokens = beat.segment_text
      .trim()
      .split(/\s+/)
      .map(auditNormalizeToken)
      .filter(Boolean)

    if (beatTokens.length === 0) {
      correctedTimeRanges.push(null)
      correctedSegmentTexts.push(null)
      continue
    }

    const scan = scanBeatTokens(beatTokens, transcriptWords, txCursor)
    txCursor = scan.nextCursor

    // Text check.
    if (scan.mismatchCount > 0) {
      textOk = false
      reasons.push(`Beat ${beat.beat_id} has ${scan.mismatchCount} token mismatch(es)`)
    }

    // Corrected time range: only meaningful when text aligns AND scan found
    // a span. Otherwise null -- downstream consumers (visual-script-timing
    // alignment) treat null as "fall back to WPM estimate".
    const correctedRange =
      scan.mismatchCount === 0 && scan.firstTxIdx !== -1
        ? {
            start: transcriptWords[scan.firstTxIdx].start,
            end: transcriptWords[scan.lastTxIdx].end,
          }
        : null
    correctedTimeRanges.push(correctedRange)

    // Source-aligned segment text: when scan cleanly maps the beat to a
    // contiguous span of source words, join those words (with their
    // original casing / punctuation) so callers can replace the LLM's
    // possibly-drifted `segment_text` with the canonical substring. Null
    // when alignment failed -- caller falls back to the LLM output.
    const correctedSegmentText =
      scan.mismatchCount === 0 && scan.firstTxIdx !== -1
        ? transcriptWords
            .slice(scan.firstTxIdx, scan.lastTxIdx + 1)
            .map((w) => w.word)
            .join(' ')
        : null
    correctedSegmentTexts.push(correctedSegmentText)

    // Time check ALWAYS runs, even when text mismatched. Without this, an
    // LLM that paraphrases or drops a token hides over-cap / under-cap
    // beats from the audit retry feedback (the LLM would only see the text
    // mismatch, fix words on retry, and only then surface the duration
    // problem -- often too late within the 2-attempt budget). Use the real
    // transcript range when text aligns; otherwise estimate from token
    // count at AUDIT_FALLBACK_WPM.
    const estimatedDuration = correctedRange
      ? correctedRange.end - correctedRange.start
      : beatTokens.length * AUDIT_FALLBACK_SECS_PER_WORD
    if (estimatedDuration < 1.8 || estimatedDuration > upperDurationBound) {
      timeOk = false
      const label = correctedRange ? 'corrected duration' : 'estimated duration'
      reasons.push(
        `Beat ${beat.beat_id} ${label} ${estimatedDuration.toFixed(
          2,
        )}s out of [1.8, ${upperDurationBound}] range`,
      )
    }
  }

  // Trailing transcript tokens not covered by any beat
  const trailing = transcriptWords
    .slice(txCursor)
    .filter((w) => auditNormalizeToken(w.word).length > 0)
  if (trailing.length > 0) {
    textOk = false
    reasons.push(`${trailing.length} trailing transcript token(s) not covered by any beat`)
  }

  return { textOk, timeOk, reasons, correctedTimeRanges, correctedSegmentTexts }
}

export function auditNormalizeToken(token: string): string {
  return token
    .toLowerCase()
    .replace(/[\u2019']/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

export function buildTimestampedTranscript(transcript: TranscriptData): string {
  const lines: string[] = []
  for (const segment of transcript.segments || []) {
    const words = segment.words || []
    if (words.length === 0) {
      continue
    }
    const parts = words.map((w) => `${w.word}(${w.end.toFixed(1)}s)`)
    lines.push(parts.join(' '))
  }
  return lines.join('\n')
}

export function flattenTranscriptWordsForAudit(transcript: TranscriptData): TranscriptWord[] {
  const words: TranscriptWord[] = []
  for (const segment of transcript.segments || []) {
    for (const word of segment.words || []) {
      words.push(word)
    }
  }
  return words
}

/**
 * Cursor-forward token matcher. Normalizes both sides via
 * `auditNormalizeToken` and scans the transcript starting at `txCursor`.
 * On success returns `{firstTxIdx, lastTxIdx}` pointing into `transcriptWords`
 * for the first and last successful match; on total failure returns
 * `firstTxIdx = -1`.
 *
 * Also used outside the beat-sheet audit path to align UIP shots against
 * the ASR transcript (audio mode) -- see
 * `visual-script-timing.ts:applyShotTimesWithTranscript`.
 */
export function scanBeatTokens(
  beatTokens: string[],
  transcriptWords: Array<{ end: number; start: number; word: string }>,
  txCursor: number,
): { firstTxIdx: number; lastTxIdx: number; mismatchCount: number; nextCursor: number } {
  let firstTxIdx = -1
  let lastTxIdx = -1
  let mismatchCount = 0
  let cursor = txCursor

  for (const token of beatTokens) {
    if (cursor >= transcriptWords.length) {
      mismatchCount++
      continue
    }
    const txToken = auditNormalizeToken(transcriptWords[cursor].word)
    if (txToken === token) {
      if (firstTxIdx === -1) {
        firstTxIdx = cursor
      }
      lastTxIdx = cursor
      cursor++
    } else {
      mismatchCount++
      cursor++
    }
  }

  return { firstTxIdx, lastTxIdx, mismatchCount, nextCursor: cursor }
}
