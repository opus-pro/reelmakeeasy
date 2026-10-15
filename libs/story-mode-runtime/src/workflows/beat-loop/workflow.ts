// A loop short (the beat-loop skill): N clips of 4 s that each hit, freeze and cut into the
// next, the last cutting back into the first so the video replays seamlessly. Started by name
// from the API's BeatLoopService through the standard admission path, after it wrote
// long_take/beat_loop.json; Stop and Try again work as for a long-take video.
//
// The order is the spend order: the voiceover first (cheap, and a line too long to fit fails
// the run before any picture is made), then the keyframes, then the clips strictly one after
// another (clips.ts), then the long-take render, whose finish pass draws the captions and
// stamps. A run picks up where an earlier one of the same project stopped (resume.ts): the
// clips it kept and their last frames are stored, so Try again, or a start after an API
// restart, renders from the first clip not kept yet.

import { STORY_MODE_ADMISSION_START_SIGNAL } from '@reelmakeeasy/common/long-take/story-mode-routing-constants'
import type { LongTakeAdmissionTier } from '@reelmakeeasy/common/long-take/types'
import { setWorkflowScopedContext } from '@reelmakeeasy/common/workflow-runtime/workflow-tracer'
import {
  ApplicationFailure,
  condition,
  defineSignal,
  setHandler,
  workflowInfo,
} from '@reelmakeeasy/workflow-engine/workflow'

import type { BeatLoopKeyframeResult } from '../../activities/beat-loop'
import { createWorkflowLogger } from '../../utilities/workflow-logger'
import {
  recordLongTakeRuntimeMetadata,
  renderLongTakeVideo,
  reserveLongTakeSlot,
} from '../long-take/activity-proxies'
import { isPolicyBlockedError } from '../long-take/policy-block'
import { buildRenderTransitionVideos } from '../long-take/render-transition-payload'
import {
  classifyWorkflowErrorDetail,
  cleanPolicyBlockRejectionDetail,
  unwrapActivityFailure,
} from '../long-take/workflow-error-helpers'
import {
  createLongTakeWorkflowRuntime,
  type LongTakeWorkflowLogFn,
  type LongTakeWorkflowRuntime,
} from '../long-take/workflow-runtime'

import {
  generateBeatLoopKeyframes,
  generateBeatLoopVoiceover,
  readBeatLoopQa,
} from './activity-proxies'
import { makeBeatLoopClips } from './clips'
import { planBeatLoopResume } from './resume'
import type {
  BeatLoopOtherModelClip,
  BeatLoopWorkflowParams,
  BeatLoopWorkflowResult,
  KeptBeatLoopClip,
} from './types'

const storyModeAdmissionStartSignal = defineSignal(STORY_MODE_ADMISSION_START_SIGNAL)

export async function BeatLoopWorkflow(
  params: BeatLoopWorkflowParams,
): Promise<BeatLoopWorkflowResult> {
  const { admissionTier, orgId, projectId, queuedAtMs, startPaused, storyboard, style } = params
  const { userEmail, userId, voiceId } = params

  setWorkflowScopedContext({
    projectId,
    storyModeAdmissionTier: admissionTier,
    userEmail,
    userId,
  })

  const logger = createWorkflowLogger({ projectId, userId })
  const logInfo: LongTakeWorkflowLogFn = (message, fields = {}) => logger.info(message, fields)
  const logError: LongTakeWorkflowLogFn = (message, fields = {}) => logger.error(message, fields)

  let admissionReleased = !startPaused
  setHandler(storyModeAdmissionStartSignal, () => {
    admissionReleased = true
  })
  if (startPaused) {
    logInfo('beatLoopWorkflow waiting for admission', { queuedAtMs })
    await condition(() => admissionReleased)
  }

  const clipCount = storyboard.clips.length
  logInfo('beatLoopWorkflow started', { clipCount, durationS: storyboard.duration_s })
  const workflowStartedAt = Date.now()

  try {
    await recordLongTakeRuntimeMetadata({ projectId, userEmail, userId })
  } catch (error) {
    logError('beatLoopWorkflow runtime metadata recording failed', {
      errorMessage: error instanceof Error ? error.message : String(error),
    })
  }

  await reserveLongTakeSlot({ projectId })
  const runtime = await createLongTakeWorkflowRuntime({ projectId, userEmail, userId })

  try {
    await runtime.setStageInProgress({ stage: 'voiceover' })
    const voiceover = await generateBeatLoopVoiceover({
      orgId,
      projectId,
      storyboard,
      userEmail,
      userId,
      voiceId,
    })
    logInfo('beatLoopWorkflow voiceover made', {
      durationSeconds: voiceover.durationSeconds,
      ttsProvider: voiceover.ttsProvider,
    })
    await runtime.setStageCompleted({ stage: 'voiceover' })

    const qa = await readBeatLoopQa({ projectId })
    let resume = planBeatLoopResume(storyboard, qa)
    const stored = resume.kept.length + resume.keptAfterRedo.length + resume.pendingTakes.length
    if (stored) {
      logInfo('beatLoopWorkflow resuming', {
        keptAfterRedo: resume.keptAfterRedo.length,
        keptClips: resume.kept.length,
        pendingTakes: resume.pendingTakes.length,
      })
    }

    await runtime.setStageInProgress({ stage: 'keyframes' })
    // When the frames are made again, every stored clip starts over: the keyframes step moves
    // them on in the record itself, before it writes over a frame.
    const restart = planBeatLoopResume(storyboard, qa, { restart: true })
    // Frames already made are reused in the dialect they were made in; new ones are written
    // for the model of the provider Setup picked, which every clip tries first.
    const keyframes = await generateBeatLoopKeyframes({
      projectId,
      restartGenerations: restart.generations,
      storyboard,
      style,
      userId,
    })
    assertLoopCloses(keyframes.frames, clipCount)
    if (qa.clips.length && !keyframes.reused) {
      // The stored clips land on frames that were made again: every clip starts over.
      logInfo('beatLoopWorkflow keyframes made again: the stored clips start over', {
        storedClips: resume.kept.length + resume.keptAfterRedo.length,
      })
      resume = restart
    }
    await runtime.setStageCompleted({ stage: 'keyframes' })

    await runtime.setStageInProgress({
      meta: { completedTransitions: resume.kept.length, transitionCount: clipCount },
      stage: 'transitions',
    })
    const made = await makeBeatLoopClips({
      frames: keyframes.frames,
      logInfo,
      orgId,
      projectId,
      resume,
      runtime,
      storyboard,
      style,
      userEmail,
      userId,
    })
    await runtime.setStageCompleted({ meta: { transitionCount: clipCount }, stage: 'transitions' })

    await runtime.setStageInProgress({ stage: 'render' })
    const render = await renderLongTakeVideo({
      aspectRatio: '9:16',
      // Music added since the loop was made stays on its next render (a redo, a resume).
      ...(params.bgmBedUri ? { bgmBedUri: params.bgmBedUri, bgmVolume: params.bgmVolume } : {}),
      enableCaption: params.enableCaption ?? true,
      projectId,
      transitionVideos: buildRenderTransitionVideos(made.clips.map((clip) => clip.transition)),
      userEmail,
      userId,
    })
    logInfo('beatLoopWorkflow render completed', {
      renderDurationMs: render.renderDurationMs,
      videoUri: render.videoUri,
    })
    await runtime.setStageCompleted({ stage: 'render' })

    const flaggedClips = made.clips
      .filter((clip) => clip.flagged)
      .map((clip) => ({ clipId: clip.clipId, failures: clip.failures }))
    const clipSpendUsd = await readClipSpend(projectId, logError)
    await runtime.releaseSlot({ admissionTier, projectId, workflowId: workflowInfo().workflowId })
    // The stored status is overwritten on each write: what the reply reads rides on this one.
    await runtime.setStageCompleted({
      detail: completedDetail(render.videoUri, made),
      meta: {
        beatLoopClips: clipCount,
        beatLoopRerolls: made.rerolls,
        ...(flaggedClips.length
          ? { beatLoopFlaggedClips: flaggedClips.map((clip) => clip.clipId).join(',') }
          : {}),
        ...(clipSpendUsd === undefined ? {} : { beatLoopClipSpendUsd: clipSpendUsd }),
        transitionVideoModel: [...new Set(made.clips.map((clip) => clip.model))].join(','),
      },
      stage: 'completed',
    })
    logInfo('beatLoopWorkflow completed', {
      flaggedClips: flaggedClips.length,
      rerolls: made.rerolls,
      videoUri: render.videoUri,
    })
    return {
      flaggedClips,
      otherModelClips: made.otherModelClips,
      rerolls: made.rerolls,
      resumedClips: resume.kept.length + resume.keptAfterRedo.length,
      status: 'completed',
      videoUri: render.videoUri,
    }
  } catch (error) {
    await failBeatLoopRun({ admissionTier, error, logError, projectId, runtime, workflowStartedAt })
    throw error
  }
}

/** fN must be the copy of f0 the keyframes activity makes: the loop lands where it started. */
function assertLoopCloses(frames: BeatLoopKeyframeResult[], clipCount: number): void {
  const closing = frames[clipCount]
  if (frames.length !== clipCount + 1 || !closing || closing.copyOf !== frames[0]?.id) {
    throw ApplicationFailure.nonRetryable(
      `The keyframes don't close the loop: ${clipCount} clips need ${clipCount + 1} frames, the last a copy of the first`,
      'BeatLoopBadKeyframes',
    )
  }
}

/**
 * 'Render complete', then each clip kept although it still fails a check, and why, and each
 * clip this run made on the other provider's model (it costs that model's price).
 */
function completedDetail(
  videoUri: string | undefined,
  made: { clips: KeptBeatLoopClip[]; otherModelClips: BeatLoopOtherModelClip[] },
): string | undefined {
  if (!videoUri) return undefined
  const flagged = made.clips
    .filter((clip) => clip.flagged)
    .map((clip) => `Clip ${clip.clipId} still fails a check: ${clip.failures.join(' ')}`)
  const other = made.otherModelClips.map(
    (clip) => `Clip ${clip.clipId} was made with ${clip.model}: ${clip.failedModel} failed on it.`,
  )
  return ['Render complete.', ...flagged, ...other].join(' ')
}

/**
 * What every take of the loop's clips cost (the seconds asked for at the registry's rate, as the
 * QA record adds it up), takes of earlier runs included; never fails the run.
 */
async function readClipSpend(
  projectId: string,
  logError: LongTakeWorkflowLogFn,
): Promise<number | undefined> {
  try {
    const file = await readBeatLoopQa({ projectId })
    return file.spend.estimatedUsd
  } catch (error) {
    logError('beatLoopWorkflow clip spend read failed (non-fatal)', {
      errorMessage: error instanceof Error ? error.message : String(error),
    })
    return undefined
  }
}

/**
 * The failed status, with the reason in plain words: an activity's own message (a line too long,
 * a safety block, no usable take) rather than the engine's "Activity task failed".
 */
async function failBeatLoopRun(input: {
  admissionTier?: LongTakeAdmissionTier
  error: unknown
  logError: LongTakeWorkflowLogFn
  projectId: string
  runtime: LongTakeWorkflowRuntime
  workflowStartedAt: number
}): Promise<void> {
  const { admissionTier, error, logError, projectId, runtime } = input
  const cause = unwrapActivityFailure(error)?.cause ?? error
  const message = cause instanceof Error ? cause.message : String(cause)
  const rejected = isPolicyBlockedError(error)
  logError(rejected ? 'beatLoopWorkflow rejected (policy block)' : 'beatLoopWorkflow failed', {
    elapsedMs: Date.now() - input.workflowStartedAt,
    errorMessage: message,
    stage: runtime.getCurrentStage(),
  })
  await runtime.releaseSlot({ admissionTier, projectId, workflowId: workflowInfo().workflowId })
  if (rejected) await runtime.setWorkflowRejected(cleanPolicyBlockRejectionDetail(message))
  else await runtime.setWorkflowError(classifyWorkflowErrorDetail(error, message))
}
