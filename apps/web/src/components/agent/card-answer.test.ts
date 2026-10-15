import type { AgentQuestion } from '@shared/types/api/agent'

import { composerCard, typedCardAnswer } from './card-answer'

const LOOP_CARD: AgentQuestion = {
  header: 'Loop short',
  id: 'make',
  isOther: false,
  isSecret: false,
  options: [
    { description: '6 clips of 4 s.', label: 'Make it' },
    { description: 'Nothing is spent.', label: 'Not now' },
  ],
  question: 'Make this 24-second loop? About $1.20',
}
const TONE: AgentQuestion = {
  header: 'Tone',
  id: 'tone',
  isOther: true,
  isSecret: false,
  options: [
    { description: 'Light', label: 'Playful (Recommended)' },
    { description: 'Calm', label: 'Serious' },
  ],
  question: 'Which tone?',
}

describe('typedCardAnswer', () => {
  it('answers with the option the text names, in any case and without end punctuation', () => {
    const card = { question: LOOP_CARD, server: true }
    expect(typedCardAnswer(card, 'Make it', true)).toBe('Make it')
    expect(typedCardAnswer(card, '  make it! ', true)).toBe('Make it')
    expect(typedCardAnswer(card, 'not now.', true)).toBe('Not now')
    // " (Recommended)" is part of the label, not of what people type.
    expect(typedCardAnswer({ question: TONE, server: false }, 'playful', true)).toBe(
      'Playful (Recommended)',
    )
  })

  it("sends anything else to the agent while ReelMakeEasy's fixed card stays open, in a chat", () => {
    // Typing a question for the agent must not answer "Make it?" with "not made".
    expect(
      typedCardAnswer({ question: LOOP_CARD, server: true }, 'can you shorten line 3?', true),
    ).toBeNull()
  })

  it('keeps answering with the text itself when the card takes any answer or no chat is open', () => {
    expect(typedCardAnswer({ question: TONE, server: false }, 'something warmer', true)).toBe(
      'something warmer',
    )
    expect(typedCardAnswer({ question: TONE, server: true }, 'my own idea', true)).toBe(
      'my own idea',
    )
    // The agent's own fixed question: its turn waits on it, so the text answers it as before.
    expect(typedCardAnswer({ question: LOOP_CARD, server: false }, 'hmm', true)).toBe('hmm')
    // Easy's flow takes card answers only: no chat to send the text to.
    expect(typedCardAnswer({ question: LOOP_CARD, server: true }, 'go', false)).toBe('go')
  })

  it('answers nothing for empty text', () => {
    expect(typedCardAnswer({ question: LOOP_CARD, server: true }, '  ', true)).toBeNull()
  })
})

describe('composerCard', () => {
  it("says when ReelMakeEasy's fixed card is open in a chat, so typing can also message the agent", () => {
    expect(composerCard({ server: true }, LOOP_CARD, 'shorten line 3', true)).toEqual({
      answer: null,
      cardOrMessage: true,
    })
    expect(composerCard({ server: true }, LOOP_CARD, 'Make it', true)).toEqual({
      answer: 'Make it',
      cardOrMessage: true,
    })
  })

  it('is a plain card answer otherwise, and nothing without a one-question card', () => {
    expect(composerCard({}, TONE, 'warmer', true)).toEqual({
      answer: 'warmer',
      cardOrMessage: false,
    })
    expect(composerCard({ server: true }, LOOP_CARD, 'go', false)).toEqual({
      answer: 'go',
      cardOrMessage: false,
    })
    expect(composerCard(undefined, null, 'hi', true)).toEqual({
      answer: null,
      cardOrMessage: false,
    })
  })
})
