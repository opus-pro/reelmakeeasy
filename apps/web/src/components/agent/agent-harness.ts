import {
  type AgentHarnessName,
  type AgentStatusResponse,
  type CodexUnavailableReason,
  HARNESS_UNAVAILABLE_REASON,
  type HarnessStatus,
} from '@shared/types/api/agent'

/** The harness's product name, for the mode card. */
export const HARNESS_LABEL: Record<AgentHarnessName, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
}

/** How the chat names its agent, as in "Message Claude". */
export const HARNESS_SHORT: Record<AgentHarnessName, string> = { claude: 'Claude', codex: 'Codex' }

const NOT_READY: Record<AgentHarnessName, Record<CodexUnavailableReason, string>> = {
  claude: {
    'no-sandbox':
      'Claude Code needs bubblewrap and socat on this machine: install them, then try again',
    'not-found': 'Install Claude Code to use it here',
    'not-logged-in': 'Sign in to Claude Code: run claude login in a terminal',
    'probe-failed': "Claude Code didn't respond. Set CLAUDE_BIN in .env",
  },
  codex: {
    'no-sandbox': "Codex's sandbox is missing on this machine",
    'not-found': 'Install Codex (or the ChatGPT desktop app) to use Agent mode',
    'not-logged-in': 'Open ChatGPT and sign in to Codex',
    'probe-failed': "Codex didn't respond. Set CODEX_BIN in .env",
  },
}

const ORDER: AgentHarnessName[] = ['codex', 'claude']

const NOT_INSTALLED: HarnessStatus = {
  available: false,
  binary: null,
  loggedIn: false,
  reason: 'not-found',
  version: null,
}

/** One harness's status. A reply without the per-harness fields (an API from before Claude
 *  Code) is Codex's status at the top level, with Claude Code not installed. */
function statusOf(s: AgentStatusResponse, h: AgentHarnessName): HarnessStatus {
  if (h === 'claude') return s.claude ?? NOT_INSTALLED
  return s.codex ?? (typeof s.available === 'boolean' ? s : NOT_INSTALLED)
}

/** What to do to use `harness` now, or undefined when it is ready. */
function notReadyReason(harness: AgentHarnessName, status: HarnessStatus): string | undefined {
  if (status.available) return undefined
  return NOT_READY[harness][status.reason ?? 'probe-failed']
}

/** The harnesses the mode card offers: the installed ones, a signed-out one disabled with
 *  how to fix it. */
export function harnessChoices(
  status: AgentStatusResponse | null,
): { disabledReason?: string; harness: AgentHarnessName }[] {
  if (!status) return []
  return ORDER.filter((h) => statusOf(status, h).binary).map((harness) => {
    const disabledReason = notReadyReason(harness, statusOf(status, harness))
    return disabledReason ? { disabledReason, harness } : { harness }
  })
}

/** What to do to use `harness` (installed or not), or undefined when it is ready or the status
 *  isn't known yet (the server checks again). */
export function harnessNotReady(
  status: AgentStatusResponse | null,
  harness: AgentHarnessName,
): string | undefined {
  if (!status) return undefined
  return notReadyReason(harness, statusOf(status, harness))
}

/** Whether a chat can open: at least one harness is installed and signed in. */
export function anyHarnessReady(status: AgentStatusResponse): boolean {
  return ORDER.some((h) => statusOf(status, h).available)
}

/** The harness the mode card preselects: the default when it is ready, else a ready one. */
export function initialHarness(status: AgentStatusResponse | null): AgentHarnessName {
  if (!status) return 'codex'
  const preferred = status.defaultHarness ?? 'codex'
  if (statusOf(status, preferred).available) return preferred
  return ORDER.find((h) => statusOf(status, h).available) ?? preferred
}

/** Why agent mode can't open: the installed harness's fix first, else what to install. */
export function unavailableMessage(status: AgentStatusResponse): string {
  const installed = ORDER.find((h) => statusOf(status, h).binary)
  if (!installed) return 'Install Codex or Claude Code to use Agent mode'
  return notReadyReason(installed, statusOf(status, installed)) ?? ''
}

/** How a chat names its agent (sessions from before Claude Code are Codex). */
export function agentNameOf(session: null | undefined | { harness?: AgentHarnessName }): string {
  return HARNESS_SHORT[session?.harness ?? 'codex']
}

/** The harness a chat runs on once its mode is chosen; null before. */
export function chosenHarnessOf(
  session: null | undefined | { harness?: AgentHarnessName; mode?: unknown },
): AgentHarnessName | null {
  return session?.mode ? (session.harness ?? 'codex') : null
}

/** One row of the Agent dialog. */
export type AgentPickerRow = {
  harness: AgentHarnessName
  label: string
  /** Why it can't be picked (state `unavailable`). */
  reason?: string
  state: 'checking' | 'ready' | 'unavailable'
}

/** Both agents, in the dialog's order: checking while the status loads, then ready or greyed
 *  out with the reason. */
export function agentPickerRows(status: AgentStatusResponse | null): AgentPickerRow[] {
  return ORDER.map((harness) => {
    const label = HARNESS_LABEL[harness]
    if (!status) return { harness, label, state: 'checking' as const }
    const s = statusOf(status, harness)
    if (s.available) return { harness, label, state: 'ready' as const }
    const reason = HARNESS_UNAVAILABLE_REASON[harness][s.reason ?? 'probe-failed']
    return { harness, label, reason, state: 'unavailable' as const }
  })
}

/** The agent picked in the Agent dialog for a chat whose mode isn't chosen yet; null otherwise. */
export function presetHarnessOf(
  session: null | undefined | { harness?: AgentHarnessName; mode?: unknown },
): AgentHarnessName | null {
  return session && !session.mode ? (session.harness ?? null) : null
}
