import { activityInfo, heartbeat } from '@reelmakeeasy/workflow-engine/activity'

import { parseCompatibleRequest } from './abstract'
import type { BaseJobContext, CompatibleTaskRequest, CompatibleTaskResponse } from './types'

const HEARTBEAT_INTERVAL_MS = 10_000

function isBareTaskResponse(value: unknown): value is { data: unknown } {
  return typeof value === 'object' && value !== null && 'data' in value && Object.keys(value).length === 1
}

function isStructuredTaskRequest(value: unknown): value is { context: unknown; payload: unknown } {
  return typeof value === 'object' && value !== null && 'context' in value && 'payload' in value
}

export function getActivityTaskQueue(): string {
  return activityInfo().taskQueue
}

/**
 * Adapts a plain `(req) => res` function to the service task protocol: unwraps
 * `{ context, payload }` requests, wraps the response to match, and heartbeats
 * while it runs so long renders don't trip the heartbeat timeout.
 */
export function wrapSingleActivity<Req extends object, Res extends object, Ctx extends BaseJobContext>(
  fn: (req: Req) => Promise<Res>,
): (taskReq: CompatibleTaskRequest<Req, Ctx>) => Promise<CompatibleTaskResponse<Res>> {
  return async (request) => {
    const beat = setInterval(() => heartbeat(), HEARTBEAT_INTERVAL_MS)
    try {
      const { payload, context, wrapResponse } = parseCompatibleRequest(request)
      const input = (isStructuredTaskRequest(request) ? { context, payload } : payload) as Req
      const response = await fn(input)
      return (isBareTaskResponse(response) ? response : wrapResponse(response)) as CompatibleTaskResponse<Res>
    } finally {
      clearInterval(beat)
    }
  }
}
