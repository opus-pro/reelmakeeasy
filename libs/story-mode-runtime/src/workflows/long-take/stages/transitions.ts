import type { PipelineContextEntry } from '@reelmakeeasy/common/job-context'
import type { CameraStyle } from '@reelmakeeasy/common/long-take/camera-craft'
import type { LongTakeAdmissionTier } from '@reelmakeeasy/common/long-take/types'
import type { AspectRatio, GenerationResolution } from '@reelmakeeasy/common/media/types'
import {
  isHappyHorseModel,
  isSeedance25Model,
  isSeedanceModel,
} from '@reelmakeeasy/common/veo3/model'
import {
  chainsTransitions,
  getMaxSupportedVideoDurationSeconds,
} from '@reelmakeeasy/common/video-models/registry'
import { ApplicationFailure } from '@reelmakeeasy/workflow-engine/workflow'
import { DebugSettings } from '@shared/types/project/debug-settings'

import {
  type LongTakePromptRoute,
  resolveLongTakeTransitionPromptRoute,
} from '../../../long-take-prompt-router'
import {
  buildPhotoPanZoomTransition,
  buildStaticHoldTransition,
  ensureLongTakeTransitionsDir,
  generateLongTakeTransitionVideo,
  prepareLongTakeTransitionPrompt,
  selectLongTakeTransitionTypes,
} from '../activity-proxies'
import { PHOTO_PASSTHROUGH_IMAGE_MODEL } from '../photo-passthrough'
import {
  assertTransitionPlanFeasible,
  buildLegacyPanTransitionPrompt,
  buildSeedance25MergedTransitionPrompt,
  buildSeedance25SegmentTransitionPlan,
  buildSeedance25StorySegmentPrompt,
  buildTransitionPlan,
  buildTransitionPrompt,
  groupSeedance25TransitionSeeds,
  type Seedance25MergedTransitionGroup,
  type TransitionPlanSeed,
} from '../transition-planning'
import type {
  LongTakeKeyframeItem,
  LongTakeShotPlanItem,
  LongTakeTransitionPlanItem,
  LongTakeTransitionType,
  LongTakeTransitionVideoItem,
} from '../types'
import { withCapacity } from '../with-capacity'
import type { LongTakeWorkflowLogFn, LongTakeWorkflowRuntime } from '../workflow-runtime'
import { mapWithConcurrency } from '../workflow-utils'

import { clipIndexByTransitionId } from './clip-index'

/** Extra inputs for one clip of a chained transition sequence. */
interface ChainedClipOptions {
  captureLastFrame: boolean
  preparedPrompt?: string
}

export async function runTransitionsStage(params: {
  admissionTier?: LongTakeAdmissionTier
  aspectRatio?: AspectRatio
  audioDurationSeconds?: number
  cameraStyle?: CameraStyle
  debugSettings?: DebugSettings
  generationResolution?: GenerationResolution
  globalScript?: string
  improvedVisualScriptEnabled?: boolean
  keyframes: LongTakeKeyframeItem[]
  logInfo: LongTakeWorkflowLogFn
  /** Org id that owns the project. */
  orgId?: string
  perfectLoop?: boolean
  pipelineContext?: PipelineContextEntry[]
  projectId: string
  promptRoute?: LongTakePromptRoute
  runtime: LongTakeWorkflowRuntime
  /**
   * Explicit override for the merged-transition mode, used by the
   * UIP workflows to gate on their own workflow-local patch key. Undefined
   * falls back to the long-take patch key.
   */
  seedance25MergedTransitions?: boolean
  seedance25SegmentTopology?: boolean
  shotPlan: LongTakeShotPlanItem[]
  styleText?: string
  transitionVideoModel?: string
  userEmail?: string
  userId: string
  videoConcurrency: number
}): Promise<{
  transitionPlan: TransitionPlanSeed[]
  transitionVideos: LongTakeTransitionVideoItem[]
}> {
  const {
    admissionTier,
    aspectRatio,
    audioDurationSeconds,
    cameraStyle,
    debugSettings,
    generationResolution,
    globalScript,
    improvedVisualScriptEnabled,
    keyframes,
    logInfo,
    orgId,
    perfectLoop,
    pipelineContext,
    projectId,
    promptRoute,
    runtime,
    seedance25MergedTransitions,
    seedance25SegmentTopology,
    shotPlan,
    styleText,
    transitionVideoModel,
    userEmail,
    userId,
    videoConcurrency,
  } = params
  const transitionPromptRoute = resolveLongTakeTransitionPromptRoute(promptRoute)

  // Seedance 2.5 merged transitions: planning stays model-agnostic
  // (legacy center-to-center bridges over per-shot keyframes); adjacent
  // bridges are greedily merged into <= 30s sd2.5 clips at generation time,
  // with the original bridges kept as the per-group fallback plan. Replaces
  // the retired segment topology below.
  const useSeedance25MergedTransitions =
    isSeedance25Model(transitionVideoModel) && seedance25MergedTransitions !== false
  // RETIRED Seedance 2.5 segment topology: reachable only when a caller
  // explicitly turns merged transitions off.
  const useSeedance25SegmentTopology =
    !useSeedance25MergedTransitions &&
    isSeedance25Model(transitionVideoModel) &&
    seedance25SegmentTopology !== false
  const transitionPlan = useSeedance25SegmentTopology
    ? buildSeedance25SegmentTransitionPlan(shotPlan, keyframes, audioDurationSeconds)
    : buildTransitionPlan(shotPlan, keyframes, audioDurationSeconds, {
        perfectLoop,
      })
  const clipIndexById = clipIndexByTransitionId(transitionPlan)
  // The registry resolves the model the generation activity will use: an
  // unset, legacy or unknown id means the video.firstLast role.
  const effectiveTransitionVideoModel = debugSettings?.transitionVideoModel ?? transitionVideoModel
  const modelMaxSeconds = getMaxSupportedVideoDurationSeconds(effectiveTransitionVideoModel)
  // Photo-passthrough slots are synthesized by ffmpeg pan/zoom, not a video
  // model, so the model duration cap does not apply to them.
  const photoPassthroughShotIds = new Set(
    keyframes
      .filter((keyframe) => keyframe.imageModel === PHOTO_PASSTHROUGH_IMAGE_MODEL)
      .map((keyframe) => keyframe.shotId),
  )
  const maxSlotSeconds = modelMaxSeconds
  const guardedPlan = transitionPlan.filter((seed) => !photoPassthroughShotIds.has(seed.fromShotId))
  const oversizeSlots = guardedPlan.filter((seed) => seed.durationSeconds > maxSlotSeconds)
  if (oversizeSlots.length > 0) {
    logInfo('longTakeWorkflow transition plan slot exceeds model cap', {
      maxSlotSeconds,
      slots: oversizeSlots.map((seed) => ({
        durationSeconds: seed.durationSeconds,
        transitionId: seed.transitionId,
      })),
    })
  }
  assertTransitionPlanFeasible(guardedPlan, maxSlotSeconds)
  if (!transitionPlan.length) {
    throw ApplicationFailure.nonRetryable(
      'No transition segments generated for Story Mode',
      'TRANSITION_PLAN_EMPTY',
    )
  }
  logInfo('longTakeWorkflow transition plan built', {
    perfectLoop,
    seedance25MergedTransitions: useSeedance25MergedTransitions,
    seedance25SegmentTopology: useSeedance25SegmentTopology,
    transitionCount: transitionPlan.length,
  })

  await runtime.setStageInProgress({
    meta: { transitionCount: transitionPlan.length },
    stage: 'transitions',
  })

  const keyframeModelByShotId = new Map(
    keyframes.map((keyframe) => [keyframe.shotId, keyframe.imageModel]),
  )
  // Merged groups with more than one member keep their original bridges as
  // the fallback plan: when the merged sd2.5 clip fails (including after the
  // record layer's own alternate-model attempt), each bridge is regenerated
  // individually.
  let mergedGroupByTransitionId: Map<string, Seedance25MergedTransitionGroup> | undefined
  let finalTransitionPlan: LongTakeTransitionPlanItem[]
  if (useSeedance25SegmentTopology) {
    finalTransitionPlan = await buildSeedance25TransitionPlan({
      globalScript,
      logInfo,
      projectId,
      styleText,
      transitionPlan,
      userId,
    })
  } else if (useSeedance25MergedTransitions) {
    const mergedGroups = groupSeedance25TransitionSeeds({
      isPhotoPassthroughSeed: (seed) =>
        keyframeModelByShotId.get(seed.fromShotId) === PHOTO_PASSTHROUGH_IMAGE_MODEL,
      perfectLoop,
      seeds: transitionPlan,
    })
    mergedGroupByTransitionId = new Map(
      mergedGroups
        .filter((group) => group.members.length > 1)
        .map((group) => [group.seed.transitionId, group]),
    )
    finalTransitionPlan = await buildSeedance25MergedTransitionPlanItems({
      globalScript,
      logInfo,
      mergedGroups,
      projectId,
      styleText,
      userId,
    })
  } else {
    finalTransitionPlan = await buildLegacyTransitionPlan({
      globalScript,
      logInfo,
      orgId,
      projectId,
      promptRoute: transitionPromptRoute,
      styleText,
      transitionPlan,
      userId,
    })
  }

  // Happy Horse rides the same slot queue against the vendor's hard
  // 5-concurrent workspace cap. Checked FIRST and against the
  // EFFECTIVE model (incl. the debug override) -- the debug switch is
  // exactly how Happy Horse runs while dark, and a debug override on a
  // seedance-default project must take the alicloud queue, not seedance's.
  // Known residual bypasses (accepted, same structure as the seedance
  // routing): in-activity resolutions the workflow cannot see --
  // debugSettings.llm model switches and fallback-chain swaps. Both are
  // internal/ops controlled (never point them at happyhorse without this
  // routing), and the vendor queues excess tasks (500-deep) rather than
  // erroring, so the failure mode is latency, not loss.
  const generateGatedTransitionVideo = async (
    args: Parameters<typeof generateLongTakeTransitionVideo>[0],
  ) => {
    if (isHappyHorseModel(debugSettings?.transitionVideoModel ?? transitionVideoModel)) {
      return withCapacity({ provider: 'alicloud' }, () => generateLongTakeTransitionVideo(args))
    }
    if (isSeedanceModel(transitionVideoModel)) {
      return withCapacity({ provider: 'seedance' }, () => generateLongTakeTransitionVideo(args))
    }
    return generateLongTakeTransitionVideo(args)
  }

  const buildTransitionVideoArgs = (
    transition: LongTakeTransitionPlanItem,
    dropFirstFrame: boolean,
    chain?: ChainedClipOptions,
  ) => ({
    ...transition,
    ...chain,
    admissionTier,
    aspectRatio,
    ...(cameraStyle ? { cameraStyle } : {}),
    clipIndex: clipIndexById.get(transition.transitionId) ?? 0,
    debugSettings,
    dropFirstFrame,
    generationResolution,
    improvedVisualScriptEnabled,
    isNewStyleTransfer: true,
    orgId,
    pipelineContext,
    projectId,
    staticHoldFallbackOnAllBlack: true,
    ...(promptRoute && { promptRoute }),
    transitionVideoModel,
    userEmail,
    userId,
  })

  // The single-bridge generation path shared by regular transitions and the
  // per-bridge fallback of a failed merged sd2.5 clip.
  const generateSingleTransitionVideo = async (
    transition: LongTakeTransitionPlanItem,
    dropFirstFrame: boolean,
    chain?: ChainedClipOptions,
  ): Promise<LongTakeTransitionVideoItem> => {
    // Realistic-style article photos are shown verbatim: the
    // shot's screen time is a gentle ffmpeg pan/zoom over the raw photo,
    // never an i2v regeneration that would alter the image. A pan-zoom
    // failure falls through to the normal i2v path.
    // The pan/zoom needs a destination frame as well as a source, so it is only
    // available when the clip has both. Every V2 clip does.
    const panZoomLastFrameUri = transition.lastFrameUri
    if (
      keyframeModelByShotId.get(transition.fromShotId) === PHOTO_PASSTHROUGH_IMAGE_MODEL &&
      panZoomLastFrameUri
    ) {
      try {
        return await buildPhotoPanZoomTransition({
          aspectRatio,
          durationSeconds: transition.durationSeconds,
          endMs: transition.endMs,
          firstFrameUri: transition.firstFrameUri,
          fromShotId: transition.fromShotId,
          generationResolution,
          lastFrameUri: panZoomLastFrameUri,
          orgId,
          projectId,
          prompt: transition.prompt,
          startMs: transition.startMs,
          toShotId: transition.toShotId,
          transitionId: transition.transitionId,
          transitionVideoModel: debugSettings?.transitionVideoModel ?? transitionVideoModel,
          userEmail,
          userId,
        })
      } catch (err) {
        logInfo('longTakeWorkflow photo pan-zoom failed; falling back to i2v', {
          transitionId: transition.transitionId,
          err: err instanceof Error ? err.message : String(err),
        })
      }
    }
    try {
      return await generateGatedTransitionVideo(
        buildTransitionVideoArgs(transition, dropFirstFrame, chain),
      )
    } catch (err) {
      // Capacity exhaustion is not a generation failure -- never substitute
      // a fallback clip when the queue is overloaded.
      if (err instanceof ApplicationFailure && err.type === 'CapacityWaitTimeout') {
        throw err
      }
      // The static hold crossfades the first keyframe into the last, so it needs
      // both. Every V2 clip has both.
      const staticHoldLastFrameUri = transition.lastFrameUri
      if (!staticHoldLastFrameUri) {
        throw err
      }
      const originalError = err instanceof Error ? err.message : String(err)
      logInfo('longTakeWorkflow transition failed; using static-hold fallback', {
        transitionId: transition.transitionId,
        err: originalError,
      })
      return await buildStaticHoldTransition({
        aspectRatio,
        durationSeconds: transition.durationSeconds,
        endMs: transition.endMs,
        firstFrameUri: transition.firstFrameUri,
        fromShotId: transition.fromShotId,
        generationResolution,
        transitionVideoModel: debugSettings?.transitionVideoModel ?? transitionVideoModel,
        lastFrameUri: staticHoldLastFrameUri,
        orgId,
        originalError,
        projectId,
        prompt: transition.prompt,
        startMs: transition.startMs,
        toShotId: transition.toShotId,
        transitionId: transition.transitionId,
        userEmail,
        userId,
      })
    }
  }

  // A failed merged sd2.5 clip's member bridges re-enter the regular
  // single-bridge path above, so they inherit its whole ladder (record-layer
  // alternate models, gated static hold) instead of a bespoke copy.
  const memberToPlanItem = (member: TransitionPlanSeed): LongTakeTransitionPlanItem => ({
    ...member,
    globalScript,
    prompt: buildTransitionPrompt(
      member.fromPrompt,
      member.toPrompt,
      styleText?.trim(),
      transitionPromptRoute,
    ),
    styleText: styleText?.trim(),
  })

  // Chained transitions: one clip at a time, each starting from the previous
  // clip's actual last frame so every join is seamless. Only on the plain
  // single-bridge path; merged Seedance 2.5 groups stay parallel.
  const chainTransitionClips =
    !mergedGroupByTransitionId &&
    chainsTransitions(debugSettings?.transitionVideoModel ?? transitionVideoModel)

  const generateChainedTransitions = async (
    plan: LongTakeTransitionPlanItem[],
  ): Promise<LongTakeTransitionVideoItem[]> => {
    // Rewrite every clip's prompt in parallel first, from the planned
    // keyframes, so the sequence below never waits on an LLM.
    const preparedPrompts = await mapWithConcurrency(plan, videoConcurrency, async (transition) => {
      try {
        const { prompt } = await prepareLongTakeTransitionPrompt(
          buildTransitionVideoArgs(transition, false),
        )
        return prompt
      } catch (err) {
        logInfo(
          'longTakeWorkflow chained transition prompt not prepared; the clip rewrites its own',
          {
            transitionId: transition.transitionId,
            err: err instanceof Error ? err.message : String(err),
          },
        )
        return undefined
      }
    })
    const videos: LongTakeTransitionVideoItem[] = []
    let carriedFrameUri: string | undefined
    for (const [index, planned] of plan.entries()) {
      const transition = carriedFrameUri ? { ...planned, firstFrameUri: carriedFrameUri } : planned
      const video = await generateSingleTransitionVideo(transition, index > 0, {
        captureLastFrame: true,
        preparedPrompt: preparedPrompts[index],
      })
      videos.push(video)
      // A fallback clip (static hold, photo pan) captures no frame and ends on
      // its planned keyframe, so the next clip starts there.
      carriedFrameUri = video.lastFrameUri ?? planned.lastFrameUri
      await runtime.setStageInProgress({
        meta: { completedTransitions: index + 1, transitionCount: plan.length },
        stage: 'transitions',
      })
    }
    return videos
  }

  if (chainTransitionClips) {
    logInfo('longTakeWorkflow transitions chained', { transitionCount: finalTransitionPlan.length })
  }
  const transitionVideoResults = chainTransitionClips
    ? await generateChainedTransitions(finalTransitionPlan)
    : await mapWithConcurrency(finalTransitionPlan, videoConcurrency, async (transition, index) => {
        const mergedGroup = mergedGroupByTransitionId?.get(transition.transitionId)
        // Only multi-member merged groups take this branch; singletons and
        // legacy bridges keep the plain single-bridge path.
        if (!mergedGroup) {
          return await generateSingleTransitionVideo(transition, index > 0)
        }
        try {
          return await generateGatedTransitionVideo(buildTransitionVideoArgs(transition, index > 0))
        } catch (err) {
          if (err instanceof ApplicationFailure && err.type === 'CapacityWaitTimeout') {
            throw err
          }
          logInfo('longTakeWorkflow merged sd2.5 transition failed; regenerating member bridges', {
            transitionId: transition.transitionId,
            memberCount: mergedGroup.members.length,
            index,
            err: err instanceof Error ? err.message : String(err),
          })
          const videos: LongTakeTransitionVideoItem[] = []
          for (const [memberIndex, member] of mergedGroup.members.entries()) {
            videos.push(
              await generateSingleTransitionVideo(
                memberToPlanItem(member),
                index > 0 || memberIndex > 0,
              ),
            )
          }
          return videos
        }
      })
  // A merged-group fallback returns one clip per member bridge, so the
  // final list is flattened; ordering stays deterministic (mapWithConcurrency
  // preserves input order) and render sorts by startMs regardless.
  const transitionVideos = transitionVideoResults.flat()
  // Blast-radius check on the static-hold fallback. A few fallbacks
  // mid-video degrades quality slightly (static crossfade vs generated
  // motion); too many means the long-take ships as a mostly-static
  // slideshow, which is worse UX than a clean failure. Fail the project
  // if EITHER the absolute count or the percentage threshold is exceeded.
  // Pure-data check (deterministic over mapWithConcurrency results).
  const fallbackCount = transitionVideos.reduce(
    (acc, v) => (v.usedFallback === true ? acc + 1 : acc),
    0,
  )
  // Keep the ratio policy anchored to the source bridge plan. Seedance 2.5
  // merged mode can shrink successful output clips, but that should not make
  // one source-bridge fallback look like a larger project fraction.
  const fallbackRatioDenominator = transitionPlan.length
  const fallbackRatio = fallbackRatioDenominator > 0 ? fallbackCount / fallbackRatioDenominator : 0
  assertTransitionFallbackThresholdNotExceeded(
    fallbackCount,
    fallbackRatioDenominator,
    fallbackRatio,
    logInfo,
  )

  await runtime.setStageCompleted({
    meta: { transitionCount: transitionPlan.length },
    stage: 'transitions',
  })
  logInfo('longTakeWorkflow transitions generated', {
    transitionVideoCount: transitionVideos.length,
    fallbackCount,
    fallbackRatio: Number(fallbackRatio.toFixed(3)),
  })

  return {
    transitionPlan,
    transitionVideos,
  }
}

// The raw ratio rule fails short projects on a single unavoidable
// fallback (1/2 = 50%), while the absolute cap only ever binds above 50
// transitions. Give the ratio an absolute floor so a small fallback count
// can never fail a project on percentage alone.
function assertTransitionFallbackThresholdNotExceeded(
  fallbackCount: number,
  fallbackRatioDenominator: number,
  fallbackRatio: number,
  logInfo: LongTakeWorkflowLogFn,
) {
  const maxFallbacksByRatio = Math.max(
    MIN_TRANSITION_FALLBACK_ALLOWANCE,
    Math.floor(fallbackRatioDenominator * MAX_TRANSITION_FALLBACK_RATIO),
  )
  const exceedsThreshold =
    fallbackCount > MAX_TRANSITION_FALLBACK_ABSOLUTE || fallbackCount > maxFallbacksByRatio
  if (!exceedsThreshold) {
    return
  }
  logInfo('longTakeWorkflow transition fallback threshold exceeded', {
    fallbackCount,
    totalTransitions: fallbackRatioDenominator,
    fallbackRatio: Number(fallbackRatio.toFixed(3)),
    maxAbsolute: MAX_TRANSITION_FALLBACK_ABSOLUTE,
    maxRatio: MAX_TRANSITION_FALLBACK_RATIO,
    maxByRatioAllowance: maxFallbacksByRatio,
  })
  throw ApplicationFailure.nonRetryable(
    `Too many transition fallbacks: ${fallbackCount}/${fallbackRatioDenominator}. ` +
      `Max allowed: ${MAX_TRANSITION_FALLBACK_ABSOLUTE} absolute or ${maxFallbacksByRatio} by ratio allowance.`,
    'TRANSITION_FALLBACK_THRESHOLD_EXCEEDED',
  )
}

// Quality-floor thresholds for the static-hold transition fallback.
// Both must hold for the project to be considered shippable; either
// violation throws and the workflow fails fast rather than render a
// mostly-static "long take".
const MAX_TRANSITION_FALLBACK_ABSOLUTE = 5
const MAX_TRANSITION_FALLBACK_RATIO = 0.1
// Floor for the ratio-derived allowance so a small number of fallbacks can
// never fail a project on percentage alone (e.g. 1/2 = 50%). Floors only:
// the ratio itself must not widen, so the allowance rounds DOWN before the
// floor applies, matching the old rule everywhere above two.
const MIN_TRANSITION_FALLBACK_ALLOWANCE = 2

async function buildLegacyTransitionPlan(params: {
  globalScript?: string
  logInfo: LongTakeWorkflowLogFn
  orgId?: string
  projectId: string
  promptRoute?: LongTakePromptRoute
  styleText?: string
  transitionPlan: TransitionPlanSeed[]
  userId: string
}): Promise<LongTakeTransitionPlanItem[]> {
  const {
    globalScript,
    logInfo,
    orgId,
    projectId,
    promptRoute,
    styleText,
    transitionPlan,
    userId,
  } = params
  await ensureLongTakeTransitionsDir({ projectId, userId })
  logInfo('longTakeWorkflow using legacy transition prompts by default', {
    transitionCount: transitionPlan.length,
  })
  const transitionTypeResult = await selectLongTakeTransitionTypes({
    orgId,
    projectId,
    ...(promptRoute && { promptRoute }),
    transitions: transitionPlan.map((transition) => ({
      durationSeconds: transition.durationSeconds,
      fromShotId: transition.fromShotId,
      fromPrompt: transition.fromPrompt,
      shouldLipSync: transition.shouldLipSync,
      toShotId: transition.toShotId,
      toPrompt: transition.toPrompt,
      transitionId: transition.transitionId,
    })),
    userId,
  })
  logInfo('longTakeWorkflow transition types selected', {
    selectionCount: transitionTypeResult.selections.length,
  })

  const transitionTypeById = new Map(
    transitionTypeResult.selections.map((selection) => [
      selection.transitionId,
      selection.transitionType,
    ]),
  )

  return buildLegacyTransitionPlanFromTypes({
    globalScript,
    promptRoute,
    styleText,
    transitionPlan,
    transitionTypeById,
  })
}

function buildLegacyTransitionPlanFromTypes(params: {
  globalScript?: string
  promptRoute?: LongTakePromptRoute
  styleText?: string
  transitionPlan: TransitionPlanSeed[]
  transitionTypeById: Map<string, LongTakeTransitionType>
}): LongTakeTransitionPlanItem[] {
  const { globalScript, promptRoute, styleText, transitionPlan, transitionTypeById } = params
  const resolvedStyleText = styleText?.trim()

  return transitionPlan.map((transition) => {
    const transitionType =
      transitionTypeById.get(transition.transitionId) || ('horizontal' as LongTakeTransitionType)
    const prompt = promptRoute
      ? buildLegacyPanTransitionPrompt(
          transition.fromPrompt,
          transition.toPrompt,
          transitionType,
          resolvedStyleText,
          promptRoute,
        )
      : buildLegacyPanTransitionPrompt(
          transition.fromPrompt,
          transition.toPrompt,
          transitionType,
          resolvedStyleText,
        )

    return {
      beatBoundarySeconds: transition.beatBoundarySeconds,
      durationSeconds: transition.durationSeconds,
      endMs: transition.endMs,
      firstFrameUri: transition.firstFrameUri,
      fromAudio: transition.fromAudio,
      fromKeyframePrompt: transition.fromKeyframePrompt,
      fromPrompt: transition.fromPrompt,
      fromShotId: transition.fromShotId,
      globalScript,
      lastFrameUri: transition.lastFrameUri,
      prompt,
      referenceAssetIds: transition.referenceAssetIds,
      shouldLipSync: transition.shouldLipSync,
      startMs: transition.startMs,
      styleText: resolvedStyleText,
      toAudio: transition.toAudio,
      toKeyframePrompt: transition.toKeyframePrompt,
      toPrompt: transition.toPrompt,
      toShotId: transition.toShotId,
      transitionId: transition.transitionId,
    }
  })
}

async function buildSeedance25MergedTransitionPlanItems(params: {
  globalScript?: string
  logInfo: LongTakeWorkflowLogFn
  mergedGroups: Seedance25MergedTransitionGroup[]
  projectId: string
  styleText?: string
  userId: string
}): Promise<LongTakeTransitionPlanItem[]> {
  const { globalScript, logInfo, mergedGroups, projectId, styleText, userId } = params
  await ensureLongTakeTransitionsDir({ projectId, userId })
  logInfo('longTakeWorkflow using Seedance 2.5 merged transition prompts', {
    groupCount: mergedGroups.length,
    mergedGroupCount: mergedGroups.filter((group) => group.members.length > 1).length,
    sourceBridgeCount: mergedGroups.reduce((acc, group) => acc + group.members.length, 0),
  })

  return mergedGroups.map((group) => ({
    durationSeconds: group.seed.durationSeconds,
    endMs: group.seed.endMs,
    firstFrameUri: group.seed.firstFrameUri,
    fromAudio: group.seed.fromAudio,
    fromKeyframePrompt: group.seed.fromKeyframePrompt,
    fromPrompt: group.seed.fromPrompt,
    fromShotId: group.seed.fromShotId,
    globalScript,
    ...(group.members.length > 1 && {
      intermediateKeyframeUris: group.intermediateKeyframeUris,
      seedance25MergedSegment: true,
    }),
    lastFrameUri: group.seed.lastFrameUri,
    prompt: buildSeedance25MergedTransitionPrompt({ globalScript, group, styleText }),
    referenceAssetIds: group.seed.referenceAssetIds,
    shouldLipSync: group.seed.shouldLipSync,
    startMs: group.seed.startMs,
    styleText: styleText?.trim(),
    toAudio: group.seed.toAudio,
    toKeyframePrompt: group.seed.toKeyframePrompt,
    toPrompt: group.seed.toPrompt,
    toShotId: group.seed.toShotId,
    transitionId: group.seed.transitionId,
  }))
}

async function buildSeedance25TransitionPlan(params: {
  globalScript?: string
  logInfo: LongTakeWorkflowLogFn
  projectId: string
  styleText?: string
  transitionPlan: TransitionPlanSeed[]
  userId: string
}): Promise<LongTakeTransitionPlanItem[]> {
  const { globalScript, logInfo, projectId, styleText, transitionPlan, userId } = params
  await ensureLongTakeTransitionsDir({ projectId, userId })
  logInfo('longTakeWorkflow using Seedance 2.5 story-segment prompts', {
    transitionCount: transitionPlan.length,
  })

  return transitionPlan.map((transition) => ({
    beatBoundarySeconds: transition.beatBoundarySeconds,
    durationSeconds: transition.durationSeconds,
    endMs: transition.endMs,
    firstFrameUri: transition.firstFrameUri,
    fromAudio: transition.fromAudio,
    fromKeyframePrompt: transition.fromKeyframePrompt,
    fromPrompt: transition.fromPrompt,
    fromShotId: transition.fromShotId,
    globalScript,
    lastFrameUri: transition.lastFrameUri,
    prompt: buildSeedance25StorySegmentPrompt({ globalScript, styleText, transition }),
    referenceAssetIds: transition.referenceAssetIds,
    shouldLipSync: transition.shouldLipSync,
    startMs: transition.startMs,
    styleText: styleText?.trim(),
    toAudio: transition.toAudio,
    toKeyframePrompt: transition.toKeyframePrompt,
    toPrompt: transition.toPrompt,
    toShotId: transition.toShotId,
    transitionId: transition.transitionId,
  }))
}
