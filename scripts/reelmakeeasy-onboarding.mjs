/**
 * Decisions `pnpm reelmakeeasy setup` and `doctor` make about keys and AI choices, kept free of
 * side effects so `node --test scripts/reelmakeeasy-onboarding.test.mjs` can check them.
 *
 * Videos need fal or Gemini (either key is enough). Codex, Claude Code, Gemini or an
 * OpenAI-compatible endpoint write and plan them. ElevenLabs is optional. The API is the source
 * of truth for the choices; this mirrors its "saved choice wins over .env" rule for doctor.
 */

/** What `pnpm reelmakeeasy` (or --help) prints. */
export const USAGE = `Usage: pnpm reelmakeeasy <command>

  setup    Asks which video service you use and for its key, then writes .env, installs the
           free local voices and caption timing you pick and builds the app. --yes asks
           nothing (pass the flags):
           [--yes] [--fal-key=KEY] [--gemini-key=KEY] [--elevenlabs-key=KEY]
           [--llm=claude|codex|gemini|endpoint] [--generation=fal|google]
           [--local-tts=all|kokoro|qwen|off] [--local-captions=on|off]
           [--agent-harness=codex|claude]
           [--no-build]  skip the build; the first start then builds the app
  doctor   Checks the computer, the keys and the services [--json]
  start    Runs ReelMakeEasy; builds it first when the code changed (pnpm start does the same)
  build    Builds the app now (stop a running start first, then start it again)
  dev      Runs ReelMakeEasy for changing the code: pages rebuild as you edit, so they load slowly

PORT moves the API (default 5017) and WEB_PORT the web app (default 3000).

pnpm reelmakeeasy <command> --help shows what one command does.`

const PORTS_NOTE = 'PORT moves the API (default 5017) and WEB_PORT the web app (default 3000).'

/** What `pnpm reelmakeeasy <command> --help` prints: that command's usage, and nothing runs. */
const COMMAND_USAGE = {
  build: `Usage: pnpm reelmakeeasy build

Builds the API and the web app now, whether or not the code changed (a few minutes).
Stop a running start first, then start it again.`,
  dev: `Usage: pnpm reelmakeeasy dev

Runs ReelMakeEasy for changing the code: the web app in development mode, so pages rebuild as
you edit and load slowly. Use pnpm reelmakeeasy start for real use.

${PORTS_NOTE}`,
  doctor: `Usage: pnpm reelmakeeasy doctor [--json]

Checks the computer, the keys and the services, and exits with an error when something
blocks ReelMakeEasy from running.

  --json   print the checks as JSON: { "ok", "checks": [{ "name", "ok", "blocking", "detail" }] }`,
  setup: `Usage: pnpm reelmakeeasy setup [flags]

Asks which video service you use and for its key, then writes .env, installs the free
local voices and caption timing you pick and builds the app. Safe to run again.

  --yes                                ask nothing: use the flags and .env as they are
  --fal-key=KEY                        fal: pictures, clips, music and voices
  --gemini-key=KEY                     Gemini: pictures, clips, voices and music, and writing
  --elevenlabs-key=KEY                 [optional] ElevenLabs voices on your own account
  --llm=claude|codex|gemini|endpoint   which AI writes and plans the videos
  --generation=fal|google              who makes the videos when both keys are set
  --local-tts=all|kokoro|qwen|off      which free local voices to install
  --local-captions=on|off              time captions on this computer (free, about 2 GB)
  --agent-harness=codex|claude         the agent Agent mode picks first
  --no-build                           skip the build; the first start then builds the app`,
  start: `Usage: pnpm reelmakeeasy start

Runs ReelMakeEasy (pnpm start does the same). Builds the app first when the code changed,
which takes a few minutes; then open http://localhost:3000.

${PORTS_NOTE}`,
}

/**
 * The usage to print instead of running `command` when its flags ask for help (--help or -h),
 * else null: the command runs. Null for a command that doesn't exist (the CLI says so).
 */
export function commandHelp(command, args) {
  if (!Object.hasOwn(COMMAND_USAGE, command ?? '')) return null
  return args.some((arg) => arg === '--help' || arg === '-h') ? COMMAND_USAGE[command] : null
}

/** What setup prints last: the command to start, then the page to open. */
export function setupDoneMessage({ built, webPort }) {
  return [
    built
      ? 'Next: pnpm reelmakeeasy start'
      : 'Next: pnpm reelmakeeasy start (it builds the app first: a few minutes)',
    `Then open http://localhost:${webPort}`,
  ]
}

export const LLM_PROVIDERS = ['claude', 'codex', 'gemini', 'endpoint']
export const GENERATION_PROVIDERS = ['fal', 'google']

/** The keys setup asks for, in order. Either of the first two makes videos. */
export const SETUP_KEYS = [
  {
    flag: 'fal-key',
    name: 'FAL_KEY',
    optional: false,
    purpose: 'pictures, clips, music and voices on fal',
    url: 'https://fal.ai/dashboard/keys',
  },
  {
    flag: 'gemini-key',
    name: 'GEMINI_API_KEY',
    optional: false,
    purpose: 'pictures, clips, voices and music on Gemini; it can write and plan too',
    url: 'https://aistudio.google.com/apikey',
  },
  {
    flag: 'elevenlabs-key',
    name: 'ELEVENLABS_API_KEY',
    optional: true,
    purpose:
      'optional: ElevenLabs voices, captions and voice cloning on your own key; without it they run through fal when fal makes the videos',
    url: 'https://elevenlabs.io/app/settings/api-keys',
  },
]

const LLM_LABEL = {
  claude: 'Claude Code',
  codex: 'Codex',
  endpoint: 'your endpoint (LLM_BASE_URL)',
  gemini: 'Gemini',
}
const GENERATION_LABEL = { fal: 'fal', google: 'Gemini' }

/** "a, b or c". */
function oneOf(values) {
  return `${values.slice(0, -1).join(', ')} or ${values.at(-1)}`
}

/**
 * `--generation=` and `--llm=` from the command line: the values, or why they are wrong.
 * @param {string[]} args
 */
export function parseProviderFlags(args) {
  const out = { errors: [] }
  for (const [name, allowed] of [
    ['generation', GENERATION_PROVIDERS],
    ['llm', LLM_PROVIDERS],
  ]) {
    const hit = args.find((a) => a === `--${name}` || a.startsWith(`--${name}=`))
    if (!hit) continue
    const value = hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : ''
    if (allowed.includes(value)) out[name] = value
    else out.errors.push(`--${name} must be ${oneOf(allowed)}`)
  }
  return out
}

/** What setup says when it ends with neither video key. */
export const NO_VIDEO_KEY_WARNING =
  'No FAL_KEY or GEMINI_API_KEY: `pnpm reelmakeeasy doctor` will block until you add one to .env (https://fal.ai/dashboard/keys or https://aistudio.google.com/apikey).'

/** Why videos can't be made with these keys, or null when FAL_KEY or GEMINI_API_KEY is set. */
export function missingVideoKey(env) {
  return env.FAL_KEY || env.GEMINI_API_KEY ? null : 'No FAL_KEY or GEMINI_API_KEY in .env'
}

/** The choices the app's Setup saved (`<data dir>/settings.json`); {} when missing or unreadable. */
export function parseStoredSettings(text) {
  if (!text) return {}
  try {
    const parsed = JSON.parse(text)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * The choices the app starts from: what Setup saved, else the .env defaults. Unknown ids drop.
 * Read as `SetupSettingsService.stored()` reads them: saved ids exactly, and the .env values
 * trimmed and lower-cased, with `GENERATION_PROVIDER=gemini` meaning Google.
 */
export function chosenProviders(env, stored) {
  const pick = (value, allowed) => (allowed.includes(value) ? value : undefined)
  const fromEnv = (value) => (typeof value === 'string' ? value.trim().toLowerCase() : undefined)
  const generationFromEnv = fromEnv(env.GENERATION_PROVIDER)
  return {
    generation:
      pick(stored.generationProvider, GENERATION_PROVIDERS) ??
      pick(generationFromEnv === 'gemini' ? 'google' : generationFromEnv, GENERATION_PROVIDERS),
    llm: pick(stored.llmProvider, LLM_PROVIDERS) ?? pick(fromEnv(env.LLM_PROVIDER), LLM_PROVIDERS),
  }
}

/** One doctor line. */
function check(name, ok, detail, blocking) {
  return { blocking, detail, name, ok }
}

/** A 2xx answer. */
function isOk(status) {
  return status !== null && status >= 200 && status < 300
}

/** "valid", or "rejected (HTTP n)" for a key checked over the network. */
function checkedDetail(status) {
  return status === 200 ? 'valid' : `rejected (HTTP ${status || 'unreachable'})`
}

/** Which video key works, or what to add. */
function videoKeyDetail(fal, gemini, env) {
  if (fal && gemini) return 'fal and Gemini: pick who makes the videos in Setup'
  if (fal) return 'fal (FAL_KEY)'
  if (gemini) return 'Gemini (GEMINI_API_KEY)'
  if (env.GEMINI_API_KEY) return 'GEMINI_API_KEY was rejected and FAL_KEY is not set'
  return 'add FAL_KEY or GEMINI_API_KEY to .env'
}

/** At least one AI that can write and plan. */
function writerCheck(llmReady) {
  const writers = LLM_PROVIDERS.filter((p) => llmReady[p]).map((p) => LLM_LABEL[p])
  if (writers.length > 0) {
    return check('Writing and planning', true, `${writers.join(', ')} ready`, true)
  }
  return check(
    'Writing and planning',
    false,
    'sign in to Codex or Claude Code, or add GEMINI_API_KEY',
    true,
  )
}

/** A chosen provider must be ready: the app never swaps it silently. */
function chosenChecks(chosen, ready) {
  const out = []
  if (chosen.llm) {
    const ok = ready.llm[chosen.llm]
    const label = LLM_LABEL[chosen.llm]
    out.push(
      check(
        'Chosen to write',
        ok,
        ok ? label : `${label} is not ready: fix it, or pick another in Setup`,
        true,
      ),
    )
  }
  if (chosen.generation) {
    const ok = ready.generation[chosen.generation]
    const label = GENERATION_LABEL[chosen.generation]
    out.push(
      check(
        'Chosen for videos',
        ok,
        ok ? label : `${label} is not ready: fix it, or pick another in Setup`,
        true,
      ),
    )
  }
  return out
}

/** FAL_KEY on its own: a warning only, as Gemini can make the videos instead. */
function falCheck(fal, gemini) {
  if (fal) return check('FAL_KEY', true, 'set', false)
  return check('FAL_KEY', gemini, gemini ? 'not set: Gemini makes the videos' : 'not set', false)
}

/** GEMINI_API_KEY on its own: a warning only. */
function geminiCheck(env, geminiStatus, fal) {
  if (!env.GEMINI_API_KEY) {
    return check('GEMINI_API_KEY', fal, fal ? 'not set (optional with FAL_KEY)' : 'not set', false)
  }
  return check('GEMINI_API_KEY', geminiStatus === 200, checkedDetail(geminiStatus), false)
}

/**
 * ELEVENLABS_API_KEY: optional. Unset, it reads like the Setup card's ElevenLabs row: "Through
 * fal" while fal makes (or, with nothing chosen, will make) the videos, else "Not needed".
 */
function elevenLabsCheck(env, status, chosen, fal) {
  if (env.ELEVENLABS_API_KEY) {
    return check('ELEVENLABS_API_KEY', status === 200, checkedDetail(status), false)
  }
  return check('ELEVENLABS_API_KEY', true, elevenLabsUnsetDetail(env, chosen, fal), false)
}

/** Why ELEVENLABS_API_KEY can stay unset: fal runs its voices and captions, or Gemini makes them. */
function elevenLabsUnsetDetail(env, chosen, fal) {
  if (fal && chosen.generation !== 'google') {
    return 'not set: ElevenLabs voices and captions run through fal'
  }
  if (fal || env.GEMINI_API_KEY) return 'not set (not needed: Gemini makes the voices and captions)'
  return 'not set (optional)'
}

/**
 * The key and AI checks `doctor` reports. Blocking: no working video key, nothing ready to
 * write and plan, or a chosen provider that isn't ready. Each key on its own only warns.
 * Statuses are the HTTP status of that key's check (0 unreachable), or null when not set.
 */
export function keyChecks({
  chosen,
  claude,
  codex,
  elevenlabsStatus,
  endpointStatus,
  env,
  geminiStatus,
}) {
  const fal = Boolean(env.FAL_KEY)
  const gemini = geminiStatus === 200
  const ready = {
    generation: { fal, google: gemini },
    llm: { claude: claude.ok, codex: codex.ok, endpoint: isOk(endpointStatus), gemini },
  }
  const checks = [
    check('Video key', fal || gemini, videoKeyDetail(fal, gemini, env), true),
    writerCheck(ready.llm),
    ...chosenChecks(chosen, ready),
    falCheck(fal, gemini),
    geminiCheck(env, geminiStatus, fal),
  ]
  if (env.LLM_BASE_URL) {
    checks.push(
      check(
        'Chat endpoint',
        isOk(endpointStatus),
        `${env.LLM_BASE_URL} → HTTP ${endpointStatus || 'unreachable'}`,
        false,
      ),
    )
  }
  checks.push(elevenLabsCheck(env, elevenlabsStatus, chosen, fal))
  return checks
}
