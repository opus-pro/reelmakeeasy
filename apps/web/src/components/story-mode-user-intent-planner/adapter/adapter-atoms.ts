import { createWeakMapFn } from '@reelmakeeasy/common/utils/memo-fn'

import { createAtom, createNullableAtom } from '@/lib/jotai-atom-utils'

import type { SessionStatus } from '../state-types'

import type { Session } from './api-types'
import type { StateChanges } from './api-types'
import type { SimulatedEvent } from './optimistic-events'
import type { AdapterRuntime } from './runtime-types'

export interface AdapterTimelineMeta {
  gateToken: null | string
  isProcessingFromTimeline: boolean
  lastMessageType: 'assistant_message' | 'user_message' | null
  status: SessionStatus
}

export interface SessionStateSnapshot {
  state: StateChanges['state']
  version: number
}

export const getAdapterSessionAtom = createWeakMapFn(() =>
  createNullableAtom<Session>('storyModeUip/adapter/session'),
)

export const getAdapterRuntimeAtom = createWeakMapFn(() =>
  createNullableAtom<AdapterRuntime>('storyModeUip/adapter/runtime'),
)

// The session/project id `initializePlannerState` was last called with. A PlannerState
// object can outlive a single session -- callers may reuse the same object across a
// project switch without remounting -- so anything that must reset
// per-session (not just per-object) should key off this, not the object's own identity.
export const getAdapterSessionIdAtom = createWeakMapFn(() =>
  createNullableAtom<string>('storyModeUip/adapter/sessionId'),
)

export const getAdapterTimelineMetaAtom = createWeakMapFn(() =>
  createNullableAtom<AdapterTimelineMeta>('storyModeUip/adapter/timeline-meta'),
)

export const getSimulatedEventsAtom = createWeakMapFn(() =>
  createAtom<SimulatedEvent[]>([], 'storyModeUip/optimistic/simulatedEvents'),
)

export const getSessionStateAtom = createWeakMapFn(() =>
  createAtom<SessionStateSnapshot>(
    {
      state: {},
      version: 0,
    },
    'storyModeUip/adapter/sessionState',
  ),
)

export interface TranscriptEditingOptimisticOp {
  active: boolean
  clientId: string
  opId: string
  ts?: string
}

export const getTranscriptEditingOptimisticOpsAtom = createWeakMapFn(() =>
  createAtom<TranscriptEditingOptimisticOp[]>([], 'storyModeUip/optimistic/transcriptEditingOps'),
)
