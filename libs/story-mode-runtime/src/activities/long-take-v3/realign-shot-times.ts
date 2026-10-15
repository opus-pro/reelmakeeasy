import { STORY_LOADER_PATHS } from '@reelmakeeasy/common/agent-v2/paths'
import { getMaxRecoverableSlotSeconds } from '@reelmakeeasy/common/long-take/transition-slot-feasibility'
import type { LongTakeVisualScriptItem } from '@reelmakeeasy/common/long-take/types'
import { getMaxSupportedVideoDurationSeconds } from '@reelmakeeasy/common/video-models/registry'
import type { TranscriptData } from '@shared/types/agent/transcript'
import { ApplicationFailure } from '@reelmakeeasy/workflow-engine/common'

import type {
  LongTakeShotPlanItem,
  RealignV3ShotTimesActivityParams,
  RealignV3ShotTimesActivityResult,
} from '../../workflows/long-take/types'
import {
  formatLogFields,
  logger,
  withActivityHeartbeat,
  withLongTakeContext,
} from '../long-take/common'
// Imported, NOT copied. These four are already the public surface of the V2
// shot-plan module (its own test file imports them), so Story Mode 3.0 shares
// one alignment implementation with V2 without editing a line of it. A second
// copy would drift the moment either side is tuned -- the failure mode this
// revamp keeps running into.
import {
  buildTranscriptIndex,
  computeMatchSpans,
  repairNonMonotonicShotTimeRanges,
  resolveBeatSheetForRoute,
} from '../long-take/shot-plan'
import { createLongTakeStorage } from '../long-take/storage'
import { readLongTakeBeatSheetOutput } from '../long-take/storage-read'

export const V3_SHOT_TIMES_PATH = 'long_take_v3/shot_times.json'

/**
 * Re-derive each shot's boundaries from the voiceover that actually exists.
 *
 * The planner's `time` is authoritative only in audio mode; in text mode it is a
 * 150-wpm estimate made before any audio existed (`ensureTranscriptWords`
 * returns null unless `audio_source === 'user_audio'`). TTS + ASR happen
 * downstream in the voiceover stage, so this is the first point where real
 * boundaries are knowable -- and under Story Mode 3.0 they matter directly:
 * clip i IS shot i, so its duration and its placement on the render timeline
 * both come from here.
 *
 * Alignment is LCS, not a lockstep token scan. The transcript is ASR-of-TTS of
 * authored text, so it differs from `audio_vo` by insertions and deletions --
 * number expansion ("2026" -> three words), stripped inline TTS markup, and
 * whatever the fidelity gate's 10%-coverage / 1.5x-inflation band lets through.
 * A lockstep scan advances its cursor on every token and carries the drift
 * across shots; LCS absorbs indels and degenerates to an exact match in audio
 * mode, where `audio_vo` is locked to the ASR script.
 */
export async function realignV3ShotTimes(
  params: RealignV3ShotTimesActivityParams,
): Promise<RealignV3ShotTimesActivityResult> {
  const { pipelineContext, projectId, promptRoute, transitionVideoModel, userEmail, userId } =
    params
  return withLongTakeContext({ pipelineContext, projectId, userId, userEmail }, () =>
    withActivityHeartbeat(async () => {
      const storage = createLongTakeStorage(projectId)
      const visualScript = await storage.readJsonFile<LongTakeVisualScriptItem[]>(
        params.visualScriptPath,
      )

      const beatSheet = resolveBeatSheetForRoute(await readBeatSheetSafely(projectId), promptRoute)
      // The transcript is only needed on the word-alignment path, but reading it
      // unconditionally keeps the activity's IO in one place and the pure core
      // free of storage.
      const transcript = await storage
        .readJsonFile<TranscriptData>(STORY_LOADER_PATHS.transformedTranscriptPath)
        .catch(() => null)

      const { shotPlan, timingSource, unalignedShotCount } = alignV3ShotTimes({
        beatSheet,
        transcript,
        visualScript,
      })

      const totalDurationSec = shotPlan.reduce((max, shot) => Math.max(max, shot.time_range.end), 0)
      const repairedShotCount = repairNonMonotonicShotTimeRanges(shotPlan, totalDurationSec)
      assertV3ShotDurationsGeneratable(shotPlan, transitionVideoModel)

      await storage.ensureDir('long_take_v3')
      await storage.writeJsonFile(V3_SHOT_TIMES_PATH, shotPlan)

      logger.info(
        `[long-take-v3] Shot times realigned ${formatLogFields({
          projectId,
          userId,
          timingSource,
          shotCount: shotPlan.length,
          unalignedShotCount,
          repairedShotCount,
          totalDurationSec,
        })}`,
      )

      return {
        shotCount: shotPlan.length,
        shotPlan,
        shotTimesPath: V3_SHOT_TIMES_PATH,
        timingSource,
        unalignedShotCount,
      }
    }),
  )
}

/**
 * A shot is generated as ONE clip, so its duration must be reachable by the
 * video model. Between the model's cap and 1.85x it, `retimeTransitionVideoIfNeeded`
 * recovers by slowing the clip to 0.9x and freeze-padding the remainder; past
 * that the freeze would exceed 40% of the clip and there is nothing worth
 * shipping.
 *
 * Deliberately an assertion rather than V2's silent 10s split: that splitter
 * clones the whole shot, so every chunk gets an identical keyframe prompt (and,
 * under this contract, an identical `transition_to_next`), which is exactly the
 * "clip is not a whole shot" failure this workflow exists to remove. An overlong
 * shot here is a visual-script contract violation and should be visible.
 */
function assertV3ShotDurationsGeneratable(
  shotPlan: LongTakeShotPlanItem[],
  transitionVideoModel?: string,
): void {
  const modelCap = resolveModelMaxClipSeconds(transitionVideoModel)
  const maxSeconds = getMaxRecoverableSlotSeconds(modelCap)
  for (const shot of shotPlan) {
    const duration = shot.time_range.end - shot.time_range.start
    if (duration > maxSeconds) {
      throw ApplicationFailure.nonRetryable(
        `Shot ${shot.shot_id} is ${duration.toFixed(3)}s; a Story Mode 3.0 clip covers one whole shot and must be <= ${maxSeconds.toFixed(1)}s. Split the shot in the visual script.`,
        'V3_SHOT_TOO_LONG',
      )
    }
  }
}

function buildV3ShotPlanItem(
  item: LongTakeVisualScriptItem | undefined,
  index: number,
  start: number,
  end: number,
): LongTakeShotPlanItem {
  const description = item?.visual?.core_description || item?.visual?.description || ''
  return {
    audio: item?.audio || '',
    human_presence: item?.human_presence ?? 'unknown',
    // Both are placeholders the later stages overwrite: keyframe_prompt by the
    // opening-instant meta-prompt, video_prompt by the clip meta-prompt. Seeded
    // with the description so a stage failure degrades to the raw brief instead
    // of an empty prompt.
    keyframe_prompt: description,
    shot_id: item?.shot_id?.trim() || `LT_S${index + 1}`,
    time_range: { start, end: Math.max(start, end) },
    transition_to_next: item?.visual?.transition_to_next ?? null,
    used_asset_id: item?.used_asset_id || [],
    video_prompt: description,
  }
}

function isBeatLockedMusicSheet(beatSheet: V3BeatSheet): boolean {
  return beatSheet?.time_range_audited === true && beatSheet.text_audited !== true
}

/**
 * Mirrors the V2 readiness check (not exported there): the audit must have
 * passed on one axis, the beat count must match the shot count, and every beat
 * must carry a time range.
 */
function isBeatSheetReady(beatSheet: V3BeatSheet, visualScriptLength: number): boolean {
  if (!beatSheet) {
    return false
  }
  return (
    (beatSheet.text_audited === true || beatSheet.time_range_audited === true) &&
    beatSheet.beat_sheet.length === visualScriptLength &&
    beatSheet.beat_sheet.every((beat) => beat.time_range != null)
  )
}

async function readBeatSheetSafely(projectId: string) {
  try {
    return await readLongTakeBeatSheetOutput(createLongTakeStorage(projectId))
  } catch {
    return null
  }
}

// An unset model resolves to the registry's video.firstLast role, the model
// the transition activity generates on by default.
function resolveModelMaxClipSeconds(transitionVideoModel?: string): number {
  return getMaxSupportedVideoDurationSeconds(transitionVideoModel)
}

type V3BeatSheet = null | {
  beat_sheet: Array<{ time_range?: null | { end: number; start: number } }>
  text_audited?: boolean
  time_range_audited?: boolean
}

/**
 * The pure core: given the shots, the transcript, and (optionally) a beat sheet,
 * decide every shot's in/out point. No storage, no logging -- so the alignment
 * itself is directly testable, which matters because a silent misalignment is
 * the hardest class of bug in this pipeline to notice downstream.
 */
export function alignV3ShotTimes(params: {
  beatSheet: V3BeatSheet
  transcript: null | TranscriptData
  visualScript: LongTakeVisualScriptItem[]
}): {
  shotPlan: LongTakeShotPlanItem[]
  timingSource: RealignV3ShotTimesActivityResult['timingSource']
  unalignedShotCount: number
} {
  const { beatSheet, transcript, visualScript } = params

  if (isBeatLockedMusicSheet(beatSheet) && isBeatSheetReady(beatSheet, visualScript.length)) {
    // A music beat sheet's time ranges come from the track's beat grid, which is
    // authoritative over word timing -- cutting off-beat is worse than cutting a
    // few frames off a lyric.
    return {
      shotPlan: visualScript.map((item, index) => {
        const range = beatSheet?.beat_sheet[index]?.time_range
        return buildV3ShotPlanItem(item, index, range?.start ?? 0, range?.end ?? 0)
      }),
      timingSource: 'beat_sheet_time_range',
      unalignedShotCount: 0,
    }
  }

  if (!transcript) {
    // No transcript at all: every shot falls back to the planner's own estimate.
    return {
      shotPlan: visualScript.map((item, index) =>
        buildV3ShotPlanItem(item, index, item.time?.start_s ?? 0, item.time?.end_s ?? 0),
      ),
      timingSource: 'lcs_transcript_partial',
      unalignedShotCount: visualScript.length,
    }
  }

  const { tokens, words } = buildTranscriptIndex(transcript)
  const { matches } = computeMatchSpans(visualScript, tokens)
  let unalignedShotCount = 0

  const shotPlan = visualScript.map((item, index) => {
    const match = matches[index]
    const nextMatch = matches[index + 1]
    if (!match) {
      // Alignment gave up at this shot. Fall back to the planner's own `time`,
      // carried through the handoff for exactly this case -- a wpm estimate
      // beats re-estimating one here from scratch.
      unalignedShotCount += 1
      const fallback = item.time
      return buildV3ShotPlanItem(
        item,
        index,
        fallback?.start_s ?? 0,
        fallback?.end_s ?? fallback?.start_s ?? 0,
      )
    }
    // A shot runs until the next shot's first spoken word, so shots stay
    // back-to-back with no gap; the last one ends on its own last word.
    const start = words[match.startIndex]?.start ?? 0
    const end = nextMatch
      ? (words[nextMatch.startIndex]?.start ?? start)
      : (words[match.endIndex]?.end ?? start)
    return buildV3ShotPlanItem(item, index, start, end)
  })

  return {
    shotPlan,
    timingSource: unalignedShotCount > 0 ? 'lcs_transcript_partial' : 'lcs_transcript',
    unalignedShotCount,
  }
}
