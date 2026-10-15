import { ProjectStage, ProjectTier } from '@shared/types/api/project'
import { ReqContext } from '@shared/types/api/req-ctx'

export type TaskContext = {
  modelSwitch?: Record<string, Record<string, string>>
  projectId: string
  projectStage?: ProjectStage
  projectTier?: ProjectTier
  requestContext?: ReqContext
}
export type TaskRequest<P extends object, C extends TaskContext = TaskContext> = {
  context: C
  payload: P
}
export type TaskResponse<R extends object = object> = {
  data: R
}

export type WorkflowDef<N = string, A = TaskRequest<P, C>, R = unknown> = {
  arg: A
  name: N
  response?: R
}
