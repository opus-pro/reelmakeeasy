import { LLM_NOT_SET_UP_MESSAGE } from '@reelmakeeasy/llm'
import type { AgentStatusResponse, HarnessStatus } from '@shared/types/api/agent'
import type { SetupKeys } from '@shared/types/api/setup'

import {
  buildSetupStatus,
  effectiveGeneration,
  effectiveLlm,
  generationOptions,
  isLlmProvider,
  llmNotSetUpMessage,
  llmOptions,
  readKeys,
} from './setup-status'

const READY: HarnessStatus = {
  available: true,
  binary: '/bin/agent',
  loggedIn: true,
  version: '1.0.0',
}
const SIGNED_OUT: HarnessStatus = {
  available: false,
  binary: '/bin/agent',
  loggedIn: false,
  reason: 'not-logged-in',
  version: '1.0.0',
}
const MISSING: HarnessStatus = {
  available: false,
  binary: null,
  loggedIn: false,
  reason: 'not-found',
  version: null,
}
const NO_KEYS: SetupKeys = { elevenlabs: false, endpoint: false, fal: false, gemini: false }

/** `GET /api/agent/status` for these Codex and Claude Code states. */
function harnesses(
  codex: HarnessStatus,
  claude: HarnessStatus,
  defaultHarness: 'claude' | 'codex' = 'codex',
): AgentStatusResponse {
  return { ...codex, claude, codex, defaultHarness }
}

/** The LLM options for these agent states and keys. */
function optionsFor(codex: HarnessStatus, claude: HarnessStatus, keys: SetupKeys = NO_KEYS) {
  return llmOptions({ harnesses: harnesses(codex, claude), keys })
}

describe('readKeys', () => {
  it('reports which keys are set, as booleans only', () => {
    expect(
      readKeys({
        ELEVENLABS_API_KEY: ' ',
        FAL_KEY: 'fal-secret',
        GEMINI_API_KEY: 'gem-secret',
        LLM_BASE_URL: 'http://localhost:11434/v1',
      }),
    ).toEqual({ elevenlabs: false, endpoint: true, fal: true, gemini: true })
  })

  it('uses the same key rule as the voice engines report', () => {
    expect(readKeys({ ELEVENLABS_API_KEY: ' el-test ', FAL_KEY: '   ' })).toMatchObject({
      elevenlabs: true,
      fal: false,
    })
    expect(readKeys({ ELEVENLABS_API_KEY: '\t' })).toMatchObject({ elevenlabs: false, fal: false })
  })
})

describe('llmOptions', () => {
  it('lists every AI, with why the unavailable ones cannot be picked', () => {
    expect(optionsFor(SIGNED_OUT, MISSING)).toEqual([
      { available: false, id: 'claude', label: 'Claude Code', reason: 'Not installed' },
      {
        available: false,
        id: 'codex',
        label: 'Codex',
        reason: 'Sign in: open ChatGPT and sign in to Codex',
      },
      {
        available: false,
        id: 'gemini',
        label: 'Gemini',
        reason: 'Add GEMINI_API_KEY to .env, then restart',
      },
      {
        available: false,
        id: 'endpoint',
        label: 'Your own endpoint',
        reason: 'Set LLM_BASE_URL in .env, then restart',
      },
    ])
  })

  it('marks signed-in agents and set keys available, with no reason', () => {
    const options = optionsFor(READY, READY, { ...NO_KEYS, endpoint: true, gemini: true })
    expect(options.map((o) => [o.id, o.available, o.reason])).toEqual([
      ['claude', true, undefined],
      ['codex', true, undefined],
      ['gemini', true, undefined],
      ['endpoint', true, undefined],
    ])
  })

  it('offers Claude Code for writing without the shell sandbox, which only agent chats need', () => {
    const noSandbox: HarnessStatus = { ...READY, available: false, reason: 'no-sandbox' }
    expect(optionsFor(MISSING, noSandbox)[0]).toEqual({
      available: true,
      id: 'claude',
      label: 'Claude Code',
    })
  })
})

describe('effectiveLlm', () => {
  it('keeps a stored choice that is ready', () => {
    expect(
      effectiveLlm('gemini', optionsFor(READY, READY, { ...NO_KEYS, gemini: true }), 'codex'),
    ).toBe('gemini')
  })

  it('reports a stored choice that is not ready as null, never swapping it', () => {
    expect(
      effectiveLlm('claude', optionsFor(READY, SIGNED_OUT, { ...NO_KEYS, gemini: true }), 'codex'),
    ).toBeNull()
  })

  it('with nothing stored, lets AGENT_HARNESS pick between two ready agents', () => {
    const both = optionsFor(READY, READY)
    expect(effectiveLlm(undefined, both, 'codex')).toBe('codex')
    expect(effectiveLlm(undefined, both, 'claude')).toBe('claude')
  })

  it('with nothing stored, falls back from the agents to Gemini, then the endpoint, then nothing', () => {
    expect(effectiveLlm(undefined, optionsFor(MISSING, READY), 'codex')).toBe('claude')
    const allKeys = { ...NO_KEYS, endpoint: true, gemini: true }
    expect(effectiveLlm(undefined, optionsFor(MISSING, MISSING, allKeys), 'codex')).toBe('gemini')
    const endpointOnly = { ...NO_KEYS, endpoint: true }
    expect(effectiveLlm(undefined, optionsFor(MISSING, MISSING, endpointOnly), 'codex')).toBe(
      'endpoint',
    )
    expect(effectiveLlm(undefined, optionsFor(MISSING, MISSING), 'codex')).toBeNull()
  })
})

describe('generation', () => {
  it('offers fal when FAL_KEY is set, and never swaps a stored choice that is not ready', () => {
    const withFal = generationOptions({ ...NO_KEYS, fal: true })
    expect(withFal).toEqual([
      { available: true, id: 'fal', label: 'fal' },
      {
        available: false,
        id: 'google',
        label: 'Gemini',
        reason: 'Add GEMINI_API_KEY to .env, then restart',
      },
    ])
    expect(effectiveGeneration(undefined, withFal)).toBe('fal')
    expect(effectiveGeneration(undefined, generationOptions(NO_KEYS))).toBeNull()
    expect(effectiveGeneration('google', withFal)).toBeNull()
  })
})

describe('buildSetupStatus', () => {
  it('puts the keys, the agents and both choices together', () => {
    const h = harnesses(READY, MISSING)
    const keys = { ...NO_KEYS, fal: true }
    expect(buildSetupStatus({ harnesses: h, keys, stored: { llmProvider: 'codex' } })).toEqual({
      generation: {
        effective: 'fal',
        options: generationOptions(keys),
        provider: null,
      },
      harnesses: h,
      keys,
      llm: { effective: 'codex', options: llmOptions({ harnesses: h, keys }), provider: 'codex' },
    })
  })
})

describe('llmNotSetUpMessage', () => {
  it("names the chosen AI and why it isn't ready", () => {
    const status = buildSetupStatus({
      harnesses: harnesses(READY, SIGNED_OUT),
      keys: NO_KEYS,
      stored: { llmProvider: 'claude' },
    })
    expect(llmNotSetUpMessage(status.llm)).toBe(
      "Claude Code can't write and plan right now (Sign in: run claude login in a terminal): open Setup",
    )
  })

  it('says no AI is set up otherwise', () => {
    const status = buildSetupStatus({
      harnesses: harnesses(MISSING, MISSING),
      keys: NO_KEYS,
      stored: {},
    })
    expect(llmNotSetUpMessage(status.llm)).toBe(LLM_NOT_SET_UP_MESSAGE)
  })
})

describe('isLlmProvider', () => {
  it('accepts only the four ids', () => {
    expect(['claude', 'codex', 'endpoint', 'gemini'].every((id) => isLlmProvider(id))).toBe(true)
    expect(isLlmProvider('gpt')).toBe(false)
    expect(isLlmProvider(undefined)).toBe(false)
  })
})
