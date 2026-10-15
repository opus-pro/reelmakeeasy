import { createMapFn, createWeakMapFn } from '@reelmakeeasy/common/utils/memo-fn'

import { createBaseState } from '@/lib/jotai-base-state'
import type { JotaiStore } from '@/lib/jotai-types'

import type { PlannerState } from './planner-state'

export type ScriptTranscriptState = ReturnType<typeof createScriptTranscriptState>
export type TranscriptEditScope = PlannerState | ScriptTranscriptState

let NEXT_SCRIPT_TRANSCRIPT_STATE_ID = 0

export function createScriptTranscriptState(store: JotaiStore) {
  return {
    ...createBaseState(store),
    id: NEXT_SCRIPT_TRANSCRIPT_STATE_ID++,
  }
}

export const getScriptTranscriptStateByPlanner = createWeakMapFn((plannerState: PlannerState) =>
  createMapFn((blockId: string) => createScriptTranscriptState(plannerState.store)),
)
