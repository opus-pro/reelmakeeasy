import { Logger } from '@reelmakeeasy/common/utils/logger'

import { getAdapterSessionAtom } from '../adapter-atoms'

import type { BridgeContext } from './types'

const POLL_INTERVAL_MS = 2000

const nsLogger = Logger.get('story-mode-uip.polling')

export function createPollingController(params: {
  context: BridgeContext
  fetchAndSyncFromServer: () => Promise<void>
  isSseConnected: () => boolean
  shouldPoll: () => boolean
}) {
  const { context, fetchAndSyncFromServer, isSseConnected, shouldPoll } = params
  const { plannerState, pollQueue, runtimeState } = context

  function pollOnce() {
    if (runtimeState.stoppedForUnauthorized) {
      return
    }
    if (!runtimeState.waitingForFullSync) {
      const session = plannerState.get(getAdapterSessionAtom)
      if (session && !shouldPoll()) {
        return
      }
    }

    void pollQueue
      .push(async () => {
        if (!isSseConnected() || runtimeState.waitingForFullSync) {
          await fetchAndSyncFromServer()
        }
      })
      .catch((error: unknown) => {
        // A transient fetch rejection must not kill the poll loop; the interval
        // keeps firing and the next tick retries.
        nsLogger.warn('poll tick failed', error)
      })
  }

  function startPolling() {
    if (runtimeState.stoppedForUnauthorized) {
      return
    }
    if (runtimeState.pollIntervalId !== null) {
      return
    }
    runtimeState.pollIntervalId = setInterval(pollOnce, POLL_INTERVAL_MS)
  }

  function stopPolling() {
    if (runtimeState.pollIntervalId === null) {
      return
    }
    clearInterval(runtimeState.pollIntervalId)
    runtimeState.pollIntervalId = null
  }

  function stopPollingIfIdle() {
    if (runtimeState.stoppedForUnauthorized) {
      stopPolling()
      return
    }
    const session = plannerState.get(getAdapterSessionAtom)
    if (runtimeState.waitingForFullSync) {
      return
    }
    if (!isSseConnected()) {
      return
    }
    if (session && shouldPoll()) {
      return
    }
    stopPolling()
  }

  return {
    pollOnce,
    startPolling,
    stopPolling,
    stopPollingIfIdle,
  }
}
