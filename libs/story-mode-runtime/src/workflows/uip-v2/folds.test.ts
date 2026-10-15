import {
  CONTINUE_AS_NEW_EVENTS_THRESHOLD,
  CONTINUE_AS_NEW_HISTORY_SIZE_THRESHOLD,
  CONTINUE_AS_NEW_HISTORY_THRESHOLD,
  shouldContinueAsNew,
} from './compaction'
import { consecutivePlannerPatchWakes, countDecisionWorthy, eventCountsAsDecision } from './folds'
import type { AgentEvent, WorkflowState } from './types'

const TS = '2026-01-01T00:00:00.000Z'

const specPatched = (source: 'planner' | 'system'): AgentEvent => ({
  at: 1,
  ops: [],
  source,
  specVersionAfter: 1,
  timestamp: TS,
  type: 'spec_patched',
})

const userMessage: AgentEvent = {
  at: 1,
  message: 'hi',
  messageId: 'm1',
  timestamp: TS,
  type: 'user_message',
}

const phaseChanged: AgentEvent = {
  at: 1,
  fromPhase: 'brand_review',
  reason: 'user_confirm_brand_review',
  timestamp: TS,
  toPhase: 'bootstrap_script',
  type: 'phase_changed',
}

describe('decision-worthy events', () => {
  it('counts a planner spec_patched so the planner re-wakes after its own patch', () => {
    expect(eventCountsAsDecision(specPatched('planner'))).toBe(true)
    expect(eventCountsAsDecision(specPatched('system'))).toBe(false)
    expect(countDecisionWorthy([userMessage, specPatched('planner'), specPatched('system')])).toBe(
      2,
    )
  })
})

describe('consecutivePlannerPatchWakes', () => {
  it('counts trailing planner patches and resets at a phase advance', () => {
    expect(consecutivePlannerPatchWakes([specPatched('planner'), specPatched('planner')])).toBe(2)
    expect(
      consecutivePlannerPatchWakes([specPatched('planner'), phaseChanged, specPatched('planner')]),
    ).toBe(1)
  })
})

describe('shouldContinueAsNew', () => {
  const state = (events = 0) =>
    ({ events: Array.from({ length: events }, () => userMessage) }) as unknown as WorkflowState

  it('hands off on event count, log length, or history bytes over the ceiling', () => {
    expect(
      shouldContinueAsNew(state(), { historyLength: CONTINUE_AS_NEW_HISTORY_THRESHOLD + 1 }),
    ).toBe(true)
    expect(
      shouldContinueAsNew(state(CONTINUE_AS_NEW_EVENTS_THRESHOLD + 1), { historyLength: 1 }),
    ).toBe(true)
    expect(
      shouldContinueAsNew(state(), {
        historyLength: 1,
        historySize: CONTINUE_AS_NEW_HISTORY_SIZE_THRESHOLD + 1,
      }),
    ).toBe(true)
  })

  it('keeps running below every threshold', () => {
    expect(shouldContinueAsNew(state(), { historyLength: 1, historySize: 20_000_001 })).toBe(false)
  })
})
