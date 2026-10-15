import { wrapActivitiesWithContext } from '@reelmakeeasy/common/agent-v2/util/activity-context-wrapper'
import { getEnvAsNumber } from '@reelmakeeasy/common/utils/env.util'
import { serveWorkers } from '@reelmakeeasy/common/workflow/worker'
import { RENDER_TASK_QUEUE } from '@shared/render-services/render/base.service'
import { wrapSingleActivity } from '@shared/render-services/runtime/worker'

import { activityRegistry } from './activities'
import * as workflows from './workflows'

function buildProtocolActivities(): Record<string, unknown> {
  const withCtx = wrapActivitiesWithContext(activityRegistry as Record<string, unknown>)
  const out: Record<string, unknown> = {}
  for (const [name, val] of Object.entries(withCtx)) {
    if (typeof val === 'function')
      out[name] = wrapSingleActivity(val as (req: object) => Promise<object>)
  }
  return out
}

/**
 * Registers the render worker (ffmpeg) with the
 * in-process workflow engine. Renders are CPU heavy, so concurrency defaults
 * to one; raise RENDER_WORKER_CONCURRENCY on larger machines.
 */
export async function startRenderWorker(): Promise<void> {
  await serveWorkers([
    {
      activities: buildProtocolActivities(),
      baseTaskQueue: RENDER_TASK_QUEUE,
      maxConcurrentActivityTaskExecutions: getEnvAsNumber('RENDER_WORKER_CONCURRENCY', 1),
      workflows,
    },
  ])
}
