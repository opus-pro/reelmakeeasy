import { MUSIC_ANALYSIS_BASE_TASK_QUEUE } from '@reelmakeeasy/common/long-take/music-analysis-routing-constants'
import {
  getStoryModeImageApiTaskQueue,
  getStoryModeVideoApiTaskQueue,
} from '@reelmakeeasy/common/long-take/story-mode-routing-constants'
import {
  getWorkflowScopedContext,
  proxyActivitiesWrapper,
  proxyLocalActivitiesWrapper,
} from '@reelmakeeasy/common/workflow-runtime/workflow-tracer'
import { workflowInfo } from '@reelmakeeasy/workflow-engine/workflow'

import type { analyzeMusicBeatGrid as analyzeMusicBeatGridActivity } from '../../activities/long-take/music-beat-grid'

import type * as activities from './activities'

type ImageApiActivities = Pick<
  typeof activities,
  | 'generateLongTakeAnchorAssets'
  | 'generateLongTakeKeyframe'
  | 'generateLongTakeSingleRawAnchorAsset'
>

type VideoApiActivities = Pick<
  typeof activities,
  'generateLongTakeTransitionVideo' | 'prepareLongTakeTransitionPrompt'
>

const PAID_FAIRNESS_WEIGHT = 4 // 80% = 4/(4+1)
const FREE_FAIRNESS_WEIGHT = 1 // 20% = 1/(4+1)

const imageApiActivitiesByTaskQueue = new Map<string, ImageApiActivities>()
const videoApiActivitiesByTaskQueue = new Map<string, VideoApiActivities>()

export const {
  ensureLongTakeTransitionsDir,
  getLongTakeConcurrencyConfig,
  persistLongTakeBgmBed,
  recordLongTakeRuntimeMetadata,
  saveLongTakeKeyframes,
  saveLongTakePipelineContext,
  setLongTakeStatus,
  releaseLongTakeSlot,
  reserveLongTakeSlot,
  clearLongTakeBgmRun,
} = proxyLocalActivitiesWrapper<typeof activities>({
  startToCloseTimeout: '30 seconds',
  retry: {
    maximumAttempts: 2,
    initialInterval: '1 second',
    maximumInterval: '5 seconds',
  },
})

export const {
  buildLongTakeShotPlan,
  generateV3ClipPrompts,
  realignV3ShotTimes,
  seedV3PlaygroundShadow,
  writeV3PlaygroundManifest,
} = proxyActivitiesWrapper<typeof activities>({
  startToCloseTimeout: '5 minutes',
  heartbeatTimeout: '120 seconds',
  retry: {
    maximumAttempts: 3,
    initialInterval: '5 seconds',
    maximumInterval: '30 seconds',
  },
})

export const {
  applyLongTakePreVoiceoverSpeed,
  analyzeLongTakeUserAssets,
  analyzeLongTakeVoiceCharacter,
  classifyLongTakePrompt,
  classifyLongTakePromptRoute,
  generateV4Script,
  generateAndUpdateLongTakeProjectName,
  generateLongTakeAnchorAssetFileBinding,
  generateLongTakeKeyframePrompts,
  generateLongTakeScript,
  generateLongTakeVisualNotes,
  refineLongTakeTransitionPrompts,
  selectLongTakeTransitionTypes,
  identifyLongTakeIntent,
  identifyLongTakeStyle,
  classifyLongTakeGenre,
  ideateVisualTreatment,
  generateLongTakeMotionPrompts,
} = proxyActivitiesWrapper<typeof activities>({
  startToCloseTimeout: '20 minutes',
  heartbeatTimeout: '120 seconds',
  retry: {
    maximumAttempts: 3,
    initialInterval: '10 seconds',
    maximumInterval: '1 minute',
  },
})

export const { analyzeLongTakeUserAssetUnderstanding } = proxyActivitiesWrapper<typeof activities>({
  startToCloseTimeout: '7 minutes',
  heartbeatTimeout: '120 seconds',
  retry: {
    maximumAttempts: 3,
    initialInterval: '10 seconds',
    maximumInterval: '1 minute',
  },
})

export const { expandLongTakeKeyframe } = proxyActivitiesWrapper<typeof activities>({
  startToCloseTimeout: '7 minutes',
  heartbeatTimeout: '120 seconds',
  retry: {
    maximumAttempts: 2,
    initialInterval: '10 seconds',
    maximumInterval: '1 minute',
  },
})

export const {
  buildLongTakeMusicBeatSheet,
  generateLongTakeExpertsAssetManager,
  generateLongTakeExpertsAssetManifest,
  generateLongTakeExpertsBeatSheet,
  generateLongTakeExpertsParallel,
  generateLongTakeExpertsWorldBible,
  generateLongTakeVisualScript,
} = proxyActivitiesWrapper<typeof activities>({
  startToCloseTimeout: '10 minutes',
  heartbeatTimeout: '120 seconds',
  retry: {
    maximumAttempts: 3,
    initialInterval: '10 seconds',
    maximumInterval: '2 minutes',
  },
})

// analyzeMusicBeatGrid runs librosa via a Python subprocess and is registered ONLY on the dedicated
// music-analysis worker (its own queue), so it is intentionally absent from the `activities` barrel.
// `import type` keeps the heavy activity out of workflow code; we still type the proxy against
// its real signature. The queue name is the bare literal from @reelmakeeasy/common.
export const { analyzeMusicBeatGrid } = proxyActivitiesWrapper<{
  analyzeMusicBeatGrid: typeof analyzeMusicBeatGridActivity
}>({
  taskQueue: MUSIC_ANALYSIS_BASE_TASK_QUEUE,
  startToCloseTimeout: '15 minutes',
  heartbeatTimeout: '120 seconds',
  retry: {
    maximumAttempts: 3,
    initialInterval: '10 seconds',
    maximumInterval: '1 minute',
  },
})

// Regenerate path: cross-project artifact copy + in-memory input load. Both
// are storage-bound (folder copy, mp3 download + ffprobe) so they get generous
// timeouts with heartbeats and retry transient storage flakes.
export const { copyLongTakeSourceArtifacts, loadLongTakeRegenerateInputs } = proxyActivitiesWrapper<
  typeof activities
>({
  startToCloseTimeout: '10 minutes',
  heartbeatTimeout: '120 seconds',
  retry: {
    maximumAttempts: 3,
    initialInterval: '5 seconds',
    maximumInterval: '30 seconds',
  },
})

// Restyle path: two small read/modify/write steps on the copied
// target prefix that re-point it at the NEW style. Cheap, so a tight timeout
// with retries for transient storage flakes.
export const { applyLongTakeRestyleKeyframePrompts, prepareLongTakeRestyleTarget } =
  proxyActivitiesWrapper<typeof activities>({
    startToCloseTimeout: '2 minutes',
    heartbeatTimeout: '60 seconds',
    retry: {
      maximumAttempts: 3,
      initialInterval: '2 seconds',
      maximumInterval: '20 seconds',
    },
  })

export const { finalizeLongTakeAnchorAssets } = proxyActivitiesWrapper<typeof activities>({
  startToCloseTimeout: '20 minutes',
  heartbeatTimeout: '120 seconds',
  retry: {
    maximumAttempts: 3,
    initialInterval: '10 seconds',
    maximumInterval: '2 minutes',
  },
})

export const { seedLongTakeUserAssetsAnalysis } = proxyActivitiesWrapper<typeof activities>({
  startToCloseTimeout: '30 seconds',
  retry: {
    maximumAttempts: 3,
    initialInterval: '2 seconds',
    maximumInterval: '10 seconds',
  },
})

export const { initUipFastPathAnchorIndex } = proxyActivitiesWrapper<typeof activities>({
  startToCloseTimeout: '2 minutes',
  heartbeatTimeout: '60 seconds',
  retry: {
    maximumAttempts: 3,
    initialInterval: '5 seconds',
    maximumInterval: '30 seconds',
  },
})

// UIP fast-path anchor+VS generation on the shared uip-planner-runtime core.
// Long-running (~5-6 min anchor-image generation) so it heartbeats -- mirrors
// the anchor_vs_batch tool timeout on the UIP worker. Regular (not local)
// activity; awaited sequentially in the fast workflow, never in a Promise.all.
export const { generateUipFastAnchorVsBatchActivity } = proxyActivitiesWrapper<typeof activities>({
  startToCloseTimeout: '15 minutes',
  heartbeatTimeout: '2 minutes',
  retry: {
    maximumAttempts: 3,
    initialInterval: '5 seconds',
    maximumInterval: '30 seconds',
  },
})

// Cheap + idempotent spec -> long-take render-format conversion. Split from
// generation so a convert failure retries without re-running the ~5-min LLMs.
export const { convertUipFastToLongTakeArtifactsActivity } = proxyActivitiesWrapper<
  typeof activities
>({
  startToCloseTimeout: '2 minutes',
  heartbeatTimeout: '60 seconds',
  retry: {
    maximumAttempts: 3,
    initialInterval: '5 seconds',
    maximumInterval: '30 seconds',
  },
})

export const { generateLongTakeVoiceover } = proxyActivitiesWrapper<typeof activities>({
  startToCloseTimeout: '20 minutes',
  heartbeatTimeout: '120 seconds',
  retry: {
    maximumAttempts: 3,
    initialInterval: '10 seconds',
    maximumInterval: '2 minutes',
  },
})

// BGM bed generation (director LLM + Lyria synthesis + ffmpeg duration match).
// Generation-grade timeouts mirror generateLongTakeVoiceover. Registered for
// standalone/staging use; no workflow calls it yet (wiring is tracked separately).
export const { fitLongTakeBgmTrack, generateLongTakeBgmBed } = proxyActivitiesWrapper<
  typeof activities
>({
  startToCloseTimeout: '20 minutes',
  heartbeatTimeout: '120 seconds',
  retry: {
    maximumAttempts: 3,
    initialInterval: '10 seconds',
    maximumInterval: '2 minutes',
  },
})

// Split-voiceover path: dedicated activity for the LLM transcript correction
// step, so failures (gemini-2.5-pro DEADLINE_EXCEEDED, ABORT, segment-merging
// drift) surface as their own activity instead of being buried inside
// generateLongTakeVoiceover. Called from runVoiceoverStage immediately after
// generateLongTakeVoiceover (the split path is unconditional).
export const { correctLongTakeTranscript } = proxyActivitiesWrapper<typeof activities>({
  startToCloseTimeout: '15 minutes',
  heartbeatTimeout: '120 seconds',
  retry: {
    maximumAttempts: 3,
    initialInterval: '10 seconds',
    maximumInterval: '2 minutes',
  },
})

export async function generateLongTakeAnchorAssets(
  ...args: Parameters<ImageApiActivities['generateLongTakeAnchorAssets']>
): ReturnType<ImageApiActivities['generateLongTakeAnchorAssets']> {
  return await getImageApiActivities().generateLongTakeAnchorAssets(...args)
}

export async function generateLongTakeKeyframe(
  ...args: Parameters<ImageApiActivities['generateLongTakeKeyframe']>
): ReturnType<ImageApiActivities['generateLongTakeKeyframe']> {
  return await getImageApiActivities().generateLongTakeKeyframe(...args)
}

export async function generateLongTakeSingleRawAnchorAsset(
  ...args: Parameters<ImageApiActivities['generateLongTakeSingleRawAnchorAsset']>
): ReturnType<ImageApiActivities['generateLongTakeSingleRawAnchorAsset']> {
  return await getImageApiActivities().generateLongTakeSingleRawAnchorAsset(...args)
}

export const { buildPhotoPanZoomTransition } = proxyActivitiesWrapper<typeof activities>({
  // Pure ffmpeg (supersampled zoompan) + storage upload. Heavier than the
  // static-hold crossfade but still local synthesis; 3 attempts cover
  // transient upload / network blips.
  startToCloseTimeout: '3 minutes',
  heartbeatTimeout: '60 seconds',
  retry: {
    maximumAttempts: 3,
    initialInterval: '5 seconds',
    maximumInterval: '30 seconds',
  },
})

export const { buildStaticHoldTransition } = proxyActivitiesWrapper<typeof activities>({
  // Pure ffmpeg + storage upload. Should complete in <30s; allow headroom for a
  // slow storage round-trip. 3 attempts cover transient upload / network blips.
  startToCloseTimeout: '2 minutes',
  heartbeatTimeout: '60 seconds',
  retry: {
    maximumAttempts: 3,
    initialInterval: '5 seconds',
    maximumInterval: '30 seconds',
  },
})

export async function generateLongTakeTransitionVideo(
  ...args: Parameters<VideoApiActivities['generateLongTakeTransitionVideo']>
): ReturnType<VideoApiActivities['generateLongTakeTransitionVideo']> {
  return await getVideoApiActivities().generateLongTakeTransitionVideo(...args)
}

/** The rewritten prompt for one chained transition, prepared from its planned keyframes. */
export async function prepareLongTakeTransitionPrompt(
  ...args: Parameters<VideoApiActivities['prepareLongTakeTransitionPrompt']>
): ReturnType<VideoApiActivities['prepareLongTakeTransitionPrompt']> {
  return await getVideoApiActivities().prepareLongTakeTransitionPrompt(...args)
}

// Render on the workflow queue.
let renderLongTakeVideoOnWorkflowQueue: Pick<typeof activities, 'renderLongTakeVideo'> | undefined

export async function renderLongTakeVideo(
  ...args: Parameters<typeof activities.renderLongTakeVideo>
): ReturnType<typeof activities.renderLongTakeVideo> {
  if (!renderLongTakeVideoOnWorkflowQueue) {
    renderLongTakeVideoOnWorkflowQueue = proxyActivitiesWrapper<
      Pick<typeof activities, 'renderLongTakeVideo'>
    >({
      startToCloseTimeout: '2 hours',
      heartbeatTimeout: '120 seconds',
      retry: {
        maximumAttempts: 4,
        initialInterval: '30 seconds',
        backoffCoefficient: 3,
        maximumInterval: '5 minutes',
      },
    })
  }
  return await renderLongTakeVideoOnWorkflowQueue.renderLongTakeVideo(...args)
}

function getImageApiActivities(): ImageApiActivities {
  const ctx = getWorkflowScopedContext()
  const tier = ctx?.storyModeAdmissionTier ?? 'paid'
  const taskQueue = getStoryModeImageApiTaskQueue(workflowInfo().taskQueue)
  const cacheKey = `${taskQueue}:${tier}`
  const existing = imageApiActivitiesByTaskQueue.get(cacheKey)
  if (existing) {
    return existing
  }

  const created = proxyActivitiesWrapper<ImageApiActivities>({
    priority: { fairnessWeight: tier === 'paid' ? PAID_FAIRNESS_WEIGHT : FREE_FAIRNESS_WEIGHT },
    taskQueue,
    startToCloseTimeout: '20 minutes',
    heartbeatTimeout: '120 seconds',
    retry: {
      maximumAttempts: 3,
      initialInterval: '10 seconds',
      maximumInterval: '2 minutes',
    },
  })
  imageApiActivitiesByTaskQueue.set(cacheKey, created)
  return created
}

function getVideoApiActivities(): VideoApiActivities {
  const ctx = getWorkflowScopedContext()
  const tier = ctx?.storyModeAdmissionTier ?? 'paid'
  const taskQueue = getStoryModeVideoApiTaskQueue(workflowInfo().taskQueue)
  const cacheKey = `${taskQueue}:${tier}`
  const existing = videoApiActivitiesByTaskQueue.get(cacheKey)
  if (existing) {
    return existing
  }

  const created = proxyActivitiesWrapper<VideoApiActivities>({
    priority: { fairnessWeight: tier === 'paid' ? PAID_FAIRNESS_WEIGHT : FREE_FAIRNESS_WEIGHT },
    taskQueue,
    startToCloseTimeout: '2 hours',
    heartbeatTimeout: '120 seconds',
    retry: {
      maximumAttempts: 4,
      initialInterval: '30 seconds',
      backoffCoefficient: 3,
      maximumInterval: '5 minutes',
    },
  })
  videoApiActivitiesByTaskQueue.set(cacheKey, created)
  return created
}

export const { tryAcquireCapacityActivity, releaseCapacityActivity } = proxyActivitiesWrapper<
  typeof activities
>({
  startToCloseTimeout: '30 seconds',
  retry: {
    maximumAttempts: 2,
    initialInterval: '1 second',
    maximumInterval: '5 seconds',
  },
})

export const { detectLongTakeGibberishText } = proxyActivitiesWrapper<typeof activities>({
  startToCloseTimeout: '10 minutes',
  heartbeatTimeout: '180 seconds',
  retry: {
    maximumAttempts: 2,
    initialInterval: '1 second',
    maximumInterval: '5 seconds',
  },
})
