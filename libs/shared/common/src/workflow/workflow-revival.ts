import { WorkflowNotFoundError } from '@reelmakeeasy/workflow-engine/common'

/**
 * Wraps a workflow operation with automatic workflow revival: if the operation
 * fails because the execution is gone (terminated, cancelled, or never
 * started), the workflow is restarted and the operation is retried once. Any
 * other error is rethrown immediately.
 */
export async function withWorkflowRevival<T>(
  workflowId: string,
  startFn: () => Promise<void>,
  operation: () => Promise<T>,
): Promise<T> {
  try {
    return await operation()
  } catch (firstError) {
    if (!(firstError instanceof WorkflowNotFoundError)) {
      throw firstError
    }

    await startFn()

    return await operation()
  }
}
