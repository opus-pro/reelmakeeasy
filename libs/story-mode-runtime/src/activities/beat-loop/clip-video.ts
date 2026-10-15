/**
 * What the transition step does differently for a loop clip (`beatLoop: true`): the clip is
 * asked for at exactly 4 s on the one model picked for it (no fallback model here: the clip
 * activity walks the loop's own list, and the registry's clip fallbacks include fal Veo, which
 * misses the beat), then beat-locked to 96 frames with its first frame kept and its sound
 * levelled. Its own sound effects stay in.
 *
 * Spend safety: a failure of the video call itself is marked (`isBeatLoopVideoCallFailure`),
 * since only that may send the clip to another model. Once a clip is delivered it is paid
 * for: it is stored as delivered (`<take>_paid.mp4`) and reported (`onBeatLoopClipPaid`)
 * before anything else is done to it, and a later try of the same take finishes that copy
 * (`beatLoopPaidClip`) instead of paying for the clip again.
 */
import { BEAT_CLIP_SECONDS, beatLoopResolution } from '@reelmakeeasy/common/long-take/beat-loop-craft'
import {
  beatLockClip,
  type BeatLockResult,
  levelClipAudio,
  type LevelClipAudioResult,
} from '@reelmakeeasy/common/utils/beat-lock'
import { LLM, type VideoGenerationWithMetaResult, type VideoResolution } from '@reelmakeeasy/llm'
import { ApplicationFailure } from '@reelmakeeasy/workflow-engine/activity'

import { downloadAssetToLocal, formatError, formatLogFields, logger } from '../long-take/common'
import { createLongTakeStorage } from '../long-take/storage'
import { recordGenerationCall } from '../long-take-generation-record-staging'

/** The failure type of a clip whose length the beat-lock can't fix: re-roll it. */
export const BEAT_LOOP_REROLL = 'BeatLoopReroll'

const BEAT_LOOP_CLIP_TASK = 'beat-loop-clip'

/** The transition step's switch for loop shorts. */
export interface BeatLoopTransitionOptions {
  /**
   * A loop short's 4 s clip: exact length on the given model, its own sound kept and levelled,
   * the prompt sent as written, beat-locked instead of retimed, and the last frame taken after
   * the lock. Needs `preparedPrompt`.
   */
  beatLoop?: boolean
  /** A clip this take already paid for (stored as delivered): finished, not asked for again. */
  beatLoopPaidClip?: BeatLoopPaidClip
  /**
   * Called (in process: the clip activity calls the transition step directly) as soon as the
   * provider delivered a clip, before anything is done to it: the take is on record with its
   * spend from then on.
   */
  onBeatLoopClipPaid?: (paid: BeatLoopPaidClip) => Promise<void>
}

/** A delivered (so paid-for) loop clip. */
export interface BeatLoopPaidClip {
  /** The model that made it. */
  model: string
  providerTaskId?: string
  reported?: BeatLoopReportedSpend
  /** Its stored copy, as delivered; absent when storing it failed. */
  uri?: string
}

/** What happened to a loop clip on its way through the transition step. */
export interface BeatLoopClipMeta {
  audio: { gainDb?: number; inputLufs?: number; outputLufs?: null | number; status: string }
  beatLock: { frames: number; multiplier: number; retimed: boolean; sourceDurationS: number }
  providerTaskId?: string
  /** What the provider reported it billed, when it reports it. */
  reported?: BeatLoopReportedSpend
}

export interface BeatLoopClipVideo {
  actualModel: string
  height?: number
  path: string
  prompt: string
  providerTaskId?: string
  reported?: BeatLoopReportedSpend
  width?: number
}

/** fal's `x-fal-billable-units` and Omni's usage, as the video call passes them on. */
export interface BeatLoopReportedSpend {
  billableUnits?: number
  usd?: number
}

/**
 * One loop clip, exactly 4 s, on `model` (the caller pins the run to its provider); or, with
 * `paidClip`, the clip this take already paid for, from its stored copy.
 */
export async function generateBeatLoopClipVideo(params: {
  firstFramePath: string
  firstFrameUri?: string
  lastFramePath?: string
  lastFrameUri?: string
  model: string
  onPaid?: (paid: BeatLoopPaidClip) => Promise<void>
  /** The take's file name: the stored copy is `<outputName>_paid.mp4`. */
  outputName?: string
  paidClip?: BeatLoopPaidClip
  projectId: string
  prompt: string
  taskId: string
  tempDir: string
  transitionId: string
  transitionUri?: string
  userId?: string
}): Promise<BeatLoopClipVideo> {
  const { model, projectId, prompt, taskId, transitionId } = params
  const outputPath = `${params.tempDir}/${transitionId}.mp4`
  if (params.paidClip?.uri) return reusePaidClip(params.paidClip, outputPath, prompt)
  const record = (fields: Record<string, unknown>) =>
    recordGenerationCall({
      anchorId: transitionId,
      anchorType: 'transition',
      attempt: 1,
      inputRefs: [
        params.firstFrameUri || params.firstFramePath,
        params.lastFrameUri || params.lastFramePath,
      ].filter((ref): ref is string => Boolean(ref)),
      inputText: prompt,
      model,
      projectId,
      task: BEAT_LOOP_CLIP_TASK,
      taskId,
      type: 'video',
      userId: params.userId,
      ...fields,
      status: fields['status'] as 'failed' | 'success',
    })
  let result: VideoGenerationWithMetaResult
  try {
    result = await LLM.generateVideo({
      aspectRatio: '9:16',
      durationSeconds: BEAT_CLIP_SECONDS,
      exactDurationSeconds: BEAT_CLIP_SECONDS,
      firstFrameUrl: params.firstFramePath,
      lastFrameUrl: params.lastFramePath,
      models: [model],
      outputPath,
      prompt,
      resolution: beatLoopResolution(model) as VideoResolution,
      role: 'video.firstLast',
      task: BEAT_LOOP_CLIP_TASK,
    })
  } catch (error) {
    await record({ error: formatError(error), status: 'failed' }).catch(() => undefined)
    throw markVideoCallFailure(error)
  }
  const reported = reportedSpend(result)
  // Paid for from here on: stored as delivered and on record before anything can fail.
  const paid: BeatLoopPaidClip = {
    model,
    ...(result.providerTaskId ? { providerTaskId: result.providerTaskId } : {}),
    ...(reported ? { reported } : {}),
  }
  const uri = await storePaidClip(projectId, params.outputName ?? transitionId, result.path)
  if (uri) paid.uri = uri
  await params.onPaid?.(paid)
  await record({ outputRefs: [params.transitionUri || result.path], status: 'success' })
  return {
    actualModel: model,
    height: result.height,
    path: result.path,
    prompt,
    ...(result.providerTaskId ? { providerTaskId: result.providerTaskId } : {}),
    ...(reported ? { reported } : {}),
    width: result.width,
  }
}

/** True for a failure of the video call itself (the provider made no clip): another model may
 *  try. Anything else (before or after the call) stays on the model that was asked. */
export function isBeatLoopVideoCallFailure(error: unknown): boolean {
  return typeof error === 'object' && error !== null && videoCallFailures.has(error)
}

/** Marks a failure as the video call's own (see `isBeatLoopVideoCallFailure`). */
export function markVideoCallFailure(error: unknown): Error {
  const marked = error instanceof Error ? error : new Error(String(error))
  videoCallFailures.add(marked)
  return marked
}

const videoCallFailures = new WeakSet<object>()

/** The paid clip's stored copy, from where finishing it starts again. */
async function reusePaidClip(
  paid: BeatLoopPaidClip,
  outputPath: string,
  prompt: string,
): Promise<BeatLoopClipVideo> {
  await downloadAssetToLocal(paid.uri as string, outputPath)
  logger.info(
    `[beat-loop] Finishing a clip already paid for ${formatLogFields({ model: paid.model, uri: paid.uri })}`,
  )
  return {
    actualModel: paid.model,
    path: outputPath,
    prompt,
    ...(paid.providerTaskId ? { providerTaskId: paid.providerTaskId } : {}),
    ...(paid.reported ? { reported: paid.reported } : {}),
  }
}

/** Stores a delivered clip as it came; undefined (logged) when storing fails: the take goes on. */
async function storePaidClip(
  projectId: string,
  outputName: string,
  localPath: string,
): Promise<string | undefined> {
  const storage = createLongTakeStorage(projectId)
  const storagePath = `long_take/transitions/${outputName}_paid.mp4`
  try {
    await storage.uploadFile(localPath, storagePath)
    return storage.getFullPath(storagePath)
  } catch (error) {
    logger.warn(
      `[beat-loop] Could not store the delivered clip; a retry would pay for it again ${formatLogFields(
        { err: formatError(error), outputName, projectId },
      )}`,
    )
    return undefined
  }
}

/**
 * Beat-locks a loop clip in place (0-3 s kept frame for frame, the cut sped up to land on
 * 4.000 s) and levels its sound to the clip reference. A clip whose length the lock can't
 * fix fails with BEAT_LOOP_REROLL, never retried as it is: the clip activity re-rolls it.
 */
export async function lockBeatLoopClip(params: {
  clip: Pick<BeatLoopClipVideo, 'path' | 'providerTaskId' | 'reported'>
  transitionId: string
}): Promise<BeatLoopClipMeta> {
  const { clip, transitionId } = params
  const lock: BeatLockResult = await beatLockClip(clip.path)
  if (lock.status === 'reroll') {
    throw ApplicationFailure.create({
      details: [lock],
      message: `Clip ${transitionId} came back ${lock.sourceDurationS.toFixed(2)} s long; the beat-lock can't fit that to 4 s (${lock.reason})`,
      nonRetryable: true,
      type: BEAT_LOOP_REROLL,
    })
  }
  let audio: LevelClipAudioResult | { reason: string; status: 'failed' }
  try {
    audio = await levelClipAudio(clip.path)
  } catch (error) {
    // The clip is still usable at its own level: the finish pass measures the joined track.
    logger.warn(
      `[beat-loop] Could not level the clip's sound ${formatLogFields({
        err: formatError(error),
        transitionId,
      })}`,
    )
    audio = { reason: formatError(error).message, status: 'failed' }
  }
  return {
    audio:
      audio.status === 'levelled'
        ? {
            gainDb: audio.gainDb,
            inputLufs: audio.inputLufs,
            outputLufs: audio.outputLufs,
            status: audio.status,
          }
        : { status: audio.status },
    beatLock: {
      frames: lock.frames,
      multiplier: lock.multiplier,
      retimed: lock.retimed,
      sourceDurationS: lock.sourceDurationS,
    },
    ...(clip.providerTaskId ? { providerTaskId: clip.providerTaskId } : {}),
    ...(clip.reported ? { reported: clip.reported } : {}),
  }
}

/** Whether a transition is a loop clip. A loop clip must come with its prompt, sent as written. */
export function isBeatLoopTransition(
  params: BeatLoopTransitionOptions & { preparedPrompt?: string; transitionId: string },
): boolean {
  if (params.beatLoop !== true) return false
  if (!params.preparedPrompt) {
    // A caller's mistake: retrying can't fix it.
    throw ApplicationFailure.nonRetryable(
      `Loop clip ${params.transitionId} needs its prompt (preparedPrompt)`,
      'BeatLoopNoPrompt',
    )
  }
  return true
}

/** The name a transition's last frame is kept under: a loop clip's takes each keep their own. */
export function lastFrameName(
  params: BeatLoopTransitionOptions & { outputName?: string; transitionId: string },
): string {
  return params.beatLoop === true && params.outputName ? params.outputName : params.transitionId
}

/** True for the failure lockBeatLoopClip throws. */
export function isBeatLoopReroll(error: unknown): error is ApplicationFailure {
  return error instanceof ApplicationFailure && error.type === BEAT_LOOP_REROLL
}

/**
 * The provider's own billing for the request, when the video call passes it on as
 * `billing: { units, usd }` (fal's x-fal-billable-units; Omni's usage).
 */
function reportedSpend(result: VideoGenerationWithMetaResult): BeatLoopReportedSpend | undefined {
  const billing = (result as { billing?: { units?: unknown; usd?: unknown } }).billing
  const units = typeof billing?.units === 'number' ? billing.units : undefined
  const usd = typeof billing?.usd === 'number' ? billing.usd : undefined
  if (units === undefined && usd === undefined) return undefined
  return {
    ...(units === undefined ? {} : { billableUnits: units }),
    ...(usd === undefined ? {} : { usd }),
  }
}
