import { registerWorker } from '@reelmakeeasy/workflow-engine/worker'

import { logger } from '../logger'

import { setupWorkflowEngine } from './engine-setup'
import { resolveTaskQueueForWorker } from './task-queue'

export type ServeOptions = {
  activities?: object
  baseTaskQueue: string
  init?: () => Promise<void>
  maxConcurrentActivityTaskExecutions?: number
  /** Workflow functions, keyed by workflow type. */
  workflows?: Record<string, unknown>
  [option: string]: unknown
}

/** Registers workers with the in-process engine. Resolves once all are serving. */
export async function serveWorkers(optionsList: ServeOptions[]): Promise<void> {
  setupWorkflowEngine()
  for (const options of optionsList) {
    await options.init?.()
    registerWorker({
      activities: options.activities as Record<string, unknown> | undefined,
      maxConcurrentActivityTaskExecutions: options.maxConcurrentActivityTaskExecutions,
      taskQueue: resolveTaskQueueForWorker(options.baseTaskQueue),
      workflows: options.workflows,
    })
  }
  logger.info(`[workflow-engine] ${optionsList.length} worker(s) serving`)
}

export function serveWorker(options: ServeOptions): Promise<void> {
  return serveWorkers([options])
}
