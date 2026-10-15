// Preflight for regenerate/restyle: a regenerate/restyle inherits the source
// project's stored shot plan verbatim, and a lower-capability transition
// model can push its slots past that model's recoverable cap. Uncaught, that
// dies non-retryably ~4s into LongTakeRegenerateWorkflow with
// TRANSITION_PLAN_SLOT_TOO_LONG. This runs before any project row or
// workflow start, so a doomed run is rejected
// with a 400 instead.

import { ProjectStore } from '@reelmakeeasy/common/agent-v2/storage/project-store'
import { PHOTO_PASSTHROUGH_IMAGE_MODEL } from '@reelmakeeasy/common/long-take/photo-passthrough-constants'
import {
  deriveTransitionSlots,
  findOversizeTransitionSlots,
  getMaxRecoverableSlotSeconds,
  type TransitionSlotShot,
} from '@reelmakeeasy/common/long-take/transition-slot-feasibility'
import { getMaxSupportedVideoDurationSeconds } from '@reelmakeeasy/common/video-models/registry'
import { BadRequestException } from '@nestjs/common'

import { LONG_TAKE_KEYFRAMES_PATH, LONG_TAKE_SHOT_PLAN_PATH } from './long-take-paths'

interface PreflightKeyframeItem {
  imageModel?: string
  shotId?: string
}

interface PreflightShotPlanItem {
  shot_id?: string
  time_range?: { end?: number; start?: number }
}

// Any read or parse failure must fall through and let the workflow decide --
// a preflight that cannot read the plan must never turn a working regenerate
// into a 400.
export async function assertTransitionSlotsFeasible(
  sourceProjectId: string,
  targetModel: string,
  sourceDurationSeconds?: number,
): Promise<void> {
  const storage = new ProjectStore(sourceProjectId)
  let shots: PreflightShotPlanItem[]
  let keyframes: PreflightKeyframeItem[]
  try {
    ;[shots, keyframes] = await Promise.all([
      storage.readJsonFile<PreflightShotPlanItem[]>(LONG_TAKE_SHOT_PLAN_PATH),
      storage.readJsonFile<PreflightKeyframeItem[]>(LONG_TAKE_KEYFRAMES_PATH),
    ])
  } catch {
    return
  }
  if (!Array.isArray(shots) || !Array.isArray(keyframes)) {
    return
  }

  // A malformed shot cannot simply be dropped: the geometry is
  // center-to-center, so removing one shot shifts every subsequent
  // midpoint and can invent an oversize slot the workflow (which feeds
  // every shot into the same geometry, malformed or not) would never
  // produce. Any malformed shot means the plan can't be trusted here.
  const isValidShot = (shot: PreflightShotPlanItem): shot is TransitionSlotShot =>
    typeof shot.shot_id === 'string' &&
    typeof shot.time_range?.start === 'number' &&
    typeof shot.time_range.end === 'number'
  if (shots.length === 0) {
    return
  }
  if (!shots.every(isValidShot)) {
    return
  }
  const validShots = shots

  const photoPassthroughShotIds = new Set(
    keyframes
      .filter((keyframe) => keyframe.imageModel === PHOTO_PASSTHROUGH_IMAGE_MODEL)
      .map((keyframe) => keyframe.shotId),
  )

  // The workflow uses the voiceover length (audioDurationSeconds) as
  // totalDurationSeconds. Both callers resolve that length just before calling
  // here, so prefer it: for a COMPLETED source it is the project row's rendered
  // duration -- exact, and the case the plan-derived fallback below silently
  // under-states whenever the stored plan does not reach the audio end.
  // Measuring it here instead would mean downloading the voiceover
  // and running ffprobe inside a request handler, which is why the fallback
  // exists at all.
  //
  // The fallback keeps the original property: the shot plan's own max
  // time_range.end can only UNDER-state the final slot, never over-state it, so
  // it can make the preflight MISS a case but never falsely reject one. It stays
  // the path for a FAILED source, whose duration the API cannot know -- and it
  // becomes exact for any plan built after the coverage fix, since those reach
  // totalDurationSec by construction.
  const planDerivedDurationSeconds = validShots.reduce(
    (max, shot) => Math.max(max, shot.time_range.end),
    0,
  )
  // A completed project's stored duration is Math.ceil'd to whole seconds
  // (render-final), so it can OVER-state the fractional length the workflow
  // ffprobes -- and over-stating is the one thing that could falsely reject.
  // ceil(t) - 1 < t, so the haircut is a guaranteed-safe lower bound. It costs
  // nothing against the failure this guards: the gaps in play are tens of
  // seconds, not one.
  const supplied =
    typeof sourceDurationSeconds === 'number' && Number.isFinite(sourceDurationSeconds)
      ? sourceDurationSeconds - 1
      : 0
  const totalDurationSeconds = Math.max(supplied, planDerivedDurationSeconds)
  // perfectLoop is always absent for both regenerate and restyle: it is a
  // workflow param that neither entry point's workflowArgs sets, so there is
  // no loop tail to reconstruct here.
  const slots = deriveTransitionSlots(validShots, totalDurationSeconds).filter(
    (slot) => !photoPassthroughShotIds.has(slot.fromShotId),
  )

  // Takes targetModel directly rather than resolving debugSettings.transitionVideoModel
  // like the workflow guard does: the caller (long-take-regenerate.util.ts)
  // force-writes debugSettings.transitionVideoModel = targetModel onto the new
  // project's workflowArgs, so by the time the workflow
  // runs its own resolution, targetModel IS what debugSettings will hold.
  // Resolved through the registry exactly like first generation: a legacy or
  // unknown id means the video.firstLast role.
  const maxSlotSeconds = getMaxSupportedVideoDurationSeconds(targetModel)

  const oversizeSlots = findOversizeTransitionSlots(slots, maxSlotSeconds)
  if (oversizeSlots.length === 0) {
    return
  }

  const maxRecoverableSeconds = getMaxRecoverableSlotSeconds(maxSlotSeconds)
  const worst = oversizeSlots.reduce((longest, slot) =>
    slot.durationSeconds > longest.durationSeconds ? slot : longest,
  )
  throw new BadRequestException(
    `Transition ${worst.fromShotId} -> ${worst.toShotId} would be ${worst.durationSeconds.toFixed(1)}s, over the ${maxRecoverableSeconds.toFixed(1)}s limit for ${targetModel}. Pick a higher-capability transition model, or remix instead of regenerating.`,
  )
}
