import { splitRecommended } from '@reelmakeeasy/common/codex-agent/agent-storyboard'
import type { TranscriptEntry } from '@reelmakeeasy/common/codex-agent/agent-transcript'
import type { AgentAnswers, AgentMode, AgentQuestion, AgentSession } from '@shared/types/api/agent'

/**
 * Whether the chat offers "Pick up where you left off": an Easy chat that ReelMakeEasy stopping
 * (a restart or a crash) cut off before its video started (the server's `interrupted`), while
 * its flow isn't running again. Once a video started, its own progress shows instead.
 */
export function canPickUp(
  session: AgentSession | null,
  entries: readonly TranscriptEntry[],
  flowActive: boolean,
): boolean {
  if (!session?.interrupted || session.mode !== 'autonomous') return false
  if (session.editing || session.projectId || flowActive) return false
  return !entries.some((e) => e.kind === 'video')
}

/** What expired cards say instead of their own words (unset: their own). */
export interface ExpiredHints {
  question?: string
  style?: string
}

/**
 * What an expired card says in this chat. An Easy chat (until it edits its video) takes no
 * typed reply, so a question card never says to reply in the chat. Its style card says to
 * start a new session, as its own words do, only when the chat can't go on: not while it can
 * pick up where it left off (`pickUp`), nor once it has picked up again (`flowActive`: a fresh
 * card follows below). Free chat and an edited video keep the cards' own words.
 */
export function expiredHintsFor(chat: {
  editing: boolean
  flowActive: boolean
  mode: AgentMode | null
  pickUp: boolean
}): ExpiredHints | undefined {
  if (chat.mode !== 'autonomous' || chat.editing) return undefined
  return {
    question: 'This question expired.',
    ...(chat.pickUp || chat.flowActive ? { style: 'This step expired.' } : {}),
  }
}

/** What the chat says when picking up is refused: the API's plain reason when it gave one (409:
 *  nothing to pick up, or it already runs; 503: ReelMakeEasy is restarting), else to try again. */
export function resumeRefusedNotice(
  status: number | undefined,
  message: string | undefined,
): string {
  if ((status === 409 || status === 503) && message) return message
  return "Couldn't pick up where you left off. Try again."
}

/**
 * The agent's card a chat can still answer though it expired (ReelMakeEasy restarted, or the
 * agent stopped, while it waited): the last card, when nothing was said after it. Answering it
 * sends the answer as a message, and the agent carries on from its saved conversation. Not
 * ReelMakeEasy's own cards, nor one with a secret question (a message would show the secret).
 */
export function carryOnCardId(
  entries: readonly TranscriptEntry[],
  /** `busy`: the chat takes no message now (no mode yet, a flow or turn running, or over). */
  { busy = false }: { busy?: boolean } = {},
): null | string {
  if (busy) return null
  const last = entries.findLastIndex((e) => e.kind === 'question')
  const card = entries[last]
  if (card?.kind !== 'question' || card.state !== 'expired' || card.server) return null
  if (card.questions.some((q) => q.isSecret)) return null
  if (entries.slice(last + 1).some((e) => e.kind === 'user' || e.kind === 'question')) return null
  return card.id
}

/** An expired card's answer as a message: the answer, and the question it answers. */
export function carryOnMessage(questions: readonly AgentQuestion[], answers: AgentAnswers): string {
  const said = (q: AgentQuestion) =>
    (answers[q.id] ?? []).map((answer) => splitRecommended(answer).text).join(', ')
  const [only] = questions
  if (questions.length === 1 && only) return `${said(only)}\n\n(My answer to: ${only.question})`
  return questions
    .filter((q) => said(q))
    .map((q) => `${q.question} ${said(q)}`)
    .join('\n')
}
