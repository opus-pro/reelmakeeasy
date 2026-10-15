/**
 * Activity context wrapper for V2 architecture
 * Automatically injects context fields into JobContext for logging:
 * - Basic: projectId, userId, userEmail, projectTier, activityName, workflowId
 * - Workflow-scoped: conversationId, sandboxId, modelSwitch
 *
 * Works seamlessly with proxyActivitiesWithWorkflowContext from workflow-tracer.ts,
 * which injects workflow-scoped context into activity arguments on the workflow side.
 *
 * Usage in V2 worker:
 *   import { wrapActivitiesWithContext } from '@reelmakeeasy/common/agent-v2/util/activity-context-wrapper'
 *   const wrappedActivities = wrapActivitiesWithContext(activities)
 */
import { Context } from '@reelmakeeasy/workflow-engine/activity'
import { z } from 'zod'

import { JobContext, SharedJobContext, SharedJobContextSchema } from '../../job-context'
import { logger } from '../../logger'
import { zodGetKeys } from '../../zod-helpers/get-keys'

/** Keys that can be extracted from activity arguments */
const EXTRACTABLE_CONTEXT_KEYS = zodGetKeys(SharedJobContextSchema) as (keyof z.infer<
  typeof SharedJobContextSchema
>)[]

/** All context keys including those added by the wrapper (activityName, workflowId) */
const ALL_CONTEXT_KEYS: (keyof SharedJobContext)[] = [
  ...EXTRACTABLE_CONTEXT_KEYS,
  'activityName',
  'workflowId',
]

type ActivityFunction = (...args: unknown[]) => Promise<unknown> | unknown
/**
 * Extract job context from activity arguments.
 * Supports V2 argument formats:
 * - { projectId, userId, userEmail, ... }
 * - 'projectId' (string directly)
 *
 * Uses ExtractableContextSchema to parse and validate fields.
 */
function extractJobContext(args: unknown[]): Partial<SharedJobContext> {
  if (!args || args.length === 0) {
    return {}
  }

  const firstArg = args[0]
  // Handle object argument - extract fields defined in schema
  if (typeof firstArg === 'object' && firstArg !== null) {
    // v2: standard context & payload in input object
    const hasPayloadField = 'payload' in firstArg
    const hasContextField = 'context' in firstArg
    const raw = (() => {
      // input = { context, payload }
      if (hasPayloadField) {
        const arg = firstArg as { context?: object; payload?: object }
        return { ...arg.payload, ...arg.context }
      }
      if (hasContextField) {
        const arg = firstArg as { context?: object }
        return { ...firstArg, ...arg.context }
      }
      return firstArg
    })()

    const result = SharedJobContextSchema.safeParse(raw)
    if (result.success) {
      // Filter out undefined values
      return Object.fromEntries(
        Object.entries(result.data).filter(([, v]) => v !== undefined),
      ) as Partial<SharedJobContext>
    }
  }

  return {}
}

/**
 * Wrap a single activity function with JobContext injection for logging
 */
function wrapActivity(activityFn: ActivityFunction, activityName: string): ActivityFunction {
  return async (...args: unknown[]) => {
    const jobCtx = extractJobContext(args)
    // Always add activityName to context
    jobCtx.activityName = activityName

    // Extract workflowId from the activity context
    try {
      const ctx = Context.current()
      const workflowId = ctx.info.workflowExecution.workflowId
      jobCtx.workflowId = workflowId
    } catch {
      // Not running inside an activity context (e.g. unit tests) - ignore
    }

    const hasCtx = ALL_CONTEXT_KEYS.some((key) => jobCtx[key] !== undefined)

    if (hasCtx) {
      return await JobContext.run(jobCtx, async () => {
        // NOTE: This log is inside JobContext.run so that logger.mixin()
        // can inject structured fields like projectId/userId/workflowId into the log record.
        // All fields in JobContext are automatically injected via logger.mixin(), no need to manually add them
        logger.info(`[V2 Activity] Running ${activityName}`)
        return await activityFn(...args)
      })
    }

    // No context found, run without JobContext wrapper
    return await activityFn(...args)
  }
}

/**
 * Wrap all activities in an object with JobContext injection
 * Use this in V2 workers to automatically inject projectId into logs
 *
 * @example
 * // In worker.ts
 * import * as activities from './activities'
 * import { wrapActivitiesWithContext } from '@reelmakeeasy/common/agent-v2/util/activity-context-wrapper'
 *
 * const wrappedActivities = wrapActivitiesWithContext(activities)
 * // Then use wrappedActivities with consumeActivitiesWrapper
 */
export function wrapActivitiesWithContext<T extends Record<string, unknown>>(activities: T): T {
  const wrapped: Record<string, unknown> = {}

  for (const [name, fnOrValue] of Object.entries(activities)) {
    if (typeof fnOrValue === 'function') {
      wrapped[name] = wrapActivity(fnOrValue as ActivityFunction, name)
    } else {
      wrapped[name] = fnOrValue
    }
  }

  return wrapped as T
}
