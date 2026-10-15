import { wrapActivitiesWithContext } from '@reelmakeeasy/common/agent-v2/util/activity-context-wrapper'
import {
  generateLongTakeTransitionVideo,
  prepareLongTakeTransitionPrompt,
  renderLongTakeVideo,
} from '@reelmakeeasy/story-mode-runtime/activities'
import {
  MAX_TASK_QUEUE_ACTIVITIES_PER_SECOND,
  resolveVideoActivityConcurrency,
  TASK_QUEUES,
} from '@reelmakeeasy/story-mode-runtime/constants'

// TODO: Phase 3 - remove renderLongTakeVideo once patch is fully removed
const videoApiActivities = {
  generateLongTakeTransitionVideo,
  prepareLongTakeTransitionPrompt,
  renderLongTakeVideo,
}

export function getVideoApiWorkerConfig() {
  return {
    activities: wrapActivitiesWithContext(videoApiActivities),
    baseTaskQueue: TASK_QUEUES.VIDEO_API,
    maxConcurrentActivityTaskExecutions: resolveVideoActivityConcurrency(),
    maxTaskQueueActivitiesPerSecond: MAX_TASK_QUEUE_ACTIVITIES_PER_SECOND,
  }
}
