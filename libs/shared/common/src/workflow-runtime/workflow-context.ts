import { getRunLocal, inWorkflowContext, setRunLocal } from '@reelmakeeasy/workflow-engine/workflow'
import { pick } from 'lodash-es'

import type { SharedJobContext } from '../job-context'
import type { LongTakeAdmissionTier } from '../long-take/types'

/**
 * Workflow-scoped context type
 * Subset of SharedJobContext fields that are relevant for workflow -> activity propagation
 */
export type WorkflowScopedContext = Pick<
  SharedJobContext,
  | 'aoProjectEnv'
  | 'conversationId'
  | 'evalMode'
  | 'modelSwitch'
  | 'projectId'
  | 'projectTier'
  | 'sandboxId'
  | 'userEmail'
  | 'userId'
> & {
  storyModeAdmissionTier?: LongTakeAdmissionTier
}

const RUN_LOCAL_KEY = Symbol('workflow-scoped-context')

// Outside a workflow run (unit tests, scripts) the context is process-wide.
let fallbackContext: null | WorkflowScopedContext = null

function readContext(): null | WorkflowScopedContext {
  return inWorkflowContext()
    ? (getRunLocal<WorkflowScopedContext>(RUN_LOCAL_KEY) ?? null)
    : fallbackContext
}

export function getWorkflowScopedContext(): null | WorkflowScopedContext {
  const ctx = readContext()
  return ctx ? { ...ctx } : null
}

export function pickContextFromWorkflow(
  fields: (keyof WorkflowScopedContext)[] = ['sandboxId', 'evalMode', 'aoProjectEnv'],
): WorkflowScopedContext {
  const ctx = getWorkflowScopedContext()
  return ctx ? pick(ctx, fields) : {}
}

export function setWorkflowScopedContext(ctx: WorkflowScopedContext): void {
  if (inWorkflowContext()) setRunLocal(RUN_LOCAL_KEY, { ...ctx })
  else fallbackContext = { ...ctx }
}
