import { splitRecommended } from '@reelmakeeasy/common/codex-agent/agent-storyboard'
import type { AgentQuestion } from '@shared/types/api/agent'

/** Lower case, single spaces, without end punctuation: how a typed option is compared. */
const normalized = (text: string) =>
  text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[\s.!?]+$/, '')
    .trim()

/**
 * What the composer's text answers on an open one-question card, or null when it doesn't
 * answer the card at all (the text then goes to the agent as a message).
 * - Text naming an option (any case, without end punctuation or " (Recommended)") answers
 *   with that option's label.
 * - A card ReelMakeEasy asked with fixed options (no "Other", like "Make this loop?"), in a chat
 *   the user can message (`chat`), takes only an option: other text is for the agent, and the
 *   card stays open, so a question to the agent never answers the card by accident.
 * - Otherwise the text is the answer, as typed (the agent's own questions, whose turn waits
 *   on them; a card that takes any answer; Easy's flow, which only takes card answers).
 */
export function typedCardAnswer(
  card: { question: AgentQuestion; server: boolean },
  text: string,
  chat: boolean,
): null | string {
  const typed = text.trim()
  if (!typed) return null
  const wanted = normalized(typed)
  const named = card.question.options.find(
    (option) =>
      normalized(option.label) === wanted ||
      normalized(splitRecommended(option.label).text) === wanted,
  )
  if (named) return named.label
  if (card.server && !card.question.isOther && chat) return null
  return typed
}

/**
 * The composer and the open card it can answer (`single`: the one question of the newest open
 * card, null when there is none or it isn't one the composer answers): what the text answers
 * (`typedCardAnswer`; null sends it as a message), and whether the card is one of ReelMakeEasy's
 * fixed ones in a chat (`cardOrMessage`), where typing can also message the agent.
 */
export function composerCard(
  open: undefined | { server?: true },
  single: AgentQuestion | null,
  text: string,
  chat: boolean,
): { answer: null | string; cardOrMessage: boolean } {
  if (!open || !single) return { answer: null, cardOrMessage: false }
  const card = { question: single, server: !!open.server }
  return {
    answer: typedCardAnswer(card, text, chat),
    cardOrMessage: card.server && !single.isOther && chat,
  }
}
