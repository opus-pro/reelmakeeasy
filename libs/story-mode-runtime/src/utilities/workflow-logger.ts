import { log as workflowLog, workflowInfo } from '@reelmakeeasy/workflow-engine/workflow'

export interface WorkflowLogger {
  error: (msg: string, extra?: Extra) => void
  info: (msg: string, extra?: Extra) => void
  warn: (msg: string, extra?: Extra) => void
}

type Extra = Record<string, unknown>

/**
 * Workflow logger for story-mode workflows.
 * Automatically injects project-scoped metadata into every log entry:
 * - projectId
 * - userId (when provided)
 * - workflowId / workflowRunId (from workflowInfo)
 *
 * Deliberately no userEmail: it is PII and must not ride on log attributes.
 * userId is the stable pseudonymous key for correlating a run to an account.
 */
export function createWorkflowLogger(params: {
  projectId: string
  userId?: string
}): WorkflowLogger {
  const info = workflowInfo()
  const base = {
    projectId: params.projectId,
    userId: params.userId,
    workflowId: info.workflowId,
    workflowRunId: info.runId,
  }

  return {
    info(message: string, extra?: Extra) {
      workflowLog.info(message, { ...base, ...extra })
    },
    warn(message: string, extra?: Extra) {
      workflowLog.warn(message, { ...base, ...extra })
    },
    error(message: string, extra?: Extra) {
      workflowLog.error(message, { ...base, ...extra })
    },
  }
}
