/**
 * Generic optimistic-lock utility for UIP session fields.
 *
 * withSessionLock<K> handles any combination of 'state' and 'timeline' keys:
 *   - Fetches current values + version numbers in one DB round-trip
 *   - Calls the mutate callback with current data
 *   - Writes new values with CAS version check (updateMany)
 *   - Retries on conflict up to SESSION_LOCK_MAX_RETRIES times
 *   - Pushes SSE events after a successful write
 *
 * Timeline writers should call this helper directly.
 */

import type { UipSession } from '@reelmakeeasy/api-db'
import { createSubLogger } from '@reelmakeeasy/common/logger'
import { SSEFactory } from '@reelmakeeasy/common/sse/factory'

import type { PrismaService } from '../prisma/prisma.service'

import { uipSessionBusKey } from './uip-session-event'
import { normalizeTimeline } from './uip-timeline-transformers'
import type {
  NextActionRecord,
  SessionLockInput,
  SessionLockOutput,
  SessionLockOutputWrite,
  SessionLockWriteResult,
  StateChanges,
  TimelineChanges,
  TimelineFile,
  UipSessionState,
  VersionedKey,
} from './uip-timeline-types'

const logger = createSubLogger('uip-session-lock')

const SESSION_LOCK_MAX_RETRIES = 10

export type SessionLockArg<K extends VersionedKey> = SessionLockTarget<K> | string
export type SessionLockField<K extends VersionedKey> = `${K}Version` | K
export type SessionLockMutateFn<K extends VersionedKey> = (
  data: Pick<SessionLockInput, K>,
) => PromiseLike<SessionLockOutput<K>> | SessionLockOutput<K>
export type SessionLockTarget<K extends VersionedKey> = Pick<
  UipSession,
  'projectId' | SessionLockField<K>
>
type LockData = Record<string, unknown>
type LockVersions = Partial<Record<VersionedKey, number>>
type NoInfer<T> = [T][T extends unknown ? 0 : never]

function buildLockInputData<K extends VersionedKey>(
  rowRecord: LockData,
  keys: K[],
): Pick<SessionLockInput, K> {
  const inputData = {} as Pick<SessionLockInput, K>
  for (const key of keys) {
    if (key === 'timeline') {
      ;(inputData as Record<string, unknown>).timeline = normalizeTimeline(rowRecord.timeline)
      continue
    }
    if (key === 'state') {
      ;(inputData as Record<string, unknown>).state =
        (rowRecord.state as null | UipSessionState) ?? {}
      continue
    }
    if (key === 'nextAction') {
      ;(inputData as Record<string, unknown>).nextAction =
        (rowRecord.nextAction as NextActionRecord | null) ?? null
    }
  }
  return inputData
}

function buildLockSelect<K extends VersionedKey>(keys: K[]): Record<string, true> {
  const select: Record<string, true> = {}
  for (const key of keys) {
    select[key] = true
    select[`${key}Version`] = true
  }
  return select
}

function buildLockWritePayload<K extends VersionedKey>(
  projectId: string,
  activeKeys: K[],
  rowRecord: LockData,
  writeRecord: LockData,
): {
  data: LockData
  newVersions: LockVersions
  result: SessionLockWriteResult
  where: LockData
} {
  const where: LockData = { projectId }
  const data: LockData = {}
  const newVersions: LockVersions = {}
  const result: SessionLockWriteResult = {}

  for (const key of activeKeys) {
    const versionKey = `${key}Version`
    const currentVersion = rowRecord[versionKey] as number
    const writeValue = writeRecord[key] as SessionLockOutputWrite[typeof key]
    const newVersion = currentVersion + 1

    where[versionKey] = currentVersion
    data[versionKey] = newVersion
    newVersions[key] = newVersion

    if (key === 'nextAction') {
      // null means clear the field; NextActionRecord means write it.
      data[key] = writeValue ?? null
      result.nextAction = {
        value: (writeValue as NextActionRecord | null) ?? null,
        version: newVersion,
      }
      continue
    }

    if (writeValue === null) {
      if (key === 'timeline') {
        result.timeline = {
          value: {
            ...normalizeTimeline(rowRecord.timeline),
            version: newVersion,
          },
          version: newVersion,
        }
      } else {
        result.state = {
          value: ((rowRecord.state as null | UipSessionState) ?? {}) as UipSessionState,
          version: newVersion,
        }
      }
      continue
    }
    if (key === 'timeline') {
      const timelineWrite = writeValue as Omit<TimelineFile, 'version'>
      const timelineValue = { ...timelineWrite, version: newVersion }
      data[key] = timelineValue
      result.timeline = { value: timelineValue, version: newVersion }
      continue
    }
    data[key] = writeValue
    // Auto-sync phase/status Prisma columns atomically with state JSON.
    const stateValue = writeValue as UipSessionState
    if (stateValue.phase !== undefined) {
      data.phase = stateValue.phase
    }
    if (stateValue.status !== undefined) {
      data.status = stateValue.status
    }
    result.state = { value: stateValue, version: newVersion }
  }

  return { data, newVersions, result, where }
}

async function pushLockChangesSse<K extends VersionedKey>(
  projectId: string,
  changes: SessionLockOutput<K>['changes'],
  data: LockData,
  newVersions: LockVersions,
): Promise<void> {
  type EnrichedSessionLockEvent =
    | (StateChanges & { kind: 'state' })
    | (TimelineChanges & { kind: 'timeline' })

  const batch: EnrichedSessionLockEvent[] = []

  for (const change of changes) {
    if (change.kind === 'timeline' && newVersions.timeline != null) {
      const writtenTimeline = data.timeline as TimelineFile | undefined
      batch.push({
        kind: 'timeline',
        append: change.append,
        update: change.update,
        next_event_id: writtenTimeline?.next_event_id ?? 0,
        version: newVersions.timeline,
      })
    } else if (change.kind === 'state' && newVersions.state != null) {
      batch.push({ kind: 'state', state: change.state, version: newVersions.state })
    }
  }

  if (!batch.length) {
    return
  }

  try {
    const bus = await SSEFactory.getSSEBus(uipSessionBusKey(projectId))
    if (bus) {
      await bus.push({
        data: JSON.stringify(batch),
        type: 'batch_changes',
      })
    }
  } catch (err) {
    logger.warn(`[${projectId}] Failed to push SSE batch_changes: ${err}`)
  }
}

// ---------------------------------------------------------------------------
// SSE push helpers
// ---------------------------------------------------------------------------

export async function pushStateChangesSse(projectId: string, changes: StateChanges): Promise<void> {
  try {
    const bus = await SSEFactory.getSSEBus(uipSessionBusKey(projectId))
    if (bus) {
      await bus.push({
        data: JSON.stringify(changes),
        type: 'state_changes',
      })
    }
  } catch (err) {
    logger.warn(`[${projectId}] Failed to push SSE state_changes: ${err}`)
  }
}

export async function pushTimelineChangesSse(
  projectId: string,
  changes: TimelineChanges,
): Promise<void> {
  if (!changes.append.length && !changes.update.length) {
    return
  }
  try {
    const bus = await SSEFactory.getSSEBus(uipSessionBusKey(projectId))
    if (bus) {
      await bus.push({
        data: JSON.stringify(changes),
        type: 'timeline_changes',
      })
    }
  } catch (err) {
    logger.warn(`[${projectId}] Failed to push SSE timeline_changes: ${err}`)
  }
}

// ---------------------------------------------------------------------------
// withSessionLock
// ---------------------------------------------------------------------------

/**
 * Generic read-modify-write with optimistic locking for uipSession fields.
 *
 * target: accepts projectId string, or a typed session seed object that
 *   includes `id` + lock fields for this K (`K` and `${K}Version`).
 * keys: which fields to lock on, e.g. { timeline: true } or { state: true } or both.
 * mutate: receives current field values, returns what to write + SSE events to push.
 *   - write[key] = 'abandon' -> skip this key (no lock, no write, no SSE for that key)
 *   - write[key] = null      -> bump version only (advances CAS clock), no data write
 *   - write[key] = <value>   -> write value + bump version
 */
export async function withSessionLock<K extends VersionedKey>(
  prisma: PrismaService,
  target: SessionLockArg<NoInfer<K>>,
  keys: Readonly<Record<K, true>>,
  mutate: SessionLockMutateFn<K>,
): Promise<null | SessionLockWriteResult> {
  const projectId = typeof target === 'string' ? target : target.projectId
  const keyList = Object.keys(keys) as K[]
  const select = buildLockSelect(keyList)
  const seedRow = typeof target === 'string' ? null : (target as Record<string, unknown>)

  for (let attempt = 1; attempt <= SESSION_LOCK_MAX_RETRIES; attempt++) {
    let row: null | Record<string, unknown> = null
    if (attempt === 1 && seedRow) {
      row = seedRow
    } else {
      const t0 = Date.now()
      const fetched = await prisma.uipSession.findUnique({
        where: { projectId },
        select,
      })
      logger.info(
        { attempt, durationMs: Date.now() - t0, keys: keyList, operation: 'read', projectId },
        'session lock I/O',
      )
      row = fetched as null | Record<string, unknown>
    }

    if (!row) {
      throw new Error(`UIP session not found: ${projectId}`)
    }

    const inputData = buildLockInputData(row, keyList)
    const output = await mutate(inputData)

    const writeRecord = output.write as Record<string, unknown>
    const activeKeys = keyList.filter((key) => writeRecord[key] !== 'abandon')

    // All keys skipped for this attempt, nothing to do.
    if (!activeKeys.length) {
      return null
    }

    const { data, newVersions, result, where } = buildLockWritePayload(
      projectId,
      activeKeys,
      row,
      writeRecord,
    )

    const t1 = Date.now()
    const updated = await prisma.uipSession.updateMany({
      where,
      data,
    } as unknown as Parameters<PrismaService['uipSession']['updateMany']>[0])

    logger.info(
      { attempt, durationMs: Date.now() - t1, keys: activeKeys, operation: 'write', projectId },
      'session lock I/O',
    )

    if (updated.count === 0) {
      logger.warn(
        `[${projectId}] withSessionLock conflict, retrying (attempt ${attempt}/${SESSION_LOCK_MAX_RETRIES})`,
      )
      continue
    }

    await pushLockChangesSse(projectId, output.changes, data, newVersions)
    return result
  }

  throw new Error(`[${projectId}] withSessionLock failed after ${SESSION_LOCK_MAX_RETRIES} retries`)
}
