import { createClient } from '@reelmakeeasy/common/workflow/client'
import { CancelledFailure, TerminatedFailure } from '@reelmakeeasy/workflow-engine/common'

/**
 * How a workflow the agent started ended, in words the agent can act on. Shared by the edit
 * tools, which wait for their run and answer with its failure, and by the loop start, whose
 * run ends after the agent's turn: its failure reaches the agent in a turn of its own.
 */

/** Stops a workflow a tool was waiting on (the user pressed Stop, or the wait timed out). */
export async function cancelWorkflow(workflowId: string): Promise<void> {
  const client = await createClient()
  await client.workflow.getHandle(workflowId).cancel()
}

/** Resolves with the workflow's result; rejects when it fails, or after `timeoutMs` (if set). */
export async function waitForWorkflow(workflowId: string, timeoutMs?: number): Promise<unknown> {
  const client = await createClient()
  const handle = client.workflow.getHandle(workflowId)
  if (timeoutMs === undefined) return handle.result()
  const minutes = Math.round(timeoutMs / 60_000)
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      handle.result(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Timed out after ${minutes} minutes.`)),
          timeoutMs,
        )
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Why a workflow failed, in its own words. The engine wraps the reason ("Workflow execution
 * failed", then "Activity task failed", then the reason), and the reason is what the agent can
 * act on: a narration too long, a clip that failed its checks, a safety block.
 */
export function failureReason(error: unknown): string {
  let current: unknown = error
  while (
    current instanceof Error &&
    current.cause instanceof Error &&
    current.cause.message.trim()
  ) {
    current = current.cause
  }
  return current instanceof Error && current.message ? current.message : 'unknown error'
}

/** The run was stopped (cancelled or terminated), not failed: nothing to tell anyone. */
export function wasStopped(error: unknown): boolean {
  let current: unknown = error
  while (current instanceof Error) {
    if (current instanceof CancelledFailure || current instanceof TerminatedFailure) return true
    current = current.cause
  }
  return false
}
