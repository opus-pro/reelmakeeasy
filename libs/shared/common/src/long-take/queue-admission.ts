import type { Duration } from '@reelmakeeasy/workflow-engine/common'

import type { KvStore } from '../kv/store'

import { LONG_TAKE_STATUS_TTL_SECONDS } from './status-constants'
import type { LongTakeAdmissionTier } from './types'

const LONG_TAKE_ADMISSION_QUEUE_KEY_PREFIX = 'long-take:admission:queue:'
const LONG_TAKE_ADMISSION_ACTIVE_KEY_PREFIX = 'long-take:admission:active:'
const LONG_TAKE_ADMISSION_THROUGHPUT_KEY_PREFIX = 'long-take:admission:throughput:'
const LONG_TAKE_ADMISSION_PAYLOAD_KEY_PREFIX = 'long-take:admission:payload:'
const LONG_TAKE_ADMISSION_LEADER_KEY_PREFIX = 'long-take:admission:leader:'

export const LONG_TAKE_ADMISSION_THROUGHPUT_WINDOW_MS = 30 * 60 * 1000
const LONG_TAKE_ADMISSION_THROUGHPUT_TTL_MS = 24 * 60 * 60 * 1000

export type LongTakeAdmissionPayload = {
  projectId: string
  queuedAtMs: number
  taskQueue: string
  tier: LongTakeAdmissionTier
  userEmail?: string
  userId: string
  workflowArgs: unknown
  workflowExecutionTimeout: Duration
  workflowId: string
  workflowName: string
  workflowRunTimeout?: Duration
}

export type LongTakeAdmissionState = {
  activeFree: number
  activePaid: number
  queueDepthFree: number
  queueDepthPaid: number
}

export async function acquireLongTakeAdmissionLeader(
  kv: KvStore,
  params: {
    holderId: string
    taskQueue: string
    ttlMs: number
  },
): Promise<boolean> {
  return await kv.setNXWithMs(buildLeaderKey(params.taskQueue), params.holderId, params.ttlMs)
}

export async function addLongTakeAdmissionActiveSlot(
  kv: KvStore,
  params: {
    admittedAtMs: number
    taskQueue: string
    tier: LongTakeAdmissionTier
    workflowId: string
  },
): Promise<void> {
  await kv.zAdd(buildActiveKey(params.taskQueue, params.tier), {
    score: params.admittedAtMs,
    value: params.workflowId,
  })
}

export async function deleteLongTakeAdmissionPayload(
  kv: KvStore,
  projectId: string,
): Promise<void> {
  await kv.del(buildPayloadKey(projectId))
}

export async function enqueueLongTakeAdmission(
  kv: KvStore,
  payload: LongTakeAdmissionPayload,
): Promise<void> {
  await Promise.all([
    kv.set(buildPayloadKey(payload.projectId), payload, LONG_TAKE_STATUS_TTL_SECONDS),
    kv.zAdd(buildQueueKey(payload.taskQueue, payload.tier), {
      score: payload.queuedAtMs,
      value: payload.projectId,
    }),
  ])
}

export async function estimateLongTakeAdmissionWaitSeconds(
  kv: KvStore,
  params: {
    position: number
    taskQueue: string
    throughputWindowMs?: number
    tier: LongTakeAdmissionTier
  },
): Promise<null | number> {
  if (params.position <= 0) {
    return 0
  }
  const throughputWindowMs = params.throughputWindowMs ?? LONG_TAKE_ADMISSION_THROUGHPUT_WINDOW_MS
  const admittedInWindow = await getRecentLongTakeAdmissionThroughput(kv, {
    taskQueue: params.taskQueue,
    tier: params.tier,
    throughputWindowMs,
  })
  const throughputPerSec = admittedInWindow / Math.max(1, throughputWindowMs / 1000)
  if (throughputPerSec <= 0) {
    return null
  }
  return params.position / throughputPerSec
}

export async function getLongTakeAdmissionPayload(
  kv: KvStore,
  projectId: string,
): Promise<LongTakeAdmissionPayload | null> {
  return await kv.getObject<LongTakeAdmissionPayload>(buildPayloadKey(projectId))
}

export async function getLongTakeAdmissionQueuePosition(
  kv: KvStore,
  params: {
    projectId: string
    taskQueue: string
    tier: LongTakeAdmissionTier
  },
): Promise<null | number> {
  const rank = await kv.zRank(buildQueueKey(params.taskQueue, params.tier), params.projectId)
  return rank === null ? null : rank + 1
}

export async function getLongTakeAdmissionState(
  kv: KvStore,
  taskQueue: string,
): Promise<LongTakeAdmissionState> {
  const [activePaid, activeFree, queueDepthPaid, queueDepthFree] = await Promise.all([
    kv.zCard(buildActiveKey(taskQueue, 'paid')),
    kv.zCard(buildActiveKey(taskQueue, 'free')),
    kv.zCard(buildQueueKey(taskQueue, 'paid')),
    kv.zCard(buildQueueKey(taskQueue, 'free')),
  ])

  return {
    activeFree,
    activePaid,
    queueDepthFree,
    queueDepthPaid,
  }
}

/**
 * The admission lane every Story Mode start rides. ReelMakeEasy has no plans, so
 * there is one lane; the two-lane queue shape is kept for the shared key layout.
 */
export const STORY_MODE_ADMISSION_TIER: LongTakeAdmissionTier = 'free'

export async function getRecentLongTakeAdmissionThroughput(
  kv: KvStore,
  params: {
    taskQueue: string
    throughputWindowMs?: number
    tier: LongTakeAdmissionTier
  },
): Promise<number> {
  const now = Date.now()
  const throughputWindowMs = params.throughputWindowMs ?? LONG_TAKE_ADMISSION_THROUGHPUT_WINDOW_MS
  return await kv.zCount(
    buildThroughputKey(params.taskQueue, params.tier),
    now - throughputWindowMs,
    now,
  )
}

export async function peekQueuedLongTakeProjects(
  kv: KvStore,
  params: {
    count: number
    taskQueue: string
    tier: LongTakeAdmissionTier
  },
): Promise<string[]> {
  if (params.count <= 0) {
    return []
  }
  return await kv.zRange(buildQueueKey(params.taskQueue, params.tier), 0, params.count - 1)
}

export async function pruneExpiredLongTakeAdmissionSlots(
  kv: KvStore,
  params: {
    maxAgeMs: number
    taskQueue: string
  },
): Promise<{ prunedFree: number; prunedPaid: number }> {
  const cutoff = Date.now() - Math.max(0, params.maxAgeMs)
  const [prunedPaid, prunedFree] = await Promise.all([
    kv.zRemRangeByScore(buildActiveKey(params.taskQueue, 'paid'), '-inf', cutoff),
    kv.zRemRangeByScore(buildActiveKey(params.taskQueue, 'free'), '-inf', cutoff),
  ])
  return { prunedFree, prunedPaid }
}

export async function recordLongTakeAdmissionThroughput(
  kv: KvStore,
  params: {
    admittedAtMs?: number
    projectId: string
    taskQueue: string
    throughputWindowMs?: number
    tier: LongTakeAdmissionTier
  },
): Promise<void> {
  const admittedAtMs = params.admittedAtMs ?? Date.now()
  const throughputWindowMs = params.throughputWindowMs ?? LONG_TAKE_ADMISSION_THROUGHPUT_WINDOW_MS
  const throughputKey = buildThroughputKey(params.taskQueue, params.tier)
  await Promise.all([
    kv.zAdd(throughputKey, {
      score: admittedAtMs,
      value: `${params.projectId}:${admittedAtMs}`,
    }),
    kv.pExpire(
      throughputKey,
      Math.max(LONG_TAKE_ADMISSION_THROUGHPUT_TTL_MS, throughputWindowMs * 2),
    ),
  ])
}

export async function releaseLongTakeAdmissionActiveSlot(
  kv: KvStore,
  params: {
    taskQueue: string
    tier: LongTakeAdmissionTier
    workflowId: string
  },
): Promise<void> {
  await kv.zRem(buildActiveKey(params.taskQueue, params.tier), params.workflowId)
}

export async function releaseLongTakeAdmissionLeader(
  kv: KvStore,
  params: {
    holderId: string
    taskQueue: string
  },
): Promise<void> {
  // Compare-and-delete in one synchronous step: only the holder may release.
  const key = buildLeaderKey(params.taskQueue)
  if (kv.get(key) === params.holderId) {
    kv.del(key)
  }
}

export async function removeQueuedLongTakeProject(
  kv: KvStore,
  params: {
    projectId: string
    taskQueue: string
    tier: LongTakeAdmissionTier
  },
): Promise<void> {
  await kv.zRem(buildQueueKey(params.taskQueue, params.tier), params.projectId)
}

/**
 * Atomically transitions a project from queued to active by executing
 * all three bookkeeping mutations in one synchronous step:
 *   1. ZADD active slot
 *   2. ZREM from queue
 *   3. ZADD + PEXPIRE throughput record
 */
export async function commitLongTakeAdmission(
  kv: KvStore,
  params: {
    admittedAtMs: number
    projectId: string
    taskQueue: string
    throughputWindowMs?: number
    tier: LongTakeAdmissionTier
    workflowId: string
  },
): Promise<void> {
  const { admittedAtMs, projectId, taskQueue, tier, workflowId } = params
  const activeKey = buildActiveKey(taskQueue, tier)
  const queueKey = buildQueueKey(taskQueue, tier)
  const throughputKey = buildThroughputKey(taskQueue, tier)
  const throughputWindowMs = params.throughputWindowMs ?? LONG_TAKE_ADMISSION_THROUGHPUT_WINDOW_MS
  const throughputTtlMs = Math.max(LONG_TAKE_ADMISSION_THROUGHPUT_TTL_MS, throughputWindowMs * 2)

  kv.zAdd(activeKey, { score: admittedAtMs, value: workflowId })
  kv.zRem(queueKey, projectId)
  kv.zAdd(throughputKey, { score: admittedAtMs, value: `${projectId}:${admittedAtMs}` })
  kv.pExpire(throughputKey, throughputTtlMs)
}

export async function renewLongTakeAdmissionLeader(
  kv: KvStore,
  params: {
    holderId: string
    taskQueue: string
    ttlMs: number
  },
): Promise<boolean> {
  // Compare-and-extend in one synchronous step: only the holder may renew.
  const key = buildLeaderKey(params.taskQueue)
  if (kv.get(key) !== params.holderId) {
    return false
  }
  return kv.pExpire(key, params.ttlMs)
}

function buildActiveKey(taskQueue: string, tier: LongTakeAdmissionTier): string {
  return `${LONG_TAKE_ADMISSION_ACTIVE_KEY_PREFIX}${taskQueue}:${tier}`
}

function buildLeaderKey(taskQueue: string): string {
  return `${LONG_TAKE_ADMISSION_LEADER_KEY_PREFIX}${taskQueue}`
}

function buildPayloadKey(projectId: string): string {
  return `${LONG_TAKE_ADMISSION_PAYLOAD_KEY_PREFIX}${projectId}`
}

function buildQueueKey(taskQueue: string, tier: LongTakeAdmissionTier): string {
  return `${LONG_TAKE_ADMISSION_QUEUE_KEY_PREFIX}${taskQueue}:${tier}`
}

function buildThroughputKey(taskQueue: string, tier: LongTakeAdmissionTier): string {
  return `${LONG_TAKE_ADMISSION_THROUGHPUT_KEY_PREFIX}${taskQueue}:${tier}`
}
