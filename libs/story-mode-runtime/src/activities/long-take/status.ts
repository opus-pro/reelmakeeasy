import { pushChunks } from '@reelmakeeasy/common/agent-v2/util/push-chunks'
import { getKvStore } from '@reelmakeeasy/common/kv'
import {
  deleteLongTakeAdmissionPayload,
  releaseLongTakeAdmissionActiveSlot,
} from '@reelmakeeasy/common/long-take/queue-admission'
import { Context } from '@reelmakeeasy/workflow-engine/activity'

import type {
  LongTakeSlotParams,
  SetLongTakeStatusActivityParams,
} from '../../workflows/long-take/types'

import {
  DEFAULT_IMAGE_CONCURRENCY,
  DEFAULT_VIDEO_CONCURRENCY,
  formatError,
  formatLogFields,
  getImageConcurrency,
  getVideoConcurrency,
  logger,
  withLongTakeContext,
} from './common'

export async function getLongTakeConcurrencyConfig(params: {
  projectId: string
  userId: string
}): Promise<{
  imageConcurrency: number
  videoConcurrency: number
}> {
  return withLongTakeContext(params, async () => ({
    imageConcurrency: getImageConcurrency(DEFAULT_IMAGE_CONCURRENCY),
    videoConcurrency: getVideoConcurrency(DEFAULT_VIDEO_CONCURRENCY),
  }))
}

export async function setLongTakeStatus(params: SetLongTakeStatusActivityParams): Promise<void> {
  const { concurrentStages, projectId, stage, status, detail, meta, userEmail, userId } = params
  return withLongTakeContext({ projectId, userId, userEmail }, async () => {
    const payload = {
      concurrentStages: concurrentStages?.length ? concurrentStages : undefined,
      detail,
      meta,
      stage,
      status,
      updatedAt: new Date().toISOString(),
    }

    try {
      await pushChunks({
        projectId,
        userId,
        userEmail,
        chunks: [
          {
            status: payload,
            type: 'long-take-status',
          },
        ],
      })
      logger.info(
        `[long-take] Status update pushed ${formatLogFields({ projectId, stage, status })}`,
      )
    } catch (error) {
      logger.warn(
        `[long-take] Failed to push status ${formatLogFields({
          projectId,
          err: formatError(error),
        })}`,
      )
      throw error
    }
  })
}

/** Counts a long-take run in the task queue's in-flight set. */
export async function reserveLongTakeSlot(
  params: Pick<LongTakeSlotParams, 'projectId'>,
): Promise<void> {
  await updateLongTakeInFlight({
    delta: 1,
    projectId: params.projectId,
    taskQueue: resolveCurrentTaskQueue(),
  })
}

/** Frees a finished (completed, failed or rejected) run's admission slot and in-flight entry. */
export async function releaseLongTakeSlot(params: LongTakeSlotParams): Promise<void> {
  const taskQueue = resolveCurrentTaskQueue()
  await releaseLongTakeAdmissionState({
    admissionTier: params.admissionTier,
    projectId: params.projectId,
    taskQueue,
    workflowId: params.workflowId,
  })
  await updateLongTakeInFlight({ delta: -1, projectId: params.projectId, taskQueue })
}

function buildLongTakeInFlightKey(taskQueue: string): string {
  return `agent.long_take.queue.active:${taskQueue}`
}

async function releaseLongTakeAdmissionState(params: {
  admissionTier?: 'free' | 'paid'
  projectId: string
  taskQueue: string
  workflowId: string
}): Promise<void> {
  const { admissionTier, projectId, taskQueue, workflowId } = params
  if (!admissionTier) {
    return
  }

  const kv = getKvStore()

  try {
    await Promise.all([
      releaseLongTakeAdmissionActiveSlot(kv, {
        taskQueue,
        tier: admissionTier,
        workflowId,
      }),
      deleteLongTakeAdmissionPayload(kv, projectId),
    ])
  } catch (error) {
    logger.warn(
      `[long-take] Failed to release admission state ${formatLogFields({
        projectId,
        taskQueue,
        err: formatError(error),
      })}`,
    )
  }
}

function resolveCurrentTaskQueue(): string {
  try {
    return Context.current().info.taskQueue || 'unknown'
  } catch {
    return 'unknown'
  }
}

async function updateLongTakeInFlight(params: {
  delta: -1 | 1
  projectId: string
  taskQueue: string
}): Promise<void> {
  const { delta, projectId, taskQueue } = params
  const kv = getKvStore()

  const storeKey = buildLongTakeInFlightKey(taskQueue)

  try {
    if (delta === 1) {
      await kv.sAdd(storeKey, projectId)
    } else {
      await kv.sRem(storeKey, projectId)
    }
  } catch (error) {
    logger.warn(
      `[long-take] Failed to update queue inflight ${formatLogFields({
        projectId,
        taskQueue,
        err: formatError(error),
      })}`,
    )
  }
}
