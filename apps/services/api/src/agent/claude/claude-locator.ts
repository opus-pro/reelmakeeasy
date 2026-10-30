import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import type { HarnessStatus } from '@shared/types/api/agent'

import {
  commandFile,
  type LocatorDeps,
  pathDirs,
  pathFor,
  type RunFn,
} from '../codex/codex-locator'

import { scrubClaudeEnv } from './claude-config'

/** CLAUDE_BIN, then `claude` on PATH, then the native installer's locations (in USERPROFILE on
 *  Windows, which sets no HOME outside Git Bash). */
export function findClaudeBinary({
  env,
  exists,
  platform = process.platform,
}: LocatorDeps): null | string {
  const override = env['CLAUDE_BIN']?.trim()
  if (override) return exists(override) ? override : null
  const { join } = pathFor(platform)
  const file = commandFile('claude', platform)
  for (const dir of pathDirs(env, platform)) {
    const candidate = join(dir, file)
    if (exists(candidate)) return candidate
  }
  const home = (platform === 'win32' && env['USERPROFILE']) || env['HOME']
  if (!home) return null
  return (
    [join(home, '.claude', 'local', file), join(home, '.local', 'bin', file)].find(exists) ?? null
  )
}

/** Whether `claude auth status --json` says signed in (it exits non-zero when signed out),
 *  or null when the check was stopped for taking too long. */
async function signedIn(run: RunFn): Promise<boolean | null> {
  const auth = await run(['auth', 'status', '--json']).catch(() => ({
    code: 1,
    out: '',
    timedOut: false,
  }))
  if (auth.timedOut) return null
  try {
    return (JSON.parse(auth.out) as { loggedIn?: unknown }).loggedIn === true
  } catch {
    return false
  }
}

/** The version and sign-in state of `binary`. An Anthropic API key in the env it would run
 *  with counts as signed in. */
export async function probeClaude(
  binary: string,
  run: RunFn,
  env: Record<string, string | undefined>,
): Promise<HarnessStatus> {
  const version = await run(['--version']).catch(() => ({ code: 1, out: '' }))
  if (version.code !== 0)
    return { available: false, binary, loggedIn: false, reason: 'probe-failed', version: null }
  const versionText = version.out.trim().split(/\s+/)[0] || null
  const loggedIn = !!env['ANTHROPIC_API_KEY']?.trim() || (await signedIn(run))
  // A sign-in check stopped for taking too long (a busy computer) says nothing either way.
  if (loggedIn === null)
    return {
      available: false,
      binary,
      loggedIn: false,
      reason: 'probe-failed',
      version: versionText,
    }
  return loggedIn
    ? { available: true, binary, loggedIn: true, version: versionText }
    : { available: false, binary, loggedIn: false, reason: 'not-logged-in', version: versionText }
}

const runWith =
  (binary: string, env: Record<string, string | undefined>): RunFn =>
  (args) =>
    new Promise((resolve) => {
      execFile(binary, args, { env, timeout: 5000 }, (err, stdout, stderr) => {
        const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0
        resolve({ code, out: `${stdout}${stderr}`, timedOut: err?.killed === true })
      })
    })

/** How long a check that can't answer (a busy computer) keeps the last good answer. */
const KEEP_GOOD_MS = 5 * 60_000

let cached: null | { at: number; goodAt: number; status: HarnessStatus } = null

/** Caches this answer. A failed check of the binary that answered well less than
 *  KEEP_GOOD_MS ago keeps that good answer instead: only a finished check changes it.
 *  A signed-in answer that only lacks the shell sandbox counts as good: planning calls
 *  still use it (Task 1.10a). */
function remember(status: HarnessStatus): HarnessStatus {
  const now = Date.now()
  const last = cached
  if (
    status.reason === 'probe-failed' &&
    (last?.status.available || (last?.status.loggedIn && last.status.reason === 'no-sandbox')) &&
    last.status.binary === status.binary &&
    now - last.goodAt < KEEP_GOOD_MS
  ) {
    cached = { ...last, at: now }
    return last.status
  }
  cached = { at: now, goodAt: now, status }
  return status
}

/** Forgets the cached answer (tests). */
export function resetClaudeStatusCacheForTesting(): void {
  cached = null
}

const onPath = (cmd: string): boolean =>
  (process.env['PATH'] ?? '')
    .split(path.delimiter)
    .some((dir) => dir && fs.existsSync(path.join(dir, cmd)))

/** Linux sandboxes the shell with bubblewrap and socat; macOS needs nothing extra. */
const defaultSandboxReady = (): boolean =>
  process.platform !== 'linux' || (onPath('bwrap') && onPath('socat'))

export interface GetClaudeStatusDeps {
  find?: () => null | string
  /** Replaces the whole probe. */
  probe?: (binary: string) => Promise<HarnessStatus>
  /** Whether the shell sandbox the chats run under works here (default: not on Linux without
   *  bubblewrap and socat; macOS has it built in). */
  sandboxReady?: () => boolean
}

/**
 * Whether Claude Code can run agent chats: found, and signed in (or an API key set). Probed
 * with the env sessions get, so the answer is for the login they will use. `refresh: true`
 * bypasses the 30 s cache.
 */
export async function getClaudeStatus(
  options: { refresh?: boolean } = {},
  deps: GetClaudeStatusDeps = {},
): Promise<HarnessStatus> {
  if (!options.refresh && cached && Date.now() - cached.at < 30_000) return cached.status
  const find =
    deps.find ?? (() => findClaudeBinary({ env: process.env, exists: (p) => fs.existsSync(p) }))
  const env = scrubClaudeEnv(process.env)
  const probe = deps.probe ?? ((binary: string) => probeClaude(binary, runWith(binary, env), env))
  const binary = find()
  const probed: HarnessStatus = binary
    ? await probe(binary)
    : { available: false, binary: null, loggedIn: false, reason: 'not-found', version: null }
  // A chat whose shell sandbox can't start fails every turn: say so before one is picked.
  const sandboxReady = deps.sandboxReady ?? defaultSandboxReady
  const status: HarnessStatus =
    probed.available && !sandboxReady()
      ? { ...probed, available: false, reason: 'no-sandbox' }
      : probed
  return remember(status)
}

/** The `claude` executable, or an error saying why it can't run. `sandbox: false` is for calls
 *  that run no tools (the video pipeline's planning calls): they also work where only the
 *  shell sandbox is missing. */
export async function resolveClaudeBinaryOrThrow(
  options: { sandbox?: boolean } = {},
): Promise<string> {
  const status = await getClaudeStatus()
  const usable =
    status.available ||
    (options.sandbox === false && status.loggedIn && status.reason === 'no-sandbox')
  if (!usable || !status.binary)
    throw new Error(`Claude Code is not available (${status.reason ?? 'unknown'})`)
  return status.binary
}
