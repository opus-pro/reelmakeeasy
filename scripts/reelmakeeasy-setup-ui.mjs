/**
 * The questions `pnpm reelmakeeasy setup` asks in a terminal, one screen at a time: which video
 * service (fal.ai, Google Gemini or both), the keys for it one by one, the optional ElevenLabs key,
 * the optional local voices and local caption timing. Up and down move, Enter picks, Esc goes back
 * a screen and Ctrl+C quits before anything is saved.
 *
 * The text, options, hardware decision and flag mapping are pure functions, tested by
 * reelmakeeasy-setup-ui.test.mjs, as are doctor's lines for the local voices and captions.
 * `terminalAsk` draws the screens with @clack/core, which is loaded only when setup asks
 * questions: `--yes` never loads it.
 */
import { styleText } from 'node:util'

import { SETUP_KEYS } from './reelmakeeasy-onboarding.mjs'

/** Roughly what one 30-second video costs on each service. Change them here. */
export const VIDEO_COST = { fal: '$0.70', gemini: '$3' }

/** Approximate first download of each local voice engine, in GB, per backend. */
const VOICE_DOWNLOAD_GB = { kokoro: 0.4, qwen3: { cuda: 14, mlx: 10, mps: 10 } }
/**
 * Approximate download of local caption timing (Whisper and a forced aligner), in GB, per
 * backend: large-v3-turbo on a GPU, small.en on a CPU (tools/local-tts).
 */
const CAPTIONS_DOWNLOAD_GB = { cpu: 0.9, cuda: 2, mlx: 2, mps: 0.9 }

const SERVICE_LABEL = { fal: 'fal.ai', gemini: 'Google Gemini' }
const KEY_LABEL = {
  ELEVENLABS_API_KEY: 'ElevenLabs',
  FAL_KEY: 'fal.ai',
  GEMINI_API_KEY: 'Google Gemini',
}
const KEY_OF_SERVICE = { fal: 'FAL_KEY', gemini: 'GEMINI_API_KEY' }
const KEY_URL = Object.fromEntries(SETUP_KEYS.map((key) => [key.name, key.url]))

/** What a select screen's last line says; screens after the first add Esc. */
const SELECT_HELP = '↑/↓ to move, Enter to pick'

/** A screen's answer when the person pressed Esc (go back a screen) or Ctrl+C (quit). */
export const BACK = Symbol('back')
export const QUIT = Symbol('quit')

// ---------- the video service ----------

/** The first screen: which video service. Starts on the keys .env already has. */
export function serviceScreen({ saved }) {
  const initialValue =
    saved.FAL_KEY && saved.GEMINI_API_KEY ? 'both' : saved.GEMINI_API_KEY ? 'gemini' : 'fal'
  return {
    first: true,
    id: 'service',
    initialValue,
    kind: 'select',
    message: 'Which video service will you use? You need at least one.',
    options: [
      {
        hint: `Cheapest: about ${VIDEO_COST.fal} for a 30-second video. Makes the pictures, clips, music and voices.`,
        label: SERVICE_LABEL.fal,
        value: 'fal',
      },
      {
        hint: `About ${VIDEO_COST.gemini} for a 30-second video. Can also write and plan the videos.`,
        label: SERVICE_LABEL.gemini,
        value: 'gemini',
      },
      {
        hint: 'Pick which one makes the videos later, on the Setup page in the app.',
        label: 'Both',
        value: 'both',
      },
    ],
  }
}

/** The keys a service needs, fal first. */
export function keysForService(service) {
  return service === 'both' ? ['FAL_KEY', 'GEMINI_API_KEY'] : [KEY_OF_SERVICE[service]]
}

/** GENERATION_PROVIDER for a single pick; with both, the app's Setup page decides. */
export function generationDefault(service) {
  return { fal: 'fal', gemini: 'google' }[service]
}

// ---------- keys ----------

/**
 * One key's screen. `empty` says what Enter on an empty line does: 'keep' the saved key, 'skip'
 * the optional ElevenLabs key, or nothing ('required': the screen asks again).
 */
export function keyScreen(name, { saved }) {
  const label = KEY_LABEL[name]
  const link = KEY_URL[name]
  if (name === 'ELEVENLABS_API_KEY') {
    return {
      empty: saved ? 'keep' : 'skip',
      footer: saved
        ? 'Press Enter to keep it. Esc goes back.'
        : 'Press Enter to skip. Esc goes back.',
      id: name,
      kind: 'secret',
      label,
      lines: saved
        ? [
            'Only for ElevenLabs voices.',
            'You already have one here. Press Enter to keep it, or paste a new one.',
            'Get a new one at',
          ]
        : ['Only for ElevenLabs voices. ElevenLabs gives free credits when you sign up:'],
      link,
      title: '[optional] ElevenLabs key',
    }
  }
  return {
    empty: saved ? 'keep' : 'required',
    footer: saved
      ? 'Press Enter to keep it. Esc goes back.'
      : 'Paste it, then press Enter. Esc goes back.',
    id: name,
    kind: 'secret',
    label,
    lines: saved
      ? [
          `You already have a ${label} key here. Press Enter to keep it, or paste a new one.`,
          'Get a new one at',
        ]
      : ['Get one at'],
    link,
    title: `Paste your ${label} key`,
  }
}

/** Why the typed key can't be used, or undefined when it can. */
export function checkKeyInput(screen, value) {
  const key = (value ?? '').trim()
  if (!key) {
    return screen.empty === 'required'
      ? `Paste your ${screen.label} key to go on. No key yet? Open the link above. Esc goes back.`
      : undefined
  }
  if (/\s/.test(key)) return 'A key has no spaces. Paste only the key.'
  return undefined
}

// ---------- local voices ----------

/**
 * Whether this machine can run Qwen3 locally (tools/local-tts/hardware.json), and why not.
 * `ramGB` and `vramGB` (NVIDIA only) come from the machine; `hardware` is hardware.json.
 */
export function qwenFit({ backend, hardware, ramGB, vramGB }) {
  const need = hardware.qwen3[backend]
  const slack = hardware.toleranceGB ?? 0.75
  const info = vramGB === undefined ? { ramGB } : { ramGB, vramGB }
  if (!need) {
    return { ...info, ok: false, reason: 'needs an Apple Silicon Mac or an NVIDIA graphics card' }
  }
  if (need.minVramGB && (vramGB ?? 0) + slack < need.minVramGB) {
    return {
      ...info,
      ok: false,
      reason: `needs a graphics card with ${need.minVramGB} GB of memory; this one has ${vramGB ?? 0} GB`,
    }
  }
  if (ramGB + slack < need.minRamGB) {
    const machine = backend === 'cuda' ? 'this computer' : 'this Mac'
    return {
      ...info,
      ok: false,
      reason: `needs ${need.minRamGB} GB of memory; ${machine} has ${ramGB} GB`,
    }
  }
  const recommended = !need.recommendedRamGB || ramGB + slack >= need.recommendedRamGB
  return { ...info, ok: true, recommended, recommendedRamGB: need.recommendedRamGB }
}

/** "0.4 GB". */
const gb = (size) => `${size} GB`

/**
 * The local voices screen. Below Qwen3's minimum, Qwen3 and both show why they're unavailable and
 * the screen starts on Kokoro; otherwise it starts on what's installed, else both.
 */
export function voicesScreen({ backend, fal, installed, qwen }) {
  const qwenSize = VOICE_DOWNLOAD_GB.qwen3[backend] ?? VOICE_DOWNLOAD_GB.qwen3.mlx
  const slower =
    qwen.ok && qwen.recommended === false
      ? ` Slower with this much memory (${qwen.recommendedRamGB} GB is better).`
      : ''
  const unavailable = qwen.ok ? {} : { disabled: true, hint: qwen.reason }
  const options = [
    {
      hint: `Small: about a ${gb(VOICE_DOWNLOAD_GB.kokoro)} download. A few natural English voices.`,
      label: 'Kokoro',
      value: 'kokoro',
    },
    {
      hint: `More voices, and voice cloning: about a ${gb(qwenSize)} download.${slower}`,
      label: 'Qwen3',
      value: 'qwen',
      ...unavailable,
    },
    {
      hint: `Kokoro and Qwen3: about a ${gb(qwenSize)} download.${slower}`,
      label: 'Both',
      value: 'all',
      ...unavailable,
    },
    {
      hint: fal
        ? 'These voices then run online on fal (paid).'
        : 'Gemini makes the voices instead.',
      label: 'Skip',
      value: 'off',
    },
  ]
  return {
    id: 'voices',
    initialValue: qwen.ok ? (installedChoice(installed) ?? 'all') : 'kokoro',
    kind: 'select',
    message: 'Install free voices that run on this computer? You can skip this.',
    options,
  }
}

/** The answer matching the voices setup installed last time, if any (caption engines aside). */
function installedChoice(installed) {
  const voices = (installed ?? []).filter((engine) => VOICE_ENGINES.includes(engine))
  if (voices.length === 0) return undefined
  const kokoro = voices.includes('kokoro')
  const qwen = voices.includes('qwen3')
  return kokoro && qwen ? 'all' : qwen ? 'qwen' : 'kokoro'
}

/**
 * The engines setup installs for a `--local-tts` value (all, kokoro, qwen or off), and a note
 * when this machine can't run what was asked.
 */
export function localTtsEngines(choice, qwenOk) {
  if (choice === 'off') return { engines: [] }
  if (choice === 'kokoro') return { engines: ['kokoro'] }
  if (choice === 'qwen') {
    return qwenOk
      ? { engines: ['qwen3'] }
      : { engines: [], note: 'Installing no local voices; Qwen3 voices will run on fal.' }
  }
  return qwenOk
    ? { engines: ['kokoro', 'qwen3'] }
    : { engines: ['kokoro'], note: 'Installing Kokoro only; Qwen3 voices will run on fal.' }
}

const LOCAL_TTS_VALUES = ['all', 'kokoro', 'qwen', 'off']
/** Older docs said "full"; the screen says "Both". */
const LOCAL_TTS_ALIASES = { both: 'all', full: 'all' }

/** `--local-tts[=value]`: bare means all. `{}` without it, `{ error }` for an unknown value. */
export function parseLocalTtsFlag(args) {
  const hit = args.find((a) => a === '--local-tts' || a.startsWith('--local-tts='))
  if (!hit) return {}
  if (!hit.includes('=')) return { value: 'all' }
  const raw = hit.slice(hit.indexOf('=') + 1).toLowerCase()
  const value = LOCAL_TTS_ALIASES[raw] ?? raw
  return LOCAL_TTS_VALUES.includes(value)
    ? { value }
    : { error: '--local-tts must be all, kokoro, qwen or off' }
}

// ---------- local caption timing ----------

/** The local server's engines that time captions; the rest (Kokoro, Qwen3) are voices. */
const CAPTION_ENGINES = ['whisper', 'align']
const VOICE_ENGINES = ['kokoro', 'qwen3']

/** Where captions are timed without the local ones. */
const ONLINE_CAPTIONS = 'ElevenLabs, fal or Gemini'

/** The captions screen: one line, as captions are free and on by default. */
export function captionsScreen({ backend }) {
  const size = CAPTIONS_DOWNLOAD_GB[backend] ?? CAPTIONS_DOWNLOAD_GB.cpu
  return {
    id: 'captions',
    initialValue: 'on',
    kind: 'select',
    message: `Time captions on this computer? Free, about ${gb(size)}`,
    options: [
      { label: 'Yes', value: 'on' },
      { hint: 'Caption timing then runs online (paid).', label: 'Skip', value: 'off' },
    ],
  }
}

/** The engines setup installs for a `--local-captions` value (on or off). */
export function captionEngines(choice) {
  return choice === 'off' ? [] : [...CAPTION_ENGINES]
}

/**
 * `--local-captions[=on|off]`, apart from `--local-tts`: bare means on. `{}` without it,
 * `{ error }` for an unknown value.
 */
export function parseLocalCaptionsFlag(args) {
  const hit = args.find((a) => a === '--local-captions' || a.startsWith('--local-captions='))
  if (!hit) return {}
  if (!hit.includes('=')) return { value: 'on' }
  const value = hit.slice(hit.indexOf('=') + 1).toLowerCase()
  return ['off', 'on'].includes(value) ? { value } : { error: '--local-captions must be on or off' }
}

// ---------- the local server ----------

/**
 * The engines state.json lists after setup. Each part installed this run (`installed.voices`,
 * `installed.captions`) replaces that part's engines; a part skipped, or whose download failed,
 * keeps what an earlier setup installed on the same backend. Setup never uninstalls: LOCAL_TTS=off
 * and LOCAL_ASR=off stop using a part.
 */
export function installedEngines({ backend, installed, previous }) {
  const kept = previous?.backend === backend ? (previous.engines ?? []) : []
  const voices = installed.voices ?? kept.filter((engine) => VOICE_ENGINES.includes(engine))
  const captions = installed.captions ?? kept.filter((engine) => CAPTION_ENGINES.includes(engine))
  return [...voices, ...captions]
}

/** What setup says for a part skipped (`voices` or `captions`): online, or kept from before. */
export function skippedPartNote(part, { backend, previous }) {
  const kept = previous?.backend === backend ? (previous.engines ?? []) : []
  if (part === 'voices') {
    const voices = kept.filter((engine) => VOICE_ENGINES.includes(engine))
    return voices.length > 0
      ? `Local voices skipped; the ones installed before (${voices.join(' + ')}) stay on. LOCAL_TTS=off in .env turns them off.`
      : 'Local voices skipped: Kokoro and Qwen3 voices will run on fal (paid).'
  }
  return kept.some((engine) => CAPTION_ENGINES.includes(engine))
    ? 'Local caption timing skipped; the one installed before stays on. LOCAL_ASR=off in .env turns it off.'
    : `Local caption timing skipped: ${ONLINE_CAPTIONS} will time the captions (paid).`
}

/**
 * The engines the local server starts with: what setup installed, less the voices when
 * LOCAL_TTS=off and the caption timing when LOCAL_ASR=off.
 */
export function localServerEngines(installed, env) {
  return (installed ?? []).filter((engine) =>
    CAPTION_ENGINES.includes(engine) ? env.LOCAL_ASR !== 'off' : env.LOCAL_TTS !== 'off',
  )
}

/** What the server's engines fall back to when it stops. */
export function localServerFallback(engines) {
  const voices = engines.some((engine) => VOICE_ENGINES.includes(engine))
  const captions = engines.some((engine) => CAPTION_ENGINES.includes(engine))
  if (voices && captions) {
    return `Kokoro and Qwen3 voices fall back to fal, and caption timing to ${ONLINE_CAPTIONS}.`
  }
  return captions
    ? `Caption timing falls back to ${ONLINE_CAPTIONS}.`
    : 'Kokoro and Qwen3 voices fall back to fal.'
}

/**
 * Doctor's `Local voices` line (it only warns). `state` is what setup installed (null when it
 * never did, or its Python is gone); `detected` is this machine's backend.
 */
export function localVoicesCheck({ detected, env, state }) {
  if (env.LOCAL_TTS === 'off') {
    return { detail: 'off (LOCAL_TTS=off): Kokoro and Qwen3 run on fal', ok: true }
  }
  const engines = (state?.engines ?? []).filter((engine) => VOICE_ENGINES.includes(engine))
  if (engines.length > 0) {
    return { detail: `${engines.join(' + ')} on ${state.backend} (free)`, ok: true }
  }
  return {
    detail: `not installed: Kokoro and Qwen3 run on fal (paid). Run \`pnpm reelmakeeasy setup\` (${detected} detected)`,
    ok: false,
  }
}

/** Doctor's `Local captions` line (it only warns), from the same `state`. */
export function localCaptionsCheck({ env, state }) {
  if (env.LOCAL_ASR === 'off') {
    return { detail: `off (LOCAL_ASR=off): ${ONLINE_CAPTIONS} time the captions`, ok: true }
  }
  const engines = state?.engines ?? []
  if (engines.includes('whisper')) {
    const what = engines.includes('align') ? 'Whisper and aligner' : 'Whisper'
    return { detail: `${what} on ${state.backend} (free)`, ok: true }
  }
  return {
    detail: `not installed: ${ONLINE_CAPTIONS} time the captions (paid). Run \`pnpm reelmakeeasy setup\``,
    ok: false,
  }
}

// ---------- the questions ----------

/** The screens to show for this service, in order. Keys passed as flags aren't asked. */
export function setupSteps(service, { askCaptions, askVoices, fromFlags }) {
  return [
    'service',
    ...keysForService(service),
    'ELEVENLABS_API_KEY',
    ...(askVoices ? ['voices'] : []),
    ...(askCaptions ? ['captions'] : []),
  ].filter((step) => !fromFlags[step])
}

/**
 * Asks setup's questions, one screen at a time. `ask.select(screen)` and `ask.secret(screen)`
 * resolve the answer, BACK (Esc: the previous screen; on the first, it quits) or QUIT (Ctrl+C).
 * `saved` and `fromFlags` say which keys .env and the flags already have; `voices` is the local
 * voices screen (or a function of the service picked that returns it) and `captions` the local
 * captions screen, each null (or left out) when setup isn't asking. Returns `{ quit: true }`, or
 * the service, the keys typed (a key left empty keeps the one there or skips it) and the local
 * voices and captions answers.
 */
export async function askSetupQuestions({ ask, captions = null, fromFlags, saved, voices }) {
  const answers = {
    keys: {},
    localCaptions: undefined,
    localTts: undefined,
    service: serviceScreen({ saved: { ...saved, ...fromFlags } }).initialValue,
  }
  let at = 0
  for (;;) {
    const steps = setupSteps(answers.service, {
      askCaptions: Boolean(captions),
      askVoices: Boolean(voices),
      fromFlags,
    })
    if (at >= steps.length) break
    const step = steps[at]
    const answer = await askStep(ask, step, answers, { captions, saved, voices })
    if (answer === QUIT) return { quit: true }
    if (answer === BACK) {
      // Nothing to go back to from the first screen: Esc leaves, as in most terminal apps.
      if (at === 0) return { quit: true }
      at -= 1
      continue
    }
    if (step === 'service') answers.service = answer
    else if (step === 'voices') answers.localTts = answer
    else if (step === 'captions') answers.localCaptions = answer
    // Empty keeps the key saved or typed before, or skips the optional one.
    else if (answer.trim()) answers.keys[step] = answer.trim()
    at += 1
  }
  const wanted = new Set(['ELEVENLABS_API_KEY', ...keysForService(answers.service)])
  for (const name of Object.keys(answers.keys)) if (!wanted.has(name)) delete answers.keys[name]
  return answers
}

function askStep(ask, step, answers, { captions, saved, voices }) {
  if (step === 'service') {
    return ask.select({ ...serviceScreen({ saved }), initialValue: answers.service })
  }
  if (step === 'voices') {
    const screen = typeof voices === 'function' ? voices(answers.service) : voices
    return ask.select(answers.localTts ? { ...screen, initialValue: answers.localTts } : screen)
  }
  if (step === 'captions') {
    return ask.select(
      answers.localCaptions ? { ...captions, initialValue: answers.localCaptions } : captions,
    )
  }
  return ask.secret(keyScreen(step, { saved: Boolean(saved[step] || answers.keys[step]) }))
}

// ---------- after the questions ----------

const WRITER_LABEL = {
  claude: 'Claude Code (signed in)',
  codex: 'Codex (signed in)',
  endpoint: 'your endpoint (LLM_BASE_URL)',
  gemini: 'Google Gemini (your key)',
}
const WRITER_NAME = {
  claude: 'Claude Code',
  codex: 'Codex',
  endpoint: 'Your endpoint',
  gemini: 'Google Gemini',
}

/**
 * The one line saying which AI writes and plans, picked the way the app picks it: the chosen one
 * (LLM_PROVIDER or the Setup page), else Codex or Claude Code (`tieBreak`, from AGENT_HARNESS,
 * first), else Gemini, else the custom endpoint.
 */
export function writerLine({ chosen, ready, tieBreak }) {
  if (chosen && !ready[chosen]) {
    return {
      ok: false,
      text: `${WRITER_NAME[chosen]} is picked to write and plan, but it is not ready: sign in to it, or pick another on the Setup page.`,
    }
  }
  const other = tieBreak === 'claude' ? 'codex' : 'claude'
  const writer = chosen ?? [tieBreak, other, 'gemini', 'endpoint'].find((id) => ready[id])
  if (!writer) {
    return {
      ok: false,
      text: 'Nothing can write and plan the videos yet: sign in to Codex or Claude Code, or add a Google Gemini key.',
    }
  }
  return { ok: true, text: `Writes and plans the videos: ${WRITER_LABEL[writer]}` }
}

// ---------- links ----------

/** Whether this terminal makes OSC 8 links clickable (after supports-hyperlinks). */
export function supportsHyperlinks(env, isTTY) {
  if (env.FORCE_HYPERLINK !== undefined) {
    return !['0', 'false'].includes(env.FORCE_HYPERLINK) && env.FORCE_HYPERLINK !== ''
  }
  if (!isTTY || env.CI) return false
  if (env.WT_SESSION || env.KONSOLE_VERSION || env.DOMTERM) return true
  if (['ghostty', 'Hyper', 'iTerm.app', 'tabby', 'vscode', 'WezTerm'].includes(env.TERM_PROGRAM)) {
    return true
  }
  if (['alacritty', 'xterm-ghostty', 'xterm-kitty'].includes(env.TERM)) return true
  // VTE (GNOME Terminal and friends) since 0.50.1, written 5001 and up.
  return Number(env.VTE_VERSION) >= 5001
}

/** The URL as a clickable link when the terminal supports it, else as plain text. */
export function terminalLink(url, hyperlinks) {
  return hyperlinks ? `\u001B]8;;${url}\u0007${url}\u001B]8;;\u0007` : url
}

// ---------- drawing ----------

/** The guide's symbols, as @clack/prompts draws them, with ASCII for older terminals. */
export const SYMBOLS = {
  ascii: {
    active: '*',
    bar: '|',
    barEnd: '-',
    barStart: 'T',
    cancel: 'x',
    error: '!',
    frames: ['-', '\\', '|', '/'],
    info: '-',
    mask: '*',
    radioOff: ' ',
    radioOn: '>',
    submit: 'o',
    warn: '!',
  },
  unicode: {
    active: '◆',
    bar: '│',
    barEnd: '└',
    barStart: '┌',
    cancel: '■',
    error: '▲',
    frames: ['◒', '◐', '◓', '◑'],
    info: '●',
    mask: '▪',
    radioOff: '○',
    radioOn: '●',
    submit: '◇',
    warn: '▲',
  },
}

/** Whether the terminal draws the guide's symbols (as @clack/prompts decides). */
export function unicodeSupported(env, platform) {
  if (platform !== 'win32') return env.TERM !== 'linux'
  return Boolean(
    env.WT_SESSION ||
      env.TERMINUS_SUBLIME ||
      env.TERM_PROGRAM === 'vscode' ||
      env.TERM === 'xterm-256color' ||
      env.TERM === 'alacritty' ||
      env.TERMINAL_EMULATOR === 'JetBrains-JediTerm',
  )
}

/** Colors for a stream; the identity when it has none (styleText checks NO_COLOR and the TTY). */
export function painter(stream) {
  const paint = (format) => (text) => styleText(format, text, { stream })
  return {
    cyan: paint('cyan'),
    dim: paint('dim'),
    gray: paint('gray'),
    green: paint('green'),
    magenta: paint('magenta'),
    red: paint('red'),
    strike: paint(['strikethrough', 'dim']),
    title: paint(['bgCyan', 'black']),
    yellow: paint('yellow'),
  }
}

/** Words wrapped to `width` columns (plain text). */
export function wrapText(text, width) {
  const lines = []
  let line = ''
  for (const word of text.split(/\s+/).filter(Boolean)) {
    if (line && line.length + 1 + word.length > width) {
      lines.push(line)
      line = word
    } else {
      line = line ? `${line} ${word}` : word
    }
  }
  lines.push(line)
  return lines
}

/** The symbol and bar color for a prompt state. */
function stateStyle(state, sym, paint) {
  if (state === 'submit') return { bar: paint.gray(sym.bar), mark: paint.green(sym.submit) }
  if (state === 'cancel') return { bar: paint.gray(sym.bar), mark: paint.red(sym.cancel) }
  if (state === 'error') return { bar: paint.yellow(sym.bar), mark: paint.yellow(sym.error) }
  return { bar: paint.cyan(sym.bar), mark: paint.cyan(sym.active) }
}

/** The lines of a message, the first after the state's symbol and the rest after the bar. */
function heading(message, { bar, columns, mark }) {
  const [first, ...rest] = wrapText(message, Math.max(20, columns - 3))
  return [`${mark}  ${first}`, ...rest.map((line) => `${bar}  ${line}`)]
}

/**
 * A select screen. Only the option under the cursor shows its hint, on the lines below it; a
 * disabled option always shows why. Ends with a newline while it's open, as @clack/prompts does.
 * `back` says a cancel was Esc (back a screen) rather than Ctrl+C.
 */
export function renderSelect({ back, columns = 80, cursor, paint, screen, state, sym }) {
  const { bar, mark } = stateStyle(state, sym, paint)
  const lines = [paint.gray(sym.bar), ...heading(screen.message, { bar, columns, mark })]
  const picked = screen.options[cursor]
  if (state === 'submit') return [...lines, `${bar}  ${paint.dim(picked.label)}`].join('\n')
  if (state === 'cancel') {
    const shown = back && !screen.first ? paint.dim('Back') : paint.strike(picked.label)
    return [...lines, `${bar}  ${shown}`].join('\n')
  }
  screen.options.forEach((option, index) => {
    if (option.disabled) {
      lines.push(
        `${bar}  ${paint.gray(sym.radioOff)} ${paint.gray(option.label)}  ${paint.dim(option.hint)}`,
      )
    } else if (index === cursor) {
      lines.push(`${bar}  ${paint.green(sym.radioOn)} ${option.label}`)
      if (option.hint) {
        for (const line of wrapText(option.hint, Math.max(20, columns - 7))) {
          lines.push(`${bar}      ${paint.dim(line)}`)
        }
      }
    } else {
      lines.push(`${bar}  ${paint.dim(sym.radioOff)} ${paint.dim(option.label)}`)
    }
  })
  const help = screen.first ? SELECT_HELP : `${SELECT_HELP}, Esc to go back`
  lines.push(`${paint.cyan(sym.barEnd)}  ${paint.dim(help)}`)
  return `${lines.join('\n')}\n`
}

/** Shown in place of a pasted key: a few mask symbols and its length, never the key. */
function maskedKey(value, sym) {
  if (!value) return ''
  return `${sym.mask.repeat(Math.min(value.length, 24))} (${value.length} characters)`
}

/** What a key screen says once answered. Nothing is saved until the last screen. */
function keyOutcome(screen, value) {
  if ((value ?? '').trim()) return `Got your ${screen.label} key`
  return screen.empty === 'keep' ? 'Keeping the key you have' : 'Skipped'
}

/**
 * A key screen: the title, the lines and the link, the masked key, then the help line (or what
 * went wrong). `link` turns a URL into what the terminal shows; `back` says a cancel was Esc.
 */
export function renderSecret({
  back,
  columns = 80,
  error,
  link,
  paint,
  screen,
  state,
  sym,
  value,
}) {
  const { bar, mark } = stateStyle(state, sym, paint)
  const lines = [paint.gray(sym.bar), ...heading(screen.title, { bar, columns, mark })]
  if (state === 'submit' || state === 'cancel') {
    const outcome = state === 'submit' ? keyOutcome(screen, value) : back ? 'Back' : 'Stopped'
    return [...lines, `${bar}  ${paint.dim(outcome)}`].join('\n')
  }
  const textWidth = Math.max(20, columns - 3)
  const text = screen.lines.flatMap((line) => wrapText(line, textWidth))
  // The link follows the last line ("Get one at"), on the same line when it fits.
  const lastLine = text.pop()
  for (const line of text) lines.push(`${bar}  ${line}`)
  if (lastLine.length + 1 + screen.link.length <= textWidth) {
    lines.push(`${bar}  ${lastLine} ${link(screen.link)}`)
  } else {
    lines.push(`${bar}  ${lastLine}`, `${bar}  ${link(screen.link)}`)
  }
  lines.push(`${bar}  ${maskedKey(value, sym)}${paint.dim('█')}`)
  const end = state === 'error' ? paint.yellow(sym.barEnd) : paint.cyan(sym.barEnd)
  lines.push(`${end}  ${state === 'error' ? paint.yellow(error) : paint.dim(screen.footer)}`)
  return `${lines.join('\n')}\n`
}

/** How long a step has taken: "4s", "2m 05s". */
export function elapsedLabel(ms) {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  return minutes > 0 ? `${minutes}m ${String(seconds % 60).padStart(2, '0')}s` : `${seconds}s`
}

/**
 * One progress line: on the guide after interactive questions, else after a check mark, an
 * exclamation mark or a dash. Lines after the first are indented under it.
 */
export function progressLine(kind, text, { guide, paint, sym }) {
  const [first, ...rest] = text.split('\n').map((line) => line.replace(/^ {2}/, ''))
  if (guide) {
    const mark = {
      done: paint.green(sym.submit),
      info: paint.cyan(sym.info),
      warn: paint.yellow(sym.warn),
    }[kind]
    const more = rest.map((line) => `\n${paint.gray(sym.bar)}  ${line}`).join('')
    return `${paint.gray(sym.bar)}\n${mark}  ${first}${more}`
  }
  const mark = { done: paint.green('✓'), info: paint.dim('-'), warn: paint.yellow('!') }[kind]
  const more = rest.map((line) => `\n  ${line}`).join('')
  const shown = `${first}${more}`
  return `${mark} ${kind === 'info' ? paint.dim(shown) : shown}`
}

// ---------- the terminal ----------

/**
 * Draws the screens in the terminal with @clack/core: `select` and `secret` resolve the answer,
 * BACK on Esc or QUIT on Ctrl+C. `input`/`output` default to the process's own.
 */
export async function terminalAsk({
  env = process.env,
  input = process.stdin,
  output = process.stdout,
} = {}) {
  const { isCancel, PasswordPrompt, SelectPrompt } = await import('@clack/core')
  const sym = SYMBOLS[unicodeSupported(env, process.platform) ? 'unicode' : 'ascii']
  const paint = painter(output)
  const hyperlinks = supportsHyperlinks(env, Boolean(output.isTTY))
  const link = (url) => terminalLink(url, hyperlinks)
  const columns = () => output.columns ?? 80

  /**
   * Runs a prompt, telling Esc (BACK) from Ctrl+C (QUIT): @clack/core cancels on both.
   * `pressed.escape` is set before the prompt draws its last frame.
   */
  async function run(prompt, pressed) {
    prompt.on('key', (_char, key) => {
      pressed.escape = key?.name === 'escape'
    })
    const value = await prompt.prompt()
    if (isCancel(value)) return pressed.escape ? BACK : QUIT
    return value
  }

  return {
    link,
    paint,
    secret(screen) {
      const pressed = { escape: false }
      return run(
        new PasswordPrompt({
          input,
          output,
          render() {
            return renderSecret({
              back: pressed.escape,
              columns: columns(),
              error: this.error,
              link,
              paint,
              screen,
              state: this.state,
              sym,
              value: this.userInput,
            })
          },
          validate: (value) => checkKeyInput(screen, value),
        }),
        pressed,
      ).then((value) => (typeof value === 'string' ? value.trim() : value))
    },
    select(screen) {
      const pressed = { escape: false }
      return run(
        new SelectPrompt({
          initialValue: screen.initialValue,
          input,
          options: screen.options,
          output,
          render() {
            return renderSelect({
              back: pressed.escape,
              columns: columns(),
              cursor: this.cursor,
              paint,
              screen,
              state: this.state,
              sym,
            })
          },
        }),
        pressed,
      )
    },
    sym,
  }
}
