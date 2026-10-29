#!/usr/bin/env node
/**
 * ReelMakeEasy command line.
 *
 *   pnpm reelmakeeasy setup   [--fal-key=KEY] [--gemini-key=KEY] [--elevenlabs-key=KEY] [--yes]
 *                           [--llm=claude|codex|gemini|endpoint] [--generation=fal|google]
 *                           [--local-tts=all|kokoro|qwen|off] [--local-captions=on|off]
 *                           [--agent-harness=codex|claude] [--no-build]
 *   pnpm reelmakeeasy doctor  [--json]
 *   pnpm reelmakeeasy start   (or `pnpm start`)
 *   pnpm reelmakeeasy build
 *   pnpm reelmakeeasy dev
 *   pnpm reelmakeeasy <command> --help   (that command's usage; runs nothing)
 *
 * Videos need FAL_KEY or GEMINI_API_KEY; Codex, Claude Code, Gemini or an
 * OpenAI-compatible endpoint write and plan them (see reelmakeeasy-onboarding.mjs).
 * In a terminal, `setup` first asks which video service to use, the keys for it one at a time,
 * the optional ElevenLabs key, which free local voices to install and whether to time captions
 * locally (reelmakeeasy-setup-ui.mjs); --yes asks nothing. Then it writes .env, generates the
 * database client, installs the preset pack (style thumbnails and previews), the local voices
 * picked (Kokoro and/or Qwen3-TTS on this machine's GPU) and local caption timing (Whisper and a
 * forced aligner; see tools/local-tts), then builds the app.
 * `doctor` checks the machine, keys and services and exits non-zero on a
 * blocking problem (use --json for machine-readable output). `start` builds the
 * app when the code changed (see reelmakeeasy-build.mjs), starts an embedded
 * MongoDB when no URL is configured, syncs the schema, then runs the API bundle
 * and the web app's production build. `build` builds both now. `dev` does what
 * `start` does with the web app in development mode, for changing the code.
 * Both listen on 127.0.0.1 only, unless HOST says otherwise (HOST=0.0.0.0: every interface).
 */
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import readline from 'node:readline/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import tls from 'node:tls'
import { fileURLToPath } from 'node:url'

import {
  API_BUNDLE,
  BUILD_STAMP,
  buildCheck,
  buildPlan,
  buildStamp,
  outputSignature,
  parseBuildStamp,
  planSummary,
  pnpmCommand,
  runPorts,
  sourceFingerprint,
  WEB_BUILD_ID,
  WEB_DIST_DIR,
  webBuildSettings,
} from './reelmakeeasy-build.mjs'
import {
  chosenProviders,
  commandHelp,
  keyChecks,
  missingVideoKey,
  NO_VIDEO_KEY_WARNING,
  parseProviderFlags,
  parseStoredSettings,
  SETUP_KEYS,
  setupDoneMessage,
  USAGE,
} from './reelmakeeasy-onboarding.mjs'
import {
  askSetupQuestions,
  captionEngines,
  captionsScreen,
  elapsedLabel,
  generationDefault,
  installedEngines,
  keysForService,
  localCaptionsCheck,
  localServerEngines,
  localServerFallback,
  localTtsEngines,
  localVoicesCheck,
  painter,
  parseLocalCaptionsFlag,
  parseLocalTtsFlag,
  progressLine,
  qwenFit,
  skippedPartNote,
  supportsHyperlinks,
  SYMBOLS,
  terminalAsk,
  terminalLink,
  unicodeSupported,
  voicesScreen,
  writerLine,
} from './reelmakeeasy-setup-ui.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ENV_FILE = path.join(ROOT, '.env')
const ENV_EXAMPLE = path.join(ROOT, '.env.example')
const PRISMA_SCHEMA = path.join(ROOT, 'libs/api/db/prisma/schema.prisma')
const PACK_FILE = path.join(ROOT, 'presets/pack.json')
const WEB_DIR = path.join(ROOT, 'apps/web')

const args = process.argv.slice(3)
const flag = (name) => {
  const hit = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return undefined
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : true
}

const color = (code) => (s) => (process.stdout.isTTY ? `\x1b[${code}m${s}\x1b[0m` : s)
const green = color(32)
const red = color(31)
const yellow = color(33)
const dim = color(2)

// ---------- env file ----------

function readEnvFile() {
  if (!fs.existsSync(ENV_FILE)) return {}
  const out = {}
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line)
    if (m) out[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2')
  }
  return out
}

function setEnvValue(name, value) {
  const text = fs.existsSync(ENV_FILE) ? fs.readFileSync(ENV_FILE, 'utf8') : ''
  const line = `${name}=${value}`
  const re = new RegExp(`^\\s*#?\\s*${name}=.*$`, 'm')
  fs.writeFileSync(
    ENV_FILE,
    re.test(text) ? text.replace(re, line) : `${text.trimEnd()}\n${line}\n`,
  )
}

/** process env wins over .env, so agents and CI can inject values directly. */
function loadEnv() {
  const env = { ...readEnvFile(), ...process.env }
  for (const [k, v] of Object.entries(env)) if (v === '') delete env[k]
  return env
}

// ---------- helpers ----------

/** How to start pnpm with `args` on this computer: `{ command, args, shell }` for spawn, and
 *  `label` ("pnpm exec prisma") to name it, however it starts. */
const pnpm = (args) => ({
  ...pnpmCommand(args, {
    env: process.env,
    execPath: process.execPath,
    platform: process.platform,
  }),
  label: `pnpm ${args.slice(0, 2).join(' ')}`,
})

/** A command's file name here: its .exe on Windows. */
const exeName = (name) => (process.platform === 'win32' ? `${name}.exe` : name)

function hasCommand(cmd) {
  return (
    spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore' })
      .status === 0
  )
}

function portInUse(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port })
    socket.once('connect', () => (socket.destroy(), resolve(true)))
    socket.once('error', () => resolve(false))
  })
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

/**
 * A quick structural check of the model registry: it parses, and every
 * non-null role names a key in `models`. The API validates it fully at boot.
 */
function checkModelsFile(env) {
  const modelsFile = setting(env, 'MODELS_FILE')
  const file = modelsFile
    ? path.resolve(ROOT, modelsFile.value)
    : path.join(ROOT, 'reelmakeeasy.models.json')
  const shown = file.startsWith(`${ROOT}${path.sep}`) ? path.relative(ROOT, file) : file
  if (!fs.existsSync(file)) {
    return modelsFile
      ? { detail: `${shown} not found (${modelsFile.varName})`, ok: false }
      : { detail: 'not found; using bundled defaults', ok: true }
  }
  let registry
  try {
    registry = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    return { detail: `${shown} is not valid JSON: ${error.message}`, ok: false }
  }
  const models = registry?.models ?? {}
  const broken = Object.entries(registry?.roles ?? {})
    .filter(([role, key]) => !role.startsWith('$') && key !== null && !Object.hasOwn(models, key))
    .map(([role, key]) => `roles.${role} -> "${key}" is not a model key`)
  if (!registry?.roles) broken.unshift('missing "roles"')
  return broken.length
    ? { detail: `${shown}: ${broken.join('; ')}`, ok: false }
    : { detail: shown, ok: true }
}

async function fetchStatus(url, init) {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) })
    return res.status
  } catch {
    return 0
  }
}

/** A setting's value and the variable it came from: `{ value, varName }` or null. */
function setting(env, name) {
  const value = env[name]?.trim()
  return value ? { value, varName: name } : null
}

function dataDir(env) {
  return path.resolve(ROOT, setting(env, 'DATA_DIR')?.value || '.reelmakeeasy')
}

// ---------- preset pack ----------
// Style thumbnails and preview videos ship as a release asset (presets/pack.json
// names it) and unpack to <data dir>/presets/<version>. See presets/README.md.

function readPack() {
  return JSON.parse(fs.readFileSync(PACK_FILE, 'utf8'))
}

function packDir(env, pack) {
  return path.join(dataDir(env), 'presets', pack.version)
}

/** A verified unpack leaves the archive's sha256 in the pack directory. */
function packInstalled(env, pack) {
  const marker = path.join(packDir(env, pack), '.sha256')
  return fs.existsSync(marker) && fs.readFileSync(marker, 'utf8').trim() === pack.sha256
}

async function downloadPack(pack, to) {
  const url = `https://github.com/${pack.repo}/releases/download/${pack.tag}/${pack.asset}`
  const res = await fetch(url).catch(() => undefined)
  if (res?.ok) return pipeline(Readable.fromWeb(res.body), fs.createWriteStream(to))
  // A private copy of the repo only serves release assets to signed-in users; the GitHub CLI
  // has the login.
  if (!hasCommand('gh')) {
    throw new Error(
      `${url} → HTTP ${res?.status ?? 'unreachable'}. Check the connection and retry, or download that file and set PRESETS_PACK to its path.`,
    )
  }
  const gh = spawnSync(
    'gh',
    ['release', 'download', pack.tag, '-R', pack.repo, '-p', pack.asset, '-O', to, '--clobber'],
    {
      stdio: ['ignore', 'ignore', 'pipe'],
    },
  )
  if (gh.status !== 0) throw new Error(`gh release download failed: ${gh.stderr.toString().trim()}`)
}

/**
 * Downloads (or copies PRESETS_PACK), verifies and unpacks the pack unless it's
 * installed. Returns false when it was already installed.
 */
async function ensurePresetPack(env, report) {
  const pack = readPack()
  if (packInstalled(env, pack)) return false
  await report.task(
    `Downloading styles and previews (${(pack.bytes / 1024 / 1024).toFixed(0)} MB)`,
    () => unpackPresetPack(env, pack),
    { done: `Styles and previews ${pack.version} installed` },
  )
  return true
}

async function unpackPresetPack(env, pack) {
  const dir = packDir(env, pack)
  const tmp = `${dir}.tmp-${process.pid}`
  const archive = path.join(tmp, pack.asset)
  fs.rmSync(tmp, { force: true, recursive: true })
  fs.mkdirSync(tmp, { recursive: true })
  try {
    const localPack = setting(env, 'PRESETS_PACK')
    if (localPack) {
      fs.copyFileSync(path.resolve(ROOT, localPack.value), archive)
    } else {
      await downloadPack(pack, archive)
    }
    const sha256 = createHash('sha256').update(fs.readFileSync(archive)).digest('hex')
    if (sha256 !== pack.sha256)
      throw new Error(`Preset pack checksum mismatch: got ${sha256}, expected ${pack.sha256}`)
    execFileSync('tar', ['-xzf', archive, '-C', tmp])
    fs.rmSync(archive)
    fs.writeFileSync(path.join(tmp, '.sha256'), pack.sha256)
    fs.rmSync(dir, { force: true, recursive: true })
    fs.renameSync(tmp, dir)
  } catch (err) {
    fs.rmSync(tmp, { force: true, recursive: true })
    throw err
  }
  // Older versions are dead weight once the current one is in place.
  for (const old of fs.readdirSync(path.dirname(dir))) {
    if (/^v\d+$/.test(old) && old !== pack.version)
      fs.rmSync(path.join(path.dirname(dir), old), { force: true, recursive: true })
  }
}

/** Setup and dev keep going without the pack: only style thumbnails and previews are missing. */
async function tryEnsurePresetPack(env, report = makeReporter({ guide: false })) {
  try {
    return await ensurePresetPack(env, report)
  } catch (err) {
    report.warn(
      `Styles and previews not installed: ${err instanceof Error ? err.message : String(err)}\n  Style thumbnails and previews will be missing. Retry with \`pnpm reelmakeeasy setup\`.`,
    )
    return null
  }
}

// ---------- build ----------
// `start` runs the API bundle and the web app's production build, and builds them first when
// needed (reelmakeeasy-build.mjs decides). The web build goes to apps/web/.next-prod, apart from
// the `.next` that `pnpm dev` uses, so building never disturbs a running `pnpm dev`.

/** Fills in the web app's API address when PORT moved the API; returns the ports. */
function applyRunPorts(env) {
  const ports = runPorts(env)
  for (const [name, value] of Object.entries(ports.webDefaults)) env[name] ||= value
  return ports
}

function buildOutputs() {
  const stat = (file) => fs.statSync(path.join(ROOT, file), { throwIfNoEntry: false })
  return { api: outputSignature(stat(API_BUNDLE)), web: outputSignature(stat(WEB_BUILD_ID)) }
}

/** HEAD and the uncommitted changes to tracked files, or null without git or a checkout. */
function gitState() {
  const git = (...gitArgs) =>
    spawnSync('git', gitArgs, {
      cwd: ROOT,
      maxBuffer: 1024 ** 3,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
  const head = git('rev-parse', 'HEAD')
  if (head.error || head.status !== 0) return null
  const diff = git('diff', '--no-ext-diff', '--no-textconv', '--no-color', '--binary', 'HEAD')
  if (diff.error || diff.status !== 0) return null
  return { diff: diff.stdout, head: head.stdout.toString().trim() }
}

/** This checkout, as `buildPlan` compares it with the last build. */
function currentBuild(env) {
  return {
    outputs: buildOutputs(),
    settings: webBuildSettings(env),
    source: sourceFingerprint(gitState()),
  }
}

const buildStampFile = (env) => path.join(dataDir(env), BUILD_STAMP)

function readBuildStamp(env) {
  const file = buildStampFile(env)
  return parseBuildStamp(fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '')
}

function runBuildStep(what, pnpmArgs, env) {
  console.log(dim(`\nBuilding ${what}…`))
  const p = pnpm(pnpmArgs)
  const res = spawnSync(p.command, p.args, { cwd: ROOT, env, shell: p.shell, stdio: 'inherit' })
  if (res.status !== 0) {
    throw new Error(
      `Building ${what} failed (see the lines above). Fix it, then run \`pnpm reelmakeeasy build\`.`,
    )
  }
}

/** What the web app's build and `next start` run with (no Next.js usage reporting). */
function webEnv(env) {
  return {
    ...env,
    WEB_DIST_DIR,
    NEXT_TELEMETRY_DISABLED: '1',
    NODE_ENV: 'production',
  }
}

/**
 * Builds the API bundle and the web app when they are missing or the code changed (both with
 * `force`), then records what it built from. `env` must have its ports applied.
 */
function buildApp(env, { force = false } = {}) {
  const current = currentBuild(env)
  const plan = force
    ? { api: 'asked for', web: 'asked for' }
    : buildPlan({ current, stamp: readBuildStamp(env) })
  const summary = planSummary(plan)
  if (!summary) {
    console.log(`${green('✓')} The app is built and up to date`)
    return
  }
  console.log(
    force
      ? 'Building the API and the web app. This takes a few minutes…'
      : `Building ${summary}. This takes a few minutes; later starts are quick.`,
  )
  if (plan.api) runBuildStep('the API', ['exec', 'nx', 'run', 'api:build'], env)
  if (plan.web) runBuildStep('the web app', ['exec', 'nx', 'run', 'web:build'], webEnv(env))
  recordBuild(env, current)
  console.log(`${green('✓')} The app is built`)
}

/** Records what the app was built from, so the next start knows it's up to date. */
function recordBuild(env, current) {
  const stamp = buildStamp({ ...current, outputs: buildOutputs() })
  fs.mkdirSync(dataDir(env), { recursive: true })
  fs.writeFileSync(buildStampFile(env), `${JSON.stringify(stamp, null, 2)}\n`)
}

/**
 * Setup's build: in a terminal, one line with a spinner, and the build's output only when it
 * fails; elsewhere the same as `buildApp`. `env` must have its ports applied.
 */
async function buildAppInSetup(env, report) {
  if (!process.stdout.isTTY) return buildApp(env)
  const current = currentBuild(env)
  const plan = buildPlan({ current, stamp: readBuildStamp(env) })
  if (!planSummary(plan)) return report.done('The app is built and up to date')
  try {
    await report.task(
      'Building the app (a few minutes; later starts are quick)',
      async () => {
        const nx = (target, targetEnv) => {
          const p = pnpm(['exec', 'nx', 'run', target])
          return report.run(p.command, p.args, {
            cwd: ROOT,
            env: targetEnv,
            label: p.label,
            shell: p.shell,
          })
        }
        if (plan.api) await nx('api:build', env)
        if (plan.web) await nx('web:build', webEnv(env))
      },
      { done: 'The app is built' },
    )
  } catch (err) {
    throw new Error(
      `${err instanceof Error ? err.message : String(err)}\nFix it, then run \`pnpm reelmakeeasy build\`.`,
    )
  }
  recordBuild(env, current)
}

// ---------- local voices and captions ----------
// Kokoro and Qwen3-TTS voices, and Whisper caption timing, can run on this machine
// for free (tools/local-tts). Setup picks the backend from the hardware, builds a
// Python venv with uv (which also fetches Python itself), and downloads the models
// from public Hugging Face repos: no account or token. Without them, those voices
// run on fal and ElevenLabs, fal or Gemini time the captions.

const LOCAL_TTS_SRC = path.join(ROOT, 'tools/local-tts')
const UV_VERSION = '0.12.21'
const UV_TARGETS = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
  'linux-arm64': 'aarch64-unknown-linux-gnu',
  'linux-x64': 'x86_64-unknown-linux-gnu',
  'win32-x64': 'x86_64-pc-windows-msvc',
}
/** RAM / GPU memory Qwen3 needs locally; shared with local_tts.py. */
const LOCAL_TTS_HARDWARE = JSON.parse(
  fs.readFileSync(path.join(LOCAL_TTS_SRC, 'hardware.json'), 'utf8'),
)

const localTtsHome = (env) => path.join(dataDir(env), 'local-tts')
const localTtsPython = (env) =>
  process.platform === 'win32'
    ? path.join(localTtsHome(env), 'venv', 'Scripts', 'python.exe')
    : path.join(localTtsHome(env), 'venv', 'bin', 'python')

/** HF_HOME under the data dir keeps every model download in one place. */
function localTtsEnv(env, extra = {}) {
  return {
    ...process.env,
    ...env,
    HF_HOME: path.join(dataDir(env), 'models', 'huggingface'),
    HF_HUB_DISABLE_TELEMETRY: '1',
    // The models are public: hide huggingface_hub's nudge to sign in for higher rate limits.
    HF_HUB_VERBOSITY: 'error',
    ...extra,
  }
}

/**
 * Antivirus HTTPS scanning and company proxies re-sign traffic with a root of their own, which
 * uv and Python's requests don't trust: their downloads then fail on the certificate. A file the
 * user names in SSL_CERT_FILE goes to both (requests reads only REQUESTS_CA_BUNDLE). Else, on
 * Windows, where such a root sits in the Windows certificate store, writes this Node's roots and
 * that store to one file for both; a Node without tls.getCACertificates (before 22.15) has uv
 * read the store itself.
 */
function certificateEnv(env) {
  if (env.SSL_CERT_FILE) return { REQUESTS_CA_BUNDLE: env.REQUESTS_CA_BUNDLE || env.SSL_CERT_FILE }
  if (process.platform !== 'win32' || env.REQUESTS_CA_BUNDLE) return {}
  if (typeof tls.getCACertificates !== 'function') return { UV_NATIVE_TLS: '1' }
  const certs = new Set([...tls.getCACertificates('bundled'), ...tls.getCACertificates('system')])
  const file = path.join(localTtsHome(env), 'ca-certificates.pem')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, `${[...certs].map((pem) => pem.trim()).join('\n')}\n`)
  return { REQUESTS_CA_BUNDLE: file, SSL_CERT_FILE: file }
}

function readLocalTtsState(env) {
  try {
    return JSON.parse(fs.readFileSync(path.join(localTtsHome(env), 'state.json'), 'utf8'))
  } catch {
    return undefined
  }
}

/** mlx on Apple Silicon, cuda when an NVIDIA driver answers, else cpu. */
function detectLocalTtsBackend(env) {
  const forced = env.LOCAL_TTS_DEVICE?.toLowerCase()
  if (forced && forced !== 'auto') return forced
  if (process.platform === 'darwin' && process.arch === 'arm64') return 'mlx'
  if (spawnSync('nvidia-smi', ['-L'], { stdio: 'ignore' }).status === 0) return 'cuda'
  return 'cpu'
}

/** Memory of the NVIDIA GPU the voice server uses (GPU 0) in GB, or 0. */
function gpuMemoryGB() {
  const res = spawnSync(
    'nvidia-smi',
    ['--query-gpu=memory.total', '--format=csv,noheader,nounits', '-i', '0'],
    { encoding: 'utf8' },
  )
  const mib = Number.parseFloat(res.stdout ?? '')
  return res.status === 0 && Number.isFinite(mib) ? Math.round((mib / 1024) * 10) / 10 : 0
}

/**
 * Whether this machine can run Qwen3 locally without starving everything else
 * (tools/local-tts/hardware.json), and why not. Below the minimum only Kokoro runs locally.
 */
function qwenHardware(backend) {
  return qwenFit({
    backend,
    hardware: LOCAL_TTS_HARDWARE,
    ramGB: Math.round((os.totalmem() / 2 ** 30) * 10) / 10,
    vramGB: backend === 'cuda' ? gpuMemoryGB() : undefined,
  })
}

function requirementsHash(backend) {
  const hash = createHash('sha256').update(backend)
  for (const file of fs.readdirSync(LOCAL_TTS_SRC).sort()) {
    if (file.startsWith('requirements-'))
      hash.update(fs.readFileSync(path.join(LOCAL_TTS_SRC, file)))
  }
  return hash.digest('hex').slice(0, 16)
}

/** uv on PATH, or the pinned standalone release unpacked into <data dir>/bin. */
async function ensureUv(env, report) {
  if (hasCommand('uv')) return 'uv'
  const binDir = path.join(dataDir(env), 'bin')
  const exe = path.join(binDir, process.platform === 'win32' ? 'uv.exe' : 'uv')
  if (fs.existsSync(exe)) return exe
  const target = UV_TARGETS[`${process.platform}-${process.arch}`]
  if (!target)
    throw new Error(`No uv build for ${process.platform}-${process.arch}; install uv yourself.`)
  const asset = `uv-${target}.${process.platform === 'win32' ? 'zip' : 'tar.gz'}`
  const url = `https://github.com/astral-sh/uv/releases/download/${UV_VERSION}/${asset}`
  report.info(`Downloading uv ${UV_VERSION}, which installs the voice software…`)
  const tmp = path.join(binDir, `.uv-${process.pid}`)
  fs.mkdirSync(tmp, { recursive: true })
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`)
    await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(path.join(tmp, asset)))
    // bsdtar (macOS, Windows 10+) reads zip as well as tar.gz.
    execFileSync('tar', ['-xf', asset], { cwd: tmp })
    const found = fs
      .readdirSync(tmp, { recursive: true })
      .map(String)
      .find((f) => path.basename(f) === path.basename(exe))
    if (!found) throw new Error(`uv binary not found in ${asset}`)
    fs.renameSync(path.join(tmp, found), exe)
    fs.chmodSync(exe, 0o755)
  } finally {
    fs.rmSync(tmp, { force: true, recursive: true })
  }
  return exe
}

/** Kokoro voice packs ReelMakeEasy lists, so the torch backend can fetch them up front. */
function kokoroVoiceIds() {
  const file = path.join(ROOT, 'libs/shared/common/src/tts/preset-voices.ts')
  const ids = new Set(
    [...fs.readFileSync(file, 'utf8').matchAll(/'kokoro-([a-z]{2}_[a-z]+)'/g)].map((m) => m[1]),
  )
  return [...ids]
}

/** Bytes of the files under `dir` (links not followed), 0 when it's missing. */
function folderBytes(dir) {
  let total = 0
  try {
    for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
      if (entry.isFile()) total += fs.statSync(path.join(entry.parentPath, entry.name)).size
    }
  } catch {
    // Missing or half-written: count what was there.
  }
  return total
}

/**
 * What setup installs on the local server, each part on its own: the voice engines picked and the
 * caption timing engines. A part names its download, its Python software, and what runs instead
 * when it isn't installed.
 */
function localParts(voiceEngines, captionEnginesPicked) {
  const parts = []
  if (voiceEngines.length > 0) {
    const names = voiceEngines.map((e) => (e === 'qwen3' ? 'Qwen3' : 'Kokoro')).join(' and ')
    parts.push({
      args: () => ['--kokoro-voices', kokoroVoiceIds().join(',')],
      done: `Free local voices ready: ${names}`,
      downloading: `Downloading the ${names} voices (no account needed)`,
      engines: voiceEngines,
      instead: 'Kokoro and Qwen3 voices will run on fal.',
      kind: 'voices',
      software: 'voice',
      title: 'local voices',
    })
  }
  if (captionEnginesPicked.length > 0) {
    parts.push({
      args: () => [],
      done: 'Free local caption timing ready',
      downloading: 'Downloading Whisper for caption timing (no account needed)',
      engines: captionEnginesPicked,
      instead: 'ElevenLabs, fal or Gemini will time the captions.',
      kind: 'captions',
      software: 'caption',
      title: 'local caption timing',
    })
  }
  return parts
}

/** "Local voices not installed: <why>", then what runs instead and how to retry. */
function notInstalledWarning(parts, err) {
  const what = parts.map((part) => part.title).join(' and ')
  const why = err instanceof Error ? err.message : String(err)
  const instead = parts.map((part) => part.instead).join(' ')
  return `${what[0].toUpperCase()}${what.slice(1)} not installed: ${why}\n  ${certificateHint(why)}${instead} Retry with \`pnpm reelmakeeasy setup\`.`
}

/** Why a download failed on its certificate, when it did: something re-signs HTTPS here. */
function certificateHint(why) {
  if (!/certificate|UnknownIssuer/i.test(why)) return ''
  return 'Something on this network re-signs HTTPS (antivirus HTTPS scanning or a company proxy). Set SSL_CERT_FILE to a file with its root certificate, or turn the scanning off for setup. '
}

/**
 * Installs the local server's runtime, then each part's models (see `localParts`). Safe to
 * re-run: it reinstalls packages only when the requirements change, and downloads skip cached
 * files. A failed download warns and leaves its part as an earlier setup left it; the rest still
 * installs. state.json then lists what is installed (`installedEngines`).
 */
async function setupLocalTts(env, { backend, parts, qwen }, report) {
  if (parts.some((part) => part.engines.includes('qwen3')) && !qwen.recommended) {
    report.info(
      `${qwen.ramGB} GB of memory runs Qwen3 one model at a time (${qwen.recommendedRamGB} GB recommended).`,
    )
  }
  const home = localTtsHome(env)
  const python = localTtsPython(env)
  const uv = await ensureUv(env, report)
  const certificates = certificateEnv(env)
  const hash = requirementsHash(backend)
  const state = readLocalTtsState(env)

  if (state?.requirements !== hash || !fs.existsSync(python)) {
    const install = async () => {
      fs.mkdirSync(home, { recursive: true })
      const pyEnv = localTtsEnv(env, certificates)
      if (!fs.existsSync(python)) {
        await report.run(uv, ['venv', '--python', '3.12', '--quiet', path.join(home, 'venv')], {
          env: pyEnv,
        })
      }
      const pip = (extra) =>
        report.run(uv, ['pip', 'install', '--quiet', '--python', python, ...extra], {
          cwd: LOCAL_TTS_SRC,
          env: pyEnv,
        })
      if (backend === 'mlx') {
        await pip(['-r', 'requirements-mlx.txt'])
      } else {
        // --torch-backend=auto reads the NVIDIA driver and picks the matching CUDA build (or CPU).
        await pip(['torch', 'torchaudio', `--torch-backend=${backend === 'cuda' ? 'auto' : 'cpu'}`])
        await pip(['-r', 'requirements-torch.txt'])
      }
    }
    // Both parts run on one set of Python packages, installed whole even for one part: on a CPU
    // or NVIDIA, captions alone still bring the voice packages (not the voice models).
    const software = parts.map((part) => part.software).join(' and ')
    await report.task(`Installing the ${software} software`, install, {
      done: `${software[0].toUpperCase()}${software.slice(1)} software installed`,
    })
  }

  const installed = {}
  for (const part of parts) {
    try {
      await report.task(
        part.downloading,
        () =>
          report.run(
            python,
            [
              path.join(LOCAL_TTS_SRC, 'local_tts.py'),
              'download',
              '--engines',
              part.engines.join(','),
              ...part.args(),
            ],
            { env: localTtsEnv(env, { ...certificates, LOCAL_TTS_DEVICE: backend }) },
          ),
        { done: part.done, extra: downloadedSoFar(env) },
      )
      installed[part.kind] = part.engines
    } catch (err) {
      report.warn(notInstalledWarning([part], err))
    }
  }
  if (Object.keys(installed).length === 0) return
  const engines = installedEngines({ backend, installed, previous: state })
  fs.writeFileSync(
    path.join(home, 'state.json'),
    JSON.stringify(
      { backend, engines, installedAt: new Date().toISOString(), requirements: hash },
      null,
      2,
    ),
  )
}

/** "1.2 GB so far": what the model download has added, counted every 2 seconds. */
function downloadedSoFar(env) {
  const models = path.join(dataDir(env), 'models')
  const before = folderBytes(models)
  let shown = ''
  let checked = 0
  return () => {
    if (Date.now() - checked > 2000) {
      checked = Date.now()
      const gb = (folderBytes(models) - before) / 1e9
      shown = gb >= 0.05 ? `${gb.toFixed(1)} GB so far` : ''
    }
    return shown
  }
}

/**
 * Installs the local voices picked (`voices`: 'all', every engine this machine runs well,
 * 'kokoro', 'qwen' or 'off') and local caption timing (`captions`: 'on' or 'off'), each without
 * the other. A part skipped keeps what an earlier setup installed. A failure only warns: those
 * voices then run on fal and the captions are timed online.
 */
async function trySetupLocalTts(env, { captions, voices }, report) {
  const backend = detectLocalTtsBackend(env)
  const previous = readLocalTtsState(env)
  if (voices === 'off') report.info(skippedPartNote('voices', { backend, previous }))
  if (captions === 'off') report.info(skippedPartNote('captions', { backend, previous }))
  if (voices === 'off' && captions === 'off') return
  const qwen = qwenHardware(backend)
  const voice = localTtsEngines(voices, qwen.ok)
  if (voice.note) report.warn(`Qwen3 ${qwen.reason}. ${voice.note}`)
  const parts = localParts(voice.engines, captionEngines(captions))
  if (parts.length === 0) return
  try {
    await setupLocalTts(env, { backend, parts, qwen }, report)
  } catch (err) {
    report.warn(notInstalledWarning(parts, err))
  }
}

// ---------- setup ----------

// ---------- agent harnesses ----------

/** Runs a harness CLI briefly: its exit status and its output (stdout and stderr together, as
 *  `codex login status` writes to stderr; `claude auth status` exits 1 when signed out). */
function probeCli(binary, args) {
  const r = spawnSync(binary, args, { encoding: 'utf8', timeout: 5000 })
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}` }
}

/** The Windows Codex app's CLI, newest build first: %LOCALAPPDATA%\\OpenAI\\Codex\\bin\\<build>\\codex.exe. */
function windowsCodexApps(env) {
  const bin = path.join(
    env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'),
    'OpenAI',
    'Codex',
    'bin',
  )
  try {
    return fs
      .readdirSync(bin, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(bin, entry.name))
      .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
      .map((dir) => path.join(dir, 'codex.exe'))
  } catch {
    return []
  }
}

const codexCheck = (env) => ({
  bin: 'CODEX_BIN',
  // Where the API also looks (apps/services/api/src/agent/codex/codex-locator.ts).
  fallbacks:
    process.platform === 'win32'
      ? windowsCodexApps(env)
      : [
          '/Applications/Codex.app/Contents/Resources/codex',
          '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex',
        ],
  name: 'codex',
  signedIn: (binary) => {
    const out = probeCli(binary, ['login', 'status']).out
    return /logged in/i.test(out) && !/not logged in/i.test(out)
  },
  versionOf: (out) => out.trim().replace(/^codex-cli\s+/, ''),
})

const claudeCheck = (env) => ({
  bin: 'CLAUDE_BIN',
  fallbacks: [
    path.join(os.homedir(), '.claude', 'local', exeName('claude')),
    path.join(os.homedir(), '.local', 'bin', exeName('claude')),
  ],
  name: 'claude',
  signedIn: (binary) => {
    if (env.ANTHROPIC_API_KEY?.trim()) return true
    return /"loggedIn"\s*:\s*true/.test(probeCli(binary, ['auth', 'status', '--json']).out)
  },
  versionOf: (out) => out.trim().split(/\s+/)[0],
})

/** `{ ok, detail }` for one agent harness: installed, its version, signed in. On Windows only
 *  its .exe counts on PATH: a .cmd shim can't be started without a shell, as in the API. */
function harnessCheck(env, { bin, fallbacks, name, signedIn, versionOf }) {
  const binary =
    env[bin]?.trim() || (hasCommand(exeName(name)) ? name : fallbacks.find((p) => fs.existsSync(p)))
  if (!binary) return { detail: `not installed (set ${bin} if it is elsewhere)`, ok: false }
  const version = probeCli(binary, ['--version'])
  if (!version.ok) return { detail: `${binary} did not answer`, ok: false }
  const ok = signedIn(binary)
  return { detail: `${versionOf(version.out)}, ${ok ? 'signed in' : 'not signed in'}`, ok }
}

const AGENT_HARNESS_CHECKS = (env) => [
  ['Agent: Codex', codexCheck(env)],
  ['Agent: Claude Code', claudeCheck(env)],
]

/** Back to the start of the line, and clear it: how the spinner redraws itself. */
const CLEAR_LINE = '\r\u001B[2K'

/**
 * How setup shows progress. `guide` draws the bar on the left that the questions used; without it,
 * plain check-mark lines. In a terminal, `task` shows a spinner with the time taken and `run` keeps
 * a command's output out of sight unless it fails; elsewhere output streams as it always has.
 */
function makeReporter({ guide }) {
  const tty = Boolean(process.stdout.isTTY)
  const sym = SYMBOLS[unicodeSupported(process.env, process.platform) ? 'unicode' : 'ascii']
  const paint = painter(process.stdout)
  const line = (kind) => (text) =>
    (kind === 'warn' ? console.warn : console.log)(progressLine(kind, text, { guide, paint, sym }))
  const report = {
    done: line('done'),
    guide,
    info: line('info'),
    link: (url) => terminalLink(url, supportsHyperlinks(process.env, tty)),
    paint,
    run: (command, commandArgs, options) => runCommand(command, commandArgs, options, tty),
    sym,
    /**
     * Shows `text` while `fn` runs: a spinner with the time taken (and `extra()`, when given) in
     * a terminal, else a line before. Ends with `done` (or `text`) and the time.
     */
    async task(text, fn, { done = text, extra } = {}) {
      if (!tty) {
        report.info(`${text}…`)
        const result = await fn()
        report.done(done)
        return result
      }
      const spinner = startSpinner(text, { extra, guide, paint, sym })
      try {
        const result = await fn()
        spinner.end(paint.green(guide ? sym.submit : '✓'), done)
        return result
      } catch (err) {
        spinner.end(paint.red(guide ? sym.error : '✗'), text)
        throw err
      }
    },
    warn: line('warn'),
  }
  return report
}

/** Runs a command; fails with the end of its output. `quiet` keeps the output until then.
 *  `label` names the command in that failure (default: its name and first two arguments). */
function runCommand(command, commandArgs, { label, ...options } = {}, quiet = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, commandArgs, {
      ...options,
      stdio: quiet ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    })
    let output = ''
    const keep = (chunk) => (output = `${output}${chunk}`.slice(-20_000))
    child.stdout?.on('data', keep)
    child.stderr?.on('data', keep)
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) return resolve()
      const tail = output.trim().split('\n').slice(-30).join('\n')
      const failed = `${label ?? `${path.basename(command)} ${commandArgs.slice(0, 2).join(' ')}`} failed`
      reject(new Error(tail ? `${failed}:\n${tail}` : failed))
    })
  })
}

async function setup() {
  const { choices, localCaptions, localTts } = checkSetupFlags()
  const interactive = Boolean(process.stdin.isTTY && process.stdout.isTTY) && !flag('yes')
  const report = makeReporter({ guide: interactive })
  setupIntro(report)
  const current = loadEnv()
  const fromFlags = keysFromFlags()
  const localTtsSet = localTts ?? (current.LOCAL_TTS === 'off' ? 'off' : undefined)
  const localCaptionsSet = localCaptions ?? (current.LOCAL_ASR === 'off' ? 'off' : undefined)
  const answers = interactive
    ? await askQuestions(current, { fromFlags, localCaptionsSet, localTtsSet, report })
    : { keys: {} }

  if (!fs.existsSync(ENV_FILE)) {
    fs.copyFileSync(ENV_EXAMPLE, ENV_FILE)
    report.done('Created .env from .env.example')
  }
  saveKeys(current, { ...answers.keys, ...fromFlags }, report)
  saveProviderDefault(current, 'LLM_PROVIDER', choices.llm, report)
  if (choices.generation) {
    saveProviderDefault(current, 'GENERATION_PROVIDER', choices.generation, report)
  } else if (answers.service) {
    saveVideoService(current, answers.service, report)
  }
  setupAgentHarness(current, report)

  await report.task(
    'Preparing the database',
    () => {
      const p = pnpm(['exec', 'prisma', 'generate', `--schema=${PRISMA_SCHEMA}`, '--no-hints'])
      return report.run(p.command, p.args, { cwd: ROOT, label: p.label, shell: p.shell })
    },
    { done: 'Database ready' },
  )
  if ((await tryEnsurePresetPack(current, report)) === false) {
    report.done('Styles and previews ready')
  }
  await trySetupLocalTts(
    current,
    {
      captions: answers.localCaptions ?? localCaptionsSet ?? 'on',
      voices: answers.localTts ?? localTtsSet ?? 'all',
    },
    report,
  )

  // Built now, so the first `pnpm reelmakeeasy start` is quick. --no-build leaves it to that start.
  const build = !flag('no-build')
  const env = loadEnv()
  const { webPort } = applyRunPorts(env)
  if (build) await buildAppInSetup(env, report)
  setupOutro(setupDoneMessage({ built: build, webPort }), webPort, report)
}

/** A spinner line with the time taken; `end(mark, message)` replaces it with a final line. */
function startSpinner(text, { extra, guide, paint, sym }) {
  const started = Date.now()
  const time = () => paint.dim(`[${elapsedLabel(Date.now() - started)}]`)
  const width = Math.max(20, (process.stdout.columns ?? 80) - 24)
  let frame = 0
  if (guide) process.stdout.write(`${paint.gray(sym.bar)}\n`)
  const draw = () => {
    const spin = paint.magenta(sym.frames[frame++ % sym.frames.length])
    const more = extra ? paint.dim(extra()) : ''
    process.stdout.write(`${CLEAR_LINE}${spin}  ${text.slice(0, width)} ${time()} ${more}`)
  }
  draw()
  const timer = setInterval(draw, 120)
  return {
    end(mark, message) {
      clearInterval(timer)
      const gap = guide ? '  ' : ' '
      process.stdout.write(`${CLEAR_LINE}${mark}${gap}${message} ${time()}\n`)
    },
  }
}

/** The flags setup checks before anything else, so a mistyped choice changes nothing. */
function checkSetupFlags() {
  const choices = parseProviderFlags(args)
  const localTts = parseLocalTtsFlag(args)
  const localCaptions = parseLocalCaptionsFlag(args)
  const errors = [...choices.errors, ...[localTts.error, localCaptions.error].filter(Boolean)]
  if (errors.length > 0) {
    for (const message of errors) console.error(red(message))
    process.exit(1)
  }
  const major = Number(process.versions.node.split('.')[0])
  if (major < 22) {
    console.error(red(`Node.js 22 or later is required (found ${process.versions.node}).`))
    process.exit(1)
  }
  return { choices, localCaptions: localCaptions.value, localTts: localTts.value }
}

function setupIntro(report) {
  if (report.guide) {
    const { paint, sym } = report
    console.log(`${paint.gray(sym.barStart)}  ${paint.title(' ReelMakeEasy setup ')}`)
    report.info('A few questions first. Nothing is saved until the last one. Ctrl+C quits.')
  } else {
    console.log('Setting up ReelMakeEasy\n')
    if (!flag('yes')) {
      console.log(dim('No terminal to ask in: using the flags and .env as they are (see --help).'))
    }
  }
  for (const tool of ['ffmpeg', 'ffprobe']) {
    if (!hasCommand(tool)) {
      report.warn(`${tool} not found. Install FFmpeg 7+ before rendering videos.`)
    }
  }
}

/**
 * The screens: video service, its keys, ElevenLabs, local voices, local captions. Ctrl+C ends
 * setup here.
 */
async function askQuestions(current, { fromFlags, localCaptionsSet, localTtsSet, report }) {
  const saved = Object.fromEntries(SETUP_KEYS.map((key) => [key.name, Boolean(current[key.name])]))
  const backend = detectLocalTtsBackend(current)
  const qwen = qwenHardware(backend)
  const installed = readLocalTtsState(current)?.engines
  const voices = (service) =>
    voicesScreen({
      backend,
      fal: saved.FAL_KEY || keysForService(service).includes('FAL_KEY'),
      installed,
      qwen,
    })
  const answers = await askSetupQuestions({
    ask: await terminalAsk(),
    captions: localCaptionsSet ? null : captionsScreen({ backend }),
    fromFlags: Object.fromEntries(Object.keys(fromFlags).map((name) => [name, true])),
    saved,
    voices: localTtsSet ? null : voices,
  })
  if (answers.quit) {
    console.log(`${report.paint.gray(report.sym.barEnd)}  Setup stopped. Nothing was saved.\n`)
    process.exit(0)
  }
  return answers
}

/** The last lines: what to run next and the page to open. */
function setupOutro([next, open], webPort, report) {
  const url = `http://localhost:${webPort}`
  const openLine = open.replace(url, report.link(url))
  if (report.guide) {
    const { paint, sym } = report
    console.log(paint.gray(sym.bar))
    console.log(`${paint.gray(sym.barEnd)}  ${paint.green('Setup complete.')} ${next}`)
    console.log(`   ${openLine}\n`)
  } else {
    console.log(`\n${green('Setup complete.')} ${next}\n${openLine}`)
  }
}

/** The keys passed as flags (`--fal-key=...`), by env name. */
function keysFromFlags() {
  const out = {}
  for (const key of SETUP_KEYS) {
    const value = flag(key.flag)
    if (typeof value === 'string' && value.trim()) out[key.name] = value.trim()
  }
  return out
}

/**
 * Saves the keys typed or passed as flags to .env, and says so without showing them. Without
 * questions, it also says which keys are already set or missing, as setup always has. Updates
 * `current` in place.
 */
function saveKeys(current, keys, report) {
  const savedNow = []
  for (const key of SETUP_KEYS) {
    if (keys[key.name]) {
      setEnvValue(key.name, keys[key.name])
      current[key.name] = keys[key.name]
      savedNow.push(key.name)
      if (!report.guide) report.done(`${key.name} saved`)
    } else if (!report.guide) {
      if (current[key.name]) report.done(`${key.name} already set`)
      else report.info(`${key.name} not set (${key.purpose}). Get one at ${key.url}`)
    }
  }
  if (report.guide) {
    report.done(
      savedNow.length > 0
        ? `Saved to .env: ${savedNow.map((name) => KEY_NAMES[name]).join(', ')}`
        : 'Your keys in .env are unchanged',
    )
  }
  if (missingVideoKey(current)) report.warn(NO_VIDEO_KEY_WARNING)
}

const KEY_NAMES = {
  ELEVENLABS_API_KEY: 'ElevenLabs key',
  FAL_KEY: 'fal.ai key',
  GEMINI_API_KEY: 'Google Gemini key',
}

/** `--llm=` / `--generation=`: the default the app uses until its Setup page saves a choice. */
function saveProviderDefault(current, name, value, report) {
  if (!value) return
  setEnvValue(name, value)
  current[name] = value
  report.done(`${name}=${value} (the default; a choice saved in the app's Setup wins)`)
}

/** The video service picked on the first screen becomes the default; with both, the app asks. */
function saveVideoService(current, service, report) {
  const provider = generationDefault(service)
  if (!provider) {
    report.info('Pick which service makes the videos on the Setup page in the app.')
    return
  }
  setEnvValue('GENERATION_PROVIDER', provider)
  current.GENERATION_PROVIDER = provider
  const label = provider === 'fal' ? 'fal.ai' : 'Google Gemini'
  report.done(`${label} makes the videos (change it any time on the Setup page)`)
}

/**
 * `--agent-harness=codex|claude` saves the harness agent mode preselects. Then says, in one line,
 * which AI will write and plan the videos.
 */
function setupAgentHarness(env, report) {
  const harness = flag('agent-harness')
  if (harness !== undefined) {
    if (harness !== 'codex' && harness !== 'claude') {
      console.error(red('--agent-harness must be codex or claude'))
      process.exit(1)
    }
    setEnvValue('AGENT_HARNESS', harness)
    env.AGENT_HARNESS = harness
    report.done(`AGENT_HARNESS=${harness} (agent mode preselects it)`)
  }
  const settingsFile = path.join(dataDir(env), 'settings.json')
  const stored = parseStoredSettings(
    fs.existsSync(settingsFile) ? fs.readFileSync(settingsFile, 'utf8') : '',
  )
  const writer = writerLine({
    chosen: chosenProviders(env, stored).llm,
    ready: {
      claude: harnessCheck(env, claudeCheck(env)).ok,
      codex: harnessCheck(env, codexCheck(env)).ok,
      endpoint: Boolean(env.LLM_BASE_URL),
      gemini: Boolean(env.GEMINI_API_KEY),
    },
    tieBreak: env.AGENT_HARNESS?.trim() === 'claude' ? 'claude' : 'codex',
  })
  if (writer.ok) report.done(writer.text)
  else report.warn(writer.text)
}

// ---------- doctor ----------

async function doctor() {
  const env = loadEnv()
  const checks = []
  const add = (name, ok, detail, blocking = true) => checks.push({ blocking, detail, name, ok })

  const major = Number(process.versions.node.split('.')[0])
  add('Node.js 22+', major >= 22, process.versions.node)
  add('FFmpeg', hasCommand('ffmpeg') && hasCommand('ffprobe'), 'ffmpeg and ffprobe on PATH')
  add(
    '.env file',
    fs.existsSync(ENV_FILE),
    fs.existsSync(ENV_FILE) ? path.relative(ROOT, ENV_FILE) : 'run `pnpm reelmakeeasy setup`',
  )
  const clientGenerated = fs.existsSync(path.join(ROOT, 'libs/api/db/src/generated'))
  add(
    'Database client',
    clientGenerated,
    clientGenerated ? 'generated' : 'run `pnpm reelmakeeasy setup` to generate it',
  )
  const models = checkModelsFile(env)
  add('Model registry', models.ok, models.detail)
  const pack = readPack()
  const packOk = packInstalled(env, pack)
  add(
    'Preset pack',
    packOk,
    packOk
      ? `${pack.version} in ${path.relative(ROOT, packDir(env, pack))}`
      : 'not installed: run `pnpm reelmakeeasy setup` (style thumbnails and previews)',
    false,
  )
  const buildEnv = { ...env }
  applyRunPorts(buildEnv)
  checks.push(
    buildCheck(buildPlan({ current: currentBuild(buildEnv), stamp: readBuildStamp(buildEnv) })),
  )

  // Each agent is probed once: its own line below, and whether it can write and plan.
  const agents = Object.fromEntries(
    AGENT_HARNESS_CHECKS(env).map(([label, spec]) => [
      spec.name,
      { label, ...harnessCheck(env, spec) },
    ]),
  )
  const geminiStatus = env.GEMINI_API_KEY
    ? await fetchStatus('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', {
        headers: { 'x-goog-api-key': env.GEMINI_API_KEY },
      })
    : null
  const endpointStatus = env.LLM_BASE_URL
    ? await fetchStatus(`${env.LLM_BASE_URL.replace(/\/$/, '')}/models`, {
        headers: { Authorization: `Bearer ${env.LLM_API_KEY ?? ''}` },
      })
    : null
  const elevenlabsStatus = env.ELEVENLABS_API_KEY
    ? await fetchStatus('https://api.elevenlabs.io/v1/models', {
        headers: { 'xi-api-key': env.ELEVENLABS_API_KEY },
      })
    : null
  // The choices the app's Setup saved win over LLM_PROVIDER and GENERATION_PROVIDER.
  const settingsFile = path.join(dataDir(env), 'settings.json')
  const stored = parseStoredSettings(
    fs.existsSync(settingsFile) ? fs.readFileSync(settingsFile, 'utf8') : '',
  )
  checks.push(
    ...keyChecks({
      chosen: chosenProviders(env, stored),
      claude: agents.claude,
      codex: agents.codex,
      elevenlabsStatus,
      endpointStatus,
      env,
      geminiStatus,
    }),
  )

  if (env.DATABASE_URL) {
    // Shown without its user and password: doctor's output goes into bug reports.
    const shown = redactUrlCredentials(env.DATABASE_URL)
    const port = databasePort(env.DATABASE_URL)
    const reachable = port !== undefined && (await portInUse(port))
    add(
      'MongoDB',
      reachable,
      port === undefined
        ? `can't read DATABASE_URL (${shown})`
        : reachable
          ? shown
          : `nothing listening for ${shown}`,
    )
  } else {
    add('MongoDB', true, '`pnpm reelmakeeasy start` starts an embedded instance', false)
  }

  const tts = readLocalTtsState(env)
  // What setup installed, while its Python is still there.
  const installed = tts && fs.existsSync(localTtsPython(env)) ? tts : null
  const ttsBackend = tts?.backend ?? detectLocalTtsBackend(env)
  const voices = localVoicesCheck({ detected: ttsBackend, env, state: installed })
  add('Local voices', voices.ok, voices.detail, false)
  const qwen = qwenHardware(ttsBackend)
  const memory = `${qwen.ramGB} GB RAM${qwen.vramGB === undefined ? '' : `, ${qwen.vramGB} GB GPU`}`
  add(
    'Qwen3 hardware',
    qwen.ok,
    qwen.ok
      ? `${memory}: runs locally${qwen.recommended ? '' : ` one model at a time (${qwen.recommendedRamGB} GB recommended)`}`
      : `${memory}: Qwen3 ${qwen.reason}. Kokoro runs locally; Qwen3 voices use fal`,
    false,
  )
  const captions = localCaptionsCheck({ env, state: installed })
  add('Local captions', captions.ok, captions.detail, false)

  for (const { detail, label, ok } of Object.values(agents)) add(label, ok, detail, false)
  if (process.platform === 'linux') {
    const sandbox = hasCommand('bwrap') && hasCommand('socat')
    add(
      'Agent: Claude Code sandbox',
      sandbox,
      sandbox ? 'bubblewrap and socat found' : 'install bubblewrap and socat for Claude Code chats',
      false,
    )
  }
  add('Agent: default harness', true, env.AGENT_HARNESS?.trim() || 'codex', false)

  const { apiPort, webPort } = runPorts(env)
  const before = 'must be free before `pnpm reelmakeeasy start`'
  add(`Port ${apiPort} (API)`, !(await portInUse(apiPort)), before, false)
  add(`Port ${webPort} (web)`, !(await portInUse(webPort)), before, false)

  // Home folder paths (agent binaries) print as ~, so the output is safe to paste.
  for (const c of checks) c.detail = withoutHome(c.detail)
  const blocking = checks.filter((c) => !c.ok && c.blocking)
  if (flag('json')) {
    console.log(JSON.stringify({ checks, ok: blocking.length === 0 }, null, 2))
  } else {
    for (const c of checks) {
      const mark = c.ok ? green('✓') : c.blocking ? red('✗') : yellow('!')
      console.log(`${mark} ${c.name.padEnd(22)} ${dim(c.detail)}`)
    }
    console.log(
      blocking.length
        ? red(`\n${blocking.length} problem(s) to fix.`)
        : green('\nReady. Run `pnpm reelmakeeasy start`.'),
    )
  }
  process.exit(blocking.length ? 1 : 0)
}

/** `scheme://user:password@host/...` as `scheme://***@host/...`; other URLs as they are. */
function redactUrlCredentials(url) {
  const scheme = url.indexOf('://')
  if (scheme === -1) return url
  const rest = url.slice(scheme + 3)
  // The credentials end at the last @ before the query (a password may hold @ or /).
  const query = rest.indexOf('?')
  const at = (query === -1 ? rest : rest.slice(0, query)).lastIndexOf('@')
  return at === -1 ? url : `${url.slice(0, scheme + 3)}***${rest.slice(at)}`
}

/** The port of a mongodb:// URL (27017 when it names none); undefined when it can't be read. */
function databasePort(url) {
  try {
    const parsed = new URL(redactUrlCredentials(url).replace(/^mongodb(\+srv)?:/, 'http:'))
    return Number(parsed.port || 27017)
  } catch {
    return undefined
  }
}

function withoutHome(text) {
  const home = os.homedir()
  return home.length > 1 ? String(text).split(home).join('~') : String(text)
}

// ---------- dev ----------

const children = []
let embeddedMongo

async function startMongo(env) {
  if (env.DATABASE_URL) return env.DATABASE_URL
  const dbPath = path.join(dataDir(env), 'mongo')
  fs.mkdirSync(dbPath, { recursive: true })
  console.log(dim('Starting embedded MongoDB (first run downloads it)…'))
  const { MongoMemoryReplSet } = await import('mongodb-memory-server')
  // The replica set config stored in dbPath records host:port, so a restart must
  // reuse the same port. Remember it when 27017 is taken and we pick another.
  const portFile = path.join(dataDir(env), 'mongo.port')
  let port = fs.existsSync(portFile) ? Number(fs.readFileSync(portFile, 'utf8')) : undefined
  if (!port) {
    port = (await portInUse(27017)) ? await freePort() : 27017
    fs.writeFileSync(portFile, String(port))
  }
  if (await portInUse(port))
    throw new Error(`Port ${port} for the embedded MongoDB (saved in ${portFile}) is in use.`)
  embeddedMongo = await MongoMemoryReplSet.create({
    instanceOpts: [{ dbPath, port, storageEngine: 'wiredTiger' }],
    replSet: { count: 1, name: 'rs0' },
  })
  const uri = embeddedMongo.getUri('reelmakeeasy')
  console.log(`${green('✓')} MongoDB ${dim(uri)}`)
  return uri
}

const LABEL_COLORS = { api: 36, tts: 33, web: 35 }

/**
 * `optional` children (the local server) may exit without stopping the app; `optional` then says
 * what falls back.
 */
function run(label, command, commandArgs, env, { cwd = ROOT, optional = '', shell = false } = {}) {
  const child = spawn(command, commandArgs, { cwd, env, shell, stdio: ['ignore', 'pipe', 'pipe'] })
  const prefix = color(LABEL_COLORS[label])(`[${label}]`)
  for (const stream of [child.stdout, child.stderr]) {
    readline
      .createInterface({ input: stream })
      .on('line', (line) => console.log(`${prefix} ${line}`))
  }
  child.on('exit', (code) => {
    console.log(`${prefix} exited with code ${code}`)
    if (optional) console.log(yellow(`${prefix} ${optional}`))
    else shutdown(code ?? 1)
  })
  children.push(child)
}

/**
 * Starts the local server when setup installed it, with its voices unless LOCAL_TTS=off and its
 * caption timing unless LOCAL_ASR=off; the API finds it via LOCAL_TTS_URL.
 */
async function startLocalTts(env) {
  // A server the user runs elsewhere (LOCAL_TTS_URL in .env) wins. LOCAL_TTS=off still drops it,
  // as the API would use its voices too.
  if (env.LOCAL_TTS_URL) {
    if (env.LOCAL_TTS === 'off') delete env.LOCAL_TTS_URL
    return
  }
  const state = readLocalTtsState(env)
  const engines = localServerEngines(state?.engines, env)
  if (engines.length === 0 || !fs.existsSync(localTtsPython(env))) return
  const port = Number(env.LOCAL_TTS_PORT || 5019)
  env.LOCAL_TTS_URL = `http://127.0.0.1:${port}`
  if (await portInUse(port)) {
    console.log(dim(`Local server: something is already on port ${port}; using it.`))
    return
  }
  run(
    'tts',
    localTtsPython(env),
    [path.join(LOCAL_TTS_SRC, 'local_tts.py'), 'serve', '--port', String(port)],
    localTtsEnv(env, {
      // Everything was downloaded by setup; stay offline so startup never waits on the network.
      HF_HUB_OFFLINE: '1',
      LOCAL_TTS_DEVICE: state.backend,
      LOCAL_TTS_ENGINES: engines.join(','),
      PYTHONUNBUFFERED: '1',
    }),
    { optional: localServerFallback(engines) },
  )
}

let shuttingDown = false
async function shutdown(code = 0) {
  if (shuttingDown) return
  shuttingDown = true
  for (const child of children) child.kill('SIGTERM')
  await embeddedMongo?.stop({ doCleanup: false }).catch(() => undefined)
  process.exit(code)
}

/** Where the API and the web app listen: this computer only, unless HOST opts in. */
function listenHost(env) {
  return env.HOST || '127.0.0.1'
}

function printStarting(webPort) {
  const url = green(`http://localhost:${webPort}`)
  console.log(`Starting… open ${url} once both are up. Press Ctrl+C to stop.\n`)
}

/**
 * What dev and start do before the API and the web app run: the preset pack, the database
 * (embedded unless DATABASE_URL is set) and its schema, the ports, and the local voice server.
 * Ctrl+C stops everything started. Returns the ports.
 */
async function startServices(env) {
  process.on('SIGINT', () => shutdown(0))
  process.on('SIGTERM', () => shutdown(0))

  await tryEnsurePresetPack(env)
  env.DATABASE_URL = await startMongo(env)
  env.DATA_DIR = dataDir(env)
  // The API runs as development under start too: that is what turns on the local LLM and render
  // caches.
  env.NODE_ENV = env.NODE_ENV || 'development'

  console.log(dim('Syncing the database schema…'))
  // Async on purpose: the embedded mongod's output is drained by this process's
  // event loop, and blocking it (execFileSync) lets the pipe fill and mongod hang.
  await new Promise((resolve, reject) => {
    const p = pnpm(['exec', 'prisma', 'db', 'push', `--schema=${PRISMA_SCHEMA}`, '--skip-generate'])
    const push = spawn(p.command, p.args, {
      cwd: ROOT,
      env,
      shell: p.shell,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    // Kept to say why it failed.
    let output = ''
    for (const stream of [push.stdout, push.stderr])
      stream.on('data', (chunk) => (output = (output + chunk).slice(-4000)))
    push.on('error', reject)
    push.on('exit', (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`prisma db push exited with code ${code}:\n${output.trim()}`)),
    )
  })
  console.log(`${green('✓')} Database schema in sync\n`)

  // A second copy runs beside the first on other ports: PORT moves the API (and the files
  // URL), WEB_PORT moves the web app, and the web app is pointed at this copy's API.
  const ports = applyRunPorts(env)
  await startLocalTts(env)
  return ports
}

/** No video key: the app starts, but it can't make videos. */
function warnMissingVideoKey(env) {
  const missingKey = missingVideoKey(env)
  if (missingKey) {
    console.warn(yellow(`! ${missingKey}: the app starts, but it can't make videos.`))
    console.warn(
      yellow('  Add one (or run `pnpm reelmakeeasy setup`), restart, then open Setup in the app.\n'),
    )
  }
}

/** For changing the code: the web app compiles each page on first visit, so pages load slowly. */
async function dev() {
  const env = loadEnv()
  warnMissingVideoKey(env)
  const { webPort } = await startServices(env)
  const api = pnpm(['exec', 'nx', 'run', 'api:dev', '--output-style=stream'])
  run('api', api.command, api.args, env, { shell: api.shell })
  const web = pnpm([
    'exec',
    'nx',
    'run',
    'web:dev',
    '--output-style=stream',
    `--port=${webPort}`,
    `--hostname=${listenHost(env)}`,
  ])
  run('web', web.command, web.args, { ...env, NEXT_TELEMETRY_DISABLED: '1' }, { shell: web.shell })
  printStarting(webPort)
}

// ---------- start / build ----------

/** Fails before a build of several minutes when another copy already holds a port. */
async function refuseBusyPorts({ apiPort, webPort }) {
  for (const [port, what, setting] of [
    [apiPort, 'the API', 'PORT'],
    [webPort, 'the web app', 'WEB_PORT'],
  ]) {
    if (await portInUse(port)) {
      throw new Error(
        `Port ${port} (${what}) is in use: ReelMakeEasy may already be running. Stop it, or set ${setting} to run a second copy.`,
      )
    }
  }
}

/** Runs ReelMakeEasy for real use: the API bundle and the web app's production build. */
async function start() {
  const env = loadEnv()
  warnMissingVideoKey(env)
  await refuseBusyPorts(applyRunPorts(env))
  buildApp(env)
  console.log('')
  const { webPort } = await startServices(env)
  run('api', process.execPath, [API_BUNDLE], env)
  const next = createRequire(path.join(WEB_DIR, 'next.config.js')).resolve('next/dist/bin/next')
  run(
    'web',
    process.execPath,
    [next, 'start', '--port', String(webPort), '--hostname', listenHost(env)],
    webEnv(env),
    { cwd: WEB_DIR },
  )
  printStarting(webPort)
}

/** Builds the API and the web app now, whether or not the code changed. */
async function build() {
  const env = loadEnv()
  applyRunPorts(env)
  buildApp(env, { force: true })
  console.log(`Next: ${dim('pnpm reelmakeeasy start')}`)
}

// ---------- main ----------

const commands = { build, dev, doctor, setup, start }
const name = process.argv[2]
const command = commands[name]
if (!command) {
  const help = !name || ['--help', '-h', 'help'].includes(name)
  if (!help) console.error(red(`Unknown command: ${name}\n`))
  console.log(USAGE)
  process.exit(help ? 0 : 1)
}
// `<command> --help` (or -h) prints that command's usage, and runs nothing.
const usage = commandHelp(name, args)
if (usage) {
  console.log(usage)
  process.exit(0)
}
command().catch((err) => {
  console.error(red(err instanceof Error ? err.message : String(err)))
  shutdown(1)
})
