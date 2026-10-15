/**
 * Shared Zod schema + output normalizer for the long-take beat-sheet.
 *
 * Imported by both beat-sheet paths (plain-text in
 * `generate-visual-script-full-scope-story-runtime.ts` and timestamped
 * in `beat-sheet-timestamped.ts`). Extracted into its own file so the
 * two paths can reuse the contract without creating a circular
 * dependency.
 */
import { z } from 'zod'

export const LongTakeBeatSheetModelOutputSchema = z.object({
  beat_sheet: z
    .array(
      z.object({
        beat_id: z.coerce.number().int().positive().nullable().default(null),
        duration: z.coerce.number().nullable().default(null),
        segment_text: z.string(),
        time_range: z
          .object({ start: z.coerce.number(), end: z.coerce.number() })
          .nullable()
          .default(null),
        visual_mode_hint: z
          .enum(['Cultural Context', 'Literal', 'Symbolic'])
          .nullable()
          .default(null),
      }),
    )
    .default([]),
})

export type LongTakeBeatSheetModelOutput = z.infer<typeof LongTakeBeatSheetModelOutputSchema>

export type LongTakeBeatSheetOutput = {
  beat_sheet: Array<{
    beat_id: number
    duration?: number
    segment_text: string
    time_range?: { end: number; start: number }
    visual_mode_hint?: 'Cultural Context' | 'Literal' | 'Symbolic' | null
  }>
  text_audited?: boolean
  time_range_audited?: boolean
}

export function normalizeLongTakeBeatSheetOutput(params: {
  auditPassed?: boolean
  /**
   * Per-beat source-aligned segment text from
   * `auditLongTakeBeatSheet.correctedSegmentTexts`. When a beat's entry is
   * a non-empty string, it replaces the LLM-emitted `segment_text` -- this
   * is the **anti-drift mechanism**: the beat-sheet LLM picks segmentation
   * boundaries, then the audit rewrites each beat's text to the canonical
   * source substring at that boundary. Null entries mean alignment failed
   * for that beat; the LLM's text is kept as the only available signal.
   * Indices are KEPT-BEATS indices (matches `correctedTimeRanges`) -- the
   * audit's input goes through `buildBeatSheetForAudit` which drops empty
   * `segment_text` entries first, so both corrected* arrays are aligned
   * to the SAME post-filter beat list the loop below builds in `beats`.
   */
  correctedSegmentTexts?: Array<null | string>
  correctedTimeRanges?: Array<null | { end: number; start: number }>
  modelOutput: LongTakeBeatSheetModelOutput
  textAudited?: boolean
}): LongTakeBeatSheetOutput {
  const {
    auditPassed = false,
    textAudited = false,
    correctedTimeRanges,
    correctedSegmentTexts,
  } = params
  const beats: LongTakeBeatSheetOutput['beat_sheet'] = []

  for (const item of params.modelOutput.beat_sheet) {
    const llmSegmentText = item.segment_text.trim()
    if (!llmSegmentText) {
      continue
    }

    // Index into corrected* arrays. The audit's input is filtered to drop
    // empty `segment_text` entries (see `buildBeatSheetForAudit`), so its
    // returned arrays are indexed by KEPT beats only -- the same set this
    // loop accumulates in `beats`. Use `beats.length` (current kept count
    // BEFORE we push the new entry) so the lookup matches the audit's
    // post-filter position even when the LLM emits an empty beat before a
    // valid one. Using the raw model index would shift every later beat's
    // lookup and silently lose the source-aligned rewrites.
    const correctedIdx = beats.length

    // Prefer the source-aligned text when available. This is the core of
    // the "newest user reply / canonical script" preservation contract --
    // the LLM is allowed to choose WHERE to cut, but never gets to choose
    // WHICH WORDS appear in the cut. Drift-resistant by construction.
    const correctedText = correctedSegmentTexts?.[correctedIdx]?.trim()
    const segmentText = correctedText && correctedText.length > 0 ? correctedText : llmSegmentText

    const beat: LongTakeBeatSheetOutput['beat_sheet'][number] = {
      beat_id: beats.length + 1,
      segment_text: segmentText,
    }

    if (auditPassed || textAudited) {
      const corrected = correctedTimeRanges?.[correctedIdx]
      const timeRange = corrected ?? item.time_range ?? null
      if (timeRange) {
        beat.time_range = { start: timeRange.start, end: timeRange.end }
        beat.duration = timeRange.end - timeRange.start
        beat.visual_mode_hint = item.visual_mode_hint ?? null
      }
    }

    beats.push(beat)
  }

  const output: LongTakeBeatSheetOutput = { beat_sheet: beats }
  if (auditPassed) {
    output.time_range_audited = true
    output.text_audited = true
  } else if (textAudited) {
    output.text_audited = true
  }
  return output
}
