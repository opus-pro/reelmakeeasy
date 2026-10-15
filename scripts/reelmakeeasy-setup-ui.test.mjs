import assert from 'node:assert/strict'
import { PassThrough } from 'node:stream'
import { describe, it } from 'node:test'

import {
  askSetupQuestions,
  BACK,
  captionEngines,
  captionsScreen,
  checkKeyInput,
  elapsedLabel,
  generationDefault,
  installedEngines,
  keyScreen,
  keysForService,
  localCaptionsCheck,
  localServerEngines,
  localServerFallback,
  localTtsEngines,
  localVoicesCheck,
  parseLocalCaptionsFlag,
  parseLocalTtsFlag,
  progressLine,
  QUIT,
  qwenFit,
  renderSecret,
  renderSelect,
  serviceScreen,
  setupSteps,
  skippedPartNote,
  supportsHyperlinks,
  SYMBOLS,
  terminalAsk,
  terminalLink,
  VIDEO_COST,
  voicesScreen,
  wrapText,
  writerLine,
} from './reelmakeeasy-setup-ui.mjs'

const HARDWARE = {
  qwen3: {
    cuda: { minRamGB: 32, minVramGB: 8 },
    mlx: { minRamGB: 24, recommendedRamGB: 36 },
  },
  toleranceGB: 0.75,
}
const plain = new Proxy({}, { get: () => (s) => s })
const sym = SYMBOLS.unicode

describe('the video service screen', () => {
  it('offers fal.ai, Google Gemini or both, with the cost of a 30-second video', () => {
    const screen = serviceScreen({ saved: {} })
    assert.equal(screen.message, 'Which video service will you use? You need at least one.')
    assert.deepEqual(
      screen.options.map((o) => [o.value, o.label]),
      [
        ['fal', 'fal.ai'],
        ['gemini', 'Google Gemini'],
        ['both', 'Both'],
      ],
    )
    const [fal, gemini, both] = screen.options
    assert.match(fal.hint, /^Cheapest/)
    assert.ok(fal.hint.includes(`about ${VIDEO_COST.fal} for a 30-second video`))
    assert.match(fal.hint, /pictures, clips, music and voices/)
    assert.ok(gemini.hint.includes(`About ${VIDEO_COST.gemini} for a 30-second video`))
    assert.match(gemini.hint, /write and plan/)
    assert.match(both.hint, /Setup page/)
  })

  it('starts on what .env already has, else fal.ai', () => {
    const initial = (saved) => serviceScreen({ saved }).initialValue
    assert.equal(initial({}), 'fal')
    assert.equal(initial({ FAL_KEY: true }), 'fal')
    assert.equal(initial({ GEMINI_API_KEY: true }), 'gemini')
    assert.equal(initial({ FAL_KEY: true, GEMINI_API_KEY: true }), 'both')
  })

  it('asks for fal first, then Gemini', () => {
    assert.deepEqual(keysForService('fal'), ['FAL_KEY'])
    assert.deepEqual(keysForService('gemini'), ['GEMINI_API_KEY'])
    assert.deepEqual(keysForService('both'), ['FAL_KEY', 'GEMINI_API_KEY'])
  })

  it('makes a single pick the default for videos, and leaves both to the Setup page', () => {
    assert.equal(generationDefault('fal'), 'fal')
    assert.equal(generationDefault('gemini'), 'google')
    assert.equal(generationDefault('both'), undefined)
  })
})

describe('the key screens', () => {
  it('asks for a picked key with a link, and does not take an empty answer', () => {
    const screen = keyScreen('FAL_KEY', { saved: false })
    assert.equal(screen.title, 'Paste your fal.ai key')
    assert.deepEqual(screen.link, 'https://fal.ai/dashboard/keys')
    assert.match(checkKeyInput(screen, ''), /Paste your fal\.ai key to go on/)
    assert.match(checkKeyInput(screen, undefined), /Esc goes back/)
    assert.equal(checkKeyInput(screen, ' fal-key-123 '), undefined)
    assert.equal(
      keyScreen('GEMINI_API_KEY', { saved: false }).title,
      'Paste your Google Gemini key',
    )
    assert.equal(
      keyScreen('GEMINI_API_KEY', { saved: false }).link,
      'https://aistudio.google.com/apikey',
    )
  })

  it('keeps a saved key on Enter', () => {
    const screen = keyScreen('GEMINI_API_KEY', { saved: true })
    assert.equal(screen.empty, 'keep')
    assert.match(screen.lines.join(' '), /already have a Google Gemini key.*Press Enter to keep it/)
    assert.equal(checkKeyInput(screen, ''), undefined)
  })

  it('says ElevenLabs is optional first, with its free credits, and skips on Enter', () => {
    const screen = keyScreen('ELEVENLABS_API_KEY', { saved: false })
    assert.match(screen.title, /^\[optional\] ElevenLabs key/)
    assert.match(screen.lines.join(' '), /only for ElevenLabs voices/i)
    assert.match(screen.lines.join(' '), /free credits when you sign up/)
    assert.equal(screen.link, 'https://elevenlabs.io/app/settings/api-keys')
    assert.match(screen.footer, /Press Enter to skip/)
    assert.equal(screen.empty, 'skip')
    assert.equal(checkKeyInput(screen, ''), undefined)
  })

  it('refuses a key with spaces in it', () => {
    const screen = keyScreen('FAL_KEY', { saved: false })
    assert.match(checkKeyInput(screen, 'FAL_KEY = abc'), /no spaces/)
  })
})

describe('qwenFit', () => {
  it('needs 24 GB of memory on a Mac, with a little slack', () => {
    assert.deepEqual(qwenFit({ backend: 'mlx', hardware: HARDWARE, ramGB: 16 }), {
      ok: false,
      ramGB: 16,
      reason: 'needs 24 GB of memory; this Mac has 16 GB',
    })
    const fit = qwenFit({ backend: 'mlx', hardware: HARDWARE, ramGB: 23.5 })
    assert.equal(fit.ok, true)
    assert.equal(fit.recommended, false)
    assert.equal(qwenFit({ backend: 'mlx', hardware: HARDWARE, ramGB: 36 }).recommended, true)
  })

  it('needs 8 GB of graphics memory and 32 GB of memory on NVIDIA', () => {
    assert.equal(
      qwenFit({ backend: 'cuda', hardware: HARDWARE, ramGB: 64, vramGB: 4 }).reason,
      'needs a graphics card with 8 GB of memory; this one has 4 GB',
    )
    assert.equal(
      qwenFit({ backend: 'cuda', hardware: HARDWARE, ramGB: 16, vramGB: 12 }).reason,
      'needs 32 GB of memory; this computer has 16 GB',
    )
    assert.equal(qwenFit({ backend: 'cuda', hardware: HARDWARE, ramGB: 32, vramGB: 8 }).ok, true)
  })

  it('needs an Apple Silicon Mac or an NVIDIA graphics card', () => {
    assert.equal(
      qwenFit({ backend: 'cpu', hardware: HARDWARE, ramGB: 64 }).reason,
      'needs an Apple Silicon Mac or an NVIDIA graphics card',
    )
  })
})

describe('the local voices screen', () => {
  const weak = qwenFit({ backend: 'mlx', hardware: HARDWARE, ramGB: 16 })
  const strong = qwenFit({ backend: 'mlx', hardware: HARDWARE, ramGB: 48 })

  it('offers Kokoro, Qwen3, both or skip, with the download sizes', () => {
    const screen = voicesScreen({ backend: 'mlx', fal: true, qwen: strong })
    assert.deepEqual(
      screen.options.map((o) => [o.value, o.label]),
      [
        ['kokoro', 'Kokoro'],
        ['qwen', 'Qwen3'],
        ['all', 'Both'],
        ['off', 'Skip'],
      ],
    )
    const hint = (value) => screen.options.find((o) => o.value === value).hint
    assert.match(hint('kokoro'), /about a 0\.4 GB download/)
    assert.match(hint('qwen'), /More voices.*about a 10 GB download/)
    assert.match(hint('off'), /run online on fal/)
    assert.equal(screen.initialValue, 'all')
    assert.ok(screen.options.every((o) => !o.disabled))
    assert.match(
      voicesScreen({ backend: 'cuda', fal: true, qwen: { ok: true } }).options[1].hint,
      /about a 14 GB download/,
    )
  })

  it('shows Qwen3 and both as unavailable, with why, below the minimum, and starts on Kokoro', () => {
    const screen = voicesScreen({ backend: 'mlx', fal: true, qwen: weak })
    const byValue = Object.fromEntries(screen.options.map((o) => [o.value, o]))
    for (const value of ['qwen', 'all']) {
      assert.equal(byValue[value].disabled, true)
      assert.equal(byValue[value].hint, 'needs 24 GB of memory; this Mac has 16 GB')
    }
    assert.equal(screen.initialValue, 'kokoro')
  })

  it('starts on what is installed', () => {
    const initial = (installed) =>
      voicesScreen({ backend: 'mlx', fal: true, installed, qwen: strong }).initialValue
    assert.equal(initial(['kokoro']), 'kokoro')
    assert.equal(initial(['qwen3']), 'qwen')
    assert.equal(initial(['kokoro', 'qwen3']), 'all')
  })

  it('ignores the caption engines when it looks at what is installed', () => {
    const initial = (installed) =>
      voicesScreen({ backend: 'mlx', fal: true, installed, qwen: strong }).initialValue
    assert.equal(initial(['whisper', 'align']), 'all')
    assert.equal(initial(['kokoro', 'whisper', 'align']), 'kokoro')
  })

  it('says Gemini makes the voices when skipping without fal', () => {
    const screen = voicesScreen({ backend: 'mlx', fal: false, qwen: strong })
    assert.match(screen.options.at(-1).hint, /Gemini/)
  })

  it('maps each answer to the engines setup installs', () => {
    assert.deepEqual(localTtsEngines('all', true), { engines: ['kokoro', 'qwen3'] })
    assert.deepEqual(localTtsEngines('kokoro', true), { engines: ['kokoro'] })
    assert.deepEqual(localTtsEngines('qwen', true), { engines: ['qwen3'] })
    assert.deepEqual(localTtsEngines('off', true), { engines: [] })
    assert.deepEqual(localTtsEngines('all', false), {
      engines: ['kokoro'],
      note: 'Installing Kokoro only; Qwen3 voices will run on fal.',
    })
    assert.deepEqual(localTtsEngines('qwen', false), {
      engines: [],
      note: 'Installing no local voices; Qwen3 voices will run on fal.',
    })
  })
})

describe('parseLocalTtsFlag', () => {
  it('reads --local-tts, bare meaning all, and refuses unknown values', () => {
    assert.deepEqual(parseLocalTtsFlag([]), {})
    assert.deepEqual(parseLocalTtsFlag(['--local-tts']), { value: 'all' })
    for (const value of ['all', 'kokoro', 'qwen', 'off']) {
      assert.deepEqual(parseLocalTtsFlag([`--local-tts=${value}`]), { value })
    }
    // Older docs and agents said "full"; "both" is what the screen says.
    assert.deepEqual(parseLocalTtsFlag(['--local-tts=full']), { value: 'all' })
    assert.deepEqual(parseLocalTtsFlag(['--local-tts=both']), { value: 'all' })
    assert.deepEqual(parseLocalTtsFlag(['--local-tts=qwen3-only']), {
      error: '--local-tts must be all, kokoro, qwen or off',
    })
  })
})

describe('local captions', () => {
  it('reads --local-captions, bare meaning on, apart from --local-tts', () => {
    assert.deepEqual(parseLocalCaptionsFlag([]), {})
    assert.deepEqual(parseLocalCaptionsFlag(['--local-tts=off']), {})
    assert.deepEqual(parseLocalCaptionsFlag(['--local-captions']), { value: 'on' })
    assert.deepEqual(parseLocalCaptionsFlag(['--local-captions=on']), { value: 'on' })
    assert.deepEqual(parseLocalCaptionsFlag(['--local-captions=OFF']), { value: 'off' })
    assert.deepEqual(parseLocalCaptionsFlag(['--local-tts=off', '--local-captions=on']), {
      value: 'on',
    })
    assert.deepEqual(parseLocalCaptionsFlag(['--local-captions=whisper']), {
      error: '--local-captions must be on or off',
    })
  })

  it('installs Whisper and the aligner when on, nothing when off', () => {
    assert.deepEqual(captionEngines('on'), ['whisper', 'align'])
    assert.deepEqual(captionEngines('off'), [])
  })

  it('asks in one short line, with the download size of this backend, and starts on yes', () => {
    const screen = captionsScreen({ backend: 'mlx' })
    assert.equal(screen.id, 'captions')
    assert.equal(screen.message, 'Time captions on this computer? Free, about 2 GB')
    assert.deepEqual(
      screen.options.map((o) => [o.value, o.label]),
      [
        ['on', 'Yes'],
        ['off', 'Skip'],
      ],
    )
    assert.equal(screen.initialValue, 'on')
    assert.match(screen.options[1].hint, /online \(paid\)/)
    assert.match(captionsScreen({ backend: 'cuda' }).message, /about 2 GB$/)
    assert.match(captionsScreen({ backend: 'cpu' }).message, /about 0\.9 GB$/)
  })

  it('starts the local server with the engines LOCAL_TTS and LOCAL_ASR leave on', () => {
    const all = ['kokoro', 'qwen3', 'whisper', 'align']
    assert.deepEqual(localServerEngines(all, {}), all)
    assert.deepEqual(localServerEngines(all, { LOCAL_TTS: 'off' }), ['whisper', 'align'])
    assert.deepEqual(localServerEngines(all, { LOCAL_ASR: 'off' }), ['kokoro', 'qwen3'])
    assert.deepEqual(localServerEngines(all, { LOCAL_ASR: 'off', LOCAL_TTS: 'off' }), [])
    assert.deepEqual(localServerEngines(['whisper', 'align'], {}), ['whisper', 'align'])
    assert.deepEqual(localServerEngines(undefined, {}), [])
  })

  it('says what falls back when the local server stops', () => {
    assert.equal(localServerFallback(['kokoro']), 'Kokoro and Qwen3 voices fall back to fal.')
    assert.equal(
      localServerFallback(['whisper', 'align']),
      'Caption timing falls back to ElevenLabs, fal or Gemini.',
    )
    assert.equal(
      localServerFallback(['kokoro', 'qwen3', 'whisper', 'align']),
      'Kokoro and Qwen3 voices fall back to fal, and caption timing to ElevenLabs, fal or Gemini.',
    )
  })
})

describe('what setup installs on the local server', () => {
  const previous = { backend: 'mlx', engines: ['kokoro', 'qwen3', 'whisper', 'align'] }

  it('replaces the engines of each part it installs', () => {
    assert.deepEqual(
      installedEngines({
        backend: 'mlx',
        installed: { captions: ['whisper', 'align'], voices: ['kokoro'] },
        previous,
      }),
      ['kokoro', 'whisper', 'align'],
    )
    assert.deepEqual(
      installedEngines({ backend: 'mlx', installed: { voices: ['kokoro'] }, previous: undefined }),
      ['kokoro'],
    )
  })

  it('keeps what an earlier setup installed for a part skipped or not downloaded', () => {
    // --local-captions=off, or the caption download failed: the captions installed before stay.
    assert.deepEqual(
      installedEngines({ backend: 'mlx', installed: { voices: ['kokoro'] }, previous }),
      ['kokoro', 'whisper', 'align'],
    )
    // --local-tts=off: the voices installed before stay, as they always did.
    assert.deepEqual(
      installedEngines({ backend: 'mlx', installed: { captions: ['whisper', 'align'] }, previous }),
      ['kokoro', 'qwen3', 'whisper', 'align'],
    )
  })

  it('keeps nothing from another backend', () => {
    assert.deepEqual(
      installedEngines({ backend: 'cpu', installed: { captions: ['whisper', 'align'] }, previous }),
      ['whisper', 'align'],
    )
  })

  it('says a skipped part runs online, or that what was installed before stays on', () => {
    assert.equal(
      skippedPartNote('voices', { backend: 'mlx', previous: undefined }),
      'Local voices skipped: Kokoro and Qwen3 voices will run on fal (paid).',
    )
    assert.equal(
      skippedPartNote('captions', {
        backend: 'mlx',
        previous: { backend: 'mlx', engines: ['kokoro'] },
      }),
      'Local caption timing skipped: ElevenLabs, fal or Gemini will time the captions (paid).',
    )
    assert.equal(
      skippedPartNote('voices', { backend: 'mlx', previous }),
      'Local voices skipped; the ones installed before (kokoro + qwen3) stay on. LOCAL_TTS=off in .env turns them off.',
    )
    assert.equal(
      skippedPartNote('captions', { backend: 'mlx', previous }),
      'Local caption timing skipped; the one installed before stays on. LOCAL_ASR=off in .env turns it off.',
    )
  })
})

describe('doctor: local voices and captions', () => {
  const both = { backend: 'mlx', engines: ['kokoro', 'qwen3', 'whisper', 'align'] }

  it('lists only the voice engines under Local voices', () => {
    assert.deepEqual(localVoicesCheck({ detected: 'mlx', env: {}, state: both }), {
      detail: 'kokoro + qwen3 on mlx (free)',
      ok: true,
    })
    const captionsOnly = { backend: 'cpu', engines: ['whisper', 'align'] }
    const voices = localVoicesCheck({ detected: 'cpu', env: {}, state: captionsOnly })
    assert.equal(voices.ok, false)
    assert.match(
      voices.detail,
      /^not installed: Kokoro and Qwen3 run on fal \(paid\).*cpu detected/,
    )
    assert.deepEqual(
      localVoicesCheck({ detected: 'mlx', env: { LOCAL_TTS: 'off' }, state: both }),
      {
        detail: 'off (LOCAL_TTS=off): Kokoro and Qwen3 run on fal',
        ok: true,
      },
    )
  })

  it('says where captions are timed under Local captions', () => {
    assert.deepEqual(localCaptionsCheck({ env: {}, state: both }), {
      detail: 'Whisper and aligner on mlx (free)',
      ok: true,
    })
    // LOCAL_TTS=off leaves captions alone.
    assert.equal(localCaptionsCheck({ env: { LOCAL_TTS: 'off' }, state: both }).ok, true)
    const voicesOnly = { backend: 'mlx', engines: ['kokoro'] }
    for (const state of [voicesOnly, null]) {
      const missing = localCaptionsCheck({ env: {}, state })
      assert.equal(missing.ok, false)
      assert.match(missing.detail, /^not installed: ElevenLabs, fal or Gemini time the captions/)
      assert.match(missing.detail, /pnpm reelmakeeasy setup/)
    }
    assert.deepEqual(localCaptionsCheck({ env: { LOCAL_ASR: 'off' }, state: both }), {
      detail: 'off (LOCAL_ASR=off): ElevenLabs, fal or Gemini time the captions',
      ok: true,
    })
  })
})

describe('setupSteps', () => {
  it('asks about local captions last, when it asks', () => {
    assert.deepEqual(
      setupSteps('fal', { askCaptions: true, askVoices: true, fromFlags: { FAL_KEY: true } }),
      ['service', 'ELEVENLABS_API_KEY', 'voices', 'captions'],
    )
    assert.deepEqual(setupSteps('fal', { askCaptions: true, askVoices: false, fromFlags: {} }), [
      'service',
      'FAL_KEY',
      'ELEVENLABS_API_KEY',
      'captions',
    ])
  })

  it('asks for the picked keys, then ElevenLabs, then local voices', () => {
    assert.deepEqual(setupSteps('both', { askVoices: true, fromFlags: {} }), [
      'service',
      'FAL_KEY',
      'GEMINI_API_KEY',
      'ELEVENLABS_API_KEY',
      'voices',
    ])
    assert.deepEqual(
      setupSteps('gemini', { askVoices: false, fromFlags: { ELEVENLABS_API_KEY: true } }),
      ['service', 'GEMINI_API_KEY'],
    )
    assert.deepEqual(setupSteps('fal', { askVoices: false, fromFlags: { FAL_KEY: true } }), [
      'service',
      'ELEVENLABS_API_KEY',
    ])
  })
})

/** A fake terminal: answers each screen from `script` in turn and records what it showed. */
function scripted(script) {
  const shown = []
  const next = (screen) => {
    shown.push(screen.id)
    assert.ok(script.length > 0, `nothing scripted for ${screen.id}`)
    const answer = script.shift()
    if (screen.kind === 'secret' && typeof answer === 'string') {
      assert.equal(checkKeyInput(screen, answer), undefined, `${screen.id} refused "${answer}"`)
    }
    return answer
  }
  return { ask: { secret: async (s) => next(s), select: async (s) => next(s) }, shown }
}

describe('askSetupQuestions', () => {
  const voices = voicesScreen({
    backend: 'mlx',
    fal: true,
    qwen: qwenFit({ backend: 'mlx', hardware: HARDWARE, ramGB: 48 }),
  })

  it('asks one screen at a time and returns the answers', async () => {
    const { ask, shown } = scripted(['fal', 'fal-key', '', 'kokoro'])
    const answers = await askSetupQuestions({ ask, fromFlags: {}, saved: {}, voices })
    assert.deepEqual(shown, ['service', 'FAL_KEY', 'ELEVENLABS_API_KEY', 'voices'])
    assert.deepEqual(answers, {
      keys: { FAL_KEY: 'fal-key' },
      localCaptions: undefined,
      localTts: 'kokoro',
      service: 'fal',
    })
  })

  it('asks for both keys, fal first, and trims them', async () => {
    const { ask, shown } = scripted(['both', ' f ', ' g ', 'e', 'off'])
    const answers = await askSetupQuestions({ ask, fromFlags: {}, saved: {}, voices })
    assert.deepEqual(shown, [
      'service',
      'FAL_KEY',
      'GEMINI_API_KEY',
      'ELEVENLABS_API_KEY',
      'voices',
    ])
    assert.deepEqual(answers.keys, { ELEVENLABS_API_KEY: 'e', FAL_KEY: 'f', GEMINI_API_KEY: 'g' })
  })

  it('goes back a screen on Esc, and drops keys for a service no longer picked', async () => {
    const { ask, shown } = scripted(['both', 'f', BACK, BACK, 'gemini', 'g', '', 'all'])
    const answers = await askSetupQuestions({ ask, fromFlags: {}, saved: {}, voices })
    assert.deepEqual(shown, [
      'service',
      'FAL_KEY',
      'GEMINI_API_KEY',
      'FAL_KEY',
      'service',
      'GEMINI_API_KEY',
      'ELEVENLABS_API_KEY',
      'voices',
    ])
    assert.deepEqual(answers, {
      keys: { GEMINI_API_KEY: 'g' },
      localCaptions: undefined,
      localTts: 'all',
      service: 'gemini',
    })
  })

  it('quits on Esc on the first screen, as there is nothing to go back to', async () => {
    const { ask } = scripted([BACK])
    assert.deepEqual(await askSetupQuestions({ ask, fromFlags: {}, saved: {}, voices }), {
      quit: true,
    })
  })

  it('keeps a key typed earlier when going back over its screen', async () => {
    const seen = []
    const { ask } = scripted(['fal', 'f', BACK, '', '', 'off'])
    const secret = ask.secret
    ask.secret = (screen) => (seen.push([screen.id, screen.empty]), secret(screen))
    const answers = await askSetupQuestions({ ask, fromFlags: {}, saved: {}, voices })
    assert.deepEqual(seen, [
      ['FAL_KEY', 'required'],
      ['ELEVENLABS_API_KEY', 'skip'],
      ['FAL_KEY', 'keep'],
      ['ELEVENLABS_API_KEY', 'skip'],
    ])
    assert.deepEqual(answers.keys, { FAL_KEY: 'f' })
  })

  it('builds the voices screen from the service picked', async () => {
    const { ask } = scripted(['gemini', 'g', '', 'off'])
    const services = []
    await askSetupQuestions({
      ask,
      fromFlags: {},
      saved: {},
      voices: (service) => (services.push(service), voices),
    })
    assert.deepEqual(services, ['gemini'])
  })

  it('asks about captions after the voices, and goes back to them on Esc', async () => {
    const { ask, shown } = scripted(['fal', 'f', '', 'off', BACK, 'kokoro', 'on'])
    const answers = await askSetupQuestions({
      ask,
      captions: captionsScreen({ backend: 'mlx' }),
      fromFlags: {},
      saved: {},
      voices,
    })
    assert.deepEqual(shown, [
      'service',
      'FAL_KEY',
      'ELEVENLABS_API_KEY',
      'voices',
      'captions',
      'voices',
      'captions',
    ])
    assert.equal(answers.localTts, 'kokoro')
    assert.equal(answers.localCaptions, 'on')
  })

  it('asks about captions when the voices came as a flag', async () => {
    const { ask, shown } = scripted(['gemini', 'g', '', 'off'])
    const answers = await askSetupQuestions({
      ask,
      captions: captionsScreen({ backend: 'cpu' }),
      fromFlags: {},
      saved: {},
      voices: null,
    })
    assert.deepEqual(shown, ['service', 'GEMINI_API_KEY', 'ELEVENLABS_API_KEY', 'captions'])
    assert.equal(answers.localCaptions, 'off')
    assert.equal(answers.localTts, undefined)
  })

  it('quits on Ctrl+C', async () => {
    const { ask } = scripted(['both', 'f', QUIT])
    assert.deepEqual(await askSetupQuestions({ ask, fromFlags: {}, saved: {}, voices }), {
      quit: true,
    })
  })

  it('keeps saved keys on Enter and skips keys passed as flags and the voices it is not asking', async () => {
    const { ask, shown } = scripted(['both', ''])
    const answers = await askSetupQuestions({
      ask,
      fromFlags: { ELEVENLABS_API_KEY: true, FAL_KEY: true },
      saved: { GEMINI_API_KEY: true },
      voices: null,
    })
    assert.deepEqual(shown, ['service', 'GEMINI_API_KEY'])
    assert.deepEqual(answers, {
      keys: {},
      localCaptions: undefined,
      localTts: undefined,
      service: 'both',
    })
  })
})

describe('writerLine', () => {
  const ready = { claude: false, codex: false, endpoint: false, gemini: false }

  it('names the AI that writes and plans, the way the app picks it', () => {
    assert.deepEqual(writerLine({ ready: { ...ready, claude: true }, tieBreak: 'codex' }), {
      ok: true,
      text: 'Writes and plans the videos: Claude Code (signed in)',
    })
    assert.equal(
      writerLine({ ready: { ...ready, claude: true, codex: true }, tieBreak: 'codex' }).text,
      'Writes and plans the videos: Codex (signed in)',
    )
    assert.equal(
      writerLine({ ready: { ...ready, claude: true, codex: true }, tieBreak: 'claude' }).text,
      'Writes and plans the videos: Claude Code (signed in)',
    )
    assert.equal(
      writerLine({ ready: { ...ready, gemini: true }, tieBreak: 'codex' }).text,
      'Writes and plans the videos: Google Gemini (your key)',
    )
  })

  it('follows a chosen AI, and says when it is not ready', () => {
    assert.equal(
      writerLine({
        chosen: 'gemini',
        ready: { ...ready, codex: true, gemini: true },
        tieBreak: 'codex',
      }).text,
      'Writes and plans the videos: Google Gemini (your key)',
    )
    assert.deepEqual(writerLine({ chosen: 'claude', ready, tieBreak: 'codex' }), {
      ok: false,
      text: 'Claude Code is picked to write and plan, but it is not ready: sign in to it, or pick another on the Setup page.',
    })
  })

  it('says what to do when nothing can write', () => {
    assert.deepEqual(writerLine({ ready, tieBreak: 'codex' }), {
      ok: false,
      text: 'Nothing can write and plan the videos yet: sign in to Codex or Claude Code, or add a Google Gemini key.',
    })
  })
})

describe('links', () => {
  it('makes links clickable only in terminals known to support it', () => {
    assert.equal(supportsHyperlinks({ TERM_PROGRAM: 'iTerm.app' }, true), true)
    assert.equal(supportsHyperlinks({ TERM_PROGRAM: 'vscode' }, true), true)
    assert.equal(supportsHyperlinks({ TERM_PROGRAM: 'ghostty' }, true), true)
    assert.equal(supportsHyperlinks({ TERM_PROGRAM: 'WezTerm' }, true), true)
    assert.equal(supportsHyperlinks({ TERM: 'xterm-kitty' }, true), true)
    assert.equal(supportsHyperlinks({ WT_SESSION: '1' }, true), true)
    assert.equal(supportsHyperlinks({ VTE_VERSION: '7600' }, true), true)
    assert.equal(supportsHyperlinks({ TERM_PROGRAM: 'Apple_Terminal' }, true), false)
    assert.equal(supportsHyperlinks({ TERM_PROGRAM: 'iTerm.app' }, false), false)
    assert.equal(supportsHyperlinks({ CI: 'true', TERM_PROGRAM: 'vscode' }, true), false)
    assert.equal(supportsHyperlinks({ FORCE_HYPERLINK: '1' }, false), true)
    assert.equal(supportsHyperlinks({ FORCE_HYPERLINK: '0', TERM_PROGRAM: 'vscode' }, true), false)
  })

  it('wraps the URL in OSC 8, or prints it plain', () => {
    const url = 'https://fal.ai/dashboard/keys'
    assert.equal(terminalLink(url, true), `\u001B]8;;${url}\u0007${url}\u001B]8;;\u0007`)
    assert.equal(terminalLink(url, false), url)
  })
})

describe('drawing the screens', () => {
  it('wraps words to the width', () => {
    assert.deepEqual(wrapText('one two three four', 9), ['one two', 'three', 'four'])
    assert.deepEqual(wrapText('', 9), [''])
  })

  it('shows the hint only under the option the cursor is on', () => {
    const screen = serviceScreen({ saved: {} })
    const frame = renderSelect({
      columns: 200,
      cursor: 1,
      paint: plain,
      screen,
      state: 'active',
      sym,
    })
    const lines = frame.split('\n')
    assert.equal(lines[1], `${sym.active}  ${screen.message}`)
    assert.equal(lines[2], `${sym.bar}  ${sym.radioOff} fal.ai`)
    assert.equal(lines[3], `${sym.bar}  ${sym.radioOn} Google Gemini`)
    assert.equal(lines[4], `${sym.bar}      ${screen.options[1].hint}`)
    assert.equal(lines[5], `${sym.bar}  ${sym.radioOff} Both`)
    assert.equal(lines[6], `${sym.barEnd}  ↑/↓ to move, Enter to pick`)
    assert.ok(!frame.includes(screen.options[0].hint))
  })

  it('offers Esc only on screens after the first, and shows going back as such', () => {
    const qwen = qwenFit({ backend: 'mlx', hardware: HARDWARE, ramGB: 48 })
    const voices = voicesScreen({ backend: 'mlx', fal: true, qwen })
    const frame = renderSelect({
      columns: 200,
      cursor: 0,
      paint: plain,
      screen: voices,
      state: 'active',
      sym,
    })
    assert.match(frame, /Enter to pick, Esc to go back/)
    const back = renderSelect({
      back: true,
      columns: 200,
      cursor: 0,
      paint: plain,
      screen: voices,
      state: 'cancel',
      sym,
    })
    assert.equal(back.split('\n').at(-1), `${sym.bar}  Back`)
    const key = keyScreen('GEMINI_API_KEY', { saved: false })
    const secret = (state, back, value = '') =>
      renderSecret({
        back,
        columns: 200,
        link: (u) => u,
        paint: plain,
        screen: key,
        state,
        sym,
        value,
      })
    assert.equal(secret('cancel', true).split('\n').at(-1), `${sym.bar}  Back`)
    assert.equal(secret('cancel', false).split('\n').at(-1), `${sym.bar}  Stopped`)
    // Nothing is saved until the last screen.
    assert.equal(
      secret('submit', false, 'k').split('\n').at(-1),
      `${sym.bar}  Got your Google Gemini key`,
    )
  })

  it('draws the captions screen in a few lines', () => {
    const screen = captionsScreen({ backend: 'mlx' })
    const frame = renderSelect({
      columns: 200,
      cursor: 0,
      paint: plain,
      screen,
      state: 'active',
      sym,
    })
    assert.deepEqual(frame.split('\n').slice(1, -1), [
      `${sym.active}  Time captions on this computer? Free, about 2 GB`,
      `${sym.bar}  ${sym.radioOn} Yes`,
      `${sym.bar}  ${sym.radioOff} Skip`,
      `${sym.barEnd}  ↑/↓ to move, Enter to pick, Esc to go back`,
    ])
  })

  it('shows why a disabled option is unavailable, and the pick once chosen', () => {
    const qwen = qwenFit({ backend: 'mlx', hardware: HARDWARE, ramGB: 16 })
    const screen = voicesScreen({ backend: 'mlx', fal: true, qwen })
    const frame = renderSelect({
      columns: 200,
      cursor: 0,
      paint: plain,
      screen,
      state: 'active',
      sym,
    })
    assert.match(frame, /Qwen3 {2}needs 24 GB of memory; this Mac has 16 GB/)
    const done = renderSelect({
      columns: 200,
      cursor: 0,
      paint: plain,
      screen,
      state: 'submit',
      sym,
    })
    assert.deepEqual(done.split('\n').slice(1), [
      `${sym.submit}  ${screen.message}`,
      `${sym.bar}  Kokoro`,
    ])
  })

  it('draws a key screen with its link, the masked key, and an error', () => {
    const screen = keyScreen('FAL_KEY', { saved: false })
    const frame = renderSecret({
      columns: 200,
      link: (url) => `<${url}>`,
      paint: plain,
      screen,
      state: 'error',
      sym,
      error: 'Paste your fal.ai key to go on.',
      value: 'abc',
    })
    assert.match(frame, /Paste your fal\.ai key\n/)
    assert.match(frame, /\n│ {2}Get one at <https:\/\/fal\.ai\/dashboard\/keys>\n/)
    assert.match(frame, new RegExp(`${sym.mask}{3}`))
    assert.match(frame, /Paste your fal\.ai key to go on\./)
    const done = renderSecret({
      columns: 200,
      link: (url) => url,
      paint: plain,
      screen: keyScreen('ELEVENLABS_API_KEY', { saved: false }),
      state: 'submit',
      sym,
      value: '',
    })
    assert.match(done, /Skipped/)
    const narrow = renderSecret({
      columns: 60,
      link: (url) => url,
      paint: plain,
      screen: keyScreen('ELEVENLABS_API_KEY', { saved: false }),
      state: 'active',
      sym,
      value: '',
    })
    // Too long for one line: the link gets a line of its own, after the text.
    assert.match(
      narrow,
      /\n│ {2}when you sign up:\n│ {2}https:\/\/elevenlabs\.io\/app\/settings\/api-keys\n/,
    )
  })

  it('says how long a step has taken', () => {
    assert.equal(elapsedLabel(4_200), '4s')
    assert.equal(elapsedLabel(125_000), '2m 05s')
  })

  it('prints a progress line with or without the guide', () => {
    assert.equal(
      progressLine('done', 'App built', { guide: false, paint: plain, sym }),
      '✓ App built',
    )
    assert.equal(
      progressLine('warn', 'No ffmpeg', { guide: false, paint: plain, sym }),
      '! No ffmpeg',
    )
    assert.equal(
      progressLine('done', 'App built', { guide: true, paint: plain, sym }),
      `${sym.bar}\n${sym.submit}  App built`,
    )
    assert.equal(
      progressLine('warn', 'Not installed\n  Retry later', { guide: true, paint: plain, sym }),
      `${sym.bar}\n${sym.warn}  Not installed\n${sym.bar}  Retry later`,
    )
    assert.equal(
      progressLine('warn', 'Not installed\n  Retry later', { guide: false, paint: plain, sym }),
      '! Not installed\n  Retry later',
    )
  })
})

/** Types into a prompt drawn on fake streams, as a person would. */
async function drive(run, keys) {
  const input = new PassThrough()
  const output = new PassThrough()
  output.columns = 100
  let drawn = ''
  output.on('data', (chunk) => (drawn += chunk))
  const ask = await terminalAsk({ env: {}, input, output })
  const answer = run(ask)
  for (const key of keys) {
    await new Promise((resolve) => setTimeout(resolve, 80))
    input.write(key)
  }
  return { answer: await answer, drawn }
}

describe('terminalAsk', () => {
  const service = serviceScreen({ saved: {} })

  it('moves with the arrow keys and picks with Enter', async () => {
    const { answer, drawn } = await drive((ask) => ask.select(service), ['\u001B[B', '\r'])
    assert.equal(answer, 'gemini')
    assert.match(drawn, /About \$3/)
  })

  it('goes back on Esc and quits on Ctrl+C', async () => {
    assert.equal((await drive((ask) => ask.select(service), ['\u001B'])).answer, BACK)
    assert.equal((await drive((ask) => ask.select(service), ['\u0003'])).answer, QUIT)
  })

  it('masks a pasted key and refuses an empty one', async () => {
    const screen = keyScreen('FAL_KEY', { saved: false })
    const { answer, drawn } = await drive((ask) => ask.secret(screen), ['\r', 'test-key-123', '\r'])
    assert.equal(answer, 'test-key-123')
    assert.ok(!drawn.includes('test-key-123'), 'the key should never be drawn')
    assert.match(drawn, /Paste your fal\.ai key to go on/)
  })
})
