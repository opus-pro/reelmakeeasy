import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  chosenProviders,
  commandHelp,
  keyChecks,
  missingVideoKey,
  NO_VIDEO_KEY_WARNING,
  parseProviderFlags,
  parseStoredSettings,
  setupDoneMessage,
  USAGE,
} from './reelmakeeasy-onboarding.mjs'

const ready = { detail: '1.0.0, signed in', ok: true }
const notReady = { detail: 'not installed', ok: false }

/** doctor's input with nothing set; each test overrides what it needs. */
function input(over = {}) {
  return {
    chosen: {},
    claude: notReady,
    codex: notReady,
    elevenlabsStatus: null,
    endpointStatus: null,
    env: {},
    geminiStatus: null,
    ...over,
  }
}

const byName = (checks) => Object.fromEntries(checks.map((c) => [c.name, c]))
const blocking = (checks) => checks.filter((c) => c.blocking && !c.ok).map((c) => c.name)

describe('keyChecks', () => {
  it('is ready with only FAL_KEY and Claude Code signed in', () => {
    const checks = keyChecks(input({ claude: ready, env: { FAL_KEY: 'k' } }))
    assert.deepEqual(blocking(checks), [])
    assert.equal(byName(checks)['Writing and planning'].detail, 'Claude Code ready')
    assert.equal(
      byName(checks).ELEVENLABS_API_KEY.detail,
      'not set: ElevenLabs voices and captions run through fal',
    )
  })

  it('is ready with only a working GEMINI_API_KEY, which also writes', () => {
    const checks = keyChecks(input({ env: { GEMINI_API_KEY: 'k' }, geminiStatus: 200 }))
    assert.deepEqual(blocking(checks), [])
    assert.equal(byName(checks)['Video key'].detail, 'Gemini (GEMINI_API_KEY)')
    assert.equal(byName(checks)['Writing and planning'].detail, 'Gemini ready')
  })

  it('blocks with no video key, and with nothing to write', () => {
    assert.deepEqual(blocking(keyChecks(input())), ['Video key', 'Writing and planning'])
    assert.deepEqual(blocking(keyChecks(input({ env: { FAL_KEY: 'k' } }))), [
      'Writing and planning',
    ])
    assert.equal(
      byName(keyChecks(input({ env: { FAL_KEY: 'k' } })))['Writing and planning'].detail,
      'sign in to Codex or Claude Code, or add GEMINI_API_KEY',
    )
  })

  it('only warns about a rejected key that is not needed', () => {
    const checks = keyChecks(
      input({ codex: ready, env: { FAL_KEY: 'k', GEMINI_API_KEY: 'bad' }, geminiStatus: 403 }),
    )
    assert.deepEqual(blocking(checks), [])
    assert.deepEqual(byName(checks).GEMINI_API_KEY, {
      blocking: false,
      detail: 'rejected (HTTP 403)',
      name: 'GEMINI_API_KEY',
      ok: false,
    })
  })

  it('blocks a chosen provider that is not ready', () => {
    const checks = keyChecks(
      input({
        chosen: { generation: 'google', llm: 'codex' },
        claude: ready,
        env: { FAL_KEY: 'k' },
      }),
    )
    assert.deepEqual(blocking(checks), ['Chosen to write', 'Chosen for videos'])
    assert.equal(
      byName(checks)['Chosen to write'].detail,
      'Codex is not ready: fix it, or pick another in Setup',
    )
  })

  it('says to pick in Setup when both video keys work', () => {
    const checks = keyChecks(
      input({ claude: ready, env: { FAL_KEY: 'k', GEMINI_API_KEY: 'k' }, geminiStatus: 200 }),
    )
    assert.equal(
      byName(checks)['Video key'].detail,
      'fal and Gemini: pick who makes the videos in Setup',
    )
  })

  it('says ElevenLabs runs through fal only while fal makes the videos', () => {
    const both = { FAL_KEY: 'k', GEMINI_API_KEY: 'k' }
    const elevenLabs = (over) => byName(keyChecks(input(over))).ELEVENLABS_API_KEY
    const notNeeded = {
      blocking: false,
      detail: 'not set (not needed: Gemini makes the voices and captions)',
      name: 'ELEVENLABS_API_KEY',
      ok: true,
    }
    assert.deepEqual(
      elevenLabs({ chosen: { generation: 'google' }, claude: ready, env: both, geminiStatus: 200 }),
      notNeeded,
    )
    assert.deepEqual(elevenLabs({ env: { GEMINI_API_KEY: 'k' }, geminiStatus: 200 }), notNeeded)
    // Nothing chosen with both keys: fal makes the videos until Setup says otherwise.
    assert.equal(
      elevenLabs({ claude: ready, env: both, geminiStatus: 200 }).detail,
      'not set: ElevenLabs voices and captions run through fal',
    )
  })

  it('blocks GENERATION_PROVIDER=gemini with only FAL_KEY, as the API refuses every start', () => {
    const env = { FAL_KEY: 'k', GENERATION_PROVIDER: 'gemini' }
    const checks = keyChecks(input({ chosen: chosenProviders(env, {}), claude: ready, env }))
    assert.deepEqual(blocking(checks), ['Chosen for videos'])
    assert.equal(
      byName(checks)['Chosen for videos'].detail,
      'Gemini is not ready: fix it, or pick another in Setup',
    )
  })

  it('checks a custom chat endpoint without blocking on it', () => {
    const checks = keyChecks(
      input({
        endpointStatus: 0,
        env: { FAL_KEY: 'k', LLM_BASE_URL: 'http://localhost:11434/v1' },
      }),
    )
    assert.deepEqual(byName(checks)['Chat endpoint'], {
      blocking: false,
      detail: 'http://localhost:11434/v1 → HTTP unreachable',
      name: 'Chat endpoint',
      ok: false,
    })
  })
})

describe('setup flags and saved choices', () => {
  it('reads --llm and --generation, and says what is allowed', () => {
    assert.deepEqual(parseProviderFlags(['--yes', '--llm=claude', '--generation=google']), {
      errors: [],
      generation: 'google',
      llm: 'claude',
    })
    assert.deepEqual(parseProviderFlags(['--llm=gpt', '--generation']), {
      errors: [
        '--generation must be fal or google',
        '--llm must be claude, codex, gemini or endpoint',
      ],
    })
    assert.deepEqual(parseProviderFlags([]), { errors: [] })
  })

  it('needs FAL_KEY or GEMINI_API_KEY to make videos', () => {
    assert.equal(missingVideoKey({}), 'No FAL_KEY or GEMINI_API_KEY in .env')
    assert.equal(missingVideoKey({ FAL_KEY: 'k' }), null)
    assert.equal(missingVideoKey({ GEMINI_API_KEY: 'k' }), null)
  })

  it('says doctor blocks when setup ends with neither video key', () => {
    assert.match(NO_VIDEO_KEY_WARNING, /`pnpm reelmakeeasy doctor` will block/)
  })

  it('prefers what Setup saved over the .env defaults, ignoring unknown ids', () => {
    const env = { GENERATION_PROVIDER: 'fal', LLM_PROVIDER: 'codex' }
    assert.deepEqual(
      chosenProviders(
        env,
        parseStoredSettings('{"llmProvider":"claude","generationProvider":"veo"}'),
      ),
      { generation: 'fal', llm: 'claude' },
    )
    assert.deepEqual(chosenProviders({}, parseStoredSettings('not json')), {
      generation: undefined,
      llm: undefined,
    })
    assert.deepEqual(parseStoredSettings('[1]'), {})
    assert.deepEqual(parseStoredSettings(undefined), {})
  })

  it('reads the .env defaults as the API does: trimmed, any case, gemini meaning Google', () => {
    assert.deepEqual(
      chosenProviders({ GENERATION_PROVIDER: ' gemini ', LLM_PROVIDER: 'Claude' }, {}),
      { generation: 'google', llm: 'claude' },
    )
    assert.deepEqual(chosenProviders({ GENERATION_PROVIDER: 'FAL', LLM_PROVIDER: ' CODEX ' }, {}), {
      generation: 'fal',
      llm: 'codex',
    })
    // A saved choice is read exactly, as the API's settings.json reader does.
    assert.deepEqual(chosenProviders({}, { generationProvider: 'gemini', llmProvider: 'Claude' }), {
      generation: undefined,
      llm: undefined,
    })
  })
})

describe('USAGE', () => {
  it("lists start and build, the way to skip setup's build, and dev for changing the code", () => {
    for (const command of ['setup', 'doctor', 'start', 'build', 'dev']) {
      assert.match(USAGE, new RegExp(`^ {2}${command} `, 'm'), `${command} should be listed`)
    }
    assert.match(USAGE, /--no-build/)
    assert.match(USAGE, /--local-tts=all\|kokoro\|qwen\|off/)
    assert.match(USAGE, /--local-captions=on\|off/)
    assert.match(USAGE, /^ {2}dev .*changing the code/m)
  })
})

describe('commandHelp', () => {
  const COMMANDS = ['setup', 'doctor', 'start', 'build', 'dev']

  it("is each command's own usage when --help or -h follows it", () => {
    for (const command of COMMANDS) {
      for (const flag of ['--help', '-h']) {
        const help = commandHelp(command, [flag])
        assert.ok(help, `${command} ${flag} should print its usage`)
        assert.match(help, new RegExp(`^Usage: pnpm reelmakeeasy ${command}\\b`))
      }
      // Wherever it is among the flags: --help wins, and nothing runs.
      assert.ok(commandHelp(command, ['--yes', '--help']))
    }
  })

  it('lists every setup flag, and doctor its --json', () => {
    const setup = commandHelp('setup', ['--help'])
    for (const flag of [
      '--yes',
      '--fal-key=KEY',
      '--gemini-key=KEY',
      '--elevenlabs-key=KEY',
      '--llm=claude|codex|gemini|endpoint',
      '--generation=fal|google',
      '--local-tts=all|kokoro|qwen|off',
      '--local-captions=on|off',
      '--agent-harness=codex|claude',
      '--no-build',
    ]) {
      assert.ok(setup.includes(flag), `setup --help should list ${flag}`)
    }
    assert.match(commandHelp('doctor', ['--help']), /--json/)
  })

  it('is null without --help (the command runs), and for an unknown command', () => {
    for (const command of COMMANDS) {
      assert.equal(commandHelp(command, []), null)
      assert.equal(commandHelp(command, ['--yes', '--helpful']), null)
    }
    assert.equal(commandHelp('deploy', ['--help']), null)
    assert.equal(commandHelp(undefined, ['--help']), null)
  })
})

describe('setupDoneMessage', () => {
  it('ends with `pnpm reelmakeeasy start` and the link to open, not `pnpm dev`', () => {
    for (const built of [true, false]) {
      const lines = setupDoneMessage({ built, webPort: 3000 })
      assert.match(lines[0], /^Next: pnpm reelmakeeasy start/)
      assert.equal(lines[1], 'Then open http://localhost:3000')
      assert.doesNotMatch(lines.join('\n'), /pnpm dev/)
    }
    assert.equal(setupDoneMessage({ built: true, webPort: 3000 })[0], 'Next: pnpm reelmakeeasy start')
    assert.match(setupDoneMessage({ built: false, webPort: 3000 })[0], /builds the app first/)
    assert.equal(
      setupDoneMessage({ built: true, webPort: 3100 })[1],
      'Then open http://localhost:3100',
    )
  })
})
