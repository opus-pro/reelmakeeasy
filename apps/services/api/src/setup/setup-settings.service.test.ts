import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { LLM_NOT_SET_UP_MESSAGE } from '@reelmakeeasy/llm'
import type { AgentStatusResponse, HarnessStatus } from '@shared/types/api/agent'

import { SetupSettingsService } from './setup-settings.service'

const READY: HarnessStatus = { available: true, binary: '/bin/x', loggedIn: true, version: '1' }
const SIGNED_OUT: HarnessStatus = {
  available: false,
  binary: '/bin/x',
  loggedIn: false,
  reason: 'not-logged-in',
  version: '1',
}
const MISSING: HarnessStatus = {
  available: false,
  binary: null,
  loggedIn: false,
  reason: 'not-found',
  version: null,
}

/** `GET /api/agent/status` for these Codex and Claude Code states. */
function harnesses(
  codex: HarnessStatus,
  claude: HarnessStatus,
  defaultHarness: 'claude' | 'codex' = 'codex',
): AgentStatusResponse {
  return { ...codex, claude, codex, defaultHarness }
}

/** A settings.json path in a fresh temp folder (the file doesn't exist yet). */
function tmpSettingsFile(): string {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'setup-settings-')), 'settings.json')
}

/** A service over a fake probe; nothing touches the real data folder or the real agents. */
function service(
  opts: {
    env?: NodeJS.ProcessEnv
    file?: string
    probe?: () => Promise<AgentStatusResponse>
    status?: AgentStatusResponse
    warn?: (message: string) => void
  } = {},
) {
  const probe = jest.fn(opts.probe ?? (async () => opts.status ?? harnesses(MISSING, MISSING)))
  const settings = new SetupSettingsService({
    env: opts.env ?? {},
    file: opts.file ?? tmpSettingsFile(),
    probe,
    warn: opts.warn ?? jest.fn(),
  })
  return { probe, settings }
}

describe('SetupSettingsService', () => {
  afterEach(() => jest.useRealTimers())

  it('knows no AI before the first refresh', () => {
    const { settings } = service()
    expect(settings.currentLlm()).toBeNull()
    expect(settings.llmNotSetUpMessage()).toBe(LLM_NOT_SET_UP_MESSAGE)
  })

  it('picks the first ready AI when nothing is chosen, AGENT_HARNESS breaking the tie', async () => {
    const { settings } = service({ status: harnesses(READY, READY, 'claude') })
    const status = await settings.refresh()
    expect(status.llm).toMatchObject({ effective: 'claude', provider: null })
    expect(settings.currentLlm()).toBe('claude')
  })

  it('uses LLM_PROVIDER as the default choice, in any case', async () => {
    const { settings } = service({
      env: { GEMINI_API_KEY: 'k', LLM_PROVIDER: 'Gemini' },
      status: harnesses(READY, MISSING),
    })
    expect((await settings.refresh()).llm).toMatchObject({
      effective: 'gemini',
      provider: 'gemini',
    })
  })

  it('saves a choice atomically to settings.json, and the saved choice wins over LLM_PROVIDER', async () => {
    const file = tmpSettingsFile()
    const env = { GEMINI_API_KEY: 'k', LLM_PROVIDER: 'gemini' }
    const { settings } = service({ env, file, status: harnesses(READY, MISSING) })
    await settings.refresh()
    settings.setLlmProvider('codex')
    expect(settings.currentLlm()).toBe('codex')
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({ llmProvider: 'codex' })
    expect(fs.readdirSync(path.dirname(file))).toEqual(['settings.json'])
    expect(service({ env, file }).settings.stored()).toEqual({ llmProvider: 'codex' })
  })

  it('keeps the other choice when saving one', () => {
    const file = tmpSettingsFile()
    const { settings } = service({ file })
    settings.setGenerationProvider('fal')
    settings.setLlmProvider('claude')
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({
      generationProvider: 'fal',
      llmProvider: 'claude',
    })
  })

  it('saves the voice typing choice beside the others, with DICTATION as the default', () => {
    const file = tmpSettingsFile()
    const { settings } = service({ env: { DICTATION: 'Browser' }, file })
    expect(settings.stored().dictation).toBe('browser')
    settings.setLlmProvider('claude')
    settings.setDictation('local')
    settings.setGenerationProvider('fal')
    expect(JSON.parse(fs.readFileSync(file, 'utf8'))).toEqual({
      dictation: 'local',
      generationProvider: 'fal',
      llmProvider: 'claude',
    })
    expect(settings.stored().dictation).toBe('local')
  })

  it('ignores an unknown voice typing choice', () => {
    const file = tmpSettingsFile()
    fs.writeFileSync(file, JSON.stringify({ dictation: 'siri' }))
    expect(
      service({ env: { DICTATION: 'nope' }, file }).settings.stored().dictation,
    ).toBeUndefined()
  })

  it('reports a chosen AI that is no longer ready instead of swapping it', async () => {
    const file = tmpSettingsFile()
    fs.writeFileSync(file, JSON.stringify({ llmProvider: 'claude' }))
    const { settings } = service({
      env: { GEMINI_API_KEY: 'k' },
      file,
      status: harnesses(READY, SIGNED_OUT),
    })
    const status = await settings.refresh()
    expect(status.llm.provider).toBe('claude')
    expect(status.llm.effective).toBeNull()
    expect(settings.currentLlm()).toBeNull()
    expect(settings.llmNotSetUpMessage()).toBe(
      "Claude Code can't write and plan right now (Sign in: run claude login in a terminal): open Setup",
    )
  })

  it('ignores an unreadable settings file, warning once per version of it', () => {
    const file = tmpSettingsFile()
    fs.writeFileSync(file, '{not json')
    const warn = jest.fn()
    const { settings } = service({ file, warn })
    expect(settings.stored()).toEqual({})
    expect(settings.stored()).toEqual({})
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('settings.json'))
    fs.writeFileSync(file, '[]')
    expect(settings.stored()).toEqual({})
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('ignores an unknown LLM_PROVIDER, with a warning', () => {
    const warn = jest.fn()
    const { settings } = service({ env: { LLM_PROVIDER: 'gpt' }, warn })
    expect(settings.stored()).toEqual({})
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('LLM_PROVIDER'))
  })

  it('reports which keys are set, never their values', async () => {
    const { settings } = service({
      env: {
        ELEVENLABS_API_KEY: 'el-secret',
        FAL_KEY: 'fal-secret',
        GEMINI_API_KEY: 'gem-secret',
        LLM_BASE_URL: 'http://localhost:11434/v1',
      },
    })
    const status = await settings.refresh()
    expect(status.keys).toEqual({ elevenlabs: true, endpoint: true, fal: true, gemini: true })
    expect(JSON.stringify(status)).not.toMatch(/secret|11434/)
  })

  it('passes refresh through to the agents probe', async () => {
    const { probe, settings } = service()
    await settings.refresh({ refresh: true })
    expect(probe).toHaveBeenCalledWith({ refresh: true })
  })

  it('rebuilds the status from the last probe, re-reading the keys and the choices, without re-checking the agents', async () => {
    const env: NodeJS.ProcessEnv = {}
    const file = tmpSettingsFile()
    const { probe, settings } = service({ env, file, status: harnesses(READY, READY) })
    expect((await settings.refresh()).llm.effective).toBe('codex')
    fs.writeFileSync(file, JSON.stringify({ llmProvider: 'claude' }))
    env['GEMINI_API_KEY'] = 'k'
    const status = await settings.currentStatus()
    expect(probe).toHaveBeenCalledTimes(1)
    expect(status.llm).toMatchObject({ effective: 'claude', provider: 'claude' })
    expect(status.keys.gemini).toBe(true)
    expect(settings.currentLlm()).toBe('claude')
  })

  it('probes once for the status when nothing has been probed yet', async () => {
    const { probe, settings } = service({ status: harnesses(READY, MISSING) })
    expect((await settings.currentStatus()).llm.effective).toBe('codex')
    expect(probe).toHaveBeenCalledTimes(1)
    expect(probe).toHaveBeenCalledWith({})
  })

  it('keeps Gemini usable when the agents probe fails at startup', async () => {
    const warn = jest.fn()
    const { settings } = service({
      env: { GEMINI_API_KEY: 'k' },
      probe: () => Promise.reject(new Error('spawn EACCES')),
      warn,
    })
    await settings.onModuleInit()
    settings.onModuleDestroy()
    expect(settings.currentLlm()).toBe('gemini')
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('spawn EACCES'))
  })

  it('refreshes at init and every minute, and stops on destroy', async () => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'queueMicrotask', 'setImmediate'] })
    const { probe, settings } = service({ status: harnesses(READY, MISSING) })
    await settings.onModuleInit()
    expect(settings.currentLlm()).toBe('codex')
    expect(probe).toHaveBeenCalledTimes(1)
    jest.advanceTimersByTime(60_000)
    expect(probe).toHaveBeenCalledTimes(2)
    settings.onModuleDestroy()
    jest.advanceTimersByTime(120_000)
    expect(probe).toHaveBeenCalledTimes(2)
  })
})
