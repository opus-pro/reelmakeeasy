import { wrapActivitiesWithContext } from '@reelmakeeasy/common/agent-v2/util/activity-context-wrapper'
import * as storyModeActivities from '@reelmakeeasy/story-mode-runtime/activities'
import {
  getConfigs,
  MAX_TASK_QUEUE_ACTIVITIES_PER_SECOND,
  TASK_QUEUES,
} from '@reelmakeeasy/story-mode-runtime/constants'

export function getMainWorkerConfig() {
  const { workflowActivityConcurrency, workflowConcurrency } = getConfigs()
  return {
    activities: wrapActivitiesWithContext(storyModeActivities),
    baseTaskQueue: TASK_QUEUES.MAIN,
    maxConcurrentActivityTaskExecutions: workflowActivityConcurrency,
    maxConcurrentWorkflowTaskExecutions: workflowConcurrency,
    maxConcurrentWorkflowTaskPolls: Math.max(2, Math.floor(workflowConcurrency / 2)),
    maxTaskQueueActivitiesPerSecond: MAX_TASK_QUEUE_ACTIVITIES_PER_SECOND,
  }
}
