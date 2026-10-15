import type { AgentHarnessName } from '@shared/types/api/agent'

import { isAppSecret } from '../codex/codex-config'

/** Claude Code's own credentials: they stay in its env. */
const CLAUDE_KEEP_ENV = new Set(['ANTHROPIC_API_KEY'])
/** Set by a parent Claude Code session (ReelMakeEasy started from inside one): they would make
 *  the child think it runs nested in that session. */
const PARENT_SESSION_ENV =
  /^(CLAUDECODE|CLAUDE_PID|CLAUDE_CODE_(SESSION_ID|ENTRYPOINT|EXECPATH|CHILD_SESSION|SESSION_ATTENDED|MESSAGING_.*|HOST_.*|DESKTOP_.*|SDK_.*|OAUTH_SCOPES))$/

export const DEFAULT_CLAUDE_MODEL = 'claude-opus-5-5'

/**
 * The environment for the Claude Code child: ReelMakeEasy's secrets (Gemini/fal/ElevenLabs/LLM
 * keys, the database URL) and every other `*_API_KEY` are removed, so Claude - and every
 * command it runs - never sees them. Anthropic's own key stays; so does everything else (PATH,
 * HOME, CLAUDE_CONFIG_DIR, ANTHROPIC_BASE_URL). A parent Claude Code session's variables go too.
 */
export function scrubClaudeEnv(env: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {}
  for (const [name, value] of Object.entries(env)) {
    if (isAppSecret(name)) continue
    if (name.endsWith('_API_KEY') && !CLAUDE_KEEP_ENV.has(name)) continue
    if (PARENT_SESSION_ENV.test(name)) continue
    out[name] = value
  }
  out['CLAUDE_AGENT_SDK_CLIENT_APP'] = 'reelmakeeasy/1'
  return out
}

/** The model agent chats and their video planning run on (`CLAUDE_AGENT_MODEL`). */
export function claudeModel(env: NodeJS.ProcessEnv = process.env): string {
  return env['CLAUDE_AGENT_MODEL']?.trim() || DEFAULT_CLAUDE_MODEL
}

/** The harness the mode card preselects (`AGENT_HARNESS`). */
export function defaultHarness(env: NodeJS.ProcessEnv = process.env): AgentHarnessName {
  return env['AGENT_HARNESS']?.trim().toLowerCase() === 'claude' ? 'claude' : 'codex'
}
