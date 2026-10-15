/**
 * Where a loop picks up after an earlier run of the same project stopped (Try again, a redone
 * clip, or an API restart): the clips it already kept, in order, are reused as they are, and the
 * run starts at the first clip it has not kept, with that clip's stored takes. Rendering clip k
 * again changes the first frame of every clip after it, so reuse stops at the first gap and at
 * any clip whose kept take started from another frame than the one the clip before ends on.
 * Two exceptions: clips kept on purpose when the clip before them was redone (`keepAfterRedo`)
 * are reused although they start from the old frame, right after the gap too; and a run whose
 * keyframes were made again (`restart`) starts every clip over.
 *
 * Only takes of a clip's current generation count (a redo or a restart moves it on), and new
 * takes are numbered after every take on record, so no take's files are ever written twice.
 */
import type { BeatLoopQaClip, BeatLoopQaFile, BeatLoopTake } from '../../activities/beat-loop'

import type { KeptBeatLoopClip } from './types'

export interface BeatLoopResumePlan {
  /** Per clip, its generation in this run: the one its takes are saved and kept under. */
  generations: number[]
  /** The clips already kept, from clip 1 on without a gap. */
  kept: KeptBeatLoopClip[]
  /**
   * Clips right after the first gap that were kept on purpose when the clip before them was
   * redone: reused as they are once the run reaches them.
   */
  keptAfterRedo: KeptBeatLoopClip[]
  /** Per clip, the number its next take gets: one more than any take on record. */
  nextTakes: number[]
  /** The stored takes of the first clip still to keep, made after the clip before it. */
  pendingTakes: BeatLoopTake[]
  /** Re-rolls already spent on the kept clips: they count against the video's limit. */
  rerollsSpent: number
}

/** A take paid for (its clip stored) but not finished: the run finishes it before anything new. */
export function isUnfinishedBeatLoopTake(take: BeatLoopTake): boolean {
  return take.failed.includes('unfinished') && !take.transition && Boolean(take.paidClipUri)
}

/**
 * The resume point from the loop's QA record (`readBeatLoopQa`). With `restart` (the keyframes
 * were made again, so no stored clip lands where it should), every clip starts over in a new
 * generation.
 */
export function planBeatLoopResume(
  storyboard: { clips: { id: string }[] },
  file: BeatLoopQaFile,
  options: { restart?: boolean } = {},
): BeatLoopResumePlan {
  const kept: KeptBeatLoopClip[] = []
  const keptAfterRedo: KeptBeatLoopClip[] = []
  const generations: number[] = []
  const nextTakes: number[] = []
  let gap: number | undefined
  let pendingTakes: BeatLoopTake[] = []
  for (const [clipIndex, { id }] of storyboard.clips.entries()) {
    const stored = file.clips.find((clip) => clip.clipId === id && clip.clipIndex === clipIndex)
    const generation = generationOf(stored) + (options.restart ? 1 : 0)
    generations.push(generation)
    nextTakes.push(Math.max(0, ...(stored?.takes ?? []).map((take) => take.take)) + 1)
    if (options.restart) continue
    const current = (stored?.takes ?? []).filter((take) => generationOf(take) === generation)
    if (gap === undefined) {
      const step = beforeGap(clipIndex, stored, current, kept.at(-1))
      if ('kept' in step) kept.push(step.kept)
      else [gap, pendingTakes] = [clipIndex, step.pending]
    } else if (clipIndex === gap + 1 + keptAfterRedo.length && stored?.keepAfterRedo) {
      // After the gap, only an unbroken run of clips kept on purpose (keepAfterRedo).
      const reusable = reusableClip(clipIndex, stored, current)
      if (reusable) keptAfterRedo.push(reusable)
    }
  }
  return {
    generations,
    kept,
    keptAfterRedo,
    nextTakes,
    pendingTakes,
    rerollsSpent: [...kept, ...keptAfterRedo].reduce((sum, clip) => sum + clip.rerolls, 0),
  }
}

/**
 * A clip before the first gap: reused when its kept take started where the clip before ends (or
 * it was kept on purpose after a redo), else the gap, with the takes the run can still use.
 */
function beforeGap(
  clipIndex: number,
  stored: BeatLoopQaClip | undefined,
  current: BeatLoopTake[],
  previous: KeptBeatLoopClip | undefined,
): { kept: KeptBeatLoopClip } | { pending: BeatLoopTake[] } {
  // Takes started from the frame the kept clip before this one ends on.
  const chained = current.filter((take) => startsAfter(take, previous))
  const reusable = reusableClip(clipIndex, stored, stored?.keepAfterRedo ? current : chained)
  if (reusable) return { kept: reusable }
  // A flagged clip 1 failed the gate on these takes: it is made again from scratch.
  return { pending: clipIndex === 0 && stored?.flagged ? [] : chained }
}

function generationOf(entry: undefined | { generation?: number }): number {
  return entry?.generation ?? 1
}

/** The stored clip's kept take as a kept clip, when it can be reused. */
function reusableClip(
  clipIndex: number,
  stored: BeatLoopQaClip | undefined,
  takes: BeatLoopTake[],
): KeptBeatLoopClip | undefined {
  const keptTake = takes.find((take) => take.take === stored?.keptTake)
  // A flagged clip 1 failed the gate: the run stopped there, and makes it again.
  if (!stored || !keptTake?.transition || (clipIndex === 0 && stored.flagged)) return undefined
  const lastFrameUri = keptTake.lastFrameUri ?? keptTake.transition.lastFrameUri
  return {
    clipId: stored.clipId,
    clipIndex,
    failures: keptTake.failures,
    ...(keptTake.firstFrameUri ? { firstFrameUri: keptTake.firstFrameUri } : {}),
    flagged: Boolean(stored.flagged),
    keptTake: keptTake.take,
    ...(lastFrameUri ? { lastFrameUri } : {}),
    model: keptTake.model,
    rerolls: Math.max(0, takes.length - 1),
    startedAt: keptTake.createdAt,
    transition: keptTake.transition,
  }
}

/**
 * Whether a take started where the kept clip before it ends: its recorded start frame, or (a
 * take without one) a take made after that clip's.
 */
function startsAfter(take: BeatLoopTake, previous: KeptBeatLoopClip | undefined): boolean {
  if (!previous) return true
  if (take.startFrameUri) return take.startFrameUri === previous.lastFrameUri
  return take.createdAt > (previous.startedAt ?? '')
}
