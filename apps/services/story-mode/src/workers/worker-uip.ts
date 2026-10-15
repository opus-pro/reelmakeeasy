// UIP V2 activities. Registered on the UIP task queue: the V2 proxies
// (createPlannerStepProxy / createToolActivitiesProxy / local activities) all
// resolve to workflowInfo().taskQueue, which is TASK_QUEUES.UIP. V1 activity
// registration was removed with the v1 workflow retirement.
import { wrapActivitiesWithContext } from '@reelmakeeasy/common/agent-v2/util/activity-context-wrapper'
import * as uipV2Activities from '@reelmakeeasy/story-mode-runtime/activities/uip-v2'
import { TASK_QUEUES } from '@reelmakeeasy/story-mode-runtime/constants'

export function getUipWorkerConfig() {
  return {
    activities: wrapActivitiesWithContext(uipV2Activities),
    baseTaskQueue: TASK_QUEUES.UIP,
    maxConcurrentActivityTaskExecutions: 40,
    maxConcurrentWorkflowTaskExecutions: 20,
    maxConcurrentWorkflowTaskPolls: 5,
  }
}
