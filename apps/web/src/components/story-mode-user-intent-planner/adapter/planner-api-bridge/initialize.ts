import { CoalescingQueue } from '@reelmakeeasy/common/utils/coalescing-queue'
import { Logger } from '@reelmakeeasy/common/utils/logger'

import type { CreateSSEConnection, FetchApiDomain } from '@/hooks/useApi'

import { getApiAtom } from '../../state/atoms/planner'
import { getPlannerFatalErrorAtom } from '../../state/atoms/planner'
import { getPlannerEvents } from '../../state/events/planner-events'
import type { PlannerState } from '../../state/planner-state'
import {
  getAdapterRuntimeAtom,
  getAdapterSessionIdAtom,
  getAdapterTimelineMetaAtom,
  getSessionStateAtom,
  getTranscriptEditingOptimisticOpsAtom,
} from '../adapter-atoms'
import { unauthorizedEvent } from '../adapter-events'
import { createApiAdapter } from '../api-adapter'
import type { AdapterRuntime } from '../runtime-types'

import { getUipClientId } from './client-id'
import { createPlannerApi } from './planner-api-factory'
import { createInitialBridgeRuntimeState } from './runtime-state'
import { getGateTokenOrThrow, shouldPollSession } from './selectors'
import { createSessionSync } from './session-sync'
import { applySessionStateChanges } from './state-sync'
import { createSyncRuntime } from './sync-runtime'
import type { BridgeContext } from './types'
import { registerUserOperationHeartbeat } from './user-operation-heartbeat'

const nsLogger = Logger.get('story-mode-uip.session-sync')

export function initializePlannerState(params: {
  cdnOrigin: string
  createSSEConnection: CreateSSEConnection
  fetchApiDomain: FetchApiDomain
  plannerState: PlannerState
  sessionId: string
}): void {
  const { cdnOrigin, createSSEConnection, fetchApiDomain, plannerState, sessionId } = params

  plannerState.get(getAdapterRuntimeAtom)?.dispose()

  const apiClient = createApiAdapter(fetchApiDomain, sessionId)
  plannerState.set(getPlannerFatalErrorAtom, null)
  plannerState.set(getAdapterSessionIdAtom, sessionId)
  plannerState.set(getAdapterTimelineMetaAtom, null)
  plannerState.set(getSessionStateAtom, {
    state: {},
    version: 0,
  })
  plannerState.set(getTranscriptEditingOptimisticOpsAtom, [])
  const events = getPlannerEvents(plannerState)
  const runtimeState = createInitialBridgeRuntimeState()

  const context: BridgeContext = {
    apiClient,
    cdnOrigin,
    events,
    plannerState,
    pollQueue: new CoalescingQueue<void>(),
    runtimeState,
    sessionId,
  }

  const sessionSync = createSessionSync(context)
  const { applySession, reapplySession } = sessionSync
  const clientId = getUipClientId(sessionId)
  let unregisterUserOperationHeartbeat: (() => void) | null = null

  const unregisterUnauthorizedListener = events.subscribe(unauthorizedEvent, () => {
    runtimeState.stoppedForUnauthorized = true
    unregisterUserOperationHeartbeat?.()
    unregisterUserOperationHeartbeat = null
    plannerState.set(getPlannerFatalErrorAtom, {
      type: 'unauthorized',
    })
  })

  const syncRuntime = createSyncRuntime({
    applySession,
    context,
    createSSEConnection,
    sessionId,
    shouldPoll: () => shouldPollSession(plannerState),
  })

  const runtime: AdapterRuntime = {
    applySession,
    dispose: () => {
      unregisterUnauthorizedListener()
      unregisterUserOperationHeartbeat?.()
      unregisterUserOperationHeartbeat = null
      syncRuntime.stopPolling()
      syncRuntime.dispose()
    },
    start: () => {
      if (runtimeState.stoppedForUnauthorized) {
        return
      }
      unregisterUserOperationHeartbeat?.()
      unregisterUserOperationHeartbeat = registerUserOperationHeartbeat({
        plannerState,
        projectId: sessionId,
        sendHeartbeat: async () => {
          const changes = await apiClient.sendUserOperationHeartbeat(clientId)
          if (changes) {
            const applied = applySessionStateChanges(plannerState, changes, true)
            if (applied) {
              reapplySession()
            }
          }
        },
      })
      void syncRuntime.fetchAndSyncFromServer().catch((error: unknown) => {
        nsLogger.warn('startup session fetch failed', error)
      })
      syncRuntime.startSse()
    },
  }

  const api = createPlannerApi({
    context,
    fetchAndSyncFromServer: syncRuntime.fetchAndSyncFromServer,
    getGateTokenOrThrow: () => getGateTokenOrThrow(plannerState),
    isSseConnected: () => syncRuntime.isSseConnected(),
    reapplySession,
  })

  plannerState.set(getApiAtom, api)
  plannerState.set(getAdapterRuntimeAtom, runtime)
}
