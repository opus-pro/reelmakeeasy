export {
  STORY_MODE_STANDALONE_TASK_QUEUE,
  STORY_MODE_WORKFLOW_NAME,
} from '@reelmakeeasy/common/long-take/story-mode-routing-constants'
import { logger } from '@reelmakeeasy/common/logger'
import {
  getStoryModeAdmissionTaskQueue,
  getStoryModeImageApiTaskQueue,
  getStoryModeVideoApiTaskQueue,
  STORY_MODE_STANDALONE_TASK_QUEUE,
} from '@reelmakeeasy/common/long-take/story-mode-routing-constants'
import { getEnvKeysAsPositiveInt } from '@reelmakeeasy/common/utils/env.util'

// worker name
const MAIN_WORKER_NAME = 'story-mode-workflow-worker'
const ADMISSION_WORKER_NAME = 'story-mode-admission-worker'
const IMAGE_API_WORKER_NAME = 'story-mode-image-api-worker'
const VIDEO_API_WORKER_NAME = 'story-mode-video-api-worker'
const UIP_WORKER_NAME = 'uip-workflow-worker'
const BRAND_EXTRACTION_WORKER_NAME = 'brand-extraction-workflow-worker'
export const WORKER_NAMES = {
  MAIN: MAIN_WORKER_NAME,
  ADMISSION: ADMISSION_WORKER_NAME,
  IMAGE_API: IMAGE_API_WORKER_NAME,
  VIDEO_API: VIDEO_API_WORKER_NAME,
  UIP: UIP_WORKER_NAME,
  BRAND_EXTRACTION: BRAND_EXTRACTION_WORKER_NAME,
} as const

export type StoryModeWorker = (typeof WORKER_NAMES)[keyof typeof WORKER_NAMES]

// Every worker runs in this process, so the queue names are fixed.
const UIP_WORKFLOW_TASK_QUEUE = 'uip-dev'
// Base queue name. `resolveTaskQueueForClient` / `resolveTaskQueueForWorker`
// use it as-is.
export const BRAND_EXTRACTION_BASE_TASK_QUEUE = 'brand-extraction'
const BRAND_EXTRACTION_TASK_QUEUE = BRAND_EXTRACTION_BASE_TASK_QUEUE
const STORY_MODE_WORKFLOW_TASK_QUEUE = STORY_MODE_STANDALONE_TASK_QUEUE
const STORY_MODE_ADMISSION_TASK_QUEUE = getStoryModeAdmissionTaskQueue(
  STORY_MODE_WORKFLOW_TASK_QUEUE,
)
const STORY_MODE_IMAGE_API_TASK_QUEUE = getStoryModeImageApiTaskQueue(
  STORY_MODE_WORKFLOW_TASK_QUEUE,
)
const STORY_MODE_VIDEO_API_TASK_QUEUE = getStoryModeVideoApiTaskQueue(
  STORY_MODE_WORKFLOW_TASK_QUEUE,
)

export const TASK_QUEUES = {
  MAIN: STORY_MODE_WORKFLOW_TASK_QUEUE,
  ADMISSION: STORY_MODE_ADMISSION_TASK_QUEUE,
  IMAGE_API: STORY_MODE_IMAGE_API_TASK_QUEUE,
  VIDEO_API: STORY_MODE_VIDEO_API_TASK_QUEUE,
  UIP: UIP_WORKFLOW_TASK_QUEUE,
  BRAND_EXTRACTION: BRAND_EXTRACTION_TASK_QUEUE,
} as const

const MAX_WORKFLOW_CONCURRENCY = 10
const MAX_ACTIVITY_CONCURRENCY = 300
export const MAX_TASK_QUEUE_ACTIVITIES_PER_SECOND = 200
export const MAX_ADMISSION_WORKFLOW_CONCURRENCY = 2
export const MAX_ADMISSION_ACTIVITY_CONCURRENCY = 10

export function getConfigs() {
  const workflowConcurrency = getEnvKeysAsPositiveInt({
    envKeys: ['CONCURRENCY_WORKFLOW'],
    fallback: MAX_WORKFLOW_CONCURRENCY,
    max: MAX_WORKFLOW_CONCURRENCY,
  })
  const workflowActivityConcurrency = getEnvKeysAsPositiveInt({
    envKeys: ['CONCURRENCY_ACTIVITY_WORKFLOW', 'CONCURRENCY_ACTIVITY'],
    fallback: MAX_ACTIVITY_CONCURRENCY,
    max: MAX_ACTIVITY_CONCURRENCY,
  })
  const imageActivityConcurrency = getEnvKeysAsPositiveInt({
    envKeys: ['CONCURRENCY_ACTIVITY_IMAGE', 'CONCURRENCY_ACTIVITY'],
    fallback: MAX_ACTIVITY_CONCURRENCY,
    max: MAX_ACTIVITY_CONCURRENCY,
  })
  return {
    workflowConcurrency,
    workflowActivityConcurrency,
    imageActivityConcurrency,
  } as const
}

export function initLogConfig() {
  const { imageActivityConcurrency, workflowActivityConcurrency, workflowConcurrency } =
    getConfigs()

  logger.info(
    {
      imageActivityConcurrency,
      workflowActivityConcurrency,
      workflowConcurrency,
      taskQueues: TASK_QUEUES,
    },
    '[story-mode-worker] Starting split workflow/admission/image/video workers',
  )
}

export function resolveVideoActivityConcurrency(): number {
  return getEnvKeysAsPositiveInt({
    envKeys: ['CONCURRENCY_ACTIVITY_VIDEO', 'CONCURRENCY_ACTIVITY'],
    fallback: MAX_ACTIVITY_CONCURRENCY,
    max: MAX_ACTIVITY_CONCURRENCY,
  })
}
