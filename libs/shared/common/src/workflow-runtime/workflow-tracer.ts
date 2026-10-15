import { TraceInfo } from '@shared/types/api/req-ctx'
import {
  ActivityOptions,
  UntypedActivities,
  WithWorkflowArgs,
  Workflow,
  WorkflowResultType,
} from '@reelmakeeasy/workflow-engine/common'
import * as workflow from '@reelmakeeasy/workflow-engine/workflow'
import {
  ChildWorkflowOptions,
  executeChild,
  isCancellation,
  proxyActivities,
  proxyLocalActivities,
  scheduleActivity,
  WorkflowInfo,
  workflowInfo,
} from '@reelmakeeasy/workflow-engine/workflow'

import { ensureError } from '../utils/error-handler'

import { WorkflowSinks } from './types'
import { getWorkflowScopedContext } from './workflow-context'

export {
  getWorkflowScopedContext,
  setWorkflowScopedContext,
  type WorkflowScopedContext,
} from './workflow-context'

export function getTags(args: undefined | unknown[]): Record<string, string> {
  if (!args) {
    return {}
  }
  const tags: Record<string, string> = {}
  if (args.length > 0 && isRecord(args[0])) {
    const arg = args[0] as Record<string, unknown>
    const projectId =
      (arg['projectId'] as string | undefined) || (arg['project_id'] as string | undefined)
    if (projectId) {
      tags['ao.projectId'] = projectId
    }

    const projectTier =
      (arg['projectTier'] as string | undefined) || (arg['project_tier'] as string | undefined)
    if (projectTier) {
      tags['ao.projectTier'] = projectTier
    }
  }
  return tags
}

export function proxyActivitiesWrapper<T = UntypedActivities>(
  options: Parameters<typeof proxyActivities<T>>[0],
): T {
  const base = proxyActivities<T>(options)
  const excluded = new Set<string>(['genChildSpan'])

  const tracer = workflow.proxySinks<WorkflowSinks>().tracer
  return new Proxy(base as object, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver)
      if (typeof prop !== 'string' || excluded.has(prop) || typeof value !== 'function') {
        return value
      }
      return async (...args: unknown[]) => {
        const childSpan = await callGenChildSpan(
          workflowInfo(),
          `activity.${prop}.publish`,
          getTags(args),
        )

        const ctx = getWorkflowScopedContext()
        const requestCtx = {
          ...ctx,
          _x_reelmakeeasy_req_ctx: 'v1',
          tracer: childSpan,
        }

        try {
          const callable = value as (...a: unknown[]) => Promise<unknown> | unknown
          return await callable(...args, requestCtx)
        } catch (e: unknown) {
          tracer.errSpan(childSpan?.spanId, ensureError(e))
          throw e
        } finally {
          tracer.finishSpan(childSpan?.spanId)
        }
      }
    },
  }) as T
}

export function proxyLocalActivitiesWrapper<T = UntypedActivities>(
  options: Parameters<typeof proxyLocalActivities<T>>[0],
): T {
  const base = proxyLocalActivities<T>(options)
  const excluded = new Set<string>(['genChildSpan'])

  const tracer = workflow.proxySinks<WorkflowSinks>().tracer
  return new Proxy(base as object, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver)
      if (typeof prop !== 'string' || excluded.has(prop) || typeof value !== 'function') {
        return value
      }
      return async (...args: unknown[]) => {
        const childSpan = await callGenChildSpan(
          workflowInfo(),
          `activity.${prop}.publish`,
          getTags(args),
        )

        const ctx = getWorkflowScopedContext()
        const requestCtx = {
          ...ctx,
          _x_reelmakeeasy_req_ctx: 'v1',
          tracer: childSpan,
        }

        try {
          const callable = value as (...a: unknown[]) => Promise<unknown> | unknown
          return await callable(...args, requestCtx)
        } catch (e: unknown) {
          tracer.errSpan(childSpan?.spanId, ensureError(e))
          throw e
        } finally {
          tracer.finishSpan(childSpan?.spanId)
        }
      }
    },
  }) as T
}

/** Distributed tracing is not wired in ReelMakeEasy; spans resolve to undefined. */
function callGenChildSpan(
  _info: WorkflowInfo,
  _childName: string,
  _tags: Record<string, string>,
): Promise<TraceInfo | undefined> {
  return Promise.resolve(undefined)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

// Overloads mirror @reelmakeeasy/workflow-engine/workflow executeChild for proper inference
export async function traceExecuteChild<T extends Workflow>(
  workflowType: string | T,
  options: WithWorkflowArgs<T, ChildWorkflowOptions>,
): Promise<WorkflowResultType<T>> {
  const tracer = workflow.proxySinks<WorkflowSinks>().tracer
  let name = ''
  if (typeof workflowType === 'string') {
    name = `workflow.${workflowType}.publish`
  } else {
    name = `workflow.${(workflowType as Workflow).name}.publish`
  }
  const childSpan = await callGenChildSpan(
    workflowInfo(),
    name,
    getTags((options.args ?? []) as unknown[]),
  )

  const marker = { _x_reelmakeeasy_req_ctx: 'v1', tracer: childSpan }
  const argsWithMarker = [...(options.args ?? []), marker]
  const optionsWithMarker = { ...options, args: argsWithMarker }

  try {
    if (typeof workflowType === 'string') {
      return await executeChild(workflowType, optionsWithMarker)
    }
    return await executeChild(workflowType, optionsWithMarker)
  } catch (e: unknown) {
    tracer.errSpan(childSpan?.spanId, ensureError(e))
    throw e
  } finally {
    tracer.finishSpan(childSpan?.spanId)
  }
}

export async function traceScheduleActivity<R>(
  activityType: string,
  args: unknown[],
  options: ActivityOptions,
): Promise<R> {
  const tracer = workflow.proxySinks<WorkflowSinks>().tracer
  const childSpan = await callGenChildSpan(
    workflowInfo(),
    `activity.${activityType}.publish`,
    getTags(args),
  )
  const requestCtx = {
    _x_reelmakeeasy_req_ctx: 'v1',
    tracer: childSpan,
  }
  try {
    return await scheduleActivity(activityType, [...args, requestCtx], options)
  } catch (e: unknown) {
    tracer.errSpan(childSpan?.spanId, ensureError(e))
    throw e
  } finally {
    tracer.finishSpan(childSpan?.spanId)
  }
}
