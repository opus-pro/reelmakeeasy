import { CoalescingQueue } from '@reelmakeeasy/common/utils/coalescing-queue'

import type { CreateSSEConnection } from '@/hooks/useApi'

import { sseConnectedEvent, sseDisconnectedEvent, unauthorizedEvent } from '../adapter-events'
import { isUnauthorizedApiError } from '../api-adapter'
import type { BatchChanges } from '../api-types'
import { createSessionSSE } from '../session-sse'

import { createChangesSync } from './changes-sync'
import { createPollingController } from './polling'
import type { BridgeContext } from './types'

export function createSyncRuntime(params: {
  applySession: (session: import('../api-types').Session) => void
  context: BridgeContext
  createSSEConnection: CreateSSEConnection
  sessionId: string
  shouldPoll: () => boolean
}) {
  const { applySession, context, createSSEConnection, sessionId, shouldPoll } = params
  const { apiClient, events } = context

  let pollingController: null | ReturnType<typeof createPollingController> = null
  const syncQueue = new CoalescingQueue<void>()
  let consecutiveUnauthorizedCount = 0

  const fetchAndSyncFromServer = async () => {
    try {
      const next = await apiClient.getSession()
      consecutiveUnauthorizedCount = 0
      if (context.runtimeState.disposed) {
        // The runtime was disposed/superseded while this fetch was in flight (e.g. a new
        // projectId re-initialized on the same plannerState). Applying now would write this
        // stale session over the new runtime's state.
        return
      }
      applySession(next)
      changesSync.tryApplyPending()
    } catch (error) {
      if (isUnauthorizedApiError(error)) {
        consecutiveUnauthorizedCount++
        if (consecutiveUnauthorizedCount >= 2) {
          stopForUnauthorized()
          events.emit(unauthorizedEvent)
        }
        return
      }
      consecutiveUnauthorizedCount = 0
      throw error
    }
  }
  const enqueueFetchAndSyncFromServer = () => syncQueue.push(fetchAndSyncFromServer)

  const changesSync = createChangesSync({
    applySession,
    context,
    requestFullSync: enqueueFetchAndSyncFromServer,
    startPolling: () => pollingController?.startPolling(),
    stopPollingIfIdle: () => pollingController?.stopPollingIfIdle(),
  })

  const stopForUnauthorized = () => {
    // 401 is terminal for this session; stop SSE/polling instead of retrying.
    if (context.runtimeState.stoppedForUnauthorized) {
      return
    }
    context.runtimeState.stoppedForUnauthorized = true
    pollingController?.stopPolling()
    sseController.dispose()
  }

  const handleBatchChanges = (batch: BatchChanges[]) => {
    changesSync.handleChanges(batch)
  }

  const sseController = createSessionSSE({
    createSSEConnection,
    events,
    onBatchChanges: handleBatchChanges,
    sessionId,
  })

  pollingController = createPollingController({
    context,
    fetchAndSyncFromServer: enqueueFetchAndSyncFromServer,
    isSseConnected: () => sseController.isConnected(),
    shouldPoll,
  })

  const unsubConnected = events.subscribe(sseConnectedEvent, () => {
    pollingController?.stopPollingIfIdle()
    // After SSE reconnect/open, force one full pull to close any gap
    // between last received delta and current server timeline/state.
    void enqueueFetchAndSyncFromServer().catch(() => {
      // Non-auth errors are handled by polling fallback; keep reconnect path resilient.
    })
  })
  const unsubDisconnected = events.subscribe(sseDisconnectedEvent, () => {
    if (!context.runtimeState.stoppedForUnauthorized) {
      pollingController?.startPolling()
      // Force one full pull now. `shouldPoll` reads the server-lagged timeline,
      // so right after an optimistic send it can skip a turn whose SSE delivery
      // silently stalled; the unconditional pull recovers that turn.
      void enqueueFetchAndSyncFromServer().catch(() => {
        // Non-auth errors are handled by the polling fallback.
      })
    }
  })
  const unsubUnauthorized = events.subscribe(unauthorizedEvent, stopForUnauthorized)

  // Background-tab timer throttling can delay the reconnect/liveness timers for
  // minutes, so a stalled session does not self-heal until the user interacts.
  // Resync the moment the tab returns to the foreground.
  const handleVisibilityChange = () => {
    if (document.visibilityState !== 'visible' || context.runtimeState.stoppedForUnauthorized) {
      return
    }
    if (!sseController.isConnected()) {
      sseController.reconnect()
    }
    void enqueueFetchAndSyncFromServer().catch(() => void 0)
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleVisibilityChange)
  }

  return {
    fetchAndSyncFromServer: enqueueFetchAndSyncFromServer,
    isSseConnected: () => sseController.isConnected(),
    pollOnce: () =>
      context.runtimeState.stoppedForUnauthorized ? undefined : pollingController?.pollOnce(),
    startPolling: () =>
      context.runtimeState.stoppedForUnauthorized ? undefined : pollingController?.startPolling(),
    stopPolling: () => pollingController?.stopPolling(),
    dispose: () => {
      context.runtimeState.disposed = true
      unsubConnected()
      unsubDisconnected()
      unsubUnauthorized()
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange)
      }
      sseController.dispose()
    },
    startSse: () => sseController.start(),
  }
}
