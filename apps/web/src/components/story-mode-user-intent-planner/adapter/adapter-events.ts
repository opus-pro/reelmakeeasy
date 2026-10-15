import { createEventKey, Events } from '@reelmakeeasy/common/events'
import { createWeakMapFn } from '@reelmakeeasy/common/utils/memo-fn'

import type { SessionStatus } from '../state-types'

import type { StateChanges } from './api-types'

export const getAdapterEvents = createWeakMapFn(() => new Events())

export const sseConnectedEvent = createEventKey('sse-connected')

export const sseDisconnectedEvent = createEventKey('sse-disconnected')

export const unauthorizedEvent = createEventKey('unauthorized')

export const statusChangeEvent =
  createEventKey<[payload: { status: SessionStatus }]>('status-change')

export const pendingActionChangeEvent =
  createEventKey<[payload: { pendingAction: StateChanges['state']['pending_action'] }]>(
    'pending-action-change',
  )
