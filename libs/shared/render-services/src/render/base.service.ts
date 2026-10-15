import { AbstractService, TaskQueueOptions } from '../runtime/abstract'

export const RENDER_TASK_QUEUE = 'render'

/**
 * Base service shared across all render workflow groups.
 * Holds the task queue config common to every group.
 */
export class RenderBaseService extends AbstractService {
  override taskQueueOptions: TaskQueueOptions = { name: RENDER_TASK_QUEUE }
}
