import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import { Logger } from '@reelmakeeasy/common/logger'
import { ensureError } from '@reelmakeeasy/common/utils/error-handler'
import type { CodexStatus } from '@shared/types/api/agent'

import { scrubCodexEnv } from './codex-config'
import { ensureAgentCodexHome } from './codex-home'

const APP_BUNDLES = [
  '/Applications/Codex.app/Contents/Resources/codex',
  '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex',
]

export interface LocatorDeps {
  env: Record<string, string | undefined>
  exists: (p: string) => boolean
}

/** A CLI check's exit code and output; `timedOut` when it was stopped for taking too long. */
export type RunFn = (args: string[]) => Promise<{ code: number; out: string; timedOut?: boolean }>

/** CODEX_BIN, then `codex` on PATH, then the Codex and ChatGPT desktop app bundles. */
export function findCodexBinary({ env, exists }: LocatorDeps): null | string {
  const override = env['CODEX_BIN']?.trim()
  if (override) return exists(override) ? override : null
  for (const dir of (env['PATH'] ?? '').split(path.delimiter).filter(Boolean)) {
    const candidate = path.join(dir, 'codex')
    if (exists(candidate)) return candidate
  }
  return APP_BUNDLES.find(exists) ?? null
}

export async function probeCodex(binary: string, run: RunFn): Promise<CodexStatus> {
  const version = await run(['--version']).catch(() => ({ code: 1, out: '' }))
  if (version.code !== 0) {
    return { available: false, binary, loggedIn: false, reason: 'probe-failed', version: null }
  }
  const versionText = version.out.trim().replace(/^codex-cli\s+/, '') || null
  const login = await run(['login', 'status']).catch(() => ({ code: 1, out: '', timedOut: false }))
  // A check stopped for taking too long (a busy computer) says nothing about the sign-in.
  if (login.timedOut)
    return {
      available: false,
      binary,
      loggedIn: false,
      reason: 'probe-failed',
      version: versionText,
    }
  const loggedIn =
    login.code === 0 && /logged in/i.test(login.out) && !/not logged in/i.test(login.out)
  return loggedIn
    ? { available: true, binary, loggedIn: true, version: versionText }
    : { available: false, binary, loggedIn: false, reason: 'not-logged-in', version: versionText }
}

const logger = new Logger('AgentCodexLocator')

const runWith =
  (binary: string, env: NodeJS.ProcessEnv): RunFn =>
  (args) =>
    new Promise((resolve) => {
      execFile(binary, args, { env, timeout: 3000 }, (err, stdout, stderr) => {
        const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0
        resolve({ code, out: `${stdout}${stderr}`, timedOut: err?.killed === true })
      })
    })

export interface GetCodexStatusDeps {
  find?: () => null | string
  /** The agent sessions' Codex home the probe runs with (default: `ensureAgentCodexHome()`). */
  home?: () => string
  /** Replaces the whole probe (then `home` and `runner` are unused). */
  probe?: (binary: string) => Promise<CodexStatus>
  /** Runs `binary` with `env` (default: `execFile`). */
  runner?: (binary: string, env: NodeJS.ProcessEnv) => RunFn
}

/** How long a check that can't answer (a busy computer) keeps the last good answer. */
const KEEP_GOOD_MS = 5 * 60_000

let cached: null | { at: number; goodAt: number; status: CodexStatus } = null

/** Caches this answer. A failed check of the binary that answered well less than
 *  KEEP_GOOD_MS ago keeps that good answer instead: only a finished check changes it. */
function remember(status: CodexStatus): CodexStatus {
  const now = Date.now()
  const last = cached
  if (
    status.reason === 'probe-failed' &&
    last?.status.available &&
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
export function resetCodexStatusCacheForTesting(): void {
  cached = null
}

/**
 * `refresh: true` bypasses the 30 s cache (used by the "Agent (Codex)" button's
 * on-click check, which wants a live answer rather than a stale one). `deps`
 * lets tests substitute the binary lookup/probe without touching the real
 * filesystem or spawning a process.
 */
export async function getCodexStatus(
  options: { refresh?: boolean } = {},
  deps: GetCodexStatusDeps = {},
): Promise<CodexStatus> {
  if (!options.refresh && cached && Date.now() - cached.at < 30_000) return cached.status
  const find =
    deps.find ?? (() => findCodexBinary({ env: process.env, exists: (p) => fs.existsSync(p) }))
  // Probe with the env sessions get (agent Codex home, no ReelMakeEasy secrets), so
  // `login status` answers for the login those sessions will actually use.
  const home =
    deps.home ?? (() => ensureAgentCodexHome({ warn: (msg: string) => logger.warn(msg) }))
  const runner = deps.runner ?? runWith
  const probe =
    deps.probe ??
    (async (binary: string): Promise<CodexStatus> => {
      let codexHomeDir: string
      try {
        codexHomeDir = home()
      } catch (error) {
        logger.warn(`Could not prepare the agent Codex home: ${ensureError(error).message}`)
        return { available: false, binary, loggedIn: false, reason: 'probe-failed', version: null }
      }
      const env = { ...scrubCodexEnv(process.env), CODEX_HOME: codexHomeDir }
      return probeCodex(binary, runner(binary, env))
    })
  const binary = find()
  const status: CodexStatus = binary
    ? await probe(binary)
    : { available: false, binary: null, loggedIn: false, reason: 'not-found', version: null }
  return remember(status)
}

export async function resolveCodexBinaryOrThrow(): Promise<string> {
  const status = await getCodexStatus()
  if (!status.available || !status.binary) {
    throw new Error(`Codex is not available (${status.reason ?? 'unknown'})`)
  }
  return status.binary
}
