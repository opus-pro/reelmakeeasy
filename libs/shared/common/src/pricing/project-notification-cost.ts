import { AsyncLocalStorage } from 'node:async_hooks'

import { JobContext } from '../job-context/index'
import { getKvStore } from '../kv'
import { getLogger } from '../logger'

const logger = getLogger('project-notification-cost')
const PROJECT_NOTIFICATION_COST_KEY_PREFIX = 'llm.tokens_cost'
// 3.5h: sliding TTL, refreshed on every cost write. Sized to outlast the
// longest live idle gap in a story-mode project -- UIP can wait ~3h on user input --
// so the per-project roll-up survives the gap and the terminal cost-recorded read
// stays complete. Cleanup is by TTL expiry (the terminal cost event does NOT delete
// the keys, because on the success path it fires before the workflow's completion
// summary re-reads the total).
const PROJECT_NOTIFICATION_COST_TTL_SECONDS = 12600

export type ProjectNotificationCostEvent = {
  costNano: number
  model: string
  projectId: string
  provider: string
  task: string
}

const activeCostCaptures = new AsyncLocalStorage<ProjectNotificationCostEvent[][]>()

/**
 * Capture project-cost events emitted inside callback without changing the
 * existing KV notification roll-up. The returned array remains live until
 * result settles, so callers can persist it in a finally block.
 *
 * Nested captures intentionally fan out to every active scope: an outer
 * activity capture still sees costs emitted by a narrower helper capture.
 */
export function captureProjectNotificationCosts<T>(callback: () => T): {
  costs: ProjectNotificationCostEvent[]
  result: T
} {
  const costs: ProjectNotificationCostEvent[] = []
  const parentCaptures = activeCostCaptures.getStore() ?? []
  return {
    costs,
    result: activeCostCaptures.run([...parentCaptures, costs], callback),
  }
}

export function recordProjectNotificationCost(params: {
  costNano: number
  model?: string
  projectId?: string
  provider?: string
  task?: string
}): void {
  const roundedCostNano = Math.round(params.costNano)
  if (!Number.isFinite(roundedCostNano) || roundedCostNano <= 0) {
    return
  }

  const projectId = params.projectId || JobContext.getFullContext({}).projectId
  if (!projectId) {
    return
  }

  const event: ProjectNotificationCostEvent = {
    costNano: roundedCostNano,
    model: params.model || 'unknown',
    projectId,
    provider: params.provider || 'unknown',
    task: params.task || 'unknown',
  }
  for (const capture of activeCostCaptures.getStore() ?? []) {
    capture.push(event)
  }

  const kv = getKvStore()

  const totalKey = `${PROJECT_NOTIFICATION_COST_KEY_PREFIX}:${projectId}`
  // Per-model/task breakdown lives in a single hash so the terminal
  // cost-recorded reader can HGETALL it in one call -- the KvStore wrapper has
  // no SCAN, and one hash beats N individual `:{task}:{model}` string keys. The
  // field is `{task}|{model}|{provider}` (`|` never appears in any of them). Nothing
  // reads the former string-key form, and the roll-up is ephemeral, so no migration.
  const detailKey = `${PROJECT_NOTIFICATION_COST_KEY_PREFIX}:${projectId}:detail`
  // Call count per breakdown field, parallel to the cost hash. Counts
  // only billable calls (this runs after the costNano > 0 guard above), which is
  // "how many billable calls per model", not every attempt.
  const callsKey = `${PROJECT_NOTIFICATION_COST_KEY_PREFIX}:${projectId}:calls`
  const detailField = `${event.task}|${event.model}|${event.provider}`

  try {
    kv.incrBy(totalKey, roundedCostNano)
    kv.expire(totalKey, PROJECT_NOTIFICATION_COST_TTL_SECONDS)
    kv.hIncrBy(detailKey, detailField, roundedCostNano)
    kv.expire(detailKey, PROJECT_NOTIFICATION_COST_TTL_SECONDS)
    kv.hIncrBy(callsKey, detailField, 1)
    kv.expire(callsKey, PROJECT_NOTIFICATION_COST_TTL_SECONDS)
  } catch (error) {
    logger.warn({ error, projectId }, 'Failed to record project notification cost')
  }
}
