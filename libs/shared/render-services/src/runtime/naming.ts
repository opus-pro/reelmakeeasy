import { workflowInfo } from '@reelmakeeasy/workflow-engine/workflow'

/**
 * Workflow ID helpers for code running inside a workflow.
 *
 * For building workflow IDs from service/client code, use your project's own
 * workflow-id utilities.
 */

/** Append child workflow type (and optional taskId) to the current workflow's ID */
export function getChildWorkflowID(workflowType: string, taskId?: string): string {
  const currentWorkflowId = workflowInfo().workflowId
  const suffix = taskId ? `:${taskId}` : ''
  return `${currentWorkflowId}:${workflowType}${suffix}`
}
