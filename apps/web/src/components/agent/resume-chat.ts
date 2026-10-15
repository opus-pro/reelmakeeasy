import type { TranscriptEntry } from '@reelmakeeasy/common/codex-agent/agent-transcript'
import type { AgentMode, AgentSession } from '@shared/types/api/agent'

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
