import os from 'node:os'
import path from 'node:path'

/** The user's Codex home folder: `CODEX_HOME` when set, else `~/.codex`. */
export function codexHome(env: NodeJS.ProcessEnv = process.env): string {
  return env.CODEX_HOME || path.join(os.homedir(), '.codex')
}

/** Switches off Codex's command execution (verified on codex-cli 0.158: "no shell tool is
 *  available"), leaving its other tools, web search included, as they are. */
export const NO_SHELL_ARGS = ['--disable', 'shell_tool', '--disable', 'unified_exec']

/**
 * `codex app-server` argv for a ReelMakeEasy session. It runs with an isolated
 * CODEX_HOME (see codex-home.ts), so no user MCP servers need disabling;
 * plugins and apps are still switched off. `request_user_input` lets Codex ask
 * the user multiple-choice questions, and detailed reasoning summaries give the
 * chat something to show while Codex thinks. Web search is live only when asked for
 * (`webSearch: true`); otherwise it is switched off. `shell: false` removes command
 * execution (`shell_tool` and `unified_exec`), so a session that reads the web can't
 * also run commands that a poisoned page talks it into.
 */
export function buildAppServerArgs(opts: { shell?: boolean; webSearch?: boolean } = {}): string[] {
  return [
    'app-server',
    '--disable',
    'plugins',
    '--disable',
    'apps',
    ...(opts.shell === false ? NO_SHELL_ARGS : []),
    '--enable',
    'default_mode_request_user_input',
    '-c',
    'model_reasoning_summary="detailed"',
    '-c',
    opts.webSearch ? 'web_search="live"' : 'web_search="disabled"',
  ]
}

/** ReelMakeEasy's own secrets: never handed to Codex, whatever else the env holds. */
export const APP_SECRET_ENV = [
  'DATABASE_URL',
  'ELEVENLABS_API_KEY',
  'FAL_KEY',
  'FILE_SIGNING_SECRET',
  'GEMINI_API_KEY',
  'LLM_API_KEY',
]

/** One of ReelMakeEasy's own secrets. */
export function isAppSecret(name: string): boolean {
  return APP_SECRET_ENV.includes(name)
}
/** Codex's own credentials, which it may read from the environment instead of auth.json. */
const CODEX_CREDENTIAL_ENV = ['CODEX_API_KEY', 'OPENAI_API_KEY']

/**
 * The environment for a `codex app-server` child: ReelMakeEasy's secrets
 * (Gemini/fal/ElevenLabs/LLM keys, the database URL) and any other
 * `*_API_KEY` are removed, so Codex - and every command it runs - never sees
 * them. Codex's own keys (`OPENAI_API_KEY`, `CODEX_API_KEY`) stay; so does
 * everything else (PATH, HOME, CODEX_HOME...).
 */
export function scrubCodexEnv(
  env: NodeJS.ProcessEnv,
  opts: { keep?: string[] } = {},
): NodeJS.ProcessEnv {
  const keep = new Set([...(opts.keep ?? []), ...CODEX_CREDENTIAL_ENV])
  const out: NodeJS.ProcessEnv = {}
  for (const [name, value] of Object.entries(env)) {
    if (isAppSecret(name)) continue
    if (name.endsWith('_API_KEY') && !keep.has(name)) continue
    out[name] = value
  }
  return out
}
