import type { UipSessionWorkflowParams } from '@reelmakeeasy/uip-planner-runtime'

import type { ProjectAndPersistInput } from '../../activities/uip-v2/project-and-persist'

import { sessionSyncLoop } from './sync-loop'
import type { AgentEvent, WorkflowState } from './types'

jest.mock('@reelmakeeasy/workflow-engine/workflow', () => ({
  ...jest.requireActual('@reelmakeeasy/workflow-engine/workflow'),
  // Wake the loop at once instead of waiting inside a workflow context.
  condition: jest.fn(async () => true),
}))

const userMessage: AgentEvent = {
  at: 1,
  message: 'hi',
  messageId: 'm1',
  timestamp: '2026-01-01T00:00:00.000Z',
  type: 'user_message',
}

describe('sessionSyncLoop', () => {
  it('persists with the event log passed inline', async () => {
    const state = {
      currentArtifacts: {},
      events: [userMessage],
      idleTimeoutMs: 60_000,
      isCancelled: false,
      isFailed: false,
      isLocked: false,
      isTimedOut: false,
      mainLoopDone: false,
    } as unknown as WorkflowState
    const persist = jest.fn(async (_input: ProjectAndPersistInput) => {
      state.mainLoopDone = true
    })

    await sessionSyncLoop(state, { projectId: 'p1' } as UipSessionWorkflowParams, persist)

    expect(persist).toHaveBeenCalledTimes(1)
    const input = persist.mock.calls[0][0]
    expect(input.events).toBe(state.events)
    expect(input).toMatchObject({ currentArtifacts: {}, projectId: 'p1' })
  })
})
