/**
 * Decisions `pnpm reelmakeeasy start`, `build` and `doctor` make about the production build, kept
 * free of side effects so `node --test scripts/reelmakeeasy-build.test.mjs` can check them.
 *
 * `start` runs the built API bundle and the web app's production build (`next start`), and
 * builds first only when needed: an output is missing, the code changed (git HEAD plus the
 * uncommitted changes to tracked files), or the settings the web build bakes in changed.
 * Without git, only a missing output (or changed web settings) triggers a build.
 */
import { createHash } from 'node:crypto'
import path from 'node:path'

/** The API bundle `nx run api:build` writes (the same one `pnpm dev` builds and runs). */
export const API_BUNDLE = 'apps/services/api/dist/main.js'
/** The production web build, inside apps/web. Kept apart from `.next`, which `pnpm dev` uses. */
export const WEB_DIST_DIR = '.next-prod'
/** Written last by `next build`, so it is there only when a web build finished. */
export const WEB_BUILD_ID = `apps/web/${WEB_DIST_DIR}/BUILD_ID`
/** In the data folder: what the last build was built from. */
export const BUILD_STAMP = 'build-stamp.json'

const STAMP_VERSION = 1
const DEFAULT_API_PORT = 5017
const DEFAULT_WEB_PORT = 3000

const sha256 = (...parts) => {
  const hash = createHash('sha256')
  for (const part of parts) hash.update(part).update('\0')
  return hash.digest('hex')
}

/**
 * The ports a run uses. A second copy runs beside the first on other ports: PORT moves the API
 * (and the files URL), WEB_PORT moves the web app, and the web app is pointed at this copy's API
 * (`webDefaults`: the values to fill in where the env doesn't set them).
 */
export function runPorts(env) {
  const apiPort = Number(env.PORT || DEFAULT_API_PORT)
  const webPort = Number(env.WEB_PORT || DEFAULT_WEB_PORT)
  const webDefaults = {}
  if (apiPort !== DEFAULT_API_PORT) {
    const origin = `http://localhost:${apiPort}`
    if (!env.DEV_API_PROXY_TARGET) webDefaults.DEV_API_PROXY_TARGET = origin
    if (!env.NEXT_PUBLIC_API_ORIGIN) webDefaults.NEXT_PUBLIC_API_ORIGIN = origin
  }
  return { apiPort, webDefaults, webPort }
}

/**
 * A fingerprint of the code: git HEAD plus the uncommitted changes to tracked files
 * (`git diff HEAD`), so a pull or a local edit means a new build. null without git.
 * @param {{ head: string, diff: string | Buffer } | null} git
 */
export function sourceFingerprint(git) {
  if (!git?.head) return null
  return sha256(git.head, git.diff ?? '')
}

/**
 * A fingerprint of what the web build bakes in: every NEXT_PUBLIC_ value is inlined into the
 * pages, and the address /api is passed on to (DEV_API_PROXY_TARGET) is written into the build.
 * Only a hash is kept, never the values.
 */
export function webBuildSettings(env) {
  const baked = Object.entries(env)
    .filter(
      ([name, value]) =>
        value && (name.startsWith('NEXT_PUBLIC_') || name === 'DEV_API_PROXY_TARGET'),
    )
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return sha256(JSON.stringify(baked))
}

/** "size:time" of a build output from its `fs.stat`, or null when it is missing. */
export function outputSignature(stat) {
  return stat ? `${stat.size}:${Math.round(stat.mtimeMs)}` : null
}

const PARTS = ['api', 'web']
const PART_LABEL = { api: 'the API', web: 'the web app' }

/**
 * Which parts need a build, with the reason in plain words; null for a part that is up to date.
 * `current` is this checkout: `{ outputs: { api, web }, settings, source }` (outputs from
 * `outputSignature`, settings from `webBuildSettings`, source from `sourceFingerprint`).
 * `stamp` is the last build's (`buildStamp`), or undefined.
 */
export function buildPlan({ current, stamp }) {
  return Object.fromEntries(PARTS.map((part) => [part, partReason(part, current, stamp)]))
}

function partReason(part, current, stamp) {
  if (!current.outputs[part]) return 'not built yet'
  const git = current.source !== null
  if (!stamp) return git ? 'no record of the last build' : null
  if (part === 'web' && stamp.settings !== current.settings) {
    return 'its settings changed (PORT or a NEXT_PUBLIC_ value)'
  }
  if (!git) return null
  if (stamp.source !== current.source) return 'the code changed since the last build'
  // `pnpm dev` rebuilds the API bundle from whatever the code was then.
  if (stamp.outputs?.[part] !== current.outputs[part]) return 'another command rebuilt it since'
  return null
}

/** What a finished build records: the code and settings it was built from, and its outputs. */
export function buildStamp({ outputs, settings, source }, builtAt = new Date()) {
  return { builtAt: builtAt.toISOString(), outputs, settings, source, version: STAMP_VERSION }
}

/** The stamp in `<data dir>/build-stamp.json`; undefined when missing, unreadable or older. */
export function parseBuildStamp(text) {
  if (!text) return undefined
  try {
    const stamp = JSON.parse(text)
    return stamp && typeof stamp === 'object' && stamp.version === STAMP_VERSION ? stamp : undefined
  } catch {
    return undefined
  }
}

/** "the API (reason) and the web app (reason)"; null when nothing needs a build. */
export function planSummary(plan) {
  const parts = PARTS.filter((part) => plan[part]).map(
    (part) => `${PART_LABEL[part]} (${plan[part]})`,
  )
  return parts.length > 0 ? parts.join(' and ') : null
}

/** doctor's Build line. A warning only: `pnpm reelmakeeasy start` builds what is missing. */
export function buildCheck(plan) {
  const summary = planSummary(plan)
  return {
    blocking: false,
    detail: summary
      ? `needs a build: ${summary}. \`pnpm reelmakeeasy start\` builds it`
      : 'built and up to date',
    name: 'Build',
    ok: !summary,
  }
}

/** An argument for cmd.exe: quoted when it holds anything but plain path and flag characters. */
const cmdArg = (arg) => (/^[\w@+=:,./\\-]+$/.test(arg) ? arg : `"${arg.replaceAll('"', '""')}"`)

/**
 * How to start pnpm with `args`: `{ command, args, shell }` for spawn. Inside `pnpm reelmakeeasy`,
 * pnpm names itself in npm_execpath. On Windows that is run directly, its script with this Node
 * or its own pnpm.exe, because a plain `pnpm` there is a pnpm.cmd shim, which Node starts only
 * through a shell (CVE-2024-27980). Without it, pnpm.cmd through cmd.exe, the arguments quoted.
 * Elsewhere `pnpm` from PATH.
 */
export function pnpmCommand(args, { env, execPath, platform }) {
  if (platform !== 'win32') return { args, command: 'pnpm', shell: false }
  const self = env.npm_execpath ?? ''
  const name = path.win32.basename(self).toLowerCase()
  if (/^pnpm\.[cm]?js$/.test(name))
    return { args: [self, ...args], command: execPath, shell: false }
  if (name === 'pnpm.exe') return { args, command: self, shell: false }
  // One command line, not args: Node joins args unquoted under a shell (and warns about it).
  return { args: [], command: ['pnpm.cmd', ...args].map(cmdArg).join(' '), shell: true }
}
