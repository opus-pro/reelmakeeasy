import {
  ActivityFailure,
  ApplicationFailure,
  CancelledFailure,
  TerminatedFailure,
  WorkflowFailedError,
} from '@reelmakeeasy/workflow-engine/common'

import { failureReason, wasStopped } from './workflow-outcome'

/** The engine's wrapping of an activity's own failure, as a workflow handle's result rejects. */
const wrapped = (cause: Error) =>
  new WorkflowFailedError(
    'Workflow execution failed',
    new ActivityFailure(
      'Activity task failed',
      'generateBeatLoopVoiceover',
      '1',
      'NON_RETRYABLE',
      cause,
    ),
  )

describe('failureReason', () => {
  it('is the innermost reason, the one the agent can act on', () => {
    const reason =
      'Narration too long for its clip even at 1.3x speed: clip 1 (s1) takes 4.6 s to say'
    expect(
      failureReason(wrapped(ApplicationFailure.nonRetryable(reason, 'BeatLoopLineTooLong'))),
    ).toBe(reason)
  })

  it('stops at a cause with no message, and says so when there is nothing', () => {
    expect(failureReason(new WorkflowFailedError('Workflow execution failed', new Error('')))).toBe(
      'Workflow execution failed',
    )
    expect(failureReason(undefined)).toBe('unknown error')
  })
})

describe('wasStopped', () => {
  it('is true for a cancelled or terminated run, at any depth', () => {
    expect(
      wasStopped(new WorkflowFailedError('Workflow execution cancelled', new CancelledFailure())),
    ).toBe(true)
    expect(wasStopped(wrapped(new CancelledFailure()))).toBe(true)
    expect(wasStopped(new WorkflowFailedError('x', new TerminatedFailure()))).toBe(true)
  })

  it('is false for a run that failed', () => {
    expect(wasStopped(wrapped(ApplicationFailure.nonRetryable('boom')))).toBe(false)
    expect(wasStopped(new Error('Timed out after 10 minutes.'))).toBe(false)
  })
})
