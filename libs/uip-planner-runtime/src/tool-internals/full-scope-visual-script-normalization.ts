import type { LongTakeBeatSheetOutput } from '../tool-internals/visual-script-beat-sheet-schema'
import type { Shot } from '../types'

import { auditNormalizeToken } from './long-take-beat-sheet-audit'

type AuditedSourceSpan = {
  beatIndexes: number[]
  shot: Shot
}

type FullScopeBeat = LongTakeBeatSheetOutput['beat_sheet'][number]

export function normalizeFullCoverageVisualScriptByBeat(params: {
  beatSheet: FullScopeBeat[]
  generatedShots: Shot[]
  /**
   * The beat sheet is authoritative for voice-over text. Set only after the plain-text beat
   * sheet has passed source-alignment audit. The matched model shot still supplies visuals,
   * assets, and the interval that this normalizer divides among any combined beats.
   */
  preferBeatAudioVo?: boolean
  /**
   * The beat sheet is authoritative for timing AND voice-over text. Set for beat-locked (music)
   * sheets: cut timing is decided by the musical beat grid, lyric beats keep their segment text
   * verbatim, and instrumental (empty-text) beats stay silent even when the model invented words.
   */
  preferBeatTimeRanges?: boolean
}): Shot[] {
  const { beatSheet, generatedShots, preferBeatAudioVo, preferBeatTimeRanges } = params
  const auditedSourceSpans = preferBeatAudioVo
    ? mapAuditedBeatSources(beatSheet, generatedShots)
    : []
  const byShotId = new Map(
    generatedShots
      .map((shot) => [shot.shot_id?.trim(), shot] as const)
      .filter((entry): entry is [string, Shot] => Boolean(entry[0])),
  )

  return beatSheet.map((beat, index) => {
    const targetShotId = `shot_${beat.beat_id}`
    const auditedSourceSpan = auditedSourceSpans[index]
    const source =
      auditedSourceSpan?.shot ??
      byShotId.get(targetShotId) ??
      byShotId.get(String(beat.beat_id)) ??
      generatedShots[index]
    const sourceVisual = source?.visual_primary
    const beatText = beat.segment_text.trim()
    const coreDescription =
      sourceVisual?.core_description?.trim() || beatText || 'Visual representation'
    const beatTime = beat.time_range
      ? { start_s: beat.time_range.start, end_s: beat.time_range.end }
      : undefined

    return {
      audio_vo:
        preferBeatAudioVo || preferBeatTimeRanges ? beatText : source?.audio_vo?.trim() || beatText,
      ...(preferBeatTimeRanges && !beatText ? { is_instrumental: true } : {}),
      order: index + 1,
      pre_selected_assets: source?.pre_selected_assets ?? [],
      shot_id: targetShotId,
      time: (preferBeatTimeRanges ? beatTime : undefined) ??
        splitAuditedSourceTime(auditedSourceSpan, index, beatSheet) ??
        source?.time ??
        beatTime ?? { start_s: 0, end_s: 0 },
      visual_primary: {
        aesthetic_mode: sourceVisual?.aesthetic_mode ?? 'Live Action',
        availability: sourceVisual?.availability ?? 'MED',
        core_description: coreDescription,
        entry_action: sourceVisual?.entry_action?.trim() || null,
        exit_action: sourceVisual?.exit_action?.trim() || null,
        expression_type: sourceVisual?.expression_type ?? beat.visual_mode_hint ?? 'Literal',
        notes: sourceVisual?.notes ?? [],
        // Carried through as-is. The last-shot-null invariant is enforced once,
        // on the finalized FULL sequence in generate-visual-script.ts -- the
        // fixed-segments path skips this function entirely, so enforcing it here
        // too would only cover half the callers while reading as if it covered
        // all of them. Undefined on V2 shots, which have no hand-off.
        transition_to_next: sourceVisual?.transition_to_next,
      },
    }
  })
}

export function parseFullScopeBeatSheet(beatSheetJson?: string): FullScopeBeat[] {
  const json = beatSheetJson?.trim()
  if (!json) {
    return []
  }

  try {
    const parsed = JSON.parse(json) as { beat_sheet?: unknown }
    if (!Array.isArray(parsed.beat_sheet)) {
      return []
    }

    return parsed.beat_sheet
      .map((item, index) => normalizeFullScopeBeatSheetItem(item, index))
      .filter((beat): beat is FullScopeBeat => Boolean(beat))
  } catch {
    return []
  }
}

function isTokenPrefix(candidate: string[], target: string[]): boolean {
  return (
    candidate.length <= target.length && candidate.every((token, index) => target[index] === token)
  )
}

/**
 * Maps each source-audited beat back to the model shot whose narration covered it. The model may
 * legally collapse several requested beats into one response shot; matching the canonical token
 * stream preserves that shot's visual and asset intent for every beat restored by normalization.
 */
function mapAuditedBeatSources(
  beatSheet: FullScopeBeat[],
  generatedShots: Shot[],
): Array<AuditedSourceSpan | undefined> {
  const result: Array<AuditedSourceSpan | undefined> = Array.from({ length: beatSheet.length })
  let beatCursor = 0

  for (const shot of generatedShots) {
    const shotTokens = narrationTokens(shot.audio_vo)
    if (shotTokens.length === 0 || beatCursor >= beatSheet.length) {
      continue
    }

    const combinedBeatTokens: string[] = []
    const beatIndexes: number[] = []
    let matched = false
    for (let beatIndex = beatCursor; beatIndex < beatSheet.length; beatIndex += 1) {
      combinedBeatTokens.push(...narrationTokens(beatSheet[beatIndex].segment_text))
      beatIndexes.push(beatIndex)

      if (!isTokenPrefix(combinedBeatTokens, shotTokens)) {
        break
      }
      if (combinedBeatTokens.length !== shotTokens.length) {
        continue
      }

      const span = { beatIndexes: [...beatIndexes], shot }
      for (const mappedBeatIndex of beatIndexes) {
        result[mappedBeatIndex] = span
      }
      beatCursor = beatIndex + 1
      matched = true
      break
    }

    // A model paraphrase cannot be aligned safely. Advance by its stable id/order slot so a
    // later exact combined shot can still map the remaining canonical beats.
    if (!matched) {
      const fallbackIndex = resolveGeneratedShotBeatIndex(shot, beatSheet.length)
      if (fallbackIndex !== null) {
        beatCursor = Math.max(beatCursor, fallbackIndex + 1)
      }
    }
  }

  return result
}

function narrationTokens(value: string): string[] {
  return value.trim().split(/\s+/).map(auditNormalizeToken).filter(Boolean)
}

function resolveGeneratedShotBeatIndex(shot: Shot, beatCount: number): null | number {
  const shotIdMatch = /^shot_(\d+)$/.exec(shot.shot_id.trim())
  const oneBasedIndex = shotIdMatch ? Number(shotIdMatch[1]) : shot.order
  const index = oneBasedIndex - 1
  return Number.isInteger(index) && index >= 0 && index < beatCount ? index : null
}

function splitAuditedSourceTime(
  span: AuditedSourceSpan | undefined,
  beatIndex: number,
  beatSheet: FullScopeBeat[],
): Shot['time'] | undefined {
  if (!span) {
    return undefined
  }
  if (span.beatIndexes.length === 1) {
    return span.shot.time
  }

  const position = span.beatIndexes.indexOf(beatIndex)
  if (position === -1) {
    return undefined
  }
  const weights = span.beatIndexes.map((index) =>
    Math.max(1, narrationTokens(beatSheet[index].segment_text).length),
  )
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
  const elapsedWeight = weights.slice(0, position).reduce((sum, weight) => sum + weight, 0)
  const duration = span.shot.time.end_s - span.shot.time.start_s

  return {
    start_s: span.shot.time.start_s + duration * (elapsedWeight / totalWeight),
    end_s: span.shot.time.start_s + duration * ((elapsedWeight + weights[position]) / totalWeight),
  }
}

// Top-level audit flags of the serialized beat sheet. A beat-locked (music) sheet carries
// time_range_audited WITHOUT text_audited -- the text pipeline always sets both together.
export function parseFullScopeBeatSheetMeta(beatSheetJson?: string): {
  textAudited: boolean
  timeRangeAudited: boolean
} {
  const json = beatSheetJson?.trim()
  if (!json) {
    return { textAudited: false, timeRangeAudited: false }
  }
  try {
    const parsed = JSON.parse(json) as { text_audited?: unknown; time_range_audited?: unknown }
    return {
      textAudited: parsed.text_audited === true,
      timeRangeAudited: parsed.time_range_audited === true,
    }
  } catch {
    return { textAudited: false, timeRangeAudited: false }
  }
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

function normalizeFullScopeBeatSheetItem(item: unknown, index: number): FullScopeBeat | null {
  if (!isObjectRecord(item)) {
    return null
  }

  const segmentText = typeof item['segment_text'] === 'string' ? item['segment_text'].trim() : ''
  const timeRange = parseFullScopeBeatTimeRange(item['time_range'])
  // Keep empty-text beats only when they carry timing: beat-locked (music) sheets use them for
  // instrumental intro/interlude/outro coverage. Untimed empty beats stay dropped as noise.
  if (!segmentText && !timeRange) {
    return null
  }
  const duration = parseFullScopeBeatDuration(item['duration'], timeRange)
  const rawBeatId = Number(item['beat_id'])
  const beatId = Number.isInteger(rawBeatId) && rawBeatId > 0 ? rawBeatId : index + 1
  const rawVisualModeHint = item['visual_mode_hint']
  const visualModeHint =
    rawVisualModeHint === 'Cultural Context' ||
    rawVisualModeHint === 'Literal' ||
    rawVisualModeHint === 'Symbolic'
      ? rawVisualModeHint
      : null

  return {
    beat_id: beatId,
    duration,
    segment_text: segmentText,
    time_range: timeRange,
    visual_mode_hint: visualModeHint,
  }
}

function parseFullScopeBeatDuration(
  rawDuration: unknown,
  timeRange?: { end: number; start: number },
): number | undefined {
  if (typeof rawDuration === 'number' && Number.isFinite(rawDuration)) {
    return rawDuration
  }
  return timeRange ? timeRange.end - timeRange.start : undefined
}

function parseFullScopeBeatTimeRange(
  rawTimeRange: unknown,
): undefined | { end: number; start: number } {
  if (!isObjectRecord(rawTimeRange)) {
    return undefined
  }
  const start = rawTimeRange['start']
  const end = rawTimeRange['end']
  return typeof start === 'number' &&
    Number.isFinite(start) &&
    typeof end === 'number' &&
    Number.isFinite(end)
    ? { start, end }
    : undefined
}
