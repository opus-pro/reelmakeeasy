import type { TranscriptEntry } from '@reelmakeeasy/common/codex-agent/agent-transcript'
import type { AgentSession } from '@shared/types/api/agent'

import { canPickUp, expiredHintsFor, resumeRefusedNotice } from './resume-chat'

const SESSION: AgentSession = {
  createdAt: '2026-10-12T06:41:42.823Z',
  flowActive: false,
  id: '35c1713f-3b92-4712-b86b-627094743532',
  interrupted: true,
  mode: 'autonomous',
  projectId: null,
  status: 'stopped',
  threadId: null,
  title: 'The Islands Where You Can See Tomorrow',
}

/** The camera card, expired by the restart. */
const EXPIRED: TranscriptEntry[] = [
  { id: 'autonomous-camera-3', kind: 'question', questions: [], server: true, state: 'expired' },
  { id: 'n201', kind: 'notice', text: 'ReelMakeEasy is shutting down' },
]

describe('canPickUp', () => {
  it('offers it for an Easy chat a restart cut off before its video started', () => {
    expect(canPickUp(SESSION, EXPIRED, false)).toBe(true)
  })

  it('not for a chat the user stopped, a failed or finished one, or one never cut off', () => {
    expect(canPickUp({ ...SESSION, interrupted: false }, EXPIRED, false)).toBe(false)
    expect(canPickUp({ ...SESSION, interrupted: undefined }, EXPIRED, false)).toBe(false)
  })

  it('not once a video was started: its own progress shows instead', () => {
    expect(canPickUp({ ...SESSION, projectId: 'p1' }, EXPIRED, false)).toBe(false)
    const started: TranscriptEntry[] = [
      ...EXPIRED,
      { id: 'video-p1', kind: 'video', projectId: 'p1' },
    ]
    expect(canPickUp(SESSION, started, false)).toBe(false)
  })

  it('not for Free chat, an edited video, or while the flow runs again', () => {
    expect(canPickUp({ ...SESSION, mode: 'free' }, EXPIRED, false)).toBe(false)
    expect(canPickUp({ ...SESSION, editing: true }, EXPIRED, false)).toBe(false)
    expect(canPickUp(SESSION, EXPIRED, true)).toBe(false)
    expect(canPickUp(null, EXPIRED, false)).toBe(false)
  })
})

describe('expiredHintsFor', () => {
  const easy = { editing: false, flowActive: false, mode: 'autonomous' as const, pickUp: false }

  it('an Easy chat that can pick up: no advice to reply or start over, the button carries on', () => {
    expect(expiredHintsFor({ ...easy, pickUp: true })).toEqual({
      question: 'This question expired.',
      style: 'This step expired.',
    })
  })

  it('an Easy chat picked up again: its fresh card follows below', () => {
    expect(expiredHintsFor({ ...easy, flowActive: true })?.style).toBe('This step expired.')
  })

  it('an Easy chat that cannot pick up (stopped, failed, refused) keeps "start a new session" on its style card', () => {
    const hints = expiredHintsFor(easy)
    expect(hints?.question).toBe('This question expired.')
    // Undefined: the style card's own words, "This step expired. Start a new session to try again."
    expect(hints?.style).toBeUndefined()
  })

  it("Free chat and an edited video keep the cards' own words", () => {
    expect(expiredHintsFor({ ...easy, mode: 'free', pickUp: true })).toBeUndefined()
    expect(expiredHintsFor({ ...easy, editing: true, pickUp: true })).toBeUndefined()
    expect(expiredHintsFor({ ...easy, mode: null })).toBeUndefined()
  })
})

describe('resumeRefusedNotice', () => {
  it("says the API's plain reason for a refusal: nothing to pick up (409), or a restart (503)", () => {
    expect(
      resumeRefusedNotice(409, 'You stopped this chat. Start a new chat to make a video.'),
    ).toBe('You stopped this chat. Start a new chat to make a video.')
    expect(resumeRefusedNotice(503, 'ReelMakeEasy is restarting. Try again in a moment.')).toBe(
      'ReelMakeEasy is restarting. Try again in a moment.',
    )
  })

  it('anything else, or no reason given: a plain try again', () => {
    const tryAgain = "Couldn't pick up where you left off. Try again."
    expect(resumeRefusedNotice(500, 'Internal server error')).toBe(tryAgain)
    expect(resumeRefusedNotice(undefined, 'Failed to fetch')).toBe(tryAgain)
    expect(resumeRefusedNotice(503, '')).toBe(tryAgain)
  })
})
