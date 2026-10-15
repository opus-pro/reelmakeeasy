// Final SSE push for the settings re-mux workflow so a subscribed
// client (the export processing popup) wakes up near-instantly instead of
// waiting for the next bgm-settings poll. The frame is a WAKE-UP SIGNAL only:
// the client re-reads server truth (remuxOutcome) before acting. Mirrors the
// editor worker's notifyActivity; the channel is keyed by the workflow id,
// which is deterministic per project (ao:{projectId}:story-mode:bgm-remux).
// The push is best-effort: the activity no-ops (with an error log) when the
// SSE factory is unavailable or uninitialized -- clients still converge via
// the bgm-settings poll.

import { createSubLogger } from '@reelmakeeasy/common/logger'
import { getAssetSSEChannelKey } from '@reelmakeeasy/common/media'
import { SSEFactory } from '@reelmakeeasy/common/sse/factory'
import { SSE_NOT_INITED } from '@reelmakeeasy/common/sse/sse'
import { Context } from '@reelmakeeasy/workflow-engine/activity'

const logger = createSubLogger('bgm-remux-notify')

export interface NotifyBgmRemuxCompletedParams {
  projectId: string
}

export interface NotifyBgmRemuxFailedParams {
  code: string
  message: string
  projectId: string
}

export async function notifyBgmRemuxCompleted(
  params: NotifyBgmRemuxCompletedParams,
): Promise<void> {
  const { workflowExecution } = Context.current().info
  const bus = await getBus(workflowExecution.workflowId, params.projectId)
  if (!bus) {
    return
  }
  await bus.push({
    type: 'update',
    data: JSON.stringify({
      status: 'completed',
      updatedAt: Date.now(),
    }),
  })
  logger.info(
    `Pushed BGM remux completed update ${JSON.stringify({
      projectId: params.projectId,
      workflowId: workflowExecution.workflowId,
    })}`,
  )
}

export async function notifyBgmRemuxFailed(params: NotifyBgmRemuxFailedParams): Promise<void> {
  const { workflowExecution } = Context.current().info
  const bus = await getBus(workflowExecution.workflowId, params.projectId)
  if (!bus) {
    return
  }
  await bus.push({
    type: 'update',
    data: JSON.stringify({
      status: 'failed',
      error: { code: params.code, message: params.message },
      updatedAt: Date.now(),
    }),
  })
  logger.info(
    `Pushed BGM remux failed update ${JSON.stringify({
      projectId: params.projectId,
      workflowId: workflowExecution.workflowId,
    })}`,
  )
}

/**
 * Resolve the SSE bus for the workflow channel, or null when the push must be
 * skipped: getSSEBus THROWS the SSE_NOT_INITED sentinel when the factory was
 * never initialized on this worker (and returns null only in a shutdown
 * race) -- both take the same log-error-and-skip path. Anything else is a
 * real infra error and propagates so the activity retries.
 */
async function getBus(workflowId: string, projectId: string) {
  const channelKey = getAssetSSEChannelKey(workflowId)
  try {
    const bus = await SSEFactory.getSSEBus(channelKey)
    if (bus) {
      return bus
    }
  } catch (error) {
    if (error !== SSE_NOT_INITED) {
      throw error
    }
  }
  logger.error(
    `SSE bus not available, skipping update ${JSON.stringify({
      channelKey,
      projectId,
      workflowId,
    })}`,
  )
  return null
}
