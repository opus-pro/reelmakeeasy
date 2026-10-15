import type { ReqContext, TraceInfo } from '@shared/types/api/req-ctx'

export type { ReqContext, TraceInfo }

export type BaseJobContext = {
  cluster?: string
  requestContext?: ReqContext
  runId: string
  traceInfo?: TraceInfo
}

export type TaskRequest<Payload extends object, Context extends BaseJobContext = BaseJobContext> = {
  context: Context
  payload: Payload
}

export type TaskResponse<Data extends object> = {
  data: Data
}

export type CompatibleTaskRequest<
  Payload extends object,
  Context extends BaseJobContext = BaseJobContext,
> = (Partial<Context> & Payload) | TaskRequest<Payload, Context>

export type CompatibleTaskResponse<Data extends object> = Data | TaskResponse<Data>
