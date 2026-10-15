import { STORY_MODE_ADMISSION_TASK_QUEUE } from '@reelmakeeasy/common/long-take/story-mode-routing-constants'
import type {
  AdmissionControlConfig,
  AdmissionControlParams,
  StoryModeAdmissionCycleResult,
} from '@reelmakeeasy/common/workflow/workflow/story-mode/types'
import { getGlobalWorkflowId } from '@reelmakeeasy/common/workflow/workflow-id'
import {
  AbstractService,
  DefineActivity,
  DefineWorkflow,
  TaskQueueOptions,
} from '@shared/render-services/runtime/workflow'

export { STORY_MODE_ADMISSION_TASK_QUEUE }

export class StoryModeAdmissionService extends AbstractService {
  override taskQueueOptions: TaskQueueOptions = {
    name: STORY_MODE_ADMISSION_TASK_QUEUE,
  }
  public override workflowNameMap = {
    Legacy_storyModeAdmissionControllerWorkflow: 'storyModeAdmissionControllerWorkflow',
  }

  static generateWorkflowId(taskQueue: string) {
    return getGlobalWorkflowId('system', 'story-mode-admission', taskQueue)
  }

  @DefineWorkflow()
  async AdmissionControl(payload: AdmissionControlParams): Promise<void> {
    return this.executeFromInstance('AdmissionControl', payload)
  }

  // Type-only alias - body never executes. proxyWorkflows reads @DefineWorkflow({ workflowType })
  // and submits 'storyModeAdmissionControllerWorkflow' directly, so runs keep the legacy name.
  @DefineWorkflow()
  async Legacy_storyModeAdmissionControllerWorkflow(
    _payload: AdmissionControlParams,
  ): Promise<void> {
    return void 0
  }

  @DefineActivity({
    retry: {
      initialInterval: '1 second',
      maximumAttempts: 3,
      maximumInterval: '10 seconds',
    },
    startToCloseTimeout: '5 minutes',
  })
  runStoryModeAdmissionCycleActivity(
    payload: AdmissionControlConfig,
  ): Promise<StoryModeAdmissionCycleResult> {
    return this.executeFromInstance('runStoryModeAdmissionCycleActivity', payload)
  }

  /** legacy for backward compatibility */
  @DefineWorkflow()
  async storyModeAdmissionControllerWorkflow(payload: AdmissionControlParams): Promise<void> {
    return this.executeFromInstance('storyModeAdmissionControllerWorkflow', payload)
  }
}

/** No admission controller runs in this app, so every run starts at once. */
export function getIgnoredAdmissionControl(): boolean {
  return true
}
