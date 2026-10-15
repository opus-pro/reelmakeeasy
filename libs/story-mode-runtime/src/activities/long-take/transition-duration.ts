import { RETIME_MIN_SPEED_MULTIPLIER } from '@reelmakeeasy/common/utils/retime-constants'
import { getMaxSupportedVideoDurationSeconds } from '@reelmakeeasy/common/video-models/registry'
import { ApplicationFailure } from '@reelmakeeasy/workflow-engine/activity'

export function assertMergedTransitionDurationCompatible(params: {
  actualModel: string
  seedance25MergedSegment?: boolean
  targetDuration: number
  transitionId: string
}): void {
  if (!params.seedance25MergedSegment) {
    return
  }

  const maxModelDuration = getMaxSupportedVideoDurationSeconds(params.actualModel)
  const maxCoverableDuration = maxModelDuration / RETIME_MIN_SPEED_MULTIPLIER
  if (params.targetDuration <= maxCoverableDuration) {
    return
  }
  throw ApplicationFailure.nonRetryable(
    `[long-take] Merged transition ${params.transitionId} requires ${params.targetDuration}s, but ${params.actualModel} can cover at most ${maxCoverableDuration}s without padding`,
    'MergedTransitionDurationIncompatible',
  )
}
