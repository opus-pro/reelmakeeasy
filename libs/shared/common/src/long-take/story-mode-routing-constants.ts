export const STORY_MODE_WORKFLOW_NAME = 'StoryMode'

export const STORY_MODE_STANDALONE_TASK_QUEUE = 'ao-story-mode'
export const STORY_MODE_ADMISSION_TASK_QUEUE = `${STORY_MODE_STANDALONE_TASK_QUEUE}-admission`
export const STORY_MODE_IMAGE_API_TASK_QUEUE = `${STORY_MODE_STANDALONE_TASK_QUEUE}-image-api`
export const STORY_MODE_VIDEO_API_TASK_QUEUE = `${STORY_MODE_STANDALONE_TASK_QUEUE}-video-api`

export const STORY_MODE_ADMISSION_START_SIGNAL = 'storyModeAdmissionStart'
const ADMISSION_CONTROLLER_NAME = {
  LEGACY: 'storyModeAdmissionControllerWorkflow',
  NEW: 'AdmissionControl',
}
/**
 * Keep starting the controller with the legacy workflow type during rollout.
 * New workers export both names, while older workers only know the legacy one.
 */
export const SM_ADMISSION_CONTROLLER_WORKFLOW = ADMISSION_CONTROLLER_NAME.LEGACY

export function getStoryModeAdmissionTaskQueue(taskQueue: string): string {
  return taskQueue.replace(STORY_MODE_STANDALONE_TASK_QUEUE, STORY_MODE_ADMISSION_TASK_QUEUE)
}

export function getStoryModeImageApiTaskQueue(taskQueue: string): string {
  return taskQueue.replace(STORY_MODE_STANDALONE_TASK_QUEUE, STORY_MODE_IMAGE_API_TASK_QUEUE)
}

export function getStoryModeVideoApiTaskQueue(taskQueue: string): string {
  return taskQueue.replace(STORY_MODE_STANDALONE_TASK_QUEUE, STORY_MODE_VIDEO_API_TASK_QUEUE)
}
