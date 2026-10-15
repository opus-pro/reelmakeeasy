import { releaseLongTakeSlot, setLongTakeStatus } from './activity-proxies'
import type { LongTakeSlotParams, LongTakeStatusStage } from './types'

type StatusContext = {
  projectId: string
  userEmail?: string
  userId: string
}

const LONG_TAKE_STAGE_ORDER: LongTakeStatusStage[] = [
  'script',
  'voiceover',
  'user_assets_understanding',
  'user_assets_analysis',
  'experts_analysis',
  'anchor_assets',
  'visual_script',
  'keyframe_prompts',
  'shot_plan',
  'keyframes',
  'transitions',
  'render',
  'completed',
]

export type LongTakeWorkflowLogFn = (message: string, fields?: Record<string, unknown>) => void

export type LongTakeWorkflowRuntime = {
  getCurrentStage: () => LongTakeStatusStage
  /** Frees the run's admission slot and in-flight entry once it has finished. */
  releaseSlot: (params: LongTakeSlotParams) => Promise<void>
  setStageCompleted: (params: {
    detail?: string
    meta?: Record<string, boolean | number | string>
    stage: LongTakeStatusStage
  }) => Promise<void>
  setStageInProgress: (params: {
    meta?: Record<string, number | string>
    stage: LongTakeStatusStage
  }) => Promise<void>
  setWorkflowError: (detail: string) => Promise<void>
  setWorkflowRejected: (detail: string) => Promise<void>
}

export async function createLongTakeWorkflowRuntime(params: {
  projectId: string
  userEmail?: string
  userId: string
}): Promise<LongTakeWorkflowRuntime> {
  const { projectId, userEmail, userId } = params
  const statusContext: StatusContext = { projectId, userEmail, userId }
  let currentStage: LongTakeStatusStage = 'started'
  let workflowFailed = false
  const inProgressStages = new Set<LongTakeStatusStage>()

  return {
    getCurrentStage: () => currentStage,
    setStageCompleted: async (stageParams) => {
      if (workflowFailed) {
        return
      }
      if (isLaterStage(stageParams.stage, currentStage)) {
        currentStage = stageParams.stage
      }
      inProgressStages.delete(stageParams.stage)
      const concurrentStages = [...inProgressStages]
      await setLongTakeStatus({
        ...statusContext,
        concurrentStages,
        detail: stageParams.detail,
        meta: stageParams.meta,
        stage: stageParams.stage,
        status: 'completed',
      })
    },
    setStageInProgress: async (stageParams) => {
      if (workflowFailed) {
        return
      }
      if (isLaterStage(stageParams.stage, currentStage)) {
        currentStage = stageParams.stage
      }
      inProgressStages.add(stageParams.stage)
      const concurrentStages = [...inProgressStages].filter((s) => s !== stageParams.stage)
      await setLongTakeStatus({
        ...statusContext,
        concurrentStages,
        meta: stageParams.meta,
        stage: stageParams.stage,
        status: 'in_progress',
      })
    },
    setWorkflowError: async (detail) => {
      workflowFailed = true
      currentStage = 'error'
      await setLongTakeStatus({
        ...statusContext,
        detail,
        stage: 'error',
        status: 'error',
      })
    },
    setWorkflowRejected: async (detail) => {
      workflowFailed = true
      currentStage = 'rejected'
      await setLongTakeStatus({
        ...statusContext,
        detail,
        stage: 'rejected',
        status: 'rejected',
      })
    },
    releaseSlot: async (slotParams) => {
      try {
        await releaseLongTakeSlot(slotParams)
      } catch {
        // A failed release must not block the final status update.
      }
    },
  }
}

function isLaterStage(candidate: LongTakeStatusStage, current: LongTakeStatusStage): boolean {
  const candidateIndex = LONG_TAKE_STAGE_ORDER.indexOf(candidate)
  const currentIndex = LONG_TAKE_STAGE_ORDER.indexOf(current)
  // Stages not in the order list (e.g. 'started') are always superseded.
  if (currentIndex === -1) {
    return true
  }
  if (candidateIndex === -1) {
    return false
  }
  return candidateIndex >= currentIndex
}
