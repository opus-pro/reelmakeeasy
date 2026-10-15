import type { Events } from '@reelmakeeasy/common/events'
import { CoalescingQueue } from '@reelmakeeasy/common/utils/coalescing-queue'

import type { PlannerState } from '../../state/planner-state'
import type { UipApiAdapter } from '../api-adapter'

import type { BridgeRuntimeState } from './runtime-state'

export interface BridgeContext {
  apiClient: UipApiAdapter
  cdnOrigin: string
  events: Events
  plannerState: PlannerState
  pollQueue: CoalescingQueue<void>
  runtimeState: BridgeRuntimeState
  sessionId: string
}
