import type { TranscriptWord } from '@shared/types/agent/transcript'

import { PatchOp, Shot, Spec } from '../types'
import { countWords } from '../word-budget'

import { auditNormalizeToken, scanBeatTokens } from './long-take-beat-sheet-audit'

/**
 * Default word-per-minute used to derive rough shot durations when no
 * ASR transcript is available (Case 2.2). Since `global_constraints.pacing`
 * was repurposed as a visual (beat-sheet) signal only, voice-over timing
 * no longer comes from pacing. When a transcript IS available (Case 2.1
 * audio mode), shot times are derived directly from word-level timestamps
 * and this constant is only a per-shot fallback for scan failures.
 */
export const DEFAULT_WPM = 150
export const MIN_SHOT_DURATION_SECONDS = 0.8

export interface ShotTimingOptions {
  /** Flattened word-level transcript with start/end timestamps. Triggers
   * the transcript-aligned timing path when provided. */
  transcriptWords?: TranscriptWord[]
  /** Per-shot fallback WPM used when `transcriptWords` is absent or a shot
   * fails to match any transcript token. */
  wpm: number
}

/**
 * Assign start/end times to a batch of shots.
 *
 * Transcript path (audio mode): for each shot, tokenize its `audio_vo` and
 * cursor-forward scan against the transcript. If the scan produces a valid
 * `{firstTxIdx, lastTxIdx}` range, use `transcriptWords[firstTxIdx].start`
 * and `transcriptWords[lastTxIdx].end`. If the scan fails entirely for a
 * shot (no token match at all -- should not happen in audio mode since
 * audio_vo is locked to the ASR-derived script), we fall back to the WPM
 * estimate for that single shot and continue cursor-forward with the next
 * shot.
 *
 * WPM path (no-audio / transcript missing): `duration = words / wpm * 60`,
 * floor = MIN_SHOT_DURATION_SECONDS.
 */
export function applyDeterministicDurations(
  shots: Shot[],
  options: ShotTimingOptions,
  startAt: number,
): Shot[] {
  if (options.transcriptWords && options.transcriptWords.length > 0) {
    return applyShotTimesWithTranscript(shots, options.transcriptWords, startAt, options.wpm)
  }
  return applyShotTimesWithWpm(shots, options.wpm, startAt)
}

export function estimateDurationFromAudio(audio: string, wpm: number): number {
  const words = Math.max(1, countWords(audio))
  return Math.max(MIN_SHOT_DURATION_SECONDS, Number(((words / wpm) * 60).toFixed(2)))
}

export function withDeterministicRetimeForScriptChanges(spec: Spec, ops: PatchOp[]): PatchOp[] {
  if (!ops.length) {
    return ops
  }

  if (
    ops.some(
      (op) =>
        op.op === 'delete_shots' ||
        op.op === 'reorder_shots' ||
        op.op === 'replace_all_shots' ||
        op.op === 'replace_shots_range',
    )
  ) {
    return ops
  }

  const changedAudioByShotId = new Map<string, string>()
  for (const op of ops) {
    if (op.op === 'update_shot_field' && op.field === 'audio_vo' && typeof op.value === 'string') {
      changedAudioByShotId.set(op.shot_id, op.value)
    }
  }

  if (changedAudioByShotId.size === 0 || spec.visual_script.shots.length === 0) {
    return ops
  }

  // Audio mode note: `update_shot_field audio_vo` is rejected by patch-apply
  // L2-a so `changedAudioByShotId` is always empty in audio mode -- this
  // function is a no-op there (transcript-aligned timing is already correct).
  // In non-audio mode, recompute downstream timing via WPM estimate.
  // Planner-emitted retime_shot is no longer possible (zod schema rejects it);
  // only this function emits retime_shot ops, as cascade output.
  const wpm = DEFAULT_WPM
  const firstAffectedIndex = spec.visual_script.shots.findIndex((shot) =>
    changedAudioByShotId.has(shot.shot_id),
  )
  if (firstAffectedIndex === -1) {
    return ops
  }

  let cursor =
    firstAffectedIndex === 0
      ? spec.visual_script.shots[0].time.start_s
      : spec.visual_script.shots[firstAffectedIndex - 1].time.end_s
  const retimeOps: PatchOp[] = []

  for (let index = firstAffectedIndex; index < spec.visual_script.shots.length; index += 1) {
    const shot = spec.visual_script.shots[index]
    const nextAudio = changedAudioByShotId.get(shot.shot_id)
    const { nextStart, nextEnd } = computeShotRetiming(shot, cursor, nextAudio, wpm)
    cursor = nextEnd

    if (
      Math.abs(nextStart - shot.time.start_s) > 0.0001 ||
      Math.abs(nextEnd - shot.time.end_s) > 0.0001
    ) {
      retimeOps.push({
        op: 'retime_shot',
        shot_id: shot.shot_id,
        start_s: nextStart,
        end_s: nextEnd,
      })
    }
  }

  if (retimeOps.length === 0) {
    return ops
  }
  // Filter remains as defensive belt-and-suspenders: planner schema already
  // rejects retime_shot, so input `ops` will not contain it in normal flow.
  return [...ops.filter((op) => op.op !== 'retime_shot'), ...retimeOps]
}

function applyShotTimesWithTranscript(
  shots: Shot[],
  transcriptWords: TranscriptWord[],
  startAt: number,
  fallbackWpm: number,
): Shot[] {
  let cursor = 0
  let timeCursor = startAt

  return shots.map((shot, index) => {
    const tokens = tokenizeAudioVo(shot.audio_vo)
    let startSec: number
    let endSec: number

    if (tokens.length === 0) {
      startSec = timeCursor
      endSec = timeCursor + MIN_SHOT_DURATION_SECONDS
    } else {
      const scan = scanBeatTokens(tokens, transcriptWords, cursor)
      cursor = scan.nextCursor
      if (scan.firstTxIdx !== -1 && scan.lastTxIdx !== -1) {
        startSec = transcriptWords[scan.firstTxIdx].start
        endSec = transcriptWords[scan.lastTxIdx].end
      } else {
        // Shot's audio_vo failed to match any transcript token. In audio mode
        // this should not happen (audio_vo is locked to the ASR script); if
        // it does, treat the shot as unaligned and use WPM to keep pipeline
        // moving.
        const durationS = Math.max(MIN_SHOT_DURATION_SECONDS, (tokens.length / fallbackWpm) * 60)
        startSec = timeCursor
        endSec = timeCursor + durationS
      }
    }

    timeCursor = endSec
    return {
      ...shot,
      order: index + 1,
      time: {
        start_s: Number(startSec.toFixed(2)),
        end_s: Number(endSec.toFixed(2)),
      },
    }
  })
}

function applyShotTimesWithWpm(shots: Shot[], wpm: number, startAt: number): Shot[] {
  let cursor = startAt
  return shots.map((shot, index) => {
    const words = countWords(shot.audio_vo)
    const duration = Math.max(MIN_SHOT_DURATION_SECONDS, Number(((words / wpm) * 60).toFixed(2)))
    const next: Shot = {
      ...shot,
      order: index + 1,
      time: {
        start_s: Number(cursor.toFixed(2)),
        end_s: Number((cursor + duration).toFixed(2)),
      },
    }
    cursor += duration
    return next
  })
}

function computeShotRetiming(
  shot: Shot,
  cursor: number,
  nextAudio: string | undefined,
  wpm: number,
): { nextEnd: number; nextStart: number } {
  const currentDuration = Math.max(
    MIN_SHOT_DURATION_SECONDS,
    Number.isFinite(shot.time.end_s - shot.time.start_s)
      ? shot.time.end_s - shot.time.start_s
      : MIN_SHOT_DURATION_SECONDS,
  )
  const nextDuration =
    nextAudio == null ? currentDuration : estimateDurationFromAudio(nextAudio, wpm)
  const nextStart = Number(cursor.toFixed(2))
  const nextEnd = Number((cursor + nextDuration).toFixed(2))
  return { nextEnd, nextStart }
}

function tokenizeAudioVo(audioVo: string): string[] {
  return audioVo
    .trim()
    .split(/\s+/)
    .map(auditNormalizeToken)
    .filter((token) => token.length > 0)
}
