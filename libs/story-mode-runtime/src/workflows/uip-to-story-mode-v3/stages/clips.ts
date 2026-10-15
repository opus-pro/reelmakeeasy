import type { PipelineContextEntry } from '@reelmakeeasy/common/job-context'
import type { LongTakeAdmissionTier } from '@reelmakeeasy/common/long-take/types'
import type { AspectRatio, GenerationResolution } from '@reelmakeeasy/common/media/types'
import type { DebugSettings } from '@shared/types/project/debug-settings'

import { generateLongTakeTransitionVideo } from '../../long-take/activity-proxies'
import type {
  LongTakeKeyframeItem,
  LongTakeShotPlanItem,
  LongTakeTransitionPlanItem,
  LongTakeTransitionVideoItem,
} from '../../long-take/types'
import type { LongTakeWorkflowLogFn } from '../../long-take/workflow-runtime'
import { mapWithConcurrency } from '../../long-take/workflow-utils'

export type V3ClipPrompt = {
  motionPrompt: string
  shotId: string
  transitionPrompt: null | string
}

/**
 * Build the clip plan: one clip per shot, spanning that shot's own time range.
 *
 * This is the whole point of Story Mode 3.0. V2 derives clips center-to-center
 * (`deriveTransitionSlots`), so a clip straddles two shots and contains neither
 * of them completely. Here `clip i === shot i`, which is why nothing computes
 * midpoints and why the render timeline can place clips back to back.
 *
 * Exported and pure so the topology is testable without running a workflow.
 */
export function buildV3ClipPlan(params: {
  clipPromptByShotId: Map<string, V3ClipPrompt>
  keyframeUriByShotId: Map<string, string>
  shotPlan: LongTakeShotPlanItem[]
  styleText?: string
  totalDurationSeconds?: number
}): LongTakeTransitionPlanItem[] {
  const { clipPromptByShotId, keyframeUriByShotId, shotPlan, styleText, totalDurationSeconds } =
    params

  return shotPlan.flatMap((shot, index) => {
    const firstFrameUri = keyframeUriByShotId.get(shot.shot_id)
    if (!firstFrameUri) {
      return []
    }
    const nextShot = shotPlan[index + 1]
    const isContinuous = shot.transition_to_next === 'continuous' && nextShot !== undefined
    // Only a `continuous` hand-off conditions on the next opening frame. A `cut`
    // must NOT: with first-and-last-frame generation the clip is forced to end
    // on that frame, so the next shot's opening would play twice -- once at the
    // tail of this clip and again at the head of the next.
    const lastFrameUri = isContinuous ? keyframeUriByShotId.get(nextShot.shot_id) : undefined

    // The last shot runs to the end of the voiceover: MP3 padding and trailing
    // silence can outlast the transcript, and a short final clip leaves a gap.
    const isLast = index === shotPlan.length - 1
    const endSec =
      isLast && totalDurationSeconds
        ? Math.max(shot.time_range.end, totalDurationSeconds)
        : shot.time_range.end
    const durationSeconds = Math.max(1, endSec - shot.time_range.start)
    const clipPrompt = clipPromptByShotId.get(shot.shot_id)

    return [
      {
        durationSeconds,
        endMs: Math.round(endSec * 1000),
        firstFrameUri,
        fromAudio: shot.audio,
        fromKeyframePrompt: shot.keyframe_prompt,
        fromPrompt: shot.video_prompt,
        fromShotId: shot.shot_id,
        ...(lastFrameUri && { lastFrameUri }),
        prompt: mergeV3ClipPrompt(clipPrompt, shot),
        shouldLipSync: shot.requires_lip_sync,
        // The clip meta-prompt already saw the rendered keyframes and wrote a
        // render-ready prompt; a model-specific rewrite on top would discard the
        // motion and hand-off design it just produced.
        skipPromptRewrite: true,
        startMs: Math.round(shot.time_range.start * 1000),
        ...(styleText && { styleText }),
        toAudio: nextShot?.audio,
        toKeyframePrompt: nextShot?.keyframe_prompt,
        toPrompt: nextShot?.video_prompt,
        // A `cut` hands off to nothing inside the clip, so it reports itself as
        // its own destination -- the pair is only used for logging and lip-sync
        // resolution downstream.
        toShotId: isContinuous ? nextShot.shot_id : shot.shot_id,
        transitionId: `clip_${index}`,
      },
    ]
  })
}

/** Motion first, then how it lands. `null` transition => a cut, nothing to say. */
export function mergeV3ClipPrompt(
  clipPrompt: undefined | V3ClipPrompt,
  shot: LongTakeShotPlanItem,
): string {
  const motion = clipPrompt?.motionPrompt?.trim() || shot.video_prompt || shot.keyframe_prompt
  const transition = clipPrompt?.transitionPrompt?.trim()
  return transition ? `${motion}\n\n${transition}` : motion
}

/**
 * Whether clip `index` opens on a frame the previous clip already ended on.
 *
 * V2 drops the first frame of every clip but the first, because adjacent clips
 * always share an endpoint keyframe. Here only a `continuous` hand-off does, so
 * dropping after a `cut` would eat a real frame of content.
 *
 * Decided from the CLIP plan, never from the shot plan by index: a shot with no
 * rendered keyframe is skipped, so the two arrays are not parallel. Comparing
 * the previous clip's actual destination frame against this clip's opening frame
 * is also self-correcting -- when the shot in between is dropped, the previous
 * clip degrades to i2v-only and correctly stops being a duplicate.
 */
export async function runV3ClipsStage(params: {
  admissionTier?: LongTakeAdmissionTier
  aspectRatio?: AspectRatio
  audioDurationSeconds?: number
  clipPrompts: V3ClipPrompt[]
  debugSettings?: DebugSettings
  generationResolution?: GenerationResolution
  keyframes: LongTakeKeyframeItem[]
  logInfo: LongTakeWorkflowLogFn
  orgId?: string
  pipelineContext?: PipelineContextEntry[]
  projectId: string
  shotPlan: LongTakeShotPlanItem[]
  styleText?: string
  transitionVideoModel?: string
  userEmail?: string
  userId: string
  videoConcurrency: number
}): Promise<{ clipPlan: LongTakeTransitionPlanItem[]; clipVideos: LongTakeTransitionVideoItem[] }> {
  const { logInfo, shotPlan, videoConcurrency } = params

  const clipPlan = buildV3ClipPlan({
    clipPromptByShotId: new Map(params.clipPrompts.map((item) => [item.shotId, item])),
    keyframeUriByShotId: new Map(
      params.keyframes.map((keyframe) => [keyframe.shotId, keyframe.keyframeUrl]),
    ),
    shotPlan,
    styleText: params.styleText,
    totalDurationSeconds: params.audioDurationSeconds,
  })

  logInfo('uipToStoryModeV3Workflow clip plan built', {
    clipCount: clipPlan.length,
    continuousCount: clipPlan.filter((clip) => clip.lastFrameUri).length,
    shotCount: shotPlan.length,
  })

  const clipVideos = await mapWithConcurrency(
    clipPlan,
    videoConcurrency,
    async (clip: LongTakeTransitionPlanItem, index: number) =>
      generateLongTakeTransitionVideo({
        ...clip,
        admissionTier: params.admissionTier,
        aspectRatio: params.aspectRatio,
        debugSettings: params.debugSettings,
        dropFirstFrame: shouldDropV3FirstFrame(clipPlan, index),
        generationResolution: params.generationResolution,
        orgId: params.orgId,
        pipelineContext: params.pipelineContext,
        projectId: params.projectId,
        transitionVideoModel: params.transitionVideoModel,
        userEmail: params.userEmail,
        userId: params.userId,
      }),
  )

  return { clipPlan, clipVideos }
}

export function shouldDropV3FirstFrame(
  clipPlan: LongTakeTransitionPlanItem[],
  index: number,
): boolean {
  const previous = clipPlan[index - 1]
  return index > 0 && previous?.lastFrameUri !== undefined
    ? previous.lastFrameUri === clipPlan[index].firstFrameUri
    : false
}

/**
 * Swap each shot's placeholder keyframe prompt for the authored opening-instant
 * one. Shots the prompt stage dropped keep the raw description, which is what
 * they were seeded with -- a thinner keyframe beats no keyframe.
 */
export function applyV3KeyframePrompts(
  shotPlan: LongTakeShotPlanItem[],
  promptByShotId: Record<string, string> | undefined,
): LongTakeShotPlanItem[] {
  if (!promptByShotId) {
    return shotPlan
  }
  return shotPlan.map((shot) => {
    const authored = promptByShotId[shot.shot_id]?.trim()
    return authored ? { ...shot, keyframe_prompt: authored } : shot
  })
}
