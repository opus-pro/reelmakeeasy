import { getAdapterSessionAtom } from '../adapter-atoms'
import type { BatchChanges, Session } from '../api-types'
import { applyTimelineChangesToSession } from '../timeline-changes'

import type { BridgeContext } from './types'

export function createChangesSync(params: {
  applySession: (session: Session) => void
  context: BridgeContext
  requestFullSync: () => void
  startPolling: () => void
  stopPollingIfIdle: () => void
}) {
  const { applySession, context, requestFullSync, startPolling, stopPollingIfIdle } = params
  const { plannerState, runtimeState } = context

  const dropStale = (): void => {
    const current = plannerState.get(getAdapterSessionAtom)
    if (!current) {
      return
    }
    const stateVersion = current.state_version ?? 0
    const timelineVersion = current.timeline.version
    runtimeState.pendingChanges = runtimeState.pendingChanges.filter((c) =>
      c.kind === 'state' ? c.version > stateVersion : c.version > timelineVersion,
    )
  }

  // Applies pending changes in arrival order. State patches are applied in memory;
  // timeline changes are applied sequentially and stop on a version gap.
  // A single applySession call is made at the end with the fully accumulated session.
  const tryApplyPending = (): void => {
    const initial = plannerState.get(getAdapterSessionAtom)
    if (!initial) {
      return
    }
    dropStale()

    let nextSession = initial

    const { pendingChanges } = runtimeState

    while (pendingChanges.length > 0) {
      const change = pendingChanges[0]

      if (change.kind === 'state') {
        if (change.version !== (nextSession.state_version ?? 0) + 1) {
          runtimeState.waitingForFullSync = true
          startPolling()
          break
        }
        nextSession = {
          ...nextSession,
          state: { ...nextSession.state, ...change.state },
          state_version: change.version,
        }
        pendingChanges.shift()
      } else {
        if (change.version !== nextSession.timeline.version + 1) {
          runtimeState.waitingForFullSync = true
          startPolling()
          break
        }
        const result = applyTimelineChangesToSession({ changes: change, current: nextSession })
        if (result.requiresResync) {
          runtimeState.waitingForFullSync = true
          startPolling()
          break
        }
        nextSession = result.next
        pendingChanges.shift()
      }
    }

    if (nextSession !== initial) {
      applySession(nextSession)
    }

    if (pendingChanges.length === 0) {
      runtimeState.waitingForFullSync = false
      stopPollingIfIdle()
    }
  }

  const handleChanges = (changes: BatchChanges[]): void => {
    for (const change of changes) {
      runtimeState.pendingChanges.push(change)
    }
    const current = plannerState.get(getAdapterSessionAtom)
    if (!current) {
      runtimeState.waitingForFullSync = true
      startPolling()
      void requestFullSync()
      return
    }
    tryApplyPending()
  }

  return { handleChanges, tryApplyPending }
}
