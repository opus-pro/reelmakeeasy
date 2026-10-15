import type { BatchChanges } from '../api-types'
import type { BackendResponseEvent } from '../optimistic-events'

export interface BridgeRuntimeState {
  // Optimistic backend response events waiting to be claimed by real timeline events.
  backendResponseEvents: BackendResponseEvent[]
  // Set to true once the runtime is disposed (e.g. when the planner re-initializes for a
  // new projectId on the same plannerState). A late-resolving getSession from this disposed
  // runtime must not apply its session, or it would overwrite the new runtime's state.
  disposed: boolean
  // Tracks in-flight DELETE requests for queue messages to avoid double-deleting.
  inFlightQueueDeletes: Map<string, Promise<void>>
  // Monotonically increasing counter used to assign local offsets to optimistic events.
  localOffsetCounter: number
  // SSE-delivered state and timeline changes buffered in arrival order, waiting to be
  // applied once the initial full session load has completed (or after a gap is resolved).
  pendingChanges: BatchChanges[]
  // Handle for the active polling interval, null when polling is stopped.
  pollIntervalId: null | ReturnType<typeof setInterval>
  // Queue message IDs that have been locally removed (optimistic delete) but not yet
  // confirmed by the server, used to suppress ghost re-appearances.
  removedQueueMessageIds: Set<string>
  // Set to true on a 401 response; terminates SSE and polling for this session.
  stoppedForUnauthorized: boolean
  // True when a version gap was detected in pending changes (state or timeline),
  // meaning we cannot apply deltas until a full sync restores a consistent baseline.
  // Keeps polling active until the gap is resolved.
  waitingForFullSync: boolean
}

export function createInitialBridgeRuntimeState(): BridgeRuntimeState {
  return {
    backendResponseEvents: [],
    disposed: false,
    inFlightQueueDeletes: new Map<string, Promise<void>>(),
    localOffsetCounter: 0,
    pendingChanges: [],
    pollIntervalId: null,
    removedQueueMessageIds: new Set<string>(),
    stoppedForUnauthorized: false,
    waitingForFullSync: false,
  }
}
