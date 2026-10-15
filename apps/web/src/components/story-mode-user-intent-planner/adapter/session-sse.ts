import type { Events } from '@reelmakeeasy/common/events'

import type { CreateSSEConnection } from '@/hooks/useApi'
import type { SSEHandlers } from '@/util/sse'

import { sseConnectedEvent, sseDisconnectedEvent, unauthorizedEvent } from './adapter-events'
import { isUnauthorizedApiError } from './api-adapter'
import type { BatchChanges } from './api-types'

const BASE_RECONNECT_DELAY_MS = 1_000
const MAX_RECONNECT_ATTEMPTS = 30
// Server emits `ping` every 10s. If no event of any kind arrives in 3x that
// window we treat the connection as dead. Covers silent connection death
// (CDN middlebox timeouts, backgrounded-tab throttling, dropped TCP without
// RST) where the EventSource stays "open" and `error` never fires.
const LIVENESS_TIMEOUT_MS = 30_000
// The liveness watchdog only arms once a frame arrives, and SSEConnection's
// `hello` timeout only arms after the fetch resolves. A fetch that hangs before
// response headers (proxy accepts the socket but never flushes) arms neither, so
// nothing ever surfaces the failure. This deadline bounds the time to reach
// `connected` and routes a stuck connect through the normal reconnect path.
const CONNECT_TIMEOUT_MS = 12_000

export interface SessionSSEController {
  dispose: () => void
  isConnected: () => boolean
  reconnect: () => void
  start: () => void
}

export function createSessionSSE(params: {
  createSSEConnection: CreateSSEConnection
  events: Events
  onBatchChanges: (changes: BatchChanges[]) => void
  sessionId: string
}): SessionSSEController {
  const { createSSEConnection, events, onBatchChanges, sessionId } = params
  const url = `/api/uip-sessions/${sessionId}/stream`

  let sse: null | ReturnType<CreateSSEConnection> = null
  let reconnectAttempts = 0
  let reconnectTimer: null | ReturnType<typeof setTimeout> = null
  let livenessTimer: null | ReturnType<typeof setTimeout> = null
  let connectDeadlineTimer: null | ReturnType<typeof setTimeout> = null
  let isDisposed = false
  let isStarted = false
  let connected = false
  // Incremented per connect attempt. A superseded attempt is closed on reconnect,
  // but its aborted fetch can reject later; that stale error carries the epoch it
  // was created with and is ignored once a newer attempt has started, so it can't
  // tear down the healthy replacement and cause reconnect churn.
  let connectEpoch = 0

  function markConnected() {
    const wasConnected = connected
    connected = true
    clearConnectDeadline()
    if (!wasConnected) {
      events.emit(sseConnectedEvent)
    }
  }

  function handleError(error?: unknown, epoch?: number) {
    if (epoch !== undefined && epoch !== connectEpoch) {
      return
    }
    connected = false
    disarmLivenessWatchdog()
    clearConnectDeadline()
    const isUnauthorized = isUnauthorizedApiError(error)
    if (isUnauthorized) {
      events.emit(unauthorizedEvent)
    }
    events.emit(sseDisconnectedEvent)
    if (isUnauthorized) {
      dispose()
      return
    }
    scheduleReconnect()
  }

  // Watchdog pattern: each received event re-arms the timeout. If it fires,
  // we route through handleError so the existing exponential-backoff and
  // MAX_RECONNECT_ATTEMPTS cap apply (calling reconnect() directly would
  // bypass them and could hammer the server during a real outage).
  function armLivenessWatchdog() {
    if (livenessTimer) {
      clearTimeout(livenessTimer)
    }
    livenessTimer = setTimeout(() => {
      livenessTimer = null
      if (!connected) {
        return
      }
      handleError(new Error(`SSE liveness timeout (no events for ${LIVENESS_TIMEOUT_MS}ms)`))
    }, LIVENESS_TIMEOUT_MS)
  }

  function disarmLivenessWatchdog() {
    if (livenessTimer) {
      clearTimeout(livenessTimer)
      livenessTimer = null
    }
  }

  // Fires if the connection never reaches `connected` (no `hello`). Routes
  // through handleError so the existing backoff/reconnect path applies, rather
  // than leaving the UI stuck on a silently-hung connect.
  function armConnectDeadline(epoch: number) {
    clearConnectDeadline()
    connectDeadlineTimer = setTimeout(() => {
      connectDeadlineTimer = null
      if (!connected && epoch === connectEpoch) {
        handleError(
          new Error(`SSE connect timeout (no hello within ${CONNECT_TIMEOUT_MS}ms)`),
          epoch,
        )
      }
    }, CONNECT_TIMEOUT_MS)
  }

  function clearConnectDeadline() {
    if (connectDeadlineTimer) {
      clearTimeout(connectDeadlineTimer)
      connectDeadlineTimer = null
    }
  }

  // Wraps every event handler so any received event re-arms the watchdog.
  // Centralising this here prevents new handlers added later from silently
  // breaking liveness detection.
  function withLivenessTouch(handlers: SSEHandlers): SSEHandlers {
    const wrapped: SSEHandlers = { ...handlers }
    for (const key of Object.keys(handlers)) {
      if (key === 'error') {
        continue
      }
      const original = handlers[key]
      wrapped[key] = (payload) => {
        armLivenessWatchdog()
        original?.(payload)
      }
    }
    return wrapped
  }

  function connectSSE() {
    if (isDisposed || !isStarted) {
      return
    }

    connected = false
    disarmLivenessWatchdog()
    const epoch = ++connectEpoch
    sse?.close()
    sse = createSSEConnection(
      url,
      withLivenessTouch({
        hello: () => {
          if (isDisposed || epoch !== connectEpoch) {
            return
          }
          reconnectAttempts = 0
          markConnected()
        },
        ping: () => void 0,
        message: () => void 0,
        batch_changes: (payload) => {
          if (isDisposed || epoch !== connectEpoch) {
            return
          }
          let json: BatchChanges[] | undefined
          try {
            json = JSON.parse(payload.data)
          } catch {
            // ignore malformed payloads
          }
          if (json) {
            onBatchChanges(json)
          }
        },
        error: (payload) => handleError(payload.raw_error ?? payload.data, epoch),
      }),
    )
    void sse.start().catch((error: unknown) => handleError(error, epoch))
    armConnectDeadline(epoch)
  }

  function scheduleReconnect() {
    if (isDisposed || !isStarted || reconnectAttempts >= MAX_RECONNECT_ATTEMPTS || reconnectTimer) {
      return
    }
    const delay = Math.min(BASE_RECONNECT_DELAY_MS * 2 ** reconnectAttempts, 60_000)
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null
      reconnectAttempts++
      connectSSE()
    }, delay)
  }

  function start() {
    if (isStarted || isDisposed) {
      return
    }
    isStarted = true
    connectSSE()
  }

  function reconnect() {
    if (isDisposed) {
      return
    }
    reconnectAttempts = 0
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    connectSSE()
  }

  function dispose() {
    if (isDisposed) {
      return
    }
    isDisposed = true
    isStarted = false
    connected = false
    if (reconnectTimer) {
      clearTimeout(reconnectTimer)
      reconnectTimer = null
    }
    disarmLivenessWatchdog()
    clearConnectDeadline()
    sse?.close()
    sse = null
  }

  return { dispose, isConnected: () => connected, reconnect, start }
}
