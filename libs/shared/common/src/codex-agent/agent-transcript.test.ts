import type { AgentQuestion, AgentUiEvent } from '@shared/types/api/agent'

import { initialTranscript, reduceTranscript, type TranscriptAction } from './agent-transcript'

const run = (events: AgentUiEvent[]) => events.reduce(reduceTranscript, initialTranscript)

const questions: AgentQuestion[] = [
  {
    header: 'Style',
    id: 'q1-a',
    isOther: false,
    isSecret: false,
    options: [{ description: '', label: 'Bold' }],
    question: 'Which style?',
  },
]

describe('reduceTranscript', () => {
  it('builds one assistant entry from deltas and replaces it with the final message', () => {
    const t = run([
      { id: 1, text: 'hi', type: 'user_message' },
      { id: 2, status: 'started', type: 'turn' },
      { id: 3, itemId: 'm', text: 'Hel', type: 'text_delta' },
      { id: 4, itemId: 'm', text: 'lo', type: 'text_delta' },
      { id: 5, itemId: 'm', text: 'Hello!', type: 'message' },
      { id: 6, status: 'completed', type: 'turn' },
    ])
    expect(t.entries.map((e) => [e.kind, e.text])).toEqual([
      ['user', 'hi'],
      ['assistant', 'Hello!'],
    ])
    expect(t.working).toBe(false)
    expect(t.lastEventId).toBe(6)
  })

  it('updates one tool chip per call and adds images', () => {
    const t = run([
      {
        id: 1,
        itemId: 't',
        status: 'started',
        summary: 'upload_keyframe',
        tool: 'upload_keyframe',
        type: 'tool',
      },
      {
        id: 2,
        itemId: 't',
        status: 'completed',
        summary: 'upload_keyframe',
        tool: 'upload_keyframe',
        type: 'tool',
      },
      { id: 3, itemId: 'i', path: '/x/a.png', type: 'image' },
    ])
    expect(t.entries).toEqual([
      { id: 't', kind: 'tool', status: 'completed', text: 'upload_keyframe' },
      { id: 'i', kind: 'image', src: '/x/a.png', status: 'done' },
    ])
  })

  it('shows failures and stops as notices and ignores already-seen ids', () => {
    const t = run([
      { id: 1, error: 'rate limited', status: 'failed', type: 'turn' },
      { id: 2, reason: 'Codex stopped (exit 1)', status: 'stopped', type: 'session' },
      { id: 2, reason: 'dup', status: 'stopped', type: 'session' },
    ])
    expect(t.entries.map((e) => e.text)).toEqual(['rate limited', 'Codex stopped (exit 1)'])
  })

  it('names no harness when a stop comes without a reason', () => {
    const t = run([{ id: 1, status: 'stopped', type: 'session' }])
    expect(t.entries.map((e) => e.text)).toEqual(['The agent stopped'])
  })

  it('shows a session event with a reason as a notice without ending the turn', () => {
    const t = run([
      { id: 1, text: 'hi', type: 'user_message' },
      {
        id: 2,
        reason: 'Codex could not resume the earlier conversation; started a new one.',
        status: 'running',
        type: 'session',
      },
      { id: 3, status: 'running', type: 'session' },
    ])
    expect(t.entries.map((e) => [e.kind, e.text])).toEqual([
      ['user', 'hi'],
      ['notice', 'Codex could not resume the earlier conversation; started a new one.'],
    ])
    expect(t.working).toBe(true)
  })

  it('adds local notices without touching working or lastEventId', () => {
    const t = [
      { id: 1, text: 'hi', type: 'user_message' } as const,
      { noticeId: 'local-1', text: 'Codex is still working', type: 'local_notice' } as const,
    ].reduce(reduceTranscript, initialTranscript)
    expect(t.entries.at(-1)).toEqual({
      id: 'local-1',
      kind: 'notice',
      text: 'Codex is still working',
    })
    expect(t.working).toBe(true)
    expect(t.lastEventId).toBe(1)
  })

  it('gives notices from id-less events unique ids', () => {
    const t = run([
      { error: 'a', status: 'failed', type: 'turn' },
      { error: 'b', status: 'failed', type: 'turn' },
    ])
    const ids = t.entries.map((e) => e.id)
    expect(new Set(ids).size).toBe(2)
    expect(ids.some((id) => id.includes('undefined'))).toBe(false)
  })

  // Rule 1
  it('starts a thinking entry and sets the activity to Thinking…', () => {
    const t = run([{ id: 1, itemId: 'r1', status: 'started', text: '', type: 'thinking' }])
    expect(t.entries).toEqual([{ id: 'r1', kind: 'thinking', status: 'started', text: '' }])
    expect(t.activity).toEqual({ id: 'r1', label: 'Thinking…' })
  })

  // Rule 2
  it('accumulates thinking_delta text, creating the entry if missing', () => {
    const t = run([
      { id: 1, itemId: 'r1', text: 'A', type: 'thinking_delta' },
      { id: 2, itemId: 'r1', text: 'B', type: 'thinking_delta' },
    ])
    expect(t.entries).toEqual([{ id: 'r1', kind: 'thinking', status: 'started', text: 'AB' }])
  })

  // Rule 3
  it('completes a thinking entry with its own text and clears the matching activity', () => {
    const t = run([
      { id: 1, itemId: 'r1', status: 'started', text: '', type: 'thinking' },
      { id: 2, itemId: 'r1', status: 'completed', text: 'Final', type: 'thinking' },
    ])
    expect(t.entries).toEqual([{ id: 'r1', kind: 'thinking', status: 'completed', text: 'Final' }])
    expect(t.activity).toBeNull()
  })

  // Rule 4
  it('keeps accumulated delta text when the completed event carries no text', () => {
    const t = run([
      { id: 1, itemId: 'r1', text: 'A', type: 'thinking_delta' },
      { id: 2, itemId: 'r1', text: 'B', type: 'thinking_delta' },
      { id: 3, itemId: 'r1', status: 'completed', text: '', type: 'thinking' },
    ])
    expect(t.entries).toEqual([{ id: 'r1', kind: 'thinking', status: 'completed', text: 'AB' }])
  })

  // Rule 5
  it('removes the thinking entry when completed empty with no prior deltas', () => {
    const t = run([
      { id: 1, itemId: 'r1', status: 'started', text: '', type: 'thinking' },
      { id: 2, itemId: 'r1', status: 'completed', text: '', type: 'thinking' },
    ])
    expect(t.entries).toEqual([])
    expect(t.activity).toBeNull()
  })

  // Rule 6
  it('starts a command entry and sets a Running activity, shortened past 60 chars', () => {
    const longCommand = `npm test ${'x'.repeat(60)}`
    const t = run([
      { id: 1, command: longCommand, itemId: 'c1', status: 'started', type: 'command' },
    ])
    expect(t.entries).toEqual([
      { command: longCommand, exitCode: undefined, id: 'c1', kind: 'command', status: 'started' },
    ])
    expect(t.activity).toEqual({ id: 'c1', label: `Running ${longCommand.slice(0, 59)}…` })
    expect(t.activity?.label.endsWith('…')).toBe(true)
  })

  it('does not shorten a short command label', () => {
    const t = run([
      { id: 1, command: 'npm test', itemId: 'c1', status: 'started', type: 'command' },
    ])
    expect(t.activity).toEqual({ id: 'c1', label: 'Running npm test' })
  })

  // Rule 7
  it('updates a completed/failed command entry and clears its activity', () => {
    const t = run([
      { id: 1, command: 'npm test', itemId: 'c1', status: 'started', type: 'command' },
      {
        id: 2,
        command: 'npm test',
        exitCode: 0,
        itemId: 'c1',
        status: 'completed',
        type: 'command',
      },
    ])
    expect(t.entries).toEqual([
      { command: 'npm test', exitCode: 0, id: 'c1', kind: 'command', status: 'completed' },
    ])
    expect(t.activity).toBeNull()
  })

  // Rule 8
  it('starts an image_progress entry generating with no src, and a Generating activity', () => {
    const t = run([{ id: 1, itemId: 'i1', status: 'started', type: 'image_progress' }])
    expect(t.entries).toEqual([{ id: 'i1', kind: 'image', status: 'generating' }])
    expect(t.activity).toEqual({ id: 'i1', label: 'Generating an image…' })
  })

  // Rule 9
  it('finishes an image entry with src and done status, clearing the matching activity', () => {
    const t = run([
      { id: 1, itemId: 'i1', status: 'started', type: 'image_progress' },
      { id: 2, itemId: 'i1', path: '/x/a.png', type: 'image' },
    ])
    expect(t.entries).toEqual([{ id: 'i1', kind: 'image', src: '/x/a.png', status: 'done' }])
    expect(t.activity).toBeNull()
  })

  // Rule 10
  it('marks image_progress failed and clears the matching activity', () => {
    const t = run([
      { id: 1, itemId: 'i1', status: 'started', type: 'image_progress' },
      { id: 2, itemId: 'i1', status: 'failed', type: 'image_progress' },
    ])
    expect(t.entries).toEqual([{ id: 'i1', kind: 'image', status: 'failed' }])
    expect(t.activity).toBeNull()
  })

  // Rule 11
  it('sets a Using-tool activity on start and clears it on completed/failed', () => {
    const started = run([
      {
        id: 1,
        itemId: 't1',
        status: 'started',
        summary: 'save_script',
        tool: 'save_script',
        type: 'tool',
      },
    ])
    expect(started.activity).toEqual({ id: 't1', label: 'Using save script' })

    const finished = run([
      {
        id: 1,
        itemId: 't1',
        status: 'started',
        summary: 'save_script',
        tool: 'save_script',
        type: 'tool',
      },
      {
        id: 2,
        itemId: 't1',
        status: 'completed',
        summary: 'save_script',
        tool: 'save_script',
        type: 'tool',
      },
    ])
    expect(finished.activity).toBeNull()
  })

  // Rule 12
  it('clears the activity when the assistant text starts streaming', () => {
    const t = run([
      {
        id: 1,
        itemId: 't1',
        status: 'started',
        summary: 'save_script',
        tool: 'save_script',
        type: 'tool',
      },
      { id: 2, itemId: 'm', text: 'Hel', type: 'text_delta' },
    ])
    expect(t.activity).toBeNull()
  })

  // Rule 13
  it('stores the latest plan steps', () => {
    const t = run([{ id: 1, steps: [{ status: 'pending', step: 'Write script' }], type: 'plan' }])
    expect(t.plan).toEqual([{ status: 'pending', step: 'Write script' }])
  })

  // Rule 14
  it('resets the plan when the user sends a message', () => {
    const t = run([
      { id: 1, steps: [{ status: 'pending', step: 'Write script' }], type: 'plan' },
      { id: 2, text: 'go', type: 'user_message' },
    ])
    expect(t.plan).toBeNull()
  })

  // Rule 15
  it('opens a question entry and sets the waiting-for-answer activity', () => {
    const t = run([{ id: 1, questionId: 'q1', questions, type: 'question' }])
    expect(t.entries).toEqual([{ id: 'q1', kind: 'question', questions, state: 'open' }])
    expect(t.activity).toEqual({ id: 'q1', label: 'Waiting for your answer' })
  })

  // Rule 16
  it('answers a question, storing the answers and clearing the matching activity', () => {
    const t = run([
      { id: 1, questionId: 'q1', questions, type: 'question' },
      { id: 2, answers: { 'q1-a': ['Bold'] }, questionId: 'q1', type: 'question_answered' },
    ])
    expect(t.entries).toEqual([
      { answers: { 'q1-a': ['Bold'] }, id: 'q1', kind: 'question', questions, state: 'answered' },
    ])
    expect(t.activity).toBeNull()
  })

  // Rule 17
  it('expires an open question but leaves an answered one alone', () => {
    const expired = run([
      { id: 1, questionId: 'q1', questions, type: 'question' },
      { id: 2, questionId: 'q1', type: 'question_expired' },
    ])
    expect(expired.entries).toEqual([{ id: 'q1', kind: 'question', questions, state: 'expired' }])

    const answered = run([
      { id: 1, questionId: 'q1', questions, type: 'question' },
      { id: 2, answers: { 'q1-a': ['Bold'] }, questionId: 'q1', type: 'question_answered' },
      { id: 3, questionId: 'q1', type: 'question_expired' },
    ])
    expect(answered.entries).toEqual([
      { answers: { 'q1-a': ['Bold'] }, id: 'q1', kind: 'question', questions, state: 'answered' },
    ])
  })

  // Rule 18
  it('expires every open question and clears activity when the turn ends', () => {
    const t = run([
      { id: 1, questionId: 'q1', questions, type: 'question' },
      { id: 2, status: 'completed', type: 'turn' },
    ])
    expect(t.entries).toEqual([{ id: 'q1', kind: 'question', questions, state: 'expired' }])
    expect(t.activity).toBeNull()
    expect(t.working).toBe(false)
  })

  it("keeps a card ReelMakeEasy asked open when the agent's turn ends, expiring the agent's own", () => {
    // make_beat_loop returns at once: its "Make it?" card arrives mid-turn and the turn ends
    // right after, while the server still waits for the answer.
    const t = run([
      { id: 1, status: 'started', type: 'turn' },
      { id: 2, questionId: 'q1', questions, type: 'question' },
      { id: 3, questionId: 'autonomous-loop-1', questions, server: true, type: 'question' },
      { id: 4, status: 'completed', type: 'turn' },
    ])
    expect(t.entries).toEqual([
      { id: 'q1', kind: 'question', questions, state: 'expired' },
      { id: 'autonomous-loop-1', kind: 'question', questions, server: true, state: 'open' },
    ])
    expect(t.activity).toBeNull()
    expect(t.working).toBe(false)
  })

  it.each(['failed', 'interrupted'] as const)(
    'keeps a server card open when the turn ends %s too',
    (status) => {
      const t = run([
        { id: 1, questionId: 'autonomous-loop-1', questions, server: true, type: 'question' },
        { id: 2, status, type: 'turn' },
      ])
      expect(t.entries).toEqual([
        { id: 'autonomous-loop-1', kind: 'question', questions, server: true, state: 'open' },
      ])
    },
  )

  it('closes a server card only when the server answers or expires it', () => {
    const answered = run([
      { id: 1, questionId: 'autonomous-loop-1', questions, server: true, type: 'question' },
      { id: 2, status: 'completed', type: 'turn' },
      {
        id: 3,
        answers: { 'q1-a': ['Bold'] },
        questionId: 'autonomous-loop-1',
        type: 'question_answered',
      },
    ])
    expect(answered.entries).toEqual([
      {
        answers: { 'q1-a': ['Bold'] },
        id: 'autonomous-loop-1',
        kind: 'question',
        questions,
        state: 'answered',
      },
    ])

    const replaced = run([
      { id: 1, questionId: 'autonomous-loop-1', questions, server: true, type: 'question' },
      { id: 2, status: 'completed', type: 'turn' },
      { id: 3, questionId: 'autonomous-loop-1', type: 'question_expired' },
    ])
    expect(replaced.entries).toEqual([
      { id: 'autonomous-loop-1', kind: 'question', questions, server: true, state: 'expired' },
    ])
  })

  it.each(['Codex stopped (exit 1)', 'Claude Code could not start: spawn ENOENT'])(
    'keeps a server card open when the agent stops (%s): ReelMakeEasy still takes its answer',
    (reason) => {
      // Only Stop, a deleted chat, a shutdown or a restart end ReelMakeEasy's cards, and each of
      // them sends question_expired: the agent's process ending is not one of them.
      const t = run([
        { id: 1, questionId: 'q1', questions, type: 'question' },
        { id: 2, questionId: 'autonomous-loop-1', questions, server: true, type: 'question' },
        { id: 3, reason, status: 'stopped', type: 'session' },
      ])
      expect(t.entries.slice(0, 2)).toEqual([
        { id: 'q1', kind: 'question', questions, state: 'expired' },
        { id: 'autonomous-loop-1', kind: 'question', questions, server: true, state: 'open' },
      ])
      expect(t.working).toBe(false)
    },
  )

  it('expires a server card on a stop when ReelMakeEasy says so (question_expired)', () => {
    const t = run([
      { id: 1, questionId: 'autonomous-loop-1', questions, server: true, type: 'question' },
      { id: 2, questionId: 'autonomous-loop-1', type: 'question_expired' },
      { id: 3, reason: 'ReelMakeEasy restarted', status: 'stopped', type: 'session' },
    ])
    expect(t.entries[0]).toEqual({
      id: 'autonomous-loop-1',
      kind: 'question',
      questions,
      server: true,
      state: 'expired',
    })
  })

  it('expires a card the server refused to take an answer for (local), leaving lastEventId', () => {
    const actions: TranscriptAction[] = [
      { id: 1, questionId: 'autonomous-loop-1', questions, server: true, type: 'question' },
      { questionId: 'autonomous-loop-1', type: 'local_question_expired' },
    ]
    const t = actions.reduce(reduceTranscript, initialTranscript)
    expect(t.entries).toEqual([
      { id: 'autonomous-loop-1', kind: 'question', questions, server: true, state: 'expired' },
    ])
    expect(t.lastEventId).toBe(1)
    // An answered card stays answered.
    const answeredActions: TranscriptAction[] = [
      { id: 1, questionId: 'q1', questions, type: 'question' },
      { id: 2, answers: { 'q1-a': ['Bold'] }, questionId: 'q1', type: 'question_answered' },
      { questionId: 'q1', type: 'local_question_expired' },
    ]
    const answered = answeredActions.reduce(reduceTranscript, initialTranscript)
    expect(answered.entries[0]).toMatchObject({ state: 'answered' })
  })

  it('lands on expired for a question_expired that arrives after the turn ends', () => {
    const t = run([
      { id: 1, questionId: 'q1', questions, type: 'question' },
      { id: 2, status: 'completed', type: 'turn' },
      { id: 3, questionId: 'q1', type: 'question_expired' },
    ])
    expect(t.entries).toEqual([{ id: 'q1', kind: 'question', questions, state: 'expired' }])
  })

  it('lands on expired for a question_expired that arrives before an interrupted turn', () => {
    const t = run([
      { id: 1, questionId: 'q1', questions, type: 'question' },
      { id: 2, questionId: 'q1', type: 'question_expired' },
      { id: 3, status: 'interrupted', type: 'turn' },
    ])
    expect(t.entries).toEqual([{ id: 'q1', kind: 'question', questions, state: 'expired' }])
    expect(t.activity).toBeNull()
  })

  // Rule 19
  it('expires open questions and clears activity when the session stops', () => {
    const t = run([
      { id: 1, questionId: 'q1', questions, type: 'question' },
      { id: 2, reason: 'Codex stopped (exit 1)', status: 'stopped', type: 'session' },
    ])
    expect(t.entries.map((e) => [e.kind, 'state' in e ? e.state : undefined, e.text])).toEqual([
      ['question', 'expired', undefined],
      ['notice', undefined, 'Codex stopped (exit 1)'],
    ])
    expect(t.activity).toBeNull()
    expect(t.working).toBe(false)
  })

  // Rule 20
  it('sets working true for a bare running session event without adding an entry', () => {
    const t = run([{ id: 1, status: 'running', type: 'session' }])
    expect(t.entries).toEqual([])
    expect(t.working).toBe(true)
  })

  // Rule 21
  it('adds a notice and sets working true for a running session event with a reason', () => {
    const t = run([{ id: 1, reason: 'started a new one', status: 'running', type: 'session' }])
    expect(t.entries).toEqual([{ id: 'n1', kind: 'notice', text: 'started a new one' }])
    expect(t.working).toBe(true)
  })

  it('ends a working phase on an idle session event, keeping open cards', () => {
    const t = run([
      { id: 1, status: 'running', type: 'session' },
      { type: 'style_request', id: 2 },
      { id: 3, status: 'idle', type: 'session' },
    ])
    expect(t.working).toBe(false)
    expect(t.activity).toBeNull()
    expect(t.entries).toEqual([{ id: 'style-2', kind: 'style', state: 'open' }])
  })

  // Rule 22
  it('ignores a question event whose id was already seen', () => {
    const t = run([
      { id: 5, questionId: 'q1', questions, type: 'question' },
      { id: 3, questionId: 'q1', type: 'question_expired' },
    ])
    expect(t.entries).toEqual([{ id: 'q1', kind: 'question', questions, state: 'open' }])
  })

  describe('settles entries cut off mid-flight', () => {
    /** One of each in-flight entry, plus finished ones that must be left alone. */
    const inFlight: AgentUiEvent[] = [
      { id: 1, status: 'started', type: 'turn' },
      { id: 2, itemId: 'img', status: 'started', type: 'image_progress' },
      { id: 3, command: 'ls', itemId: 'cmd', status: 'started', type: 'command' },
      { id: 4, itemId: 'think', text: 'Pondering', type: 'thinking_delta' },
      { id: 5, itemId: 'think-empty', status: 'started', text: '', type: 'thinking' },
      { id: 6, itemId: 'tool', status: 'started', summary: 'upload', tool: 'upload', type: 'tool' },
      { id: 7, itemId: 'img-done', path: '/x/a.png', type: 'image' },
      {
        id: 8,
        command: 'pwd',
        exitCode: 0,
        itemId: 'cmd-done',
        status: 'completed',
        type: 'command',
      },
      { id: 9, itemId: 'tool-done', status: 'completed', summary: 'ok', tool: 'ok', type: 'tool' },
      { id: 10, itemId: 'think-done', status: 'completed', text: 'Done', type: 'thinking' },
    ]
    const settled = [
      { id: 'img', kind: 'image', status: 'failed' },
      { command: 'ls', exitCode: undefined, id: 'cmd', kind: 'command', status: 'failed' },
      { id: 'think', kind: 'thinking', status: 'completed', text: 'Pondering' },
      { id: 'tool', kind: 'tool', status: 'failed', text: 'upload' },
      { id: 'img-done', kind: 'image', src: '/x/a.png', status: 'done' },
      { command: 'pwd', exitCode: 0, id: 'cmd-done', kind: 'command', status: 'completed' },
      { id: 'tool-done', kind: 'tool', status: 'completed', text: 'ok' },
      { id: 'think-done', kind: 'thinking', status: 'completed', text: 'Done' },
    ]

    it.each(['completed', 'failed', 'interrupted'] as const)('when the turn ends %s', (status) => {
      const t = run([...inFlight, { id: 11, status, type: 'turn' }])
      expect(t.entries).toEqual(settled)
      expect(t.working).toBe(false)
      expect(t.activity).toBeNull()
    })

    it('when the session stops', () => {
      const t = run([
        ...inFlight,
        { id: 11, reason: 'Codex stopped', status: 'stopped', type: 'session' },
      ])
      expect(t.entries).toEqual([...settled, { id: 'n11', kind: 'notice', text: 'Codex stopped' }])
    })

    it('but not when the turn starts or the session runs', () => {
      const t = run([
        ...inFlight,
        { id: 11, status: 'started', type: 'turn' },
        { id: 12, status: 'running', type: 'session' },
      ])
      expect(t.entries.find((e) => e.id === 'img')).toMatchObject({ status: 'generating' })
      expect(t.entries.find((e) => e.id === 'cmd')).toMatchObject({ status: 'started' })
      expect(t.entries.find((e) => e.id === 'think-empty')).toMatchObject({ status: 'started' })
      expect(t.entries.find((e) => e.id === 'tool')).toMatchObject({ status: 'started' })
    })
  })

  // Rule 1 (mode)
  it('starts with a null mode', () => {
    expect(initialTranscript.mode).toBeNull()
  })

  it('sets the mode from a mode event without adding an entry', () => {
    const t = run([{ id: 1, mode: 'autonomous', type: 'mode' }])
    expect(t.mode).toBe('autonomous')
    expect(t.entries).toEqual([])
  })

  // Rule 2 (notice)
  it('adds a notice entry for a notice event', () => {
    const t = run([{ id: 1, text: 'Looking for background music', type: 'notice' }])
    expect(t.entries).toEqual([{ id: 'n1', kind: 'notice', text: 'Looking for background music' }])
  })

  // Rule 3 (style_request)
  it('opens a style entry from a style_request event', () => {
    const t = run([{ id: 1, type: 'style_request' }])
    expect(t.entries).toEqual([{ id: 'style-1', kind: 'style', state: 'open' }])
  })

  it('ignores a duplicate style_request id (replay rule)', () => {
    const t = run([
      { id: 5, type: 'style_request' },
      { id: 5, type: 'style_request' },
    ])
    expect(t.entries).toEqual([{ id: 'style-5', kind: 'style', state: 'open' }])
  })

  // Rule 4 (style_chosen)
  it('resolves the open style entry when a style is chosen', () => {
    const t = run([
      { id: 1, type: 'style_request' },
      {
        id: 2,
        styleId: 'bold',
        styleName: 'Bold',
        thumbnailUrl: '/x/bold.png',
        type: 'style_chosen',
      },
    ])
    expect(t.entries).toEqual([
      {
        id: 'style-1',
        kind: 'style',
        state: 'chosen',
        styleId: 'bold',
        styleName: 'Bold',
        thumbnailUrl: '/x/bold.png',
      },
    ])
  })

  it('appends a chosen style entry when no style entry is open', () => {
    const t = run([{ id: 1, styleId: 'bold', styleName: 'Bold', type: 'style_chosen' }])
    expect(t.entries).toEqual([
      {
        id: 'style-1',
        kind: 'style',
        state: 'chosen',
        styleId: 'bold',
        styleName: 'Bold',
        thumbnailUrl: undefined,
      },
    ])
  })

  // Rule 5 (video_started)
  it('adds a video entry from a video_started event', () => {
    const t = run([{ id: 1, projectId: 'proj_1', type: 'video_started' }])
    expect(t.entries).toEqual([{ id: 'video-proj_1', kind: 'video', projectId: 'proj_1' }])
  })

  // Rule 6: a terminal turn is not Codex's request, so an open style entry stays open.
  it('leaves an open style entry open when the turn ends', () => {
    const t = run([
      { id: 1, type: 'style_request' },
      { id: 2, status: 'completed', type: 'turn' },
    ])
    expect(t.entries).toEqual([{ id: 'style-1', kind: 'style', state: 'open' }])
  })

  // Controller ruling R7: a session stop, unlike a terminal turn, expires an open
  // style entry, since the pending request lived only in the now-gone process memory.
  it('expires an open style entry when the session stops', () => {
    const t = run([
      { id: 1, type: 'style_request' },
      { id: 2, reason: 'Codex stopped', status: 'stopped', type: 'session' },
    ])
    expect(t.entries).toEqual([
      { id: 'style-1', kind: 'style', state: 'expired' },
      { id: 'n2', kind: 'notice', text: 'Codex stopped' },
    ])
  })

  it('leaves a chosen style entry alone when the session stops', () => {
    const t = run([
      { id: 1, type: 'style_request' },
      { id: 2, styleId: 'bold', styleName: 'Bold', type: 'style_chosen' },
      { id: 3, status: 'stopped', type: 'session' },
    ])
    expect(t.entries.find((e) => e.kind === 'style')).toEqual({
      id: 'style-1',
      kind: 'style',
      state: 'chosen',
      styleId: 'bold',
      styleName: 'Bold',
      thumbnailUrl: undefined,
    })
  })

  // Final review I2: Stop with the style card open must not leave it clickable.
  it('expires an open style entry and says so when the autonomous flow is cancelled', () => {
    const t = run([
      { id: 1, type: 'style_request' },
      { id: 2, type: 'flow_cancelled' },
    ])
    expect(t.entries).toEqual([
      { id: 'style-1', kind: 'style', state: 'expired' },
      { id: 'n2', kind: 'notice', text: 'Autonomous mode stopped.' },
    ])
    expect(t.lastEventId).toBe(2)
  })

  it('leaves a chosen style entry alone when the flow is cancelled, still adding the notice', () => {
    const t = run([
      { id: 1, type: 'style_request' },
      { id: 2, styleId: 'bold', styleName: 'Bold', type: 'style_chosen' },
      { id: 3, type: 'flow_cancelled' },
    ])
    expect(t.entries).toEqual([
      expect.objectContaining({ id: 'style-1', kind: 'style', state: 'chosen' }),
      { id: 'n3', kind: 'notice', text: 'Autonomous mode stopped.' },
    ])
  })

  it('applies a replayed flow_cancelled only once', () => {
    const once = run([{ id: 1, type: 'flow_cancelled' }])
    expect(reduceTranscript(once, { id: 1, type: 'flow_cancelled' })).toBe(once)
  })

  describe('brief', () => {
    const brief = {
      brief: 'A bright comet is visible tonight.',
      durationSeconds: 30,
      title: 'Catch the comet tonight',
    }

    it('is null until the brief event, then holds it without adding an entry', () => {
      expect(initialTranscript.brief).toBeNull()
      const t = run([
        { id: 1, itemId: 'ly-1', text: '**Catch the comet tonight** · 30s', type: 'message' },
        { id: 2, ...brief, type: 'brief' },
      ])
      expect(t.brief).toEqual(brief)
      expect(t.entries.map((e) => e.kind)).toEqual(['assistant'])
      expect(t.lastEventId).toBe(2)
    })

    it('rebuilds on a replay from 0, and ignores a replayed brief', () => {
      const events: AgentUiEvent[] = [
        { id: 1, mode: 'autonomous', type: 'mode' },
        { id: 2, ...brief, type: 'brief' },
        { id: 3, type: 'style_request' },
      ]
      const t = run(events)
      expect(run(events)).toEqual(t)
      expect(t.brief).toEqual(brief)
      // A reconnect replays from `lastEventId`; an already-seen brief changes nothing.
      expect(reduceTranscript(t, { id: 2, ...brief, title: 'Other', type: 'brief' })).toBe(t)
    })

    it('a later brief replaces an earlier one', () => {
      const t = run([
        { id: 1, ...brief, type: 'brief' },
        { id: 2, ...brief, durationSeconds: 45, title: 'Second', type: 'brief' },
      ])
      expect(t.brief).toEqual({ ...brief, durationSeconds: 45, title: 'Second' })
    })

    it("holds Easy's first brief without a length, then the same brief at the length picked", () => {
      const { durationSeconds: _picked, ...first } = brief
      const before = run([{ id: 1, ...first, type: 'brief' }])
      expect(before.brief).toEqual(first)
      const after = reduceTranscript(before, {
        id: 2,
        ...first,
        durationSeconds: 60,
        type: 'brief',
      })
      expect(after.brief).toEqual({ ...first, durationSeconds: 60 })
    })

    it("keeps a loop short's lines and stamps; a revised storyboard replaces them", () => {
      const lines = [
        { narration: 'Honey found in ancient tombs was still good to eat.', stamp: 'c. 1325 BC' },
        { narration: 'Bees fan the nectar with their wings to dry it.', stamp: null },
      ]
      const loop = { brief: '2 clips of 4 s', durationSeconds: 8, title: 'Honey keeps' }
      const t = run([{ id: 1, ...loop, lines, type: 'brief' }])
      expect(t.brief).toEqual({ ...loop, lines })
      const revised = [{ ...lines[0], stamp: '1325 BC' }, lines[1]]
      expect(reduceTranscript(t, { id: 2, ...loop, lines: revised, type: 'brief' }).brief).toEqual({
        ...loop,
        lines: revised,
      })
      // A story video's brief has no lines.
      expect(reduceTranscript(t, { id: 2, ...brief, type: 'brief' }).brief).toEqual(brief)
    })
  })
})

describe('user messages with attachments', () => {
  it('keeps the files sent with a message, and nothing extra for one without', () => {
    const shot = { kind: 'image' as const, name: 'shot-a1.png', path: '/w/a/shot-a1.png', size: 3 }
    const t = run([
      { attachments: [shot], id: 1, text: '', type: 'user_message' },
      { id: 2, text: 'hi', type: 'user_message' },
    ])
    expect(t.entries).toEqual([
      { attachments: [shot], id: 'u1', kind: 'user', text: '' },
      { id: 'u2', kind: 'user', text: 'hi' },
    ])
  })
})

describe('a Ranking chat', () => {
  it('follows the ranking its tools touch, counting each change so the preview reloads', () => {
    const t = run([
      { id: 1, rankingId: 'a', type: 'ranking' },
      { id: 2, rankingId: 'a', type: 'ranking' },
      { id: 3, rankingId: 'b', type: 'ranking' },
    ])
    expect(t.ranking).toEqual({ id: 'b', version: 3 })
    expect(initialTranscript.ranking).toBeNull()
  })
})

describe('Motion Reel events', () => {
  const setup = {
    bars: 8,
    bpm: 128,
    lengthSec: 15,
    music: { id: 'pulse-drive', source: 'library' as const },
    musicTitle: 'Pulse Drive',
    ratio: '16:9' as const,
    reelSec: 15,
    type: 'showreel' as const,
    typeLabel: 'Motion reel',
    subject: 'A launch reel',
  }

  it('shows a setup saved when reels had styles with its type', () => {
    const { type: _type, typeLabel: _label, ...rest } = setup
    const old = { ...rest, styleId: 'product-ui-launch', styleLabel: 'Product UI Launch' }
    const t = run([{ id: 1, setup: old as unknown as typeof setup, type: 'motion_setup' }])
    expect(t.entries).toEqual([
      {
        id: 'motion-setup-1',
        kind: 'motion_setup',
        setup: { ...rest, type: 'launch', typeLabel: 'Product launch' },
        state: 'chosen',
      },
    ])
  })

  it('opens the setup card, then shows what was chosen in its place', () => {
    const open = run([{ id: 1, type: 'motion_setup_request' }])
    expect(open.entries).toEqual([{ id: 'motion-setup-1', kind: 'motion_setup', state: 'open' }])
    const chosen = run([
      { id: 1, type: 'motion_setup_request' },
      { id: 2, setup, type: 'motion_setup' },
    ])
    expect(chosen.entries).toEqual([
      { id: 'motion-setup-1', kind: 'motion_setup', setup, state: 'chosen' },
    ])
  })

  it('updates the chosen card when the setup changes later (the agent composed the music)', () => {
    const later = { ...setup, bpm: 132, musicTitle: 'Composed: launch anthem' }
    const t = run([
      { id: 1, type: 'motion_setup_request' },
      { id: 2, setup, type: 'motion_setup' },
      { id: 3, setup: later, type: 'motion_setup' },
    ])
    expect(t.entries).toEqual([
      { id: 'motion-setup-1', kind: 'motion_setup', setup: later, state: 'chosen' },
    ])
  })

  it('keeps one card when a failed setup asks again, under a new id so it starts over', () => {
    const t = run([
      { id: 1, type: 'motion_setup_request' },
      { id: 2, text: "Couldn't set up the reel: no network", type: 'notice' },
      { id: 3, type: 'motion_setup_request' },
    ])
    expect(t.entries.filter((e) => e.kind === 'motion_setup')).toEqual([
      { id: 'motion-setup-3', kind: 'motion_setup', state: 'open' },
    ])
  })

  it('adds each rendered reel as a video entry', () => {
    const t = run([
      {
        id: 4,
        itemId: 'motion-1',
        posterUrl: 'http://x/p.jpg',
        report: '8 cuts: 8 on a beat, none off the grid.',
        type: 'motion_video',
        videoUrl: 'http://x/r.mp4',
      },
    ])
    expect(t.entries).toEqual([
      {
        id: 'motion-1',
        kind: 'motion_video',
        posterUrl: 'http://x/p.jpg',
        report: '8 cuts: 8 on a beat, none off the grid.',
        videoUrl: 'http://x/r.mp4',
      },
    ])
  })
})

describe('reduceTranscript, a Motion Reel', () => {
  it('keeps the last motion_tasks list, and a user message leaves it in place', () => {
    const t = run([
      {
        id: 1,
        tasks: [{ id: 'setup', label: 'Set up', result: null, state: 'running' }],
        type: 'motion_tasks',
      },
      {
        id: 2,
        tasks: [
          { id: 'setup', label: 'Set up', result: 'Motion reel', state: 'done' },
          {
            details: ['Sync: passes.'],
            id: 'sync',
            label: 'Sync check',
            result: 'Sync: passes',
            state: 'done',
          },
        ],
        type: 'motion_tasks',
      },
      { id: 3, text: 'more pop', type: 'user_message' },
    ])
    expect(t.motionTasks?.map((task) => [task.id, task.state, task.result])).toEqual([
      ['setup', 'done', 'Motion reel'],
      ['sync', 'done', 'Sync: passes'],
    ])
    expect(t.lastEventId).toBe(3)
    expect(initialTranscript.motionTasks).toBeNull()
  })

  it('keeps the plan from the list that sent it until another says otherwise', () => {
    const tasks = [{ id: 'plan' as const, label: 'Plan', result: null, state: 'waiting' as const }]
    const plan = { changedAt: 10, text: '- Scene 1 (bars 0-2): logo', truncated: false }
    const sent = run([
      { id: 1, tasks, type: 'motion_tasks' },
      { id: 2, plan, tasks, type: 'motion_tasks' },
      // No `plan`: unchanged.
      { id: 3, tasks, type: 'motion_tasks' },
    ])
    expect(sent.motionPlan).toEqual(plan)
    // null: the plan is gone.
    expect(
      reduceTranscript(sent, { id: 4, plan: null, tasks, type: 'motion_tasks' }).motionPlan,
    ).toBeNull()
    // A chat from before the plan was sent has none.
    expect(run([{ id: 1, tasks, type: 'motion_tasks' }]).motionPlan).toBeNull()
    expect(initialTranscript.motionPlan).toBeNull()
  })

  it('ignores a replayed older list', () => {
    const first = run([
      {
        id: 5,
        tasks: [{ id: 'render', label: 'Render', result: 'Render 2 of 3', state: 'done' }],
        type: 'motion_tasks',
      },
    ])
    const t = reduceTranscript(first, {
      id: 4,
      tasks: [{ id: 'render', label: 'Render', result: null, state: 'waiting' }],
      type: 'motion_tasks',
    })
    expect(t.motionTasks?.[0]?.result).toBe('Render 2 of 3')
  })

  it('a stop (a restart, an exit) settles what was running: nothing spins after it', () => {
    const t = run([
      {
        id: 1,
        tasks: [
          { id: 'build', label: 'Build', result: '3 scene files', state: 'running' },
          { id: 'render', label: 'Render', result: 'Rendering 2 of 3…', state: 'running' },
          { id: 'setup', label: 'Set up', result: 'Motion reel', state: 'done' },
        ],
        type: 'motion_tasks',
      },
      { id: 2, reason: 'The server restarted', status: 'stopped', type: 'session' },
    ])
    expect(t.motionTasks?.map((task) => [task.id, task.state, task.result])).toEqual([
      ['build', 'done', '3 scene files'],
      ['render', 'failed', 'Stopped before it finished'],
      ['setup', 'done', 'Motion reel'],
    ])
  })
})
