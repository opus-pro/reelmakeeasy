import { wrapActivitiesWithContext } from '@reelmakeeasy/common/agent-v2/util/activity-context-wrapper'
import * as articleExtractionActivities from '@reelmakeeasy/story-mode-runtime/activities/article-extraction'
import * as brandExtractionActivities from '@reelmakeeasy/story-mode-runtime/activities/brand-extraction'
import { TASK_QUEUES } from '@reelmakeeasy/story-mode-runtime/constants'

// Brand extraction worker config. Co-located with the rest of story-mode
// workers. Tight activity concurrency cap bounds Chromium memory -- crawls
// are heavy relative to the rest of the planner / UIP load. Article extraction
// registers here too: it shares the Playwright deployment and the
// same Chromium-bounded concurrency budget.
export function getBrandExtractionWorkerConfig() {
  return {
    activities: wrapActivitiesWithContext({
      ...brandExtractionActivities,
      ...articleExtractionActivities,
    }),
    baseTaskQueue: TASK_QUEUES.BRAND_EXTRACTION,
    maxConcurrentActivityTaskExecutions: 4,
    maxConcurrentWorkflowTaskExecutions: 8,
    maxConcurrentWorkflowTaskPolls: 2,
  }
}
