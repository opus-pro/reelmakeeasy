/**
 * A loop's clips, strictly in order (beat-loop skill, sections 5 and 9): clip 1 from f0, every
 * later clip from the real last frame of the clip kept before it, each landing on its keyframe
 * f(k), the last on fN (the copy of f0). A take that fails QA gets one re-roll with the same
 * prompt before the next clip starts; after that the better take is kept and flagged. A video
 * spends at most three re-rolls. Clip 1 must pass before clip 2 starts: when it fails its
 * re-roll too, the run stops there, before most of the money is spent.
 *
 * Every take tries the model of the provider Setup picked first (the clip activity's order):
 * a clip the other provider made, because the first model's call failed on it, doesn't hold
 * the clips after it to that model and its price.
 *
 * Clips kept on purpose after a redone one (`keptAfterRedo`) are reused when the run reaches
 * them. A take paid for but not finished is finished before any new take is paid for.
 */
import { ApplicationFailure } from '@reelmakeeasy/workflow-engine/workflow'
import type { BeatLoopStoryboard } from '@shared/types/api/agent'

import type { BeatLoopKeyframeResult, BeatLoopTake } from '../../activities/beat-loop'
import type { LongTakeWorkflowLogFn, LongTakeWorkflowRuntime } from '../long-take/workflow-runtime'

import { keepBeatLoopTake, renderBeatLoopClip } from './activity-proxies'
import { type BeatLoopResumePlan, isUnfinishedBeatLoopTake } from './resume'
import type { BeatLoopOtherModelClip, KeptBeatLoopClip } from './types'

/** Re-rolls a video may spend, over all its clips (a re-roll is one more paid take). */
export const BEAT_LOOP_MAX_REROLLS = 3

export interface BeatLoopClipsResult {
  clips: KeptBeatLoopClip[]
  /** Clips this run made on the other provider's model: its first model's call failed. */
  otherModelClips: BeatLoopOtherModelClip[]
  /** Re-rolls that went into the kept clips, earlier runs' included. */
  rerolls: number
}

/**
 * Makes the clips the resume plan has not kept yet, keeping one take of each, and returns all
 * N kept clips in order. Re-rolls are budgeted over the whole video: the kept clips' re-rolls
 * count, and the first clip still to make gets a new take of its own unless a stored take of
 * it already passes (Try again buys that take).
 */
export async function makeBeatLoopClips(input: {
  frames: BeatLoopKeyframeResult[]
  logInfo: LongTakeWorkflowLogFn
  orgId?: string
  projectId: string
  resume: BeatLoopResumePlan
  runtime: Pick<LongTakeWorkflowRuntime, 'setStageInProgress'>
  storyboard: BeatLoopStoryboard
  style: string
  userEmail?: string
  userId: string
}): Promise<BeatLoopClipsResult> {
  const { frames, logInfo, projectId, resume, runtime, storyboard } = input
  const clipCount = storyboard.clips.length
  const kept = [...resume.kept]
  const otherModelClips: BeatLoopOtherModelClip[] = []
  let rerolls = resume.rerollsSpent

  for (let clipIndex = kept.length; clipIndex < clipCount; clipIndex++) {
    const clip = storyboard.clips[clipIndex]
    const reused = resume.keptAfterRedo.find((entry) => entry.clipIndex === clipIndex)
    if (reused) {
      // Kept on purpose when the clip before it was redone: a small jump at the joint.
      logInfo('beatLoopWorkflow reusing a clip kept after a redo', { clipId: clip.id })
      kept.push(reused)
      continue
    }
    const previous = kept[clipIndex - 1]
    const chainFrom = previous ? previous.lastFrameUri : frames[0].uri
    if (!chainFrom) {
      // The clip before kept no last frame: start from its keyframe (a visible pulse at the joint).
      logInfo('beatLoopWorkflow clip starts from its keyframe: no last frame to chain from', {
        clipId: clip.id,
        previousClipId: previous?.clipId,
      })
    }
    const firstFrameUri = chainFrom ?? frames[clipIndex].uri
    const generation = resume.generations[clipIndex] ?? 1
    const stored = clipIndex === resume.kept.length ? resume.pendingTakes : []
    // Numbered after every take on record, so a new take never writes over another's files.
    let nextTake = resume.nextTakes[clipIndex] ?? 1
    const render = (take = nextTake++): Promise<BeatLoopTake> =>
      renderBeatLoopClip({
        clipIndex,
        firstFrameUri,
        generation,
        // The last clip's seam is checked against clip 1's real first frame.
        ...(clipIndex === clipCount - 1 && kept[0]?.firstFrameUri
          ? { loopFirstFrameUri: kept[0].firstFrameUri }
          : {}),
        orgId: input.orgId,
        projectId,
        storyboard,
        style: input.style,
        take,
        targetFrameUri: frames[clipIndex + 1].uri,
        userEmail: input.userEmail,
        userId: input.userId,
      })

    const clipRerolls = await makeTakes({
      clipId: clip.id,
      logInfo,
      render,
      rerollLeft: rerolls < BEAT_LOOP_MAX_REROLLS,
      stored,
    })
    rerolls += clipRerolls
    const result = await keepBeatLoopTake({
      clipId: clip.id,
      generation,
      projectId,
      startFrameUri: firstFrameUri,
    })
    if (clipIndex === 0 && result.flagged) throw firstClipFailed(clip.id, result.failures)
    if (result.fallback) otherModelClips.push({ clipId: clip.id, ...result.fallback })
    kept.push({
      clipId: clip.id,
      clipIndex,
      failures: result.failures,
      ...(result.firstFrameUri ? { firstFrameUri: result.firstFrameUri } : {}),
      flagged: result.flagged,
      keptTake: result.keptTake,
      ...(result.lastFrameUri ? { lastFrameUri: result.lastFrameUri } : {}),
      model: result.model,
      rerolls: clipRerolls,
      transition: result.transition,
    })
    await runtime.setStageInProgress({
      meta: { completedTransitions: kept.length, transitionCount: clipCount },
      stage: 'transitions',
    })
  }
  return { clips: kept, otherModelClips, rerolls }
}

/**
 * The takes of one clip before one is kept: at most two paid takes, the stored ones (an
 * earlier run's) included. None when a stored take already passes, or when two have clips (it
 * had its re-roll: the better is kept). A take paid for but not finished is finished first.
 * Without a paid take yet, a first take. Then, when the one paid take fails and the video has
 * a re-roll left, one more with the same prompt. Returns the clip's re-rolls: its paid takes
 * after the first.
 */
async function makeTakes(input: {
  clipId: string
  logInfo: LongTakeWorkflowLogFn
  render: (take?: number) => Promise<BeatLoopTake>
  rerollLeft: boolean
  stored: BeatLoopTake[]
}): Promise<number> {
  const { clipId, logInfo, render, stored } = input
  const hasClip = (take: BeatLoopTake) => Boolean(take.transition && take.qa)
  let paid = stored.filter((take) => take.transition || take.paidClipUri).length
  const rerolls = () => Math.max(0, paid - 1)
  if (stored.some((take) => take.passed && take.transition)) {
    logInfo('beatLoopWorkflow keeping a stored take', { clipId })
    return rerolls()
  }
  let withClip = stored.filter(hasClip).length
  const unfinished = stored.find(isUnfinishedBeatLoopTake)
  if (unfinished && withClip < 2) {
    logInfo('beatLoopWorkflow finishing a take already paid for', { clipId })
    const finished = await render(unfinished.take)
    if (finished.passed) return rerolls()
    if (hasClip(finished)) withClip++
  }
  if (withClip >= 2) {
    logInfo('beatLoopWorkflow keeping the better of the stored takes', { clipId })
    return rerolls()
  }
  if (!paid) {
    paid++
    const first = await render()
    if (first.passed) return rerolls()
  }
  // One paid take, and it fails: its re-roll, when the video has one left.
  if (!input.rerollLeft) {
    logInfo('beatLoopWorkflow no re-roll left for a failing clip', { clipId })
    return rerolls()
  }
  logInfo('beatLoopWorkflow re-rolling a clip', { clipId })
  paid++
  await render()
  return rerolls()
}

/** The clip-1 gate: its takes all fail, so the other clips would likely fail the same way. */
function firstClipFailed(clipId: string, failures: string[]): ApplicationFailure {
  return ApplicationFailure.nonRetryable(
    [
      `Clip ${clipId} failed its checks on every take, so the loop stopped before making the other clips.`,
      ...failures,
      "Rewrite the clip's hit, freeze or cut, or change its keyframes, then try again.",
    ].join(' '),
    'BeatLoopFirstClipFailed',
  )
}
