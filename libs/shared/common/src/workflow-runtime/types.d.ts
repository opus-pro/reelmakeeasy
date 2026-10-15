import { TraceInfo } from '@shared/types/api/req-ctx'
import { Sinks } from '@reelmakeeasy/workflow-engine/workflow'

export interface WorkflowSinks extends Sinks {
  tracer: WorkflowTracer
}

export type WorkflowTracer = {
  errMainFlow: (err?: Error) => void
  errSpan: (spanId?: string, err?: Error) => void
  /** End the main workflow's span */
  finishMainFlow: () => void
  /** End the specific span */
  finishSpan: (spanId?: string) => void
  /** Start the main workflow's span */
  startMainFlow: (traceInfo: TraceInfo | undefined, extTags?: Record<string, string>) => void
}
