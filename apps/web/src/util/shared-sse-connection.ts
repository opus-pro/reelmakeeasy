import type { SSEHandlers } from './sse'

type CreateSSEConnectionLike = (
  url: string,
  handlers: SSEHandlers,
  options?: Record<string, unknown>,
) => SSEConnectionLike

type SharedEntry<TCreate extends CreateSSEConnectionLike> = {
  activeLeaseIds: Set<number>
  connection: null | ReturnType<TCreate>
  key: string
  leases: Map<number, { handlers: SSEHandlers }>
  nextLeaseId: number
  options: Parameters<TCreate>[2]
  startPromise: null | Promise<void>
  url: Parameters<TCreate>[0]
}

type SharedSSEFactoryOptions = {
  namespace?: string
}

type SSEConnectionLike = {
  close: (reason?: string) => void
  readonly CLOSED?: number
  readonly CONNECTING?: number
  readonly OPEN?: number
  readonly readyState?: 0 | 1 | 2
  start: () => Promise<void>
}

type SSEErrorPayload = SSEMessagePayload & {
  raw_error?: Error
}

type SSEMessagePayload = {
  data: string
  event?: string
  id?: string
}

const cacheByBaseCreate = new WeakMap<
  CreateSSEConnectionLike,
  Map<string, SharedEntry<CreateSSEConnectionLike>>
>()

const NOOP_EVENT_HANDLER = (_payload: SSEMessagePayload) => void 0

class SharedSSEConnectionLease<TCreate extends CreateSSEConnectionLike>
  implements SSEConnectionLike
{
  public readonly CLOSED = 2
  public readonly CONNECTING = 0
  public readonly OPEN = 1

  get readyState(): 0 | 1 | 2 {
    if (this.closed || !this.started) {
      return this.CLOSED
    }

    const entryReadyState = this.entry.connection?.readyState
    if (entryReadyState === this.CONNECTING || entryReadyState === this.OPEN) {
      return entryReadyState
    }

    if (this.entry.startPromise) {
      return this.CONNECTING
    }

    return this.CLOSED
  }
  private closed = false

  private started = false

  constructor(
    private readonly leaseId: number,
    private readonly entry: SharedEntry<TCreate>,
    private readonly ensureEntryStarted: (entry: SharedEntry<TCreate>) => Promise<void>,
    private readonly onLeaseClosed: (reason?: string) => void,
  ) {}

  close(reason?: string) {
    if (this.closed) {
      return
    }

    this.closed = true
    this.entry.leases.delete(this.leaseId)
    if (this.started) {
      this.entry.activeLeaseIds.delete(this.leaseId)
    }
    this.onLeaseClosed(reason)
  }

  async start() {
    if (this.closed) {
      return
    }

    if (!this.started) {
      this.started = true
      this.entry.activeLeaseIds.add(this.leaseId)
    }

    await this.ensureEntryStarted(this.entry)
  }
}

export function createSharedSSEConnectionFactory<TCreate extends CreateSSEConnectionLike>(
  baseCreateSSEConnection: TCreate,
  options: SharedSSEFactoryOptions = {},
): TCreate {
  const cache = getOrCreateCache(baseCreateSSEConnection)

  const ensureEntryStarted = async (entry: SharedEntry<TCreate>): Promise<void> => {
    if (entry.startPromise) {
      await entry.startPromise
      return
    }

    let { connection } = entry
    if (isConnectionOpenOrConnecting(connection)) {
      return
    }

    if (!connection || isConnectionClosed(connection)) {
      entry.connection = connection = createUnderlyingConnection(baseCreateSSEConnection, entry)
    }

    const nextStartPromise = connection
      .start()
      .catch((error) => {
        invalidateEntryConnection(entry, 'sse-start-failed', connection)
        throw error
      })
      .finally(() => {
        if (entry.startPromise === nextStartPromise) {
          entry.startPromise = null
        }

        if (entry.connection === connection && isConnectionClosed(connection)) {
          entry.connection = null
        }
      })

    entry.startPromise = nextStartPromise
    await nextStartPromise
  }

  const maybeCleanupEntry = (entry: SharedEntry<TCreate>, reason?: string) => {
    if (entry.activeLeaseIds.size === 0) {
      invalidateEntryConnection(entry, reason)
    }

    if (entry.leases.size === 0) {
      cache.delete(entry.key)
    }
  }

  return ((
    url: Parameters<TCreate>[0],
    handlers: Parameters<TCreate>[1],
    createOptions?: Parameters<TCreate>[2],
  ): ReturnType<TCreate> => {
    const key = buildCacheKey(url, createOptions, options.namespace)

    let entry = cache.get(key) as SharedEntry<TCreate> | undefined
    if (!entry) {
      entry = {
        activeLeaseIds: new Set(),
        connection: null,
        key,
        leases: new Map(),
        nextLeaseId: 1,
        options: createOptions,
        startPromise: null,
        url,
      }
      cache.set(key, entry as SharedEntry<CreateSSEConnectionLike>)
    }

    const leaseId = entry.nextLeaseId++
    entry.leases.set(leaseId, {
      handlers: withDefaultLifecycleHandlers(handlers),
    })

    return new SharedSSEConnectionLease(leaseId, entry, ensureEntryStarted, (reason) =>
      maybeCleanupEntry(entry, reason),
    ) as ReturnType<TCreate>
  }) as unknown as TCreate
}

function buildCacheKey(url: string, options?: Record<string, unknown>, namespace = ''): string {
  const normalizedUrl = normalizeUrlForCacheKey(url)
  const normalizedOptions = normalizeForCacheKey(options)
  const normalizedNamespace = namespace.trim()

  return normalizedNamespace
    ? `${normalizedUrl}::${JSON.stringify(normalizedOptions)}::ns=${normalizedNamespace}`
    : `${normalizedUrl}::${JSON.stringify(normalizedOptions)}`
}

function createUnderlyingConnection<TCreate extends CreateSSEConnectionLike>(
  baseCreateSSEConnection: TCreate,
  entry: SharedEntry<TCreate>,
): ReturnType<TCreate> {
  let connection: null | ReturnType<TCreate> = null

  const forwardNamedEvent =
    (eventName: 'complete' | 'hello' | 'ping') => (payload: SSEMessagePayload) => {
      dispatchMessageToActiveLeases(entry, { ...payload, event: eventName })
    }

  const handlers: SSEHandlers = {
    complete: forwardNamedEvent('complete'),
    error: (payload) => {
      dispatchErrorToActiveLeases(entry, payload)
      invalidateEntryConnection(entry, 'sse-error', connection)
    },
    hello: forwardNamedEvent('hello'),
    message: (payload) => dispatchMessageToActiveLeases(entry, payload),
    ping: forwardNamedEvent('ping'),
  }

  connection = baseCreateSSEConnection(entry.url, handlers, entry.options) as ReturnType<TCreate>
  return connection
}

function dispatchErrorToActiveLeases<TCreate extends CreateSSEConnectionLike>(
  entry: SharedEntry<TCreate>,
  payload: SSEErrorPayload,
) {
  for (const leaseId of entry.activeLeaseIds) {
    entry.leases.get(leaseId)?.handlers.error?.(payload)
  }
}

function dispatchMessageToActiveLeases<TCreate extends CreateSSEConnectionLike>(
  entry: SharedEntry<TCreate>,
  payload: SSEMessagePayload,
) {
  for (const leaseId of entry.activeLeaseIds) {
    const lease = entry.leases.get(leaseId)
    if (!lease) {
      continue
    }

    const eventHandler = payload.event ? lease.handlers[payload.event] : undefined
    if (payload.event && eventHandler) {
      eventHandler(payload)
      continue
    }

    lease.handlers.message(payload)
  }
}

function getOrCreateCache<TCreate extends CreateSSEConnectionLike>(
  baseCreateSSEConnection: TCreate,
) {
  let cache = cacheByBaseCreate.get(baseCreateSSEConnection) as
    | Map<string, SharedEntry<TCreate>>
    | undefined
  if (!cache) {
    cache = new Map()
    cacheByBaseCreate.set(
      baseCreateSSEConnection,
      cache as Map<string, SharedEntry<CreateSSEConnectionLike>>,
    )
  }
  return cache
}

function invalidateEntryConnection<TCreate extends CreateSSEConnectionLike>(
  entry: SharedEntry<TCreate>,
  reason?: string,
  targetConnection?: null | ReturnType<TCreate>,
) {
  if (targetConnection && entry.connection !== targetConnection) {
    return
  }

  const connection = entry.connection
  if (connection) {
    connection.close(reason)
  }

  entry.connection = null
  entry.startPromise = null
}

function isConnectionClosed(connection: null | SSEConnectionLike): boolean {
  if (!connection) {
    return true
  }

  const closedState = connection.CLOSED ?? 2
  return connection.readyState === undefined ? false : connection.readyState === closedState
}

function isConnectionOpenOrConnecting(connection: null | SSEConnectionLike): boolean {
  if (!connection) {
    return false
  }

  const connectingState = connection.CONNECTING ?? 0
  const openState = connection.OPEN ?? 1
  const state = connection.readyState
  return state === connectingState || state === openState
}

function normalizeForCacheKey(value: unknown): unknown {
  if (value === undefined) {
    return '__undefined__'
  }

  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return value
  }

  if (typeof value === 'function') {
    return '__function__'
  }

  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'symbol') {
    return value.toString()
  }

  if (value instanceof Headers) {
    return Object.fromEntries(Array.from(value.entries()).sort(([a], [b]) => a.localeCompare(b)))
  }

  if (Array.isArray(value)) {
    return value.map(normalizeForCacheKey)
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, nestedValue]) => [key, normalizeForCacheKey(nestedValue)] as const)
    return Object.fromEntries(entries)
  }

  return String(value)
}

function normalizeUrlForCacheKey(url: string): string {
  try {
    const parsed = new URL(url, 'https://shared-sse.local')
    return `${parsed.pathname}${parsed.search}`
  } catch {
    return url
  }
}

function withDefaultLifecycleHandlers(handlers: SSEHandlers): SSEHandlers {
  return {
    complete: NOOP_EVENT_HANDLER,
    hello: NOOP_EVENT_HANDLER,
    ping: NOOP_EVENT_HANDLER,
    ...handlers,
  }
}
