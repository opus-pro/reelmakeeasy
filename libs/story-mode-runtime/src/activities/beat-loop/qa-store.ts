/**
 * The loop's QA record, `long_take/beat_loop_qa.json`: every take of every clip with its
 * meter readings, why it failed, and what it cost; and, per clip, the take kept. Clips are made
 * strictly one after another, so read-modify-write is safe. The re-roll policy belongs to the
 * workflow: it renders takes, then keeps one here.
 *
 * Takes are numbered per clip and a number is never used twice, so a take's files never
 * overwrite another's (the clip kept for the render included). A clip's `generation` counts
 * how often it was started over: a redo (the API's regenerate) or a run whose keyframes were
 * made again moves it on, and only takes of the clip's current generation can be kept. Every
 * take stays on record with what it cost.
 */
import {
  type BeatLoopClipQa,
  type BeatLoopQaCheck,
  compareBeatLoopTakes,
} from '@reelmakeeasy/common/long-take/beat-loop-qa'
import { isMissingObjectError } from '@reelmakeeasy/common/storage/missing'
import { type GenerationProvider, modelRegistry } from '@reelmakeeasy/llm/registry'
import { ApplicationFailure } from '@reelmakeeasy/workflow-engine/activity'

import type { LongTakeTransitionVideoItem } from '../../workflows/long-take/transition-types'
import { formatError, formatLogFields, logger, withLongTakeContext } from '../long-take/common'
import { createLongTakeStorage } from '../long-take/storage'

import type { BeatLoopClipMeta, BeatLoopReportedSpend } from './clip-video'

export const BEAT_LOOP_QA_PATH = 'long_take/beat_loop_qa.json'

/**
 * Why a take failed: a QA meter, a length the beat-lock couldn't fix, or a clip that was made
 * (and paid for) but not finished: its stored copy (`paidClipUri`) is finished on the next try
 * instead of being paid for again.
 */
export type BeatLoopTakeCheck = 'beatLock' | 'unfinished' | BeatLoopQaCheck

/** What one take cost. H3 bills the 4 s asked for, not the 4.46 s it returns. */
export interface BeatLoopClipSpend {
  /** The seconds asked for times the registry's rate. */
  estimatedUsd: number
  model: string
  provider: GenerationProvider
  /** What the provider billed, when it says (fal's billable units, Omni's usage). */
  reported?: BeatLoopReportedSpend
  requestedSeconds: number
  usdPerSecond: number
}

/** One take of one clip, as saved. */
export interface BeatLoopTake {
  /** Models that failed (an error, not a QA verdict) before this take was made. */
  attempts: { error: string; model: string }[]
  beatLoop?: BeatLoopClipMeta
  clipId: string
  clipIndex: number
  createdAt: string
  failed: BeatLoopTakeCheck[]
  /** One plain sentence per failed check. */
  failures: string[]
  /** The clip's real first frame (kept for clip 1: the loop seam is checked against it). */
  firstFrameUri?: string
  /** The clip's generation when the take was made (absent: 1). */
  generation?: number
  lastFrameUri?: string
  model: string
  /** The clip as the provider delivered it, stored before anything else is done to it. */
  paidClipUri?: string
  passed: boolean
  /** The prompt sent, word for word. */
  prompt: string
  provider: GenerationProvider
  /** The meter readings; null when there was no clip to measure. */
  qa: BeatLoopClipQaReadings | null
  spend: BeatLoopClipSpend
  /** The frame the take started from (f0, or the real last frame of the clip kept before). */
  startFrameUri?: string
  take: number
  /** The keyframe the take was asked to land on. */
  targetFrameUri?: string
  /** The finished clip, as the render reads it; null when the take produced none. */
  transition: LongTakeTransitionVideoItem | null
}

/** The meter readings without the temporary frame files. */
export type BeatLoopClipQaReadings = Omit<BeatLoopClipQa, 'files'>

export interface BeatLoopQaClip {
  clipId: string
  clipIndex: number
  /** Set when even the kept take failed a check: the result tells the user which clip. */
  flagged?: boolean
  /** How often the clip was started over (absent: 1). Only takes of this one can be kept. */
  generation?: number
  /**
   * The clip before it was redone and this one kept on purpose (the API's regenerate without
   * `redoFollowing`): reused although it starts from the old clip's last frame.
   */
  keepAfterRedo?: boolean
  keptTake?: number
  /** Every take ever made of the clip, of every generation (each was paid for). */
  takes: BeatLoopTake[]
}

export interface BeatLoopQaFile {
  clips: BeatLoopQaClip[]
  spend: { estimatedUsd: number; reportedUsd?: number; takes: number }
  updatedAt: string
  version: 1
}

/** A clip made on the other provider's model because the first model's video call failed on
 *  it: both models by name. */
export interface BeatLoopFallback {
  failedModel: string
  model: string
}

export interface KeepBeatLoopTakeResult {
  clipId: string
  clipIndex: number
  failures: string[]
  /** Set when the kept take was made on another model than the one tried first. */
  fallback?: BeatLoopFallback
  firstFrameUri?: string
  flagged: boolean
  keptTake: number
  /** Where the next clip starts. */
  lastFrameUri?: string
  model: string
  transition: LongTakeTransitionVideoItem
}

/** Which takes of a clip may be kept: those of one generation, started from one frame. */
export interface BeatLoopTakeScope {
  /** The clip's current generation (absent: every take counts). */
  generation?: number
  /** The frame the clip starts from in this chain (absent: any). A take that doesn't record
   *  its start frame counts. */
  startFrameUri?: string
}

/** A take's or a clip's generation: 1 until the clip is first started over. */
export function beatLoopGeneration(entry: undefined | { generation?: number }): number {
  return entry?.generation ?? 1
}

/** The takes in `scope`: of its generation, started from its frame. */
export function scopedBeatLoopTakes(
  takes: BeatLoopTake[],
  scope: BeatLoopTakeScope = {},
): BeatLoopTake[] {
  return takes.filter(
    (take) =>
      (scope.generation === undefined || beatLoopGeneration(take) === scope.generation) &&
      (!scope.startFrameUri || !take.startFrameUri || take.startFrameUri === scope.startFrameUri),
  )
}

/** The best take to keep: passing first, then fewer failed checks, the closer landing and the
 *  smoother joint (`compareBeatLoopTakes`). A take without a clip is never kept, nor one
 *  outside `scope` (another generation, or another start frame). */
export function pickBeatLoopTake(
  takes: BeatLoopTake[],
  scope: BeatLoopTakeScope = {},
): BeatLoopTake | undefined {
  return scopedBeatLoopTakes(takes, scope)
    .filter((take) => take.transition && take.qa)
    .toSorted(
      (a, b) =>
        Number(b.passed) - Number(a.passed) ||
        compareBeatLoopTakes(a.qa as BeatLoopClipQa, b.qa as BeatLoopClipQa),
    )[0]
}

/** Activity: the loop's QA record so far (empty before the first clip). */
export async function readBeatLoopQa(params: { projectId: string }): Promise<BeatLoopQaFile> {
  return withLongTakeContext({ projectId: params.projectId }, () => readQaFile(params.projectId))
}

/** One stored take of a clip, by its number (an earlier try of a take being made again). */
export async function findBeatLoopTake(
  projectId: string,
  clipId: string,
  take: number,
): Promise<BeatLoopTake | undefined> {
  const file = await readQaFile(projectId)
  return file.clips
    .find((entry) => entry.clipId === clipId)
    ?.takes.find((entry) => entry.take === take)
}

/**
 * Adds a take to the record, replacing an earlier save of the same take. A take of a newer
 * generation moves the clip on to it: what was kept before is no longer kept.
 */
export async function saveBeatLoopTake(projectId: string, take: BeatLoopTake): Promise<void> {
  const file = await readQaFile(projectId)
  let clip = file.clips.find((entry) => entry.clipId === take.clipId)
  if (!clip) {
    clip = { clipId: take.clipId, clipIndex: take.clipIndex, takes: [] }
    file.clips.push(clip)
    file.clips.sort((a, b) => a.clipIndex - b.clipIndex)
  }
  if (beatLoopGeneration(take) > beatLoopGeneration(clip)) {
    clip.generation = beatLoopGeneration(take)
    delete clip.keptTake
    delete clip.flagged
    delete clip.keepAfterRedo
  }
  clip.takes = [...clip.takes.filter((entry) => entry.take !== take.take), take].sort(
    (a, b) => a.take - b.take,
  )
  await writeQaFile(projectId, file)
}

/**
 * Starts the stored clips over in the generations given (index: the clip's place), before the
 * keyframes they were made on are made again: their takes stay on record but can't be kept,
 * so a run that stops before it makes them again never reuses a clip made on the old frames.
 * A clip already at (or past) its generation is left as it is, so a retry changes nothing.
 */
export async function startBeatLoopClipsOver(
  projectId: string,
  clipIds: string[],
  generations: number[],
): Promise<void> {
  const file = await readQaFile(projectId)
  let changed = false
  for (const clip of file.clips) {
    const generation = generations[clip.clipIndex]
    if (clipIds[clip.clipIndex] !== clip.clipId || !generation) continue
    if (beatLoopGeneration(clip) >= generation) continue
    clip.generation = generation
    delete clip.keptTake
    delete clip.flagged
    delete clip.keepAfterRedo
    changed = true
  }
  if (changed) await writeQaFile(projectId, file)
}

/**
 * Activity: keeps the best take of a clip (`pickBeatLoopTake`) among those of its current
 * generation (or `generation`) started from `startFrameUri`, and returns it, flagged when it
 * still fails a check. Fails, without retrying, when no such take produced a clip.
 */
export async function keepBeatLoopTake(params: {
  clipId: string
  /** The clip's generation in this run (default: the record's). */
  generation?: number
  projectId: string
  /** The frame this run started the clip from: takes started elsewhere aren't kept. */
  startFrameUri?: string
}): Promise<KeepBeatLoopTakeResult> {
  const { clipId, projectId } = params
  return withLongTakeContext({ projectId }, async () => {
    const file = await readQaFile(projectId)
    const clip = file.clips.find((entry) => entry.clipId === clipId)
    const generation = params.generation ?? beatLoopGeneration(clip)
    const kept = pickBeatLoopTake(clip?.takes ?? [], {
      generation,
      startFrameUri: params.startFrameUri,
    })
    if (!clip || !kept?.transition) {
      throw ApplicationFailure.nonRetryable(
        `Clip ${clipId} has no usable take: every one failed before there was a clip to keep`,
        'BeatLoopNoTake',
      )
    }
    clip.generation = generation
    clip.keptTake = kept.take
    clip.flagged = !kept.passed
    // Kept in this chain now, not left over from an earlier one.
    delete clip.keepAfterRedo
    const lastFrameUri = kept.lastFrameUri ?? kept.transition.lastFrameUri
    await writeQaFile(projectId, file)
    logger.info(
      `[beat-loop] Kept a take ${formatLogFields({
        clipId,
        flagged: clip.flagged,
        generation,
        projectId,
        take: kept.take,
        takes: clip.takes.length,
      })}`,
    )
    const fallback = fallbackOf(kept)
    return {
      clipId,
      clipIndex: clip.clipIndex,
      ...(fallback ? { fallback } : {}),
      failures: kept.failures,
      ...(kept.firstFrameUri ? { firstFrameUri: kept.firstFrameUri } : {}),
      flagged: clip.flagged,
      keptTake: kept.take,
      ...(lastFrameUri ? { lastFrameUri } : {}),
      model: kept.model,
      transition: kept.transition,
    }
  })
}

/** The models by name when the take was made after another model's video call failed on it. */
function fallbackOf(take: BeatLoopTake): BeatLoopFallback | undefined {
  const failed = take.attempts.find((attempt) => attempt.model !== take.model)?.model
  return failed ? { failedModel: modelLabel(failed), model: modelLabel(take.model) } : undefined
}

/** A model's name as the models file labels it, else its key. */
function modelLabel(key: string): string {
  try {
    return modelRegistry().models[key]?.label ?? key
  } catch {
    return key
  }
}

/**
 * The record, empty only when there is none yet. A record that is there but can't be read (cut
 * short, bad JSON, a disk error) fails the step (retryable) instead: read as empty, its paid
 * takes would be forgotten, every clip paid for again, and the old takes' files written over.
 */
async function readQaFile(projectId: string): Promise<BeatLoopQaFile> {
  try {
    return await createLongTakeStorage(projectId).readJsonFile<BeatLoopQaFile>(BEAT_LOOP_QA_PATH)
  } catch (error) {
    if (isMissingObjectError(error)) {
      return { clips: [], spend: { estimatedUsd: 0, takes: 0 }, updatedAt: '', version: 1 }
    }
    throw ApplicationFailure.retryable(
      `${BEAT_LOOP_QA_PATH} can't be read: ${formatError(error).message}. It records every clip already paid for, so the loop stopped rather than pay for them again: fix the file, or delete it to make every clip again.`,
      'BeatLoopQaUnreadable',
    )
  }
}

async function writeQaFile(projectId: string, file: BeatLoopQaFile): Promise<void> {
  const takes = file.clips.flatMap((clip) => clip.takes)
  const reported = takes.flatMap((take) =>
    take.spend.reported?.usd === undefined ? [] : [take.spend.reported.usd],
  )
  file.spend = {
    estimatedUsd: cents(takes.reduce((sum, take) => sum + take.spend.estimatedUsd, 0)),
    ...(reported.length ? { reportedUsd: cents(reported.reduce((a, b) => a + b, 0)) } : {}),
    takes: takes.length,
  }
  file.updatedAt = new Date().toISOString()
  await createLongTakeStorage(projectId).writeJsonFile(BEAT_LOOP_QA_PATH, file)
}

const cents = (usd: number): number => Math.round(usd * 100) / 100
