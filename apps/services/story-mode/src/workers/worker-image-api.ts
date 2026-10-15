import { wrapActivitiesWithContext } from '@reelmakeeasy/common/agent-v2/util/activity-context-wrapper'
import {
  generateLongTakeAnchorAssets,
  generateLongTakeKeyframe,
  generateLongTakeSingleRawAnchorAsset,
} from '@reelmakeeasy/story-mode-runtime/activities'
import {
  getConfigs,
  MAX_TASK_QUEUE_ACTIVITIES_PER_SECOND,
  TASK_QUEUES,
} from '@reelmakeeasy/story-mode-runtime/constants'

const imageApiActivities = {
  generateLongTakeAnchorAssets,
  generateLongTakeKeyframe,
  generateLongTakeSingleRawAnchorAsset,
}

export function getImageApiWorkerConfig() {
  const { imageActivityConcurrency } = getConfigs()
  return {
    activities: wrapActivitiesWithContext(imageApiActivities),
    baseTaskQueue: TASK_QUEUES.IMAGE_API,
    maxConcurrentActivityTaskExecutions: imageActivityConcurrency,
    maxTaskQueueActivitiesPerSecond: MAX_TASK_QUEUE_ACTIVITIES_PER_SECOND,
  }
}
