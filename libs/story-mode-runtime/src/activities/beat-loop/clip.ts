/**
 * One take of one loop clip (beat-loop skill, sections 4, 5 and 9): the clip's template in
 * its model's dialect, from its first frame (f0 for clip 1, then the real last frame of the
 * clip before) to its keyframe f(k), exactly 4 s, through the transition step in loop mode.
 * Then the QA meters, the landing on f(k) included, and the take saved with what it cost.
 *
 * Every take tries the model Setup's provider makes loops with first (fal: H3, Google: Omni);
 * the other provider's takes over for that take only when the video call itself fails and its
 * key is set (the take records the failed call in `attempts`). Whether a
 * failed take is re-rolled is the workflow's call: it gets pass/fail, the readings and the
 * reasons.
 *
 * A delivered clip is paid for, so nothing after it pays again: the take is on record with its
 * spend as soon as the clip arrives, a later failure (storage, FFmpeg, the meters) leaves it
 * there as unfinished and fails the activity (never another model), and the retry, or a later
 * run's try of the same take, finishes the stored copy instead of asking for a new clip.
 */
import { execFile } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { promisify } from 'node:util'

import {
  BEAT_CLIP_SECONDS,
  beatLoopCost,
  beatLoopDialect,
  buildBeatClipPrompt,
} from '@reelmakeeasy/common/long-take/beat-loop-craft'
import {
  type BeatLoopClipQa,
  describeBeatLoopQaFailures,
  measureBeatLoopClip,
} from '@reelmakeeasy/common/long-take/beat-loop-qa'
import { ApplicationFailure } from '@reelmakeeasy/workflow-engine/activity'
import type { BeatLoopStoryboard } from '@shared/types/api/agent'

import {
  downloadAssetToLocal,
  formatError,
  formatLogFields,
  isImageSensitiveError,
  isSensitivePromptError,
  logger,
  withActivityHeartbeat,
  withLongTakeContext,
} from '../long-take/common'
import { createLongTakeStorage } from '../long-take/storage'
import { generateLongTakeTransitionVideo } from '../long-take/transitions'

import { type BeatLoopPaidClip, isBeatLoopReroll, isBeatLoopVideoCallFailure } from './clip-video'
import {
  type BeatLoopClipModel,
  beatLoopClipModels,
  noBeatLoopModelMessage,
  withBeatLoopProvider,
} from './providers'
import {
  type BeatLoopClipSpend,
  beatLoopGeneration,
  type BeatLoopTake,
  findBeatLoopTake,
  saveBeatLoopTake,
} from './qa-store'
import { checkBeatLoopClipText } from './text-check'

const execFileAsync = promisify(execFile)

export interface RenderBeatLoopClipParams {
  /** 0-based. */
  clipIndex: number
  /** f0 for clip 1; for clip k the kept take of clip k-1's real last frame (`lastFrameUri`). */
  firstFrameUri: string
  /** The clip's generation in this run (default 1): saved on the take. */
  generation?: number
  /**
   * Last clip only: the frame the loop restarts on, for the seam check (clip 1's real first
   * frame, `firstFrameUri` of its kept take). Defaults to the target frame, fN = f0.
   */
  loopFirstFrameUri?: string
  orgId?: string
  projectId: string
  storyboard: BeatLoopStoryboard
  /** The look: the storyboard's style, or the one picked for it. */
  style: string
  /**
   * The take's number: 1 for the first render of a clip, then one more for every take after it,
   * whatever its generation. Each take keeps its own files. A number already on record is the
   * same take tried again: finished from its stored clip, or returned as it was.
   */
  take?: number
  /** f(k), the keyframe the clip lands on (fN, the copy of f0, for the last clip). */
  targetFrameUri: string
  userEmail?: string
  userId: string
}

/**
 * Activity: renders one take of one loop clip, measures it and saves it to the QA record.
 * Returns the take (pass/fail, failed checks with a sentence each, the meter readings, the
 * clip and its last frame, the spend). A take the beat-lock refuses comes back failed, not
 * thrown. Throws when no model could make the clip (non-retryable for a safety block), or when
 * a delivered clip couldn't be finished (the take stays on record as unfinished).
 */
export async function renderBeatLoopClip(params: RenderBeatLoopClipParams): Promise<BeatLoopTake> {
  const { clipIndex, projectId, storyboard, userId } = params
  const clip = storyboard.clips[clipIndex]
  if (!clip) {
    throw ApplicationFailure.nonRetryable(
      `The storyboard has no clip ${clipIndex + 1} (it has ${storyboard.clips.length})`,
      'BeatLoopBadClip',
    )
  }
  return withLongTakeContext({ projectId, sceneId: 'beat_loop', shotId: clip.id, userId }, () =>
    withActivityHeartbeat(async () => {
      const earlier = await earlierTry(params, clip.id)
      if (earlier && !isUnfinished(earlier)) {
        logger.info(
          `[beat-loop] Take already made ${formatLogFields({ clipId: clip.id, projectId, take: earlier.take })}`,
        )
        return earlier
      }
      const paid = earlier ? paidClipOf(earlier) : undefined
      // A clip already paid for is finished on the model that made it, never another.
      const models = paid
        ? [{ key: paid.model, provider: (earlier as BeatLoopTake).provider }]
        : beatLoopClipModels()
      if (!models.length) {
        throw ApplicationFailure.nonRetryable(noBeatLoopModelMessage(), 'BeatLoopNoModel')
      }
      const attempts: BeatLoopTake['attempts'] = earlier ? [...earlier.attempts] : []
      const errors: unknown[] = []
      for (const model of models) {
        try {
          return await withBeatLoopProvider(model.provider, () =>
            renderTake({ attempts, earlier, model, paid, params }),
          )
        } catch (error) {
          // Only a failed video call may go to the next model: anything else either came
          // before the call (it fails the same way there) or after a paid clip.
          if (!isBeatLoopVideoCallFailure(error)) throw error
          errors.push(error)
          attempts.push({ error: formatError(error).message, model: model.key })
          logger.warn(
            `[beat-loop] Clip model failed ${formatLogFields({
              clipId: clip.id,
              err: formatError(error),
              model: model.key,
              projectId,
            })}`,
          )
        }
      }
      throw clipFailure(clip, errors)
    }),
  )
}

async function renderTake(input: {
  attempts: BeatLoopTake['attempts']
  /** An earlier try of this take, unfinished (its clip stored when `paid` is set). */
  earlier?: BeatLoopTake
  model: BeatLoopClipModel
  /** The clip that earlier try paid for. */
  paid?: BeatLoopPaidClip
  params: RenderBeatLoopClipParams
}): Promise<BeatLoopTake> {
  const { model, params } = input
  const { clipIndex, projectId, storyboard } = params
  const clip = storyboard.clips[clipIndex]
  const clipCount = storyboard.clips.length
  const take = params.take ?? 1
  const outputName = beatLoopTakeName(clip.id, take)
  // Finishing a paid clip keeps what it was asked for and what it cost; anything else is a new
  // request, in this model's dialect.
  const finishing = input.paid ? input.earlier : undefined
  const prompt =
    finishing?.prompt ?? buildBeatClipPrompt(clip, params.style, beatLoopDialect(model.key))
  const base: Omit<BeatLoopTake, 'failed' | 'failures' | 'passed' | 'qa' | 'transition'> = {
    attempts: [...input.attempts],
    clipId: clip.id,
    clipIndex,
    createdAt: finishing?.createdAt ?? new Date().toISOString(),
    generation: params.generation ?? 1,
    model: model.key,
    ...(input.paid?.uri ? { paidClipUri: input.paid.uri } : {}),
    prompt,
    provider: model.provider,
    spend: finishing?.spend ?? clipSpend(model),
    startFrameUri: params.firstFrameUri,
    take,
    targetFrameUri: params.targetFrameUri,
  }
  let paid = input.paid
  const onPaid = async (delivered: BeatLoopPaidClip): Promise<void> => {
    paid = delivered
    if (delivered.uri) base.paidClipUri = delivered.uri
    if (delivered.reported) base.spend = { ...base.spend, reported: delivered.reported }
    await saveBeatLoopTake(projectId, unfinished(base, 'The clip was made; it is being finished.'))
  }
  const startMs = clipIndex * BEAT_CLIP_SECONDS * 1000
  try {
    let item: Awaited<ReturnType<typeof generateLongTakeTransitionVideo>>
    try {
      item = await generateLongTakeTransitionVideo({
        aspectRatio: '9:16',
        beatLoop: true,
        ...(paid ? { beatLoopPaidClip: paid } : {}),
        captureLastFrame: true,
        durationSeconds: BEAT_CLIP_SECONDS,
        endMs: startMs + BEAT_CLIP_SECONDS * 1000,
        firstFrameUri: params.firstFrameUri,
        fromShotId: keyframeId(storyboard, clipIndex),
        lastFrameUri: params.targetFrameUri,
        onBeatLoopClipPaid: onPaid,
        orgId: params.orgId,
        outputName,
        preparedPrompt: prompt,
        projectId,
        prompt,
        startMs,
        // The last clip lands on fN, the copy of f0: the loop goes back to the first shot.
        toShotId: keyframeId(storyboard, (clipIndex + 1) % clipCount),
        transitionId: clip.id,
        transitionVideoModel: model.key,
        userEmail: params.userEmail,
        userId: params.userId,
      })
    } catch (error) {
      if (!isBeatLoopReroll(error)) throw error
      // Paid for, but too far off 4 s to lock to the beat: a failed take, for the workflow to re-roll.
      const refused: BeatLoopTake = {
        ...base,
        failed: ['beatLock'],
        failures: [`${error.message}.`],
        passed: false,
        qa: null,
        transition: null,
      }
      await saveBeatLoopTake(projectId, refused)
      return refused
    }

    const { beatLoop, ...transition } = item
    const measured = await measureTake({ clipCount, clipIndex, item, outputName, params })
    const done: BeatLoopTake = {
      ...base,
      ...(beatLoop ? { beatLoop } : {}),
      ...(beatLoop?.reported ? { spend: { ...base.spend, reported: beatLoop.reported } } : {}),
      failed: measured.failed,
      failures: measured.failures,
      ...(measured.firstFrameUri ? { firstFrameUri: measured.firstFrameUri } : {}),
      ...(item.lastFrameUri ? { lastFrameUri: item.lastFrameUri } : {}),
      passed: measured.failed.length === 0,
      qa: measured.qa,
      transition,
    }
    await saveBeatLoopTake(projectId, done)
    logger.info(
      `[beat-loop] Clip take measured ${formatLogFields({
        clipId: clip.id,
        failed: done.failed,
        model: model.key,
        passed: done.passed,
        projectId,
        take,
      })}`,
    )
    return done
  } catch (error) {
    if (!paid) throw error
    // Paid for, not finished: on record with its spend. The activity's retry (or the next
    // run's try of this take) finishes the stored clip; no other model is asked.
    const reason = formatError(error).message
    await saveBeatLoopTake(
      projectId,
      unfinished(base, `The clip was made but could not be finished: ${reason}.`),
    ).catch((saveError: unknown) =>
      logger.error(
        `[beat-loop] Could not record an unfinished take ${formatLogFields({
          clipId: clip.id,
          err: formatError(saveError),
          projectId,
          take,
        })}`,
      ),
    )
    throw error
  }
}

/** A take's file name: the clip id for take 1, then `<clip>_take<n>`. */
export function beatLoopTakeName(clipId: string, take: number): string {
  return take > 1 ? `${clipId}_take${take}` : clipId
}

/**
 * The record of this take from an earlier try (the activity retried, or a later run finishes
 * it), when it is the same take: same generation, from the same frame.
 */
async function earlierTry(
  params: RenderBeatLoopClipParams,
  clipId: string,
): Promise<BeatLoopTake | undefined> {
  const stored = await findBeatLoopTake(params.projectId, clipId, params.take ?? 1)
  if (!stored) return undefined
  const sameTake =
    beatLoopGeneration(stored) === (params.generation ?? 1) &&
    (!stored.startFrameUri || stored.startFrameUri === params.firstFrameUri)
  return sameTake ? stored : undefined
}

/** A take whose clip was paid for but not finished. */
function isUnfinished(take: BeatLoopTake): boolean {
  return take.failed.includes('unfinished') && !take.transition
}

/** The stored clip an unfinished take paid for, when it was stored. */
function paidClipOf(take: BeatLoopTake): BeatLoopPaidClip | undefined {
  if (!isUnfinished(take) || !take.paidClipUri) return undefined
  return {
    model: take.model,
    ...(take.beatLoop?.providerTaskId ? { providerTaskId: take.beatLoop.providerTaskId } : {}),
    ...(take.spend.reported ? { reported: take.spend.reported } : {}),
    uri: take.paidClipUri,
  }
}

/** A take paid for and not (yet) finished, with why. */
function unfinished(
  base: Omit<BeatLoopTake, 'failed' | 'failures' | 'passed' | 'qa' | 'transition'>,
  why: string,
): BeatLoopTake {
  return {
    ...base,
    failed: ['unfinished'],
    failures: [why],
    passed: false,
    qa: null,
    transition: null,
  }
}

/** The meters on the locked clip, against its start, target and (last clip) loop frames. */
async function measureTake(input: {
  clipCount: number
  clipIndex: number
  item: { videoHeight?: number; videoUri: string; videoWidth?: number }
  outputName: string
  params: RenderBeatLoopClipParams
}): Promise<Pick<BeatLoopTake, 'failed' | 'failures' | 'firstFrameUri' | 'qa'>> {
  const { clipCount, clipIndex, item, outputName, params } = input
  const workDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `beat-loop-qa-${outputName}-`))
  try {
    const clipPath = path.join(workDir, `${outputName}.mp4`)
    await downloadAssetToLocal(item.videoUri, clipPath)
    const fit = (uri: string, name: string) => fitFrameToClip(uri, path.join(workDir, name), item)
    const isLast = clipIndex === clipCount - 1
    const [startFramePath, targetFramePath, loopFirstFramePath] = await Promise.all([
      fit(params.firstFrameUri, 'start.png'),
      fit(params.targetFrameUri, 'target.png'),
      isLast ? fit(params.loopFirstFrameUri ?? params.targetFrameUri, 'loop.png') : undefined,
    ])
    // A meter that fails is a failure on this computer, not the clip's: it throws, and the
    // paid clip is measured again on the retry instead of being re-rolled.
    const qa: BeatLoopClipQa = await measureBeatLoopClip({
      clipPath,
      loopFirstFramePath,
      startFramePath,
      targetFramePath,
      textChecker: checkBeatLoopClipText,
      workDir: path.join(workDir, 'qa'),
    })
    const { files, ...readings } = qa
    const firstFrameUri =
      clipIndex === 0 && files?.firstFramePath
        ? await keepFirstFrame(params.projectId, outputName, files.firstFramePath)
        : undefined
    return {
      failed: qa.failed,
      failures: describeBeatLoopQaFailures(qa),
      ...(firstFrameUri ? { firstFrameUri } : {}),
      qa: readings,
    }
  } finally {
    await fs.promises.rm(workDir, { force: true, recursive: true })
  }
}

/**
 * A reference frame at the clip's own shape: scaled to cover the clip's size and centre-cropped,
 * as the model's adapter fits the frames it sends. SSIM stretches both pictures to 720x1280,
 * and its floors were set on frames of the clip's shape (H3 keyframes are 768x1376, its clips
 * 768x1344).
 */
async function fitFrameToClip(
  uri: string,
  outputPath: string,
  clip?: { videoHeight?: number; videoWidth?: number },
): Promise<string> {
  const source = `${outputPath}.source${path.extname(uri) || '.png'}`
  await downloadAssetToLocal(uri, source)
  if (!clip?.videoWidth || !clip.videoHeight) return source
  const { videoHeight: h, videoWidth: w } = clip
  await execFileAsync('ffmpeg', [
    '-v',
    'error',
    '-y',
    '-i',
    source,
    '-vf',
    `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`,
    '-frames:v',
    '1',
    outputPath,
  ])
  return outputPath
}

/** Clip 1's real first frame, stored: the last clip's seam is checked against it. */
async function keepFirstFrame(
  projectId: string,
  outputName: string,
  localPath: string,
): Promise<string | undefined> {
  const storage = createLongTakeStorage(projectId)
  const storagePath = `long_take/transitions/${outputName}_first.png`
  try {
    await storage.uploadFile(localPath, storagePath)
    return storage.getFullPath(storagePath)
  } catch (error) {
    logger.warn(
      `[beat-loop] Could not keep clip 1's first frame ${formatLogFields({
        err: formatError(error),
        projectId,
      })}`,
    )
    return undefined
  }
}

/** What the take cost: the 4 s asked for at the registry's rate for the loop resolution
 *  (unrounded: the record rounds only its totals). */
function clipSpend(model: BeatLoopClipModel): BeatLoopClipSpend {
  const { usdPerSecond } = beatLoopCost({ clips: 1, model: model.key })
  return {
    estimatedUsd: BEAT_CLIP_SECONDS * usdPerSecond,
    model: model.key,
    provider: model.provider,
    requestedSeconds: BEAT_CLIP_SECONDS,
    usdPerSecond,
  }
}

/** Every model failed: a safety block says which hit to soften; anything else is retryable. */
function clipFailure(clip: BeatLoopStoryboard['clips'][number], errors: unknown[]): Error {
  const blocked = errors.some((error) => isSensitivePromptError(error))
  const imageBlocked = errors.some((error) => isImageSensitiveError(error))
  if (blocked || imageBlocked) {
    return ApplicationFailure.nonRetryable(
      blocked
        ? `The video model's safety filter refused clip ${clip.id}. Soften its hit ("${clip.hit}") or its cut, then try again.`
        : `The video model's safety filter refused the pictures of clip ${clip.id}. Change its keyframes, then try again.`,
      'BeatLoopSafetyBlock',
    )
  }
  const last = errors.at(-1)
  return last instanceof Error ? last : new Error(String(last))
}

function keyframeId(storyboard: BeatLoopStoryboard, index: number): string {
  return storyboard.keyframes[index]?.id ?? `f${index}`
}
